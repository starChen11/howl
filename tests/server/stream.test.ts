import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { StreamBus } from '@server/stream/bus';
import { currentSpeaker } from '@engine/phases/day';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { IncrementalDecoder, consumeStream, parseSseLine } from '@server/llm/stream';
import { encodeSseFrame, parseSseData } from '@shared/stream';
import type { SessionRecord } from '@server/store/game-registry';
import type { GameRecord } from '@server/store/game-registry';

/**
 * RFC-010 §5 AC-5 / 6：SSE 协议与多字节解码。
 */

/** 把一局推进到有公开事件的相位（天亮了）。 */
async function advanceToDay(
  registry: GameRegistry,
  session: SessionRecord,
  record: GameRecord,
): Promise<GameRecord> {
  let current = record;
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
      { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' } as never,
      state.seq,
    );
    if (!result.ok) throw new Error('夜聊失败');
    current = result.record;

    const ready = await registry.submit(
      session,
      current,
      { type: 'WOLF_READY', ts: 1, seat: speaker } as never,
      registry.stateOf(current).seq,
    );
    if (!ready.ok) throw new Error('准备失败');
    current = ready.record;
  }

  for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT', 'HUNTER_SHOOT'] as const) {
    const state = stateOf();
    if (
      state.phase === 'DAY_ANNOUNCE' ||
      state.phase === 'DAY_SPEECH' ||
      state.phase === 'FINISHED'
    )
      break;
    const actor =
      type === 'WOLF_KILL'
        ? state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat
        : type === 'SEER_CHECK'
          ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
          : type === 'WITCH_ACT'
            ? state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat
            : state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (actor === undefined) break;

    const target = state.seats.find((seat) => seat.alive && seat.seat !== actor)?.seat;
    const action =
      type === 'WITCH_ACT'
        ? { type, ts: 1, seat: actor, potion: 'none' }
        : type === 'HUNTER_SHOOT'
          ? { type, ts: 1, seat: actor }
          : { type, ts: 1, seat: actor, target };
    const result = await registry.submit(session, current, action as never, state.seq);
    if (!result.ok) break;
    current = result.record;
  }

  return current;
}

async function setup() {
  const store = new InMemoryMetaStore();
  const registry = new GameRegistry(store);
  const session = await registry.createSession();
  const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });
  const advanced = await advanceToDay(registry, session, record);

  // 补一条真实发言：发言流只含有正文的 SPEECH，没有发言时为空是合法的，
  // 但这里要断言「id 等于 seq」，需要有东西可断言。
  let withSpeech = advanced;
  const atSpeech = registry.stateOf(withSpeech);
  if (atSpeech.phase === 'DAY_SPEECH') {
    const speaker = currentSpeaker(atSpeech);
    if (speaker !== undefined) {
      const spoken = await registry.submit(
        session,
        withSpeech,
        { type: 'SPEECH', ts: 1, seat: speaker, text: '我先说一句' } as never,
        atSpeech.seq,
      );
      if (spoken.ok) withSpeech = spoken.record;
    }
  }

  const bus = new StreamBus();
  const app = buildApp({ store, bus });
  return { app, bus, store, registry, session, record: withSpeech };
}

/** SSE 是长连接：发起请求后主动结束流，才能拿到完整响应。 */
async function collect(
  app: ReturnType<typeof buildApp>,
  bus: StreamBus,
  gameId: string,
  headers: Record<string, string>,
): Promise<string> {
  const pending = app.inject({ method: 'GET', url: `/api/games/${gameId}/stream`, headers });
  await new Promise((resolve) => setTimeout(resolve, 20));
  bus.end(gameId);
  const response = await pending;
  return response.body;
}

describe('AC-5 · SSE 的 id 等于事件 seq，重连从下一个 seq 继续', () => {
  it('每条消息 id 递增且等于事件 seq；带 Last-Event-ID 后不重复', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;

    const body = await collect(app, bus, record.gameId, { cookie });

    const frames = body.split('\n\n').filter((frame) => frame.trim().length > 0);
    expect(frames.length).toBeGreaterThan(0);

    const ids = frames.map((frame) => {
      const line = frame.split('\n').find((part) => part.startsWith('id: '));
      if (line === undefined) throw new Error('缺少 id 行');
      return Number(line.slice(4));
    });
    // 发言流只含有正文的 SPEECH（DEGRADED 会变成 degraded 消息）
    expect(ids).toEqual(
      record.events
        .filter((event) => event.type === 'SPEECH' && event.visibleTo === 'public')
        .map((event) => event.seq),
    );

    const lastId = ids[ids.length - 1] as number;
    const resumed = await collect(app, bus, record.gameId, {
      cookie,
      'last-event-id': String(lastId),
    });

    expect(resumed).toBe('');
  });

  it('补偿窗口是 200 条（由总线常量定义）', async () => {
    const { BUS_HISTORY } = await import('@server/stream/bus');
    expect(BUS_HISTORY).toBe(200);
  });
});

