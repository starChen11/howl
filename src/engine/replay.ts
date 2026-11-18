import type { GameState } from '@shared/domain';
import type { GameEvent } from '@shared/events';

import { applyEvent } from './apply';
import { createEmptyState } from './init';
import { InvalidEventStreamError } from './errors';

/**
 * 从事件流重建状态（RFC-002 §2.2）。
 *
 * **只接收事件流**，不需要外部初始状态：首个事件必须是 `GAME_STARTED`，它携带重建开局所需
 * 的全部输入（规则、种子、人格、玩家席位）。这样「刷新后恢复」「复盘」「headless 重跑」
 * 都走同一条路径，不存在「恢复时又发了一次牌」的可能。
 *
 * 它同时是 C-18 那条纪律的验收手段：`GameState` 里凡是由事件折叠出来的值，`replay` 必须
 * 全部重建——重建不出来，就说明有人在 `step` 里绕过 `applyEvent` 改了状态。
 */
export function replay(events: readonly GameEvent[]): GameState {
  const first = events[0];
  if (first === undefined) {
    throw new InvalidEventStreamError('事件流为空：replay 至少需要一个 GAME_STARTED');
  }
  if (first.type !== 'GAME_STARTED') {
    throw new InvalidEventStreamError(`事件流的首个事件必须是 GAME_STARTED，收到 ${first.type}`);
  }

  return events.reduce<GameState>((state, event) => applyEvent(state, event), createEmptyState());
}
