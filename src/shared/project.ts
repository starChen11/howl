import type { GameState, Phase, Role, SeatId } from './domain';
import type { EventEnvelope } from './events';

/**
 * 上下文投影的输入与输出（RFC-007 §2.1 / §2.2）。
 *
 * 放在 `src/shared/` 是因为它**同时被服务端组装、被客户端渲染**（API-1）；它只是类型，
 * 不含运行时逻辑，符合 `ARCH-2`。
 */

/** 当前正在请求的决策类型。决定 `legalTargets` 与提示语。 */
export type PendingDecision =
  'speak' | 'kill' | 'check' | 'witch' | 'vote' | 'shoot' | 'chat' | null;

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

export interface ProjectedContext {
  self: { seat: SeatId; role: Role; alive: boolean; personaId: string | null };
  phase: Phase;
  day: number;
  aliveSeats: SeatId[];
  deadSeats: SeatId[];
  /** 公开事件（按时间顺序）。 */
  publicEvents: EventEnvelope[];
  /** 该观察者可见的私有事件（按时间顺序）。 */
  privateEvents: EventEnvelope[];
  knowledge: RoleKnowledge;
  legalTargets: (SeatId | 'abstain')[];
  pending: PendingDecision;
}
