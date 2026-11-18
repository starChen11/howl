/**
 * 对局领域类型。本文件只含类型与 `as const` 常量（ARCH-2）。
 *
 * 运行时可枚举的取值一律先定 `as const` 数组、再由它派生类型。原因是验收标准要在
 * **运行时**数出「`Phase` 恰好 14 个取值」（RFC-001 AC-5），而纯类型擦除之后数不出来。
 */

/**
 * 座位号。v1 固定 9 人标准局（PRD Scope）。
 * 编号从 1 开始，与事件与投影里的 `SeatId` 完全一致。
 */
export const SEAT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type SeatId = (typeof SEAT_IDS)[number];

/** 身份。数组顺序即显示顺序。 */
export const ROLES = ['wolf', 'seer', 'witch', 'hunter', 'villager'] as const;
export type Role = (typeof ROLES)[number];

export const FACTIONS = ['wolf', 'good'] as const;
export type Faction = (typeof FACTIONS)[number];

/** 屠边 / 屠城。RUL-5：判定只看存活，不看死因。 */
export const WIN_MODES = ['slaughter-side', 'slaughter-all'] as const;
export type WinMode = (typeof WIN_MODES)[number];

/**
 * 身份到阵营的映射。
 *
 * 用 `satisfies` 而不是裸 `as const`：这样既保留字面量类型，又在漏掉某个身份时
 * 直接编译失败。
 */
export const FACTION_OF = {
  wolf: 'wolf',
  seer: 'good',
  witch: 'good',
  hunter: 'good',
  villager: 'good',
} as const satisfies Record<Role, Faction>;

/**
 * 对局阶段，共 14 个取值：
 * `LOBBY`、6 个 `NIGHT_*`、`DAY_ANNOUNCE` / `DAY_SPEECH` / `DAY_VOTE` /
 * `DAY_VOTE_RUNOFF` / `DAY_LYNCH` / `DAY_HUNTER_SHOOT`、`FINISHED`。
 */
export const PHASES = [
  'LOBBY',
  'NIGHT_WOLF_CHAT',
  'NIGHT_WOLVES',
  'NIGHT_SEER',
  'NIGHT_WITCH',
  'NIGHT_RESOLVE',
  'NIGHT_HUNTER_SHOOT',
  'DAY_ANNOUNCE',
  'DAY_SPEECH',
  'DAY_VOTE',
  'DAY_VOTE_RUNOFF',
  'DAY_LYNCH',
  'DAY_HUNTER_SHOOT',
  'FINISHED',
] as const;
export type Phase = (typeof PHASES)[number];

export interface Seat {
  seat: SeatId;
  role: Role;
  alive: boolean;
  /** 仅 AI 席位。人格的定义与分配由 RFC-009 负责。 */
  personaId?: string;
  /** 引擎内不得据此改变规则行为；投影必须剥离（AI-8 / F17）。 */
  isPlayer: boolean;
  /** 出局事件的 `seq`。可见性判定需要它（RFC-005 / RFC-001 §2.3 `isVisibleTo`）。 */
  diedSeq?: number;
}

/**
 * 随机数生成器状态。
 *
 * **不透明**：外部不得解释其内部结构，算法与推进方式由 RFC-002 决定（Q-001-3）。
 * 事件信封上的 `rngAfter` 用它精确重建生成器，从而让 `replay` 可复现（DATA-3）。
 */
export interface RngState {
  readonly __rng: number;
}

/**
 * 本夜的暂存（RFC-003）。**只由 `applyEvent` 写**，进入新的一夜时清空（`C-18` 的派生字段规则）。
 *
 * 它是「事件折叠出来的物化视图」，不是第二权威：三个目标分别来自 `WOLF_KILL_CHOSEN` 与
 * `WITCH_POTION_USED`，重放必然得到同一结果。
 */
export interface NightContext {
  killTarget?: SeatId;
  healTarget?: SeatId;
  poisonTarget?: SeatId;
}

/** 整局药水位（RUL-3 / FR-17：每种药全局只能用一次）。同样只由 `applyEvent` 写。 */
export interface PotionUsage {
  heal: boolean;
  poison: boolean;
}

export interface GameState {
  gameId: string;
  seed: number;
  mode: WinMode;
  /** 当前生成器状态。 */
  rng: RngState;
  phase: Phase;
  /** 从 1 开始。 */
  day: number;
  /** 恒 9 项，按 `seat` 升序。 */
  seats: Seat[];
  /** 已产生事件的最大 `seq`。 */
  seq: number;
  /** 本夜暂存。undefined 表示「还没有任何夜间信息」。 */
  night?: NightContext;
  /** 药水位。undefined 视为「两瓶药都没用过」。 */
  potionsUsed?: PotionUsage;
  /**
   * 自本夜开始以来出局的席位，按**结算顺序**（这是内部顺序；公开的 `DAY_STARTED.diedLastNight` 会按座位重排，C-31）。
   * 进入新的一夜时清空，`DAY_STARTED` 折叠时消费并清空。
   */
  pendingDeaths?: SeatId[];
  /**
   * 当天发言进度：起点 + 已发言（或跳过）的席位。
   * 由 `DAY_STARTED` / `SPEECH` / `SPEECH_SKIPPED` 折叠而来，可完整重建（C-18）。
   */
  speech?: { startSeat: SeatId; spoken: SeatId[] };
  /** 本轮票箱（`VOTE_CAST` 折叠而来）。结算后清空，供重投使用。 */
  votes?: { seat: SeatId; target: SeatId | 'abstain' }[];
  /** 重投的候选集：并列最高票者（RUL-2）。 */
  runoff?: SeatId[];
  /** 已被放逐的席位（`VOTE_REVEALED` 唯一最高票时写入，`DAY_LYNCH` 的自动推进读它）。 */
  lynched?: SeatId;
  // 注：无 stalemateDays 之类的平局兜底字段。RUL-10 已移除该规则（见 RULES.md §6）。
}
