import { GameRegistry } from '../store/game-registry';
import { InMemoryMetaStore } from '../store/meta-store';
import { runGame } from '../orchestrator';
import type { InputChannel } from '@shared/channels';
import type { EventEnvelope } from '@shared/events';
import type { ProjectedContext } from '@shared/project';
import type { Decider } from '../ai/agent';
import { usageOf } from '../llm/usage';
import { legalActionFor, mulberry32, scriptedPlayerAction, type Rng } from './scripted-player';
import type { GameOutcome } from './report';

/** 行动的目标是否在投影给出的合法集合里（够用即可：selfplay 的假 AI 只需要合法性）。 */
function isLegal(ctx: ProjectedContext, action: { type: string; target?: unknown }): boolean {
  if (!('target' in action) || action.target === undefined || action.target === null) return true;
  if (typeof action.target !== 'number') return true;
  if (action.type === 'WOLF_KILL' && ctx.knowledge.teammates.includes(action.target as never)) {
    return false;
  }
  return ctx.legalTargets.some((target) => target === action.target);
}

/**
 * 批量执行器（RFC-015 §2.2 / AC-1 / AC-5 / AC-9）。
 *
 * 串行跑（不做并发：并发让成本与失败定位都变难）。每局用 `seed + N`（NFR-18），
 * 单局失败被隔离成一条记录，不终止整批。
 *
 * 它复用**真实的编排与引擎**，只把通道换成脚本实现——这样跑出来的数据才代表真实对局。
 */

export interface SelfplayOptions {
  games: number;
  seed: number;
  /** AI 席位的决策来源：生产传 `createLlmAgent`，测试传脚本替身。 */
  decide: (input: { gameId: string; seed: number }) => Decider;
  /** 玩家席位的策略随机源（默认 `Math.random`）。 */
  rng?: Rng;
  /** 单局步数上限（防止死循环）。 */
  maxSteps?: number;
  /** 每局结束回调（用于落盘）。 */
  onGame?: (outcome: GameOutcome, events: readonly EventEnvelope[]) => void | Promise<void>;
  /** 覆盖玩家输入（AC-6 测试用：注入非法目标）。 */
  playerInput?: (ctx: ProjectedContext) => { kind: 'speak'; text: string } | { kind: 'skip' };
  /** 是否把假 AI 的非法目标替换成合法行动（默认 true；AC-6 测试可关掉）。 */
  sanitizeActions?: boolean;
  /** 强制抛错的注入点（AC-5 测试用）。 */
  beforeGame?: (input: { seed: number }) => void;
  now?: () => number;
}

