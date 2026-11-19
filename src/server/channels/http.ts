import type { InputChannel, InputPrompt, PlayerInput } from '@shared/channels';

import { normalizeInput, SPEECH_TIMEOUT_MS } from '../speech';

/**
 * HTTP 输入通道（RFC-011 §2.3 / §4）。
 *
 * 把「等玩家发言」变成一个**挂起的 Promise**：`POST /actions` 到达时兑现；
 * 超时由服务端计时器触发（AC-13：刷新页面不会重置计时，因为起点在服务端）。
 *
 * 单调时钟：用注入的 `now`（默认 `performance.now` 级别的单调源），不用
 * `setInterval` 累加——后台标签页会把累加的时间拖慢。
 */

export interface HttpInputChannelOptions {
  /** 单调时钟；测试注入。 */
  now?: () => number;
  timeoutMs?: number;
}

interface Pending {
  resolve: (input: PlayerInput) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class HttpInputChannel implements InputChannel {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private pending: Pending | undefined;

  constructor(options: HttpInputChannelOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.timeoutMs = options.timeoutMs ?? SPEECH_TIMEOUT_MS;
  }

  /** 服务端当前这一轮已经过了多少毫秒（刷新后仍准确）。 */
  elapsed(startedAt: number): number {
    return this.now() - startedAt;
  }

  read(prompt: InputPrompt): Promise<PlayerInput> {
    this.close();

    return new Promise<PlayerInput>((resolve) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        // 超时：交出**已输入的内容**。这里没有增量缓存，所以是空文本 → 弃权。
        resolve(normalizeInput({ text: '', timedOut: true }));
      }, prompt.timeoutMs);

      this.pending = { resolve, timer };
    });
  }

  /** `POST /actions` 到达时兑现。返回是否有人真的在等。 */
  submit(text: string): boolean {
    const pending = this.pending;
    if (pending === undefined) return false;

    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(normalizeInput({ text, timedOut: false }));
    return true;
  }

  close(): void {
    const pending = this.pending;
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
  }
}
