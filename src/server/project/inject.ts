import type { SeatId } from '@shared/domain';
import { escapeAngleBrackets, UTTERANCE_LIMIT } from '@shared/injection';

/**
 * 玩家输入的封装（RFC-007 §2.6）。
 *
 * 玩家与 AI 的发言走**同一个函数**，提示里不区分来源——否则模型会推断「这个席位是人」，
 * 违反 FR-10 / F17。
 */

export type WrapResult = { ok: true; text: string } | { ok: false; code: 'UTTERANCE_TOO_LONG' };

/**
 * 把一条公开发言包进固定标签。
 *
 * **超长时拒绝而不是截断**：截断会让发言者以为自己把话说完了，而其他人看到的却是一条
 * 被砍掉的发言——这在社交推理游戏里是信息失真。
 */
export function wrapPublicUtterance(input: { seat: SeatId; text: string }): WrapResult {
  if (input.text.length > UTTERANCE_LIMIT) {
    return { ok: false, code: 'UTTERANCE_TOO_LONG' };
  }

  return {
    ok: true,
    text: `<public_utterance seat="${input.seat}">${escapeAngleBrackets(input.text)}</public_utterance>`,
  };
}
