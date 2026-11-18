import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { phaseVisibility } from '@engine/phases/visibility';

import { makeNightState, nightStart, reachWitch, roleSeat, run } from '../fixtures/night';

/**
 * C-23：夜间相位事件不得公开。
 *
 * 泄漏路径很具体：
 * - 跳过 `NIGHT_SEER` → 全场都知道 seer 已出局；
 * - 跳过 `NIGHT_WITCH` → 全场都知道 witch 已出局；
 * - 进入 `NIGHT_HUNTER_SHOOT` → 全场都知道 hunter 死于**狼刀**而不是毒杀。
 *
 * 而 RFC-007 的 `publicEvents` 会把 `visibleTo: 'public'` 的事件原样放进每个 AI 的上下文，
 * 所以这不只是「界面看到什么」，而是 AI 会不会推算出不该知道的身份状态（FR-9）。
 */

/**
 * 公开事件里**允许**的只有两种：天亮（相位推进到白天）与终局。
 * 其余任何公开事件都会携带隐藏信息，属于泄漏。
 */
function leaksOf(events: ReturnType<typeof run>['events']) {
  return events.filter((event) => {
    if (event.visibleTo !== 'public') return false;
    if (event.type === 'GAME_ENDED') return false;
    // 开枪是公开动作：全场都看得见「谁带走了谁」。
    if (event.type === 'HUNTER_SHOOT') return false;
    if (event.type === 'PHASE_CHANGED' && !event.payload.to.startsWith('NIGHT_')) return false;
    return true;
  });
}

describe('C-23 · phaseVisibility 规则', () => {
  it('夜间相位一律 server，白天相位 public', () => {
    expect(phaseVisibility('NIGHT_WOLF_CHAT')).toBe('server');
    expect(phaseVisibility('NIGHT_WOLVES')).toBe('server');
    expect(phaseVisibility('NIGHT_SEER')).toBe('server');
    expect(phaseVisibility('NIGHT_WITCH')).toBe('server');
    expect(phaseVisibility('NIGHT_RESOLVE')).toBe('server');
    expect(phaseVisibility('NIGHT_HUNTER_SHOOT')).toBe('server');

    expect(phaseVisibility('DAY_ANNOUNCE')).toBe('public');
    expect(phaseVisibility('DAY_VOTE')).toBe('public');
    expect(phaseVisibility('FINISHED')).toBe('public');
  });
});

describe('C-23 · 一整夜没有公开事件', () => {
  it('开局 + 狼刀 + 查验 + 用药的完整事件流里，公开事件数为 0', () => {
    const lobby = nightStart();
    const wolf = roleSeat(lobby, 'wolf');
    const killTarget = lobby.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
    if (killTarget === undefined) throw new Error('没有可刀目标');

    const afterKill = run(lobby, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: killTarget });
    const seer = roleSeat(afterKill.state, 'seer');
    const checkTarget = afterKill.state.seats.find(
      (seat) => seat.alive && seat.role !== 'seer',
    )?.seat;
    if (checkTarget === undefined) throw new Error('没有可查目标');
    const afterCheck = run(afterKill.state, {
      type: 'SEER_CHECK',
      ts: 2,
      seat: seer,
      target: checkTarget,
    });
    const witch = roleSeat(afterCheck.state, 'witch');
    const afterWitch = run(afterCheck.state, {
      type: 'WITCH_ACT',
      ts: 3,
      seat: witch,
      potion: 'none',
    });

    const all = [...afterKill.events, ...afterCheck.events, ...afterWitch.events];

    // 「天亮了」的相位推进是公开的，但它只含 from/to，不含任何身份或死因。
    expect(leaksOf(all)).toEqual([]);
    expect(afterWitch.state.phase).toBe('DAY_ANNOUNCE');
  });
});

describe('C-23 · 三个具体泄漏点', () => {
  it('seer 已出局时跳过 NIGHT_SEER 的相位事件是 server', () => {
    const state = makeNightState({ phase: 'NIGHT_WOLVES', deadSeats: [4] });
    const wolf = roleSeat(state, 'wolf');
    const target = state.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
    if (target === undefined) throw new Error('没有可刀目标');

    const { events, state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target,
    });

    const changed = events.filter((event) => event.type === 'PHASE_CHANGED');
    expect(changed.map((event) => event.visibleTo)).toEqual(['server']);
    expect(after.phase).toBe('NIGHT_WITCH');
  });

  it('witch 已出局时跳过 NIGHT_WITCH 的相位事件是 server', () => {
    const state = makeNightState({ phase: 'NIGHT_SEER', deadSeats: [5] });
    const seer = roleSeat(state, 'seer');
    const target = state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (target === undefined) throw new Error('没有可查目标');

    const { events, state: after } = run(state, { type: 'SEER_CHECK', ts: 1, seat: seer, target });

    expect(after.phase).toBe('DAY_ANNOUNCE');
    expect(leaksOf(events)).toEqual([]);
  });

  it('真实路径：狼刀 hunter → 查验 → 女巫 none，进开枪的相位事件必须是 server（B-R2-1）', () => {
    // 这条是 Round 2 抓到的缺口：`finishNight` 里 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT`
    // 曾硬编码 `public`，而当时的测试只断言 `phaseVisibility()` 的规则，改对改错都不会红。
    const hunter = 6 as SeatId;
    const base = makeNightState({ phase: 'NIGHT_WOLVES' });
    const wolf = roleSeat(base, 'wolf');

    const killed = run(base, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: hunter });
    expect(killed.state.phase).toBe('NIGHT_SEER');

    const seer = roleSeat(killed.state, 'seer');
    const checkTarget = killed.state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (checkTarget === undefined) throw new Error('没有可查目标');
    const checked = run(killed.state, {
      type: 'SEER_CHECK',
      ts: 2,
      seat: seer,
      target: checkTarget,
    });
    expect(checked.state.phase).toBe('NIGHT_WITCH');

    const witch = roleSeat(checked.state, 'witch');
    const acted = run(checked.state, { type: 'WITCH_ACT', ts: 3, seat: witch, potion: 'none' });

    expect(acted.state.phase).toBe('NIGHT_HUNTER_SHOOT');

    const toShoot = acted.events.filter(
      (event) => event.type === 'PHASE_CHANGED' && event.payload.to === 'NIGHT_HUNTER_SHOOT',
    );
    expect(toShoot).toHaveLength(1);
    expect(toShoot[0]?.visibleTo).toBe('server');

    // 整条夜的公开事件里不能有任何泄漏（开枪本身允许公开，但这一夜还没开枪）
    const all = [...killed.events, ...checked.events, ...acted.events];
    expect(leaksOf(all)).toEqual([]);
  });

  it('天亮的相位事件恢复 public（玩家该看到「天亮了」）', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 9,
      seat: witch,
      potion: 'none',
    });

    const toDay = events.filter(
      (event) => event.type === 'PHASE_CHANGED' && event.payload.to === 'DAY_ANNOUNCE',
    );
    expect(toDay).toHaveLength(1);
    expect(toDay[0]?.visibleTo).toBe('public');
  });
});
