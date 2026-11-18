import type { SeatId } from '@shared/domain';
import { wrapPublicUtterance as wrapShared } from '@shared/injection';

/**
 * 玩家输入的封装（RFC-007 §2.6）。
 *
 * 实现已移到 `src/shared/injection.ts`——它是纯函数，而 `server → server` 的跨模块
 * 引用不在允许的依赖方向里（C-54）。这里只保留一个带类型的转出，供服务端调用方使用。
 */
export function wrapPublicUtterance(input: {
  seat: SeatId;
  text: string;
}): { ok: true; text: string } | { ok: false; code: 'UTTERANCE_TOO_LONG' } {
  return wrapShared(input);
}
