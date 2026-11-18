import { describe, expect, it } from 'vitest';

import { replay } from '@engine/replay';
import { speechOrder } from '@engine/phases/day';
import { step } from '@engine/step';

import { reachDay, speakAll } from '../fixtures/day';
import { twoDeaths } from '../fixtures/day';
import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-1 ~ AC-4：天亮与发言顺序（RFC-004 §2.1 / §2.2）。
 *
 * 发言起点的确定性是这里的核心：起点进 `DAY_STARTED` 的 payload 与 `rngAfter`，之后只读。
 */

describe('AC-2 / AC-4 · 发言起点由昨夜死者决定', () => {
  it('起点是「结算顺序第一位死者的下一位存活席位」', () => {
    const { state, killTarget } = reachDay();
    if (killTarget === null) throw new Error('夹具应当有死者');

    const start = state.speech?.startSeat;
    expect(start).toBeDefined();

    // 顺时针找死亡席位的下一位存活者
    const alive = state.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort((a, b) => a - b);
    const expected = alive.find((seat) => seat > killTarget) ?? alive[0];

    expect(start).toBe(expected);
  });

  it('起点恰好是死者时继续推进到下一个存活者', () => {
    const { state, killTarget } = reachDay();
    // 逐个把「下一号」当死者去验证：起点永远不是死者
    expect(state.seats.find((seat) => seat.seat === state.speech?.startSeat)?.alive).toBe(true);
    expect(state.speech?.startSeat).not.toBe(killTarget);
  });

  it('已出局玩家不出现在发言序列里', () => {
    const { state } = reachDay();
    const order = speechOrder(state);
    const alive = state.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort();

    expect([...order].sort()).toEqual(alive);
    expect(order).toHaveLength(alive.length);
  });
});

describe('AC-1 · 发言顺序是单循环，不重不漏', () => {
  it('每人恰好一次，全部说完后进入 DAY_VOTE', () => {
    const { state } = reachDay();
    const order = speechOrder(state);
    const spoken: number[] = [];

    let current = state;
    for (const seat of order) {
      expect(current.phase).toBe('DAY_SPEECH');
      current = step(current, { type: 'SPEECH', ts: 10, seat, text: `我是 ${seat}` }).state;
      spoken.push(seat);
    }

    expect(spoken).toHaveLength(order.length);
    expect(new Set(spoken).size).toBe(order.length);
    expect(current.phase).toBe('DAY_VOTE');
  });

  it('跳过也算发言，不重复不遗漏', () => {
    const { state } = reachDay();
    const ended = speakAll(state);

    expect(ended.phase).toBe('DAY_VOTE');
    expect(new Set(ended.speech?.spoken).size).toBe(ended.speech?.spoken.length);
  });

  it('顺序**从起点开始**顺时针，而不是从最小座位开始（评审 P1）', () => {
    const { state } = reachDay();
    const order = speechOrder(state);
    const smallestAlive = state.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort()[0];

    // 起点不等于最小座位时，这条才有区分力
    expect(order[0]).toBe(state.speech?.startSeat);
    if (state.speech?.startSeat !== smallestAlive) {
      expect(order[0]).not.toBe(smallestAlive);
    }
    // 并且是顺时针连续：相邻两项在「存活环」上相邻
    const aliveRing = state.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort();
    for (let index = 0; index < order.length - 1; index += 1) {
      const current = order[index] as number;
      const nextIndex = aliveRing.indexOf(current as (typeof aliveRing)[number]) + 1;
      const expected = aliveRing[nextIndex % aliveRing.length];
      expect(order[index + 1]).toBe(expected);
    }
  });

  it('不在轮次上的席位提交发言 → NOT_YOUR_TURN', () => {
    const { state } = reachDay();
    const order = speechOrder(state);
    const notNext = order.find((seat) => seat !== order[0]);
    if (notNext === undefined) throw new Error('只有一个存活席位');

    const { events } = (() => {
      const result = step(state, { type: 'SPEECH', ts: 10, seat: notNext, text: '抢话' });
      return { events: result.events };
    })();

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });
});

describe('C-31 · 公开的死亡公告不携带死因顺序', () => {
  it('两名死者时 diedLastNight 按座位升序，与「谁被刀、谁被毒」无关', () => {
    // 场景 A：wolf 刀高号、witch 毒低号；场景 B 反过来。
    // 若公告按结算顺序，两者会得到相反的数组——那就是泄漏。
    const a = twoDeaths({ kill: 'high', poison: 'low' });
    const b = twoDeaths({ kill: 'low', poison: 'high' });

    expect(a.diedLastNight).toHaveLength(2);
    expect(a.diedLastNight).toEqual([...a.diedLastNight].sort((x, y) => x - y));
    expect(b.diedLastNight).toEqual(a.diedLastNight);
  });

  it('发言起点只看「座位最小的死者」，不依赖死因顺序', () => {
    const a = twoDeaths({ kill: 'high', poison: 'low' });
    const b = twoDeaths({ kill: 'low', poison: 'high' });

    // 两个场景的死者集合相同（3 与 9），所以起点必须相同
    expect(a.speechStartSeat).toBe(b.speechStartSeat);
  });
});

describe('AC-3 · 无死者时起点由 rng 决定，且可重放', () => {
  it('同 seed 两次运行得到同一个起点', () => {
    const first = reachDay(31_337, { heal: true });
    const second = reachDay(31_337, { heal: true });

    expect(first.killTarget).toBeNull();
    expect(first.state.speech?.startSeat).toBe(second.state.speech?.startSeat);
    expect(first.state.rng).toEqual(second.state.rng);
  });

  it('无死者时起点确实随 seed 变化（评审 P3：固定取最小座位时要红）', () => {
    const starts = new Set<number>();
    for (const seed of [1, 7, 42, 99, 1024, 31_337]) {
      const { state } = reachDay(seed, { heal: true });
      const start = state.speech?.startSeat;
      expect(start).toBeDefined();
      starts.add(start as number);
    }

    // 「永远取最小存活座位」会得到单一值
    expect(starts.size).toBeGreaterThan(1);
  });

  it('起点写在 DAY_STARTED 的 payload 里，且 replay 重建得出来', () => {
    const lobby = lobbyState({ seed: 777 });
    let current = step(lobby, startActionOf(lobby, 1)).state;
    const events = [...step(lobby, startActionOf(lobby, 1)).events];

    const push = (action: Parameters<typeof step>[1]) => {
      const result = step(current, action);
      current = result.state;
      events.push(...result.events);
    };

    const wolf = current.seats.find((seat) => seat.role === 'wolf')?.seat;
    const target = current.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
    if (wolf === undefined || target === undefined) throw new Error('夹具缺角色');
    push({ type: 'WOLF_KILL', ts: 2, seat: wolf, target });
    const seer = current.seats.find((seat) => seat.role === 'seer')?.seat;
    if (seer === undefined) throw new Error('没有 seer');
    push({ type: 'SEER_CHECK', ts: 3, seat: seer, target });
    const witch = current.seats.find((seat) => seat.role === 'witch')?.seat;
    if (witch === undefined) throw new Error('没有 witch');
    push({ type: 'WITCH_ACT', ts: 4, seat: witch, potion: 'none' } as never);

    const started = events.find((event) => event.type === 'DAY_STARTED');
    expect(started?.type).toBe('DAY_STARTED');
    if (started?.type !== 'DAY_STARTED') throw new Error('没有 DAY_STARTED');

    expect(started.payload.speechStartSeat).toBe(current.speech?.startSeat);
    expect(replay(events)).toEqual(current);
  });
});
