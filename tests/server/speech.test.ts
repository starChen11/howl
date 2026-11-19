import { describe, expect, it } from 'vitest';

import { SPEECH_MAX_CHARS, charCount, isWithinLimit, normalizeInput } from '@server/speech';

/**
 * RFC-011 §5 AC-5 / 7：字数与弃权。前端限制与后端校验共用同一组纯函数（SEC-4）。
 */

describe('AC-5 · Unicode 计数', () => {
  it('中文按字算，emoji 算一个', () => {
    expect(charCount('狼人杀')).toBe(3);
    expect(charCount('😀😀')).toBe(2);
  });

  it('刚好 300 可以，301 不行', () => {
    expect(isWithinLimit('字'.repeat(SPEECH_MAX_CHARS))).toBe(true);
    expect(isWithinLimit('字'.repeat(SPEECH_MAX_CHARS + 1))).toBe(false);
  });
});

describe('AC-7 · 弃权', () => {
  it('纯空白算弃权', () => {
    expect(normalizeInput({ text: ' \n\t ', timedOut: false }).kind).toBe('skip');
  });

  it('有内容的超时不算弃权', () => {
    expect(normalizeInput({ text: '我还没说完', timedOut: true }).kind).toBe('timeout');
  });
});

describe('AC-5 / AC-6 的后端保障', () => {
  it('后端拒绝超过 300 字的发言（不是只在提示词里截断）', async () => {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

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
        action: { type: 'SPEECH', ts: 1, seat: 1, text: '字'.repeat(301) },
        expectedVersion: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'VALIDATION_FAILED' }));
  });

  it('超时提交已输入的草稿', async () => {
    const { HttpInputChannel } = await import('@server/channels/http');
    const channel = new HttpInputChannel({ timeoutMs: 20 });
    const pending = channel.read({ seat: 1 as never, timeoutMs: 20, kind: 'speech' });

    channel.setDraft('我说到一半');
    expect(await pending).toEqual({ kind: 'timeout', text: '我说到一半' });
  });
});

describe('C-111 · 服务端的剩余秒数端点', () => {
  it('GET /timer 返回剩余秒数与起点', async () => {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');
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
      method: 'GET',
      url: `/api/games/${gameId}/timer`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ remainingSeconds: number; phase: string }>();
    expect(body.remainingSeconds).toBeGreaterThanOrEqual(0);
    expect(body.phase.length).toBeGreaterThan(0);
  });
});

describe('C-111 · timer 用事件流起点，不是常量', () => {
  it('一条很旧的发言会让剩余秒数为 0（常量实现会返回 60）', async () => {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');
    const { GameRegistry } = await import('@server/store/game-registry');
    const { project } = await import('@server/project');

    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();

    // 找一局已经到白天的记录（用注册表推进），再把它的一条 SPEECH 改成 120 秒前
    const record0 = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });
    void project;
    let current = record0;
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

    // 把最后一条发言事件的 ts 改成 120 秒前，再放回存储
    const events = current.events.map((event) =>
      event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED'
        ? { ...event, ts: Date.now() - 120_000 }
        : event,
    );
    await store.set(`game:${current.gameId}`, { ...current, events });

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}/timer`,
      headers: { cookie: `session=${session.id}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ remainingSeconds: number }>().remainingSeconds).toBe(0);
  });
});