export async function runSelfplay(options: SelfplayOptions): Promise<GameOutcome[]> {
  const outcomes: GameOutcome[] = [];

  for (let index = 0; index < options.games; index += 1) {
    const seed = options.seed + index;
    // 每局一个由 seed 派生的确定性随机源：同 seed 的批次必须完全可复现（C-188 / DATA-5）。
    const rng = options.rng ?? mulberry32(seed);
    const startedAt = (options.now ?? Date.now)();
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed,
      playerSeat: 1,
    });

    try {
      options.beforeGame?.({ seed });

      const input: InputChannel = {
        async read(prompt) {
          // 脚本玩家只从投影给的合法目标里挑；这里拿到的是最新视图。
          const latest = (await registry.getGame(record.gameId)) ?? record;
          const pending = prompt.kind === 'vote' ? 'vote' : 'speak';
          const ctx: ProjectedContext = {
            ...(await import('../project')).project({
              state: registry.stateOf(latest),
              events: latest.events,
              observer: record.playerSeat,
              pending,
            }),
          };
          if (options.playerInput !== undefined) return options.playerInput(ctx);

          const action = scriptedPlayerAction(ctx, { rng });
          if (action === undefined) return { kind: 'skip' };
          if (action.type === 'SPEECH_SKIP') return { kind: 'skip' };
          if (action.type === 'VOTE') {
            // 编排层把投票目标放在同一个 `text` 字段里（空 → 弃权）。
            return action.target === 'abstain'
              ? { kind: 'skip' }
              : { kind: 'speak', text: String(action.target) };
          }
          return { kind: 'skip' };
        },
        close() {},
      };

      const result = await runGame({
        registry,
        session,
        gameId: record.gameId,
        input,
        output: { emit() {}, async flush() {} },
        decide: async ({ seat, ctx, phase }) => {
          // 默认策略保证合法；传入了 `decide` 就用它（生产是 LLM）。
          const custom = options.decide({ gameId: record.gameId, seed });
          const decision = await custom({ seat, ctx, phase });
          const action = decision.action;
          // 假 AI 可能挑到引擎会拒的目标（例如刀队友）；selfplay 要跑完整批，
          // 所以这里把不合法的选择换成合法回退，而不是让它中断整批。
          if (
            action === undefined ||
            (options.sanitizeActions !== false && !isLegal(ctx, action))
          ) {
            return { ...decision, action: legalActionFor(ctx, rng) };
          }
          return decision;
        },
        ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
      });

      const finished = result.record;
      const ended = finished.events.find((event) => event.type === 'GAME_ENDED');

      // 没有终局事件 = 被某次拒绝挡下来了；被拒的是玩家侧动作就是实现缺陷（AC-6）。
      if (ended === undefined) {
        const rejected = finished.events.filter((event) => event.type === 'REJECTED');
        const last = rejected[rejected.length - 1]?.payload as
          { actionType?: string; code?: string; message?: string } | undefined;
        const playerActionType =
          last?.actionType !== undefined &&
          ['SPEECH', 'SPEECH_SKIP', 'VOTE', 'SELF_EXPOSE'].includes(last.actionType);
        outcomes.push({
          seed,
          ok: false,
          events: finished.events.length,
          durationMs: (options.now ?? Date.now)() - startedAt,
          usage: usageOf(record.gameId),
          failure: {
            seed,
            kind: playerActionType ? 'implementation' : 'model',
            error: `${last?.code ?? 'UNFINISHED'}：${last?.message ?? '对局没有结束'}`,
          },
        });
        await report(options, outcomes[outcomes.length - 1] as GameOutcome, finished.events);
        continue;
      }

      // 即便成局，也要检查有没有「玩家侧动作被拒」——那是实现缺陷（C-184 / AC-6）。
      const playerRejection = classifyFinished(finished.events, record.playerSeat);
      if (playerRejection !== null) {
        outcomes.push({
          seed,
          ok: false,
          events: finished.events.length,
          durationMs: (options.now ?? Date.now)() - startedAt,
          usage: usageOf(record.gameId),
          failure: { seed, ...playerRejection },
        });
        await report(options, outcomes[outcomes.length - 1] as GameOutcome, finished.events);
        continue;
      }

      const usage = usageOf(record.gameId);

      outcomes.push({
        seed,
        ok: true,
        events: finished.events.length,
        durationMs: (options.now ?? Date.now)() - startedAt,
        result: (ended?.payload as { result: 'wolf' | 'good' } | undefined)?.result ?? 'good',
        degraded: finished.events.filter((event) => event.type === 'DEGRADED').length,
        usage,
      });
      await report(options, outcomes[outcomes.length - 1] as GameOutcome, finished.events);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // 非法行动是**我们的 bug**，不是模型失败（AC-6）。
      // 编排层把「引擎拒绝动作」抛成 `动作被拒绝：CODE`：那是实现缺陷（AC-6）。
      const implementation = /动作被拒绝|INVALID_|非法|NOT_YOUR_TURN|RULE_|TARGET_NOT_ALIVE/.test(
        message,
      );
      outcomes.push({
        seed,
        ok: false,
        events: 0,
        durationMs: (options.now ?? Date.now)() - startedAt,
        usage: usageOf(record.gameId),
        failure: {
          seed,
          kind: implementation ? 'implementation' : 'model',
          error: message,
          errorType: cause instanceof Error ? cause.name : typeof cause,
        },
      });
      await report(options, outcomes[outcomes.length - 1] as GameOutcome, []);
    }
  }

  return outcomes;
}

/**
 * 落盘回调必须**永不终止整批**：写盘失败（磁盘满、权限）记为一条报告失败，
 * 但不影响后续对局（C-187）。
 */
async function report(
  options: SelfplayOptions,
  outcome: GameOutcome,
  events: readonly EventEnvelope[],
): Promise<void> {
  if (options.onGame === undefined) return;
  try {
    await options.onGame(outcome, events);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    outcome.failure = { seed: outcome.seed, kind: 'model', error: `REPORT_FAILED：${message}` };
    outcome.ok = false;
  }
}

/**
 * 找出「玩家自己的动作被引擎拒绝」的事件（AC-6）。
 *
 * `REJECTED` 的 payload 不带席位，席位只在 `visibleTo` 的 `self:N` 上（`reject.ts`）。
 * 这类拒绝是**实现缺陷**：脚本玩家只该从 `legalTargets` 里挑。
 */
export function findPlayerRejection(
  events: readonly EventEnvelope[],
  playerSeat: number,
): EventEnvelope | undefined {
  return events.find((event) => {
    if (event.type !== 'REJECTED') return false;
    const payload = event.payload as { actionType?: string };
    return (
      event.visibleTo === `self:${playerSeat}` &&
      payload.actionType !== undefined &&
      ['SPEECH', 'SPEECH_SKIP', 'VOTE', 'SELF_EXPOSE'].includes(payload.actionType)
    );
  });
}

/**
 * 成局之后的归类（AC-6）：玩家动作被拒 = 实现缺陷。
 *
 * 单拎出来是为了能用「真实完成局 + 人为注入的 REJECTED」测这条路径——真正的玩家
 * 输入通道在服务端会截断/归一化，很难从端到端制造一次拒绝。
 */
export function classifyFinished(
  events: readonly EventEnvelope[],
  playerSeat: number,
): { kind: 'implementation'; error: string } | null {
  const rejected = findPlayerRejection(events, playerSeat);
  if (rejected === undefined) return null;
  const payload = rejected.payload as { code?: string; message?: string };
  return {
    kind: 'implementation',
    error: `${payload.code ?? 'REJECTED'}：${payload.message ?? '玩家动作被拒'}`,
  };
}
