import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';

import { project } from '@server/project';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';
import { skipSheriffElection } from '../../helpers/sheriff';
import { seatOfAliveRole, seatOfRole } from '../../helpers/roles';

/**
 * C-28：夜间投影不得泄漏隐藏信息。
 *
 * 三个具体泄漏点（每一条都能从投影反推出身份存活状态）：
 * - 看到 `NIGHT_SEER` → seer 还活着；
 * - 看到 `NIGHT_WITCH` → witch 还活着；
 * - 看到 `NIGHT_HUNTER_SHOOT` → hunter 今夜被 wolf 刀杀（被毒杀不会开枪）。
 *
 * 用户裁决：夜里一律告诉观察者「天黑了」，当夜死者等天亮公布。
 */

/** 跑到指定阶段，返回状态与完整事件流。 */
function runTo(target: 'NIGHT_SEER' | 'NIGHT_WITCH' | 'NIGHT_HUNTER_SHOOT' | 'DAY_SHERIFF_SIGNUP') {
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
  if (current.phase === target) return { state: current, events };

  const hunter = seatOfRole(current, 'hunter');
  const killTarget: SeatId =
    target === 'NIGHT_HUNTER_SHOOT' ? hunter : seatOfAliveRole(current, 'villager');

  current = push(current, {
    type: 'WOLF_KILL',
    ts: 3,
    seat: seatOfAliveRole(current, 'wolf'),
    target: killTarget,
  });
  if (current.phase === target) return { state: current, events };

  const seer = seatOfAliveRole(current, 'seer');
  current = push(current, {
    type: 'SEER_CHECK',
    ts: 4,
    seat: seer,
    target: seatOfAliveRole(current, 'villager'),
  });
  if (current.phase === target) return { state: current, events };

  const witch = seatOfAliveRole(current, 'witch');
  current = push(current, { type: 'WITCH_ACT', ts: 5, seat: witch, potion: 'none' });

  // 竞选阶段本身也是「死讯未公布」的观察窗口：死亡只是被算出来，还没落地。
  if (current.phase === target) return { state: current, events };

  // RFC-022：首夜结算后先进竞选；全员不上警 → 公布死讯 → 首夜猎人开枪。
  if (current.phase === 'DAY_SHERIFF_SIGNUP') {
    const skipped = skipSheriffElection(current);
    events.push(...skipped.events);
    current = skipped.state;
  }
  return { state: current, events };
}

describe('C-28 · 夜里只告诉观察者「天黑了」', () => {
  it('三个夜间子阶段都投影成 NIGHT', () => {
    for (const target of ['NIGHT_SEER', 'NIGHT_WITCH', 'NIGHT_HUNTER_SHOOT'] as const) {
      const { state, events } = runTo(target);
      expect(state.phase).toBe(target);

      for (const observer of SEAT_IDS) {
        const ctx = project({ state, events, observer, pending: null });
        expect(ctx.phase, `${target} observer=${observer}`).toBe('NIGHT');
      }
    }
  });

  it('竞选期间死者不落地（死讯还没公布）', () => {
    // 首夜死亡在 `NIGHT_RESOLVE` 只算出来、不落地（RFC-022 §13.1）；竞选期间
    // 9 个人在引擎与投影里都仍然 alive。
    const { state, events } = runTo('DAY_SHERIFF_SIGNUP');
    expect(state.night?.killTarget).toBeDefined();

    for (const observer of SEAT_IDS) {
      const ctx = project({ state, events, observer, pending: null });
      expect(ctx.deadSeats, `observer=${observer}`).toEqual([]);
      expect(ctx.aliveSeats).toHaveLength(9);
    }
  });

  it('天亮之后，当夜死者才出现在 deadSeats', () => {
    // 首夜猎人被刀：竞选 → 公布死讯 → 开枪（RFC-022 §11 的用户裁决）。
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');
    // 死讯已在 `DAY_ANNOUNCE` 公布，此时投影应该已经知道 hunter 出局。
    const before = project({ state, events, observer: 1, pending: null });
    expect(before.deadSeats).toContain(hunter);

    const shot = step(state, { type: 'HUNTER_SHOOT', ts: 6, seat: hunter });
    const full = [...events, ...shot.events];
    expect(shot.state.phase).toBe('DAY_SPEECH');

    const ctx = project({ state: shot.state, events: full, observer: 1, pending: null });
    expect(ctx.phase).toBe('DAY_SPEECH');
    expect(ctx.deadSeats).toContain(hunter);
  });
});

describe('C-28 · aliveSeats 与 legalTargets 的口径', () => {
  it('竞选期间当夜死者仍算「活着」（死亡还没落地）', () => {
    // 首夜死亡延后到公布才落地：竞选期间引擎里 9 人仍然 alive，投影自然也是 9 人。
    const { state, events } = runTo('DAY_SHERIFF_SIGNUP');
    const killed = state.night?.killTarget;
    expect(killed).toBeDefined();

    const ctx = project({ state, events, observer: 1, pending: null });
    expect(ctx.aliveSeats).toContain(killed);
  });

  it('竞选期间的夜间目标用「已知存活」：当夜死者仍在候选里（否则目标消失=泄漏）', () => {
    const { state, events } = runTo('DAY_SHERIFF_SIGNUP');
    const killed = state.night?.killTarget;
    expect(killed).toBeDefined();

    // 用夜间技能（查验）代表夜间目标；白天投票在公布后改用引擎真值。
    const ctx = project({ state, events, observer: 1, pending: 'check' });
    expect(ctx.legalTargets).toContain(killed);
  });

  it('legalTargets 不含观察者自己', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');

    const ctx = project({ state, events, observer: hunter, pending: 'shoot' });
    expect(ctx.legalTargets).not.toContain(hunter);
  });

  it('投票阶段的 legalTargets 是「已知存活 + 弃权」', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');
    const shot = step(state, { type: 'HUNTER_SHOOT', ts: 6, seat: hunter });
    const full = [...events, ...shot.events];

    const ctx = project({ state: shot.state, events: full, observer: 1, pending: 'vote' });
    expect(ctx.legalTargets).toContain('abstain');
    expect(ctx.legalTargets).not.toContain(1);
  });
});

describe('C-28 · 终局视为全部死亡已揭示', () => {
  it('夜间直接终局时，deadSeats 包含当夜死者', () => {
    // 用 FIXTURE 构造一个「夜里终局」的状态是不行的（要走真实路径），这里直接改终态：
    // 终局是「身份与死亡全部揭示」的唯一例外，语义上等价于复盘。
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');
    const finished = {
      ...state,
      phase: 'FINISHED' as const,
      seats: state.seats.map((seat) => (seat.seat === hunter ? { ...seat, alive: false } : seat)),
    };

    const ctx = project({ state: finished, events, observer: 1, pending: null });
    expect(ctx.deadSeats).toContain(hunter);
  });
});