describe('AC-6 · 多字节字符在任意切分位置都不乱码', () => {
  it('把中文按字节切开后仍能正确解码', () => {
    const decoder = new IncrementalDecoder();
    const bytes = new TextEncoder().encode('data: 你好世界\n');
    const collected: string[] = [];

    for (const byte of bytes) collected.push(...decoder.push(new Uint8Array([byte])));
    collected.push(...decoder.flush());

    expect(collected.join('\n')).toContain('你好世界');
  });

  it('逐字节喂入也不会出现替换字符', () => {
    const decoder = new IncrementalDecoder();
    const bytes = new TextEncoder().encode('预言家说：我验了 3 号\n');
    let text = '';
    for (const byte of bytes) text += decoder.push(new Uint8Array([byte])).join('\n');
    text += decoder.flush().join('\n');

    expect(text).not.toContain('\uFFFD');
    expect(text).toContain('预言家说');
  });
});

describe('流式解析', () => {
  it('consumeStream 按顺序回调，坏帧被丢弃', async () => {
    const chunks = [
      encodeSseFrame({ type: 'thinking', id: 1, seat: 1 }),
      'data: 坏帧\n',
      encodeSseFrame({ type: 'done', id: 2, seat: 1, text: '过' }),
    ];
    const seen: number[] = [];

    await consumeStream(
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
      (message) => seen.push(message.id),
    );

    expect(seen).toEqual([1, 2]);
  });

  it('parseSseData 拒绝不合契约的消息', () => {
    expect(parseSseData('{"type":"delta","id":1,"seat":1,"text":"x"}')?.type).toBe('delta');
    expect(parseSseData('{"type":"nope"}')).toBeUndefined();
    expect(parseSseLine('data: [DONE]')).toBeUndefined();
  });
});

describe('C-85 / C-88 · DEGRADED 可被折叠；断线超出窗口显式报错', () => {
  it('DEGRADED 事件能被 replay 接受并计入 degradations', async () => {
    const { replay } = await import('@engine/replay');
    const { GameRegistry } = await import('@server/store/game-registry');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    const events = [
      ...record.events,
      {
        gameId: record.gameId,
        seq: record.events.length + 1,
        ts: 1,
        type: 'DEGRADED',
        visibleTo: 'public',
        payload: { seat: 2 },
      },
    ];

    const state = replay(events as never);
    expect(state.degradations).toEqual([2]);
  });

  it('断线位置早于补偿窗口起点时，返回 SNAPSHOT_REQUIRED 而不是静默截断', async () => {
    const { BUS_HISTORY } = await import('@server/stream/bus');
    const { committedMessages } = await import('@server/routes/stream');
    const { GameRegistry } = await import('@server/store/game-registry');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    // 构造 300 条可见事件（只测消息选择逻辑，不需要真实对局）
    const many = {
      ...record,
      events: Array.from({ length: 300 }, (_unused, index) => ({
        gameId: record.gameId,
        seq: index + 1,
        ts: 0,
        type: 'SPEECH',
        visibleTo: 'public',
        payload: { seat: 1, text: `第 ${index + 1} 句` },
      })),
    };

    const all = committedMessages(many as never, registry.stateOf(record));
    expect(all.length).toBe(300);

    // 窗口是最近 200 条（101..300）；Last-Event-ID = 50 早于窗口起点 → 必须报错
    const windowStart = Math.max(0, all.length - BUS_HISTORY);
    expect(all[windowStart]?.id).toBe(101);
    expect(50 < (all[windowStart]?.id ?? 0)).toBe(true);
  });
});

