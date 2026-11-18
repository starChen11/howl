import type { Action } from '@shared/actions';
import type { GameState, SeatId } from '@shared/domain';

import { nextInt } from '../rng';
import { aliveSeats, isAlive } from '../queries';
import { rejectionDraft } from '../reject';
import type { ActionHandlerFor, EventDraft } from '../step';
import { phaseChangedDraft } from './visibility';

/**
 * 白天：天亮与发言（RFC-004 §2.1 / §2.2）。
 *
 * `DAY_ANNOUNCE` 是**自动阶段**——它没有 action 可提交，由 `step` 的自动循环推进：
 * 产出 `DAY_STARTED` 后立刻进入 `DAY_SPEECH`。
 *
 * 发言起点的**确定性**是这一节唯一的难点：若每次现抽，`replay` 就重建不出同一个起点，
 * 「同 seed 同结果」也随之失效。所以随机只在 `DAY_STARTED` 的入口抽一次，结果**写进 payload**
 * 与 `rngAfter`，之后所有阶段只读 `DAY_STARTED.speechStartSeat`。
 */

/** 顺时针找下一个存活席位（含自己，用于「只剩一人」的边界）。 */
function nextAliveSeat(state: GameState, from: SeatId): SeatId {
  const alive = aliveSeats(state);
  if (alive.length === 0) {
    throw new Error('没有存活席位，无法确定发言起点');
  }

  const ordered = [...alive].sort((a, b) => a.seat - b.seat);
  const after = ordered.find((seat) => seat.seat > from);

  // 绕回最小座位：顺时针是环，不是线。
  return (after ?? (ordered[0] as (typeof ordered)[number])).seat;
}

/**
 * 算出发言起点与（可能消耗后的）生成器状态。
 *
 * 规则（RFC-004 §2.1）：
 * - 昨夜有死者 → 取**结算顺序第一位**死者的下一位存活席位；
 * - 昨夜无死者 → 用 `state.rng` 在存活席位中抽一个。
 */
export function speechStartOf(state: GameState): { seat: SeatId; rng: GameState['rng'] } {
  const deaths = state.pendingDeaths ?? [];

  if (deaths.length > 0) {
    // 不消耗随机数：此时 rng 原样返回，`DAY_STARTED` 的 `rngAfter` 等于当前值。
    return { seat: nextAliveSeat(state, deaths[0] as SeatId), rng: state.rng };
  }

  const alive = aliveSeats(state);
  const drawn = nextInt(state.rng, alive.length);
  const ordered = [...alive].sort((a, b) => a.seat - b.seat);

  return { seat: (ordered[drawn.value] as { seat: SeatId }).seat, rng: drawn.rng };
}

/** `DAY_ANNOUNCE` 的自动推进：产出 `DAY_STARTED`，然后进入发言阶段。 */
export function dayAnnounceEntry(state: GameState): EventDraft[] {
  const { seat, rng } = speechStartOf(state);

  return [
    {
      type: 'DAY_STARTED',
      visibleTo: 'public',
      payload: {
        day: state.day,
        diedLastNight: [...(state.pendingDeaths ?? [])],
        speechStartSeat: seat,
      },
      // 即使在「有死者、不抽随机数」的分支里也要带上——否则 `replay` 无法判断这次转移
      // 是否动了生成器（`DAY_STARTED` 是随机消耗事件，见 `apply.ts`）。
      rngAfter: rng,
    },
    phaseChangedDraft('DAY_ANNOUNCE', 'DAY_SPEECH'),
  ];
}

/**
 * 当天的发言序列：从 `startSeat` 起顺时针遍历全部存活席位。
 *
 * 这是**读状态算出来的**，不另存一份队列——队列是派生数据，存两份迟早不一致。
 */
export function speechOrder(state: GameState): SeatId[] {
  const speech = state.speech;
  if (speech === undefined) return [];

  const ordered = [...aliveSeats(state)].sort((a, b) => a.seat - b.seat).map((seat) => seat.seat);
  const pivot = ordered.findIndex((seat) => seat >= speech.startSeat);
  const rotated = pivot === -1 ? ordered : [...ordered.slice(pivot), ...ordered.slice(0, pivot)];

  return rotated;
}

/** 下一位该发言的席位；全部说过则为 `undefined`。 */
export function currentSpeaker(state: GameState): SeatId | undefined {
  const spoken = state.speech?.spoken ?? [];
  return speechOrder(state).find((seat) => !spoken.includes(seat));
}

/** 发言人校验：阶段对、但提交者不是当前该说话的人。 */
function speakerRejection(state: GameState, action: Action, seat: SeatId) {
  const expected = currentSpeaker(state);
  return rejectionDraft({
    action,
    code: 'NOT_YOUR_TURN',
    message:
      expected === undefined
        ? `本日全员已发言，${seat} 不能再说`
        : `还没轮到席位 ${seat}，当前该 ${expected} 发言`,
    seat,
  });
}

/** 所有人的发言/跳过都结束后推进到投票。 */
function advanceIfDone(state: GameState, spokenAfter: readonly SeatId[]): EventDraft[] {
  const remaining = speechOrder(state).filter((seat) => !spokenAfter.includes(seat));
  return remaining.length === 0 ? [phaseChangedDraft('DAY_SPEECH', 'DAY_VOTE')] : [];
}

/** `SPEECH`（`DAY_SPEECH`）。 */
const speech: ActionHandlerFor<'SPEECH'> = (state, action) => {
  const expected = currentSpeaker(state);
  if (!isAlive(state, action.seat) || action.seat !== expected) {
    return [speakerRejection(state, action, action.seat)];
  }

  const after = [...(state.speech?.spoken ?? []), action.seat];
  return [
    { type: 'SPEECH', visibleTo: 'public', payload: { seat: action.seat, text: action.text } },
    ...advanceIfDone(state, after),
  ];
};

/** `SPEECH_SKIP`（`DAY_SPEECH`）。 */
const skipSpeech: ActionHandlerFor<'SPEECH_SKIP'> = (state, action) => {
  const expected = currentSpeaker(state);
  if (!isAlive(state, action.seat) || action.seat !== expected) {
    return [speakerRejection(state, action, action.seat)];
  }

  const after = [...(state.speech?.spoken ?? []), action.seat];
  return [
    { type: 'SPEECH_SKIPPED', visibleTo: 'public', payload: { seat: action.seat } },
    ...advanceIfDone(state, after),
  ];
};

/** RFC-004 交付的白天 handler 表（投票与放逐在 `vote.ts` / `lynch.ts`）。 */
export const DAY_HANDLERS = {
  SPEECH: speech,
  SPEECH_SKIP: skipSpeech,
} as const;
