import { describe, expect, it } from 'vitest';

import { applyEvent } from '@engine/apply';
import { step } from '@engine/step';
import { goodTarget, nightStart, roleSeat, run } from '../fixtures/night';

/**
 * RUL-13 · 狼队投票决定刀谁。
 *
 * 三狼各一票；严格多数 → 下刀；平票 → 只对并列者重投；重投仍僵持 → 取并列者里
 * 席位最小的那个（否则会永远投下去）。
 */

function wolves(state: ReturnType<typeof nightStart>): number[] {
  return state.seats.filter((seat) => seat.alive && seat.role === 'wolf').map((seat) => seat.seat);
}

function vote(state: ReturnType<typeof nightStart>, seat: number, target: number) {
  return run(state, { type: 'WOLF_VOTE', ts: 1, seat: seat as never, target: target as never });
}

describe('RUL-13 · 狼队投票', () => {
  it('2:1 → 票型只给狼看，胜出者成为刀口并推进相位', () => {
    const state = nightStart();
    const pack = wolves(state);
    const [a, b, c] = pack as [number, number, number];
    const target1 = goodTarget(state);
    const target2 = state.seats.find(
      (seat) => seat.alive && seat.role !== 'wolf' && seat.seat !== target1,
    )?.seat as number;

    // 前两票不推进
    const first = vote(state, a, target1);
    const second = vote(first.state, b, target1);
    expect(second.state.phase).toBe('NIGHT_WOLVES');
    expect(second.events.some((event) => event.type === 'WOLF_KILL_CHOSEN')).toBe(false);

    const third = vote(second.state, c, target2);
    const revealed = third.events.find((event) => event.type === 'WOLF_VOTE_REVEALED');
    expect(revealed?.visibleTo).toBe('wolves');
    expect((revealed?.payload as { votes: unknown[] }).votes).toHaveLength(3);

    const chosen = third.events.find((event) => event.type === 'WOLF_KILL_CHOSEN');
    expect(chosen?.payload).toEqual({ target: target1 });
    expect(third.state.phase).not.toBe('NIGHT_WOLVES');
  });

  it('三票各投不同 → 平票，进入重投且候选只有并列者', () => {
    const state = nightStart();
    const pack = wolves(state);
    const [a, b, c] = pack as [number, number, number];
    const goods = state.seats
      .filter((seat) => seat.alive && seat.role !== 'wolf')
      .map((seat) => seat.seat)
      .slice(0, 3) as [number, number, number];

    let current = vote(state, a, goods[0]).state;
    current = vote(current, b, goods[1]).state;
    const result = vote(current, c, goods[2]);

    expect(result.state.phase).toBe('NIGHT_WOLF_RUNOFF');
    expect(result.state.wolfRunoff).toEqual([...goods].sort((x, y) => x - y));
    expect(result.events.some((event) => event.type === 'WOLF_KILL_CHOSEN')).toBe(false);
  });

  it('重投只能投并列者：投别人被拒，且相位不变', () => {
    const state = nightStart();
    const pack = wolves(state);
    const goods = state.seats
      .filter((seat) => seat.alive && seat.role !== 'wolf')
      .map((seat) => seat.seat);
    let current = vote(state, pack[0] as number, goods[0] as number).state;
    current = vote(current, pack[1] as number, goods[1] as number).state;
    current = vote(current, pack[2] as number, goods[0] as number).state;
    // 1:1:1? 这里实际 2:1，用另一个构造：三票全不同
    void current;

    const s = nightStart();
    const w = wolves(s);
    const g = s.seats.filter((seat) => seat.alive && seat.role !== 'wolf').map((seat) => seat.seat);
    let runoff = vote(s, w[0] as number, g[0] as number).state;
    runoff = vote(runoff, w[1] as number, g[1] as number).state;
    runoff = vote(runoff, w[2] as number, g[2] as number).state;
    expect(runoff.phase).toBe('NIGHT_WOLF_RUNOFF');

    const outsider = g.find((seat) => !(runoff.wolfRunoff ?? []).includes(seat)) as number;
    const rejected = vote(runoff, w[0] as number, outsider);
    expect(rejected.events[0]?.type).toBe('REJECTED');
    expect((rejected.events[0]?.payload as { code: string }).code).toBe('INVALID_RUNOFF_TARGET');
    expect(rejected.state.phase).toBe('NIGHT_WOLF_RUNOFF');
  });

  it('重投僵持（每人各投一票）→ 取席位最小的并列者下刀', () => {
    const s = nightStart();
    const w = wolves(s);
    const g = s.seats.filter((seat) => seat.alive && seat.role !== 'wolf').map((seat) => seat.seat);
    let state = vote(s, w[0] as number, g[0] as number).state;
    state = vote(state, w[1] as number, g[1] as number).state;
    state = vote(state, w[2] as number, g[2] as number).state;
    expect(state.phase).toBe('NIGHT_WOLF_RUNOFF');

    const tied = [...(state.wolfRunoff ?? [])].sort((a, b) => a - b);
    let next = vote(state, w[0] as number, tied[0] as number).state;
    next = vote(next, w[1] as number, tied[1] as number).state;
    const last = vote(next, w[2] as number, tied[2] as number);

    // 三人各投一个 → 集合没有收缩 → 兜底取最小席位
    expect(last.events.find((event) => event.type === 'WOLF_KILL_CHOSEN')?.payload).toEqual({
      target: tied[0],
    });
    expect(last.state.phase).not.toBe('NIGHT_WOLF_RUNOFF');
  });

  it('不能投队友、不能重复投票、非狼不能投票', () => {
    const s = nightStart();
    const w = wolves(s);
    const teammate = w[1] as number;
    const first = vote(s, w[0] as number, teammate);
    expect((first.events[0]?.payload as { code: string }).code).toBe('WOLF_KILL_WOLF');

    const ok = vote(s, w[0] as number, goodTarget(s));
    const duplicate = vote(ok.state, w[0] as number, goodTarget(s));
    expect((duplicate.events[0]?.payload as { code: string }).code).toBe('WOLF_VOTE_DUPLICATE');

    const villager = s.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat as number;
    const outsider = vote(s, villager, goodTarget(s));
    expect((outsider.events[0]?.payload as { code: string }).code).toBe('NOT_YOUR_TURN');
  });

  it('改版后仍支持旧的 WOLF_KILL 直接下刀（兼容旧回放）', () => {
    const s = nightStart();
    const wolf = roleSeat(s, 'wolf');
    const result = step(s, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target: goodTarget(s) as never,
    });
    expect(result.events.some((event) => event.type === 'WOLF_KILL_CHOSEN')).toBe(true);
  });
});

