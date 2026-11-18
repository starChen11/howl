import type { Phase } from '@shared/domain';
import type { Visibility } from '@shared/events';
import type { EventDraft } from '../step';

/**
 * 相位事件的可见性（C-23 的裁决）。
 *
 * **夜间相位一律 `server`。** 原因很具体：夜间相位的推进序列本身会泄漏隐藏信息——
 *
 * - 跳过 `NIGHT_SEER` 说明 seer 已出局；
 * - 跳过 `NIGHT_WITCH` 说明 witch 已出局；
 * - 进入 `NIGHT_HUNTER_SHOOT` 说明 hunter 死于**狼刀**而不是毒杀。
 *
 * 而 RFC-007 的 `publicEvents` 会把所有 `public` 事件原样放进每个 AI 的上下文，等于让
 * AI 推算出不该知道的身份状态（PRD User Journeys 第 4 步「只看到天黑了」/ `FR-9`）。
 *
 * 白天相位仍然公开：「天亮了」「天黑了」是全场共识，不泄漏任何东西。
 *
 * **玩家端看到的不是 `state.phase` 的原值**：`NIGHT_SEER` / `NIGHT_WITCH` /
 * `NIGHT_HUNTER_SHOOT` 这些子阶段名本身就会泄漏身份存活状态，所以投影（RFC-007）必须把它
 * 折叠成「夜晚 / 白天」两态——这是 C-28，留给 RFC-007 裁决。真正的天亮广播由 RFC-004 的
 * `DAY_STARTED` 承担（payload 只有天数与死者，没有死因）。
 */
export function phaseVisibility(to: Phase): Visibility {
  return to.startsWith('NIGHT_') ? 'server' : 'public';
}

/** 造一条相位推进草稿，可见性由 `phaseVisibility` 统一决定。 */
export function phaseChangedDraft(from: Phase, to: Phase): EventDraft {
  return {
    type: 'PHASE_CHANGED',
    visibleTo: phaseVisibility(to),
    payload: { from, to },
  };
}
