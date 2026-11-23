import { z } from 'zod';

import { ACTION_TYPES, WITCH_POTIONS } from './actions';
import { PHASES, ROLES, SEAT_IDS, WIN_MODES } from './domain';
import { GAME_EVENT_TYPES, SELF_VISIBILITY_PREFIX } from './events';

/**
 * `src/shared/schemas.ts` —— 跨层契约的 Zod 归属（API-1 / NFR-14）。
 *
 * 范围（RFC-001 C-10）：本 RFC 只定义**信封**与**动作**的 schema。
 * 十个 action 在 RFC-001 §2.3 已完整定义，因此可以一次写全；事件 payload 的 schema
 * 由拥有该 payload 语义的 RFC 追加（`GameStartedPayload` 归 RFC-002，
 * `DayStartedPayload` 归 RFC-004），因为它们此刻还不存在，现在写只会写成猜测。
 *
 * 刻意**不做**「schema 输出类型 = `Action`」的静态断言：zod 的 `.optional()` 推出的是
 * `target?: SeatId | undefined`，而 `exactOptionalPropertyTypes` 下 `Action` 的
 * `target?: SeatId` 不接受显式 `undefined`，两者天生不兼容。用 `as` 架桥会把这件事藏起来；
 * 改为在 `tests/shared/actions.test.ts` 里用 `@ts-expect-error` 夹具证明 `Action` 的严格性。
 */

const timestampSchema = z.number().int().nonnegative();

export const seatIdSchema = z.literal(SEAT_IDS);
export const actionTypeSchema = z.enum(ACTION_TYPES);
export const phaseSchema = z.enum(PHASES);
export const deathCauseSchema = z.enum(['wolf', 'poison', 'lynch', 'shoot']);
export const winModeSchema = z.enum(WIN_MODES);
export const witchPotionSchema = z.enum(WITCH_POTIONS);

/** `self:<seat>` 的合法集合由 `SEAT_IDS` 派生，不存在两个地方各写一份座位表的可能。 */
export const SELF_VISIBILITY_PATTERN = new RegExp(
  `^${SELF_VISIBILITY_PREFIX}(?:${SEAT_IDS.join('|')})$`,
);

export const visibilitySchema = z.union([
  z.enum(['public', 'wolves', 'seer', 'witch', 'hunter', 'server']),
  z.string().regex(SELF_VISIBILITY_PATTERN),
]);

export const rngStateSchema = z.object({ __rng: z.number() });

/** 事件类型必须是 `GameEventMap` 的成员（DATA-2），此处把运行时清单接进校验。 */
export const eventTypeSchema = z.enum(GAME_EVENT_TYPES);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('START'),
    ts: timestampSchema,
    seed: z.number().int(),
    mode: winModeSchema,
    playerSeat: seatIdSchema,
  }),
  z.object({
    type: z.literal('WOLF_CHAT'),
    ts: timestampSchema,
    seat: seatIdSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('WOLF_KILL'),
    ts: timestampSchema,
    seat: seatIdSchema,
    target: seatIdSchema,
  }),
  z.object({
    type: z.literal('WOLF_READY'),
    ts: timestampSchema,
    seat: seatIdSchema,
  }),
  z.object({
    type: z.literal('WOLF_VOTE'),
    ts: timestampSchema,
    seat: seatIdSchema,
    target: z.union([seatIdSchema, z.literal('abstain')]),
    confirmed: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('WOLF_VOTE_CONFIRM'),
    ts: timestampSchema,
    seat: seatIdSchema,
  }),
  z.object({
    type: z.literal('SEER_CHECK'),
    ts: timestampSchema,
    seat: seatIdSchema,
    target: seatIdSchema,
  }),
  z
    .object({
      type: z.literal('WITCH_ACT'),
      ts: timestampSchema,
      seat: seatIdSchema,
      potion: witchPotionSchema,
      target: seatIdSchema.optional(),
    })
    // §2.3 的约束：`potion: 'none'` 与省略 `target` 配套（RUL-3 / RUL-7）。
    // 前端限制可以被绕过，所以这条语义必须落在服务端校验里（SEC-4）。
    .refine(
      (value) =>
        value.potion === 'none' ? value.target === undefined : value.target !== undefined,
      {
        message: "potion 为 'none' 时不得带 target；'heal' / 'poison' 必须带 target",
        path: ['target'],
      },
    ),
  z.object({
    type: z.literal('HUNTER_SHOOT'),
    ts: timestampSchema,
    seat: seatIdSchema,
    target: seatIdSchema.optional(),
  }),
  z.object({
    type: z.literal('SPEECH'),
    ts: timestampSchema,
    seat: seatIdSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('SPEECH_SKIP'),
    ts: timestampSchema,
    seat: seatIdSchema,
  }),
  z.object({
    type: z.literal('VOTE'),
    ts: timestampSchema,
    seat: seatIdSchema,
    target: z.union([seatIdSchema, z.literal('abstain')]),
  }),
  z.object({
    type: z.literal('SELF_EXPOSE'),
    ts: timestampSchema,
    seat: seatIdSchema,
  }),
]);

