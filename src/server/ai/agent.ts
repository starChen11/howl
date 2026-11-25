import type { Action } from '@shared/actions';
import type { PendingDecision, ProjectedContext } from '@shared/project';

import { decide } from '../llm/client';
import { toAction } from '../llm/to-action';
import { usageMetaLog } from '../llm/usage';

/**
 * AI 的行动来源（RFC-012 的整局入口）。
 *
 * 生产用模型（RFC-006 的 `decide` + `toAction`）；没有 API key 时用**脚本化**替身，
 * 好让端到端测试与本地演示不必联网。两者输出同一种 `AgentDecision`，编排层不关心来源。
 */

export interface AgentDecision {
  action: Action | undefined;
  speech?: string;
  /** 这一轮的推理（只来自结构化 `reason`，AI-5）。 */
  thought?: { reason: string; claim?: unknown } | undefined;
  /** 模型失败后用了脚本兜底，复盘要标成降级。 */
  degraded?: boolean;
}

export type Decider = (input: {
  seat: number;
  ctx: ProjectedContext;
  /** 引擎的真实相位——投影把夜间折成 `'NIGHT'`，AI 不能靠它选动作。 */
  phase: string;
  /** 上一次动作被拒绝的原因。 */
  feedback?: string;
  /** 额外指令（例如明确要求回答 ready）。 */
  instruction?: string;
  /** token 级流式发言的增量回调。 */
  onSpeechDelta?: (text: string) => void;
}) => Promise<AgentDecision>;

export type AgentKind = 'llm' | 'scripted';

