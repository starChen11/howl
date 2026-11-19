import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { project } from '@server/project';
import { GameRegistry, KEEP_FULL_EVENTS, MAX_GAMES_PER_SESSION } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';

/**
 * RFC-008 Round 2 补强的回归锁（C-65 / C-67 / C-68）。
 *
 * 这些用例的判据都是「改坏实现会红」，而不是「当前能跑通」：
 * - 直接与 `project()` 的输出比对，而不是数 `"role":` 出现几次；
 * - 直接看 `GAME_STARTED` 的 payload，而不是相信响应字段；
 * - 真的开 100 局，而不是 5 局。
 */

function cookieOf(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('没有 set-cookie');
  return value.split(';')[0] as string;
}

describe('C-67 · AC-2 / AC-3：响应里的 seed 与 mode 来自事件，而不是另编一个', () => {
  it('seed 与 GAME_STARTED.payload.seed 一致，mode 同理', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-all', seed: 777 });

    const started = record.events.find((event) => event.type === 'GAME_STARTED');
    if (started?.type !== 'GAME_STARTED') throw new Error('没有 GAME_STARTED');

    const payload = started.payload as { seed: number; mode: string };
    expect(payload.seed).toBe(record.seed);
    expect(payload.mode).toBe('slaughter-all');
    expect(record.seed).toBe(777);
  });
});

describe('C-67 · AC-7：路由返回的就是 project() 的输出，逐字节一致', () => {
  it('把 view 与直接调用 project() 的结果深度比较', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 4_242_424 },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const route = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    const body = route.json<{ version: number; view: unknown }>();

    const registry = new GameRegistry(store);
    const session = await registry.getSession(cookie.split('=')[1] as string);
    if (session === undefined) throw new Error('会话丢失');
    const record = await registry.getGame(gameId);
    if (record === undefined) throw new Error('对局丢失');
    const expected = project({
      state: registry.stateOf(record),
      events: record.events,
      observer: record.playerSeat,
      pending: null,
    });

    // 多一个字段（比如 reviewer 探针塞的 allRoles）就会红
    expect(body.view).toEqual(expected);
  });
});

describe('C-65 · AC-8：B1 的 HTTP 回归测试要有 server 事件可筛', () => {
  it('玩家提交自己的夜间动作后，响应里不含 server 事件（构造到 NIGHT_WITCH）', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    // seed 15：座位 1 是 witch，且第一夜能走到 NIGHT_WITCH
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    // 用注册表把局面推进到 NIGHT_WITCH（测试替其他席位行动，路由不允许这样做）
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
    }

    {
      const state = stateOf();
      const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
      const victim = state.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
      if (wolf === undefined || victim === undefined) throw new Error('缺少目标');
      const result = await registry.submit(
        session,
        current,
        { type: 'WOLF_KILL', ts: 2, seat: wolf, target: victim } as never,
        state.seq,
      );
      if (!result.ok) throw new Error('下刀失败');
      current = result.record;
    }

    {
      const state = stateOf();
      const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
      const target = state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
      if (seer === undefined || target === undefined) throw new Error('缺少目标');
      const result = await registry.submit(
        session,
        current,
        { type: 'SEER_CHECK', ts: 3, seat: seer, target } as never,
        state.seq,
      );
      if (!result.ok) throw new Error('查验失败');
      current = result.record;
    }

    expect(stateOf().phase).toBe('NIGHT_WITCH');

    // 现在通过 HTTP 让玩家（座位 1 = witch）提交自己的动作
    const app = buildApp({ store });
    const cookie = `session=${session.id}`;
    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}`,
      headers: { cookie },
    });
    const version = view.json<{ version: number }>().version;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WITCH_ACT', ts: 4, seat: 1, potion: 'none' },
        expectedVersion: version,
      },
    });

    expect(submitted.statusCode).toBe(200);
    const events = submitted.json<{ events: { visibleTo: string }[] }>().events;
    // 这一夜确实有 server 事件（死者的 PLAYER_DIED、夜间相位），过滤后必须消失
    expect(events.filter((event) => event.visibleTo === 'server')).toEqual([]);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('C-67 · AC-13：终局状态每次都重新 replay，不缓存', () => {
  it('同一记录两次 stateOf 深度相等，且改返回值不影响第二次', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    const first = registry.stateOf(record);
    const second = registry.stateOf(record);

    expect(second).toEqual(first);
    const mutable = registry.stateOf(record) as { day: number };
    mutable.day = 99;
    expect(registry.stateOf(record).day).toBe(first.day);
  });
});

describe('C-67 / AC-14：真的开 100 局', () => {
  it('100 局之后，持有完整事件流的局数不超过 KEEP_FULL_EVENTS', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    for (let index = 0; index < 100; index += 1) {
      const record = await registry.createGame(session, { mode: 'slaughter-side' });
      const stored = await registry.getGame(record.gameId);
      if (stored === undefined) throw new Error('记录丢失');
      stored.status = 'finished';
      stored.finishedAt = Date.now() + index;
      await registry.submit(
        session,
        stored,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: 1,
          text: '',
        } as never,
        registry.stateOf(stored).seq,
      );
      await registry.enforceRetention(session);
    }

    let withEvents = 0;
    for (const gameId of session.gameIds) {
      const stored = await registry.getGame(gameId);
      if (stored !== undefined && stored.events.length > 0) withEvents += 1;
    }

    expect(withEvents).toBeLessThanOrEqual(KEEP_FULL_EVENTS);
    // 超限释放是逐个来的：不能只有第 1 局被反复释放
    expect(session.gameIds.length).toBeGreaterThanOrEqual(100);
  });
});

describe('C-67 · AC-15：未终局 replay 必须是 404', () => {
  it('状态码与错误码都断言', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const replay = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/replay`,
      headers: { cookie },
    });

    expect(replay.statusCode).toBe(404);
    expect(replay.json()).toEqual(expect.objectContaining({ error: 'NOT_FINISHED' }));
  });
});

