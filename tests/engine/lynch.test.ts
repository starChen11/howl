import { describe, expect, it } from 'vitest';

import { step } from '@engine/step';

import { reachDay, speakAll } from '../fixtures/day';

/**
 * AC-7 / AC-10 ~ AC-14：放逐、两次胜负判定与「没有平局」。
 *
 * 白天放逐与夜间死亡的判定顺序是同一套（RUL-1）：先判、后技能、再判。
 */

/** 走到投票阶段，并让全员把票投给 `victim`。 */
function lynch(state: ReturnType<typeof reachDay>['state'], victim: number) {
  const voting = speakAll(state);
  const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);

  let current = voting;
  let events: ReturnType<typeof step>['events'] = [];
  for (const seat of alive) {
    const result = step(current, {
      type: 'VOTE',
      ts: 20,
      seat,
      target: victim as never,
    });
    current = result.state;
    events = result.events;
  }

  return { state: current, events };
}

describe('放逐与入夜', () => {
  it('放逐好人后进入下一夜，day 递增', () => {
    const day = reachDay();
    const target = day.state.seats.find((seat) => seat.alive && seat.role === 'villager');
    if (target === undefined) throw new Error('没有 villager');

    const before = day.state.day;
    const { state } = lynch(day.state, target.seat);

    expect(state.seats.find((seat) => seat.seat === target.seat)?.alive).toBe(false);
    expect(state.phase).toBe('NIGHT_WOLVES');
    expect(state.day).toBe(before + 1);
  });

  it('放逐之后当夜的结算清空：night 与昨夜死者都重置', () => {
    const day = reachDay();
    const target = day.state.seats.find((seat) => seat.alive && seat.role === 'villager');
    if (target === undefined) throw new Error('没有 villager');

    const { state } = lynch(day.state, target.seat);

    expect(state.night).toBeUndefined();
    expect(state.pendingDeaths).toBeUndefined();
  });
});

describe('AC-12 / RUL-1 · 放逐最后一名神时立即狼胜，不给开枪机会', () => {
  it('被放逐的 hunter 正是最后一个神 → GAME_ENDED(all-gods-dead)，事件流无 HUNTER_SHOOT', () => {
    // 让另两名神出局，只留 hunter，再放逐他
    const day = reachDay();
    const rolesOf = (role: string) =>
      day.state.seats.filter((seat) => seat.role === role).map((seat) => seat.seat);

    const hunter = rolesOf('hunter')[0];
    const seer = rolesOf('seer')[0];
    const witch = rolesOf('witch')[0];
    if (hunter === undefined || seer === undefined || witch === undefined) {
      throw new Error('夹具缺角色');
    }

    // 直接构造残局：两个神已出局、hunter 存活、 wolves 存活
    const rigged = {
      ...day.state,
      seats: day.state.seats.map((seat) =>
        seat.seat === seer || seat.seat === witch ? { ...seat, alive: false } : seat,
      ),
    };

    const { events, state } = lynch(rigged, hunter);

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'wolf', condition: 'all-gods-dead' });
    expect(state.phase).toBe('FINISHED');
    expect(events.some((event) => event.type === 'HUNTER_SHOOT')).toBe(false);
  });
});

describe('AC-13 / RUL-1 · 开枪之后的第二次判定', () => {
  it('放逐 hunter 且好人仍有存活 → 进 DAY_HUNTER_SHOOT，带走最后一狼后好人胜', () => {
    const day = reachDay();
    const rolesOf = (role: string) =>
      day.state.seats.filter((seat) => seat.role === role).map((seat) => seat.seat);

    const hunter = rolesOf('hunter')[0];
    const wolves = rolesOf('wolf');
    if (hunter === undefined) throw new Error('没有 hunter');
    // 只留一只狼，猎人开枪带走它 → 好人胜
    const lastWolf = wolves[0];
    if (lastWolf === undefined) throw new Error('没有 wolf');

    const rigged = {
      ...day.state,
      seats: day.state.seats.map((seat) =>
        wolves.includes(seat.seat) && seat.seat !== lastWolf ? { ...seat, alive: false } : seat,
      ),
    };

    const { state: shotPhase } = lynch(rigged, hunter);
    expect(shotPhase.phase).toBe('DAY_HUNTER_SHOOT');

    const { events, state } = step(shotPhase, {
      type: 'HUNTER_SHOOT',
      ts: 30,
      seat: hunter,
      target: lastWolf,
    });

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'good', condition: 'all-wolves-dead' });
    expect(state.phase).toBe('FINISHED');
    expect(events.some((event) => event.type === 'HUNTER_SHOOT')).toBe(true);
  });

  it('放弃开枪 → 进入下一夜', () => {
    const day = reachDay();
    const hunter = day.state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有 hunter');

    const { state: shotPhase } = lynch(day.state, hunter);
    expect(shotPhase.phase).toBe('DAY_HUNTER_SHOOT');

    const { state } = step(shotPhase, { type: 'HUNTER_SHOOT', ts: 30, seat: hunter });

    expect(state.phase).toBe('NIGHT_WOLVES');
  });
});

describe('AC-14 · 没有平局，也没有平局兜底字段', () => {
  it('GameState 不存在 stalemateDays 字段', () => {
    const day = reachDay();

    expect(Object.keys(day.state)).not.toContain('stalemateDays');
  });

  it('放逐与开枪的结果只有 wolf / good', () => {
    const day = reachDay();
    const target = day.state.seats.find((seat) => seat.alive && seat.role === 'villager');
    if (target === undefined) throw new Error('没有 villager');

    const { events } = lynch(day.state, target.seat);
    for (const event of events) {
      if (event.type !== 'GAME_ENDED') continue;
      expect(['wolf', 'good']).toContain(event.payload.result);
    }
    expect(
      events.some(
        (event) => event.type === 'GAME_ENDED' && event.payload.result === ('draw' as never),
      ),
    ).toBe(false);
  });
});
