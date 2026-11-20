import type { GameState, SeatId } from '@shared/domain';

import { aliveSeats, seatAt } from '../queries';
import { rejectionDraft } from '../reject';
import type { ActionHandlerFor, EventDraft } from '../step';
import { phaseChangedDraft } from './visibility';

/**
 * 狼队夜间私聊（RFC-005 §2.2）。
 *
 * 它是**有界**的：每只存活狼各提交一条就结束，不依赖编排层判断「AI 说完了没有」。
 * 空串也算提交（「我先听」），这是唯一能表达「我不想说话」的方式。
 */

/** 夜聊文本的上限。PRD 只约束白天玩家发言的 300 字，狼队私聊按 RFC-005 §4 截断到 500。 */
export const WOLF_CHAT_LIMIT = 500;

/** 还没提交夜聊的存活狼。 */
export function pendingChatters(state: GameState): SeatId[] {
  const posted = new Set((state.wolfChat ?? []).map((entry) => entry.seat));
  return aliveSeats(state)
    .filter((seat) => seat.role === 'wolf')
    .map((seat) => seat.seat)
    .filter((seat) => !posted.has(seat));
}

/** `WOLF_CHAT`（`NIGHT_WOLF_CHAT`）。 */
const wolfChat: ActionHandlerFor<'WOLF_CHAT'> = (state, action) => {
  const actor = seatAt(state, action.seat);

  if (!actor.alive || actor.role !== 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 wolf，不能参加狼队夜聊`,
        seat: action.seat,
      }),
    ];
  }

  const drafts: EventDraft[] = [
    {
      type: 'WOLF_CHAT_POSTED',
      visibleTo: 'wolves',
      payload: {
        seat: action.seat,
        // 截断而不是拒绝：狼队的内部发言不该因为太长而卡住流程（RFC-005 §4）。
        text: action.text.slice(0, WOLF_CHAT_LIMIT),
        round: 'night-chat',
      },
    },
  ];

  return drafts;
};

/** `WOLF_READY`（`NIGHT_WOLF_CHAT`）：狼队讨论结束的表态（RUL-14）。 */
const wolfReady: ActionHandlerFor<'WOLF_READY'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (!actor.alive || actor.role !== 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 wolf，不能表态`,
        seat: action.seat,
      }),
    ];
  }

  if ((state.wolfReady ?? []).includes(action.seat)) {
    return [
      rejectionDraft({
        action,
        code: 'ALREADY_READY',
        message: `座位 ${action.seat} 已经准备完成`,
        seat: action.seat,
      }),
    ];
  }

  const ready = [...(state.wolfReady ?? []), action.seat];
  const wolves = aliveSeats(state).filter((seat) => seat.role === 'wolf');
  const drafts: EventDraft[] = [
    { type: 'WOLF_READY_MARKED', visibleTo: 'wolves', payload: { seat: action.seat } },
  ];

  if (wolves.every((seat) => ready.includes(seat.seat))) {
    drafts.push(phaseChangedDraft('NIGHT_WOLF_CHAT', 'NIGHT_WOLVES'));
  }

  return drafts;
};

export const WOLF_CHAT_HANDLERS = { WOLF_CHAT: wolfChat, WOLF_READY: wolfReady } as const;
