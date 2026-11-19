import { HttpInputChannel } from './http';
import { SseOutputChannel } from './sse';
import type { StreamBus } from '../stream/bus';

/**
 * 每个对局的通道实例（RFC-011 §2.3）。
 *
 * 生产侧的接线点：`POST /api/games/:id/actions` 把玩家敲的字交给这里挂起的
 * `HttpInputChannel`；`SseOutputChannel` 把 AI 的增量推到 RFC-010 的流。
 *
 * 这一层是**有状态的**（挂起的 Promise），所以不能放在 router 里临时 new。
 */

export interface GameChannels {
  input: HttpInputChannel;
  output: SseOutputChannel;
}

export class ChannelRegistry {
  private readonly byGame = new Map<string, GameChannels>();
  private readonly bus: StreamBus;

  constructor(bus: StreamBus) {
    this.bus = bus;
  }

  forGame(gameId: string): GameChannels {
    const existing = this.byGame.get(gameId);
    if (existing !== undefined) return existing;

    const created: GameChannels = {
      input: new HttpInputChannel(),
      output: new SseOutputChannel(this.bus, gameId),
    };
    this.byGame.set(gameId, created);
    return created;
  }

  /** 把玩家的一句话交给挂起的输入通道；没有人在等就返回 false。 */
  submit(gameId: string, text: string): boolean {
    return this.byGame.get(gameId)?.input.submit(text) ?? false;
  }

  /** 同步草稿（超时时会用它提交）。 */
  setDraft(gameId: string, text: string): void {
    this.byGame.get(gameId)?.input.setDraft(text);
  }
}
