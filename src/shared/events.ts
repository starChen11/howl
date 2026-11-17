import type { Role, RngState, SeatId, WinMode } from './domain';

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

export interface EventEnvelope<T extends string = string, P = unknown> {
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
  /** 按死亡结算顺序。 */
  diedLastNight: SeatId[];
  /** 发言起点。 */
  speechStartSeat: SeatId;
}

/**
 * 事件全集的信封约束（DATA-2）。
 *
 * 本 RFC 定义全集与扩展规则：**各 RFC 只增加成员，不得改写既有成员的 payload**。
 * 新增成员要同时更新 `src/shared/schemas.ts` 里的 payload schema。
 */
export interface GameEventMap {
  GAME_STARTED: GameStartedPayload;
  REJECTED: { actionType: string; code: string; message: string };
  WOLF_KILL_CHOSEN: { target: SeatId };
  SEER_CHECKED: { target: SeatId; result: 'wolf' | 'not-wolf' };
  WITCH_POTION_USED: { potion: 'heal' | 'poison'; target: SeatId };
  PLAYER_DIED: { seat: SeatId; cause: 'wolf' | 'poison' | 'lynch' | 'shoot' };
  HUNTER_SHOOT: { seat: SeatId; target: SeatId | null };
  DAY_STARTED: DayStartedPayload;
  SPEECH: { seat: SeatId; text: string };
  SPEECH_SKIPPED: { seat: SeatId };
  VOTE_CAST: { seat: SeatId; target: SeatId | 'abstain' };
  VOTE_REVEALED: { votes: { seat: SeatId; target: SeatId | 'abstain' }[] };
  WOLF_CHAT_POSTED: { seat: SeatId; text: string; round: 'night-chat' };
  SELF_EXPOSE: { seat: SeatId };
  AI_THOUGHT: { reason: string; claim?: unknown; decisionSeq: number };
  GAME_ENDED: { result: 'wolf' | 'good'; condition: string };
  DEGRADED: { seat: SeatId };
}

export type GameEventType = keyof GameEventMap;
