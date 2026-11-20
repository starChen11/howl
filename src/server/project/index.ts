import type { GameState, Phase, SeatId } from '@shared/domain';
import { isVisibleTo } from '@shared/visibility';
import type { ProjectedContext, ProjectedPhase, ProjectInput } from '@shared/project';
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

  // 观察者「知道死了谁」的来源只有两种：公开的 `PLAYER_DIED`（放逐 / 开枪），
  // 以及天亮时公布的 `DAY_STARTED.diedLastNight`。夜间的 `PLAYER_DIED` 是 server 可见的，
  // 不会进这里——所以当夜死者不会提前泄漏（C-28）。
  const knownDead = new Set<SeatId>();
  for (const event of visible) {
    if (event.type === 'PLAYER_DIED') {
      knownDead.add((event.payload as { seat: SeatId }).seat);
    }
    if (event.type === 'DAY_STARTED') {
      const payload = event.payload as { diedLastNight: SeatId[] };
      for (const seat of payload.diedLastNight) knownDead.add(seat);
    }
  }

  // 终局是例外：对局结束时身份与死亡全部揭示（复盘的前提）。此时没有「等天亮公布」
  // 这回事——包括「夜里直接分出胜负、没走到天亮」的终局。
  if (state.phase === 'FINISHED') {
    for (const seat of state.seats) {
      if (!seat.alive) knownDead.add(seat.seat);
    }
  }

  const aliveSeats = state.seats
    .filter((seat) => !knownDead.has(seat.seat))
    .map((seat) => seat.seat);

  return {
    self: {
      seat: observer,
      role: self.role,
      alive: self.alive,
      personaId: self.personaId ?? null,
    },
    phase: projectedPhaseOf(state.phase),
    day: state.day,
    aliveSeats,
    deadSeats: [...knownDead].sort((a, b) => a - b),
    publicEvents,
    privateEvents,
    knowledge: knowledgeOf(state, observer, visible, pending),
    legalTargets: legalTargetsOf(state, pending, aliveSeats, observer),
    pending,
    ...(self.role === 'wolf' && self.alive
      ? {
          wolfVoteOpen: state.phase === 'NIGHT_WOLVES' || state.phase === 'NIGHT_WOLF_RUNOFF',
          wolfCandidates:
            state.phase === 'NIGHT_WOLF_RUNOFF'
              ? [...(state.wolfRunoff ?? [])]
              : aliveSeats.filter((seat) => seatAt(state, seat).role !== 'wolf'),
        }
      : {}),
  };
}

/**
 * 阶段折叠（C-28）：夜间的子阶段会泄漏身份存活状态——
 *
 * - 看到 `NIGHT_SEER` 说明 seer 还活着；
 * - 看到 `NIGHT_WITCH` 说明 witch 还活着；
 * - 看到 `NIGHT_HUNTER_SHOOT` 说明 hunter 今夜被 wolf 刀杀（被毒杀不会开枪）。
 *
 * 所以夜里一律告诉观察者「天黑了」。白天的不需要折叠：那些阶段全场都醒着。
 */
function projectedPhaseOf(phase: Phase): ProjectedPhase {
  return phase.startsWith('NIGHT_') ? 'NIGHT' : phase;
}

/** 观察者是否能看到这条事件（投影用的便捷包装，语义与 `isVisibleTo` 一致）。 */
export function observes(state: GameState, event: EventEnvelope, observer: SeatId): boolean {
  return isVisibleTo(event, observer, state);
}