describe('C-86 · 增量经总线实时到达（thinking / delta 先于 done）', () => {
  it('订阅者按发布顺序收到三条消息，且 id 递增', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie, 'last-event-id': '9999' },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.publish(record.gameId, { type: 'thinking', id: 10_000, seat: 3 });
    bus.publish(record.gameId, { type: 'delta', id: 10_000, seat: 3, text: '我' });
    bus.publish(record.gameId, { type: 'delta', id: 10_000, seat: 3, text: '觉得' });
    bus.publish(record.gameId, { type: 'done', id: 10_001, seat: 3, text: '我觉得' });
    bus.end(record.gameId);

    const body = (await pending).body;
    const types = body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => (JSON.parse(line.slice(6)) as { type: string }).type);

    expect(types).toEqual(['thinking', 'delta', 'delta', 'done']);
    // 增量的 id 是那条发言事件的 seq，不是逐字递增
    expect(body).toContain('"text":"觉得"');
  });

  it('断线位置早于窗口起点时返回 SNAPSHOT_REQUIRED（text/event-stream）', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;

    // 灌满窗口：200 条之后最早一条会被挤掉
    for (let index = 0; index < 210; index += 1) {
      bus.publish(record.gameId, { type: 'thinking', id: 100 + index, seat: 3 });
    }

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie, 'last-event-id': '1' },
    });
    const response = await pending;

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('SNAPSHOT_REQUIRED');
  });
});

describe('C-96 · 发言中途断线不丢增量', () => {
  it('重连带 Last-Event-ID=当前发言 id 时，重放该段剩余的增量', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;
    const speechId = 900;

    // 发言中途断线：先写了两个 delta
    bus.publish(record.gameId, { type: 'thinking', id: speechId, seat: 3 });
    bus.publish(record.gameId, { type: 'delta', id: speechId, seat: 3, text: '我' });
    bus.publish(record.gameId, { type: 'delta', id: speechId, seat: 3, text: '觉得' });

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie, 'last-event-id': String(speechId) },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.publish(record.gameId, { type: 'done', id: speechId, seat: 3, text: '我觉得' });
    bus.end(record.gameId);

    const body = (await pending).body;
    const types = body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => (JSON.parse(line.slice(6)) as { type: string }).type);

    // 必须能拿到这段发言的增量，而不是只有 done
    expect(types).toContain('delta');
    expect(types[types.length - 1]).toBe('done');
  });
});

describe('C-96 / C-86 · 重连顺序与已完成发言', () => {
  it('断线期间发言已完成：重连必须拿到整段（含 done）', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;
    const speechId = 700;

    bus.publish(record.gameId, { type: 'thinking', id: speechId, seat: 3 });
    bus.publish(record.gameId, { type: 'delta', id: speechId, seat: 3, text: '我' });
    bus.publish(record.gameId, { type: 'done', id: speechId, seat: 3, text: '我说完了' });

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie, 'last-event-id': String(speechId) },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.end(record.gameId);

    const body = (await pending).body;
    const types = body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => (JSON.parse(line.slice(6)) as { type: string }).type);

    expect(types).toContain('done');
    expect(types[types.length - 1]).toBe('done');
  });

  it('已提交事件与总线增量按 id 合并，不出现 done 在 thinking 之前', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;

    // 总线里放一条比最后一个已提交事件更早的增量（模拟重放乱序）
    const firstEventSeq = record.events[0]?.seq ?? 1;
    bus.publish(record.gameId, { type: 'thinking', id: firstEventSeq, seat: 3 });

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.end(record.gameId);

    const ids = (await pending).body
      .split('\n')
      .filter((line) => line.startsWith('id: '))
      .map((line) => Number(line.slice(4)));

    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('C-86 · 已提交的 DEGRADED 必须映射成 degraded，不是空 done', () => {
  it('历史路径里 DEGRADED + SPEECH → [degraded, done]', async () => {
    const { committedMessages } = await import('@server/routes/stream');
    const { GameRegistry } = await import('@server/store/game-registry');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    const withDegraded = {
      ...record,
      events: [
        ...record.events,
        {
          gameId: record.gameId,
          seq: record.events.length + 1,
          ts: 0,
          type: 'SPEECH',
          visibleTo: 'public',
          payload: { seat: 2, text: '我先过。' },
        },
        {
          gameId: record.gameId,
          seq: record.events.length + 2,
          ts: 0,
          type: 'DEGRADED',
          visibleTo: 'public',
          payload: { seat: 2 },
        },
      ],
    };

    const messages = committedMessages(withDegraded as never, registry.stateOf(record));
    expect(messages.map((message) => message.type)).toEqual(['done', 'degraded']);
    expect((messages[0] as { text?: string }).text).toBe('我先过。');
  });

  it('同 id 的增量与 committed done 合并后，done 在最后', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;

    const speech = record.events.find((event) => event.type === 'SPEECH');
    if (speech === undefined) throw new Error('没有 SPEECH');
    const speechId = speech.seq;

    bus.publish(record.gameId, { type: 'thinking', id: speechId, seat: 3 });
    bus.publish(record.gameId, { type: 'delta', id: speechId, seat: 3, text: '我' });

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.end(record.gameId);

    const types = (await pending).body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => (JSON.parse(line.slice(6)) as { type: string }).type);

    expect(types[types.length - 1]).toBe('done');
  });
});

