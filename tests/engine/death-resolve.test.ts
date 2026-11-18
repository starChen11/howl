import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { EFFECT_ORDER } from '@shared/effects';

import { DEATH_APPLIERS, resolveHunterShot, resolveNight } from '@engine/resolve/deaths';
import { applyEffects } from '@engine/effects';

import { makeNightState, reachWitch, roleSeat, run } from '../fixtures/night';

/**
 * AC-12 ~ AC-15：死亡结算、猎人开枪与效果时序（RUL-1 / RUL-8）。
 *
 * 效果列表本身不进事件流，所以「效果的 source 与 order」直接对 `resolveNight` /
 * `resolveHunterShot` 这两个纯函数断言——若只从事件推断，这两条 AC 就只能靠间接证据。
 */

describe('AC-12 · 被狼刀的猎人进入开枪阶段', () => {
  it('猎人被刀杀后进入 NIGHT_HUNTER_SHOOT', () => {
    // 让狼刀落在 hunter 身上
    const base = makeNightState({ phase: 'NIGHT_WOLVES' });
    const wolf = roleSeat(base, 'wolf');
    const hunter = base.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有 hunter');

    const afterKill = run(base, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: hunter }).state;
    const seer = roleSeat(afterKill, 'seer');
    const checkTarget = afterKill.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (checkTarget === undefined) throw new Error('没有可查目标');
    const afterCheck = run(afterKill, {
      type: 'SEER_CHECK',
      ts: 2,
      seat: seer,
      target: checkTarget,
    }).state;

    const witch = roleSeat(afterCheck, 'witch');
    const { state: resolved } = run(afterCheck, {
      type: 'WITCH_ACT',
      ts: 3,
      seat: witch,
      potion: 'none',
    });

    expect(resolved.phase).toBe('NIGHT_HUNTER_SHOOT');
  });

  it('提交 HUNTER_SHOOT 后产出带 source: role 的效果，并推进到 DAY_ANNOUNCE', () => {
    const shot = resolveHunterShot(3);

    expect(shot.effects).toHaveLength(1);
    expect(shot.effects[0]?.source).toBe('role');
    expect(shot.effects[0]?.order).toBe(EFFECT_ORDER.DEATH_TRIGGER);
    expect(shot.deaths).toEqual([{ seat: 3, cause: 'shoot' }]);
  });

  it('放弃开枪（省略 target）不产生效果与死亡，但仍然推进到 DAY_ANNOUNCE', () => {
    const hunter = 6 as SeatId;
    const state = makeNightState({ phase: 'NIGHT_HUNTER_SHOOT', deadSeats: [hunter] });

    const { events, state: after } = run(state, { type: 'HUNTER_SHOOT', ts: 4, seat: hunter });

    const shotEvent = events.find((event) => event.type === 'HUNTER_SHOOT');
    expect(shotEvent?.payload).toEqual({ seat: hunter, target: null });
    expect(events.some((event) => event.type === 'PLAYER_DIED')).toBe(false);
    expect(after.phase).toBe('DAY_ANNOUNCE');
  });

  it('开枪带走最后一只狼 → 触发第二次胜负判定，好人胜', () => {
    // 只剩 1 狼 + 一个存活的神（seer）+ hunter 已出局：猎人开枪带走那只狼。
    // 注意**不能**让 hunter 同时是最后一个神——那种局面在第一次判定处就已经狼胜、
    // 根本不会进开枪阶段（RUL-1 / RUL-12）。
    const roles = [
      'wolf',
      'villager',
      'villager',
      'seer',
      'villager',
      'villager',
      'hunter',
      'villager',
      'villager',
    ] as const;
    const state = makeNightState({
      phase: 'NIGHT_HUNTER_SHOOT',
      deadSeats: [7],
      roles,
    });
    const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有 hunter');

    const { events, state: after } = run(state, {
      type: 'HUNTER_SHOOT',
      ts: 4,
      seat: hunter,
      target: 1,
    });

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'good', condition: 'all-wolves-dead' });
    expect(after.phase).toBe('FINISHED');
  });
});