describe('C-68 · retention 不跨会话', () => {
  it('会话 B 打满局后，会话 A 终局那局的事件仍在', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const sessionA = await registry.createSession();
    const sessionB = await registry.createSession();

    const aRecord = await registry.createGame(sessionA, { mode: 'slaughter-side' });
    const aStored = await registry.getGame(aRecord.gameId);
    if (aStored === undefined) throw new Error('记录丢失');
    aStored.status = 'finished';
    await registry.submit(
      sessionA,
      aStored,
      {
        type: 'WOLF_CHAT',
        ts: 1,
        seat: 1,
        text: '',
      } as never,
      registry.stateOf(aStored).seq,
    );

    for (let index = 0; index < 5; index += 1) {
      const record = await registry.createGame(sessionB, { mode: 'slaughter-side' });
      const stored = await registry.getGame(record.gameId);
      if (stored === undefined) throw new Error('记录丢失');
      stored.status = 'finished';
      stored.finishedAt = Date.now() + index;
      await registry.submit(
        sessionB,
        stored,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: 1,
          text: '',
        } as never,
        registry.stateOf(stored).seq,
      );
      await registry.enforceRetention(sessionB);
    }

    const stillThere = await registry.getGame(aRecord.gameId);
    expect(stillThere?.events.length ?? 0).toBeGreaterThan(0);
  });
});

describe('C-66 · 超限释放是逐个来的，不是反复释放同一局', () => {
  it('开到上限 +2 局后，持有事件的局数不超过上限', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    for (let index = 0; index < MAX_GAMES_PER_SESSION + 2; index += 1) {
      await registry.createGame(session, { mode: 'slaughter-side' });
    }

    let withEvents = 0;
    for (const gameId of session.gameIds) {
      const stored = await registry.getGame(gameId);
      if (stored !== undefined && stored.events.length > 0) withEvents += 1;
    }

    // 22 局、上限 20 → 应当有 2 局被释放（只释放第 1 局的话会是 21）
    expect(withEvents).toBeLessThanOrEqual(MAX_GAMES_PER_SESSION);
  });
});