/**
 * 事件信封的 schema 工厂。
 *
 * 后续 RFC 用法：`makeEventEnvelopeSchema(GameStartedPayloadSchema)`。
 * 工厂而不是可变注册表，是为了让「哪些 payload 已有 schema」在类型层面可见，
 * 不需要在运行时维护一个全局 map。
 */
export function makeEventEnvelopeSchema<P extends z.ZodType>(payload: P) {
  return z.object({
    gameId: z.string().min(1),
    seq: z.number().int().positive(),
    ts: timestampSchema,
    type: eventTypeSchema,
    visibleTo: visibilitySchema,
    rngAfter: rngStateSchema.optional(),
    payload,
  });
}

/** 只校验信封、不校验 payload 形状。payload 级校验由各自的 RFC 追加。 */
export const EventSchema = makeEventEnvelopeSchema(z.unknown());

/**
 * 事件 payload 的 schema：**由拥有该事件的 RFC 追加**（C-10 的归属规则）。
 *
 * RFC-002 拥有 `GAME_STARTED` 与 `REJECTED`；`DAY_STARTED` / `SPEECH` / `SPEECH_SKIPPED` /
 * `VOTE_CAST` / `VOTE_REVEALED` 归 RFC-004，其余由各自的 RFC 加。
 */
export const GameStartedPayloadSchema = z.object({
  seed: z.number().int(),
  mode: winModeSchema,
  playerSeat: seatIdSchema,
  roles: z.array(z.enum(ROLES)).length(SEAT_IDS.length),
  personas: z.array(z.string().nullable()).length(SEAT_IDS.length),
});

export const RejectedPayloadSchema = z.object({
  actionType: actionTypeSchema,
  code: z.string().min(1),
  message: z.string(),
});

/**
 * RFC-003 接管的事件 payload（§2.4 的三个私有事件 + 死亡 / 开枪 / 相位推进 / 终局）。
 *
 * `GAME_ENDED` 的归属说明：它**第一次由 RFC-003 产出**（夜间结算后即可能终局），所以 schema
 * 定义在这里；RFC-004 的白天胜负判定复用同一份，不再另写。
 */
export const WolfKillChosenPayloadSchema = z.object({ target: seatIdSchema });

export const SeerCheckedPayloadSchema = z.object({
  target: seatIdSchema,
  result: z.enum(['wolf', 'not-wolf']),
});

export const WitchPotionUsedPayloadSchema = z.object({
  potion: z.enum(['heal', 'poison']),
  target: seatIdSchema,
});

export const PlayerDiedPayloadSchema = z.object({
  seat: seatIdSchema,
  cause: deathCauseSchema,
});

export const HunterShootPayloadSchema = z.object({
  seat: seatIdSchema,
  target: seatIdSchema.nullable(),
});

export const PhaseChangedPayloadSchema = z.object({
  from: phaseSchema,
  to: phaseSchema,
});

/** RFC-004 拥有的四个事件 payload。 */
export const SpeechPayloadSchema = z.object({
  seat: seatIdSchema,
  text: z.string(),
});

