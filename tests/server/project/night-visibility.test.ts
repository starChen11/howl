import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';

import { project } from '@server/project';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';
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
function runTo(target: 'NIGHT_SEER' | 'NIGHT_WITCH' | 'NIGHT_HUNTER_SHOOT') {
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

  it('当夜死者不出现在 deadSeats 里（等天亮公布）', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');

    // 引擎里他确实已经出局
    expect(state.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);

    for (const observer of SEAT_IDS) {
      const ctx = project({ state, events, observer, pending: null });
      expect(ctx.deadSeats, `observer=${observer}`).not.toContain(hunter);
    }
  });

  it('天亮之后，当夜死者才出现在 deadSeats', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    // 让 hunter 放弃开枪 → 进入白天
    const hunter = seatOfRole(state, 'hunter');
    const shot = step(state, { type: 'HUNTER_SHOOT', ts: 6, seat: hunter });
    const full = [...events, ...shot.events];
    expect(shot.state.phase).toBe('DAY_SPEECH');

    const ctx = project({ state: shot.state, events: full, observer: 1, pending: null });
    expect(ctx.phase).toBe('DAY_SPEECH');
    expect(ctx.deadSeats).toContain(hunter);
  });
});

describe('C-28 · aliveSeats 与 legalTargets 的口径', () => {
  it('夜里当夜死者仍算「活着」（观察者还不知道他死了）', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');
    if (state.seats.find((seat) => seat.seat === hunter)?.alive !== false) {
      throw new Error('夹具前提不成立：hunter 应当已出局');
    }

    const ctx = project({ state, events, observer: 1, pending: null });
    expect(ctx.aliveSeats).toContain(hunter);
  });

  it('夜里 legalTargets 用「已知存活」：当夜死者仍在候选里（否则目标消失=泄漏）', () => {
    const { state, events } = runTo('NIGHT_HUNTER_SHOOT');
    const hunter = seatOfRole(state, 'hunter');
    // 引擎里他已经出局，但观察者还不知道——所以他还应在候选名单里
    expect(state.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);

    const ctx = project({ state, events, observer: 1, pending: 'vote' });
    expect(ctx.legalTargets).toContain(hunter);
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
