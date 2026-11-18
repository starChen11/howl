import { describe, expect, it } from 'vitest';

import { nightActorOf } from '@engine/phases/night';
import { step } from '@engine/step';

import {
  anyRoleSeat,
  goodTarget,
  makeNightState,
  nightStart,
  reachWitch,
  roleAt,
  roleSeat,
  run,
} from '../fixtures/night';

/**
 * AC-4 / AC-5（以及 AC-16 的修正版）：狼人阶段与夜晚的边界。
 *
 * AC-16 的原文要求「对本 phase 提交任何 action 均抛 `UnhandledTransitionError`」，但 RFC-002
 * §2.3 的判据是「**在**允许集合内却没有 handler」才抛。`DAY_ANNOUNCE` 是自动阶段（RFC-004 的 B 方案），
 * 它没有允许的 action，所以任何
 * action 都是 `PHASE_MISMATCH`（拒绝）。按后者实现，见 §8 的 AC 修正记录。
 */

describe('AC-4 · 狼人下刀产出私有事件', () => {
  it('WOLF_KILL 产出 WOLF_KILL_CHOSEN，可见性是 wolves', () => {
    const state = nightStart();
    const wolf = roleSeat(state, 'wolf');
    const target = goodTarget(state);

    const { events, state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1_000,
      seat: wolf,
      target,
    });

    const chosen = events.find((event) => event.type === 'WOLF_KILL_CHOSEN');
    expect(chosen?.visibleTo).toBe('wolves');
    expect(chosen?.payload).toEqual({ target });
    expect(after.night?.killTarget).toBe(target);
  });

  it('下刀后推进到预言家阶段', () => {
    const state = nightStart();
    const { state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1_000,
      seat: roleSeat(state, 'wolf'),
      target: goodTarget(state),
    });

    expect(after.phase).toBe('NIGHT_SEER');
  });
});

describe('AC-5 · 非法刀口被拒，且状态除 seq 外不变', () => {
  it('目标已出局 → TARGET_NOT_ALIVE', () => {
    const state = makeNightState({ phase: 'NIGHT_WOLVES', deadSeats: [9] });
    const wolf = roleSeat(state, 'wolf');

    const { events, state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target: 9,
    });

    expect(events[0]?.type).toBe('REJECTED');
    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'TARGET_NOT_ALIVE' }));
    expect(after.seq).toBe(state.seq + 1);
    expect({ ...after, seq: state.seq }).toEqual(state);
  });

  it('目标是狼队友 → WOLF_KILL_WOLF', () => {
    const state = nightStart();
    const wolf = roleSeat(state, 'wolf');
    const otherWolf = state.seats.find(
      (seat) => seat.role === 'wolf' && seat.seat !== wolf && seat.alive,
    )?.seat;
    if (otherWolf === undefined) throw new Error('夹具里只有一个狼');

    const { events, state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target: otherWolf,
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'WOLF_KILL_WOLF' }));
    // 与 TARGET_NOT_ALIVE 同一条 AC：状态除 seq 外不变（评审 N2）
    expect(after.seq).toBe(state.seq + 1);
    expect({ ...after, seq: state.seq }).toEqual(state);
  });

  it('非狼提交 → NOT_YOUR_TURN（阶段对，但行动者不对）', () => {
    const state = nightStart();
    const villager = anyRoleSeat(state, 'villager');

    const { events } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: villager,
      target: goodTarget(state),
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });

  it('拒绝事件的可见性是提交者本人才看得到', () => {
    const state = nightStart();
    const wolf = roleSeat(state, 'wolf');

    const { events } = run(state, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: wolf });

    expect(events[0]?.visibleTo).toBe(`self:${wolf}`);
  });
});

describe('AC-16（修正版）· 夜晚结束后的边界', () => {
  it('夜晚无人出局时进入白天（停在 DAY_SPEECH；DAY_ANNOUNCE 是自动阶段，不停留）', () => {
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');
    const killTarget = reached.killTarget;

    const { state: after } = run(reached.state, {
      type: 'WITCH_ACT',
      ts: 1_200,
      seat: witch,
      potion: 'heal',
      target: killTarget,
    });

    expect(after.phase).toBe('DAY_SPEECH');
  });

  it('在 DAY_ANNOUNCE 提交任何 action 都被拒（PHASE_MISMATCH，不是抛错）', () => {
    const state = makeNightState({ phase: 'DAY_ANNOUNCE' });

    const { events } = run(state, { type: 'VOTE', ts: 9, seat: 2, target: 3 });

    expect(events[0]?.type).toBe('REJECTED');
    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
  });

  it('拒绝后仍停在 DAY_ANNOUNCE，且状态除 seq 外不变（RFC-002 AC-8）', () => {
    // `DAY_ANNOUNCE` 是自动阶段，真实流程里不会停留；这条直接构造该状态，验证被拒的 action
    // 不产生任何副作用——包括不触发自动推进（否则一个被拒的提交就会改变阶段）。
    const state = makeNightState({ phase: 'DAY_ANNOUNCE' });
    const { state: after } = step(state, { type: 'SPEECH_SKIP', ts: 9, seat: 2 });

    expect(after.phase).toBe('DAY_ANNOUNCE');
    expect(after.seq).toBe(state.seq + 1);
    expect({ ...after, seq: state.seq }).toEqual(state);
  });
});

