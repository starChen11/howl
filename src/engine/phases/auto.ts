import type { GameState } from '@shared/domain';

import type { EventDraft, HandlerContext } from '../step';

/**
 * 自动阶段（RFC-004 的 B 方案）。
 *
 * 有些阶段**没有任何 action 可提交**——它们由规则自动推进：夜晚结算（`NIGHT_RESOLVE`）、
 * 天亮（`DAY_ANNOUNCE`）。若没有这层机制，就只能让「前一个阶段的 handler」顺手把后续事件
 * 全吐出来（RFC-003 最早的做法），代价是逻辑错位、还要把上一条 action 的参数手工传下去。
 *
 * 这里的契约很小：
 *
 * 1. `step` 折叠完一条 action 的所有事件后，若当前阶段登记在本表里，就调用它的 entry，
 *    产出并折叠事件，**继续检查**，直到停在一个不登记的阶段；
 * 2. entry 只读 `state`（此时它需要的数据都已经折叠进状态），不接收 action；
 * 3. 循环有上限（见 `step.ts`），防止 entry 互相跳来跳去时死循环。
 */
export type AutoPhaseEntry = (state: GameState, context: HandlerContext) => EventDraft[];
