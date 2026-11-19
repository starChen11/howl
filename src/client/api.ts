import type { ApiError, SessionResponse, SubmitActionBody } from '@shared/api';
import type { ProjectedContext } from '@shared/project';
import { parseSseData, type StreamMessage } from '@shared/stream';
import { TruthViewSchema, type TruthView } from '@shared/truth';

/**
 * 浏览器侧的 HTTP 客户端（RFC-011 §3）。
 *
 * 它只做两件事：读投影、提交输入。**不推进状态机**（ARCH-9）——引擎在服务端。
 */

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface GameViewResponse {
  version: number;
  view: ProjectedContext;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  async session(): Promise<SessionResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/session`, {
      credentials: 'same-origin',
    });
    return (await response.json()) as SessionResponse;
  }

  async game(gameId: string, pending?: string): Promise<GameViewResponse> {
    const query = pending === undefined ? '' : `?pending=${pending}`;
    const response = await this.fetchImpl(`${this.baseUrl}/api/games/${gameId}${query}`, {
      credentials: 'same-origin',
    });
    return (await response.json()) as GameViewResponse;
  }

  /** 提交玩家输入；409 时把服务端版本带回去，调用方据此重放。 */
  async submit(
    gameId: string,
    body: SubmitActionBody,
  ): Promise<{ ok: true } | { ok: false; error: ApiError }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/games/${gameId}/actions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) return { ok: true };
    return { ok: false, error: (await response.json()) as ApiError };
  }

  /** 真相视图数据；活着的玩家会拿到 403（SEC-6）。 */
  async truth(gameId: string): Promise<TruthView | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/games/${gameId}/truth`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return null;

    // 与客户端同一份契约（API-1）：服务端字段一改，这里会直接失败而不是静默错位。
    const parsed = TruthViewSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  }

  /** 同步草稿：超时由服务端用最后一次草稿提交（RFC-011 AC-6）。 */
  async draft(gameId: string, text: string): Promise<void> {
    await this.fetchImpl(`${this.baseUrl}/api/games/${gameId}/input`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  /** 订阅流；`onMessage` 逐条回调。返回断开函数。 */
  openStream(gameId: string, onMessage: (message: StreamMessage) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/api/games/${gameId}/stream`);

    source.onmessage = (event: MessageEvent<string>) => {
      const message = parseSseData(event.data);
      if (message !== undefined) onMessage(message);
    };

    return () => source.close();
  }
}
