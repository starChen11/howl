import type { Action } from './actions';
import type {
  Phase,
  Role,
  RngState,
  SeatId,
  SheriffElectionFailureReason,
  SheriffVoteRound,
  SpeechDirection,
  WinMode,
} from './domain';
import type { CountedVote } from './votes';

/**
 * 可见性。事件的 `visibleTo` 决定谁能在投影里看到它。
 *
 * - `public` —— 全场可见
 * - `wolves` / `seer` / `witch` / `hunter` —— 仅该身份的席位可见
 * - `server` —— 服务端专用：**任何席位都不可见**。用于只供服务端重建状态的事件
 *   （例如 `GAME_STARTED` 携带的全员身份）
 * - `self:<seat>` —— 仅该席位可见
 *
 * 判定函数在 `./visibility.ts`（客户端与服务端共用同一份）。
 */
export type Visibility =
  'public' | 'wolves' | 'seer' | 'witch' | 'hunter' | 'server' | `self:${SeatId}`;

/**
 * `self:<seat>` 的前缀。判定（`./visibility.ts`）与校验（`./schemas.ts`）都从这里取，
 * 不各写一份字面量。
 */
export const SELF_VISIBILITY_PREFIX = 'self:';

/**
 * 事件信封。
 *
 * 默认类型参数刻意收紧：`type` 只能是 `GameEventMap` 的成员（DATA-2），`payload` 仍是
 * `unknown`（具体形状由 `GameEvent` 绑定）。这样连「只知道是事件」的位置也写不出假类型——
 * 评审的 M11 探针正是从 `EventEnvelope` 早期的 `type: string` 默认值溜过去的。
 *
 * 两侧的回归夹具都在 `tests/shared/events.test.ts`：一处守 `type`（B3），一处守
 * `payload` 必须走 `GameEvent`。
 */
export interface EventEnvelope<T extends GameEventType = GameEventType, P = unknown> {
  gameId: string;
  /** 单局内从 1 严格递增（不是会话级）。SSE 的 `id` 直接用它（API-2）。 */
  seq: number;
  ts: number;
  type: T;
  /** 必填。公开事件写 `'public'`。 */
  visibleTo: Visibility;
  /** 产生该事件时若消耗了随机数，必须记录抽取**之后**的生成器状态（DATA-3）。 */
  rngAfter?: RngState;
  payload: P;
}

/**
 * 发牌结果。
 *
 * 本类型归 RFC-002（`GAME_STARTED` 的 payload），在此声明是因为 `GameEventMap` 需要它，
 * 而跨层类型只能有一个归属（RFC-001 §2.3）。字段与 RFC-002 §2 完全一致。
 */
export interface GameStartedPayload {
  seed: number;
  mode: WinMode;
  playerSeat: SeatId;
  /** 按座位 1..9 排列：唯一权威的发牌结果。 */
  roles: Role[];
  /** 每席人格 id，AI 席非空。v1 由 RFC-009 填充。 */
  personas: (string | null)[];
}

/**
 * 一天开始。
 *
 * 本类型归 RFC-004，理由同上。字段与 RFC-004 §2 完全一致。
 */
export interface DayStartedPayload {
  day: number;
  /** **按座位升序**（不得携带死因顺序，C-31）。 */
  diedLastNight: SeatId[];
  /** 发言起点。 */
  speechStartSeat: SeatId;
}

/**
 * AI 在结构化输出里「声称自己是什么、验过谁、指认谁」（RFC-006 §2.2 / RFC-009 §2.2）。
 *
 * 三个字段是同一个东西的三面：这次发言**对外声称了什么**。所以它们作为一个可选对象
 * 存在，而不是摊平成三个互不相干的顶层字段——这就是 CR-003 的 C3 裁决。
 */
export interface ClaimedCheck {
  target: SeatId;
  result: 'wolf' | 'not-wolf';
}

export interface ClaimedAccusation {
  target: SeatId;
  /** 指认对方是什么身份。字段名以 RFC-006 为准（RFC-009 早期写作 `asRole`，已统一）。 */
  as: 'wolf' | 'seer';
}

export interface Claim {
  role?: Role;
  checks?: ClaimedCheck[];
  accuses?: ClaimedAccusation[];
}

/* ---------------------------------------------------------------------------
 * RFC-022 · 警长竞选与警徽
 * ------------------------------------------------------------------------- */

/** 第一次进入竞选。`day` 目前恒为 1，保留字段是为了将来多板子/复盘时自解释。 */
export interface SheriffElectionStartedPayload {
  day: number;
}

/** 上警表态。`run: false` 表示明确选择不上警——也必须写事件，否则重放不知道他表过态。 */
export interface SheriffSignupPayload {
  seat: SeatId;
  run: boolean;
}

