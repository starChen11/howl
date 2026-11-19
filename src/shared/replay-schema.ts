import { z } from 'zod';

// 形状与 `./replay` 的接口一致；这里不 import 它是为了避免循环依赖。

/**
 * 复盘快照的 Zod 契约（RFC-014 / API-1）。
 *
 * 与服务端生成的形状同源；客户端拿到后先 parse，字段对不上就回落到「没有复盘」，
 * 而不是在渲染层炸掉。
 */

const ClaimSchema = z.object({
  role: z.string().optional(),
  checks: z
    .array(z.object({ target: z.number().int(), result: z.enum(['wolf', 'not-wolf']) }))
    .optional(),
  accuses: z.array(z.object({ target: z.number().int(), as: z.enum(['wolf', 'seer']) })).optional(),
});

export const ReplaySnapshotSchema = z.object({
  gameId: z.string(),
  seed: z.number().int(),
  finishedAt: z.number(),
  result: z.enum(['wolf', 'good']),
  winCondition: z.string(),
  timeline: z.array(
    z.object({
      seq: z.number().int(),
      day: z.number().int(),
      phase: z.string(),
      text: z.string(),
    }),
  ),
  seats: z.array(
    z.object({
      seat: z.number().int(),
      role: z.string(),
      roleLabel: z.string(),
      personaId: z.string().nullable(),
      personaLabel: z.string().nullable(),
      alive: z.boolean(),
    }),
  ),
  thoughts: z.array(
    z.object({
      seq: z.number().int(),
      seat: z.number().int(),
      kind: z.enum(['speech', 'vote', 'night-action']),
      reason: z.string(),
      claim: ClaimSchema.optional(),
      chose: z.string(),
    }),
  ),
  degraded: z.array(z.number().int()),
  usage: z
    .object({
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cachedTokens: z.number().int(),
    })
    .optional(),
});
