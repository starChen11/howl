import { describe, expect, it } from 'vitest';

import { applyEvent } from '@engine/apply';
import { replay } from '@engine/replay';
import { step } from '@engine/step';
import { checkWin } from '@engine/win';
import type { GameEvent } from '@shared/events';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * C-18 的验收手段（`changes/CHANGE-REQUEST-004.md` 第 3 条要求）。
 *
 * 规则是：`GameState` 里凡是由事件折叠出来的值，**只能由 `applyEvent` 写**，并且必须能
 * 从事件完整重算。这条纪律没有类型强制，唯一的自动验收方式就是——
 *
 *   **跑一段序列 → 拿到事件流 → `replay` → 用重放出来的状态继续 `step` → 判定必须与原路一致**
 *
 * RFC-002 阶段还没有派生字段（发言 cursor / 票箱 / 药水位归 RFC-003~005）。这条测试比较的是
 * **整个 state 对象**，所以那些字段一旦加进来，就会自动被覆盖——不需要回来改这条测试。
 */

function playSequence(): { events: GameEvent[]; liveStates: ReturnType<typeof step>[] } {
  const lobby = lobbyState({ seed: 31_337 });
  const first = step(lobby, startActionOf(lobby, 1_000));

  // 第一夜之后的所有 action 在 RFC-002 里都会被拒——「拒绝也要可重放」同样重要：
  // 复盘时间线里那个 seq 缺口会让后面的事件对不上。
  const second = step(first.state, { type: 'WOLF_KILL', ts: 2_000, seat: 1, target: 2 });
  const third = step(second.state, { type: 'VOTE', ts: 3_000, seat: 2, target: 'abstain' });

  return {
    events: [...first.events, ...second.events, ...third.events],
    liveStates: [first, second, third],
  };
}

describe('C-18 · replay 后继续 step 与原始运行一致', () => {
  it('重放出来的状态与实时推进的状态深度相等（含派生字段与 rng）', () => {
    const { events, liveStates } = playSequence();
    const last = liveStates[liveStates.length - 1];

    expect(replay(events)).toEqual(last?.state);
  });

  it('用重放状态继续 step，产出的事件与实时一致', () => {
    const { events, liveStates } = playSequence();
    const replayed = replay(events);
    const last = liveStates[liveStates.length - 1];
    if (last === undefined) throw new Error('序列为空');

    const fromLive = step(last.state, { type: 'SPEECH_SKIP', ts: 4_000, seat: 5 });
    const fromReplay = step(replayed, { type: 'SPEECH_SKIP', ts: 4_000, seat: 5 });

    expect(fromReplay.events).toEqual(fromLive.events);
    expect(fromReplay.state).toEqual(fromLive.state);
  });

  it('用重放状态做的胜负判定与实时一致', () => {
    const { events, liveStates } = playSequence();
    const last = liveStates[liveStates.length - 1];
    if (last === undefined) throw new Error('序列为空');

    expect(checkWin(replay(events))).toEqual(checkWin(last.state));
  });

  it('真的分段重放：先 replay 前半，再把后半逐个 applyEvent 折进去（N1）', () => {
    const { events } = playSequence();
    const half = Math.ceil(events.length / 2);

    // 前半走 replay（从空状态起），后半用同一个折叠基元接上去。
    // 原来的写法是 `replay([...前半, ...后半])`，那只是同一次重放换了个写法。
    const afterFirstHalf = replay(events.slice(0, half));
    const afterSecondHalf = events
      .slice(half)
      .reduce((state, event) => applyEvent(state, event), afterFirstHalf);

    expect(afterSecondHalf).toEqual(replay(events));
  });
});
