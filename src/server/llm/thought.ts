import type { SeatId } from '@shared/domain';
import type { Claim, GameEventMap } from '@shared/events';

import type { Decision } from './schema';

/**
 * 把一次决策的「内心理由」变成 `AI_THOUGHT` 事件（RFC-006 §2.2 / RFC-007 §2.5）。
 *
 * 这条事件是**复盘唯一的推理来源**（AI-5）：`reason` 不进公开发言，也不进 `SPEECH`。
 * 它的可见性是 `self:<seat>`，所以除该席位外任何人的投影里都没有它。
 */
export interface ThoughtInput {
  seat: SeatId;
  /** 决策产生前的 `state.seq`，用于与动作对应。 */
  decisionSeq: number;
  decision: Decision;
}

export function toThought(input: ThoughtInput): {
  type: 'AI_THOUGHT';
  visibleTo: `self:${SeatId}`;
  payload: GameEventMap['AI_THOUGHT'];
} {
  const payload: GameEventMap['AI_THOUGHT'] = {
    reason: input.decision.reason,
    decisionSeq: input.decisionSeq,
    seat: input.seat,
  };

  // `claim` 原样带入，不做扁平化（CR-003 C3）。
  if (input.decision.claim !== undefined) {
    payload.claim = input.decision.claim as Claim;
  }

  return {
    type: 'AI_THOUGHT',
    visibleTo: `self:${input.seat}`,
    payload,
  };
}
