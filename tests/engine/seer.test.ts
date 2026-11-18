import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { makeNightState, nightStart, roleSeat, run } from '../fixtures/night';

/**
 * AC-6：预言家查验（F3，RFC-003 §2.4）。
 *
 * 查验结果是**私有信息**：事件 `visibleTo: 'seer'`，只以事件存在，不写进 `state`——
 * 写进去就成了第二份来源，而投影（RFC-007）读的是事件。
 */

/** 进入 `NIGHT_SEER`：狼先下刀。 */
function reachSeer(seed = 20_261_117) {
  const atWolves = nightStart(seed);
  const wolf = roleSeat(atWolves, 'wolf');
  const target = atWolves.seats.find((seat) => seat.alive && seat.role !== 'wolf')?.seat;
  if (target === undefined) throw new Error('没有可刀目标');

  return run(atWolves, { type: 'WOLF_KILL', ts: 1_000, seat: wolf, target }).state;
}

function checkResultOf(events: ReturnType<typeof run>['events']) {
  const checked = events.find((event) => event.type === 'SEER_CHECKED');
  if (checked?.type !== 'SEER_CHECKED') throw new Error('没有 SEER_CHECKED 事件');
  return checked;
}

describe('AC-6 · 查验产出私有事件', () => {
  it('三种目标（wolf / 神 / 民）各查一次，result 与真实阵营一致', () => {
    const state = reachSeer();
    const seer = roleSeat(state, 'seer');

    const targets: SeatId[] = [
      state.seats.find((seat) => seat.role === 'wolf' && seat.alive)?.seat,
      state.seats.find((seat) => seat.role === 'witch')?.seat,
      state.seats.find((seat) => seat.role === 'villager')?.seat,
    ].filter((seat): seat is SeatId => seat !== undefined);

    expect(targets).toHaveLength(3);

    for (const target of targets) {
      const { events } = run(state, { type: 'SEER_CHECK', ts: 1_100, seat: seer, target });
      const checked = checkResultOf(events);
      const actualRole = state.seats.find((seat) => seat.seat === target)?.role;

      expect(['wolf', 'not-wolf']).toContain(checked.payload.result);
      expect(checked.payload.result).toBe(actualRole === 'wolf' ? 'wolf' : 'not-wolf');
      expect(checked.payload.target).toBe(target);
    }
  });

  it('可见性是 seer：只有预言家看得到', () => {
    const state = reachSeer();
    const seer = roleSeat(state, 'seer');
    const target = state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (target === undefined) throw new Error('没有可查目标');

    const { events } = run(state, { type: 'SEER_CHECK', ts: 1_100, seat: seer, target });

    expect(checkResultOf(events).visibleTo).toBe('seer');
  });

  it('查验后推进到女巫阶段，且 state 里不存查验结果', () => {
    const state = reachSeer();
    const seer = roleSeat(state, 'seer');
    const target = state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
    if (target === undefined) throw new Error('没有可查目标');

    const { state: after } = run(state, { type: 'SEER_CHECK', ts: 1_100, seat: seer, target });

    expect(after.phase).toBe('NIGHT_WITCH');
    // 状态里没有任何字段承载「查过谁 / 结果是什么」
    expect(JSON.stringify(after)).not.toContain('not-wolf');
  });
});

describe('AC-6 · 非法查验被拒', () => {
  it('查已出局席位 → TARGET_NOT_ALIVE', () => {
    const state = makeNightState({ phase: 'NIGHT_SEER', deadSeats: [9] });
    const seer = roleSeat(state, 'seer');

    const { events } = run(state, { type: 'SEER_CHECK', ts: 1, seat: seer, target: 9 });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'TARGET_NOT_ALIVE' }));
  });

  it('非预言家提交 → NOT_YOUR_TURN', () => {
    const state = makeNightState({ phase: 'NIGHT_SEER' });
    const villager = state.seats.find((seat) => seat.role === 'villager')?.seat;
    if (villager === undefined) throw new Error('没有 villager');

    const { events } = run(state, { type: 'SEER_CHECK', ts: 1, seat: villager, target: 1 });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });

  it('预言家已出局时该阶段不接受任何 action（PHASE_MISMATCH）', () => {
    const state = makeNightState({ phase: 'NIGHT_WITCH' });
    const seer = state.seats.find((seat) => seat.role === 'seer')?.seat;
    if (seer === undefined) throw new Error('没有 seer');

    const { events } = run(state, { type: 'SEER_CHECK', ts: 1, seat: seer, target: 1 });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
  });
});
