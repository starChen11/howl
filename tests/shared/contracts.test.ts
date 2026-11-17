import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Action } from '@shared/actions';
import { WITCH_POTIONS } from '@shared/actions';
import type { Phase } from '@shared/domain';
import { FACTION_OF, FACTIONS, PHASES, ROLES, SEAT_IDS, WIN_MODES } from '@shared/domain';
import type { EventEnvelope, GameEvent, GameEventMap } from '@shared/events';
import { GAME_EVENT_TYPES } from '@shared/events';
import { ActionSchema, EventSchema } from '@shared/schemas';

/**
 * RFC-001 的共享契约断言（AC-5 / AC-7）。
 *
 * 类型层面的要求在运行时是「不可见的」，所以这里同时用两种手段：
 * - `as const` 数组做运行时断言（能数出个数）；
 * - `@ts-expect-error` 夹具做编译期断言（`pnpm typecheck` 会把它们编译一遍，
 *   一旦类型放宽到能通过，`@ts-expect-error` 自己就会报「未使用的指令」，从而失败）。
 */

const EXPECTED_PHASES = [
  'LOBBY',
  'NIGHT_WOLF_CHAT',
  'NIGHT_WOLVES',
  'NIGHT_SEER',
  'NIGHT_WITCH',
  'NIGHT_RESOLVE',
  'NIGHT_HUNTER_SHOOT',
  'DAY_ANNOUNCE',
  'DAY_SPEECH',
  'DAY_VOTE',
  'DAY_VOTE_RUNOFF',
  'DAY_LYNCH',
  'DAY_HUNTER_SHOOT',
  'FINISHED',
] as const;

describe('AC-5 · Phase 与 potion 的取值集合', () => {
  it('Phase 恰好 14 个取值，且与 RFC 列出的取值逐项一致', () => {
    expect(PHASES).toHaveLength(14);
    expect([...PHASES]).toEqual([...EXPECTED_PHASES]);
    expect(new Set(PHASES).size).toBe(14);
  });

  it('Phase 是封闭联合：列表外的取值无法赋给 Phase', () => {
    // @ts-expect-error 'NIGHT_MOON' 不在 14 个取值里
    const unknownPhase: Phase = 'NIGHT_MOON';
    expect(unknownPhase).toBe('NIGHT_MOON');
  });

  it('Phase 的类型集合与运行时数组完全相等（加第 15 个成员会编译失败）', () => {
    // 评审 M1：只加类型成员、不改数组时，运行时断言与 'NIGHT_MOON' 夹具仍然通过。
    // toEqualTypeOf 是双向精确比较，多一个少一个都编译失败。
    expectTypeOf<Phase>().toEqualTypeOf<(typeof EXPECTED_PHASES)[number]>();
  });

  it('WITCH_ACT 的 potion 只有 heal / poison / none', () => {
    expect(WITCH_POTIONS).toHaveLength(3);
    expect([...WITCH_POTIONS]).toEqual(['heal', 'poison', 'none']);
  });
});

describe('AC-7 · EventEnvelope 的必填字段', () => {
  const complete: EventEnvelope = {
    gameId: 'game-1',
    seq: 1,
    ts: 1_700_000_000_000,
    type: 'SPEECH',
    visibleTo: 'public',
    payload: {},
  };

  it('三个字段齐全时可以构造', () => {
    expect(complete.seq).toBe(1);
    expect(complete.gameId).toBe('game-1');
    expect(complete.visibleTo).toBe('public');
  });

  it('缺任一字段都无法通过编译', () => {
    // @ts-expect-error visibleTo 必填
    const withoutVisibleTo: EventEnvelope = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'SPEECH',
      payload: {},
    };
    // @ts-expect-error seq 必填
    const withoutSeq: EventEnvelope = {
      gameId: 'g',
      ts: 0,
      type: 'SPEECH',
      visibleTo: 'public',
      payload: {},
    };
    // @ts-expect-error gameId 必填
    const withoutGameId: EventEnvelope = {
      seq: 1,
      ts: 0,
      type: 'SPEECH',
      visibleTo: 'public',
      payload: {},
    };

    expect([withoutVisibleTo, withoutSeq, withoutGameId]).toHaveLength(3);
  });

  it('Action 的可选字段不接受显式 undefined（exactOptionalPropertyTypes）', () => {
    // 这条夹具解释了 src/shared/schemas.ts 为什么不把 zod 的输出静态桥接成 Action：
    // zod 的 .optional() 推出 `target?: SeatId | undefined`，而 Action 不接受显式 undefined。
    // @ts-expect-error target?: SeatId 不允许显式写 undefined
    const shoot: Action = { type: 'HUNTER_SHOOT', ts: 0, seat: 1, target: undefined };

    expect(shoot.type).toBe('HUNTER_SHOOT');
  });
});

/**
 * 以下不在 16 条验收标准里：`schemas.ts` 的范围是 RFC-001 C-10 裁定的，而 AC 一条都没
 * 覆盖它。留成未测表面，后续 RFC 会继承一份没人验证过的校验器，所以补上。
 */
