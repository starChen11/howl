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

/**
 * 警长与竞选的真相摘要（RFC-022 AC-15）。
 *
 * 真相视图只对已出局玩家开放；他们应该能看到每一轮警长票、发言顺序选择和警徽流转，
 * 而不是只看到「某人当过警长」。字段保持可选，旧对局/旧客户端不受影响。
 */
export const TruthSheriffSchema = z.object({
  elected: z.number().int().min(1).max(9).nullable(),
  badge: z.enum(['none', 'held', 'destroyed']),
  votes: z.array(
    z.object({
      round: z.enum(['initial', 'runoff']),
      votes: z.array(
        z.object({
          seat: z.number().int(),
          target: z.union([z.number().int(), z.literal('abstain')]),
        }),
      ),
      tied: z.array(z.number().int()).optional(),
    }),
  ),
  orders: z.array(
    z.object({
      day: z.number().int().min(1),
      startSeat: z.number().int().min(1).max(9),
      direction: z.enum(['clockwise', 'counterclockwise']),
    }),
  ),
  transfers: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
});

export const TruthViewSchema = z.object({
  seats: z.array(TruthSeatSchema),
  /** 每一夜的狼队票型（RUL-13）。 */
  wolfVotes: z.array(
    z.object({
      day: z.number().int().min(1),
      votes: z.array(
        z.object({
          seat: z.number().int(),
          target: z.union([z.number().int(), z.literal('abstain')]),
        }),
      ),
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
  /** RFC-022：警长竞选、定序与警徽流转。 */
  sheriff: TruthSheriffSchema.optional(),
});

export type TruthSeat = z.infer<typeof TruthSeatSchema>;
export type TruthView = z.infer<typeof TruthViewSchema>;