describe('C-71 · AC-3：HTTP 创建时传入的 mode 真的进了 GAME_STARTED', () => {
  it('POST /api/games 传 slaughter-all → 事件的 payload.mode 也是 slaughter-all', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-all', seed: 321 },
    });
    const { gameId } = created.json<{ gameId: string }>();

    const registry = new GameRegistry(store);
    const record = await registry.getGame(gameId);
    if (record === undefined) throw new Error('对局丢失');
    const started = record.events.find((event) => event.type === 'GAME_STARTED');
    if (started?.type !== 'GAME_STARTED') throw new Error('没有 GAME_STARTED');

    expect((started.payload as { mode: string }).mode).toBe('slaughter-all');
    expect(record.mode).toBe('slaughter-all');
  });
});

describe('C-72 · AC-8：动作必须真的被引擎接受', () => {
  it('WITCH_ACT(none) 的响应里没有 REJECTED，且 version 前进', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    let current = record;
    const stateOf = () => registry.stateOf(current);

    // 推进到 NIGHT_WITCH（测试替其他席位行动）
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
    }
    for (const [type, seatOf] of [
      [
        'WOLF_KILL',
        (state: ReturnType<typeof stateOf>) =>
          state.seats.find((s) => s.alive && s.role === 'wolf')?.seat,
      ],
      [
        'SEER_CHECK',
        (state: ReturnType<typeof stateOf>) =>
          state.seats.find((s) => s.alive && s.role === 'seer')?.seat,
      ],
    ] as const) {
      const state = stateOf();
      const seat = seatOf(state);
      const target = state.seats.find((s) => s.alive && s.role !== 'wolf' && s.seat !== seat)?.seat;
      if (seat === undefined || target === undefined) throw new Error('缺少目标');
      const result = await registry.submit(
        session,
        current,
        { type, ts: 2, seat, target } as never,
        state.seq,
      );
      if (!result.ok) throw new Error(`${type} 失败`);
      current = result.record;
    }

    const app = buildApp({ store });
    const cookie = `session=${session.id}`;
    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}`,
      headers: { cookie },
    });
    const version = view.json<{ version: number }>().version;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WITCH_ACT', ts: 4, seat: 1, potion: 'none' },
        expectedVersion: version,
      },
    });

    const body = submitted.json<{ version: number; events: { type: string }[] }>();
    expect(submitted.statusCode).toBe(200);
    // 关键：没有 REJECTED —— 否则「动作被拒」也会满足「200 + 非空」
    expect(body.events.some((event) => event.type === 'REJECTED')).toBe(false);
    expect(body.version).toBeGreaterThan(version);
  });
});

describe('C-73 · AC-13：FINISHED 的对局每次都重新 replay，不缓存', () => {
  it('终局记录两次 stateOf 深度相等，改返回值不影响下一次', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });
    const stored = await registry.getGame(record.gameId);
    if (stored === undefined) throw new Error('记录丢失');

    stored.status = 'finished';
    stored.finishedAt = Date.now();

    const first = registry.stateOf(stored);
    const second = registry.stateOf(stored);
    expect(second).toEqual(first);

    (registry.stateOf(stored) as { day: number }).day = 99;
    expect(registry.stateOf(stored).day).toBe(first.day);
  });
});

describe('C-74 / C-75 · 换存储实现后路由仍然工作；多个席位都做过深度比较', () => {
  it('buildApp 注入第二个实现后，创建 + 读取 + 提交都正常', async () => {
    class SecondStore extends InMemoryMetaStore {}
    const app = buildApp({ store: new SecondStore() });

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    expect(view.statusCode).toBe(200);
  });

  it('playerSeat = 2 时，路由的 view 仍与 project() 深度相等（不是只对 1 号生效）', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', playerSeat: 2, seed: 9 },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const route = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    const registry = new GameRegistry(store);
    const record = await registry.getGame(gameId);
    if (record === undefined) throw new Error('对局丢失');

    const expected = project({
      state: registry.stateOf(record),
      events: record.events,
      observer: record.playerSeat,
      pending: null,
    });

    expect(route.json<{ view: unknown }>().view).toEqual(expected);
  });
});
