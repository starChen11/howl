import type { GameState } from '@shared/domain';

import { seatAt } from '../queries';
import { rejectionDraft } from '../reject';
import type { ActionHandlerFor, EventDraft } from '../step';
import { isElectionActionPhase } from './sheriff';
import { phaseChangedDraft } from './visibility';

/**
 * wolf 白天自曝（RFC-005 §2.3 / RFC-022 §2.2）：**用一天换一夜**。
 *
 * 真实局里自曝是插话，所以**不要求轮到该狼发言**——白天发言、投票、以及整个竞选期间
 * 都能提交。
 *
 * 后果是**当日立即结束**（RUL-4）：已产生的发言事件保留（它们是已发生的公开事实），
 * 但投票取消，相位直接进入夜聊——不是直接到 wolf 行动阶段，否则会跳过 wolf 队协商。
 *
 * 竞选期间自曝是唯一例外（RFC-022 §2.2）：先中止竞选、本局无警长，**仍然公布首夜死讯**
 * 并处理开枪，然后才入夜。这条路径由 `DAY_ANNOUNCE` 的自动推进接住。
 */
export function selfExposeDraft(state: GameState): EventDraft[] {
  if (isElectionActionPhase(state.phase)) {
    return [
      {
        type: 'SHERIFF_ELECTION_FAILED',
        visibleTo: 'public',
        payload: { reason: 'self-exposed' },
      },
      phaseChangedDraft(state.phase, 'DAY_ANNOUNCE'),
    ];
  }
  return [phaseChangedDraft(state.phase, 'NIGHT_WOLF_CHAT')];
}

/** `SELF_EXPOSE`（`DAY_SPEECH` / `DAY_VOTE`）。 */
const selfExpose: ActionHandlerFor<'SELF_EXPOSE'> = (state, action) => {
  const actor = seatAt(state, action.seat);

  if (actor.role !== 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_A_WOLF',
        message: `座位 ${action.seat} 不是 wolf，不能自曝`,
        seat: action.seat,
      }),
    ];
  }

  if (!actor.alive) {
    return [
      rejectionDraft({
        action,
        code: 'NOT_ALIVE',
        message: `座位 ${action.seat} 已出局，不能自曝`,
        seat: action.seat,
      }),
    ];
  }

  return [
    { type: 'SELF_EXPOSE', visibleTo: 'public', payload: { seat: action.seat } },
    ...selfExposeDraft(state),
  ];
};

export const SELF_EXPOSE_HANDLERS = { SELF_EXPOSE: selfExpose } as const;
