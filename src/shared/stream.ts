import { z } from 'zod';

import { seatIdSchema } from './schemas';

/**
 * SSE 消息契约（RFC-010 §2.2）。
 *
 * 服务端与前端共用：前端的状态机（`src/client/use-stream.ts`）只认这五种消息。
 * `id` 恒等于对应事件的 `seq`（API-2）——断线重连靠它对齐。
 */

export const StreamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking'), id: z.number().int(), seat: seatIdSchema }),
  z.object({
    type: z.literal('delta'),
    id: z.number().int(),
    seat: seatIdSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    id: z.number().int(),
    seat: seatIdSchema,
    text: z.string(),
  }),
  z.object({ type: z.literal('degraded'), id: z.number().int(), seat: seatIdSchema }),
  z.object({ type: z.literal('error'), id: z.number().int(), message: z.string() }),
]);

export type StreamMessage = z.infer<typeof StreamMessageSchema>;

/** 服务端把一条消息编码成 SSE 帧。`id:` 行就是 API-2 要求的 `seq`。 */
export function encodeSseFrame(message: StreamMessage): string {
  return `id: ${message.id}\ndata: ${JSON.stringify(message)}\n\n`;
}

/**
 * 解析一行 `data:` 里的 JSON。
 *
 * 解析失败返回 `undefined` 而不是抛错：流里混进一条坏帧不应该把整条连接打断。
 */
export function parseSseData(data: string): StreamMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    const result = StreamMessageSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
