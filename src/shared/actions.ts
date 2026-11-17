import type { SeatId, WinMode } from './domain';

/**
 * 用药：解药 / 毒药 / 都不用。三个取值，二选一加「都不用」（RUL-3：每夜至多一种药）。
 */
export const WITCH_POTIONS = ['heal', 'poison', 'none'] as const;
export type WitchPotion = (typeof WITCH_POTIONS)[number];

/**
 * 玩家与 AI 提交的动作。`type` 是判别键。
 *
 * 每条都必带 `ts`：引擎不读时钟，时间只能作为输入进来（ARCH-4）。
 *
 * 约定（RFC-001 §2.3）：
 * - `WITCH_ACT` 的 `potion: 'none'` 与省略 `target` 配套；
 * - `HUNTER_SHOOT` 省略 `target` 表示放弃开枪；
 * - `VOTE.target: 'abstain'` 表示弃权（RUL-7：合法且无惩罚）。
 */
export type Action =
  | { type: 'START'; ts: number; seed: number; mode: WinMode; playerSeat: SeatId }
  | { type: 'WOLF_CHAT'; ts: number; seat: SeatId; text: string }
  | { type: 'WOLF_KILL'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'SEER_CHECK'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'WITCH_ACT'; ts: number; seat: SeatId; potion: WitchPotion; target?: SeatId }
  | { type: 'HUNTER_SHOOT'; ts: number; seat: SeatId; target?: SeatId }
  | { type: 'SPEECH'; ts: number; seat: SeatId; text: string }
  | { type: 'SPEECH_SKIP'; ts: number; seat: SeatId }
  | { type: 'VOTE'; ts: number; seat: SeatId; target: SeatId | 'abstain' }
  | { type: 'SELF_EXPOSE'; ts: number; seat: SeatId };
