import type { Action } from '@shared/actions';
import type { GameState, SeatId } from '@shared/domain';

import { applyEffects } from '../effects';
import { aliveSeats, isAlive, seatAt } from '../queries';
import { rejectionDraft } from '../reject';
import { DEATH_APPLIERS, resolveNight } from '../resolve/deaths';
import { nextInt } from '../rng';
import type { ActionHandlerFor, EventDraft } from '../step';
import { checkWin } from '../win';
import { nightParamsOf } from './night';
import {
  nextSheriffFinalSpeaker,
  sheriffFinalSpeechDraft,
  sheriffSeatOf,
  sheriffSpeechDraft,
} from './sheriff';
import { enterNight } from './vote';
import { phaseChangedDraft } from './visibility';

/**
 * 白天：天亮、发言与归票（RFC-004 §2.1 / §2.2，RFC-022 §3.2）。
 *
 * `DAY_ANNOUNCE` 是**自动阶段**——它没有 action 可提交，由 `step` 的自动循环推进。
 *
 * 首夜与之后的夜晚不同（RFC-022 §13.1）：首夜死亡在 `NIGHT_RESOLVE` 只计算、不落地，
 * 竞选结束进入 `DAY_ANNOUNCE` 时才产出 `PLAYER_DIED` 并公布。于是竞选期间投影里的
 * `aliveSeats` 仍是 9 人，死讯不可能提前泄漏。
 *
 * 发言起点的**确定性**是这一节唯一的难点：若每次现抽，`replay` 就重建不出同一个起点，
 * 「同 seed 同结果」也随之失效。所以随机只在 `DAY_STARTED` 的入口抽一次，结果**写进 payload**
 * 与 `rngAfter`，之后所有阶段只读 `DAY_STARTED.speechStartSeat`；有警长时再由
 * `SHERIFF_ORDER_CHOSEN` 覆盖。
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
 * - 昨夜有死者 → 取**座位最小的死者**的下一位存活席位（不吃结算顺序，C-31）；
 * - 昨夜无死者 → 用 `state.rng` 在存活席位中抽一个。
 */
export function speechStartOf(state: GameState): { seat: SeatId; rng: GameState['rng'] } {
  const deaths = state.pendingDeaths ?? [];

  if (deaths.length > 0) {
    // 取**座位最小**的死者，而不是结算顺序的第一位（C-31）：结算顺序是「狼刀先、毒药后」，
    // 用它当起点等于把死因漏给全场。
    const first = deaths.reduce((min, seat) => (seat < min ? seat : min));
    return { seat: nextAliveSeat(state, first), rng: state.rng };
  }

  const alive = aliveSeats(state);
  const drawn = nextInt(state.rng, alive.length);
  const ordered = [...alive].sort((a, b) => a.seat - b.seat);

  return { seat: (ordered[drawn.value] as { seat: SeatId }).seat, rng: drawn.rng };
}

/**
 * `DAY_ANNOUNCE` 的自动推进。
 *
 * 首夜在此处才把 `NIGHT_RESOLVE` 算出的死亡落成 `PLAYER_DIED` 事件；之后：
 * 先判胜负（RUL-1），再按「开枪 → 警徽移交 → 警长定序 / 直接发言」的次序推进，
 * 与 RFC-022 §2 的流程图逐行对应。
 */
export function dayAnnounceEntry(state: GameState): EventDraft[] {
  // `pendingDeaths` 非空说明死亡已经由旧事件流（RFC-022 之前的首夜）在 `NIGHT_RESOLVE`
  // 落地过；此时不能再从 `state.night` 重算一遍，否则会产出重复的 `PLAYER_DIED`。
  const deathsAlreadyApplied = (state.pendingDeaths ?? []).length > 0;
  const firstNight = state.day === 1 && state.dayAnnounced !== true && !deathsAlreadyApplied;
  const drafts: EventDraft[] = [];
  let afterDeaths: GameState = state;
  let hunterKilledByWolf = false;
  const deferredDeaths: EventDraft[] = [];

  if (firstNight) {
    const resolution = resolveNight(nightParamsOf(state));
    for (const death of resolution.deaths) {
      deferredDeaths.push({
        type: 'PLAYER_DIED',
        // 死因仍不公开：公开的死讯由 `DAY_STARTED.diedLastNight` 承担（没有 cause）。
        visibleTo: 'server',
        payload: { seat: death.seat, cause: death.cause },
      });
    }
    afterDeaths = applyEffects(state, resolution.effects, DEATH_APPLIERS);
    // `resolveNight` 的顺序就是结算顺序；`DAY_STARTED` 会重新按座位排序（C-31）。
    afterDeaths = { ...afterDeaths, pendingDeaths: resolution.deaths.map((death) => death.seat) };
    hunterKilledByWolf = resolution.deaths.some(
      (death) => death.cause === 'wolf' && seatAt(state, death.seat).role === 'hunter',
    );
  }

  const { seat, rng } = speechStartOf(afterDeaths);
  drafts.push({
    type: 'DAY_STARTED',
    visibleTo: 'public',
    payload: {
      day: state.day,
      // 按座位升序：公开的死讯不得携带死因顺序（C-31 / FR-9）。真实牌桌也是按号码报死者。
      diedLastNight: [...(afterDeaths.pendingDeaths ?? [])].sort((a, b) => a - b),
      speechStartSeat: seat,
    },
    // 即使在「有死者、不抽随机数」的分支里也要带上——否则 `replay` 无法判断这次转移
    // 是否动了生成器（`DAY_STARTED` 是随机消耗事件，见 `apply.ts`）。
    rngAfter: rng,
  });
  // 先公布死讯、再落下死亡事件：`buildTruth` 以 `DAY_STARTED.day` 作为当天天数，
  // 反过来会把首夜死者记成第 0 天。`PLAYER_DIED` 是 server 可见的，公开顺序不受影响。
  drafts.push(...deferredDeaths);

  // 首夜死亡延后落地，胜负也延后到此刻（RFC-022 §13.1）。
  if (firstNight) {
    const win = checkWin(afterDeaths);
    if (win !== null) {
      drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
      return drafts;
    }
  }

  // 竞选期自曝：本局无警长；仍先公布死讯、处理开枪，然后入夜（RFC-022 §2.2）。
  if (state.sheriffElectionFailure === 'self-exposed') {
    if (firstNight && hunterKilledByWolf) {
      drafts.push(phaseChangedDraft('DAY_ANNOUNCE', 'NIGHT_HUNTER_SHOOT'));
    } else {
      drafts.push(...enterNight('DAY_ANNOUNCE'));
    }
    return drafts;
  }

  // 首夜该身份被刀：死讯公布之后才开枪（用户裁决，RFC-022 §11）。
  if (firstNight && hunterKilledByWolf) {
    drafts.push(phaseChangedDraft('DAY_ANNOUNCE', 'NIGHT_HUNTER_SHOOT'));
    return drafts;
  }

  const sheriff = sheriffSeatOf(state);
  if (sheriff !== null && !isAlive(afterDeaths, sheriff)) {
    drafts.push(phaseChangedDraft('DAY_ANNOUNCE', 'DAY_BADGE_TRANSFER'));
    return drafts;
  }
  if (sheriff !== null) {
    drafts.push(phaseChangedDraft('DAY_ANNOUNCE', 'DAY_SHERIFF_ORDER'));
    return drafts;
  }
  drafts.push(phaseChangedDraft('DAY_ANNOUNCE', 'DAY_SPEECH'));
  return drafts;
}

