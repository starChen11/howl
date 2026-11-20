import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { pendingChatters } from '@engine/phases/wolf-chat';
import { step } from '@engine/step';

import { reachDay, speakAll } from '../fixtures/day';
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

  it('同一只 wolf 可以连发（RUL-14 聊天室）', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const first = step(state, { type: 'WOLF_CHAT', ts: 2, seat: wolf, text: 'a' }).state;
    const second = step(first, { type: 'WOLF_CHAT', ts: 3, seat: wolf, text: 'b' });

    expect(second.events[0]?.type).toBe('WOLF_CHAT_POSTED');
    expect(second.state.phase).toBe('NIGHT_WOLF_CHAT');
    expect(second.state.wolfChat).toHaveLength(2);
  });

  it('好人提交 → NOT_YOUR_TURN', () => {
    const state = opened();
    const good = state.seats.find((seat) => seat.role !== 'wolf')?.seat;
    if (good === undefined) throw new Error('没有好人');

    const { events } = step(state, { type: 'WOLF_CHAT', ts: 2, seat: good, text: '插话' });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });
});

describe('RUL-14 · 全员准备才推进', () => {
  it('只有部分狼准备时仍在讨论，全员准备后进入 NIGHT_WOLVES', () => {
    let state = opened();
    const wolves = state.seats.filter((seat) => seat.alive && seat.role === 'wolf');
    const firstWolf = wolves[0]?.seat;
    if (firstWolf === undefined) throw new Error('没有 wolf');

    // 即便每只狼都说过一句，也不自动推进
    for (const [index, wolf] of wolves.entries()) {
      state = step(state, {
        type: 'WOLF_CHAT',
        ts: index,
        seat: wolf.seat,
        text: '',
      }).state;
    }
    expect(state.phase).toBe('NIGHT_WOLF_CHAT');

    const firstReady = step(state, { type: 'WOLF_READY', ts: 10, seat: firstWolf });
    state = firstReady.state;
    if (wolves.length > 1) expect(state.phase).toBe('NIGHT_WOLF_CHAT');

    for (const wolf of wolves.filter((seat) => seat.seat !== firstWolf)) {
      state = step(state, { type: 'WOLF_READY', ts: 11, seat: wolf.seat }).state;
    }
    expect(state.phase).toBe('NIGHT_WOLVES');
    expect(state.wolfChat).toHaveLength(3);
  });

  it('重复准备 → ALREADY_READY', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');
    const first = step(state, { type: 'WOLF_READY', ts: 1, seat: wolf }).state;
    const again = step(first, { type: 'WOLF_READY', ts: 2, seat: wolf });
    expect(again.events[0]?.payload).toEqual(expect.objectContaining({ code: 'ALREADY_READY' }));
  });
});

describe('第二夜起夜聊仍然存在（评审 B1）', () => {
  it('放逐之后进入的是 NIGHT_WOLF_CHAT，不是直接 NIGHT_WOLVES', () => {
    const day = reachDay();
    const voting = speakAll(day.state);
    const alive: SeatId[] = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const victim = alive[0] as SeatId;

    let current = voting;
    for (const seat of alive) {
      current = step(current, { type: 'VOTE', ts: 20, seat, target: victim }).state;
    }

    expect(current.phase).toBe('NIGHT_WOLF_CHAT');
    // 第二夜的夜聊必须从空开始（上一夜的发声不能带过来）
    expect(current.wolfChat ?? []).toHaveLength(0);
    expect(pendingChatters(current).length).toBeGreaterThan(0);
  });
});

describe('夜聊文本截断（RFC §4）', () => {
  it('超过 500 字的部分被截断，事件仍然产出', () => {
    const state = opened();
    const wolf = state.seats.find((seat) => seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    const { events } = step(state, {
      type: 'WOLF_CHAT',
      ts: 2,
      seat: wolf,
      text: 'x'.repeat(600),
    });

    const posted = events.find((event) => event.type === 'WOLF_CHAT_POSTED');
    if (posted?.type !== 'WOLF_CHAT_POSTED') throw new Error('没有 WOLF_CHAT_POSTED');
    expect(posted.payload.text).toHaveLength(500);
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
