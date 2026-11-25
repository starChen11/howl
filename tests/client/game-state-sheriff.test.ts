import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import {
  buildBoard,
  effectiveBadge,
  effectiveSheriffSeat,
  hasPendingSheriffChoice,
  maskDeathsDuringElection,
  sheriffElectionOf,
  sheriffOrderOptions,
  shouldHideDeaths,
  speakingSeat,
  spokenSeats,
} from '@client/game-state';

/**
 * RFC-022 §7 / §13.1 ~ §13.3：界面推导的发言顺序与竞选进度。
 *
 * 重点在两条回归：
 * - 竞选发言（`SHERIFF_SPEECH`）不能污染白天的发言进度；
 * - 首夜竞选期间投影即使泄漏死亡，界面也不能显示。
 */

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function ctx(partial: Partial<ProjectedContext> = {}): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: true, personaId: null },
    phase: 'DAY_SPEECH',
    day: 1,
    aliveSeats: [...ALL],
    deadSeats: [],
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
    pending: null,
    sheriffSeat: null,
    badge: 'none',
    sheriff: {
      phase: null,
      candidates: [],
      voters: [],
      withdrawn: [],
      signups: [],
      runoff: [],
      isCandidate: false,
      isVoter: false,
    },
    ...partial,
  };
}

function ev(seq: number, type: string, payload: unknown) {
  return { gameId: 'g', seq, ts: 0, type, visibleTo: 'public', payload } as never;
}

describe('RFC-022 AC-2 · 竞选发言顺序', () => {
  it('警上按座位升序依次发言', () => {
    const base = ctx({
      phase: 'DAY_SHERIFF_SPEECH',
      publicEvents: [ev(1, 'SHERIFF_CANDIDATES', { candidates: [4, 2] })],
      sheriff: {
        phase: 'speech',
        candidates: [2, 4],
        voters: [1, 3],
        withdrawn: [],
        signups: [],
        runoff: [],
        isCandidate: false,
        isVoter: true,
      },
    });

    expect(speakingSeat(base)).toBe(2);
    expect(
      speakingSeat({
        ...base,
        publicEvents: [...base.publicEvents, ev(2, 'SHERIFF_SPEECH', { seat: 2, text: '我上警' })],
      }),
    ).toBe(4);
    expect(
      speakingSeat({
        ...base,
        publicEvents: [
          ...base.publicEvents,
          ev(2, 'SHERIFF_SPEECH', { seat: 2, text: '我上警' }),
          ev(3, 'SHERIFF_SPEECH_SKIPPED', { seat: 4 }),
        ],
      }),
    ).toBeNull();
  });

  it('PK 只轮平票者，且从平票轮重新计数', () => {
    const base = ctx({
      phase: 'DAY_SHERIFF_PK',
      sheriff: {
        phase: 'pk',
        candidates: [1, 2, 5],
        voters: [3, 4, 6, 7, 8, 9],
        withdrawn: [],
        signups: [],
        runoff: [2, 5],
        isCandidate: true,
        isVoter: false,
      },
    });

    expect(speakingSeat(base)).toBe(2);
    expect(
      speakingSeat({
        ...base,
        publicEvents: [ev(1, 'SHERIFF_SPEECH', { seat: 2, text: 'PK 一次' })],
      }),
    ).toBe(5);
  });

  it('归票发言只轮到警长；警长已出局时没有人能说', () => {
    const base = ctx({
      phase: 'DAY_SHERIFF_FINAL_SPEECH',
      sheriffSeat: 3,
      badge: 'held',
    });

    expect(speakingSeat(base)).toBe(3);
    expect(speakingSeat({ ...base, aliveSeats: [1, 2] })).toBeNull();
  });
});

