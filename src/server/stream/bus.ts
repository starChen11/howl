import { EventEmitter } from 'node:events';

import type { StreamMessage } from '@shared/stream';

/**
 * 进程内的事件总线（RFC-010 §2.2）。
 *
 * SSE 端点订阅它；AI 发言的增量（`thinking` / `delta` / `done` / `degraded`）由
 * **生产侧**（RFC-011 的 `SseOutputChannel`、本 RFC 的 `runTurn`）发布。
 *
 * `delta` 不写进对局事件流（§4），所以它只能走这条总线——靠读 `record.events`
 * 永远读不到增量，这正是 Round 1 的 C-86。
 */

/** 每个对局保留的最近消息数（补偿窗口，Q-010-2）。 */
export const BUS_HISTORY = 200;

interface GameChannel {
  history: StreamMessage[];
  emitter: EventEmitter;
  ended: boolean;
}

export class StreamBus {
  private readonly games = new Map<string, GameChannel>();

  private channelOf(gameId: string): GameChannel {
    const existing = this.games.get(gameId);
    if (existing !== undefined) return existing;

    const created: GameChannel = { history: [], emitter: new EventEmitter(), ended: false };
    // 每个连接都挂一个 listener；上限调高，免得 10 个观众就触发泄漏告警。
    created.emitter.setMaxListeners(64);
    this.games.set(gameId, created);
    return created;
  }

  publish(gameId: string, message: StreamMessage): void {
    const channel = this.channelOf(gameId);
    if (channel.ended) return;

    channel.history.push(message);
    if (channel.history.length > BUS_HISTORY) channel.history.shift();
    channel.emitter.emit('message', message);
  }

  /**
   * 重连补偿：返回 `id > lastEventId` 的消息。
   *
   * 返回 `undefined` 表示断线位置已经早于窗口起点——**必须让客户端重拉快照**，
   * 不能只发窗口内那一段（那会静默丢掉中间的事件）。
   */
  replay(gameId: string, lastEventId: number): StreamMessage[] | undefined {
    const channel = this.channelOf(gameId);
    if (channel.history.length === 0) return [];

    const oldest = channel.history[0]?.id ?? 0;
    if (channel.history.length >= BUS_HISTORY && lastEventId < oldest) return undefined;

    return channel.history.filter((message) => message.id > lastEventId);
  }

  subscribe(gameId: string, listener: (message: StreamMessage) => void): () => void {
    const channel = this.channelOf(gameId);
    channel.emitter.on('message', listener);
    return () => channel.emitter.off('message', listener);
  }

  end(gameId: string): void {
    const channel = this.games.get(gameId);
    if (channel === undefined) return;
    channel.ended = true;
    channel.emitter.emit('end');
  }

  onEnd(gameId: string, listener: () => void): () => void {
    const channel = this.channelOf(gameId);
    channel.emitter.on('end', listener);
    return () => channel.emitter.off('end', listener);
  }

  isEnded(gameId: string): boolean {
    return this.games.get(gameId)?.ended ?? false;
  }
}