describe('RUL-13 · 唱票后清空票型（不能带到下一夜）', () => {
  it('分出结果后 wolfVotes 清空、wolfRunoff 不残留', () => {
    const state = nightStart();
    const pack = wolves(state);
    const target = goodTarget(state);

    let current = vote(state, pack[0] as number, target).state;
    current = vote(current, pack[1] as number, target).state;
    current = vote(current, pack[2] as number, target).state;

    expect(current.phase).not.toBe('NIGHT_WOLVES');
    expect(current.wolfVotes ?? []).toEqual([]);
    expect(current.wolfRunoff).toBeUndefined();
  });
});

describe('RUL-13 · 事件的可见性与跨夜清理', () => {
  it('引擎产出的投票事件只对狼可见', () => {
    const state = nightStart();
    const pack = wolves(state);
    const result = vote(state, pack[0] as number, goodTarget(state));

    const cast = result.events.find((event) => event.type === 'WOLF_VOTE_CAST');
    expect(cast?.visibleTo).toBe('wolves');
    // 刀口也是狼队内部信息，不能公开
    const kill = result.events.find((event) => event.type === 'WOLF_KILL_CHOSEN');
    if (kill !== undefined) expect(kill.visibleTo).toBe('wolves');
  });

  it('进入新一夜会清空 wolfVotes / wolfRunoff', () => {
    const state = nightStart();
    const withVotes = { ...state, wolfVotes: [{ seat: 2, target: 3 }], wolfRunoff: [3] } as never;

    const applied = applyEvent(withVotes, {
      gameId: state.gameId,
      seq: state.seq + 1,
      ts: 0,
      type: 'PHASE_CHANGED',
      visibleTo: 'server',
      payload: { from: state.phase, to: 'NIGHT_WOLF_CHAT' },
    } as never);

    expect(applied.wolfVotes).toBeUndefined();
    expect(applied.wolfRunoff).toBeUndefined();
  });
});
