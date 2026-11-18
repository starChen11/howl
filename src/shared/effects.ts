import type { SeatId } from './domain';

export const EFFECT_SOURCES = ['role', 'system', 'extension'] as const;
export type EffectSource = (typeof EFFECT_SOURCES)[number];

/**
 * 结算次序分区（落实 RUL-1 / RUL-8）。
 *
 * 同一结算点先产出完整的效果列表，再按 `order` 升序应用（ARCH-5）。因此区间的先后
 * 就是规则的先后，顺序不可调换：
 *
 * | 区间 | 语义 | 例 |
 * |---|---|---|
 * | 0–99 | 抵消与保护 | 解药（必须在击杀之前，RUL-8） |
 * | 100–199 | 死亡生效 | 刀、毒药 |
 * | 200–299 | 死亡触发技能 | 死亡触发技能（RUL-1：先判胜负，未结束才结算） |
 * | 900–999 | 扩展（modifier） | 未来遗物；v1 无 |
 *
 * 同一 `order` 内按 `id` 字典序。效果是结算过程中的中间产物，**不写入事件流**，
 * 其结果以事件形式记录。
 */
export const EFFECT_ORDER = {
  /** 0–99：抵消与保护。 */
  CANCEL: 0,
  /** 100–199：死亡生效。 */
  DEATH: 100,
  /** 200–299：死亡触发技能。 */
  DEATH_TRIGGER: 200,
  /** 900–999：扩展（modifier）。 */
  EXTENSION: 900,
} as const;

export interface Effect {
  /** 稳定唯一，供测试与日志引用。 */
  id: string;
  source: EffectSource;
  /** 受限枚举，由 RFC-003 / RFC-004 扩充。 */
  type: string;
  /** F7 AC-1：`target` 必存，即使是 null 也不能省略。 */
  target: SeatId | null;
  /** 效果参数，例如「无效的票」。 */
  payload: Record<string, unknown>;
  /** 见 `EFFECT_ORDER`。 */
  order: number;
}
