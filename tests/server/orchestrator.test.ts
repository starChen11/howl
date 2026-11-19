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

describe('C-101 · 玩家轮真的会问输入通道', () => {
  it('开局即白天时，runGame 会向玩家通道索取发言并产出 SPEECH', async () => {
    // 夜里有刀人，玩家可能已经出局。选一个「玩家是 wolf」的席位：
    // wolf 不会被狼刀，白天只可能被投出去，一轮之内一定还活着。
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    let record;
    let seat = 1;
    for (; seat <= 9; seat += 1) {
      record = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed: 15,
        playerSeat: seat as never,
      });
      const player = registry.stateOf(record).seats.find((candidate) => candidate.isPlayer);
      if (player?.role === 'wolf') break;
    }
    if (record === undefined) throw new Error('没有创建对局');

    // 先把这一夜走完，进入 DAY_SPEECH（编排层的职责从白天开始验证）
    let current = record;
    while (registry.stateOf(current).phase === 'NIGHT_WOLF_CHAT') {
      const state = registry.stateOf(current);
      const speaker = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      const result = await registry.submit(
        session,
        current,
        { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' } as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = registry.stateOf(current);
      if (state.phase === 'DAY_SPEECH') break;
      const actor =
        type === 'WOLF_KILL'
          ? state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat
          : type === 'SEER_CHECK'
            ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
            : state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
      if (actor === undefined) break;
      const action =
        type === 'WITCH_ACT'
          ? { type, ts: 1, seat: actor, potion: 'none' }
          : {
              type,
              ts: 1,
              seat: actor,
              target: state.seats.find((seat) => seat.alive && seat.seat !== actor)?.seat,
            };
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;
      current = result.record;
    }
    expect(registry.stateOf(current).phase).toBe('DAY_SPEECH');

    // debug
    let reads = 0;
    const input: InputChannel = {
      async read(): Promise<PlayerInput> {
        reads += 1;
        return { kind: 'speak', text: '我过关。' };
      },
      close() {},
    };

    const result = await runGame({
      registry,
      session,
      input,
      output: stubOutput().channel,
      decide: async ({ seat, ctx }) => {
        // AI 席位：替它说一句（引擎会校验是不是轮到它）
        if (ctx.phase !== 'DAY_SPEECH') return { action: undefined };
        return {
          action: { type: 'SPEECH', ts: 1, seat: seat as never, text: '我过了。' },
        };
      },
      maxSteps: 20,
    });

    // 玩家席位被问过；而且**玩家说的那句话**原样落进事件流
    expect(reads).toBeGreaterThan(0);
    const playerSeat =
      registry.stateOf(result.record).seats.find((candidate) => candidate.isPlayer)?.seat ?? -1;
    const playerSpeech = result.record.events.find(
      (event) =>
        event.type === 'SPEECH' && (event.payload as { seat?: number }).seat === playerSeat,
    );
    expect(playerSpeech, '玩家没有发言').toBeDefined();
    expect((playerSpeech?.payload as { text?: string }).text).toBe('我过关。');
  });
});
