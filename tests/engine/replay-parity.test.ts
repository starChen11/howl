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

/**
 * 跑一整夜：开局 → 狼刀 → 查验 → 女巫用药（解药救命）。
 *
 * 评审 N1：原来的序列只有「开局 + 狼刀 + 一个被拒的 VOTE」，**没有任何夜间 action 成功执行**，
 * 所以 `state.night` 与 `state.potionsUsed` 这两个派生字段根本没被 replay 覆盖——
 * 而它们正是 C-18 要求「必须能重建」的东西。
 */
function playSequence(): { events: GameEvent[]; liveStates: ReturnType<typeof step>[] } {
  const lobby = lobbyState({ seed: 31_337 });
  const started = step(lobby, startActionOf(lobby, 1_000));
  const state = started.state;
  // RFC-005 起发牌后停在 NIGHT_WOLF_CHAT：让每只存活 wolf 各报一句，再进入下刀阶段。
  const chatEvents = [];
  let afterChat = state;
  for (let guard = 0; guard < 10 && afterChat.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
    const speaker = afterChat.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(afterChat.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (speaker === undefined) break;
    const result = step(afterChat, { type: 'WOLF_CHAT', ts: 900, seat: speaker, text: '' });
    afterChat = result.state;
    chatEvents.push(...result.events);
  }

  for (let guard = 0; guard < 10 && afterChat.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
    const readyWolf = afterChat.seats.find(
      (seat) =>
        seat.alive && seat.role === 'wolf' && !(afterChat.wolfReady ?? []).includes(seat.seat),
    )?.seat;
    if (readyWolf === undefined) break;
    const result = step(afterChat, { type: 'WOLF_READY', ts: 900, seat: readyWolf });
    afterChat = result.state;
    chatEvents.push(...result.events);
  }

  const wolf = state.seats.find((seat) => seat.role === 'wolf' && seat.alive)?.seat;
  const killTarget = state.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
  if (wolf === undefined || killTarget === undefined) throw new Error('夹具缺少狼或村民');

  const killed = step(afterChat, { type: 'WOLF_KILL', ts: 2_000, seat: wolf, target: killTarget });

  const seer = killed.state.seats.find((seat) => seat.role === 'seer' && seat.alive)?.seat;
  const checkTarget = killed.state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
  if (seer === undefined || checkTarget === undefined) throw new Error('夹具缺少 seer 或目标');

  const checked = step(killed.state, {
    type: 'SEER_CHECK',
    ts: 3_000,
    seat: seer,
    target: checkTarget,
  });

  const witch = checked.state.seats.find((seat) => seat.role === 'witch' && seat.alive)?.seat;
  if (witch === undefined) throw new Error('夹具缺少 witch');

  const healed = step(checked.state, {
    type: 'WITCH_ACT',
    ts: 4_000,
    seat: witch,
    potion: 'heal',
    target: killTarget,
  });

  return {
    events: [
      ...started.events,
      ...chatEvents,
      ...killed.events,
      ...checked.events,
      ...healed.events,
    ],
    liveStates: [started, killed, checked, healed],
  };
}

describe('C-18 · replay 后继续 step 与原始运行一致', () => {
  it('重放出来的状态与实时推进的状态深度相等（含派生字段与 rng）', () => {
    const { events, liveStates } = playSequence();
    const last = liveStates[liveStates.length - 1];

    expect(replay(events)).toEqual(last?.state);
  });

  it('派生字段真的被覆盖：night 与 potionsUsed 在重放后仍在（N1）', () => {
    const { events, liveStates } = playSequence();
    const live = liveStates[liveStates.length - 1]?.state;
    const replayed = replay(events);

    // 这一夜的刀口与解药目标都被记录了
    expect(replayed.night?.killTarget).toBeDefined();
    expect(replayed.night?.healTarget).toBe(live?.night?.healTarget);
    expect(replayed.potionsUsed).toEqual({ heal: true, poison: false });
    expect(live?.potionsUsed).toEqual({ heal: true, poison: false });
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
