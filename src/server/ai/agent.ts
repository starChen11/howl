import type { Action } from '@shared/actions';
import type { PendingDecision, ProjectedContext } from '@shared/project';

import { decide } from '../llm/client';
import { toAction } from '../llm/to-action';
import { recordUsage } from '../llm/usage';

/**
 * AI 的行动来源（RFC-012 的整局入口）。
 *
 * 生产用模型（RFC-006 的 `decide` + `toAction`）；没有 API key 时用**脚本化**替身，
 * 好让端到端测试与本地演示不必联网。两者输出同一种 `AgentDecision`，编排层不关心来源。
 */

export interface AgentDecision {
  action: Action | undefined;
  speech?: string;
}

export type Decider = (input: {
  seat: number;
  ctx: ProjectedContext;
  /** 引擎的真实相位——投影把夜间折成 `'NIGHT'`，AI 不能靠它选动作。 */
  phase: string;
}) => Promise<AgentDecision>;

export type AgentKind = 'llm' | 'scripted';

/** 从投影里挑一个合法目标（跳过自己）。 */
function pickTarget(ctx: ProjectedContext): number | 'abstain' | undefined {
  return ctx.legalTargets.find((target) => target !== ctx.self.seat);
}

/** 脚本化替身：每个阶段都给出一个合法动作，足以把一局推完。 */
export const scriptedAgent: Decider = async ({ seat, ctx, phase }) => {
  const target = pickTarget(ctx);
  const ts = Date.now();

  switch (phase) {
    case 'NIGHT_WOLF_CHAT':
      return { action: { type: 'WOLF_CHAT', ts, seat: seat as never, text: '今晚刀他' } };
    case 'NIGHT_WOLVES':
      return target === undefined
        ? { action: undefined }
        : { action: { type: 'WOLF_KILL', ts, seat: seat as never, target: target as never } };
    case 'NIGHT_SEER':
      return target === undefined
        ? { action: undefined }
        : { action: { type: 'SEER_CHECK', ts, seat: seat as never, target: target as never } };
    case 'NIGHT_WITCH':
      return { action: { type: 'WITCH_ACT', ts, seat: seat as never, potion: 'none' } };
    case 'DAY_SPEECH':
      return { action: { type: 'SPEECH', ts, seat: seat as never, text: '我先过，听后面的。' } };
    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF':
      return target === undefined || target === 'abstain'
        ? { action: { type: 'VOTE', ts, seat: seat as never, target: 'abstain' } }
        : { action: { type: 'VOTE', ts, seat: seat as never, target: target as never } };
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
}): Decider {
  return async ({ seat, ctx, phase }) => {
    const { loadLlmConfig } = await import('../llm/config');
    const config = loadLlmConfig(process.env);
    const personaId = ctx.self.personaId ?? null;

    const outcome = await decide(
      { config },
      { gameId: input.gameId, seq: input.seq(), ctx, mode: input.mode, personaId },
    );

    if ('duplicate' in outcome) return { action: undefined };
    recordUsage(input.gameId, outcome.meta);

    const translated = toAction(
      outcome.decision,
      {
        seat: seat as never,
        phase: phase as never,
        day: ctx.day,
        legalTargets: ctx.legalTargets,
      },
      Date.now(),
    );

    if ('reject' in translated) return { action: undefined, speech: outcome.decision.reason };
    return { action: translated.action };
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
