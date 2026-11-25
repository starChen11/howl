import type { Action } from '@shared/actions';
import type { GameState } from '@shared/domain';
import type { GameEvent } from '@shared/events';

import {
  activeCandidatesOf,
  nextSheriffFinalSpeaker,
  nextSheriffSpeaker,
  pendingSheriffVoters,
  pendingSignups,
  pendingWithdrawals,
  sheriffSeatOf,
  sheriffOrderOptions,
} from '@engine/phases/sheriff';
import { step } from '@engine/step';
import type { GameRecord, GameRegistry, SessionRecord } from '@server/store/game-registry';

/**
 * RFC-022 的测试助手。
 *
 * 首日现在**必经竞选**（RFC-022 §13.1）：所有「跑到白天」的旧测试都要先走过这一关。
 * 这里提供两条等价路径：
 * - 引擎级 `step` 驱动（纯函数测试）；
 * - 注册表驱动（服务端集成测试）。
 *
 * 默认策略是「全员不上警」→ 本局无警长，从而保持 RFC-004 时代的测试语义（回退旧顺序）。
 */

export interface EngineRun {
  state: GameState;
  events: GameEvent[];
}

/** 让所有还没表态的席位选择「不上警」，把竞选推进到 `DAY_SHERIFF_RESULT`。 */
export function skipSheriffElection(state: GameState): EngineRun {
  let current = state;
  const events: GameEvent[] = [];

  for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_SIGNUP'; guard += 1) {
    const seat = pendingSignups(current)[0];
    if (seat === undefined) break;
    const result = step(current, { type: 'SHERIFF_SIGNUP', ts: 1, seat, run: false });
    current = result.state;
    events.push(...result.events);
  }

  return { state: current, events };
}

/** 注册表版本：全员不上警，返回竞选结束后的记录。 */
export async function skipSheriffElectionInRegistry(
  registry: GameRegistry,
  session: SessionRecord,
  record: GameRecord,
): Promise<GameRecord> {
  let current = record;

  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'DAY_SHERIFF_SIGNUP') break;
    const seat = pendingSignups(state)[0];
    if (seat === undefined) break;
    const result = await registry.submit(
      session,
      current,
      { type: 'SHERIFF_SIGNUP', ts: 1, seat, run: false } as never,
      state.seq,
    );
    if (!result.ok) throw new Error(`跳过竞选失败：${result.code}`);
    current = result.record;
  }

  return current;
}

/**
 * 当前警长相位的「合法默认动作」，给需要手动推进整局的测试用。
 *
 * 与 `orchestrator.defaultActionFor` 同一套超时语义（RFC-022 §13.5）；
 * 非警长相位返回 `undefined`，让调用方走自己的分支。
 */
export function sheriffActionFor(state: GameState): Action | undefined {
  switch (state.phase) {
    case 'DAY_SHERIFF_SIGNUP': {
      const seat = pendingSignups(state)[0];
      return seat === undefined ? undefined : { type: 'SHERIFF_SIGNUP', ts: 1, seat, run: false };
    }
    case 'DAY_SHERIFF_SPEECH':
    case 'DAY_SHERIFF_PK': {
      const seat = nextSheriffSpeaker(state);
      return seat === undefined ? undefined : { type: 'SPEECH_SKIP', ts: 1, seat };
    }
    case 'DAY_SHERIFF_WITHDRAW': {
      const seat = pendingWithdrawals(state)[0];
      return seat === undefined
        ? undefined
        : { type: 'SHERIFF_WITHDRAW', ts: 1, seat, withdraw: false };
    }
    case 'DAY_SHERIFF_VOTE':
    case 'DAY_SHERIFF_RUNOFF': {
      const seat = pendingSheriffVoters(state)[0];
      if (seat === undefined) return undefined;
      const candidates =
        state.phase === 'DAY_SHERIFF_RUNOFF'
          ? (state.sheriffRunoff ?? [])
          : activeCandidatesOf(state);
      const target = candidates[0];
      return {
        type: 'SHERIFF_VOTE',
        ts: 1,
        seat,
        target: target === undefined ? 'abstain' : target,
      };
    }
    case 'DAY_BADGE_TRANSFER': {
      const sheriff = sheriffSeatOf(state);
      if (sheriff === null) return undefined;
      return { type: 'BADGE_TRANSFER', ts: 1, seat: sheriff, target: 'tear' };
    }
    case 'DAY_SHERIFF_ORDER': {
      const sheriff = sheriffSeatOf(state);
      const option = sheriffOrderOptions(state)[0];
      if (sheriff === null || option === undefined) return undefined;
      return {
        type: 'SHERIFF_ORDER',
        ts: 1,
        seat: sheriff,
        startSeat: option.startSeat,
        direction: option.direction,
      };
    }
    case 'DAY_SHERIFF_FINAL_SPEECH': {
      const seat = nextSheriffFinalSpeaker(state);
      return seat === undefined ? undefined : { type: 'SPEECH_SKIP', ts: 1, seat };
    }
    default:
      return undefined;
  }
}

/** 当前是否处在 RFC-022 新增的交互相位。 */
export function isSheriffPhase(phase: string): boolean {
  return phase.startsWith('DAY_SHERIFF') || phase === 'DAY_BADGE_TRANSFER';
}
