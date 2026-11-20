import { z } from 'zod';

/**
 * 真相视图的共享契约（RFC-013 / API-1）。
 *
 * 服务端与客户端共用同一份 schema：两处各写一份类型，字段一改就会悄悄错开。
 */

export const TruthSeatSchema = z.object({
  seat: z.number().int().min(1).max(9),
  role: z.string(),
  roleLabel: z.string(),
  alive: z.boolean(),
  /** 该席位这一局做过的动作摘要（夜间行动结果）。 */
  actions: z.array(z.string()),
});

export const TruthViewSchema = z.object({
  seats: z.array(TruthSeatSchema),
  /** 每一夜的狼队票型（RUL-13）。 */
  wolfVotes: z.array(
    z.object({
      day: z.number().int().min(1),
      votes: z.array(z.object({ seat: z.number().int(), target: z.number().int() })),
      tied: z.array(z.number().int()).optional(),
    }),
  ),
  deaths: z.array(
    z.object({
      seat: z.number().int().min(1).max(9),
      day: z.number().int().min(0),
      cause: z.string(),
    }),
  ),
});

export type TruthSeat = z.infer<typeof TruthSeatSchema>;
export type TruthView = z.infer<typeof TruthViewSchema>;
