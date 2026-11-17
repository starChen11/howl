import type { Action } from '@shared/actions';
import type { GameState, Role, Seat, SeatId, WinMode } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';

import { createInitialState } from '@engine/init';
import type { CreateInitialStateInput } from '@engine/init';
import { step } from '@engine/step';

/**
 * 引擎测试的共享夹具。
 *
 * 只放**构造状态**的代码，不放断言——这样各测试文件读起来只剩「这个场景断言什么」。
 */

export const DEFAULT_INPUT: CreateInitialStateInput = {
  gameId: 'game-test',
  seed: 20_261_117,
  mode: 'slaughter-side',
  playerSeat: 3,
};

/** 开局前（`LOBBY`）的状态。 */
export function lobbyState(overrides: Partial<CreateInitialStateInput> = {}): GameState {
  return createInitialState({ ...DEFAULT_INPUT, ...overrides });
}

/** 玩家席位：`createInitialState` 唯一会置 `isPlayer` 的座位。 */
export function playerSeatOf(state: GameState): SeatId {
  const seat = state.seats.find((candidate) => candidate.isPlayer)?.seat;
  if (seat === undefined) {
    throw new Error('状态里没有玩家席位');
  }
  return seat;
}

/** 与状态匹配的 `START` action。 */
export function startActionOf(state: GameState, ts = 1_000): Action {
  return {
    type: 'START',
    ts,
    seed: state.seed,
    mode: state.mode,
    playerSeat: playerSeatOf(state),
  };
}

/** 走完 `START` 之后的状态（已发牌、进入第一夜）。 */
export function startedState(overrides: Partial<CreateInitialStateInput> = {}): GameState {
  const lobby = lobbyState(overrides);
  return step(lobby, startActionOf(lobby)).state;
}

/** 直接构造一个指定身份与存活情况的状态，用于 `checkWin` 之类的纯谓词测试。 */
export function stateWithRoles(
  roles: readonly Role[],
  mode: WinMode,
  options: { deadSeats?: readonly SeatId[] } = {},
): GameState {
  if (roles.length !== SEAT_IDS.length) {
    throw new Error(`需要 ${SEAT_IDS.length} 个身份，收到 ${roles.length}`);
  }

  const dead = new Set<SeatId>(options.deadSeats ?? []);

  const seats: Seat[] = SEAT_IDS.map((seat, index) => {
    const role = roles[index];
    if (role === undefined) {
      throw new Error(`座位 ${seat} 没有身份`);
    }
    return { seat, role, alive: !dead.has(seat), isPlayer: index === 0 };
  });

  return {
    gameId: 'game-fixture',
    seed: 1,
    mode,
    rng: { __rng: 1 },
    phase: 'DAY_VOTE',
    day: 2,
    seats,
    seq: 10,
  };
}

/** 屠边板子：3 狼 / 预言家 / 女巫 / 猎人 / 3 民。 */
export const FIXTURE_ROLES: readonly Role[] = [
  'wolf',
  'wolf',
  'wolf',
  'seer',
  'witch',
  'hunter',
  'villager',
  'villager',
  'villager',
];
