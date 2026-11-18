import { describe, expect, it } from 'vitest';

import type { GameState } from '@shared/domain';

import { createInitialState } from '@engine/init';
import { step } from '@engine/step';

import { lobbyState, startedState } from '../fixtures/states';

/**
 * AC-3：`GameState` 必须是可序列化的纯数据（ARCH-3 / NFR-2）。
 *
 * 这条不只测 `JSON.stringify` 能过——`Date` / `Map` / `Set` / 类实例都能 stringify，
 * 但都不能在 `replay` 里精确还原。所以递归断言每个值的原型。
 */

function expectPlainValue(value: unknown, path: string): void {
  if (value === null) return;

  const kind = typeof value;
  if (kind === 'number' || kind === 'string' || kind === 'boolean') return;

  if (Array.isArray(value)) {
    expect(Object.getPrototypeOf(value), `${path} 应该是普通数组`).toBe(Array.prototype);
    value.forEach((item, index) => {
      expectPlainValue(item, `${path}[${index}]`);
    });
    return;
  }

  if (typeof value === 'object') {
    expect(Object.getPrototypeOf(value), `${path} 的原型必须是 Object.prototype`).toBe(
      Object.prototype,
    );
    // 上面刚断言过原型就是 Object.prototype，所以这里按纯对象遍历是安全的。
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      expectPlainValue(item, `${path}.${key}`);
    }
    return;
  }

  throw new Error(`${path} 出现了不可序列化的值：${kind}`);
}

function roundTrip(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

describe('AC-3 · GameState 可序列化', () => {
  it('LOBBY 状态往返后深度相等', () => {
    const state = lobbyState();

    expect(roundTrip(state)).toEqual(state);
  });

  it('开局后的状态往返后深度相等，且能继续推进', () => {
    const started = startedState();
    const restored = roundTrip(started);

    expect(restored).toEqual(started);

    const nextFromRestored = step(restored, { type: 'SPEECH', ts: 5_000, seat: 2, text: '嗨' });
    const nextFromOriginal = step(started, { type: 'SPEECH', ts: 5_000, seat: 2, text: '嗨' });

    // 比较整个推进结果，不只 seq：往返后「还能继续推进」的意思是推进结果完全一致。
    expect(nextFromRestored).toEqual(nextFromOriginal);
  });

  it('状态里每个值都是原始值 / 普通数组 / 纯对象', () => {
    expectPlainValue(lobbyState(), 'lobby');
    expectPlainValue(startedState(), 'started');
  });

  it('板子规模与座位数不一致时拒绝开局（防御分支）', () => {
    expect(() =>
      createInitialState({ gameId: 'x', seed: 1, mode: 'slaughter-side', playerSeat: 1 }, [
        'wolf',
        'seer',
        'villager',
      ]),
    ).toThrow(/板子规模/);
  });

  it('不含 Date / Map / Set / 函数 / 类实例（显式反例，证明上面的断言不是空转）', () => {
    const poisoned = { when: new Date(), table: new Map(), set: new Set(), fn: () => 1 };
    const plain = startedState();

    expect(() => {
      expectPlainValue(poisoned, 'poisoned');
    }).toThrow();
    expect(() => {
      expectPlainValue(plain, 'plain');
    }).not.toThrow();
  });
});
