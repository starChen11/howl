import { describe, expect, expectTypeOf, it } from 'vitest';

import type { EventEnvelope, GameEvent, GameEventMap } from '@shared/events';
import { GAME_EVENT_TYPES, SELF_VISIBILITY_PREFIX } from '@shared/events';
import { EventSchema } from '@shared/schemas';

/**
 * 事件信封与事件类型绑定。
 *
 * 这个文件守的是「事件流的形状」——本 RFC 最重要也最容易被静默放宽的交付物：
 * - AC-7：`EventEnvelope` 的三个必填字段；
 * - 评审 B3：`EventEnvelope` 的默认 `type` 必须是 `GameEventMap` 成员（可被回退，必须有夹具）；
 * - 评审 F1：`GameEvent` 把 `type` 与 `payload` 静态绑定；
 * - CR-003：三个 payload 形状与下游 RFC 对齐。
 *
 * `@ts-expect-error` 必须紧贴出错的那一行：多行字面量里 TS 把错误报在**属性**上，
 * 不在 `const` 上。写错位置会变成「未使用的指令」——那也是一种失败，但失败得莫名其妙。
 */

const VALID_ENVELOPE = {
  gameId: 'game-1',
  seq: 1,
  ts: 1_700_000_000_000,
  type: 'SPEECH',
  visibleTo: 'public',
  payload: { seat: 2, text: '我是好人' },
} as const;

describe('AC-7 · EventEnvelope 的必填字段', () => {
  it('三个字段齐全时可以构造', () => {
    const envelope: EventEnvelope = VALID_ENVELOPE;

    expect(envelope.seq).toBe(1);
    expect(envelope.gameId).toBe('game-1');
    expect(envelope.visibleTo).toBe('public');
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
});

/**
 * 评审 B3：Round 1 把默认 `type` 从 `string` 收紧到 `GameEventType`，但当时只有
 * `GameEvent` 的负向夹具。把默认参数改回 `string` 后整套测试与 typecheck 全绿（P1），
 * 修复可以被静默回退。这条夹具就是那个守卫。
 */
describe('B3 · EventEnvelope 默认 type 的回归夹具', () => {
  it('直接用 EventEnvelope 也写不出假事件类型', () => {
    const bogus: EventEnvelope = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      // @ts-expect-error EventEnvelope 的默认 type 也必须是 GameEventMap 的成员
      type: 'NOT_A_REAL_EVENT',
      visibleTo: 'public',
      payload: {},
    };

    expect(bogus.seq).toBe(1);
  });
});

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
    const bogusType: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      // @ts-expect-error 'NOT_A_REAL_EVENT' 不是 GameEventMap 的成员（DATA-2）
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
    expect(GAME_EVENT_TYPES).toHaveLength(18);
    expect(new Set(GAME_EVENT_TYPES).size).toBe(18);
  });
});

describe('EventSchema', () => {
  it('校验信封，payload 形状留给拥有它的 RFC', () => {
    expect(EventSchema.safeParse(VALID_ENVELOPE).success).toBe(true);
    expect(EventSchema.safeParse({ ...VALID_ENVELOPE, visibleTo: 'self:10' }).success).toBe(false);
    expect(EventSchema.safeParse({ ...VALID_ENVELOPE, seq: 0 }).success).toBe(false);
  });

  it('拒绝不在 GameEventMap 里的 type（评审 F1 / M11）', () => {
    expect(EventSchema.safeParse({ ...VALID_ENVELOPE, type: 'NOT_A_REAL_EVENT' }).success).toBe(
      false,
    );
    expect(EventSchema.safeParse({ ...VALID_ENVELOPE, type: '' }).success).toBe(false);
  });
});

/**
 * CR-003：这三个 payload 在 Round 2 评审里被发现与下游 RFC 的形状不一致。
 * 夹具放在这里，证明「合同只有一种形状」不是靠文档约定。
 */
describe('CR-003 · 三个 payload 的形状', () => {
  it("C1 · REJECTED.actionType 是 Action['type']，不是任意字符串", () => {
    const rejected: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'REJECTED',
      visibleTo: 'public',
      payload: {
        // @ts-expect-error actionType 只能是 Action['type']（与 RFC-002 §2.3 一致）
        actionType: 'NOT_AN_ACTION',
        code: 'PHASE_MISMATCH',
        message: '阶段不匹配',
      },
    };

    expect(rejected.type).toBe('REJECTED');
  });

  it('C2 · VOTE_CAST 必须显式带 seat', () => {
    // 「缺少必填属性」这类错误被报在**外层赋值**上，不在 payload 那一行——所以指令贴 const。
    // @ts-expect-error 缺 seat：replay 重建票型时没有观察者，不能从 visibleTo 反解
    const voteCast: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'VOTE_CAST',
      visibleTo: 'self:3',
      payload: { target: 2 },
    };

    const withSeat: GameEvent = {
      gameId: 'g',
      seq: 2,
      ts: 0,
      type: 'VOTE_CAST',
      visibleTo: 'self:3',
      payload: { seat: 3, target: 2 },
    };

    expect([voteCast, withSeat]).toHaveLength(2);
  });

  it('C3 · AI_THOUGHT 用嵌套 claim，不用顶层 claimedRole', () => {
    const nested: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'AI_THOUGHT',
      visibleTo: 'self:1',
      payload: {
        reason: '3 号的发言在保 5 号',
        decisionSeq: 7,
        claim: {
          role: 'seer',
          checks: [{ target: 2, result: 'wolf' }],
          accuses: [{ target: 3, as: 'wolf' }],
        },
      },
    };

    const flat: GameEvent = {
      gameId: 'g',
      seq: 2,
      ts: 0,
      type: 'AI_THOUGHT',
      visibleTo: 'self:1',
      payload: {
        reason: '3 号的发言在保 5 号',
        decisionSeq: 8,
        // @ts-expect-error 顶层 claimedRole 不是合同的一部分（CR-003 C3：统一为嵌套 claim）
        claimedRole: 'seer',
      },
    };

    expect([nested, flat]).toHaveLength(2);
  });

  it('claim 的每个字段都是可选的，空 claim 合法', () => {
    const empty: GameEvent = {
      gameId: 'g',
      seq: 1,
      ts: 0,
      type: 'AI_THOUGHT',
      visibleTo: 'self:1',
      payload: { reason: '这轮没有声称', decisionSeq: 1, claim: {} },
    };

    expect(empty.type).toBe('AI_THOUGHT');
  });
});

describe('F7 · 可见性前缀', () => {
  it('SELF_VISIBILITY_PREFIX 是 self:', () => {
    expect(SELF_VISIBILITY_PREFIX).toBe('self:');
  });
});
