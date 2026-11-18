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

  /**
   * 死因按**座位**归并（C-24 的裁决：同一目标只出局一次，死因取毒药）。
   *
   * 为什么必须归并：毒药指向狼刀目标是**合法 action**。归并前会产出两条 `Death` →
   * 两条 `PLAYER_DIED` → `applyPlayerDied` 把第二次出局当成数据损坏抛错，等于一个
   * 正常操作把引擎打崩（评审 B1）。
   *
   * 为什么毒药优先：FR-17 的本意是「被毒杀的人拿不走开枪」，而 witch **明确选择**了毒
   * 这个目标；把她选中的效果判成失效，等于让「毒狼刀口」变成一步废棋。
   */
  const causes = new Map<SeatId, DeathCause>();

  if (killTarget !== undefined && !killCancelled) {
    causes.set(killTarget, 'wolf');
  }
  if (poisonTarget !== undefined) {
    // 后写覆盖：只有「同座位既被刀又被毒」时才会命中，此时毒药优先（C-24）。
    causes.set(poisonTarget, 'poison');
  }

  /**
   * **顺序即结算顺序**（RFC-003 §2.3 第 3、4 步：先狼刀、后毒药），不是座位顺序。
   *
   * 一开始这里按座位排过序，那是错的（评审 C-26）：RFC-004 的 `DAY_STARTED.diedLastNight`
   * 与「发言起点」都依赖死亡结算顺序。归并用的 `Map` 保留首次插入的位置，所以同一座位
   * 既被刀又被毒时，那条死亡仍排在狼刀的位置上（死因已改记为毒药）。
   */
  const deaths: Death[] = [...causes.entries()].map(([seat, cause]) => ({ seat, cause }));

  // 解药效果存在即说明「witch 用了药」，与它是否真的救下人都无关。
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

  for (const death of deaths) {
    effects.push({
      id: `night-kill-${death.seat}`,
      source: 'role',
      type: 'kill',
      target: death.seat,
      payload: { cause: death.cause },
      order: EFFECT_ORDER.DEATH,
    });
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

  // 死因只写一次：效果 payload 与 Death 共用同一个常量，避免两处各写一个字符串。
  const cause: DeathCause = 'shoot';

  return {
    effects: [
      {
        id: 'hunter-shot',
        source: 'role',
        type: 'kill',
        target,
        payload: { cause },
        order: EFFECT_ORDER.DEATH_TRIGGER,
      },
    ],
    deaths: [{ seat: target, cause }],
  };
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
