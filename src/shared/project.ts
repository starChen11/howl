import type { GameState, Phase, Role, SeatId, SheriffBadgeState, SpeechDirection } from './domain';
import type { EventEnvelope } from './events';

/**
 * 上下文投影的输入与输出（RFC-007 §2.1 / §2.2）。
 *
 * 放在 `src/shared/` 是因为它**同时被服务端组装、被客户端渲染**（API-1）；它只是类型，
 * 不含运行时逻辑，符合 `ARCH-2`。
 */

/** 当前正在请求的决策类型。决定 `legalTargets` 与提示语。 */
export type PendingDecision =
  | 'speak'
  | 'kill'
  | 'wolf-vote'
  | 'wolf-runoff'
  | 'check'
  | 'witch'
  | 'vote'
  | 'shoot'
  | 'chat'
  // RFC-022 新增决策点。服务端尚未接入时可以不产出这些值（向后兼容）。
  | 'sheriff-signup'
  | 'sheriff-speech'
  | 'sheriff-withdraw'
  | 'sheriff-vote'
  | 'sheriff-pk'
  | 'sheriff-runoff'
  | 'badge-transfer'
  | 'sheriff-order'
  | 'sheriff-final-speech'
  | null;

/** 竞选的公开阶段。`null` 表示当前不在竞选。 */
export type SheriffElectionStep =
  'signup' | 'speech' | 'withdraw' | 'vote' | 'pk' | 'runoff' | 'result' | null;

/**
 * 竞选的公开视图（RFC-022 §13.6）。
 *
 * **不包含** `sheriffVotes`：警长票在唱票前是暗投，只能在事件层按 `self:<seat>` 可见性
 * 分发。这里只放全场都看得到的东西。
 */
export interface SheriffElectionView {
  phase: SheriffElectionStep;
  /** 上过警的席位（含后来退水的）。 */
  candidates: SeatId[];
  /** 从未上警、因而有警长投票权的席位。 */
  voters: SeatId[];
  /** 已退水的席位。 */
  withdrawn: SeatId[];
  /** 上警表态（`run: false` 也是表态，复盘要能还原）。 */
  signups: { seat: SeatId; run: boolean }[];
  /** 首轮平票的并列者；重投只能投他们。 */
  runoff: SeatId[];
  /** 观察者自己是否警上 / 是否有警长投票权。 */
  isCandidate: boolean;
  isVoter: boolean;
}

export interface ProjectInput {
  state: GameState;
  events: EventEnvelope[];
  observer: SeatId;
  pending: PendingDecision;
  /** 当轮发言的 `seq`：从 `publicEvents` 中剔除，改由注入槽位承载。 */
  excludeSeq?: number;
}

/** 某个角色「私下知道的事」。无权者一律得到空值，而不是缺键（§2.2）。 */
export interface RoleKnowledge {
  teammates: SeatId[];
  checks: { day: number; target: SeatId; result: 'wolf' | 'not-wolf' }[];
  potions: { heal: 'available' | 'used'; poison: 'available' | 'used' };
  canShoot: boolean;
  knownKillTarget: SeatId | null;
}

/** 观察者能知道的阶段：夜间一律折成 `'NIGHT'`（C-28）。 */
export type ProjectedPhase = 'LOBBY' | 'NIGHT' | Exclude<Phase, 'LOBBY' | 'FINISHED'> | 'FINISHED';

export interface ProjectedContext {
  self: { seat: SeatId; role: Role; alive: boolean; personaId: string | null };
  /** 投影后的阶段：夜间的子阶段（seer / witch / hunter 开枪）全部折成 `'NIGHT'`。 */
  phase: ProjectedPhase;
  day: number;
  aliveSeats: SeatId[];
  deadSeats: SeatId[];
  /** 公开事件（按时间顺序）。 */
  publicEvents: EventEnvelope[];
  /** 该观察者可见的私有事件（按时间顺序）。 */
  privateEvents: EventEnvelope[];
  knowledge: RoleKnowledge;
  legalTargets: (SeatId | 'abstain')[];
  /**
   * 狼队投票是否正在进行（RUL-13）。
   *
   * 只给**存活的狼**为 `true`：这是狼队内部流程，好人连「现在在投狼票」都不该知道。
   * 玩家投完自己那一票后还能靠它看到实时票型与「等待队友」。
   */
  wolfVoteOpen?: boolean;
  /** 狼队投票的候选（重投时只有并列者）。 */
  wolfCandidates?: SeatId[];
  /**
   * 警长与警徽（RFC-022 §13.6）。
   *
   * 这些字段对**所有观察者**可见：警长是公开标志，不是身份牌。服务端投影正在接入
   * （RFC-022 的编排层部分），因此当前保持可选，旧投影器不填也不会破坏类型。
   */
  sheriffSeat?: SeatId | null;
  badge?: SheriffBadgeState;
  /** 竞选公开视图。不在竞选时为 `phase: null`，字段仍可存在。 */
  sheriff?: SheriffElectionView;
  /**
   * 警长今天可选的发言顺序（RFC-022 §3.2）。
   *
   * 只在 `DAY_SHERIFF_ORDER` 填充：动作要同时给起点与方向，只靠 `legalTargets`
   * 表达不了方向，AI 会输出引擎拒绝的组合。
   */
  sheriffOrderOptions?: { startSeat: SeatId; direction: SpeechDirection }[];
  pending: PendingDecision;
}
