import type { GameState, Phase, SeatId } from '@shared/domain';

import { aliveSeats, isAlive } from '../queries';
import { rejectionDraft } from '../reject';
import type { ActionHandlerFor, EventDraft } from '../step';
import { phaseChangedDraft } from './visibility';

/**
 * 白天投票与结算（RFC-004 §2.3）。
 *
 * 三条要点：
 *
 * 1. **每张票是私有事件**（`visibleTo: 'self:<seat>'`）——公布之前谁都不知道别人投了谁，
 *    这是真实规则的「暗投」，也是 AC-5。结算时才用一条公开的 `VOTE_REVEALED` 把票型摊开。
 * 2. **结算点 `VOTE_RESOLVE` 不是 Phase**（C-19）：它发生在 `DAY_VOTE` 内部。
 * 3. 平票的处置由 RUL-2（重投选项集仅并列者）与 RUL-9（再平票则当日无人出局、直接入夜）决定。
 */

export type Ballot = readonly { seat: SeatId; target: SeatId | 'abstain' }[];

/** 票型统计：只数有效票（弃权不计），按票数降序、同票按座位升序。 */
export function tallyOf(votes: Ballot): { target: SeatId; count: number }[] {
  const counts = new Map<SeatId, number>();

  for (const vote of votes) {
    if (vote.target === 'abstain') continue;
    counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => (a.count === b.count ? a.target - b.target : b.count - a.count));
}

/** 投票结果的三分类（唯一最高 / 并列 / 无人得票）。 */
export type VoteOutcome =
  { kind: 'lynch'; target: SeatId } | { kind: 'runoff'; tied: SeatId[] } | { kind: 'none' };

/** 由票型决定下一步。并列是「票数最高的有多人」，不是「所有票数相等」。 */
export function outcomeOf(votes: Ballot): VoteOutcome {
  const tally = tallyOf(votes);
  const top = tally[0];

  if (top === undefined) return { kind: 'none' };

  const tied = tally.filter((entry) => entry.count === top.count).map((entry) => entry.target);
  return tied.length === 1 ? { kind: 'lynch', target: top.target } : { kind: 'runoff', tied };
}

/** 还没投票的存活席位。 */
export function pendingVoters(state: GameState): SeatId[] {
  const cast = new Set((state.votes ?? []).map((vote) => vote.seat));
  return aliveSeats(state)
    .map((seat) => seat.seat)
    .filter((seat) => !cast.has(seat));
}

/** 投票阶段或重投阶段的拒绝构造。 */
function voteRejection(
  action: Parameters<ActionHandlerFor<'VOTE'>>[1],
  code: string,
  message: string,
) {
  return rejectionDraft({ action, code, message, seat: action.seat });
}

/** 校验投票人：活着、且没投过。 */
function voterProblem(
  state: GameState,
  action: Parameters<ActionHandlerFor<'VOTE'>>[1],
): EventDraft | undefined {
  if (!isAlive(state, action.seat)) {
    return voteRejection(action, 'NOT_YOUR_TURN', `座位 ${action.seat} 已出局，不能投票`);
  }
  if ((state.votes ?? []).some((vote) => vote.seat === action.seat)) {
    return voteRejection(action, 'ALREADY_VOTED', `座位 ${action.seat} 本轮已经投过票`);
  }
  return undefined;
}

/** 进入下一夜。 */
export function enterNight(from: Phase): EventDraft[] {
  // 只发一条：进入 `NIGHT_WOLF_CHAT` 后由狼队夜聊推进到 `NIGHT_WOLVES`（RFC-005）。
  // 这个阶段还负责 `day++`、清空本夜暂存与昨夜死者。
  return [phaseChangedDraft(from, 'NIGHT_WOLF_CHAT')];
}

/** 投票结算：公布票型，然后决定去向。 */
function settle(from: Phase, state: GameState, votes: Ballot): EventDraft[] {
  const drafts: EventDraft[] = [
    { type: 'VOTE_REVEALED', visibleTo: 'public', payload: { votes: [...votes] } },
  ];

  const outcome = outcomeOf(votes);

  if (outcome.kind === 'lynch') {
    drafts.push(phaseChangedDraft(from, 'DAY_LYNCH'));
    return drafts;
  }

  if (outcome.kind === 'none') {
    // 全员弃权（或无人得分）：当日无人出局，直接进入下一夜（RUL-7 / RFC-004 §2.3）。
    drafts.push(...enterNight(from));
    return drafts;
  }

  // 并列：首轮进入重投；重投再并列则当日无人出局（RUL-9）。
  if (from === 'DAY_VOTE_RUNOFF') {
    drafts.push(...enterNight(from));
    return drafts;
  }

  drafts.push(phaseChangedDraft(from, 'DAY_VOTE_RUNOFF'));
  return drafts;
}

/** `VOTE`（`DAY_VOTE` 与 `DAY_VOTE_RUNOFF` 两个阶段共用）。 */
const vote: ActionHandlerFor<'VOTE'> = (state, action) => {
  const problem = voterProblem(state, action);
  if (problem !== undefined) return [problem];

  if (state.phase === 'DAY_VOTE_RUNOFF') {
    // RUL-2：重投只能投并列者本身——弃权与投他人都不行。
    const tied = state.runoff ?? [];
    if (action.target === 'abstain' || !tied.includes(action.target)) {
      return [
        voteRejection(
          action,
          'INVALID_RUNOFF_TARGET',
          `重投只能投并列者（${tied.join(', ')}），收到 ${String(action.target)}`,
        ),
      ];
    }
  } else if (action.target !== 'abstain' && !isAlive(state, action.target)) {
    return [voteRejection(action, 'TARGET_NOT_ALIVE', `座位 ${action.target} 已出局，不能投`)];
  }

  const votes: Ballot = [...(state.votes ?? []), { seat: action.seat, target: action.target }];

  const cast: EventDraft = {
    type: 'VOTE_CAST',
    visibleTo: `self:${action.seat}`,
    payload: { seat: action.seat, target: action.target },
  };

  // 结算时机：这一票之后没有待投的人了。
  const remaining = aliveSeats(state)
    .map((seat) => seat.seat)
    .filter((seat) => !votes.some((entry) => entry.seat === seat));

  return remaining.length === 0 ? [cast, ...settle(state.phase, state, votes)] : [cast];
};

export const VOTE_HANDLERS = { VOTE: vote } as const;
