import { PassThrough } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import { encodeSseFrame, type StreamMessage } from '@shared/stream';
import { isVisibleTo } from '@shared/visibility';

import { resolveSession } from '../session';
import type { GameRegistry, GameRecord } from '../store/game-registry';
import type { StreamBus } from '../stream/bus';

/**
 * SSE 端点（RFC-010 §2.2）。
 *
 * 两条协议要求：
 * - 每条消息的 `id` 等于对应事件的 `seq`（API-2）；
 * - 断线重连带 `Last-Event-ID` 后**从下一个 `seq` 继续**，不重复、不丢失（AC-5）。
 *
 * 增量的来源是 `StreamBus`（`delta` 不写事件流），已提交的事件则从仓库补一次
 * `done`——两者合起来才能让「刷新页面」与「实时观看」看到同一段对话。
 */

export interface StreamRoutesOptions {
  registry: GameRegistry;
  bus: StreamBus;
  production: boolean;
}

/** 把已提交事件里对玩家可见的，转成 `done` 消息。 */
export function committedMessages(
  record: GameRecord,
  state: ReturnType<GameRegistry['stateOf']>,
): StreamMessage[] {
  return record.events
    .filter((event) => isVisibleTo(event, record.playerSeat, state))
    .map((event) => {
      const payload = event.payload as { seat?: number; text?: string };
      return {
        type: 'done' as const,
        id: event.seq,
        seat: (payload.seat ?? record.playerSeat) as never,
        text: payload.text ?? '',
      };
    });
}

export function registerStreamRoutes(app: FastifyInstance, options: StreamRoutesOptions): void {
  const { registry, bus, production } = options;

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

    reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('connection', 'keep-alive');

    const stream = new PassThrough();

    // 超窗：断线位置早于补偿窗口起点 → 要求重拉快照，而不是静默只发窗口内那一段。
    const replayable = bus.replay(record.gameId, lastEventId);
    if (replayable === undefined) {
      stream.end(encodeSseFrame({ type: 'error', id: lastEventId, message: 'SNAPSHOT_REQUIRED' }));
      return reply.send(stream);
    }

    // 先补已提交的事件（按 seq），再补总线里的增量，最后进入实时订阅。
    const committed = committedMessages(record, registry.stateOf(record)).filter(
      (message) => message.id > lastEventId,
    );
    for (const message of committed) stream.write(encodeSseFrame(message));
    for (const message of replayable) stream.write(encodeSseFrame(message));

    const unsubscribe = bus.subscribe(record.gameId, (message) => {
      stream.write(encodeSseFrame(message));
    });
    const endSubscription = bus.onEnd(record.gameId, () => {
      unsubscribe();
      endSubscription();
      stream.end();
    });

    // 客户端断开时清理订阅，避免对局结束后还挂着 listener。
    request.raw.on('close', () => {
      unsubscribe();
      endSubscription();
    });

    return reply.send(stream);
  });
}
