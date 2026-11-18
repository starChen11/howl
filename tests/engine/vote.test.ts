import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { outcomeOf, tallyOf } from '@engine/phases/vote';
import { step } from '@engine/step';

import { reachDay, speakAll, voteAll } from '../fixtures/day';

/**
 * AC-5 ~ AC-9：投票、公布、放逐与重投（RFC-004 §2.3）。
 *
 * 最关键的一条是 AC-5 的**投票保密**：每张票是私有事件，公布前任何观察者都拿不到它。
 */

function atVote(state: ReturnType<typeof reachDay>['state']) {
  return speakAll(state);
}

describe('AC-5 · 投票是暗投：结算前他人看不到你的票', () => {
  it('VOTE_CAST 的可见性是投票者本人', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const seat = voting.seats.find((s) => s.alive)?.seat;
    if (seat === undefined) throw new Error('没有存活席位');

    const { events } = step(voting, { type: 'VOTE', ts: 20, seat, target: 'abstain' });

    const cast = events.find((event) => event.type === 'VOTE_CAST');
    expect(cast?.visibleTo).toBe(`self:${seat}`);
  });

  it('结算前事件流里没有任何公开的票型', () => {
    const day = reachDay();
    let current = atVote(day.state);
    const alive = current.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const collected: string[] = [];

    for (const seat of alive.slice(0, -1)) {
      const result = step(current, { type: 'VOTE', ts: 20, seat, target: alive[0] as SeatId });
      current = result.state;
      collected.push(...result.events.map((event) => event.visibleTo));
    }

    expect(collected).not.toContain('public');
    expect(current.phase).toBe('DAY_VOTE');
  });

  it('最后一张票之后才产出公开的 VOTE_REVEALED', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const target = alive[0] as SeatId;

    let current = voting;
    let lastEvents: ReturnType<typeof step>['events'] = [];
    for (const seat of alive) {
      const result = step(current, { type: 'VOTE', ts: 20, seat, target });
      current = result.state;
      lastEvents = result.events;
    }

    const revealed = lastEvents.find((event) => event.type === 'VOTE_REVEALED');
    expect(revealed?.visibleTo).toBe('public');
  });
});

describe('AC-6 · 公布票型包含全部投票者与弃权标记', () => {
  it('VOTE_REVEALED 的 payload 覆盖每个存活席位', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const target = alive[0] as SeatId;

    let current = voting;
    let revealed: { seat: SeatId; target: SeatId | 'abstain' }[] = [];
    for (const seat of alive) {
      const result = step(current, {
        type: 'VOTE',
        ts: 20,
        seat,
        // 一半弃权，验证 abstain 被如实记录
        target: seat === alive[1] ? 'abstain' : target,
      });
      current = result.state;
      const event = result.events.find((candidate) => candidate.type === 'VOTE_REVEALED');
      if (event?.type === 'VOTE_REVEALED') revealed = event.payload.votes;
    }

    expect(revealed.map((vote) => vote.seat).sort()).toEqual(alive.sort());
    expect(revealed).toContainEqual({ seat: alive[1], target: 'abstain' });
  });
});

describe('AC-7 · 唯一最高票者被放逐', () => {
  it('产出 PLAYER_DIED(cause=lynch) 并推进到白天之后的夜间阶段', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const victim = alive[0] as SeatId;

    let current = voting;
    let events: ReturnType<typeof step>['events'] = [];
    for (const seat of alive) {
      const result = step(current, { type: 'VOTE', ts: 20, seat, target: victim });
      current = result.state;
      events = result.events;
    }

    const died = events.find((event) => event.type === 'PLAYER_DIED');
    expect(died?.payload).toEqual({ seat: victim, cause: 'lynch' });
    if (events[0] !== undefined) expect(events.length).toBeGreaterThan(0);
    // 放逐之后进入下一夜（`NIGHT_WOLF_CHAT` 被跳过，与 START 一致）
    expect(current.phase).toBe('NIGHT_WOLVES');
    expect(current.seats.find((seat) => seat.seat === victim)?.alive).toBe(false);
  });
});