/** 全部上警表态结束后公布的候选人名单（按座位升序）。 */
export interface SheriffCandidatesPayload {
  candidates: SeatId[];
}

/** 竞选 / PK 阶段的警上发言（与白天的 `SPEECH` 事件独立，RFC-022 §13.2；归票发言仍用 `SPEECH`）。 */
export interface SheriffSpeechPayload {
  seat: SeatId;
  text: string;
}

export interface SheriffSpeechSkippedPayload {
  seat: SeatId;
}

/** 退水表态。`withdraw: false` 表示明确选择不退水。 */
export interface SheriffWithdrawnPayload {
  seat: SeatId;
  withdraw: boolean;
}

/** 警长票是暗投：与 `VOTE_CAST` 一样只有投票者本人可见。 */
export interface SheriffVoteCastPayload {
  seat: SeatId;
  target: SeatId | 'abstain';
}

/** 警长票唱票。`tied` 非空表示平票（首轮进 PK，重投则无警长）。 */
export interface SheriffVoteRevealedPayload {
  votes: { seat: SeatId; target: SeatId | 'abstain' }[];
  round: SheriffVoteRound;
  tied?: SeatId[];
}

export interface SheriffElectedPayload {
  seat: SeatId;
}

export interface SheriffElectionFailedPayload {
  reason: SheriffElectionFailureReason;
}

/** 警徽移交。`from` 是死亡警长，`to` 是接任者。 */
export interface BadgeTransferredPayload {
  from: SeatId;
  to: SeatId;
}

/** 撕徽。`seat` 是撕徽的死亡警长。 */
export interface BadgeDestroyedPayload {
  seat: SeatId;
}

/** 警长选定的当天发言顺序。方向是权威，不允许从起点位置反推。 */
export interface SheriffOrderChosenPayload {
  startSeat: SeatId;
  direction: SpeechDirection;
}

/**
 * 放逐票型公布（RFC-004，RFC-022 §13.4 扩展）。
 *
 * - `votes` 是原始票（审计用）；
 * - `countedVotes` 是每位投票者折算后的半票（普通 2、警长 3）；
 * - `sheriffSeat` 是投票时的警长快照。
 *
 * 后两个字段是 RFC-022 新增的，旧对局的事件流里没有，因此保持可选；`applyEvent` 在缺省时
 * 回退到原始票等权计票。
 */
export interface VoteRevealedPayload {
  votes: { seat: SeatId; target: SeatId | 'abstain' }[];
  countedVotes?: CountedVote[];
  sheriffSeat?: SeatId | null;
}

/**
 * 事件全集的信封约束（DATA-2）。
 *
 * 本 RFC 定义全集与扩展规则：**各 RFC 只增加成员，不得改写既有成员的 payload**。
 * 新增成员要同时更新 `src/shared/schemas.ts` 里的 payload schema。
 */
export interface GameEventMap {
  GAME_STARTED: GameStartedPayload;
  /** `actionType` 是 `Action['type']` 而不是 `string`：`DATA-2` 的「不得用裸字符串」同样适用于载荷（CR-003 C1，与 RFC-002 §2.3 一致）。 */
  REJECTED: { actionType: Action['type']; code: string; message: string };
  WOLF_KILL_CHOSEN: { target: SeatId };
  /** 狼队内部投票（RUL-13）：每人一票，票型只有狼看得到。 */
  WOLF_VOTE_CAST: { seat: SeatId; target: SeatId | 'abstain'; confirmed: boolean };
  WOLF_VOTE_CONFIRMED: { seat: SeatId };
  /** 唱票结果：`tied` 非空表示进入重投。 */
  WOLF_VOTE_REVEALED: {
    votes: { seat: SeatId; target: SeatId | 'abstain' }[];
    tied?: SeatId[];
  };
  SEER_CHECKED: { target: SeatId; result: 'wolf' | 'not-wolf' };
  WITCH_POTION_USED: { potion: 'heal' | 'poison'; target: SeatId };
  PLAYER_DIED: { seat: SeatId; cause: 'wolf' | 'poison' | 'lynch' | 'shoot' };
  HUNTER_SHOOT: { seat: SeatId; target: SeatId | null };
  DAY_STARTED: DayStartedPayload;
  SPEECH: { seat: SeatId; text: string };
  SPEECH_SKIPPED: { seat: SeatId };
  VOTE_CAST: { seat: SeatId; target: SeatId | 'abstain' };
  VOTE_REVEALED: VoteRevealedPayload;
  WOLF_READY_MARKED: { seat: SeatId };
  WOLF_CHAT_POSTED: { seat: SeatId; text: string; round: 'night-chat' };
  SELF_EXPOSE: { seat: SeatId };