export const SpeechSkippedPayloadSchema = z.object({ seat: seatIdSchema });

export const VoteCastPayloadSchema = z.object({
  seat: seatIdSchema,
  target: seatIdSchema.or(z.literal('abstain')),
});

export const VoteRevealedPayloadSchema = z.object({
  votes: z.array(z.object({ seat: seatIdSchema, target: seatIdSchema.or(z.literal('abstain')) })),
});

export const WolfChatPostedPayloadSchema = z.object({
  seat: seatIdSchema,
  text: z.string(),
  round: z.literal('night-chat'),
});

export const SelfExposePayloadSchema = z.object({ seat: seatIdSchema });

export const DayStartedPayloadSchema = z.object({
  day: z.number().int().min(1),
  diedLastNight: z.array(seatIdSchema),
  speechStartSeat: seatIdSchema,
});

export const GameEndedPayloadSchema = z.object({
  result: z.enum(['wolf', 'good']),
  condition: z.string().min(1),
});

/** AI 的内心理由（RFC-007 §2.5 / RFC-014）：`seat` 是产出它的席位。 */
export const AiThoughtPayloadSchema = z.object({
  reason: z.string(),
  claim: z.unknown().optional(),
  decisionSeq: z.number().int().min(0),
  seat: z.number().int().min(1).max(9),
});

/** 降级标记（RFC-010）：被降级的席位。 */
export const DegradedPayloadSchema = z.object({
  seat: z.number().int().min(1).max(9),
});

/** 狼队投票（RUL-13）。 */
export const WolfReadyMarkedPayloadSchema = z.object({
  seat: z.number().int().min(1).max(9),
});

export const WolfVoteCastPayloadSchema = z.object({
  seat: z.number().int().min(1).max(9),
  target: z.union([z.number().int().min(1).max(9), z.literal('abstain')]),
  confirmed: z.boolean(),
});

export const WolfVoteConfirmedPayloadSchema = z.object({
  seat: z.number().int().min(1).max(9),
});

export const WolfVoteRevealedPayloadSchema = z.object({
  votes: z.array(
    z.object({
      seat: z.number().int().min(1).max(9),
      target: z.union([z.number().int().min(1).max(9), z.literal('abstain')]),
      confirmed: z.boolean().optional(),
    }),
  ),
  tied: z.array(z.number().int().min(1).max(9)).optional(),
});

/** 已登记 payload schema 的事件，可以拿去 `makeEventEnvelopeSchema` 组合成完整校验。 */
export const PAYLOAD_SCHEMAS = {
  GAME_STARTED: GameStartedPayloadSchema,
  REJECTED: RejectedPayloadSchema,
  DAY_STARTED: DayStartedPayloadSchema,
  WOLF_CHAT_POSTED: WolfChatPostedPayloadSchema,
  SELF_EXPOSE: SelfExposePayloadSchema,
  SPEECH: SpeechPayloadSchema,
  SPEECH_SKIPPED: SpeechSkippedPayloadSchema,
  VOTE_CAST: VoteCastPayloadSchema,
  VOTE_REVEALED: VoteRevealedPayloadSchema,
  WOLF_KILL_CHOSEN: WolfKillChosenPayloadSchema,
  SEER_CHECKED: SeerCheckedPayloadSchema,
  WITCH_POTION_USED: WitchPotionUsedPayloadSchema,
  PLAYER_DIED: PlayerDiedPayloadSchema,
  HUNTER_SHOOT: HunterShootPayloadSchema,
  PHASE_CHANGED: PhaseChangedPayloadSchema,
  GAME_ENDED: GameEndedPayloadSchema,
  AI_THOUGHT: AiThoughtPayloadSchema,
  DEGRADED: DegradedPayloadSchema,
  WOLF_READY_MARKED: WolfReadyMarkedPayloadSchema,
  WOLF_VOTE_CONFIRMED: WolfVoteConfirmedPayloadSchema,
  WOLF_VOTE_CAST: WolfVoteCastPayloadSchema,
  WOLF_VOTE_REVEALED: WolfVoteRevealedPayloadSchema,
} as const;
