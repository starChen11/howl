import type { StreamMessage } from '@shared/stream';

/**
 * 流式增量解析（RFC-010 §2.1 / §4）。
 *
 * 只做一件事：把模型返回的 chunk 序列解码成文本，再切成 SSE 风格的 `data:` 帧。
 *
 * **中文会被切在任意字节位置**：一个汉字在 UTF-8 里是 3 字节，网络分片可能把它切成
 * 1+2。用 `TextDecoder({ stream: true })` 让解码器自己缓存不完整的多字节序列——
 * 这是流式解析最常见的坑。
 */
export class IncrementalDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private buffer = '';

  /** 吃进一个 chunk，吐出本次能确定的完整行（可能为空）。 */
  push(chunk: string | Uint8Array): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });

    const lines = this.buffer.split('\n');
    // 最后一段可能是不完整的行，留到下一次
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  /** 流结束时把剩余内容吐出来（可能没有换行结尾）。 */
  flush(): string[] {
    this.buffer += this.decoder.decode();
    const rest = this.buffer;
    this.buffer = '';
    return rest.length === 0 ? [] : [rest];
  }
}

/** 把一行 SSE 文本解析成消息；`thinking` / `delta` / `done` 都走这里。 */
export function parseSseLine(line: string): StreamMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;

  const data = trimmed.slice('data:'.length).trim();
  if (data.length === 0 || data === '[DONE]') return undefined;

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const candidate = parsed as Partial<StreamMessage> & { type?: string };
    if (candidate.type === undefined) return undefined;
    return candidate as StreamMessage;
  } catch {
    return undefined;
  }
}

/**
 * 增量消费一条字节流，按到达顺序回调。
 *
 * 每收到一个 chunk **立刻**转发，不攒批（§6 的性能要求）。
 */
export async function consumeStream(
  chunks: AsyncIterable<string | Uint8Array>,
  onMessage: (message: StreamMessage) => void,
): Promise<void> {
  const decoder = new IncrementalDecoder();

  for await (const chunk of chunks) {
    for (const line of decoder.push(chunk)) {
      const message = parseSseLine(line);
      if (message !== undefined) onMessage(message);
    }
  }

  for (const line of decoder.flush()) {
    const message = parseSseLine(line);
    if (message !== undefined) onMessage(message);
  }
}
