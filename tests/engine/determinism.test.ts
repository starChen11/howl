import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';
import type { GameEvent } from '@shared/events';

import { replay } from '@engine/replay';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-5：同一 `seed` + 同一 action 序列两次运行，事件流逐条相等（F38 / NFR-18）。
 *
 * 「逐条相等」包含事件自带的 `ts`——测试里给同样的 `ts`，所以整条事件流可以整对象比较。
 * 任何一处随机、顺序或时间戳漂移都会让这条红。
 */

function runSequence(seed: number): { events: GameEvent[]; finalSeq: number } {
  const lobby = lobbyState({ seed });
  const stream: GameEvent[] = [];

  const started = step(lobby, startActionOf(lobby, 1_000));
  stream.push(...started.events);

  const later: readonly Action[] = [
    { type: 'WOLF_KILL', ts: 2_000, seat: 1, target: 2 },
    { type: 'VOTE', ts: 3_000, seat: 2, target: 'abstain' },
  ];

  let state = started.state;
  for (const action of later) {
    const result = step(state, action);
    stream.push(...result.events);
    state = result.state;
  }

  return { events: stream, finalSeq: state.seq };
}

describe('AC-5 · 种子决定可复现性', () => {
  it('同 seed + 同 action 序列两次运行，事件流逐条深度相等', () => {
    const first = runSequence(4242);
    const second = runSequence(4242);

    expect(second.events).toEqual(first.events);
    expect(second.finalSeq).toBe(first.finalSeq);
  });

  it('不同 seed 产出不同的发牌（证明 seed 真的参与了，而不是被忽略）', () => {
    const a = lobbyState({ seed: 1 });
    const b = lobbyState({ seed: 2 });

    const rolesA = a.seats.map((seat) => seat.role);
    const rolesB = b.seats.map((seat) => seat.role);

    expect(rolesA).not.toEqual(rolesB);
  });

  it('同 seed 两次重放的事件流一致，且终态一致', () => {
    const first = runSequence(999);
    const second = runSequence(999);

    expect(replay(second.events)).toEqual(replay(first.events));
  });

  it('发牌结果稳定：固定 seed 的身份序列不随调用次数变化', () => {
    const roles = lobbyState({ seed: 20_261_117 }).seats.map((seat) => seat.role);
    const again = lobbyState({ seed: 20_261_117 }).seats.map((seat) => seat.role);

    expect(again).toEqual(roles);
    expect(roles.filter((role) => role === 'wolf')).toHaveLength(3);
  });
});