describe('AC-8 / RUL-2 · 平票重投的选项集只有并列者', () => {
  it('并列 → 进入 DAY_VOTE_RUNOFF，runoff 恰为并列者', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const [a, b] = alive as [SeatId, SeatId];

    let current = voting;
    for (const [index, seat] of alive.entries()) {
      current = step(current, {
        type: 'VOTE',
        ts: 20,
        seat,
        target: index % 2 === 0 ? a : b,
      }).state;
    }

    expect(current.phase).toBe('DAY_VOTE_RUNOFF');
    expect(current.runoff).toEqual([a, b].sort((x, y) => x - y));
  });

  it('重投里投非并列者或弃权 → INVALID_RUNOFF_TARGET', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const [a, b, outsider] = alive as [SeatId, SeatId, SeatId];

    let current = voting;
    for (const [index, seat] of alive.entries()) {
      current = step(current, {
        type: 'VOTE',
        ts: 20,
        seat,
        target: index % 2 === 0 ? a : b,
      }).state;
    }
    expect(current.phase).toBe('DAY_VOTE_RUNOFF');

    for (const badTarget of [outsider, 'abstain' as const]) {
      const { events } = step(current, {
        type: 'VOTE',
        ts: 21,
        seat: a,
        target: badTarget,
      });
      expect(events[0]?.payload).toEqual(
        expect.objectContaining({ code: 'INVALID_RUNOFF_TARGET' }),
      );
    }
  });

  it('重投仍并列 → 当日无人出局，直接进入下一夜（RUL-9）', () => {
    const day = reachDay();
    const voting = atVote(day.state);
    const alive = voting.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const [a, b] = alive as [SeatId, SeatId];

    let current = voting;
    for (const [index, seat] of alive.entries()) {
      current = step(current, {
        type: 'VOTE',
        ts: 20,
        seat,
        target: index % 2 === 0 ? a : b,
      }).state;
    }
    expect(current.phase).toBe('DAY_VOTE_RUNOFF');

    let events: ReturnType<typeof step>['events'] = [];
    for (const [index, seat] of alive.entries()) {
      const result = step(current, {
        type: 'VOTE',
        ts: 21,
        seat: seat as SeatId,
        target: index % 2 === 0 ? a : b,
      });
      current = result.state;
      events = result.events;
    }

    expect(current.phase).toBe('NIGHT_WOLVES');
    expect(
      events.some((event) => event.type === 'PLAYER_DIED' && event.payload.cause === 'lynch'),
    ).toBe(false);
    expect(current.seats.filter((seat) => !seat.alive)).toHaveLength(
      day.killTarget === null ? 0 : 1,
    );
  });
});

describe('AC-9 · 全员弃权当日无人出局', () => {
  it('有效票为 0 → 进入下一夜，无人被放逐', () => {
    const day = reachDay(20_261_117, { heal: true });
    const voting = atVote(day.state);
    const ended = voteAll(voting, () => 'abstain');

    expect(ended.phase).toBe('NIGHT_WOLVES');
    expect(ended.seats.every((seat) => seat.alive)).toBe(true);
  });
});

describe('票型统计（单元）', () => {
  it('弃权不计入有效票，并列按座位升序', () => {
    const votes = [
      { seat: 1 as SeatId, target: 2 as SeatId },
      { seat: 3 as SeatId, target: 2 as SeatId },
      { seat: 4 as SeatId, target: 'abstain' as const },
      { seat: 5 as SeatId, target: 6 as SeatId },
      { seat: 7 as SeatId, target: 6 as SeatId },
    ];

    expect(tallyOf(votes)).toEqual([
      { target: 2, count: 2 },
      { target: 6, count: 2 },
    ]);
    expect(outcomeOf(votes)).toEqual({ kind: 'runoff', tied: [2, 6] });
  });

  it('无人得票 → none', () => {
    expect(outcomeOf([{ seat: 1 as SeatId, target: 'abstain' }])).toEqual({ kind: 'none' });
  });
});
