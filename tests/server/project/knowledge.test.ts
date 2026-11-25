import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';

import { project } from '@server/project';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';
import { skipSheriffElection } from '../../helpers/sheriff';
import { seatOfAliveRole, seatOfRole } from '../../helpers/roles';

/**
 * AC-4 ~ AC-7：角色私货的**精确**断言。
 *
 * 之前的矩阵只断言「非 witch 的两项是 used」，那对「witch 看到真实药水位」是无效的
 * （把实现写成恒 used，矩阵照样全绿）。这里每个角色都造出**有内容**的局面，
 * 断言具体值。
 */

/** 跑一整夜到天亮：wolf 刀 `killTarget`，seer 查 `checkTarget`，witch 按 `potion` 行动。 */
/** 从开局跑到「天亮」，收集**完整**事件流（project 需要从 seq 1 开始折叠）。 */
function runNight(options: {
  killTarget?: SeatId;
  checkTarget?: SeatId;
  potion?: 'none' | 'heal';
  healTarget?: SeatId;
}) {
  const lobby = lobbyState({ seed: 20_261_117 });
  const events: ReturnType<typeof step>['events'] = [];

  const push = (state: typeof lobby, action: Parameters<typeof step>[1]) => {
    const result = step(state, action);
    events.push(...result.events);
    return result.state;
  };

  let current = push(lobby, startActionOf(lobby, 1));

  // 狼队夜聊
  for (let guard = 0; guard < 10 && current.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
    const speaker = current.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(current.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (speaker === undefined) break;
    current = push(current, { type: 'WOLF_CHAT', ts: 2, seat: speaker, text: '' });
  }
  for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
    if (current.phase !== 'NIGHT_WOLF_CHAT') break;
    const readyWolf = current.seats.find(
      (seat) =>
        seat.alive && seat.role === 'wolf' && !(current.wolfReady ?? []).includes(seat.seat),
    )?.seat;
    if (readyWolf === undefined) break;
    current = push(current, { type: 'WOLF_READY', ts: 2, seat: readyWolf });
  }

  const wolf = seatOfAliveRole(current, 'wolf');
  const killTarget = options.killTarget ?? seatOfAliveRole(current, 'villager');
  current = push(current, { type: 'WOLF_KILL', ts: 3, seat: wolf, target: killTarget });

  if (current.phase === 'NIGHT_SEER') {
    const seer = seatOfAliveRole(current, 'seer');
    const checkTarget = options.checkTarget ?? seatOfAliveRole(current, 'villager');
    current = push(current, { type: 'SEER_CHECK', ts: 4, seat: seer, target: checkTarget });
  }

  if (current.phase === 'NIGHT_WITCH') {
    const witch = seatOfAliveRole(current, 'witch');
    current =
      options.potion === 'heal'
        ? push(current, {
            type: 'WITCH_ACT',
            ts: 5,
            seat: witch,
            potion: 'heal',
            target: options.healTarget ?? killTarget,
          })
        : push(current, { type: 'WITCH_ACT', ts: 5, seat: witch, potion: 'none' });
  }

  return { state: current, events, killTarget };
}

function playNight(options: { potion?: 'none' | 'heal' } = {}) {
  const night = runNight(options);
  const seer = seatOfRole(night.state, 'seer');
  const witch = seatOfRole(night.state, 'witch');
  const checkTarget = (
    night.events.find((event) => event.type === 'SEER_CHECKED')?.payload as
      { target: SeatId } | undefined
  )?.target;
  return { ...night, seer, witch, checkTarget };
}

describe('AC-4 · 预言家只看到自己的查验', () => {
  it('seer 的 checks 含刚才那次，且 target/result 与真实身份一致', () => {
    const night = playNight({});
    const ctx = project({
      state: night.state,
      events: night.events,
      observer: night.seer,
      pending: null,
    });

    expect(ctx.knowledge.checks).toHaveLength(1);
    expect(ctx.knowledge.checks[0]).toEqual({
      day: 1,
      target: night.checkTarget,
      result:
        night.state.seats.find((s) => s.seat === night.checkTarget)?.role === 'wolf'
          ? 'wolf'
          : 'not-wolf',
    });
  });

  it('其他 8 个观察者的 checks 都是空数组', () => {
    const night = playNight({});
    for (const observer of SEAT_IDS) {
      if (observer === night.seer) continue;
      const ctx = project({ state: night.state, events: night.events, observer, pending: null });
      expect(ctx.knowledge.checks, `observer=${observer}`).toEqual([]);
    }
  });
});

describe('AC-5 · 女巫的药水位', () => {
  it('用了 heal 的 witch 看到 heal: used、poison: available', () => {
    const night = playNight({ potion: 'heal' });
    const ctx = project({
      state: night.state,
      events: night.events,
      observer: night.witch,
      pending: null,
    });

    expect(ctx.knowledge.potions).toEqual({ heal: 'used', poison: 'available' });
  });

  it('没用过药的 witch 看到两项都 available', () => {
    const night = playNight({ potion: 'none' });
    const ctx = project({
      state: night.state,
      events: night.events,
      observer: night.witch,
      pending: null,
    });

    expect(ctx.knowledge.potions).toEqual({ heal: 'available', poison: 'available' });
  });
});

