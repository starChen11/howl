import type { FastifyInstance } from 'fastify';

import { encodeSseFrame, type StreamMessage } from '@shared/stream';

import { isVisibleTo } from '@shared/visibility';

import { resolveSession } from '../session';
import type { GameRecord, GameRegistry } from '../store/game-registry';

/**
 * SSE 端点（RFC-010 §2.2）。
 *
 * 两条协议要求：
 * - 每条消息的 `id` 等于对应事件的 `seq`（API-2）；
 * - 断线重连带 `Last-Event-ID` 后**从下一个 `seq` 继续**，不重复、不丢失（AC-5）。
 *
 * 补偿窗口：保留最近 200 条（Q-010-2）。
 */

export const REPLAY_WINDOW = 200;

export interface StreamRoutesOptions {
  registry: GameRegistry;
  production: boolean;
}

/** 把一条对局事件转成 SSE 消息；不可见的席位不产出消息。 */
export function messagesFor(
  record: GameRecord,
  seat: number,
  state: ReturnType<GameRegistry['stateOf']>,
): StreamMessage[] {
  // 用引擎的 `isVisibleTo` 判定，而不是手写一遍可见性规则：
  // 「wolves」这种按身份的可见性手写极容易漏（漏了就是把狼队夜聊广播给好人）。
  const visible = record.events.filter((event) => isVisibleTo(event, seat as never, state));

  return visible.map((event) => {
    const payload = event.payload as { seat?: number; text?: string };
    return {
      type: 'done' as const,
      id: event.seq,
      seat: (payload.seat ?? seat) as never,
      text: payload.text ?? '',
    };
  });
}

export function registerStreamRoutes(app: FastifyInstance, options: StreamRoutesOptions): void {
  const { registry, production } = options;

  app.get<{ Params: { id: string } }>('/api/games/:id/stream', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);

    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }
    if (record.events.length === 0) {
      return reply.code(410).send({ error: 'GAME_EXPIRED', message: '对局已释放' });
    }

    const lastEventIdRaw = request.headers['last-event-id'];
    const lastEventId =
      typeof lastEventIdRaw === 'string' && /^\d+$/.test(lastEventIdRaw)
        ? Number(lastEventIdRaw)
        : 0;

    const messages = messagesFor(record, record.playerSeat, registry.stateOf(record))
      .filter((message) => message.id > lastEventId)
      // 补偿窗口：只发最近 200 条，超出要求客户端重新拉快照
      .slice(-REPLAY_WINDOW);

    reply
      .header('content-type', 'text/event-stream')
      .header('cache-control', 'no-cache')
      .header('connection', 'keep-alive');

    return reply.send(messages.map((message) => encodeSseFrame(message)).join(''));
  });
}
