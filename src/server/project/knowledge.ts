import type { GameState, SeatId } from '@shared/domain';

import type { RoleKnowledge } from '@shared/project';
import type { PendingDecision } from '@shared/project';
import type { EventEnvelope, GameEvent } from '@shared/events';
import { seatAt } from '@engine/queries';

/**
 * 每个身份的「私货」派生（RFC-007 §2.2 / §2.4）。
 *
 * 核心规则：**无权者得到空值而不是缺键**。这样「AI 没拿到这个信息」是可断言的
 * （`checks` 为空数组、`potions` 两项都 `used`），而不是靠字段消失来推断——字段消失
 * 既不好测，也容易被将来的序列化差异掩盖。
 */

/** 观察者自己的角色。 */
function roleOf(state: GameState, observer: SeatId) {
  return seatAt(state, observer).role;
}

/** 狼的队友（不含自己，含已出局的——死了的队友仍然是队友）。 */
function teammatesOf(state: GameState, observer: SeatId): SeatId[] {
  if (roleOf(state, observer) !== 'wolf') return [];
  return state.seats
    .filter((seat) => seat.role === 'wolf' && seat.seat !== observer)
    .map((seat) => seat.seat);
}

/**
 * seer 的历史查验。
 *
 * 从**该观察者可见的** `SEER_CHECKED` 事件里取：不可见的事件不能进知识（那本身就是泄漏）。
 * `day` 取自事件发生时的状态——这里用事件 payload 的 target/result 与事件所在的 `seq`
 * 推到当天：`SEER_CHECKED` 都发生在夜间，天数为事件之前状态的天数，简化为「按出现顺序编号」。
 */
function checksOf(
  state: GameState,
  observer: SeatId,
  visibleEvents: readonly EventEnvelope[],
): RoleKnowledge['checks'] {
  if (roleOf(state, observer) !== 'seer') return [];

  return visibleEvents
    .filter(
      (event): event is Extract<GameEvent, { type: 'SEER_CHECKED' }> =>
        event.type === 'SEER_CHECKED',
    )
    .map((event, index) => ({
      day: index + 1,
      target: event.payload.target,
      result: event.payload.result,
    }));
}

/** witch 的药。非 witch 两项都给 `used`——她对这两个信息没有权限。 */
function potionsOf(state: GameState, observer: SeatId): RoleKnowledge['potions'] {
  if (roleOf(state, observer) !== 'witch') {
    return { heal: 'used', poison: 'used' };
  }
  const used = state.potionsUsed ?? { heal: false, poison: false };
  return {
    heal: used.heal ? 'used' : 'available',
    poison: used.poison ? 'used' : 'available',
  };
}

/**
 * witch 在本夜能看到的刀口（RFC-003 §2.5）。
 *
 * 这不是可见性例外——真实规则本就告知 witch 刀口；投影只是把「她该知道什么」显式化。
 */
function knownKillTargetOf(
  state: GameState,
  observer: SeatId,
  pending: PendingDecision,
): SeatId | null {
  if (roleOf(state, observer) !== 'witch') return null;
  if (pending !== 'witch') return null;
  return state.night?.killTarget ?? null;
}

/** 只有「当前处在 hunter 开枪阶段且自己就是 hunter」才为 true。 */
function canShootOf(state: GameState, observer: SeatId): boolean {
  const self = seatAt(state, observer);
  if (self.role !== 'hunter') return false;
  if (self.alive) return false;
  return state.phase === 'NIGHT_HUNTER_SHOOT' || state.phase === 'DAY_HUNTER_SHOOT';
}

/** 组装该观察者的全部私有知识。 */
export function knowledgeOf(
  state: GameState,
  observer: SeatId,
  visibleEvents: readonly EventEnvelope[],
  pending: PendingDecision,
): RoleKnowledge {
  return {
    teammates: teammatesOf(state, observer),
    checks: checksOf(state, observer, visibleEvents),
    potions: potionsOf(state, observer),
    canShoot: canShootOf(state, observer),
    knownKillTarget: knownKillTargetOf(state, observer, pending),
  };
}
