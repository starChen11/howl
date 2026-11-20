import { describe, expect, it } from 'vitest';

import {
  GameEndedPayloadSchema,
  PAYLOAD_SCHEMAS,
  HunterShootPayloadSchema,
  PhaseChangedPayloadSchema,
  PlayerDiedPayloadSchema,
  SeerCheckedPayloadSchema,
  WitchPotionUsedPayloadSchema,
  WolfKillChosenPayloadSchema,
} from '@shared/schemas';

/**
 * B3：RFC-003 接管的事件 payload 必须有 Zod schema（RFC-001 §2.3 的「每个 payload」）。
 *
 * 每个 schema 都给一对正反例——只要正例能过，schema 就可能是个 `z.unknown()`;
 * 只要反例被拒，它才真的在校验。
 */

describe('WOLF_KILL_CHOSEN', () => {
  it('接受 { target }，拒绝越界座位与缺字段', () => {
    expect(WolfKillChosenPayloadSchema.safeParse({ target: 3 }).success).toBe(true);
    expect(WolfKillChosenPayloadSchema.safeParse({ target: 10 }).success).toBe(false);
    expect(WolfKillChosenPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe('SEER_CHECKED', () => {
  it('接受两种结果，拒绝其它结果值', () => {
    expect(SeerCheckedPayloadSchema.safeParse({ target: 2, result: 'wolf' }).success).toBe(true);
    expect(SeerCheckedPayloadSchema.safeParse({ target: 2, result: 'not-wolf' }).success).toBe(
      true,
    );

    expect(SeerCheckedPayloadSchema.safeParse({ target: 2, result: 'maybe' }).success).toBe(false);
    expect(SeerCheckedPayloadSchema.safeParse({ target: 0, result: 'wolf' }).success).toBe(false);
  });
});

describe('WITCH_POTION_USED', () => {
  it('只接受 heal / poison（none 不会产出这条事件）', () => {
    expect(WitchPotionUsedPayloadSchema.safeParse({ potion: 'heal', target: 4 }).success).toBe(
      true,
    );
    expect(WitchPotionUsedPayloadSchema.safeParse({ potion: 'none', target: 4 }).success).toBe(
      false,
    );
  });
});

describe('PLAYER_DIED', () => {
  it('接受四种死因，拒绝未知死因', () => {
    for (const cause of ['wolf', 'poison', 'lynch', 'shoot'] as const) {
      expect(PlayerDiedPayloadSchema.safeParse({ seat: 1, cause }).success).toBe(true);
    }

    expect(PlayerDiedPayloadSchema.safeParse({ seat: 1, cause: 'banana' }).success).toBe(false);
  });
});

describe('HUNTER_SHOOT', () => {
  it('target 允许 null（放弃开枪），但不允许省略', () => {
    expect(HunterShootPayloadSchema.safeParse({ seat: 6, target: null }).success).toBe(true);
    expect(HunterShootPayloadSchema.safeParse({ seat: 6, target: 2 }).success).toBe(true);
    expect(HunterShootPayloadSchema.safeParse({ seat: 6 }).success).toBe(false);
  });
});

describe('PHASE_CHANGED', () => {
  it('from / to 必须是 14 个阶段之一', () => {
    expect(
      PhaseChangedPayloadSchema.safeParse({ from: 'NIGHT_WITCH', to: 'NIGHT_RESOLVE' }).success,
    ).toBe(true);

    expect(PhaseChangedPayloadSchema.safeParse({ from: 'NIGHT_WITCH', to: 'NOPE' }).success).toBe(
      false,
    );
    expect(PhaseChangedPayloadSchema.safeParse({ from: 'NIGHT_WITCH' }).success).toBe(false);
  });
});

describe('GAME_ENDED', () => {
  it('接受两种胜负，condition 必须非空', () => {
    expect(
      GameEndedPayloadSchema.safeParse({ result: 'wolf', condition: 'all-gods-dead' }).success,
    ).toBe(true);

    expect(GameEndedPayloadSchema.safeParse({ result: 'draw', condition: 'x' }).success).toBe(
      false,
    );
    expect(GameEndedPayloadSchema.safeParse({ result: 'wolf', condition: '' }).success).toBe(false);
  });
});

describe('PAYLOAD_SCHEMAS · 登记表完整性（Round 2 评审）', () => {
  it('键集合与已登记的事件一一对应——删掉一条会红', () => {
    // 只测 schema 本体是不够的：把 PAYLOAD_SCHEMAS 里的一条删掉，别的测试照样全绿。
    expect(Object.keys(PAYLOAD_SCHEMAS).sort()).toEqual([
      'AI_THOUGHT',
      'DAY_STARTED',
      'DEGRADED',
      'GAME_ENDED',
      'GAME_STARTED',
      'HUNTER_SHOOT',
      'PHASE_CHANGED',
      'PLAYER_DIED',
      'REJECTED',
      'SEER_CHECKED',
      'SELF_EXPOSE',
      'SPEECH',
      'SPEECH_SKIPPED',
      'VOTE_CAST',
      'VOTE_REVEALED',
      'WITCH_POTION_USED',
      'WOLF_CHAT_POSTED',
      'WOLF_KILL_CHOSEN',
      'WOLF_VOTE_CAST',
      'WOLF_VOTE_REVEALED',
    ]);
  });

  it('每个登记项都是可 safeParse 的 Zod schema', () => {
    for (const [type, schema] of Object.entries(PAYLOAD_SCHEMAS)) {
      expect(typeof schema.safeParse, `${type} 缺少 safeParse`).toBe('function');
    }
  });
});