describe('RFC-022 §13.2 · 竞选发言不污染白天进度', () => {
  it('SHERIFF_SPEECH 不计入 spokenSeats', () => {
    const events = [
      ev(1, 'SHERIFF_SPEECH', { seat: 2, text: '竞选发言' }),
      ev(2, 'DAY_STARTED', { day: 1, diedLastNight: [], speechStartSeat: 1 }),
      ev(3, 'SPEECH', { seat: 1, text: '白天发言' }),
    ];

    expect(spokenSeats(ctx({ phase: 'DAY_SPEECH', publicEvents: events }))).toEqual([1]);
  });

  it('竞选阶段的席位进度使用独立的竞选 cursor', () => {
    const board = buildBoard(
      ctx({
        phase: 'DAY_SHERIFF_SPEECH',
        publicEvents: [
          ev(1, 'SHERIFF_CANDIDATES', { candidates: [2, 4] }),
          ev(2, 'SHERIFF_SPEECH', { seat: 2, text: '竞选发言' }),
        ],
        sheriff: {
          phase: 'speech',
          candidates: [2, 4],
          voters: [1, 3],
          withdrawn: [],
          signups: [],
          runoff: [],
          isCandidate: false,
          isVoter: true,
        },
      }),
    );

    expect(board.seats.find((seat) => seat.seat === 2)?.hasSpoken).toBe(true);
    expect(board.seats.find((seat) => seat.seat === 4)?.hasSpoken).toBe(false);
  });
});

describe('RFC-022 AC-7 · 警长定序决定白天发言顺序', () => {
  it('使用 SHERIFF_ORDER_CHOSEN 的起点与方向', () => {
    const events = [
      ev(1, 'DAY_STARTED', { day: 2, diedLastNight: [], speechStartSeat: 1 }),
      ev(2, 'SHERIFF_ORDER_CHOSEN', { startSeat: 3, direction: 'counterclockwise' }),
      ev(3, 'SPEECH', { seat: 3, text: '我先说' }),
      ev(4, 'SPEECH_SKIPPED', { seat: 2 }),
    ];

    const base = ctx({
      phase: 'DAY_SPEECH',
      day: 2,
      aliveSeats: [1, 2, 3, 4, 5],
      publicEvents: events,
    });

    // 逆时针：3 → 2 → 1 → 5 → 4；3、2 已说，轮到 1。
    expect(speakingSeat(base)).toBe(1);
  });

  it('没有警长定序时仍从 DAY_STARTED 的起点顺时针轮', () => {
    const base = ctx({
      phase: 'DAY_SPEECH',
      day: 2,
      aliveSeats: [1, 2, 3],
      publicEvents: [ev(1, 'DAY_STARTED', { day: 2, diedLastNight: [], speechStartSeat: 2 })],
    });

    expect(speakingSeat(base)).toBe(2);
  });
});

describe('RFC-022 AC-7 · 警长的可选发言顺序', () => {
  it('单死从死左/死右的第一位存活玩家开始', () => {
    const options = sheriffOrderOptions(
      ctx({
        phase: 'DAY_SHERIFF_ORDER',
        sheriffSeat: 3,
        aliveSeats: [1, 2, 3, 4, 6, 7, 8, 9],
        deadSeats: [5],
        publicEvents: [ev(1, 'DAY_STARTED', { day: 1, diedLastNight: [5], speechStartSeat: 6 })],
      }),
    );

    expect(options).toEqual([
      { startSeat: 6, direction: 'clockwise' },
      { startSeat: 4, direction: 'counterclockwise' },
    ]);
  });

  it('平安夜从警长左右第一位存活玩家开始，且跳过警长自己', () => {
    const options = sheriffOrderOptions(
      ctx({
        phase: 'DAY_SHERIFF_ORDER',
        sheriffSeat: 3,
        publicEvents: [ev(1, 'DAY_STARTED', { day: 1, diedLastNight: [], speechStartSeat: 1 })],
      }),
    );

    expect(options).toEqual([
      { startSeat: 4, direction: 'clockwise' },
      { startSeat: 2, direction: 'counterclockwise' },
    ]);
  });

  it('服务端给了 sheriffOrderOptions 时直接采用', () => {
    const options = sheriffOrderOptions(
      ctx({
        phase: 'DAY_SHERIFF_ORDER',
        sheriffSeat: 3,
        sheriffOrderOptions: [{ startSeat: 8, direction: 'counterclockwise' }],
      }),
    );

    expect(options).toEqual([{ startSeat: 8, direction: 'counterclockwise' }]);
  });
});

