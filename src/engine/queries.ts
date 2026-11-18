import type { GameState, Role, Seat, SeatId } from '@shared/domain';
import { FACTION_OF } from '@shared/domain';

import { InvalidEventStreamError } from './errors';

/**
 * 只读查询（RFC-003 §3）。
 *
 * 全部是纯函数、不产生事件、不改状态。抽出来的原因：夜晚结算、胜负判定、投影都要问
 * 「谁还活着」「哪个席位是谁」，各写一遍迟早各说各话。
 */

/** 存活席位，按座位升序（`state.seats` 本身已按序）。 */
export function aliveSeats(state: GameState): Seat[] {
  return state.seats.filter((seat) => seat.alive);
}

/**
 * 存活人数按阵营统计。
 *
 * 注意这不是 `checkWin` 的实现——胜负判定还分屠边 / 屠城（RUL-5），这里只提供计数事实。
 */
export function countAliveByFaction(state: GameState): { wolf: number; good: number } {
  let wolf = 0;
  let good = 0;

  for (const seat of state.seats) {
    if (!seat.alive) continue;
    if (FACTION_OF[seat.role] === 'wolf') wolf += 1;
    else good += 1;
  }

  return { wolf, good };
}

/** 按座位取席位。座位不存在说明调用方传了非法座位，属于编程错误。 */
export function seatAt(state: GameState, seat: SeatId): Seat {
  const found = state.seats.find((candidate) => candidate.seat === seat);

  if (found === undefined) {
    throw new InvalidEventStreamError(`座位 ${seat} 不在本局座位表中`);
  }

  return found;
}

/** 某个身份的第一个存活席位；没有则返回 `undefined`（该身份已出局或不存在）。 */
export function findAliveByRole(state: GameState, role: Role): Seat | undefined {
  return state.seats.find((seat) => seat.alive && seat.role === role);
}

/** 某个身份的全部席位（无论存活）。 */
export function findSeatsByRole(state: GameState, role: Role): Seat[] {
  return state.seats.filter((seat) => seat.role === role);
}

/** 本局的 wolf 席位（可能已出局）。 */
export function wolfSeats(state: GameState): Seat[] {
  return state.seats.filter((seat) => FACTION_OF[seat.role] === 'wolf');
}

/** 某人是否存活；座位不存在抛错。 */
export function isAlive(state: GameState, seat: SeatId): boolean {
  return seatAt(state, seat).alive;
}