describe('C-10 · ActionSchema / EventSchema', () => {
  const ACTIONS = [
    { type: 'START', ts: 0, seed: 42, mode: 'slaughter-side', playerSeat: 3 },
    { type: 'WOLF_CHAT', ts: 0, seat: 1, text: '今夜刀 2 号' },
    { type: 'WOLF_KILL', ts: 0, seat: 1, target: 2 },
    { type: 'SEER_CHECK', ts: 0, seat: 4, target: 5 },
    { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'heal', target: 2 },
    { type: 'WITCH_ACT', ts: 0, seat: 6, potion: 'none' },
    { type: 'HUNTER_SHOOT', ts: 0, seat: 7 },
    { type: 'SPEECH', ts: 0, seat: 2, text: '我是好人' },
    { type: 'SPEECH_SKIP', ts: 0, seat: 2 },
    { type: 'VOTE', ts: 0, seat: 3, target: 'abstain' },
    { type: 'SELF_EXPOSE', ts: 0, seat: 1 },
  ];

  it('十个动作类型的合法载荷全部通过', () => {
    for (const action of ACTIONS) {
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

  it('EventSchema 校验信封，payload 形状留给拥有它的 RFC', () => {
    const envelope = {
      gameId: 'game-1',
      seq: 1,
      ts: 0,
      type: 'GAME_STARTED',
      visibleTo: 'server',
      payload: { anything: 'RFC-002 决定这里的形状' },
    };

    expect(EventSchema.safeParse(envelope).success).toBe(true);
    expect(EventSchema.safeParse({ ...envelope, visibleTo: 'self:10' }).success).toBe(false);
    expect(EventSchema.safeParse({ ...envelope, seq: 0 }).success).toBe(false);
  });

  it('EventSchema 拒绝不在 GameEventMap 里的 type（评审 F1 / M11）', () => {
    const envelope = {
      gameId: 'game-1',
      seq: 1,
      ts: 0,
      visibleTo: 'public',
      payload: {},
    };

    expect(EventSchema.safeParse({ ...envelope, type: 'NOT_A_REAL_EVENT' }).success).toBe(false);
    expect(EventSchema.safeParse({ ...envelope, type: '' }).success).toBe(false);
    expect(EventSchema.safeParse({ ...envelope, type: 'SPEECH' }).success).toBe(true);
  });
});

/**
 * 评审 F2：§2.3 的约束句要求 `potion: 'none'` 与省略 `target` 配套、`heal`/`poison`
 * 必须带目标。一条 `target?: SeatId` 表达不出来，所以类型拆成两个分支、Zod 加 refine。
 * 两侧都要拒绝——类型挡住本仓库的代码，Zod 挡住未来从 HTTP 进来的入站校验（SEC-4）。
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
 * 评审 F1：`EventEnvelope` 的默认参数（`type: string` / `payload: unknown`）太宽，
 * DATA-2 与 §2.3 正文要求 type 必须是 `GameEventMap` 成员、payload 由 map 约束。
 * `GameEvent` 承担这件事，运行时的 `GAME_EVENT_TYPES` 与 map 的键双向绑定。
 */
describe('F1 · GameEvent 与 GAME_EVENT_TYPES', () => {
  it('类型合法的事件可以构造', () => {
    const started: GameEvent = {
      gameId: 'game-1',
      seq: 1,
      ts: 0,
      type: 'GAME_STARTED',
      visibleTo: 'server',
      payload: {
        seed: 42,
        mode: 'slaughter-side',
        playerSeat: 3,
        roles: [
          'wolf',
          'wolf',
          'wolf',
          'seer',
          'witch',
          'hunter',
          'villager',
          'villager',
          'villager',
        ],
        personas: [null, 'p1', 'p2', null, null, null, null, null, null],
      },
    };

    expect(started.type).toBe('GAME_STARTED');
  });

  it('未知 type 与错误 payload 都无法通过编译', () => {
    // 注意：`@ts-expect-error` 必须紧贴出错的那一行。多行字面量里 TS 把错误报在**属性**上，
    // 不在 `const` 上，写错位置会变成「未使用的指令」——那也是一种失败，但失败得莫名其妙。
    const bogusType: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      // @ts-expect-error 'NOT_A_REAL_EVENT' 不是 GameEventMap 的成员（DATA-2 / 评审 M11）
      type: 'NOT_A_REAL_EVENT',
      visibleTo: 'public',
      payload: { seat: 1 },
    };

    const badPayload: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'GAME_STARTED',
      visibleTo: 'server',
      // @ts-expect-error GAME_STARTED 的 payload 由 GameEventMap 约束
      payload: { seed: 'not-a-number' },
    };

    expect([bogusType, badPayload]).toHaveLength(2);
  });

  it('GAME_EVENT_TYPES 与 GameEventMap 的键完全一致', () => {
    // 双向精确比较：运行时可枚举清单漏一个成员、或多写一个，都会编译失败。
    expectTypeOf<keyof GameEventMap>().toEqualTypeOf<(typeof GAME_EVENT_TYPES)[number]>();
    expect(GAME_EVENT_TYPES).toHaveLength(17);
    expect(new Set(GAME_EVENT_TYPES).size).toBe(17);
  });
});

/**
 * 评审 F7：AC 没有覆盖的契约常量。`FACTION_OF` 写错一个阵营仍然满足
 * `satisfies Record<Role, Faction>`，只能靠断言挡住。
 */
describe('F7 · 其余共享常量', () => {
  it('SEAT_IDS 是 1..9', () => {
    expect([...SEAT_IDS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('FACTION_OF 把五个身份映射到正确阵营', () => {
    expect(FACTION_OF).toEqual({
      wolf: 'wolf',
      seer: 'good',
      witch: 'good',
      hunter: 'good',
      villager: 'good',
    });
    // 键必须覆盖 ROLES，否则 satisfies 之外还得靠这条兜住顺序漂移
    expect(Object.keys(FACTION_OF)).toEqual([...ROLES]);
  });

  it('FACTIONS 与 WIN_MODES 的取值集合', () => {
    expect([...FACTIONS]).toEqual(['wolf', 'good']);
    expect([...WIN_MODES]).toEqual(['slaughter-side', 'slaughter-all']);
  });
});
