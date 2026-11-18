import type { GameState, SeatId } from '@shared/domain';
import { isVisibleTo } from '@shared/visibility';
import type { ProjectedContext, ProjectInput } from '@shared/project';
import type { EventEnvelope } from '@shared/events';

import { applyEvent } from '@engine/apply';
import { createEmptyState } from '@engine/init';
import { seatAt } from '@engine/queries';
import { knowledgeOf } from './knowledge';
import { legalTargetsOf } from './targets';

/**
 * 上下文投影（RFC-007 §2.1 / §2.3）。
 *
 * **这是「AI 不作弊」的执行者**：它决定一个座位能看到什么。它的输出就是喂给 AI 的全部
 * 输入，所以任何多给一条，都等于让 AI 看见了它不该看的东西。
 *
 * 两条实现上的关键点：
 *
 * 1. **必须按序折叠**：`isVisibleTo` 的第三个参数是「事件发生后的状态快照」，因为它要比较
 *    观察者的 `diedSeq` 与该事件的 `seq`。拿当前状态去判全部历史事件，会把「死前可见」判成
 *    「死后不可见」（或反之）。
 * 2. **纯函数**（ARCH-8）：不调 LLM、不读时钟、不读环境、不缓存。
 */
export function project(input: ProjectInput): ProjectedContext {
  const { state, events, observer, pending, excludeSeq } = input;

  const publicEvents: EventEnvelope[] = [];
  const privateEvents: EventEnvelope[] = [];

  let cursor: GameState = createEmptyState();

  for (const event of events) {
    // 折叠到「这条事件之后」的状态，再拿它判断可见性。
    cursor = applyEvent(cursor, event as never);

    if (excludeSeq !== undefined && event.seq === excludeSeq) continue;
    if (!isVisibleTo(event, observer, cursor)) continue;

    if (event.visibleTo === 'public') {
      publicEvents.push(event);
    } else {
      privateEvents.push(event);
    }
  }

  const self = seatAt(state, observer);
  const visible = [...publicEvents, ...privateEvents];

  return {
    self: {
      seat: observer,
      role: self.role,
      alive: self.alive,
      personaId: self.personaId ?? null,
    },
    phase: state.phase,
    day: state.day,
    aliveSeats: state.seats.filter((seat) => seat.alive).map((seat) => seat.seat),
    deadSeats: state.seats.filter((seat) => !seat.alive).map((seat) => seat.seat),
    publicEvents,
    privateEvents,
    knowledge: knowledgeOf(state, observer, visible, pending),
    legalTargets: legalTargetsOf(state, pending),
    pending,
  };
}

/** 观察者是否能看到这条事件（投影用的便捷包装，语义与 `isVisibleTo` 一致）。 */
export function observes(state: GameState, event: EventEnvelope, observer: SeatId): boolean {
  return isVisibleTo(event, observer, state);
}
