import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Effect } from '@shared/effects';
import { EFFECT_ORDER } from '@shared/effects';

/**
 * RFC-001 AC-6：`Effect.target` 必填，且 `order` 的分区常量以 `as const` 导出。
 *
 * `order` 的区间顺序就是规则顺序，所以这里不只断言四个数字，还断言「升序排列恰好等于
 * RUL-8 → 死亡 → RUL-1 的结算链」——把规则写进测试，而不是写进注释。
 */

describe('AC-6 · Effect.target 必填', () => {
  it('省略 target 无法通过编译', () => {
    // @ts-expect-error target 必填（F7 AC-1）
    const missingTarget: Effect = {
      id: 'e1',
      source: 'system',
      type: 'noop',
      payload: {},
      order: 0,
    };

    expect(missingTarget.id).toBe('e1');
  });

  it('target 可以显式为 null，但字段必须出现', () => {
    const nullTarget: Effect = {
      id: 'e2',
      source: 'system',
      type: 'noop',
      target: null,
      payload: {},
      order: 0,
    };

    expect(nullTarget.target).toBeNull();
  });
});

describe('AC-6 · order 分区常量', () => {
  it('四个分区边界为 0 / 100 / 200 / 900', () => {
    expect(EFFECT_ORDER.CANCEL).toBe(0);
    expect(EFFECT_ORDER.DEATH).toBe(100);
    expect(EFFECT_ORDER.DEATH_TRIGGER).toBe(200);
    expect(EFFECT_ORDER.EXTENSION).toBe(900);
  });

  it('EFFECT_ORDER 保持字面量类型（删掉 as const 会编译失败）', () => {
    // 评审 M2：删掉 `as const` 后四个数字断言仍然通过，因为运行时值没变。
    // AC-6 要求的是「以 as const 导出」，所以要断言类型而不是值。
    expectTypeOf<typeof EFFECT_ORDER>().toEqualTypeOf<{
      readonly CANCEL: 0;
      readonly DEATH: 100;
      readonly DEATH_TRIGGER: 200;
      readonly EXTENSION: 900;
    }>();
  });

  it('升序应用即「抵消 → 死亡 → 死亡触发技能 → 扩展」', () => {
    const sorted = [
      EFFECT_ORDER.EXTENSION,
      EFFECT_ORDER.DEATH_TRIGGER,
      EFFECT_ORDER.DEATH,
      EFFECT_ORDER.CANCEL,
    ].sort((a, b) => a - b);

    expect(sorted).toEqual([0, 100, 200, 900]);
    // RUL-8：解药（抵消）必须先于击杀（死亡）结算。
    expect(EFFECT_ORDER.CANCEL).toBeLessThan(EFFECT_ORDER.DEATH);
    // RUL-1：死亡触发技能晚于死亡生效——先判胜负，未结束才结算。
    expect(EFFECT_ORDER.DEATH).toBeLessThan(EFFECT_ORDER.DEATH_TRIGGER);
  });

  it('每个分区都留有 100 个槽位给后续 RFC', () => {
    const bands = [
      EFFECT_ORDER.CANCEL,
      EFFECT_ORDER.DEATH,
      EFFECT_ORDER.DEATH_TRIGGER,
      EFFECT_ORDER.EXTENSION,
    ];
    for (const start of bands) {
      expect(Number.isInteger(start)).toBe(true);
      expect(start % 100).toBe(0);
    }
    expect(new Set(bands).size).toBe(4);
  });
});
