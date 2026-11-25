import type { GameState, SeatId } from '@shared/domain';
import type { PendingDecision } from '@shared/project';

import { activeCandidatesOf, sheriffOrderOptions, votersOf } from '@engine/phases/sheriff';

/**
 * 本阶段允许指向的目标集合（RFC-007 §2.2 / §2.9）。
 *
 * 它是**投影的一部分**：AI 只能从这份清单里选，otherwise 引擎会拒绝。清单本身也是信息——
 * 比如投票阶段多一个「弃权」，重投阶段只有并列者（RUL-2）。
 */
export function legalTargetsOf(
  state: GameState,
  pending: PendingDecision,
  aliveSeats: readonly SeatId[],
  observer: SeatId,
): (SeatId | 'abstain')[] {
  // 用**观察者已知的**存活席位，而不是引擎真值：否则「某个目标突然消失」本身就泄漏了
  // 「他死了」，而这件事还没公布（C-28）。
  // 排除观察者自己：不能刀自己、枪毙自己、投自己。引擎会拒绝这些，但把它列进选项
  // 清单会让 AI 选到必然被拒的目标（RFC-006 消费时尤其明显）。
  const alive = aliveSeats.filter((seat) => seat !== observer);

  switch (pending) {
    case null:
      return [];

    case 'vote': {
      // 白天投票时死亡已经公布，直接用**引擎真值**再挡一层：即使投影的
      // 「已知存活」晚了一步，也绝不会把已出局的人列进投票按钮。
      const engineAlive = state.seats
        .filter((seat) => seat.alive && seat.seat !== observer)
        .map((seat) => seat.seat);
      if (state.phase === 'DAY_VOTE_RUNOFF') {
        return (state.runoff ?? []).filter((seat) =>
          state.seats.some((entry) => entry.seat === seat && entry.alive),
        );
      }
      return [...engineAlive, 'abstain'];
    }

    case 'kill':
      // 狼不能刀自己人——但投影层面不替引擎做决定，只给存活者；引擎会拒绝刀狼。
      return [...alive];

    case 'wolf-vote':
      // RUL-13：狼队内部投票，只能投存活且非狼的席位。
      return state.seats
        .filter((seat) => seat.alive && seat.role !== 'wolf')
        .map((seat) => seat.seat);

    case 'wolf-runoff':
      // 重投只能投并列者（RUL-13），且不能弃权。
      return [...(state.wolfRunoff ?? [])];

    case 'check':
      return [...alive];

    case 'shoot':
      // 开枪发生在死亡结算之后：此时用**引擎真值**的存活席位，否则会列出刚死的人，
      // 引擎必然拒绝，编排层会一直重试同一个非法目标（真实对局里表现为卡死）。
      return state.seats
        .filter((seat) => seat.alive && seat.seat !== observer)
        .map((seat) => seat.seat);

    case 'witch':
      return [...alive];

    case 'speak':
    case 'chat':
      return [];

    /* ---- RFC-022 · 竞选 ---- */

    // 上警 / 退水 / 竞选发言 / 归票发言都不需要「指向某人」。
    case 'sheriff-signup':
    case 'sheriff-speech':
    case 'sheriff-withdraw':
    case 'sheriff-pk':
    case 'sheriff-final-speech':
      return [];

    case 'sheriff-vote':
      // 只有从未上警的玩家能投；候选人不可投。首轮可以弃权（RFC-022 §2.2）。
      // 竞选发生在死讯公布前，引擎里也还没有任何死亡，所以直接用候选人集合是安全的。
      return [...activeCandidatesOf(state), 'abstain'];

    case 'sheriff-runoff':
      // 重投只能投平票者，且**不能弃权**（RFC-022 §2.2）。
      return [...(state.sheriffRunoff ?? [])].sort((a, b) => a - b);

    case 'badge-transfer':
      // 移交发生在死亡已经公布之后：用引擎真值，不能给已出局的人接警徽。
      return state.seats
        .filter((seat) => seat.alive && seat.seat !== observer)
        .map((seat) => seat.seat);

    case 'sheriff-order':
      // 方向由 `sheriffOrderOptions` 表达；这里的「目标」只是合法的发言起点。
      return sheriffOrderOptions(state).map((option) => option.startSeat);

    default:
      return [];
  }
}

/** 观察者是否是本次竞选的警下投票人（给 UI / prompt 判断，不参与合法性校验）。 */
export function isSheriffVoter(state: GameState, observer: SeatId): boolean {
  return votersOf(state).includes(observer);
}
