import type { GameState } from '@shared/domain';
import { EFFECT_ORDER } from '@shared/effects';

import { applyEffects } from '../effects';
import { seatAt } from '../queries';
import { DEATH_APPLIERS } from '../resolve/deaths';
import type { EventDraft } from '../step';
import { checkWin } from '../win';
import { enterNight } from './vote';
import { phaseChangedDraft } from './visibility';

/**
 * 放逐与放逐后的开枪（RFC-004 §2.4）。
 *
 * `DAY_LYNCH` 是**自动阶段**：谁被放逐已经在 `VOTE_REVEALED` 折叠进 `state.lynched`，
 * 这里只负责让他出局、判一次胜负、决定是否有开枪机会。
 *
 * 与 RFC-003 的夜间开枪是**同一套胜负顺序**（RUL-1）：先判、后技能、再判。
 */

/** `DAY_LYNCH` 的自动推进。 */
export function lynchEntry(state: GameState): EventDraft[] {
  const lynched = state.lynched;
  if (lynched === undefined) {
    // 没有放逐目标却进了 DAY_LYNCH：事件流被拼错了，不能静默跳过。
    throw new Error('DAY_LYNCH 阶段没有记录被放逐者');
  }

  const drafts: EventDraft[] = [
    { type: 'PLAYER_DIED', visibleTo: 'public', payload: { seat: lynched, cause: 'lynch' } },
  ];

  // 第一次判定：死亡已应用。用效果管道保证「应用顺序」与夜间一致。
  const afterDeath = applyEffects(
    state,
    [
      {
        id: 'lynch',
        source: 'role',
        type: 'kill',
        target: lynched,
        payload: { cause: 'lynch' },
        order: EFFECT_ORDER.DEATH,
      },
    ],
    DEATH_APPLIERS,
  );

  const win = checkWin(afterDeath);
  if (win !== null) {
    drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
    return drafts;
  }

  // RUL-1：只有被放逐的是 hunter 时才进开枪阶段；且他必须是刚出局的那个。
  if (seatAt(state, lynched).role === 'hunter') {
    drafts.push(phaseChangedDraft('DAY_LYNCH', 'DAY_HUNTER_SHOOT'));
    return drafts;
  }

  // RFC-022 §3.3：警长被放逐后先移交/撕徽，再进入夜晚。
  if (state.sheriffSeat === lynched) {
    drafts.push(phaseChangedDraft('DAY_LYNCH', 'DAY_BADGE_TRANSFER'));
    return drafts;
  }

  drafts.push(...enterNight('DAY_LYNCH'));
  return drafts;
}
