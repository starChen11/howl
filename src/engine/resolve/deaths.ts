import type { SeatId } from '@shared/domain';
import type { Effect } from '@shared/effects';
import { EFFECT_ORDER } from '@shared/effects';

import type { EffectApplierMap } from '../effects';

/**
 * 夜晚死亡结算（RFC-003 §2.3）。
 *
 * 固定顺序（RUL-8 + FR-17），产出 `Effect[]`（`source: 'role'`），按 RFC-001 §2.3 的
 * `order` 分区落位：
 *
 * | order | 效果 | 规则 |
 * |---|---|---|
 * | 0（抵消） | 解药 | 必须在击杀之前（RUL-8） |
 * | 100（死亡） | 狼刀、毒药 | 结果以 `PLAYER_DIED` 事件记录 |
 * | 200（死亡触发） | hunter 开枪 | RFC-003 的 `phases/night.ts` 产出，先判胜负（RUL-1） |
 *
 * **解药不直接改状态**：它通过「不产生击杀效果」来抵消狼刀——这是 RUL-8 的直接表达，
 * 而不是「先杀后救」的两步操作（那样会出现一个中间态「死了又活」）。
 */

/** 死因。与 `PLAYER_DIED.cause` 同一份枚举。 */
export type DeathCause = 'wolf' | 'poison' | 'lynch' | 'shoot';

export interface Death {
  readonly seat: SeatId;
  readonly cause: DeathCause;
}

export interface NightResolutionInput {
  readonly killTarget?: SeatId;
  readonly healTarget?: SeatId;
  readonly poisonTarget?: SeatId;
}

export interface NightResolution {
  readonly effects: Effect[];
  readonly deaths: Death[];
  /** 解药是否正好落在刀口上（RUL-8 的抵消）。 */
  readonly killCancelled: boolean;
}

/**
 * 计算本夜的死亡与效果。
 *
 * 步骤与 RFC-003 §2.3 的 1–4 步一一对应：
 * 1. 读出刀口；
 * 2. 解药命中刀口 → 该目标存活、当夜无狼刀死亡；
 * 3. 否则刀口出局；
 * 4. 毒药目标出局。
 */
export function resolveNight(input: NightResolutionInput): NightResolution {
  const { killTarget, healTarget, poisonTarget } = input;
  const killCancelled = killTarget !== undefined && healTarget === killTarget;

  const effects: Effect[] = [];
  const deaths: Death[] = [];

  if (healTarget !== undefined) {
    effects.push({
      id: 'night-heal',
      source: 'role',
      type: 'heal',
      target: healTarget,
      payload: {},
      order: EFFECT_ORDER.CANCEL,
    });
  }

  if (killTarget !== undefined && !killCancelled) {
    effects.push({
      id: 'night-kill',
      source: 'role',
      type: 'kill',
      target: killTarget,
      payload: { cause: 'wolf' satisfies DeathCause },
      order: EFFECT_ORDER.DEATH,
    });
    deaths.push({ seat: killTarget, cause: 'wolf' });
  }

  if (poisonTarget !== undefined) {
    effects.push({
      id: 'night-poison',
      source: 'role',
      type: 'kill',
      target: poisonTarget,
      payload: { cause: 'poison' satisfies DeathCause },
      order: EFFECT_ORDER.DEATH,
    });
    deaths.push({ seat: poisonTarget, cause: 'poison' });
  }

  return { effects, deaths, killCancelled };
}

/**
 * hunter 开枪的效果与死亡（RFC-003 §2.3 第 6–7 步）。
 *
 * 单独一个函数而不是内联在 handler 里，是因为 AC-12 / AC-15 要直接断言「开枪效果带
 * `source: 'role'`、且 `order` 在击杀之后」——若效果只存在于 handler 内部，测试就只能
 * 靠间接推断。
 */
export function resolveHunterShot(target: SeatId | undefined): {
  effects: Effect[];
  deaths: Death[];
} {
  if (target === undefined) {
    // 放弃开枪：没有效果，也没有死亡。阶段仍然结束。
    return { effects: [], deaths: [] };
  }

  return {
    effects: [
      {
        id: 'hunter-shot',
        source: 'role',
        type: 'kill',
        target,
        payload: { cause: 'shoot' satisfies DeathCause },
        order: EFFECT_ORDER.DEATH_TRIGGER,
      },
    ],
    deaths: [{ seat: target, cause: 'shoot' }],
  };
}

/** 从效果的 payload 里取死因；payload 是 `Record<string, unknown>`，必须窄化。 */
export function deathCauseOf(effect: Effect): DeathCause {
  const cause = effect.payload['cause'];
  if (cause === 'wolf' || cause === 'poison' || cause === 'lynch' || cause === 'shoot') {
    return cause;
  }
  throw new Error(`效果 ${effect.id} 的 cause 非法：${String(cause)}`);
}

/**
 * 死亡类效果的 applier 表。
 *
 * `kill` 只把 `alive` 置 false；`diedSeq` 由 `applyEvent(PLAYER_DIED)` 写成事件自己的 `seq`
 * ——applier 在效果阶段还拿不到事件序号，也不该猜。
 */
export const DEATH_APPLIERS: EffectApplierMap = {
  // 解药不改状态：它已经通过「不产生击杀效果」发挥作用（RUL-8）。
  heal: (state) => state,
  kill: (state, effect) => {
    if (effect.target === null) {
      throw new Error(`效果 ${effect.id} 没有目标，无法标记出局`);
    }
    return {
      ...state,
      seats: state.seats.map((seat) =>
        seat.seat === effect.target ? { ...seat, alive: false } : seat,
      ),
    };
  },
};
