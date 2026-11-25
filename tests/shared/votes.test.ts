import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import {
  countVotes,
  formatHalfVotes,
  halfVotesForVoter,
  NORMAL_HALF_VOTES,
  SHERIFF_HALF_VOTES,
  tallyCountedVotes,
} from '@shared/votes';

/**
 * RFC-022 §3.1 / §13.4：警长 1.5 票的唯一实现。
 *
 * 这些断言钉死三件事：权重是整数半票、平票按半票判、展示层才出现小数。
 */

describe('RFC-022 · 半票权重', () => {
  it('普通票 2 个半票单位，警长票 3 个', () => {
    expect(NORMAL_HALF_VOTES).toBe(2);
    expect(SHERIFF_HALF_VOTES).toBe(3);
    expect(halfVotesForVoter(3 as SeatId, null)).toBe(2);
    expect(halfVotesForVoter(3 as SeatId, 3 as SeatId)).toBe(3);
    expect(halfVotesForVoter(4 as SeatId, 3 as SeatId)).toBe(2);
  });

  it('countVotes 为每张原始票保留目标与权重；弃权也保留权重供审计', () => {
    const counted = countVotes(
      [
        { seat: 1 as SeatId, target: 5 as SeatId },
        { seat: 2 as SeatId, target: 'abstain' },
      ],
      1 as SeatId,
    );

    expect(counted).toEqual([
      { seat: 1, target: 5, halfVotes: 3 },
      { seat: 2, target: 'abstain', halfVotes: 2 },
    ]);
  });

  it('tallyCountedVotes 跳过弃权，按半票降序、同票按座位升序', () => {
    const tally = tallyCountedVotes([
      { seat: 1 as SeatId, target: 7 as SeatId, halfVotes: 2 },
      { seat: 2 as SeatId, target: 7 as SeatId, halfVotes: 3 },
      { seat: 3 as SeatId, target: 8 as SeatId, halfVotes: 2 },
      { seat: 4 as SeatId, target: 8 as SeatId, halfVotes: 2 },
      { seat: 5 as SeatId, target: 'abstain', halfVotes: 2 },
    ]);

    expect(tally).toEqual([
      { target: 7, votes: 2, halfVotes: 5 },
      { target: 8, votes: 2, halfVotes: 4 },
    ]);
  });

  it('formatHalfVotes 只在展示层转小数：3 → 1.5，5 → 2.5，4 → 2', () => {
    expect(formatHalfVotes(3)).toBe('1.5');
    expect(formatHalfVotes(4)).toBe('2');
    expect(formatHalfVotes(5)).toBe('2.5');
  });
});
