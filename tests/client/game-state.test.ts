import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import {
  boardAnnouncement,
  buildBoard,
  clockText,
  countdownText,
  spokenSeats,
} from '@client/game-state';

/**
 * RFC-012 §5 AC-6 / AC-7 / AC-14：界面推导的状态必须与事件流一致。
 */

function ctx(partial: Partial<ProjectedContext> = {}): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: true, personaId: null },
    phase: 'DAY_SPEECH',
    day: 2,
    aliveSeats: [1, 2, 3],
    deadSeats: [4],
    publicEvents: [],
    privateEvents: [],
    knowledge: {
      teammates: [],
      checks: [],
      potions: { heal: 'used', poison: 'used' },
      canShoot: false,
      knownKillTarget: null,
    },
    legalTargets: [],
    pending: 'speak',
    ...partial,
  } as ProjectedContext;
}

function speech(seq: number, seat: number): ProjectedContext['publicEvents'][number] {
  return {
    gameId: 'g',
    seq,
    ts: 0,
    type: 'SPEECH',
    visibleTo: 'public',
    payload: { seat, text: '过' },
  } as never;
}

describe('AC-6 · 三项状态：当前 / 未发言 / 已出局', () => {
  it('席位按编号排序，三种状态各自可判', () => {
    const board = buildBoard(ctx({ publicEvents: [speech(1, 2)] }));

    expect(board.seats.map((seat) => seat.seat)).toEqual([1, 2, 3, 4]);
    expect(board.seats.find((seat) => seat.seat === 2)?.hasSpoken).toBe(true);
    expect(board.seats.find((seat) => seat.seat === 1)?.speaking).toBe(true);
    expect(board.seats.find((seat) => seat.seat === 4)?.alive).toBe(false);
  });
});

describe('AC-7 · 当前发言者由事件流推导', () => {
  it('最后一条发言事件的「下一位」就是当前发言者', () => {
    const started = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'DAY_STARTED',
      visibleTo: 'public',
      payload: { day: 2, diedLastNight: [], speechStartSeat: 1 },
    } as never;
    const board = buildBoard(ctx({ publicEvents: [started, speech(2, 1), speech(3, 2)] }));
    expect(board.speakingSeat).toBe(3);
  });

  it('已出局的人跳过', () => {
    const board = buildBoard(
      ctx({ aliveSeats: [1, 3], deadSeats: [2], publicEvents: [speech(1, 1)] }),
    );
    expect(board.speakingSeat).toBe(3);
  });

  it('全部说完时没有当前发言者', () => {
    const board = buildBoard(ctx({ publicEvents: [speech(1, 1), speech(2, 2), speech(3, 3)] }));
    expect(board.speakingSeat).toBeNull();
  });

  it('spokeSeats 只读公开事件', () => {
    expect(spokenSeats(ctx({ publicEvents: [speech(1, 2)] }))).toEqual([2]);
  });
});

describe('AC-14 · 文字表达', () => {
  it('倒计时有三档文案，不是只有颜色', () => {
    expect(countdownText(0)).toBe('时间到');
    expect(countdownText(7)).toContain('最后');
    expect(countdownText(42)).toContain('42');
    expect(clockText(42)).toBe('00:42');
    expect(clockText(0)).toBe('00:00');
  });

  it('读屏能读出身份、阶段与轮到谁', () => {
    const started = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'DAY_STARTED',
      visibleTo: 'public',
      payload: { day: 2, diedLastNight: [], speechStartSeat: 2 },
    } as never;
    const text = boardAnnouncement(ctx({ publicEvents: [started, speech(2, 2)] }));

    expect(text).toContain('你是 1 号');
    expect(text).toContain('第 2 天');
    expect(text).toContain('轮到 3 号');
  });

  it('夜间读屏公告说「第 N 夜」', () => {
    const text = boardAnnouncement(ctx({ phase: 'NIGHT', day: 2, pending: 'chat' }));
    expect(text).toContain('第 2 夜');
    expect(text).not.toContain('第 2 天');
  });

  it('不是发言阶段时不提发言者', () => {
    const text = boardAnnouncement(ctx({ phase: 'DAY_VOTE' }));
    expect(text).not.toContain('轮到');
  });

  it('播报里不含倒计时，且重投用中文', () => {
    const text = boardAnnouncement(ctx({ phase: 'DAY_VOTE_RUNOFF' }));
    expect(text).not.toContain('秒');
    expect(text).toContain('平票重投');
  });
});

describe('C-121 · 跨天发言只算最近一天', () => {
  it('第二天开始时，前一天说过话的人不算「已发言」', () => {
    const day1 = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'DAY_STARTED',
      visibleTo: 'public',
      payload: { day: 1, diedLastNight: [], speechStartSeat: 1 },
    } as never;
    const day2 = {
      gameId: 'g',
      seq: 5,
      ts: 0,
      type: 'DAY_STARTED',
      visibleTo: 'public',
      payload: { day: 2, diedLastNight: [2], speechStartSeat: 1 },
    } as never;

    const ctx2 = ctx({
      day: 2,
      aliveSeats: [1, 3],
      deadSeats: [2],
      publicEvents: [day1, speech(2, 1), speech(3, 2), speech(4, 3), day2],
    });

    expect(spokenSeats(ctx2)).toEqual([]);
    expect(buildBoard(ctx2).speakingSeat).toBe(1);
  });
});
