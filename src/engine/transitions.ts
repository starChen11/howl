import type { Action } from '@shared/actions';
import type { Phase } from '@shared/domain';
import { PHASES } from '@shared/domain';

/**
 * 「每个 phase 允许哪些 action」的唯一声明处（RFC-002 §4）。
 *
 * `step` 只查这张表，不在各 handler 里散落判断。查不到（或表里没有该 action）就是
 * `PHASE_MISMATCH`，产出 `Rejected` 事件而不是抛错。
 *
 * **RFC-002 只填 `LOBBY` 与 `FINISHED`**（§6 的边界）：其余 12 个阶段由 RFC-003/004/005
 * 追加到同一个对象。空数组是有意的——「这个阶段还没有任何允许的 action」比「忘了填」
 * 更安全，因为它会走 `Rejected` 而不是静默放行。
 */

export type TransitionTable = Readonly<Record<Phase, readonly Action['type'][]>>;

export const DEFAULT_TRANSITIONS: TransitionTable = {
  LOBBY: ['START'],
  FINISHED: [],

  // 以下阶段归 RFC-003/004/005，实现时往数组里加。
  NIGHT_WOLF_CHAT: [],
  NIGHT_WOLVES: [],
  NIGHT_SEER: [],
  NIGHT_WITCH: [],
  NIGHT_RESOLVE: [],
  NIGHT_HUNTER_SHOOT: [],
  DAY_ANNOUNCE: [],
  DAY_SPEECH: [],
  DAY_VOTE: [],
  DAY_VOTE_RUNOFF: [],
  DAY_LYNCH: [],
  DAY_HUNTER_SHOOT: [],
};

/** 表必须覆盖全部 14 个 phase。构造时检查，避免漏一个阶段变成运行时 `undefined`。 */
export function assertCompleteTransitionTable(table: TransitionTable): void {
  for (const phase of PHASES) {
    if (!Array.isArray(table[phase])) {
      throw new Error(`transitions 表缺少阶段 ${phase}`);
    }
  }
}