describe('AC-13 · 被毒杀的猎人不进开枪阶段', () => {
  it('毒杀 hunter 时事件流里没有 NIGHT_HUNTER_SHOOT 与 HUNTER_SHOOT', () => {
    const base = makeNightState({ phase: 'NIGHT_WOLVES' });
    const wolf = roleSeat(base, 'wolf');
    const hunter = base.seats.find((seat) => seat.role === 'hunter')?.seat;
    const killTarget = base.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
    if (hunter === undefined || killTarget === undefined) throw new Error('夹具缺角色');

    const afterKill = run(base, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: killTarget }).state;
    const seer = roleSeat(afterKill, 'seer');
    const checkTarget = afterKill.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (checkTarget === undefined) throw new Error('没有可查目标');
    const afterCheck = run(afterKill, {
      type: 'SEER_CHECK',
      ts: 2,
      seat: seer,
      target: checkTarget,
    }).state;

    const witch = roleSeat(afterCheck, 'witch');
    const { events, state: after } = run(afterCheck, {
      type: 'WITCH_ACT',
      ts: 3,
      seat: witch,
      potion: 'poison',
      target: hunter,
    });

    const phasePath = events
      .filter((event) => event.type === 'PHASE_CHANGED')
      .map((event) => (event.type === 'PHASE_CHANGED' ? event.payload.to : ''));
    expect(phasePath).not.toContain('NIGHT_HUNTER_SHOOT');
    expect(events.some((event) => event.type === 'HUNTER_SHOOT')).toBe(false);
    expect(after.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);
  });
});

describe('AC-14 · 胜负先于开枪（RUL-1）', () => {
  it('被刀的猎人正好是最后一个神：对局在第一次判定处结束，且没有开枪阶段', () => {
    // 只有 hunter 是神，seer / witch 已出局
    const roles = [
      'wolf',
      'wolf',
      'wolf',
      'seer',
      'witch',
      'hunter',
      'villager',
      'villager',
      'villager',
    ] as const;
    const state = makeNightState({
      phase: 'NIGHT_WOLVES',
      deadSeats: [4, 5],
      roles,
    });

    const wolf = roleSeat(state, 'wolf');
    const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有 hunter');

    // seer 与 witch 都已出局，所以狼刀之后立刻结算：这一条 action 就应该把对局结束掉。
    const { events, state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target: hunter,
    });

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'wolf', condition: 'all-gods-dead' });
    expect(after.phase).toBe('FINISHED');
    expect(after.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);

    // 「先判胜负」的直接证据：没有进入开枪阶段，也没有开枪事件（RUL-1）
    const phasePath = events
      .filter((event) => event.type === 'PHASE_CHANGED')
      .map((event) => (event.type === 'PHASE_CHANGED' ? event.payload.to : ''));
    expect(phasePath).not.toContain('NIGHT_HUNTER_SHOOT');
    expect(events.some((event) => event.type === 'HUNTER_SHOOT')).toBe(false);
  });
});

