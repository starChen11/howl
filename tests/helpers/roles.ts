import type { GameState, Role, SeatId } from '@shared/domain';

/**
 * 测试用的「按角色取席位」。
 *
 * 用抛错代替非空断言：`!` 被 lint 禁止，而且断言失败时的报错信息远不如一句
 * 「本局没有存活的 wolf」清楚。
 */
export function seatOfRole(state: GameState, role: Role): SeatId {
  const seat = state.seats.find((candidate) => candidate.role === role);
  if (seat === undefined) throw new Error(`本局没有 ${role}`);
  return seat.seat;
}

export function seatOfAliveRole(state: GameState, role: Role): SeatId {
  const seat = state.seats.find((candidate) => candidate.role === role && candidate.alive);
  if (seat === undefined) throw new Error(`本局没有存活的 ${role}`);
  return seat.seat;
}
