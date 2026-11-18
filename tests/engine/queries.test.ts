import { describe, expect, it } from 'vitest';

import {
  aliveSeats,
  countAliveByFaction,
  findAliveByRole,
  findSeatsByRole,
  isAlive,
  seatAt,
  wolfSeats,
} from '@engine/queries';

import { FIXTURE_ROLES, stateWithRoles } from '../fixtures/states';

/**
 * RFC-003 §3 的只读查询。
 *
 * 这些函数是 RFC-007（投影）与 RFC-011（玩家视角）的公共基础设施，所以单独测：
 * 谁在用它之前，得先知道它的语义是「只数存活」还是「含已出局」。
 */

describe('queries · 存活与阵营', () => {
  const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [1, 4, 7] });

  it('aliveSeats 只返回存活席位，且按座位升序', () => {
    expect(aliveSeats(state).map((seat) => seat.seat)).toEqual([2, 3, 5, 6, 8, 9]);
  });

  it('countAliveByFaction 按阵营计数', () => {
    // 死掉 1（wolf）/ 4（seer）/ 7（villager）
    expect(countAliveByFaction(state)).toEqual({ wolf: 2, good: 4 });
  });

  it('wolfSeats 含已出局的狼', () => {
    expect(wolfSeats(state).map((seat) => seat.seat)).toEqual([1, 2, 3]);
  });
});

describe('queries · 按身份查找', () => {
  it('findAliveByRole 只找存活的', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [4] });

    expect(findAliveByRole(state, 'seer')).toBeUndefined();
    expect(findAliveByRole(state, 'witch')?.seat).toBe(5);
  });

  it('findSeatsByRole 含已出局的', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [4] });

    expect(findSeatsByRole(state, 'seer').map((seat) => seat.seat)).toEqual([4]);
  });
});

describe('queries · 座位读取', () => {
  const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [2] });

  it('seatAt 取到席位', () => {
    expect(seatAt(state, 3).role).toBe('wolf');
  });

  it('seatAt 对不存在的座位抛错（编程错误，不是数据损坏）', () => {
    expect(() => seatAt(state, 42 as never)).toThrow(/不在本局座位表中/);
  });

  it('isAlive 反映存活状态', () => {
    expect(isAlive(state, 1)).toBe(true);
    expect(isAlive(state, 2)).toBe(false);
  });
});