  /* ---- RFC-022 · 警长竞选与警徽 ---- */
  SHERIFF_ELECTION_STARTED: SheriffElectionStartedPayload;
  SHERIFF_SIGNUP: SheriffSignupPayload;
  SHERIFF_CANDIDATES: SheriffCandidatesPayload;
  SHERIFF_SPEECH: SheriffSpeechPayload;
  SHERIFF_SPEECH_SKIPPED: SheriffSpeechSkippedPayload;
  SHERIFF_WITHDRAWN: SheriffWithdrawnPayload;
  SHERIFF_VOTE_CAST: SheriffVoteCastPayload;
  SHERIFF_VOTE_REVEALED: SheriffVoteRevealedPayload;
  SHERIFF_ELECTED: SheriffElectedPayload;
  SHERIFF_ELECTION_FAILED: SheriffElectionFailedPayload;
  BADGE_TRANSFERRED: BadgeTransferredPayload;
  BADGE_DESTROYED: BadgeDestroyedPayload;
  SHERIFF_ORDER_CHOSEN: SheriffOrderChosenPayload;

  /**
   * 阶段推进（RFC-003 引入）。
   *
   * 为什么需要一个事件：`NIGHT_WITCH` 收到 `potion: 'none'` 时**什么也没发生**，没有别的
   * 事件可承载「这一阶段结束了」。没有它，相位推进只能靠「隐式推导」，而「无事发生」的
   * 转移无处安放，`replay` 也就重建不出阶段序列。
   *
   * `applyEvent` 会校验 `from === state.phase`：不一致说明事件流被拼错了。
   */
  PHASE_CHANGED: { from: Phase; to: Phase };
  AI_THOUGHT: {
    reason: string;
    claim?: Claim;
    decisionSeq: number;
    seat: SeatId;
    phase?: Phase;
    decisionAction?: string;
    target?: SeatId | 'abstain';
    /**
     * 没有 `target` 的警长决策（上警 / 退水 / 撕徽 / 定序方向）的可读选择。
     * 复盘只靠结构化字段展示推理（AI-5），不能从自由文本里猜。
     */
    detail?: string;
  };
  GAME_ENDED: { result: 'wolf' | 'good'; condition: string };
  DEGRADED: { seat: SeatId };
}

export type GameEventType = keyof GameEventMap;

/**
 * 事件类型的**运行时可枚举**集合。
 *
 * `GameEventMap` 是接口，类型擦除后拿不到键；而 Zod 校验与出站事件校验需要一份运行时清单。
 * 这里显式列一次，`satisfies` 拦住写错的成员，并由
 * `tests/shared/events.test.ts` 用 `expectTypeOf` 断言它与 `keyof GameEventMap`
 * **完全相等**——多了少了都会编译失败。
 */
export const GAME_EVENT_TYPES = [
  'GAME_STARTED',
  'REJECTED',
  'WOLF_KILL_CHOSEN',
  'WOLF_VOTE_CAST',
  'WOLF_VOTE_CONFIRMED',
  'WOLF_VOTE_REVEALED',
  'SEER_CHECKED',
  'WITCH_POTION_USED',
  'PLAYER_DIED',
  'HUNTER_SHOOT',
  'DAY_STARTED',
  'SPEECH',
  'SPEECH_SKIPPED',
  'VOTE_CAST',
  'VOTE_REVEALED',
  'WOLF_CHAT_POSTED',
  'WOLF_READY_MARKED',
  'SELF_EXPOSE',
  'SHERIFF_ELECTION_STARTED',
  'SHERIFF_SIGNUP',
  'SHERIFF_CANDIDATES',
  'SHERIFF_SPEECH',
  'SHERIFF_SPEECH_SKIPPED',
  'SHERIFF_WITHDRAWN',
  'SHERIFF_VOTE_CAST',
  'SHERIFF_VOTE_REVEALED',
  'SHERIFF_ELECTED',
  'SHERIFF_ELECTION_FAILED',
  'BADGE_TRANSFERRED',
  'BADGE_DESTROYED',
  'SHERIFF_ORDER_CHOSEN',
  'PHASE_CHANGED',
  'AI_THOUGHT',
  'GAME_ENDED',
  'DEGRADED',
] as const satisfies readonly GameEventType[];

/**
 * 事件的完整类型：`type` 与 `payload` 由 `GameEventMap` 静态绑定。
 *
 * `EventEnvelope` 的默认 `type` 已经是 `GameEventType`（写不出假类型），但默认 `payload`
 * 仍是 `unknown`——它不知道具体是哪一种事件。所以**任何真正构造事件的地方都必须用
 * `GameEvent`**，否则 DATA-2「事件类型必须是联合类型的枚举成员」以及「payload 由
 * `GameEventMap` 约束」都只是一句注释。
 */
export type GameEvent = {
  [K in GameEventType]: EventEnvelope<K, GameEventMap[K]>;
}[GameEventType];