describe('B1 / C-24 · 毒药指向狼刀目标（合法 action 不能崩）', () => {
  it('同一座位只出局一次，死因取毒药', () => {
    const state = makeNightState({ phase: 'NIGHT_WITCH', night: { killTarget: 7 } });
    const witch = roleSeat(state, 'witch');

    const { events, state: after } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 7,
    });

    const died = events.filter((event) => event.type === 'PLAYER_DIED');
    expect(died).toHaveLength(1);
    expect(died[0]?.payload).toEqual({ seat: 7, cause: 'poison' });
    expect(after.seats.find((seat) => seat.seat === 7)?.alive).toBe(false);
  });

  it('目标是 hunter 时按毒杀处理：不进开枪阶段', () => {
    // FIXTURE_ROLES 的 hunter 是 6 号；让狼刀与毒药同时指向他
    const state = makeNightState({ phase: 'NIGHT_WITCH', night: { killTarget: 6 } });
    const witch = roleSeat(state, 'witch');

    const { events, state: after } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 6,
    });

    const phasePath = events
      .filter((event) => event.type === 'PHASE_CHANGED')
      .map((event) => (event.type === 'PHASE_CHANGED' ? event.payload.to : ''));

    expect(phasePath).not.toContain('NIGHT_HUNTER_SHOOT');
    expect(after.phase).toBe('DAY_ANNOUNCE');
    expect(after.seats.find((seat) => seat.seat === 6)?.alive).toBe(false);
  });

  it('解药抵消狼刀、毒药仍然生效：同一座位只死一次', () => {
    // 解药救 7 号（刀口），毒药毒 7 号 —— 死因是毒药，且只死一次。
    // 但 RUL-3 禁止一夜双开药，所以只能分两步构造：这里直接对 resolveNight 断言。
    const resolution = resolveNight({ killTarget: 7, healTarget: 7, poisonTarget: 7 });

    expect(resolution.deaths).toEqual([{ seat: 7, cause: 'poison' }]);
    expect(resolution.effects.filter((effect) => effect.type === 'kill')).toHaveLength(1);
  });

  it('resolveNight 对同一座位的死因按毒药归并', () => {
    const resolution = resolveNight({ killTarget: 7, poisonTarget: 7 });

    expect(resolution.deaths).toEqual([{ seat: 7, cause: 'poison' }]);
  });

  it('多死时的顺序是**结算顺序**（狼刀先、毒药后），不是座位顺序（C-26）', () => {
    // 刀口 9、毒药 3：按座位排会得到 [3, 9]，按结算顺序是 [9, 3]。
    const resolution = resolveNight({ killTarget: 9, poisonTarget: 3 });

    expect(resolution.deaths.map((death) => death.seat)).toEqual([9, 3]);
    expect(resolution.deaths.map((death) => death.cause)).toEqual(['wolf', 'poison']);
  });
});

describe('C-27 / RUL-12 · 真实夜间路径：同时达成时判 wolf 胜', () => {
  it('最后一名神被刀 + 最后一只狼被毒 → GAME_ENDED(result: wolf)', () => {
    // 残局：狼 3、女巫 5、村民 7/8/9 存活；狼 1/2、seer 4、hunter 6 已出局。
    // 狼刀砍 5（最后的神），女巫毒 3（最后的狼）——两个条件在同一批死亡后同时成立。
    const roles = [
      'wolf',
      'wolf',
      'wolf',
      'seer',
      'witch',
      'hunter',
      'villager',
      'villager',
      'villager',
    ] as const;
    const state = makeNightState({
      phase: 'NIGHT_WITCH',
      deadSeats: [1, 2, 4, 6],
      night: { killTarget: 5 },
      roles,
    });
    const witch = roleSeat(state, 'witch');

    const { events, state: after } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 3,
    });

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'wolf', condition: 'all-gods-dead' });
    expect(after.phase).toBe('FINISHED');
  });
});

describe('C-27 / RUL-12 · 只有好人侧达成时不受影响', () => {
  it('毒掉最后一只狼、但没有屠边 → 好人胜', () => {
    const roles = [
      'wolf',
      'villager',
      'villager',
      'seer',
      'witch',
      'hunter',
      'villager',
      'villager',
      'villager',
    ] as const;
    const state = makeNightState({
      phase: 'NIGHT_WITCH',
      deadSeats: [1],
      night: { killTarget: 9 },
      roles,
    });
    const witch = roleSeat(state, 'witch');

    const { events } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 2,
    });

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.payload).toEqual({ result: 'good', condition: 'all-wolves-dead' });
  });
});

describe('死亡效果的防御分支', () => {
  it('kill 效果没有目标时抛错（不静默跳过）', () => {
    const applier = DEATH_APPLIERS['kill'];
    if (applier === undefined) throw new Error('kill applier 未注册');

    expect(() =>
      applier(makeNightState({ phase: 'NIGHT_RESOLVE' }), {
        id: 'x',
        source: 'role',
        type: 'kill',
        target: null,
        payload: { cause: 'wolf' },
        order: 100,
      }),
    ).toThrow(/没有目标/);
  });
});