describe('C-111 · timer 的三种起点', () => {
  async function timerFor(
    eventsMutator: (
      events: import('@shared/events').EventEnvelope[],
    ) => import('@shared/events').EventEnvelope[],
  ) {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');
    const { GameRegistry } = await import('@server/store/game-registry');

    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    const events = eventsMutator(record.events);
    await store.set(`game:${record.gameId}`, { ...record, events });

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/timer`,
      headers: { cookie: `session=${session.id}` },
    });
    return { res, record };
  }

  function speechAt(ts: number) {
    return (events: import('@shared/events').EventEnvelope[]) => [
      ...events,
      {
        gameId: events[0]?.gameId ?? 'g',
        seq: events.length + 1,
        ts,
        type: 'SPEECH',
        visibleTo: 'public',
        payload: { seat: 1, text: '一句发言' },
      } as import('@shared/events').EventEnvelope,
    ];
  }

  it('刚刚的发言 → 接近 60 秒', async () => {
    const { res } = await timerFor(speechAt(Date.now()));
    const body = res.json<{ remainingSeconds: number }>();
    expect(body.remainingSeconds).toBeGreaterThan(50);
    expect(body.remainingSeconds).toBeLessThanOrEqual(60);
  });

  it('120 秒前的发言 → 0（常量实现会返回 60）', async () => {
    const { res } = await timerFor(speechAt(Date.now() - 120_000));
    expect(res.json<{ remainingSeconds: number }>().remainingSeconds).toBe(0);
  });

  it('SPEECH_SKIPPED 也算新一轮的起点', async () => {
    const skipped = (events: import('@shared/events').EventEnvelope[]) => [
      ...events,
      {
        gameId: events[0]?.gameId ?? 'g',
        seq: events.length + 1,
        ts: Date.now(),
        type: 'SPEECH_SKIPPED',
        visibleTo: 'public',
        payload: { seat: 1 },
      } as import('@shared/events').EventEnvelope,
    ];
    const { res } = await timerFor(skipped);
    expect(res.json<{ remainingSeconds: number }>().remainingSeconds).toBeGreaterThan(50);
  });

  it('已释放（无事件）→ 410', async () => {
    const { res } = await timerFor(() => []);
    expect(res.statusCode).toBe(410);
  });
});

describe('B-R8-2 · timer 的 DAY_STARTED 起点与递减', () => {
  async function timerTwice(
    eventsMutator: (
      events: import('@shared/events').EventEnvelope[],
    ) => import('@shared/events').EventEnvelope[],
  ) {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');
    const { GameRegistry } = await import('@server/store/game-registry');

    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });
    await store.set(`game:${record.gameId}`, { ...record, events: eventsMutator(record.events) });

    const read = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/games/${record.gameId}/timer`,
          headers: { cookie: `session=${session.id}` },
        })
      ).json<{ remainingSeconds: number }>().remainingSeconds;

    const first = await read();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await read();
    return { first, second };
  }

  it('只有 DAY_STARTED 且刚发生 → 60 秒', async () => {
    const { first } = await timerTwice((events) => [
      ...events,
      {
        gameId: events[0]?.gameId ?? 'g',
        seq: events.length + 1,
        ts: Date.now(),
        type: 'DAY_STARTED',
        visibleTo: 'public',
        payload: { day: 1, diedLastNight: [], speechStartSeat: 1 },
      } as import('@shared/events').EventEnvelope,
    ]);

    expect(first).toBe(60);
  });

  it('两次读取之间剩余秒数递减（不是常量）', async () => {
    const { first, second } = await timerTwice((events) => [
      ...events,
      {
        gameId: events[0]?.gameId ?? 'g',
        seq: events.length + 1,
        ts: Date.now(),
        type: 'DAY_STARTED',
        visibleTo: 'public',
        payload: { day: 1, diedLastNight: [], speechStartSeat: 1 },
      } as import('@shared/events').EventEnvelope,
    ]);

    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThanOrEqual(0);
  });
});

describe('C-120 · 草稿全链路：POST /input → 通道 → 超时提交', () => {
  it('草稿经路由写入通道，超时后以 timeout 交回', async () => {
    const { buildApp } = await import('@server/app');
    const { ChannelRegistry } = await import('@server/channels/session');
    const { StreamBus } = await import('@server/stream/bus');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

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

    // 先挂起（新一轮会清空旧草稿），再在等待期间同步草稿——这才真实链路。
    const pending = channels
      .forGame(gameId)
      .input.read({ seat: 1 as never, timeoutMs: 60, kind: 'speech' });

    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/input`,
      headers: { cookie },
      payload: { text: '我怀疑 2 号。' },
    });

    expect(await pending).toEqual({ kind: 'timeout', text: '我怀疑 2 号。' });
  });
});
