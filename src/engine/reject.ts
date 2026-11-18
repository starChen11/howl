import type { Action } from '@shared/actions';
import type { SeatId } from '@shared/domain';

/**
 * 拒绝草稿的构造（RFC-002 §2.3 的第二类：**规则拒绝**）。
 *
 * `step` 与各阶段 handler 都要产出它，所以抽出来一份——各写一份迟早出现两种 `code` 拼写。
 */

export interface RejectionInput {
  readonly action: Action;
  readonly code: string;
  readonly message: string;
  /** 提交者席位。省略时走公开可见性（`START` 这类没有席位的 action）。 */
  readonly seat?: SeatId;
}

/** 取 action 里的提交者席位；`START` 没有席位。 */
export function seatOf(action: Action): SeatId | undefined {
  return 'seat' in action ? action.seat : undefined;
}

export function rejectionDraft(input: RejectionInput): {
  type: 'REJECTED';
  visibleTo: 'public' | `self:${SeatId}`;
  payload: { actionType: Action['type']; code: string; message: string };
} {
  return {
    type: 'REJECTED',
    visibleTo: input.seat === undefined ? 'public' : `self:${input.seat}`,
    payload: { actionType: input.action.type, code: input.code, message: input.message },
  };
}
