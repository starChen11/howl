import { describe, expect, it } from 'vitest';

import { isVisibleTo } from '@shared/visibility';

import { project } from '@server/project';

import { nightStart, roleSeat } from '../fixtures/night';

/**
 * RUL-13 / RFC-017 AC-6：狼队投票只对狼可见。
 *
 * 好人不仅看不到票型，连「现在在投狼票」都不该知道。
 */

describe('RUL-13 · 狼队投票的可见性', () => {
  it('WOLF_VOTE_* 只对狼可见；好人的投影里没有狼队投票信息', () => {
    const state = nightStart();
    const wolf = roleSeat(state, 'wolf');
    const villager = state.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
    if (villager === undefined) throw new Error('夹具缺少村民');

    const cast = {
      gameId: state.gameId,
      seq: 1,
      ts: 0,
      type: 'WOLF_VOTE_CAST',
      visibleTo: 'wolves',
      payload: { seat: wolf, target: villager },
    } as never;

    expect(isVisibleTo(cast, wolf, state)).toBe(true);
    expect(isVisibleTo(cast, villager, state)).toBe(false);

    // 好人即使拿到狼票的投影也没有任何开票状态
    const goodView = project({
      state,
      events: [],
      observer: villager,
      pending: null,
    });
    expect(goodView.privateEvents.some((event) => event.type.startsWith('WOLF_VOTE'))).toBe(false);
    expect(goodView.wolfVoteOpen).toBeUndefined();
    expect(goodView.wolfCandidates).toBeUndefined();
  });

  it('狼队投票的候选不含狼与死人；重投只含并列者', () => {
    const state = nightStart();
    const wolf = roleSeat(state, 'wolf');

    const open = project({ state, events: [], observer: wolf, pending: 'wolf-vote' });
    for (const candidate of open.wolfCandidates ?? []) {
      const seat = state.seats.find((entry) => entry.seat === candidate);
      expect(seat?.alive).toBe(true);
      expect(seat?.role).not.toBe('wolf');
    }

    const runoffState = {
      ...state,
      phase: 'NIGHT_WOLF_RUNOFF' as const,
      wolfRunoff: [2, 3] as never,
    };
    expect(open.wolfVoteOpen).toBe(true);

    const runoff = project({
      state: runoffState,
      events: [],
      observer: wolf,
      pending: 'wolf-runoff',
    });
    expect(runoff.wolfCandidates).toEqual([2, 3]);
  });
});
