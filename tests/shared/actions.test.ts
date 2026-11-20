import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Action } from '@shared/actions';
import { ACTION_TYPES, WITCH_POTIONS } from '@shared/actions';
import { ActionSchema } from '@shared/schemas';

/**
 * `Action` 联合与 `ActionSchema`。
 *
 * 覆盖三件事：
 * - AC-5 的「potion 只有三个取值」；
 * - 评审 F2：`WITCH_ACT` 的 potion / target 配对，类型与 Zod 两侧都要拒绝；
 * - CR-003 C1 / C2：`REJECTED.actionType` 与 `VOTE_CAST.seat` 的收窄与显式化。
 */

const VALID_ACTIONS = [
  { type: 'START', ts: 0, seed: 42, mode: 'slaughter-side', playerSeat: 3 },
  { type: 'WOLF_CHAT', ts: 0, seat: 1, text: '今夜刀 2 号' },
  { type: 'WOLF_VOTE', ts: 0, seat: 1, target: 2 },
  { type: 'WOLF_READY', ts: 0, seat: 1 },
  { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal', target: 2 },
  { type: 'SEER_CHECK', ts: 0, seat: 4, target: 5 },
  { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal', target: 2 },
  { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'none' },
  { type: 'HUNTER_SHOOT', ts: 0, seat: 7 },
  { type: 'SPEECH', ts: 0, seat: 2, text: '我是好人' },
  { type: 'SPEECH_SKIP', ts: 0, seat: 2 },
  { type: 'VOTE', ts: 0, seat: 3, target: 'abstain' },
  { type: 'SELF_EXPOSE', ts: 0, seat: 1 },
];

describe('ACTION_TYPES 与 Action 的类型集合一致（评审 N2）', () => {
  it('双向精确相等：多一个少一个都编译失败', () => {
    expectTypeOf<Action['type']>().toEqualTypeOf<(typeof ACTION_TYPES)[number]>();
    expect(ACTION_TYPES).toHaveLength(12);
    expect(new Set(ACTION_TYPES).size).toBe(12);
  });
});

describe('AC-5 · potion 的三个取值', () => {
  it('WITCH_POTIONS 恰为 heal / poison / none', () => {
    expect(WITCH_POTIONS).toHaveLength(3);
    expect([...WITCH_POTIONS]).toEqual(['heal', 'poison', 'none']);
  });
});

describe('ActionSchema', () => {
  it('十个动作类型的合法载荷全部通过', () => {
    for (const action of VALID_ACTIONS) {
      const result = ActionSchema.safeParse(action);
      expect(result.success, `${action.type} 被拒：${JSON.stringify(result.error?.issues)}`).toBe(
        true,
      );
    }
  });

  it('非法 potion、非法座位、缺 ts 都被拒', () => {
    expect(
      ActionSchema.safeParse({ type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'revive' }).success,
    ).toBe(false);
    expect(ActionSchema.safeParse({ type: 'WOLF_KILL', ts: 0, seat: 1, target: 10 }).success).toBe(
      false,
    );
    expect(ActionSchema.safeParse({ type: 'SPEECH_SKIP', seat: 2 }).success).toBe(false);
  });
});

/**
 * 评审 F2：§2.3 的约束句要求 `potion: 'none'` 与省略 `target` 配套、`heal` / `poison` 必须带目标。
 * 一条 `target?: SeatId` 表达不出来，所以类型拆成两个分支、Zod 加 refine。
 * 两侧都要拒绝——类型挡住本仓库的代码，Zod 挡住将来从 HTTP 进来的入站校验（SEC-4）。
 */
describe('F2 · WITCH_ACT 的 potion / target 配对', () => {
  it('三种非法组合都被类型拒绝', () => {
    // @ts-expect-error potion 为 none 时不得带 target
    const noneWithTarget: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'none', target: 2 };
    // @ts-expect-error heal 必须带 target
    const healWithoutTarget: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal' };
    // @ts-expect-error poison 必须带 target
    const poisonWithoutTarget: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'poison' };

    expect([noneWithTarget, healWithoutTarget, poisonWithoutTarget]).toHaveLength(3);
  });

  it('三种合法组合都能构造', () => {
    const none: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'none' };
    const heal: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal', target: 2 };
    const poison: Action = { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'poison', target: 2 };

    expect([none, heal, poison]).toHaveLength(3);
  });

  it('三种非法组合也都被 ActionSchema 拒绝', () => {
    const cases = [
      { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'none', target: 2 },
      { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal' },
      { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'poison' },
    ];

    for (const action of cases) {
      expect(ActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(false);
    }
  });
});

/**
 * CR-003 C1 / C2：这两个 payload 是在 Round 2 评审里发现与下游 RFC 不一致的。
 * 断言放在这里是因为它们的类型来自 `Action`——`REJECTED.actionType` 就是 `Action['type']`。
 */
describe('CR-003 · action 与事件载荷的一致性', () => {
  it('Action 的可选字段不接受显式 undefined（exactOptionalPropertyTypes）', () => {
    // 这条夹具解释了 src/shared/schemas.ts 为什么不把 zod 的输出静态桥接成 Action：
    // zod 的 .optional() 推出 `target?: SeatId | undefined`，而 Action 不接受显式 undefined。
    // @ts-expect-error target?: SeatId 不允许显式写 undefined
    const shoot: Action = { type: 'HUNTER_SHOOT', ts: 0, seat: 1, target: undefined };

    expect(shoot.type).toBe('HUNTER_SHOOT');
  });
});
