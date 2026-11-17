import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';
import { WITCH_POTIONS } from '@shared/actions';
import type { Phase } from '@shared/domain';
import { PHASES } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
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
});
