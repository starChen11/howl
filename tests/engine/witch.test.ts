import { describe, expect, it } from 'vitest';

import { step } from '@engine/step';

import { makeNightState, reachWitch, roleSeat, run } from '../fixtures/night';

/**
 * AC-7 ~ AC-11：女巫（RUL-3 / RUL-8 / FR-17）。
 *
 * 药水位是**派生字段**（C-18）：只由 `applyEvent` 从 `WITCH_POTION_USED` 写，`replay` 必然
 * 重建。所以「次夜复用已用药」这条用一个构造的第二夜状态来测，而不是等 RFC-004 的白天。
 */

describe('AC-7 · 解药不能自救', () => {
  it('heal 指向自己 → WITCH_SELF_SAVE', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: witch,
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'WITCH_SELF_SAVE' }));
  });

  it('毒药可以指向自己（Q-003-4：只禁解药自救）', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'poison',
      target: witch,
    });

    expect(events[0]?.type).toBe('WITCH_POTION_USED');
  });
});

describe('AC-8（修正版）· 同一夜的第二次用药', () => {
  it('用药后阶段已结束，再提交是 PHASE_MISMATCH（不是 NOT_YOUR_TURN）', () => {
    // AC-8 原文要求 `NOT_YOUR_TURN`，但它的括号写的是「该阶段已结束」——按 RFC-002 §2.3 的
    // 机械判据，阶段已经不在 NIGHT_WITCH，因此是 PHASE_MISMATCH。`NOT_YOUR_TURN` 保留给
    // 「阶段对、但提交者不是该阶段的行动者」。见 §8 的 AC 修正记录。
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const first = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: reached.killTarget,
    });
    const second = run(first.state, {
      type: 'WITCH_ACT',
      ts: 1_201,
      seat: witch,
      potion: 'poison',
      target: reached.killTarget,
    });

    expect(second.events[0]?.type).toBe('REJECTED');
    expect(second.events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
  });

  it('非女巫在 NIGHT_WITCH 提交 → NOT_YOUR_TURN', () => {
    const reached = reachWitch();
    const villager = reached.state.seats.find((seat) => seat.role === 'villager')?.seat;
    if (villager === undefined) throw new Error('没有 villager');

    const { events } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: villager,
      potion: 'none',
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });
});

describe('AC-9 · 次夜复用已用药被拒（药水位由事件流推导）', () => {
  it('解药用过之后再用 → POTION_ALREADY_USED', () => {
    const state = makeNightState({
      phase: 'NIGHT_WITCH',
      night: { killTarget: 1 },
      potionsUsed: { heal: true, poison: false },
    });
    const witch = roleSeat(state, 'witch');

    const { events } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'heal',
      target: 2,
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'POTION_ALREADY_USED' }));
  });

  it('毒药用过之后再用 → POTION_ALREADY_USED', () => {
    const state = makeNightState({
      phase: 'NIGHT_WITCH',
      night: { killTarget: 1 },
      potionsUsed: { heal: false, poison: true },
    });
    const witch = roleSeat(state, 'witch');

    const { events } = run(state, {
      type: 'WITCH_ACT',
      ts: 1,
      seat: witch,
      potion: 'poison',
      target: 3,
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'POTION_ALREADY_USED' }));
  });

  it('药水位确实由事件折叠而来：用药后 replay 仍在', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const result = step(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: reached.killTarget,
    });

    expect(result.state.potionsUsed?.heal).toBe(true);
    expect(result.events.some((event) => event.type === 'WITCH_POTION_USED')).toBe(true);
  });
});

describe('AC-10 · 解药命中刀口：当夜无人出局（RUL-8）', () => {
  it('事件流里没有 PLAYER_DIED', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events, state: after } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: reached.killTarget,
    });

    expect(events.some((event) => event.type === 'PLAYER_DIED')).toBe(false);
    expect(after.seats.find((seat) => seat.seat === reached.killTarget)?.alive).toBe(true);
    expect(after.phase).toBe('DAY_ANNOUNCE');
  });
});

describe('AC-11 · 解药目标与刀口不同：只有刀口出局', () => {
  it('刀口出局、被救目标存活，且只有一条 PLAYER_DIED', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');
    const healTarget = reached.state.seats.find(
      (seat) => seat.alive && seat.seat !== reached.killTarget && seat.role === 'villager',
    )?.seat;
    if (healTarget === undefined) throw new Error('没有可救的 villager');

    const { events, state: after } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: healTarget,
    });

    const died = events.filter((event) => event.type === 'PLAYER_DIED');
    expect(died).toHaveLength(1);
    expect(died[0]?.payload).toEqual(expect.objectContaining({ seat: reached.killTarget }));

    expect(after.seats.find((seat) => seat.seat === reached.killTarget)?.alive).toBe(false);
    expect(after.seats.find((seat) => seat.seat === healTarget)?.alive).toBe(true);
  });

  it('毒药另加一条出局，且两人都死', () => {
    const reached = reachWitch();
    const poisonTarget = reached.state.seats.find(
      (seat) => seat.alive && seat.seat !== reached.killTarget && seat.role === 'villager',
    )?.seat;
    if (poisonTarget === undefined) throw new Error('没有可毒目标');

    // 解药没用：先让女巫选 none 会结束阶段，所以这里让毒药与刀口同时生效。
    const state = makeNightState({
      phase: 'NIGHT_WITCH',
      night: { killTarget: reached.killTarget },
    });
    const witch2 = roleSeat(state, 'witch');

    const { events, state: after } = run(state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch2,
      potion: 'poison',
      target: poisonTarget,
    });

    const died = events
      .filter((event) => event.type === 'PLAYER_DIED')
      .map((event) => event.payload);
    expect(died).toEqual([
      expect.objectContaining({ seat: reached.killTarget, cause: 'wolf' }),
      expect.objectContaining({ seat: poisonTarget, cause: 'poison' }),
    ]);
    expect(
      after.seats
        .filter((seat) => !seat.alive)
        .map((seat) => seat.seat)
        .sort(),
    ).toEqual([reached.killTarget, poisonTarget].sort());
  });

  it('witch 选 none：当夜只有刀口出局，且不产出 WITCH_POTION_USED', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const { events } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'none',
    });

    expect(events.some((event) => event.type === 'WITCH_POTION_USED')).toBe(false);
    const died = events.filter((event) => event.type === 'PLAYER_DIED');
    expect(died).toHaveLength(1);
    expect(died[0]?.payload).toEqual(expect.objectContaining({ seat: reached.killTarget }));
  });
});
