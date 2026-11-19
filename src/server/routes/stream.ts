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

    // 已提交的事件与总线里的增量**按 id 合并排序**：分两批写会出现
    // 「done 15 → thinking 15 → delta 15」这种顺序，客户端会退回 speaking。
    // 同一段发言的多个增量共享一个 id，**不能按 id 去重**（那会把 delta 丢掉）。
    // 以总线顺序为主干；已提交事件只在「该 id 还没有总线消息」时插入，保证
    // 「刷新看到历史、实时看到增量」两路不重复、且整体按 id 递增。
    const fromBus = [...replayable];
    const busIds = new Set(fromBus.map((message) => message.id));
    const extras = committedMessages(record, registry.stateOf(record)).filter(
      (message) => message.id > lastEventId && !busIds.has(message.id),
    );

    const ordered = [...extras, ...fromBus].sort((a, b) => a.id - b.id);
    for (const message of ordered) stream.write(encodeSseFrame(message));

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
