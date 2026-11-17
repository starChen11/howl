import type { GameState, Role, SeatId } from './domain';
import type { EventEnvelope, Visibility } from './events';
import { SELF_VISIBILITY_PREFIX } from './events';

/**
 * 事件可见性判定：**客户端与服务端共用同一份**实现。
 *
 * 这是 `src/shared/` 里唯一带运行时逻辑的文件。允许它存在是因为两边判定必须完全一致——
 * 各写一份就是「AI 不作弊」这个卖点的漏洞（RFC-001 Q-001-2 / C-4）。
 *
 * @param event  待判定的事件
 * @param observer 观察者席位
 * @param state  事件发生**之后**的状态快照（`diedSeq` 判定依赖它）
 */
export function isVisibleTo(event: EventEnvelope, observer: SeatId, state: GameState): boolean {
  const visibility = event.visibleTo;

  if (visibility === 'public') return true;

  // 服务端专用：任何席位都不可见。
  if (visibility === 'server') return false;

  if (visibility.startsWith(SELF_VISIBILITY_PREFIX)) {
    return visibility === `${SELF_VISIBILITY_PREFIX}${observer}`;
  }

  const requiredRole = roleForScopedVisibility(visibility);
  if (requiredRole === null) {
    // ARCH-11：未裁决的分支抛错，不默认放行也不默认拒绝。
    throw new Error(`未知的可见性取值：${String(visibility)}`);
  }

  const self = state.seats.find((seat) => seat.seat === observer);
  if (self === undefined) {
    throw new Error(`观察者席位 ${observer} 不在本局座位表中`);
  }

  if (self.role !== requiredRole) return false;

  // 出局后不再看到新事件，但出局之前发生的仍然看得到。
  return self.diedSeq === undefined || self.diedSeq > event.seq;
}

function roleForScopedVisibility(visibility: Visibility): Role | null {
  switch (visibility) {
    case 'wolves':
      return 'wolf';
    case 'seer':
      return 'seer';
    case 'witch':
      return 'witch';
    case 'hunter':
      return 'hunter';
    default:
      return null;
  }
}
