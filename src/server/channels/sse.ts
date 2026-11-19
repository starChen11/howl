import type { OutputChannel, SpeechChunk } from '@shared/channels';

import type { StreamBus } from '../stream/bus';

/**
 * SSE 输出通道（RFC-011 §2.3）。
 *
 * 把 AI 发言的增量推到 RFC-010 的流式端点。`delta` 不写进对局事件流（RFC-010 §4），
 * 所以只能走总线。
 */
export class SseOutputChannel implements OutputChannel {
  private readonly bus: StreamBus;
  private readonly gameId: string;

  constructor(bus: StreamBus, gameId: string) {
    this.bus = bus;
    this.gameId = gameId;
  }

  emit(chunk: SpeechChunk): void {
    if (chunk.final) {
      this.bus.publish(this.gameId, {
        type: 'done',
        id: chunk.id,
        seat: chunk.seat,
        text: chunk.text,
      });
      return;
    }

    this.bus.publish(this.gameId, {
      type: 'delta',
      id: chunk.id,
      seat: chunk.seat,
      text: chunk.text,
    });
  }

  async flush(): Promise<void> {
    // 总线是同步的：这里存在的意义是让「批量发送」将来可以插进来。
    await Promise.resolve();
  }
}