/** 确定性哈希：把字符串混成一个 32 位数（FNV-1a）。 */
function fnv(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 从投影里挑一个合法目标（跳过自己与狼队友）。
 *
 * **不能用 `Math.random`**：selfplay 靠种子复现批次。这里用「天 × 席位」的确定性
 * 轮转，让脚本 AI 的票型分散开——否则它永远投第一个合法目标，玩家会在第一天被
 * 全票放逐（用户实测反馈）。
 */
function pickTarget(ctx: ProjectedContext, phase?: string): number | 'abstain' | undefined {
  const candidates = ctx.legalTargets
    .filter((target) => typeof target === 'number')
    .map((target) => Number(target))
    .filter((target) => target !== ctx.self.seat)
    .filter(
      (target) => phase !== 'NIGHT_WOLVES' || !ctx.knowledge.teammates.includes(target as never),
    );
  if (candidates.length === 0) {
    return ctx.legalTargets.includes('abstain') ? 'abstain' : undefined;
  }

  // 所有需要目标的选择都分散开：狼刀、查验、开枪、投票。
  // 用 FNV-1a 把「天 / 席位 / 相位」混成一个数再取模：比线性组合分散得均匀，
  // 但仍然是确定性的，所以同一 seed 的批次可复现。
  return candidates[fnv(`${ctx.day}|${ctx.self.seat}|${phase ?? ''}`) % candidates.length];
}

/** 脚本化替身：每个阶段都给出一个合法动作，足以把一局推完。 */
export const scriptedAgent: Decider = async ({ seat, ctx, phase }) => {
  const target = pickTarget(ctx, phase);
  const ts = Date.now();

  switch (phase) {
    case 'NIGHT_WOLF_CHAT':
      return { action: { type: 'WOLF_CHAT', ts, seat: seat as never, text: '今晚刀他' } };
    case 'NIGHT_WOLVES':
    case 'NIGHT_WOLF_RUNOFF':
      return target === undefined || target === 'abstain'
        ? { action: undefined }
        : { action: { type: 'WOLF_VOTE', ts, seat: seat as never, target: target as never } };
    case 'NIGHT_SEER':
      return target === undefined
        ? { action: undefined }
        : { action: { type: 'SEER_CHECK', ts, seat: seat as never, target: target as never } };
    case 'NIGHT_WITCH': {
      // 用药的角色不再永远「不用药」：按确定性哈希在**可用**的选项里挑。
      // 必须检查药的剩余次数与自救限制（FR-17），否则引擎会拒绝。
      const potions = ctx.knowledge.potions;
      const killTarget = ctx.knowledge.knownKillTarget;
      const canHeal = potions.heal === 'available' && killTarget !== null && killTarget !== seat;
      const poisonTarget = pickTarget(ctx, 'NIGHT_WITCH');
      const canPoison = potions.poison === 'available' && typeof poisonTarget === 'number';

      const options: ('none' | 'heal' | 'poison')[] = ['none'];
      if (canHeal) options.push('heal');
      if (canPoison) options.push('poison');

      const choice = options[fnv(`${ctx.day}|${seat}|witch`) % options.length] ?? 'none';
      if (choice === 'heal' && killTarget !== null) {
        return {
          action: {
            type: 'WITCH_ACT',
            ts,
            seat: seat as never,
            potion: 'heal',
            target: killTarget as never,
          },
        };
      }
      if (choice === 'poison' && typeof poisonTarget === 'number') {
        return {
          action: {
            type: 'WITCH_ACT',
            ts,
            seat: seat as never,
            potion: 'poison',
            target: poisonTarget as never,
          },
        };
      }
      return { action: { type: 'WITCH_ACT', ts, seat: seat as never, potion: 'none' } };
    }

    case 'DAY_SPEECH':
      return { action: { type: 'SPEECH', ts, seat: seat as never, text: '我先过，听后面的。' } };
    case 'DAY_PK_SPEECH':
      return {
        action: { type: 'SPEECH', ts, seat: seat as never, text: '我不是狼，请别投我。' },
      };
    case 'DAY_VOTE':
      return target === undefined || target === 'abstain'
        ? { action: { type: 'VOTE', ts, seat: seat as never, target: 'abstain' } }
        : { action: { type: 'VOTE', ts, seat: seat as never, target: target as never } };
    case 'DAY_VOTE_RUNOFF': {
      // RUL-2：重投只能投并列者，且**不能弃权**。并列者里可能包含自己，
      // 这里不能套用「跳过自己」的挑选逻辑，否则会退化成 abstain 被拒。
      const tied = ctx.legalTargets
        .filter((candidate) => typeof candidate === 'number')
        .map((candidate) => Number(candidate));
      const choice = tied[Math.min(tied.length - 1, (ctx.day * 31 + seat * 17) % tied.length)];
      return choice === undefined
        ? { action: undefined }
        : { action: { type: 'VOTE', ts, seat: seat as never, target: choice as never } };
    }

    /* ---- RFC-022：警长竞选 / 警徽 ---- */

    case 'DAY_SHERIFF_SIGNUP': {
      // 脚本 AI 也要提供确定性策略：约一半席位会上警，保证竞选流程真的被走到。
      const run = fnv(`${ctx.self.seat}|${ctx.day}|signup`) % 2 === 0;
      return { action: { type: 'SHERIFF_SIGNUP', ts, seat: seat as never, run } };
    }
    case 'DAY_SHERIFF_SPEECH':
      return { action: { type: 'SPEECH', ts, seat: seat as never, text: '我上警，请把票给我。' } };
    case 'DAY_SHERIFF_PK':
      return {
        action: { type: 'SPEECH', ts, seat: seat as never, text: '平票了，我再说一次我的判断。' },
      };
    case 'DAY_SHERIFF_WITHDRAW': {
      // 默认不退水；约四分之一会退水，覆盖退水路径。
      const withdraw = fnv(`${ctx.self.seat}|${ctx.day}|withdraw`) % 4 === 0;
      return { action: { type: 'SHERIFF_WITHDRAW', ts, seat: seat as never, withdraw } };
    }
    case 'DAY_SHERIFF_VOTE':
      return {
        action:
          target === undefined || target === 'abstain'
            ? { type: 'SHERIFF_VOTE', ts, seat: seat as never, target: 'abstain' }
            : { type: 'SHERIFF_VOTE', ts, seat: seat as never, target: target as never },
      };
    case 'DAY_SHERIFF_RUNOFF': {
      const tied = ctx.legalTargets
        .filter((candidate) => typeof candidate === 'number')
        .map((candidate) => Number(candidate));
      const choice = tied[Math.min(tied.length - 1, (ctx.day * 13 + seat) % tied.length)];
      return choice === undefined
        ? { action: undefined }
        : { action: { type: 'SHERIFF_VOTE', ts, seat: seat as never, target: choice as never } };
    }
    case 'DAY_SHERIFF_FINAL_SPEECH':
      return {
        action: { type: 'SPEECH', ts, seat: seat as never, text: '警长归票：听清楚再投。' },
      };
    case 'DAY_SHERIFF_ORDER': {
      const options = ctx.sheriffOrderOptions ?? [];
      const option =
        options[Math.min(options.length - 1, fnv(`${ctx.day}|${seat}|order`) % options.length)];
      return option === undefined
        ? { action: undefined }
        : {
            action: {
              type: 'SHERIFF_ORDER',
              ts,
              seat: seat as never,
              startSeat: option.startSeat as never,
              direction: option.direction,
            },
          };
    }
    case 'DAY_BADGE_TRANSFER':
      // 默认撕徽；有合法目标时随机移交给一个存活玩家（不会是自己，投影已排除）。
      return {
        action:
          target === undefined || target === 'abstain'
            ? { type: 'BADGE_TRANSFER', ts, seat: seat as never, target: 'tear' }
            : { type: 'BADGE_TRANSFER', ts, seat: seat as never, target: target as never },
      };

    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      // 出局后的开枪决定；没有目标就选择不开枪（规则允许）。
      return {
        action:
          target === undefined
            ? { type: 'HUNTER_SHOOT', ts, seat: seat as never }
            : { type: 'HUNTER_SHOOT', ts, seat: seat as never, target: target as never },
      };
    default:
      return { action: undefined };
  }
};

/**
 * 模型驱动的决策。
 *
 * 没有 key 时直接失败（**不静默降级成脚本**）——那会让「AI 在思考」变成假象。
 * 端到端测试用 `HOWL_FAKE_AI=1` 显式选择脚本替身。
 */
export function createLlmAgent(input: {
  gameId: string;
  seq: () => number;
  mode: 'slaughter-side' | 'slaughter-all';
  /** 测试缝：生产不传，走真实 `decide`。 */
  decideFn?: typeof decide;
}): Decider {
  // 同一席位同时只保留一条在途调用：新触发到来时取消旧的，避免多路结果互相覆盖。
  const controllers: Record<number, AbortController> = {};

  return async ({ seat, ctx, phase, feedback, instruction, onSpeechDelta }) => {
    controllers[seat]?.abort();
    const controller = new AbortController();
    controllers[seat] = controller;

    const { loadLlmConfig } = await import('../llm/config');
    const config = loadLlmConfig(process.env);
    const personaId = ctx.self.personaId ?? null;
    const runDecide = input.decideFn ?? decide;

    let lastFeedback = feedback;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const outcome = await runDecide(
          { config, metaLog: usageMetaLog as never },
          {
            gameId: input.gameId,
            seq: input.seq(),
            ctx,
            mode: input.mode,
            personaId,
            ...(lastFeedback === undefined ? {} : { feedback: lastFeedback }),
            ...(instruction === undefined ? {} : { instruction }),
            signal: controller.signal,
            ...(onSpeechDelta === undefined ? {} : { onDelta: onSpeechDelta }),
          },
        );

        if ('duplicate' in outcome) return { action: undefined };

        const translated = toAction(
          outcome.decision,
          {
            seat: seat as never,
            phase: phase as never,
            day: ctx.day,
            legalTargets: ctx.legalTargets,
            ...(ctx.sheriffOrderOptions === undefined
              ? {}
              : { orderOptions: ctx.sheriffOrderOptions }),
          },
          Date.now(),
        );

        const thought: { reason: string; claim?: unknown } = {
          reason: outcome.decision.reason,
        };
        if (outcome.decision.claim !== undefined) thought.claim = outcome.decision.claim;

        if (!('reject' in translated)) return { action: translated.action, thought };
        lastFeedback = translated.reject;
      } catch (error) {
        if (controller.signal.aborted) return { action: undefined };
        console.warn('[llm] 模型调用失败，使用脚本兜底', {
          seat,
          phase,
          error: error instanceof Error ? error.message : String(error),
        });
        // 真实调用彻底失败：退回脚本动作，保证对局不冻结（发言降级由编排层处理）。
        try {
          return { ...(await scriptedAgent({ seat, ctx, phase })), degraded: true };
        } catch {
          void error;
          return { action: undefined };
        }
      }
    }

    // 两次都被拒：退回脚本动作，至少让对局能继续。
    console.warn('[llm] 动作连续被拒，使用脚本兜底', { seat, phase, reason: lastFeedback });
    return { ...(await scriptedAgent({ seat, ctx, phase })), degraded: true };
  };
}

/** 按环境选择一个 decider。 */
export function agentFor(kind: AgentKind, input: Parameters<typeof createLlmAgent>[0]): Decider {
  return kind === 'scripted' ? scriptedAgent : createLlmAgent(input);
}

/** 供编排层判断「现在要不要问模型」。 */
export function pendingKind(phase: string): PendingDecision | null {
  return phase === 'DAY_SPEECH' ? 'speak' : null;
}
