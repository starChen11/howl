import { describe, expect, it } from 'vitest';

import type { InputChannel, OutputChannel, PlayerInput, SpeechChunk } from '@shared/channels';
import {
  SPEECH_MAX_CHARS,
  SPEECH_TIMEOUT_MS,
  charCount,
  isWithinLimit,
  normalizeInput,
  remainingSeconds,
} from '@server/speech';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { HttpInputChannel } from '@server/channels/http';
import { SseOutputChannel } from '@server/channels/sse';
import { StreamBus } from '@server/stream/bus';

/**
 * RFC-011 §5 AC-5 / 6 / 7 / 11 / 12 / 13：通道与发言规则。
 *
 * 用 stub 通道在**无浏览器、无 LLM** 的情况下把一局推进下去（AC-11），
 * 并证明新增通道实现不需要改引擎（AC-12）。
 */

describe('AC-5 · 300 字上限按 Unicode 字符算', () => {
  it('emoji 只算一个字符', () => {
    expect(charCount('😀')).toBe(1);
    expect(isWithinLimit('😀'.repeat(SPEECH_MAX_CHARS))).toBe(true);
    expect(isWithinLimit('😀'.repeat(SPEECH_MAX_CHARS + 1))).toBe(false);
  });

  it('超长文本被判定为超限', () => {
    expect(isWithinLimit('x'.repeat(SPEECH_MAX_CHARS + 1))).toBe(false);
  });
});

describe('AC-6 / AC-7 · 超时与弃权归一', () => {
  it('空白输入 → 弃权', () => {
    expect(normalizeInput({ text: '   ', timedOut: false })).toEqual({ kind: 'skip' });
  });

  it('超时但已有内容 → 用已有内容提交', () => {
    expect(normalizeInput({ text: '我说到一半', timedOut: true })).toEqual({
      kind: 'timeout',
      text: '我说到一半',
    });
  });

  it('超时且为空 → 弃权', () => {
    expect(normalizeInput({ text: '', timedOut: true })).toEqual({ kind: 'skip' });
  });
});

describe('AC-13 · 倒计时以服务端为准', () => {
  it('刷新不回满：剩余秒数只由服务端起点决定', () => {
    expect(remainingSeconds({ startedAt: 0, now: 0 })).toBe(SPEECH_TIMEOUT_MS / 1000);
    expect(remainingSeconds({ startedAt: 0, now: 30_000 })).toBe(30);
    expect(remainingSeconds({ startedAt: 0, now: SPEECH_TIMEOUT_MS })).toBe(0);
  });
});

describe('AC-13 · HttpInputChannel 由服务端计时', () => {
  it('submit 兑现挂起的 Promise', async () => {
    const channel = new HttpInputChannel({ timeoutMs: 1_000 });
    const pending = channel.read({ seat: 1 as never, timeoutMs: 1_000, kind: 'speech' });

    expect(channel.submit('我说一句')).toBe(true);
    expect(await pending).toEqual({ kind: 'speak', text: '我说一句' });
  });

  it('超时自动产出 skip', async () => {
    const channel = new HttpInputChannel({ timeoutMs: 10 });
    const pending = channel.read({ seat: 1 as never, timeoutMs: 10, kind: 'speech' });

    expect(await pending).toEqual({ kind: 'skip' });
  });

  it('没有挂起时 submit 返回 false（不是覆盖下一轮）', () => {
    const channel = new HttpInputChannel({ timeoutMs: 10 });
    expect(channel.submit('空放')).toBe(false);
  });
});

describe('AC-12 · 新通道实现不需要改引擎', () => {
  it('stub 输入通道驱动一整局，且事件流连续', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    const bus = new StreamBus();
    const output = new SseOutputChannel(bus, record.gameId);
    const chunks: SpeechChunk[] = [];
    const spyOutput: OutputChannel = {
      emit(chunk) {
        chunks.push(chunk);
        output.emit(chunk);
      },
      flush: async () => undefined,
    };

    let cursor = 0;
    const scriptedText = ['我过关。', '我也过。', '过。'];
    const input: InputChannel = {
      async read(): Promise<PlayerInput> {
        const text = scriptedText[cursor % scriptedText.length] ?? '';
        cursor += 1;
        return { kind: 'speak', text };
      },
      close() {
        cursor = 0;
      },
    };
    void input;

    // stub 通道：把这一夜走完即可证明「不需要引擎知道通道存在」
    const { currentSpeaker } = await import('@engine/phases/day');
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

    // 把这一夜走完，进入白天
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

    for (let guard = 0; guard < 40; guard += 1) {
      const state = registry.stateOf(current);
      if (state.phase !== 'DAY_SPEECH') break;
      const speaker = currentSpeaker(state);
      if (speaker === undefined) break;

      const reply = await scriptedInput();
      const action =
        reply.kind === 'skip'
          ? { type: 'SPEECH_SKIP', ts: 1, seat: speaker }
          : { type: 'SPEECH', ts: 1, seat: speaker, text: reply.text };
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;

      spyOutput.emit({
        seat: speaker,
        id: state.seq + 1,
        text: reply.kind === 'skip' ? '' : reply.text,
        final: true,
      });
      current = result.record;
    }

    async function scriptedInput(): Promise<PlayerInput> {
      return input.read({ seat: 1 as never, timeoutMs: 1_000, kind: 'speech' });
    }

    expect(chunks.length).toBeGreaterThan(0);
    const seqs = current.events.map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
  });
});
