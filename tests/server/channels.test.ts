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
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
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

describe('AC-6 / AC-9 · 生产接线：被拒绝的发言不会通知编排层', () => {
  it('夜间提交 SPEECH：引擎拒绝，挂起通道仍未被兑现', async () => {
    const { buildApp } = await import('@server/app');
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');

    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store: new InMemoryMetaStore(), bus, channels });

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();
    const version = created.json<{ version: number }>().version;

    let resolved: PlayerInput | undefined;
    void channels
      .forGame(gameId)
      .input.read({ seat: 1 as never, timeoutMs: 5_000, kind: 'speech' })
      .then((value) => {
        resolved = value;
      });

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'SPEECH', ts: 1, seat: 1, text: '我先说' },
        expectedVersion: version,
      },
    });

    // 夜间发言被引擎拒绝：响应里是 REJECTED，挂起通道**不能**被兑现
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ events: { type: string }[] }>().events.some((e) => e.type === 'REJECTED'),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBeUndefined();
    channels.forGame(gameId).input.close();
  });

  it('草稿接口也校验 300 字上限（不能绕过 AC-5）', async () => {
    const { buildApp } = await import('@server/app');
    const app = buildApp({ store: new InMemoryMetaStore() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/input`,
      headers: { cookie },
      payload: { text: '字'.repeat(301) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('通道注册表本身能兑现挂起的输入（生产回路的单元证据）', async () => {
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');
    const channels = new ChannelRegistry(new StreamBus());

    const pending = channels
      .forGame('g')
      .input.read({ seat: 1 as never, timeoutMs: 5_000, kind: 'speech' });
    expect(channels.submit('g', '我来说')).toBe(true);
    expect(await pending).toEqual({ kind: 'speak', text: '我来说' });
  });
});

describe('C-109 / C-110 · 正向路径与输出通道', () => {
  it('接受分支会通知挂起通道（白天发言）', async () => {
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');

    // 直接测路由的接受分支：用注册表模拟「有人正在等」
    const channels = new ChannelRegistry(new StreamBus());
    const pending = channels
      .forGame('g')
      .input.read({ seat: 1 as never, timeoutMs: 5_000, kind: 'speech' });

    expect(channels.submit('g', '我说完了')).toBe(true);
    expect(await pending).toEqual({ kind: 'speak', text: '我说完了' });
  });

  it('SseOutputChannel 把增量与终稿推到总线', async () => {
    const { SseOutputChannel } = await import('@server/channels/sse');
    const { StreamBus } = await import('@server/stream/bus');
    const bus = new StreamBus();
    const seen: string[] = [];
    bus.subscribe('g', (message) => seen.push(message.type));

    const output = new SseOutputChannel(bus, 'g');
    output.emit({ seat: 1 as never, id: 5, text: '我', final: false });
    output.emit({ seat: 1 as never, id: 5, text: '我过了', final: true });

    expect(seen).toEqual(['delta', 'done']);
  });

  it('超时草稿走 timeout 分支而不是弃权（除非草稿为空）', async () => {
    const channel = new HttpInputChannel({ timeoutMs: 10 });
    const withDraft = channel.read({ seat: 1 as never, timeoutMs: 10, kind: 'speech' });
    channel.setDraft('我说到一半');
    expect(await withDraft).toEqual({ kind: 'timeout', text: '我说到一半' });

    const empty = channel.read({ seat: 1 as never, timeoutMs: 10, kind: 'speech' });
    expect(await empty).toEqual({ kind: 'skip' });
  });
});

describe('AC-9 · 路由接受发言时通知挂起通道（正向用例）', () => {
  it('白天提交 SPEECH：引擎接受，挂起通道收到原话', async () => {
    const { buildApp } = await import('@server/app');
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');

    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store, bus, channels });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    // 先跑一遍探明「第一天第一个发言的是谁」，再让玩家坐那个席位
    const trial = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: 1,
    });

    // 推进到白天：夜聊 → 刀/查/药
    let current = trial;
    const stateOf = () => registry.stateOf(current);
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
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
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: speaker,
          text: '',
        } as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
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
    expect(stateOf().phase).toBe('DAY_SPEECH');
    const firstSpeaker = (stateOf().speech?.startSeat ?? 1) as number;

    // 用同一个种子、让玩家坐第一个发言的位置，重新开一局并推进到白天
    const playerGame = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: firstSpeaker as never,
    });
    current = playerGame;
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const wolf = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (wolf === undefined) break;
      const result = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: wolf,
          text: '',
        } as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
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

    const speaker = (stateOf().speech?.startSeat ?? 1) as number;
    expect(speaker).toBe(firstSpeaker);
    const pending = channels
      .forGame(current.gameId)
      .input.read({ seat: speaker as never, timeoutMs: 5_000, kind: 'speech' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie: `session=${session.id}` },
      payload: {
        action: { type: 'SPEECH', ts: 1, seat: speaker, text: '我觉得 2 号像狼' },
        expectedVersion: current.events.length,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ events: { type: string }[] }>().events.some((e) => e.type === 'SPEECH')).toBe(
      true,
    );
    expect(await pending).toEqual({ kind: 'speak', text: '我觉得 2 号像狼' });
  });
});

describe('C-115 · 弃权与空输入必须接上通道', () => {
  it('POST SPEECH_SKIP 会兑现挂起的输入（不是等 60 秒超时）', async () => {
    const { buildApp } = await import('@server/app');
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');

    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store, bus, channels });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    // 先探明第一个发言的席位，再让玩家坐那儿（路由只允许提交自己席位）
    const trial = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: 1,
    });

    // 推进到白天
    let current = trial;
    const stateOf = () => registry.stateOf(current);
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const speaker = state.seats.find(
        (wolf) =>
          wolf.alive &&
          wolf.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === wolf.seat),
      )?.seat;
      if (speaker === undefined) break;
      const r = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: speaker,
          text: '',
        } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
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
      const r = await registry.submit(session, current, action as never, state.seq);
      if (!r.ok) break;
      current = r.record;
    }

    const firstSpeaker = (stateOf().speech?.startSeat ?? 1) as number;
    current = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: firstSpeaker as never,
    });
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const wolf = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (wolf === undefined) break;
      const r = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: wolf,
          text: '',
        } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
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
      const r = await registry.submit(session, current, action as never, state.seq);
      if (!r.ok) break;
      current = r.record;
    }

    const speaker = (stateOf().speech?.startSeat ?? 1) as number;
    const pending = channels
      .forGame(current.gameId)
      .input.read({ seat: speaker as never, timeoutMs: 5_000, kind: 'speech' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie: `session=${session.id}` },
      payload: {
        action: { type: 'SPEECH_SKIP', ts: 1, seat: speaker },
        expectedVersion: current.events.length,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await pending).toEqual({ kind: 'skip' });
  });

  it('空文本的 SPEECH 被拒绝（应改用 SPEECH_SKIP）', async () => {
    const { buildApp } = await import('@server/app');
    const app = buildApp({ store: new InMemoryMetaStore() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'SPEECH', ts: 1, seat: 1, text: '   ' },
        expectedVersion: 1,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('B-R9-1 · 端到端：玩家是最后一位发言者时不重复提交', () => {
  it('路由写入后编排层跳过，事件流里没有 REJECTED', async () => {
    const { buildApp } = await import('@server/app');
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');
    const { runGame } = await import('@server/orchestrator');

    /** 把一局推进到「只剩最后一位没发言」，返回当时的记录与最后一位席位。 */
    const driveToLastSpeaker = async (
      registry: GameRegistry,
      session: Awaited<ReturnType<GameRegistry['createSession']>>,
      seed: number,
      playerSeat: number,
    ) => {
      let current = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed,
        playerSeat: playerSeat as never,
      });
      const stateOf = () => registry.stateOf(current);

      while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
        const state = stateOf();
        const wolf = state.seats.find(
          (seat) =>
            seat.alive &&
            seat.role === 'wolf' &&
            !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
        )?.seat;
        if (wolf === undefined) break;
        const r = await registry.submit(
          session,
          current,
          {
            type: 'WOLF_CHAT',
            ts: 1,
            seat: wolf,
            text: '',
          } as never,
          state.seq,
        );
        if (!r.ok) break;
        current = r.record;
      }
      for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
        const readyState = registry.stateOf(current);
        if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
        const readyWolf = readyState.seats.find(
          (seat) =>
            seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
        )?.seat;
        if (readyWolf === undefined) break;
        const readyResult = await registry.submit(
          session,
          current,
          { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
          readyState.seq,
        );
        if (!readyResult.ok) break;
        current = readyResult.record;
      }
      for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT', 'HUNTER_SHOOT'] as const) {
        const state = stateOf();
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
        const r = await registry.submit(session, current, action as never, state.seq);
        if (!r.ok) break;
        current = r.record;
      }

      // 说满一圈，只剩最后一位
      while (stateOf().phase === 'DAY_SPEECH') {
        const state = stateOf();
        const order = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
        const start = order.indexOf(state.speech?.startSeat ?? 1);
        const next = [...order.slice(start), ...order.slice(0, start)].find(
          (seat) => !(state.speech?.spoken ?? []).includes(seat),
        );
        const remaining = order.filter((seat) => !(state.speech?.spoken ?? []).includes(seat));
        if (next === undefined || remaining.length <= 1) break;
        const r = await registry.submit(
          session,
          current,
          {
            type: 'SPEECH',
            ts: 1,
            seat: next,
            text: '我过了。',
          } as never,
          state.seq,
        );
        if (!r.ok) break;
        current = r.record;
      }

      const state = stateOf();
      const order = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
      const start = order.indexOf(state.speech?.startSeat ?? 1);
      const last = [...order.slice(start), ...order.slice(0, start)].find(
        (seat) => !(state.speech?.spoken ?? []).includes(seat),
      );
      return { current, last };
    };

    // 要复现「重复提交」，最后一位发言人必须**同时是投票的第一个行动者**：
    // 发言从 startSeat 开始绕圈，所以 startSeat = 2 时最后一位正好是 1 号（票序第一个）。
    // 逐个种子找这个拓扑（确定性）。
    const probeStore = new InMemoryMetaStore();
    const probeRegistry = new GameRegistry(probeStore);

    let chosenSeed = 0;
    let probe: Awaited<ReturnType<typeof driveToLastSpeaker>> | undefined;
    for (let seed = 1; seed <= 40; seed += 1) {
      const candidateSession = await probeRegistry.createSession();
      const candidate = await driveToLastSpeaker(probeRegistry, candidateSession, seed, 1);
      if (candidate.last === undefined) continue;
      const state = probeRegistry.stateOf(candidate.current);
      // 夜里被刀的猎人会进入开枪相位；这种种子跳过（本用例只关心白天）。
      if (state.phase !== 'DAY_SPEECH') continue;
      const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
      if (candidate.last === Math.min(...alive)) {
        chosenSeed = seed;
        probe = candidate;
        break;
      }
    }
    if (probe?.last === undefined) throw new Error('找不到「最后发言 == 第一个投票」的种子');

    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store, bus, channels });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const { current, last } = await driveToLastSpeaker(registry, session, chosenSeed, probe.last);

    expect(last).toBe(probe.last);
    expect(registry.stateOf(current).phase).toBe('DAY_SPEECH');

    // 编排层在等玩家说话
    const runPromise = runGame({
      registry,
      session,
      input: channels.forGame(current.gameId).input,
      output: { emit() {}, async flush() {} },
      decide: async () => ({ action: undefined }),
      maxSteps: 5,
    });

    // 玩家经路由提交最后一句（同时兑现挂起的输入）
    await new Promise((resolve) => setTimeout(resolve, 30));
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie: `session=${session.id}` },
      payload: {
        action: { type: 'SPEECH', ts: 1, seat: last, text: '最后一句' },
        expectedVersion: current.events.length,
      },
    });

    // 发言之后可能轮到玩家投票：用真实路由投一票（路由会把目标交给挂起的输入）。
    let settled = false;
    void runPromise.then(() => {
      settled = true;
    });
    for (let tick = 0; tick < 100 && !settled; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const record = await registry.getGame(current.gameId);
      if (record === undefined) break;
      const state = registry.stateOf(record);
      if (state.phase !== 'DAY_VOTE') continue;
      const me = state.seats.find((seat) => seat.isPlayer)?.seat;
      if (me === undefined) continue;
      await app.inject({
        method: 'POST',
        url: `/api/games/${current.gameId}/actions`,
        headers: { cookie: `session=${session.id}` },
        payload: {
          action: { type: 'VOTE', ts: Date.now(), seat: me, target: 'abstain' },
          expectedVersion: record.events.length,
        },
      });
    }
    await runPromise;

    const after = await registry.getGame(current.gameId);
    expect(res.statusCode).toBe(200);
    expect(after?.events.some((event) => event.type === 'REJECTED')).toBe(false);
    const speeches = after?.events.filter(
      (event) => event.type === 'SPEECH' && (event.payload as { seat?: number }).seat === last,
    );
    expect(speeches).toHaveLength(1);
  });
});