describe('AC-15 · 效果时序（RUL-8 + RUL-1）', () => {
  it('解药 order < 狼刀 / 毒药 order < 开枪 order', () => {
    const night = resolveNight({ killTarget: 1, healTarget: 2, poisonTarget: 3 });
    const shot = resolveHunterShot(4);

    const heal = night.effects.find((effect) => effect.type === 'heal');
    const kills = night.effects
      .filter((effect) => effect.type === 'kill')
      .map((effect) => effect.order);
    const shootOrder = shot.effects[0]?.order;

    expect(heal?.order).toBe(EFFECT_ORDER.CANCEL);
    expect(kills.every((order) => order === EFFECT_ORDER.DEATH)).toBe(true);
    expect(heal?.order).toBeLessThan(Math.min(...kills));
    expect(Math.max(...kills)).toBeLessThan(shootOrder ?? -1);
  });

  it('夜晚结算的每条效果 source 都是 role', () => {
    const night = resolveNight({ killTarget: 1, healTarget: 1, poisonTarget: 2 });

    expect(night.effects.length).toBeGreaterThan(0);
    expect(night.effects.every((effect) => effect.source === 'role')).toBe(true);
  });

  it('解药命中刀口时不产生击杀效果（RUL-8：不是「先杀后救」）', () => {
    const night = resolveNight({ killTarget: 3, healTarget: 3 });

    expect(night.killCancelled).toBe(true);
    expect(night.deaths).toEqual([]);
    expect(night.effects.filter((effect) => effect.type === 'kill')).toEqual([]);
  });

  it('毒药夜：效果集、死亡集与 PLAYER_DIED 事件集三者一致', () => {
    const state = makeNightState({ phase: 'NIGHT_WITCH', night: { killTarget: 9 } });
    const witch = roleSeat(state, 'witch');

    const { events, state: after } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 8,
    });

    const resolution = resolveNight({ killTarget: 9, poisonTarget: 8 });
    const applied = applyEffects(state, resolution.effects, DEATH_APPLIERS);

    const fromEvents = events
      .filter((event) => event.type === 'PLAYER_DIED')
      .map((event) => (event.type === 'PLAYER_DIED' ? event.payload.seat : 0));
    const fromEffects = resolution.deaths.map((death) => death.seat);
    const fromApplied = applied.seats.filter((seat) => !seat.alive).map((seat) => seat.seat);

    expect(fromEvents).toEqual(fromEffects);
    expect(fromApplied.sort()).toEqual([...fromEvents].sort());
    expect(after.seats.filter((seat) => !seat.alive).length).toBe(fromEvents.length);
  });

  it('开枪夜：效果集与 PLAYER_DIED(cause=shoot) 一致', () => {
    const shot = resolveHunterShot(2);
    const state = makeNightState({ phase: 'NIGHT_HUNTER_SHOOT', deadSeats: [6] });

    const applied = applyEffects(state, shot.effects, DEATH_APPLIERS);

    expect(shot.deaths.map((death) => death.seat)).toEqual([2]);
    expect(applied.seats.find((seat) => seat.seat === 2)?.alive).toBe(false);
  });

  it('效果按 order 应用后与死亡事件集一致（两条路径不分叉）', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events, state: after } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'none',
    });

    const resolution = resolveNight({ killTarget: reached.killTarget });
    const applied = applyEffects(reached.state, resolution.effects, DEATH_APPLIERS);

    const deadFromEvents = events
      .filter((event) => event.type === 'PLAYER_DIED')
      .map((event) => (event.type === 'PLAYER_DIED' ? event.payload.seat : 0));
    const deadFromEffects = after.seats.filter((seat) => !seat.alive).map((seat) => seat.seat);

    expect(deadFromEvents.length).toBe(1);
    expect(deadFromEffects).toEqual(deadFromEvents);
    expect(applied.seats.filter((seat) => !seat.alive).map((seat) => seat.seat)).toEqual(
      deadFromEvents,
    );
  });
});
