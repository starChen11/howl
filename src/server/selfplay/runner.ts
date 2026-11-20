import { GameRegistry } from '../store/game-registry';
import { InMemoryMetaStore } from '../store/meta-store';
import { runGame } from '../orchestrator';
import type { InputChannel } from '@shared/channels';
import type { EventEnvelope } from '@shared/events';
import type { ProjectedContext } from '@shared/project';
import type { Decider } from '../ai/agent';
import { usageOf } from '../llm/usage';
import { legalActionFor, scriptedPlayerAction, type Rng } from './scripted-player';
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
          const action = scriptedPlayerAction(
            ctx,
            options.rng === undefined ? {} : { rng: options.rng },
          );
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
            return { ...decision, action: legalActionFor(ctx, options.rng) };
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
          failure: {
            seed,
            kind: playerActionType ? 'implementation' : 'model',
            error: `${last?.code ?? 'UNFINISHED'}：${last?.message ?? '对局没有结束'}`,
          },
        });
        await options.onGame?.(outcomes[outcomes.length - 1] as GameOutcome, finished.events);
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
      await options.onGame?.(outcomes[outcomes.length - 1] as GameOutcome, finished.events);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // 非法行动是**我们的 bug**，不是模型失败（AC-6）。
      const implementation = /INVALID_|非法|NOT_YOUR_TURN|RULE_/.test(message);
      outcomes.push({
        seed,
        ok: false,
        events: 0,
        durationMs: (options.now ?? Date.now)() - startedAt,
        failure: {
          seed,
          kind: implementation ? 'implementation' : 'model',
          error: message,
        },
      });
      await options.onGame?.(outcomes[outcomes.length - 1] as GameOutcome, []);
    }
  }

  return outcomes;
}
