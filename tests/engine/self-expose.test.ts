import { describe, expect, it } from 'vitest';

import { step } from '@engine/step';

import { reachDay, speakAll } from '../fixtures/day';

/**
 * AC-10 ~ AC-13：狼人自曝（RFC-005 §2.3，RUL-4「用一天换一夜」）。
 *
 * 三个断言对象要分清：
 * 1. 事件：`SELF_EXPOSE` 是公开的；
 * 2. 相位：直接进入 `NIGHT_WOLF_CHAT`（不是 `NIGHT_WOLVES`——否则跳过狼队协商）；
 * 3. 后果：当天不再有任何投票事件。
 */

describe('AC-10 · 自曝后当日终止并进入夜聊', () => {
  it('在 DAY_SPEECH 自曝：公开事件 + 相位进 NIGHT_WOLF_CHAT', () => {
    const day = reachDay();
    const wolf = day.state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有存活的 wolf');

    const { events, state } = step(day.state, { type: 'SELF_EXPOSE', ts: 50, seat: wolf });

    const exposed = events.find((event) => event.type === 'SELF_EXPOSE');
    expect(exposed?.visibleTo).toBe('public');
    expect(exposed?.payload).toEqual({ seat: wolf });
    expect(state.phase).toBe('NIGHT_WOLF_CHAT');
  });

  it('在 DAY_VOTE 自曝同样成立（不要求轮到该 wolf 发言）', () => {
    const day = reachDay();
    const voting = speakAll(day.state);
    expect(voting.phase).toBe('DAY_VOTE');

    const wolf = voting.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有存活的 wolf');

    const { state } = step(voting, { type: 'SELF_EXPOSE', ts: 50, seat: wolf });

    expect(state.phase).toBe('NIGHT_WOLF_CHAT');
  });
});

describe('AC-11 · 自曝之后当天不再有投票', () => {
  it('自曝产出的事件里没有 VOTE_CAST / VOTE_REVEALED', () => {
    const day = reachDay();
    const wolf = day.state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有存活的 wolf');

    const { events } = step(day.state, { type: 'SELF_EXPOSE', ts: 50, seat: wolf });

    expect(events.some((event) => event.type === 'VOTE_CAST')).toBe(false);
    expect(events.some((event) => event.type === 'VOTE_REVEALED')).toBe(false);
  });

  it('自曝前已产生的发言事件保留（它们是已发生的公开事实）', () => {
    const day = reachDay();
    const speaking = day.state;
    const first = speaking.speech?.startSeat;
    if (first === undefined) throw new Error('没有发言起点');

    const afterSpeech = step(speaking, {
      type: 'SPEECH',
      ts: 10,
      seat: first,
      text: '我发言完了',
    }).state;

    const wolf = afterSpeech.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有存活的 wolf');

    const { state } = step(afterSpeech, { type: 'SELF_EXPOSE', ts: 50, seat: wolf });

    // 已说过的发言仍记在状态里
    expect(state.speech?.spoken).toContain(first);
  });
});

describe('AC-12 · 非狼与已出局狼都不能自曝', () => {
  it('好人提交 → NOT_A_WOLF', () => {
    const day = reachDay();
    const good = day.state.seats.find((seat) => seat.alive && seat.role !== 'wolf')?.seat;
    if (good === undefined) throw new Error('没有好人');

    const { events } = step(day.state, { type: 'SELF_EXPOSE', ts: 50, seat: good });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_A_WOLF' }));
  });

  it('已出局的 wolf 提交 → NOT_ALIVE', () => {
    const day = reachDay();
    const wolves = day.state.seats.filter((seat) => seat.role === 'wolf').map((seat) => seat.seat);
    const deadWolf = wolves[0];
    if (deadWolf === undefined) throw new Error('没有 wolf');

    const rigged = {
      ...day.state,
      seats: day.state.seats.map((seat) =>
        seat.seat === deadWolf ? { ...seat, alive: false } : seat,
      ),
    };

    const { events } = step(rigged, { type: 'SELF_EXPOSE', ts: 50, seat: deadWolf });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_ALIVE' }));
  });
});

describe('AC-13 · 自曝不改变存活计数', () => {
  it('自曝前后的存活席位相同', () => {
    const day = reachDay();
    const wolf = day.state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有存活的 wolf');

    const before = day.state.seats.filter((seat) => seat.alive).length;
    const { state } = step(day.state, { type: 'SELF_EXPOSE', ts: 50, seat: wolf });

    expect(state.seats.filter((seat) => seat.alive).length).toBe(before);
  });
});
