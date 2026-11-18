import type { GameState, SeatId } from '@shared/domain';
import type { PendingDecision } from '@shared/project';

/**
 * 本阶段允许指向的目标集合（RFC-007 §2.2 / §2.9）。
 *
 * 它是**投影的一部分**：AI 只能从这份清单里选，otherwise 引擎会拒绝。清单本身也是信息——
 * 比如投票阶段多一个「弃权」，重投阶段只有并列者（RUL-2）。
 */
export function legalTargetsOf(state: GameState, pending: PendingDecision): (SeatId | 'abstain')[] {
  const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);

  switch (pending) {
    case null:
      return [];

    case 'vote':
      // 首轮：所有存活席位都可以被投，外加弃权（RUL-7）。
      // 重投阶段（`DAY_VOTE_RUNOFF`）只能投并列者，且**不能弃权**（RUL-2）。
      return state.phase === 'DAY_VOTE_RUNOFF' ? [...(state.runoff ?? [])] : [...alive, 'abstain'];

    case 'kill':
      // 狼不能刀自己人——但投影层面不替引擎做决定，只给存活者；引擎会拒绝刀狼。
      return [...alive];

    case 'check':
    case 'shoot':
      return [...alive];

    case 'witch':
      return [...alive];

    case 'speak':
    case 'chat':
      return [];

    default:
      return [];
  }
}
