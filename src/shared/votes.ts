import type { SeatId } from './domain';

/**
 * 放逐投票的折算票（RFC-022 §3.1 / §13.4）。
 *
 * **内部一律用半票整数**：普通玩家一票 = 2 个半票单位，警长一票 = 3 个（即 1.5 票）。
 * 浮点只允许出现在展示层，`formatHalfVotes` 是唯一把它转成小数的地方。
 */

export const NORMAL_HALF_VOTES = 2;
export const SHERIFF_HALF_VOTES = 3;

/** 某位投票者的票在计票时值多少个半票单位。 */
export function halfVotesForVoter(seat: SeatId, sheriffSeat: SeatId | null): number {
  return sheriffSeat !== null && seat === sheriffSeat ? SHERIFF_HALF_VOTES : NORMAL_HALF_VOTES;
}

/** 一张折算后的票：保留原始目标，同时记录它值多少半票。 */
export interface CountedVote {
  seat: SeatId;
  target: SeatId | 'abstain';
  halfVotes: number;
}

/**
 * 把原始票型折算成半票。
 *
 * 弃权也保留半票权重（审计时要能回答「他那一票值多少」）；汇总时由
 * `tallyCountedVotes` 跳过弃权。
 */
export function countVotes(
  votes: readonly { seat: SeatId; target: SeatId | 'abstain' }[],
  sheriffSeat: SeatId | null,
): CountedVote[] {
  return votes.map((vote) => ({
    seat: vote.seat,
    target: vote.target,
    halfVotes: halfVotesForVoter(vote.seat, sheriffSeat),
  }));
}

/** 折算后的汇总：每个目标拿到多少**原始票**、多少**半票**。 */
export interface CountedTallyEntry {
  target: SeatId;
  votes: number;
  halfVotes: number;
}

/**
 * 汇总折算票。排序：半票降序，同票按座位升序。
 *
 * 平票判定必须用 `halfVotes`（RFC-022 §3.1），不能回到原始票数。
 */
export function tallyCountedVotes(counted: readonly CountedVote[]): CountedTallyEntry[] {
  const counts = new Map<SeatId, { votes: number; halfVotes: number }>();

  for (const vote of counted) {
    if (vote.target === 'abstain') continue;
    const existing = counts.get(vote.target) ?? { votes: 0, halfVotes: 0 };
    counts.set(vote.target, {
      votes: existing.votes + 1,
      halfVotes: existing.halfVotes + vote.halfVotes,
    });
  }

  return [...counts.entries()]
    .map(([target, value]) => ({ target, votes: value.votes, halfVotes: value.halfVotes }))
    .sort((a, b) =>
      a.halfVotes === b.halfVotes ? a.target - b.target : b.halfVotes - a.halfVotes,
    );
}

/**
 * 票数的展示文案：`3` 表示 1.5 票、`5` 表示 2.5 票。
 *
 * 除法只发生在这里，且分母恒为 2，结果是精确的二进制小数（0.5 的整数倍）。
 */
export function formatHalfVotes(halfVotes: number): string {
  return (halfVotes / 2).toFixed(1).replace(/\.0$/, '');
}