describe('AC-16 · 天亮之后的阶段也不接受夜晚的 action', () => {
  it('在 DAY_SPEECH 提交 VOTE → Rejected（PHASE_MISMATCH），且除 seq 外状态不变', () => {
    // 自动阶段让夜晚停在 DAY_SPEECH；这条守着「拒绝不产生副作用」（RFC-002 AC-8）。
    const reached = reachWitch();
    const witch = roleSeat(reached.state, 'witch');

    const afterNight = step(reached.state, {
      type: 'WITCH_ACT',
      ts: 9,
      seat: witch,
      potion: 'none',
    }).state;
    expect(afterNight.phase).toBe('DAY_SPEECH');

    const { events, state: after } = step(afterNight, {
      type: 'VOTE',
      ts: 10,
      seat: 1,
      target: 'abstain',
    });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
    expect(after.seq).toBe(afterNight.seq + 1);
    expect({ ...after, seq: afterNight.seq }).toEqual(afterNight);
  });
});

describe('猎人开枪阶段的两条拒绝路径', () => {
  it('非猎人提交 → NOT_YOUR_TURN', () => {
    const state = makeNightState({ phase: 'NIGHT_HUNTER_SHOOT', deadSeats: [6] });
    const villager = state.seats.find((seat) => seat.role === 'villager')?.seat;
    if (villager === undefined) throw new Error('没有 villager');

    const { events } = run(state, { type: 'HUNTER_SHOOT', ts: 1, seat: villager, target: 1 });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });

  it('开枪目标已出局 → TARGET_NOT_ALIVE', () => {
    const state = makeNightState({ phase: 'NIGHT_HUNTER_SHOOT', deadSeats: [6, 9] });
    const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有 hunter');

    const { events } = run(state, { type: 'HUNTER_SHOOT', ts: 1, seat: hunter, target: 9 });

    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'TARGET_NOT_ALIVE' }));
  });
});

describe('nightActorOf · 每个夜阶段的行动者', () => {
  it('狼 / 预言家 / 女巫阶段各自指向对应席位', () => {
    const base = makeNightState({ phase: 'NIGHT_WOLVES' });
    const wolf = base.seats.find((seat) => seat.role === 'wolf')?.seat;
    const seer = base.seats.find((seat) => seat.role === 'seer')?.seat;
    const witch = base.seats.find((seat) => seat.role === 'witch')?.seat;

    expect(nightActorOf(base)).toBe(wolf);
    expect(nightActorOf({ ...base, phase: 'NIGHT_SEER' })).toBe(seer);
    expect(nightActorOf({ ...base, phase: 'NIGHT_WITCH' })).toBe(witch);
    expect(nightActorOf({ ...base, phase: 'NIGHT_RESOLVE' })).toBeUndefined();
  });
});

describe('夜晚阶段的推进由 PHASE_CHANGED 承载', () => {
  it('每次行动后的事件流里都有 PHASE_CHANGED，且 from 与当时的阶段一致', () => {
    const reached = reachWitch();
    const phases = reached.events
      .filter((event) => event.type === 'PHASE_CHANGED')
      .map((event) => {
        if (event.type !== 'PHASE_CHANGED') throw new Error('类型窄化失败');
        return `${event.payload.from}->${event.payload.to}`;
      });

    expect(phases).toEqual(['NIGHT_WOLVES->NIGHT_SEER', 'NIGHT_SEER->NIGHT_WITCH']);
  });

  it('角色已出局时跳过其阶段', () => {
    // seer 已出局：狼下完刀直接进 NIGHT_WITCH
    const state = makeNightState({ phase: 'NIGHT_WOLVES', deadSeats: [4] });
    const wolf = roleSeat(state, 'wolf');

    const { state: after } = run(state, {
      type: 'WOLF_KILL',
      ts: 1,
      seat: wolf,
      target: goodTarget(state),
    });

    expect(after.phase).toBe('NIGHT_WITCH');
    expect(roleAt(state, 4)).toBe('seer');
  });
});
