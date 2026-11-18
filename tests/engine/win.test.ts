import { describe, expect, it } from 'vitest';

import { checkWin } from '@engine/win';

import { FIXTURE_ROLES, stateWithRoles } from '../fixtures/states';

/**
 * AC-15：`checkWin` 是**纯谓词**，并且落实 RUL-5「屠边只看存活，不看死因」。
 *
 * 它只读 `state.seats` 与 `state.mode`——不推进状态、不产生事件、不决定判定时机。
 * 什么时候调用它是 RFC-003/004 的事（RUL-1 要求死亡结算后立即判一次）。
 */

const WOLVES = [1, 2, 3] as const;
const GODS = [4, 5, 6] as const;
const VILLAGERS = [7, 8, 9] as const;

describe('AC-15 · 屠边（slaughter-side）', () => {
  it('神全部出局 → 狼胜，condition 为 all-gods-dead', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [...GODS] });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-gods-dead' });
  });

  it('民全部出局 → 狼胜，condition 为 all-villagers-dead', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [...VILLAGERS] });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-villagers-dead' });
  });

  it('狼全部出局 → 好人胜，condition 为 all-wolves-dead', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [...WOLVES] });

    expect(checkWin(state)).toEqual({ result: 'good', condition: 'all-wolves-dead' });
  });

  it('只死一个神时未分出胜负', () => {
    expect(
      checkWin(stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [4] })),
    ).toBeNull();
  });

  it('开局无人出局时未分出胜负', () => {
    expect(checkWin(stateWithRoles(FIXTURE_ROLES, 'slaughter-side'))).toBeNull();
  });
});

describe('AC-15 · 屠城（slaughter-all）', () => {
  it('好人全部出局 → 狼胜，condition 为 all-good-dead', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-all', {
      deadSeats: [...GODS, ...VILLAGERS],
    });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-good-dead' });
  });

  it('神全灭但还有民活着时**不**判狼胜（屠城与屠边的区别）', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-all', { deadSeats: [...GODS] });

    expect(checkWin(state)).toBeNull();
  });

  it('狼全部出局 → 好人胜（两种模式一致）', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-all', { deadSeats: [...WOLVES] });

    expect(checkWin(state)).toEqual({ result: 'good', condition: 'all-wolves-dead' });
  });
});

describe('RUL-12 · 狼刀在先：同时达成时判 wolf 胜', () => {
  it('屠边：最后一名神被刀 + 最后一只狼被毒 → wolf 胜（condition 为 all-gods-dead）', () => {
    // 这是 C-27 的核心用例：合法性来自真实夜间批次，不是构造错误。
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', {
      deadSeats: [...GODS, ...WOLVES],
    });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-gods-dead' });
  });

  it('屠边：民全灭 + 狼全灭 → 同样判 wolf 胜', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', {
      deadSeats: [...VILLAGERS, ...WOLVES],
    });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-villagers-dead' });
  });

  it('屠城：好人全灭 + 狼全灭 → wolf 胜', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-all', {
      deadSeats: [...GODS, ...VILLAGERS, ...WOLVES],
    });

    expect(checkWin(state)).toEqual({ result: 'wolf', condition: 'all-good-dead' });
  });

  it('只有狼全灭、好人侧还有存活时，仍然判好人胜（不是「狼刀在先」的适用面）', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', { deadSeats: [...WOLVES] });

    expect(checkWin(state)).toEqual({ result: 'good', condition: 'all-wolves-dead' });
  });

  it('狼全灭但神全灭不成立、民全灭不成立 → 好人胜（不误判）', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', {
      deadSeats: [...WOLVES, 4],
    });

    expect(checkWin(state)).toEqual({ result: 'good', condition: 'all-wolves-dead' });
  });
});

describe('AC-15 · RUL-5 · 只看存活不看死因', () => {
  it('被毒杀的神同样计入「神已全部出局」（死因不参与判定）', () => {
    // 夹具只关心 alive 布尔：无论怎么死的，只要 alive === false 就算出局。
    const deadByAnyCause = stateWithRoles(FIXTURE_ROLES, 'slaughter-side', {
      deadSeats: [...GODS],
    });

    expect(deadByAnyCause.seats.filter((seat) => !seat.alive)).toHaveLength(3);
    expect(checkWin(deadByAnyCause)?.result).toBe('wolf');
  });
});

describe('AC-15 · 纯谓词', () => {
  it('调用前后状态深度相等（不推进、不产出事件）', () => {
    const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
    const snapshot = structuredClone(state);

    checkWin(state);
    checkWin(state);

    expect(state).toEqual(snapshot);
  });
});
