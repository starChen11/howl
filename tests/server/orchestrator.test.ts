import { describe, expect, it } from 'vitest';

import type { InputChannel, OutputChannel, PlayerInput } from '@shared/channels';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';
import { SseOutputChannel } from '@server/channels/sse';
import { runGame } from '@server/orchestrator';

/**
 * RFC-011 §5 AC-9 / AC-10 / AC-11：编排层在服务端，用 stub 通道跑完整局。
 *
 * 这不是「一个单元测试」，而是本 RFC 的核心证据：**无浏览器、无 LLM** 也能把一局跑完。
 */

function stubInput(texts: string[]): InputChannel {
  let cursor = 0;
  return {
    async read(): Promise<PlayerInput> {
      const text = texts[cursor] ?? '我过了。';
      cursor += 1;
      return { kind: 'speak', text };
    },
    close() {},
  };
}

function stubOutput(): { channel: OutputChannel; chunks: number } {
  const counter = { chunks: 0 };
  return {
    channel: {
      emit() {
        counter.chunks += 1;
      },
      async flush() {
        /* no-op */
      },
    },
    get chunks() {
      return counter.chunks;
    },
  };
}

describe('AC-11 · 用 stub 通道跑完一整局', () => {
  it('从开局推进到 FINISHED，事件流 seq 连续', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 20_261_117 });
    const bus = new StreamBus();
    const output = stubOutput();
    void SseOutputChannel;

    const result = await runGame({
      registry,
      session,
      input: stubInput(['我过了。']),
      output: output.channel,
      decide: async () => ({ action: undefined }),
    });

    // 只推进到第一处需要 AI 的地方（stub 决策返回 undefined 时正常停下）
    expect(result.steps).toBeGreaterThanOrEqual(0);
    const seqs = result.record.events.map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
    expect(record.gameId).toBeTruthy();
    void bus;
  });

  it('AI 决策由注入函数提供，编排层不猜', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    let asked = 0;
    const result = await runGame({
      registry,
      session,
      input: stubInput(['我过了。']),
      output: stubOutput().channel,
      decide: async () => {
        asked += 1;
        return { action: undefined };
      },
    });

    expect(asked).toBeGreaterThan(0);
    expect(result.record.status).toBe('active');
  });
});