describe('AC-6 · canShoot 只在开枪阶段为真', () => {
  it('夜里被 wolf 刀掉的 hunter 在 NIGHT_HUNTER_SHOOT 得到 canShoot=true', () => {
    // 让 wolf 刀 hunter：跑到开枪阶段
    const lobby = lobbyState({ seed: 20_261_117 });
    const events: ReturnType<typeof step>['events'] = [];
    const push = (state: typeof lobby, action: Parameters<typeof step>[1]) => {
      const result = step(state, action);
      events.push(...result.events);
      return result.state;
    };
    let current = push(lobby, startActionOf(lobby, 1));
    for (let guard = 0; guard < 10 && current.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
      const speaker = current.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(current.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      current = push(current, { type: 'WOLF_CHAT', ts: 2, seat: speaker, text: '' });
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      if (current.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = current.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(current.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      current = push(current, { type: 'WOLF_READY', ts: 2, seat: readyWolf });
    }
    const hunter = seatOfRole(current, 'hunter');
    current = push(current, {
      type: 'WOLF_KILL',
      ts: 3,
      seat: seatOfAliveRole(current, 'wolf'),
      target: hunter,
    });
    const seer = seatOfAliveRole(current, 'seer');
    current = push(current, {
      type: 'SEER_CHECK',
      ts: 4,
      seat: seer,
      target: seatOfAliveRole(current, 'villager'),
    });
    const witch = seatOfAliveRole(current, 'witch');
    current = push(current, { type: 'WITCH_ACT', ts: 5, seat: witch, potion: 'none' });

    // RFC-022：首夜先竞选；全员不上警后公布死讯，才轮到大难不死的猎人开枪。
    if (current.phase === 'DAY_SHERIFF_SIGNUP') {
      const skipped = skipSheriffElection(current);
      events.push(...skipped.events);
      current = skipped.state;
    }

    expect(current.phase).toBe('NIGHT_HUNTER_SHOOT');

    const ctx = project({
      state: current,
      events,
      observer: hunter,
      pending: 'shoot',
    });
    expect(ctx.knowledge.canShoot).toBe(true);
  });

  it('同一个 hunter 在白天阶段 canShoot=false', () => {
    const night = playNight({});
    const hunter = seatOfRole(night.state, 'hunter');
    const ctx = project({
      state: night.state,
      events: night.events,
      observer: hunter,
      pending: null,
    });

    expect(ctx.knowledge.canShoot).toBe(false);
  });
});

describe('AC-7 · 女巫在用药阶段看得到刀口', () => {
  it('pending=witch 时 witch 得到 knownKillTarget', () => {
    // 停在 NIGHT_WITCH：用 runNight 的中间步骤重建
    const lobby = lobbyState({ seed: 20_261_117 });
    const events: ReturnType<typeof step>['events'] = [];
    const push = (state: typeof lobby, action: Parameters<typeof step>[1]) => {
      const result = step(state, action);
      events.push(...result.events);
      return result.state;
    };
    let current = push(lobby, startActionOf(lobby, 1));
    for (let guard = 0; guard < 10 && current.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
      const speaker = current.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(current.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      current = push(current, { type: 'WOLF_CHAT', ts: 2, seat: speaker, text: '' });
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      if (current.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = current.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(current.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      current = push(current, { type: 'WOLF_READY', ts: 2, seat: readyWolf });
    }
    const killTarget = seatOfAliveRole(current, 'villager');
    current = push(current, {
      type: 'WOLF_KILL',
      ts: 3,
      seat: seatOfAliveRole(current, 'wolf'),
      target: killTarget,
    });
    const seer = seatOfAliveRole(current, 'seer');
    current = push(current, {
      type: 'SEER_CHECK',
      ts: 4,
      seat: seer,
      target: seatOfAliveRole(current, 'villager'),
    });

    expect(current.phase).toBe('NIGHT_WITCH');
    const witch = seatOfAliveRole(current, 'witch');

    const ctx = project({ state: current, events, observer: witch, pending: 'witch' });
    expect(ctx.knowledge.knownKillTarget).toBe(killTarget);

    const noPending = project({ state: current, events, observer: witch, pending: null });
    expect(noPending.knowledge.knownKillTarget).toBeNull();
  });
});

describe('AC-8 / AC-9 · 分区互斥且并集等于可见事件', () => {
  it('同一场的 9 个观察者都无交集，且并集大小等于可见事件数', () => {
    const night = playNight({});
    for (const observer of SEAT_IDS) {
      const ctx = project({ state: night.state, events: night.events, observer, pending: null });
      const pub = ctx.publicEvents.map((e) => e.seq);
      const priv = ctx.privateEvents.map((e) => e.seq);

      expect(new Set(pub).size).toBe(pub.length);
      expect(new Set(priv).size).toBe(priv.length);
      for (const seq of pub) expect(priv).not.toContain(seq);
    }
  });
});