/**
 * 当天的发言序列。
 *
 * - `DAY_SPEECH`：从 `startSeat` 起按 `speechDirection` 遍历全部存活席位；
 * - `DAY_PK_SPEECH`：只有并列者，按座位升序；
 * - `DAY_SHERIFF_SPEECH` / `DAY_SHERIFF_PK`：警上候选人 / 平票者，按座位升序；
 * - `DAY_SHERIFF_FINAL_SPEECH`：只有警长。
 *
 * 这是**读状态算出来的**，不另存一份队列——队列是派生数据，存两份迟早不一致。
 */
export function speechOrder(state: GameState): SeatId[] {
  if (state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK') {
    const eligible =
      state.phase === 'DAY_SHERIFF_PK'
        ? (state.sheriffRunoff ?? [])
        : (state.sheriffCandidates ?? []);
    return [...eligible].sort((a, b) => a - b);
  }

  if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    const sheriff = sheriffSeatOf(state);
    return sheriff !== null && isAlive(state, sheriff) ? [sheriff] : [];
  }

  const speech = state.speech;
  if (speech === undefined) return [];

  // PK 发言只有并列者参与，不是全场。
  const base =
    state.phase === 'DAY_PK_SPEECH' && state.runoff !== undefined
      ? aliveSeats(state)
          .filter((seat) => (state.runoff ?? []).includes(seat.seat))
          .sort((a, b) => a.seat - b.seat)
          .map((seat) => seat.seat)
      : aliveSeats(state)
          .sort((a, b) => a.seat - b.seat)
          .map((seat) => seat.seat);

  const pivot = base.findIndex((seat) => seat === speech.startSeat);
  const rotated = pivot === -1 ? base : [...base.slice(pivot), ...base.slice(0, pivot)];

  if (state.phase === 'DAY_SPEECH' && state.speechDirection === 'counterclockwise') {
    const first = rotated[0];
    if (first === undefined) return [];
    return [first, ...rotated.slice(1).reverse()];
  }

  return rotated;
}

/** 下一位该发言的席位；全部说过则为 `undefined`。 */
export function currentSpeaker(state: GameState): SeatId | undefined {
  if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    return nextSheriffFinalSpeaker(state);
  }

  const spoken =
    state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK'
      ? (state.sheriffSpeech?.spoken ?? [])
      : (state.speech?.spoken ?? []);

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

/** 所有人的发言/跳过都结束后推进到投票（有警长则先做一次归票发言）。 */
function advanceIfDone(state: GameState, spokenAfter: readonly SeatId[]): EventDraft[] {
  const remaining = speechOrder(state).filter((seat) => !spokenAfter.includes(seat));
  if (remaining.length > 0) return [];

  if (state.phase === 'DAY_PK_SPEECH') {
    return [phaseChangedDraft('DAY_PK_SPEECH', 'DAY_VOTE_RUNOFF')];
  }

  const sheriff = sheriffSeatOf(state);
  if (sheriff !== null && isAlive(state, sheriff)) {
    return [phaseChangedDraft('DAY_SPEECH', 'DAY_SHERIFF_FINAL_SPEECH')];
  }
  return [phaseChangedDraft('DAY_SPEECH', 'DAY_VOTE')];
}

/** `SPEECH`：白天轮转 / 警上竞选 / PK / 警长归票四类发言共用一个 action。 */
const speech: ActionHandlerFor<'SPEECH'> = (state, action) => {
  if (state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK') {
    return sheriffSpeechDraft(state, action);
  }
  if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    return sheriffFinalSpeechDraft(state, action);
  }

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

/** `SPEECH_SKIP`：与 `SPEECH` 同一套发言顺序，只是不产出文本。 */
const skipSpeech: ActionHandlerFor<'SPEECH_SKIP'> = (state, action) => {
  if (state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK') {
    return sheriffSpeechDraft(state, action);
  }
  if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    return sheriffFinalSpeechDraft(state, action);
  }

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
