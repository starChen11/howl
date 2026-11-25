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
 * 对局阶段，共 26 个取值。
 *
 * 首日顺序（RFC-022）：`NIGHT_RESOLVE → DAY_SHERIFF_SIGNUP → DAY_SHERIFF_SPEECH →
 * DAY_SHERIFF_WITHDRAW → DAY_SHERIFF_VOTE → (DAY_SHERIFF_PK → DAY_SHERIFF_RUNOFF) →
 * DAY_SHERIFF_RESULT → DAY_ANNOUNCE → (NIGHT_HUNTER_SHOOT) → (DAY_BADGE_TRANSFER) →
 * DAY_SHERIFF_ORDER → DAY_SPEECH → DAY_SHERIFF_FINAL_SPEECH → DAY_VOTE`。
 */
export const PHASES = [
  'LOBBY',
  'NIGHT_WOLF_CHAT',
  'NIGHT_WOLVES',
  'NIGHT_WOLF_RUNOFF',
  'NIGHT_SEER',
  'NIGHT_WITCH',
  'NIGHT_RESOLVE',
  'NIGHT_HUNTER_SHOOT',
  'DAY_SHERIFF_SIGNUP',
  'DAY_SHERIFF_SPEECH',
  'DAY_SHERIFF_WITHDRAW',
  'DAY_SHERIFF_VOTE',
  'DAY_SHERIFF_PK',
  'DAY_SHERIFF_RUNOFF',
  'DAY_SHERIFF_RESULT',
  'DAY_ANNOUNCE',
  'DAY_BADGE_TRANSFER',
  'DAY_SHERIFF_ORDER',
  'DAY_SPEECH',
  'DAY_SHERIFF_FINAL_SPEECH',
  'DAY_VOTE',
  'DAY_PK_SPEECH',
  'DAY_VOTE_RUNOFF',
  'DAY_LYNCH',
  'DAY_HUNTER_SHOOT',
  'FINISHED',
] as const;
export type Phase = (typeof PHASES)[number];

/** 警徽状态。`none` = 本局从未有警长 / 竞选失败；`destroyed` = 曾有警长但被撕徽。 */
export const SHERIFF_BADGE_STATES = ['none', 'held', 'destroyed'] as const;
export type SheriffBadgeState = (typeof SHERIFF_BADGE_STATES)[number];

/** 发言方向。由警长选择的起点与方向一起写进 `SHERIFF_ORDER_CHOSEN`，不靠位置猜。 */
export const SPEECH_DIRECTIONS = ['clockwise', 'counterclockwise'] as const;
export type SpeechDirection = (typeof SPEECH_DIRECTIONS)[number];

/**
 * 竞选没有产生警长的原因。
 *
 * 用封闭枚举而不是自由字符串：UI 与复盘要按原因显示不同文案，拼写漂移会在运行时静默。
 */
export const SHERIFF_ELECTION_FAILURE_REASONS = [
  'no-candidates',
  'all-withdrawn',
  'no-voters',
  'no-valid-votes',
  'double-tie',
  'self-exposed',
] as const;
export type SheriffElectionFailureReason = (typeof SHERIFF_ELECTION_FAILURE_REASONS)[number];

/** 警长投票的轮次。首轮可弃权，重投只能投并列者（RUL-2 的警长版）。 */
export const SHERIFF_VOTE_ROUNDS = ['initial', 'runoff'] as const;
export type SheriffVoteRound = (typeof SHERIFF_VOTE_ROUNDS)[number];

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
  degradations?: SeatId[];
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
  /** 本夜狼队已提交的发言（`WOLF_CHAT_POSTED` 折叠而来，可重建）。 */
  wolfChat?: { seat: SeatId; text: string }[];
  /** 已表态「准备完成」的狼（RUL-14）。 */
  wolfReady?: SeatId[];
  /** 狼队这一轮的票（RUL-13）。 */
  wolfVotes?: { seat: SeatId; target: SeatId | 'abstain'; confirmed?: boolean }[];
  /** 重投时的候选（并存席位）；空/未定义表示不在重投。 */
  wolfRunoff?: SeatId[];
  /** 已被放逐的席位（`VOTE_REVEALED` 唯一最高票时写入，`DAY_LYNCH` 的自动推进读它）。 */
  lynched?: SeatId;
  // 注：无 stalemateDays 之类的平局兜底字段。RUL-10 已移除该规则（见 RULES.md §6）。

  /* ------------------------------------------------------------------------
   * 警长与警徽（RFC-022）。全部是 `applyEvent` 折叠出来的派生字段，可完整重建。
   * --------------------------------------------------------------------- */

  /**
   * 当前警长。`null` 表示本局没有警长（尚未选出 / 竞选失败 / 撕徽），
   * `undefined` 表示事件流里还没出现过任何警长信息（旧对局或开局前）。
   */
  sheriffSeat?: SeatId | null;
  /** 警徽状态。缺省视为 `none`。 */
  badge?: SheriffBadgeState;

  /** 上警表态（含「不上警」）。公开信息，同时用于判断是否 9 人都表过态。 */
  sheriffSignups?: { seat: SeatId; run: boolean }[];
  /** 上过警的席位（含后来退水的）。这是「警上」集合，退水者仍不能投警长票。 */
  sheriffCandidates?: SeatId[];
  /** 从未上警的席位。只有他们能投警长票（RFC-022 §2.2）。 */
  sheriffVoters?: SeatId[];
  /** 退水表态（含「不退水」）。 */
  sheriffWithdrawals?: { seat: SeatId; withdraw: boolean }[];
  /** 已退水的席位。 */
  sheriffWithdrawn?: SeatId[];
  /** 本轮警长票箱（`SHERIFF_VOTE_CAST` 折叠而来），唱票后清空。 */
  sheriffVotes?: { seat: SeatId; target: SeatId | 'abstain' }[];
  /** 平票 PK 的候选集：首轮并列者。重投只能投他们。 */
  sheriffRunoff?: SeatId[];
  /** 竞选发言 cursor（与白天的 `speech` 完全独立，RFC-022 §13.2）。 */
  sheriffSpeech?: { spoken: SeatId[] };
  /** 警长在 `DAY_SHERIFF_FINAL_SPEECH` 是否已经完成归票发言。 */
  sheriffFinalSpeechDone?: boolean;
  /** 竞选失败原因；`self-exposed` 会改变天亮后的去向（先公布死讯再入夜）。 */
  sheriffElectionFailure?: SheriffElectionFailureReason;
  /** 警长选定的当天发言顺序。 */
  sheriffOrder?: { startSeat: SeatId; direction: SpeechDirection };
  /** 发言方向。缺省为顺时针；`DAY_STARTED` 会重置，警长选择会覆盖。 */
  speechDirection?: SpeechDirection;

  /** 最后一次 `DAY_STARTED` 公布的昨夜死者（按座位升序）。警长选起点时要用。 */
  lastNightDeaths?: SeatId[];
  /** 本天是否已经公布过死讯（首夜死亡延后落地后，开枪阶段要据此判断天亮是否已发生）。 */
  dayAnnounced?: boolean;
  /** 进入 `DAY_BADGE_TRANSFER` 时来自哪个阶段：决定移交后回白天还是入夜。 */
  badgeTransferFrom?: Phase;
}