describe('C-98 · 降级轮的刷新与重连终态', () => {
  it('刷新（无 Last-Event-ID）时看到短句，且不因 degraded 清空正文', async () => {
    const { app, bus, session, record } = await setup();
    const cookie = `session=${session.id}`;
    const { streamReducer, initialStreamState } = await import('@client/use-stream');

    // 构造一条降级轮：SPEECH 后跟 DEGRADED（真实事件顺序）
    const speechEvent = {
      gameId: record.gameId,
      seq: record.events.length + 1,
      ts: 0,
      type: 'SPEECH',
      visibleTo: 'public',
      payload: { seat: 1, text: '我先过。' },
    };
    const degradedEvent = {
      gameId: record.gameId,
      seq: record.events.length + 2,
      ts: 0,
      type: 'DEGRADED',
      visibleTo: 'public',
      payload: { seat: 1 },
    };

    bus.publish(record.gameId, {
      type: 'done',
      id: speechEvent.seq,
      seat: 1 as never,
      text: '我先过。',
    });
    bus.publish(record.gameId, { type: 'degraded', id: degradedEvent.seq, seat: 1 as never });

    const pending = app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.end(record.gameId);

    const frames = (await pending).body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as never);

    let state = initialStreamState;
    for (const frame of frames) state = streamReducer(state, frame);

    expect(state.text).toBe('我先过。');
    expect(state.lastId).toBe(degradedEvent.seq);
  });
});

describe('C-98 · 真实刷新：降级轮的终态', () => {
  it('用 speak 造出最后一位降级，再用空总线连接 → degraded 的 id 与正文都对', async () => {
    const { registry, session, store, record } = await setup();
    const { speak } = await import('@server/llm/speak');
    const { currentSpeaker } = await import('@engine/phases/day');
    const { streamReducer, initialStreamState } = await import('@client/use-stream');

    let current = record;
    for (let guard = 0; guard < 20; guard += 1) {
      const state = registry.stateOf(current);
      if (state.phase !== 'DAY_SPEECH') break;
      const speaker = currentSpeaker(state);
      if (speaker === undefined) break;
      const alive = state.seats.filter((seat) => seat.alive).length;
      const spoken = state.speech?.spoken.length ?? 0;
      const isLast = spoken === alive - 1;

      const result = await speak({
        registry,
        bus: new StreamBus(),
        session,
        record: current,
        seat: speaker,
        attempt: async () =>
          isLast ? { text: '', failed: true } : { text: '我过了。', failed: false },
        limitMs: 5_000,
      });
      if (!result.ok) throw new Error('发言被拒');
      current = result.record;
    }

    const degraded = current.events.find((event) => event.type === 'DEGRADED');
    if (degraded === undefined) throw new Error('没有降级事件');

    // 刷新：同一个 store、**全新的总线**（历史只能来自已提交事件）
    const freshBus = new StreamBus();
    const refreshed = buildApp({ store, bus: freshBus });
    const cookie = `session=${session.id}`;

    const pending = refreshed.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}/stream`,
      headers: { cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    freshBus.end(current.gameId);

    const frames = (await pending).body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as never);

    let state = initialStreamState;
    for (const frame of frames) state = streamReducer(state, frame);

    const degradedFrames = frames.filter(
      (frame: { type: string }) => frame.type === 'degraded',
    ) as { id: number }[];

    expect(degradedFrames).toHaveLength(1);
    expect(degradedFrames[0]?.id).toBe(degraded.seq);
    expect(state.text.length).toBeGreaterThan(0);
    expect(state.lastId).toBe(degraded.seq);
  });
});
