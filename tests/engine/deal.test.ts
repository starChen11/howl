import { describe, expect, it } from 'vitest';

import type { Role } from '@shared/domain';

import { DECK, dealRoles } from '@engine/deal';
import { createInitialState } from '@engine/init';

import { lobbyState } from '../fixtures/states';

/**
 * AC-1 / AC-2 / AC-3：发牌（F1，RFC-003 §2.1）。
 *
 * 统计类断言只用**固定种子集合**，不用随机或卡方检验——否则测试会随机失败，违反 TEST-1。
 */

/** 50 个固定种子。数值任意，关键是它们固定。 */
const SEEDS = Array.from({ length: 50 }, (_unused, index) => 1000 + index * 37);

function countRoles(roles: readonly Role[]): Record<Role, number> {
  const counts: Record<Role, number> = { wolf: 0, seer: 0, witch: 0, hunter: 0, villager: 0 };
  for (const role of roles) counts[role] += 1;
  return counts;
}

describe('AC-1 · 每个种子都发出合法板子', () => {
  it('50 个固定种子各自恰好是 3 wolf / 1 seer / 1 witch / 1 hunter / 3 villager', () => {
    for (const seed of SEEDS) {
      const roles = lobbyState({ seed }).seats.map((seat) => seat.role);

      expect(countRoles(roles), `seed=${seed}`).toEqual({
        wolf: 3,
        seer: 1,
        witch: 1,
        hunter: 1,
        villager: 3,
      });
      expect(roles).toHaveLength(9);
    }
  });

  it('板子本身是 9 张', () => {
    expect(DECK).toHaveLength(9);
  });
});

describe('AC-2 · 同种子可复现，且发牌结果进事件', () => {
  it('同一 seed 两次发牌完全一致', () => {
    const first = dealRoles(424_242);
    const second = dealRoles(424_242);

    expect(second.roles).toEqual(first.roles);
    expect(second.rng).toEqual(first.rng);
  });

  it('不同 seed 得到不同排列（证明 seed 真的在用）', () => {
    expect(dealRoles(1).roles).not.toEqual(dealRoles(2).roles);
  });

  it('座位角色由发牌决定（与 dealRoles 同源；payload 的校验在 events.test.ts）', () => {
    const lobby = lobbyState({ seed: 777 });

    expect(lobby.seats.map((seat) => seat.role)).toEqual(dealRoles(777).roles);
  });
});

describe('AC-3 · 玩家席位不优待（FR-2 / F17）', () => {
  it('50 个固定种子里，玩家席位拿到过狼 / 神 / 民三类各至少一次', () => {
    const categories = new Set<'wolf' | 'god' | 'villager'>();

    for (const seed of SEEDS) {
      const state = createInitialState({
        gameId: 'g',
        seed,
        mode: 'slaughter-side',
        playerSeat: 5,
      });
      const playerSeat = state.seats.find((seat) => seat.isPlayer);
      if (playerSeat === undefined) throw new Error('没有玩家席位');

      if (playerSeat.role === 'wolf') categories.add('wolf');
      else if (playerSeat.role === 'villager') categories.add('villager');
      else categories.add('god');
    }

    expect([...categories].sort()).toEqual(['god', 'villager', 'wolf']);
  });

  it('玩家席位永远是构造时指定的那个', () => {
    for (const playerSeat of [1, 5, 9] as const) {
      const state = createInitialState({
        gameId: 'g',
        seed: 99,
        mode: 'slaughter-side',
        playerSeat,
      });

      expect(state.seats.filter((seat) => seat.isPlayer).map((seat) => seat.seat)).toEqual([
        playerSeat,
      ]);
    }
  });
});
