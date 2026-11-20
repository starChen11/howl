import type { Action } from '@shared/actions';
import type {
  GameState,
  NightContext,
  Phase,
  PotionUsage,
  Role,
  Seat,
  SeatId,
} from '@shared/domain';

import { FIXTURE_ROLES, stateWithRoles } from './states';

import { step } from '@engine/step';

import { lobbyState, startActionOf } from './states';

/**
 * 夜晚测试夹具。
 *
 * 夜间的合法路径是**线性**的（狼 → 预言家 → 女巫），所以夹具沿真实路径推进而不是手改状态：
 * 这样每个测试拿到的状态都是「真能走到这里」的状态，而不是一个状态机永远不会产生的组合。
 */

export interface NightRun {
  state: GameState;
  events: ReturnType<typeof step>['events'];
}

/**
 * 开局并停在 `NIGHT_WOLVES`。
 *
 * RFC-005 起，发牌之后先进入 `NIGHT_WOLF_CHAT`（狼队协商），每只存活 wolf 各报一句才轮到下刀。
 * 夹具沿真实路径走完这一段，避免测试拿到状态机不会产生的状态。
 */
export function nightStart(seed = 20_261_117): GameState {
  const lobby = lobbyState({ seed });
  let current = step(lobby, startActionOf(lobby)).state;

  for (let guard = 0; guard < 10 && current.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
    const speaker = current.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(current.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (speaker === undefined) break;
    current = step(current, { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' }).state;
  }

  // RUL-14：讨论不再「说一句就过」；测试夹具让所有狼准备后进入投票。
  for (let guard = 0; guard < 10 && current.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
    const wolf = current.seats.find(
      (seat) =>
        seat.alive && seat.role === 'wolf' && !(current.wolfReady ?? []).includes(seat.seat),
    )?.seat;
    if (wolf === undefined) break;
    current = step(current, { type: 'WOLF_READY', ts: 1, seat: wolf }).state;
  }

  return current;
}

/** 占位：让测试代码的意图更清楚。 */
export function run(state: GameState, action: Action): NightRun {
  const result = step(state, action);
  return { state: result.state, events: result.events };
}

/** 某个身份的存活席位；不存在则抛错（夹具用，说明测试前提不成立）。 */
export function roleSeat(state: GameState, role: Role): SeatId {
  const seat = state.seats.find((candidate) => candidate.role === role && candidate.alive);
  if (seat === undefined) throw new Error(`没有存活的 ${role} 席位`);
  return seat.seat;
}

/** 某个身份的任意席位（含已出局）。 */
export function anyRoleSeat(state: GameState, role: Role): SeatId {
  const seat = state.seats.find((candidate) => candidate.role === role);
  if (seat === undefined) throw new Error(`没有 ${role} 席位`);
  return seat.seat;
}

/** 一个存活的 non-wolf 席位，用作刀口。 */
export function goodTarget(state: GameState): SeatId {
  const seat = state.seats.find((candidate) => candidate.alive && candidate.role !== 'wolf');
  if (seat === undefined) throw new Error('没有存活的非狼席位');
  return seat.seat;
}

/** 某个席位的身份。 */
export function roleAt(state: GameState, seat: SeatId): Role {
  const found: Seat | undefined = state.seats.find((candidate) => candidate.seat === seat);
  if (found === undefined) throw new Error(`没有座位 ${seat}`);
  return found.role;
}

/**
 * 推进到女巫阶段：狼下刀（刀口默认取第一个存活好人）→ 预言家查验。
 *
 * 返回进入 `NIGHT_WITCH` 的状态与这两步产生的事件（测试需要断言可见性时会用到）。
 */
export function reachWitch(
  seed = 20_261_117,
  options: { killTarget?: SeatId } = {},
): NightRun & { killTarget: SeatId } {
  const atWolves = nightStart(seed);
  const killer = roleSeat(atWolves, 'wolf');
  const killTarget = options.killTarget ?? goodTarget(atWolves);

  const afterKill = run(atWolves, {
    type: 'WOLF_KILL',
    ts: 1_000,
    seat: killer,
    target: killTarget,
  });

  const seer = roleSeat(afterKill.state, 'seer');
  const checked = afterKill.state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
  if (checked === undefined) throw new Error('没有可查验的席位');

  const afterCheck = run(afterKill.state, {
    type: 'SEER_CHECK',
    ts: 1_100,
    seat: seer,
    target: checked,
  });

  return {
    state: afterCheck.state,
    events: [...afterKill.events, ...afterCheck.events],
    killTarget,
  };
}

/**
 * 直接构造一个夜间状态。
 *
 * 用途：RFC-003 只实现「第一夜」，而 AC-9（次夜复用已用药）、AC-14（猎人正好是最后一个神）
 * 这类场景需要**第二夜**或残局——真实路径要等 RFC-004 的白天阶段。§6 明确允许「构造状态」，
 * 所以这里显式造，而不是等一个还不存在的白天。
 */
export function makeNightState(input: {
  readonly phase: Phase;
  readonly deadSeats?: readonly SeatId[];
  readonly night?: NightContext;
  readonly potionsUsed?: PotionUsage;
  readonly roles?: readonly Role[];
}): GameState {
  const base = stateWithRoles(input.roles ?? FIXTURE_ROLES, 'slaughter-side', {
    deadSeats: input.deadSeats ?? [],
  });

  const state: GameState = { ...base, phase: input.phase, day: 2, seq: 20 };
  if (input.night !== undefined) state.night = input.night;
  if (input.potionsUsed !== undefined) state.potionsUsed = input.potionsUsed;
  return state;
}
