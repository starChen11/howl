import type { GameState } from '@shared/domain';
import type { Effect } from '@shared/effects';

import { UnknownEffectError } from './errors';

/**
 * 效果管道（RFC-002 §2.4）。
 *
 * 结算点**先产出完整的效果列表，再统一应用**（ARCH-5）。两条硬性约束：
 * - 应用顺序：`order` 升序，同 `order` 按 `id` 字典序——顺序即规则顺序（RFC-001 §2.3
 *   的分区把解药放 0–99、死亡放 100–199、死亡触发技能放 200–299，升序应用即满足
 *   RUL-8 与 RUL-1）；
 * - 效果**不写入事件流**：它是结算中间产物，结果以事件记录。
 *
 * applier 由注入提供：RFC-002 不定义任何具体效果类型（那些归 RFC-003/004），所以默认表
 * 是空的。遇到未注册的效果 **抛错**，不静默跳过——静默跳过会让一个本该死亡的 hunter 活着
 * 走出结算，而没人发现。
 */

export type EffectApplier = (state: GameState, effect: Effect) => GameState;
export type EffectApplierMap = Readonly<Record<string, EffectApplier>>;

/** 结算点。**不是 Phase**：`VOTE_RESOLVE` 发生在 `DAY_VOTE` 阶段内部（C-19）。 */
export type ResolutionPoint = 'NIGHT_RESOLVE' | 'VOTE_RESOLVE' | 'DEATH_RESOLVE' | 'WIN_CHECK';

/**
 * 扩展插入点：拿到「本次结算已产出的效果」，返回「追加/修改后的效果」。
 *
 * 必须是**状态决定的纯函数**（RFC-002 §2.4）：同样的 `(point, state, effects, modifiers)`
 * 永远得到同样的结果，否则「带 modifier 时事件流可重放」不成立。
 */
export type Modifier = (
  point: ResolutionPoint,
  state: GameState,
  effects: readonly Effect[],
) => Effect[];

/**
 * 规范化效果顺序：`order` 升序，同级按 `id` 字典序。
 *
 * 返回新数组，不改入参。`sort` 在 JS 里是稳定的，但这里给了完整的比较函数，
 * 不依赖稳定性。
 */
export function orderEffects(effects: readonly Effect[]): Effect[] {
  return [...effects].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 按规范顺序逐个应用效果。未注册 applier 的效果直接抛错。 */
export function applyEffects(
  state: GameState,
  effects: readonly Effect[],
  appliers: EffectApplierMap,
): GameState {
  let current = state;

  for (const effect of orderEffects(effects)) {
    const applier = appliers[effect.type];
    if (applier === undefined) {
      throw new UnknownEffectError(effect.type, effect.id);
    }
    current = applier(current, effect);
  }

  return current;
}

/**
 * 依次施加 modifier，再规范化顺序。
 *
 * 不注册任何 modifier 时，结果与输入只差顺序规范化（AC-12）——这是回归基线：将来的
 * 遗物系统若不生效，行为必须与没有这套机制时完全一致。
 */
export function applyModifiers(
  point: ResolutionPoint,
  state: GameState,
  effects: readonly Effect[],
  modifiers: readonly Modifier[] = [],
): Effect[] {
  const extended = modifiers.reduce<Effect[]>(
    (accumulated, modifier) => modifier(point, state, accumulated),
    [...effects],
  );

  return orderEffects(extended);
}
