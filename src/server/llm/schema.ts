import { z } from 'zod';

/**
 * 模型返回的决策契约（RFC-006 §2.2）。
 *
 * `reason` 是**必填**的：它是复盘展示 AI 推理的唯一来源（AI-5）。少了它，这条决策在
 * 复盘里就是一句「他投了 3 号」——没有为什么。
 */
export const DecisionSchema = z.object({
  action: z.enum([
    'kill',
    'check',
    'heal',
    'poison',
    'none',
    'vote',
    'abstain',
    'speak',
    'skip',
    'shoot',
    'expose',
    'chat',
  ]),
  target: z.number().int().min(1).max(9).optional(),
  reason: z.string().min(1).max(200),
  speech: z.string().max(300).optional(),
  claim: z
    .object({
      role: z.enum(['seer', 'witch', 'hunter', 'villager', 'wolf']).optional(),
      checks: z
        .array(
          z.object({
            target: z.number().int(),
            result: z.enum(['wolf', 'not-wolf']),
          }),
        )
        .optional(),
      accuses: z
        .array(z.object({ target: z.number().int(), as: z.enum(['wolf', 'seer']) }))
        .optional(),
    })
    .optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;
