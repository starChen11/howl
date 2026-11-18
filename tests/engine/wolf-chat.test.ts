import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { pendingChatters } from '@engine/phases/wolf-chat';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-5 ~ AC-9：狼队夜间私聊（RFC-005 §2.2）。
 *
 * 关键设计是**有界**：每只存活 wolf 各一条就结束，不依赖「AI 说完了没有」这种编排层判断。
 */

function opened() {
  const lobby = lobbyState({ seed: 20_261_117 });
  return step(lobby, startActionOf(lobby, 1)).state;
}

describe('AC-5 · 夜聊排在狼人行动之前', () => {
  it('发牌之后直接停在 NIGHT_WOLF_CHAT', () => {
    const state = opened();

    expect(state.phase).toBe('NIGHT_WOLF_CHAT');
    expect(pendingChatters(state).length).toBeGreaterThan(0);
  });

  it('未全部提交前提交 WOLF_KILL → PHASE_MISMATCH', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const { events } = step(state, {
      type: 'WOLF_KILL',
      ts: 2,
      seat: wolf,
      target: 4 as SeatId,
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
  });
});

describe('AC-6 · 每个存活狼各产出一条 WOLF_CHAT_POSTED', () => {
  it('事件可见性是 wolves，payload 带 round', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const { events } = step(state, { type: 'WOLF_CHAT', ts: 2, seat: wolf, text: '今晚刀 4' });

    const posted = events.find((event) => event.type === 'WOLF_CHAT_POSTED');
    expect(posted?.visibleTo).toBe('wolves');
    if (posted?.type !== 'WOLF_CHAT_POSTED') throw new Error('没有 WOLF_CHAT_POSTED');
    expect(posted.payload).toEqual({ seat: wolf, text: '今晚刀 4', round: 'night-chat' });
  });

  it('同一只 wolf 提交两次 → ALREADY_SPOKEN', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const first = step(state, { type: 'WOLF_CHAT', ts: 2, seat: wolf, text: 'a' }).state;
    const { events } = step(first, { type: 'WOLF_CHAT', ts: 3, seat: wolf, text: 'b' });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'ALREADY_SPOKEN' }));
  });

  it('好人提交 → NOT_YOUR_TURN', () => {
    const state = opened();
    const good = state.seats.find((seat) => seat.role !== 'wolf')?.seat;
    if (good === undefined) throw new Error('没有好人');

    const { events } = step(state, { type: 'WOLF_CHAT', ts: 2, seat: good, text: '插话' });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });
});

describe('AC-7 / AC-8 · 全部提交后推进，空串也算提交', () => {
  it('每只存活 wolf 各报一句（空串）后进入 NIGHT_WOLVES', () => {
    let state = opened();
    let guard = 0;

    while (state.phase === 'NIGHT_WOLF_CHAT' && guard < 10) {
      const speaker = pendingChatters(state)[0];
      if (speaker === undefined) break;
      state = step(state, { type: 'WOLF_CHAT', ts: guard, seat: speaker, text: '' }).state;
      guard += 1;
    }

    expect(state.phase).toBe('NIGHT_WOLVES');
    expect(state.wolfChat).toHaveLength(3);
  });
});

describe('AC-9 · 白天不能夜聊', () => {
  it('在 DAY_SPEECH 提交 WOLF_CHAT → Rejected，除 seq 外状态不变', () => {
    // 直接构造一个白天状态，避免依赖夜间流程
    const base = opened();
    const dayState = { ...base, phase: 'DAY_SPEECH' as const, day: 2 };
    const wolf = dayState.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const { events, state: after } = step(dayState, {
      type: 'WOLF_CHAT',
      ts: 5,
      seat: wolf,
      text: '白天说话',
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
    expect({ ...after, seq: dayState.seq }).toEqual(dayState);
  });
});
