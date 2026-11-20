import type { SeatId, WinMode } from './domain';

/**
 * 用药：解药 / 毒药 / 都不用。三个取值，二选一加「都不用」（RUL-3：每夜至多一种药）。
 */
export const WITCH_POTIONS = ['heal', 'poison', 'none'] as const;
export type WitchPotion = (typeof WITCH_POTIONS)[number];

/** 需要目标的两种药。`'none'` 不在其中，这是下面两条分支分开的原因。 */
export type TargetedWitchPotion = Exclude<WitchPotion, 'none'>;

/**
 * 动作类型的运行时可枚举集合（Zod 校验与测试需要）。由测试断言它与 `Action['type']`
 * **完全相等**——多了少了都编译失败。
 */
export const ACTION_TYPES = [
  'START',
  'WOLF_CHAT',
  'WOLF_KILL',
  'WOLF_VOTE',
  'SEER_CHECK',
  'WITCH_ACT',
  'HUNTER_SHOOT',
  'SPEECH',
  'SPEECH_SKIP',
  'VOTE',
  'SELF_EXPOSE',
] as const satisfies readonly Action['type'][];

/**
 * 玩家与 AI 提交的动作。`type` 是判别键。
 *
 * 每条都必带 `ts`：引擎不读时钟，时间只能作为输入进来（ARCH-4）。
 *
 * 约定（RFC-001 §2.3）：
 * - `WITCH_ACT` 分两条分支：`'none'` 分支**不允许**带 `target`，`'heal'` / `'poison'`
 *   分支**必须**带。§2.3 的约束句（「`potion: 'none'` 与 `target?: undefined` 配套」）
 *   用一条 `target?: SeatId` 表达不出来，所以拆成两个成员，语义由类型守住；
 * - `HUNTER_SHOOT` 省略 `target` 表示放弃开枪；
 * - `VOTE.target: 'abstain'` 表示弃权（RUL-7：合法且无惩罚）。
 */
export type Action =
  | { type: 'START'; ts: number; seed: number; mode: WinMode; playerSeat: SeatId }
  | { type: 'WOLF_CHAT'; ts: number; seat: SeatId; text: string }
  | { type: 'WOLF_KILL'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'WOLF_VOTE'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'SEER_CHECK'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'WITCH_ACT'; ts: number; seat: SeatId; potion: TargetedWitchPotion; target: SeatId }
  | { type: 'WITCH_ACT'; ts: number; seat: SeatId; potion: 'none' }
  | { type: 'HUNTER_SHOOT'; ts: number; seat: SeatId; target?: SeatId }
  | { type: 'SPEECH'; ts: number; seat: SeatId; text: string }
  | { type: 'SPEECH_SKIP'; ts: number; seat: SeatId }
  | { type: 'VOTE'; ts: number; seat: SeatId; target: SeatId | 'abstain' }
  | { type: 'SELF_EXPOSE'; ts: number; seat: SeatId };
