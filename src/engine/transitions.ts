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

  // 夜晚阶段（RFC-003）。NIGHT_WOLF_CHAT 由 RFC-005 填；NIGHT_RESOLVE 是无 action 的
  // 自动结算阶段，所以它的允许集为空——任何 action 在那里都是 PHASE_MISMATCH。
  NIGHT_WOLF_CHAT: ['WOLF_CHAT', 'WOLF_READY'],
  // 狼刀由狼队投票决定（RUL-13）；`WOLF_KILL` 保留为兼容旧客户端/回放的直接下刀。
  NIGHT_WOLVES: ['WOLF_VOTE', 'WOLF_KILL'],
  NIGHT_WOLF_RUNOFF: ['WOLF_VOTE'],
  NIGHT_SEER: ['SEER_CHECK'],
  NIGHT_WITCH: ['WITCH_ACT'],
  NIGHT_RESOLVE: [],
  NIGHT_HUNTER_SHOOT: ['HUNTER_SHOOT'],

  // 白天阶段归 RFC-004。空数组意味着「拒绝」而不是「未实现」，见 RFC-002 §2.3 的判据。
  // DAY_ANNOUNCE 是自动阶段（天亮由 step 的自动循环推进），所以它没有允许的 action。
  DAY_ANNOUNCE: [],
  DAY_SPEECH: ['SPEECH', 'SPEECH_SKIP', 'SELF_EXPOSE'],
  DAY_VOTE: ['VOTE', 'SELF_EXPOSE'],
  DAY_VOTE_RUNOFF: ['VOTE'],
  // DAY_LYNCH 是自动阶段（放逐在 VOTE_REVEALED 之后由 step 的自动循环执行）
  DAY_LYNCH: [],
  DAY_HUNTER_SHOOT: ['HUNTER_SHOOT'],
};

/** 表必须覆盖全部 14 个 phase。构造时检查，避免漏一个阶段变成运行时 `undefined`。 */
export function assertCompleteTransitionTable(table: TransitionTable): void {
  for (const phase of PHASES) {
    if (!Array.isArray(table[phase])) {
      throw new Error(`transitions 表缺少阶段 ${phase}`);
    }
  }
}