describe('RFC-022 §13.1 · 首夜竞选的死亡隐藏', () => {
  it('首夜竞选阶段隐藏死亡并让界面仍显示 9 人', () => {
    const leaked = ctx({
      self: { seat: 5, role: 'seer', alive: false, personaId: null },
      phase: 'DAY_SHERIFF_SIGNUP',
      aliveSeats: [1, 2, 3, 4, 6, 7, 8, 9],
      deadSeats: [5],
      publicEvents: [ev(1, 'DAY_STARTED', { day: 1, diedLastNight: [5], speechStartSeat: 6 })],
    });

    expect(shouldHideDeaths(leaked)).toBe(true);
    const masked = maskDeathsDuringElection(leaked);
    expect(masked.aliveSeats).toEqual([...ALL]);
    expect(masked.deadSeats).toEqual([]);
    expect(masked.self.alive).toBe(true);
    expect(masked.publicEvents.some((event) => event.type === 'DAY_STARTED')).toBe(false);

    const board = buildBoard(leaked);
    expect(board.aliveCount).toBe(9);
    expect(board.seats.every((seat) => seat.alive)).toBe(true);
  });

  it('天亮公布之后不再隐藏死亡', () => {
    const announced = ctx({
      phase: 'DAY_ANNOUNCE',
      aliveSeats: [1, 2, 3, 4, 6, 7, 8, 9],
      deadSeats: [5],
    });
    expect(shouldHideDeaths(announced)).toBe(false);
  });
});

describe('RFC-022 §13.6 · 服务端字段缺席时的警长兜底', () => {
  it('从公开事件还原警长与警徽，且投影字段优先', () => {
    const derived = ctx({
      publicEvents: [
        ev(1, 'SHERIFF_ELECTION_STARTED', { day: 1 }),
        ev(2, 'SHERIFF_ELECTED', { seat: 3 }),
        ev(3, 'BADGE_TRANSFERRED', { from: 3, to: 4 }),
      ],
    });
    // 删掉投影字段，模拟服务端尚未接入的旧快照。
    delete (derived as { sheriffSeat?: unknown }).sheriffSeat;
    delete (derived as { badge?: unknown }).badge;

    expect(effectiveSheriffSeat(derived)).toBe(4);
    expect(effectiveBadge(derived)).toBe('held');

    const projected = { ...derived, sheriffSeat: 6 as const, badge: 'held' as const };
    expect(effectiveSheriffSeat(projected)).toBe(6);
  });

  it('没有竞选事件时返回 undefined（不是「无警长」）', () => {
    const base = ctx();
    delete (base as { sheriffSeat?: unknown }).sheriffSeat;
    delete (base as { badge?: unknown }).badge;

    expect(effectiveSheriffSeat(base)).toBeUndefined();
    expect(effectiveBadge(base)).toBeUndefined();
  });

  it('投影没有 sheriff 视图时从公开事件还原候选人与警下', () => {
    const derived = ctx({
      phase: 'DAY_SHERIFF_VOTE',
      publicEvents: [
        ev(1, 'SHERIFF_ELECTION_STARTED', { day: 1 }),
        ev(2, 'SHERIFF_SIGNUP', { seat: 1, run: true }),
        ev(3, 'SHERIFF_SIGNUP', { seat: 2, run: false }),
        ev(4, 'SHERIFF_SIGNUP', { seat: 3, run: true }),
        ev(5, 'SHERIFF_CANDIDATES', { candidates: [1, 3] }),
        ev(6, 'SHERIFF_WITHDRAWN', { seat: 3, withdraw: true }),
      ],
    });
    delete (derived as { sheriff?: unknown }).sheriff;

    const election = sheriffElectionOf(derived);
    expect(election.candidates).toEqual([1, 3]);
    expect(election.voters).toEqual([2, 4, 5, 6, 7, 8, 9]);
    expect(election.withdrawn).toEqual([3]);
    expect(election.phase).toBe('vote');
  });
});

describe('RFC-022 · 真相视图锁定', () => {
  it('死亡警长在移交阶段算「待决定」', () => {
    const transferring = ctx({
      self: { seat: 1, role: 'villager', alive: false, personaId: null },
      phase: 'DAY_BADGE_TRANSFER',
      sheriffSeat: 1,
      badge: 'held',
    });
    expect(hasPendingSheriffChoice(transferring)).toBe(true);
  });

  it('警长在定序阶段算「待决定」', () => {
    const ordering = ctx({
      self: { seat: 3, role: 'seer', alive: true, personaId: null },
      phase: 'DAY_SHERIFF_ORDER',
      sheriffSeat: 3,
      badge: 'held',
    });
    expect(hasPendingSheriffChoice(ordering)).toBe(true);
  });

  it('普通玩家不算', () => {
    expect(hasPendingSheriffChoice(ctx({ phase: 'DAY_SHERIFF_SIGNUP' }))).toBe(false);
  });
});
