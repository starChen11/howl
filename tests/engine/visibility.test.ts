import { describe, expect, it } from 'vitest';

import type { GameState, SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';
import type { GameEvent } from '@shared/events';
import { isVisibleTo } from '@shared/visibility';

import { FIXTURE_ROLES, stateWithRoles } from '../fixtures/states';

/**
 * AC-1 ~ AC-4 / AC-14：可见性矩阵（RFC-005 §2.1）。
 *
 * 这是「AI 不作弊」的判据入口：`project()`（RFC-007）必须靠它把不该看的事件滤掉，
 * 所以这里按「事件类型 × 观察者 × 死亡时序」三维覆盖，而不是抽查两三个组合。
 */

function eventOf<T extends GameEvent['type']>(
  type: T,
  visibleTo: GameEvent['visibleTo'],
  seq = 10,
): GameEvent {
  return {
    gameId: 'g',
    seq,
    ts: 0,
    type,
    visibleTo,
    payload: {},
  } as unknown as GameEvent;
}

/** 让若干席位在 `diedSeq` 处出局的状态。 */
function stateWithDeaths(dead: readonly [SeatId, number][], roles = FIXTURE_ROLES): GameState {
  const base = stateWithRoles(roles, 'slaughter-side');
  return {
    ...base,
    seats: base.seats.map((seat) => {
      const found = dead.find(([id]) => id === seat.seat);
      return found === undefined ? seat : { ...seat, alive: false, diedSeq: found[1] };
    }),
  };
}

describe('AC-1 · public 对所有人可见', () => {
  it('9 个观察者全部返回 true', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const event = eventOf('GAME_ENDED', 'public');

    for (const observer of SEAT_IDS) {
      expect(isVisibleTo(event, observer, state), `observer=${observer}`).toBe(true);
    }
  });

  it('server 对所有人不可见', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const event = eventOf('PLAYER_DIED', 'server');

    for (const observer of SEAT_IDS) {
      expect(isVisibleTo(event, observer, state), `observer=${observer}`).toBe(false);
    }
  });
});

describe('AC-2 · wolves 事件：狼可见、好人不可见', () => {
  it('9 个观察者按阵营判定', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const event = eventOf('WOLF_CHAT_POSTED', 'wolves');

    for (const observer of SEAT_IDS) {
      const seat = state.seats.find((candidate) => candidate.seat === observer);
      const expected = seat?.role === 'wolf';
      expect(isVisibleTo(event, observer, state), `observer=${observer}`).toBe(expected);
    }
  });
});

describe('AC-3 · 死狼仍能看见狼队频道', () => {
  it('死在事件之前的狼仍然可见（用户裁决：队伍频道不因出局中断）', () => {
    // 1 号是 wolf（FIXTURE_ROLES），让它在 seq 5 出局；事件在 seq 10。
    const state = stateWithDeaths([[1, 5]]);
    const event = eventOf('WOLF_CHAT_POSTED', 'wolves', 10);

    expect(isVisibleTo(event, 1, state)).toBe(true);
  });

  it('活着的好人始终看不到', () => {
    const state = stateWithDeaths([[1, 5]]);
    const event = eventOf('WOLF_CHAT_POSTED', 'wolves', 10);

    // 4 号是 seer（好人）
    expect(isVisibleTo(event, 4, state)).toBe(false);
  });
});

describe('AC-4 · self:<n> 只对该席位可见', () => {
  it('恰好 1/9 可见', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const event = eventOf('VOTE_CAST', 'self:4');

    const visible = SEAT_IDS.filter((observer) => isVisibleTo(event, observer, state));
    expect(visible).toEqual([4]);
  });

  it('该席位出局后，自己投过的票仍然看得到（发生在死亡之前）', () => {
    const state = stateWithDeaths([[4, 20]]);
    const event = eventOf('VOTE_CAST', 'self:4', 10);

    expect(isVisibleTo(event, 4, state)).toBe(true);
  });

  it('该席位出局后，死亡之后的事件看不到（个人频道不延续）', () => {
    // diedSeq = 5，事件 seq = 10 → 事件发生在死亡之后
    const state = stateWithDeaths([[4, 5]]);
    const event = eventOf('VOTE_CAST', 'self:4', 10);

    expect(isVisibleTo(event, 4, state)).toBe(false);
  });
});

describe('AC-14 · 好人观察者对狼夜聊的过滤结果为空', () => {
  it('9 个观察者过滤后只剩狼', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const chats = [
      eventOf('WOLF_CHAT_POSTED', 'wolves', 10),
      eventOf('WOLF_CHAT_POSTED', 'wolves', 11),
    ];

    for (const observer of SEAT_IDS) {
      const visible = chats.filter((event) => isVisibleTo(event, observer, state));
      const isWolf = state.seats.find((seat) => seat.seat === observer)?.role === 'wolf';
      expect(visible.length, `observer=${observer}`).toBe(isWolf ? 2 : 0);
    }
  });
});
