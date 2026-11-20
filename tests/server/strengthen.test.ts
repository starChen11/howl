import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import { buildApp } from '@server/app';
import { project } from '@server/project';
import { nextActor, pendingForPhase } from '@server/orchestrator';
import { GameRegistry, KEEP_FULL_EVENTS } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';

/**
 * RFC-008 Round 2 补强的回归锁：事件来源、投影一致性、retention（C-67 / C-68）。
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
    const expectedState = registry.stateOf(record);
    const expected = project({
      state: expectedState,
      events: record.events,
      observer: record.playerSeat,
      pending:
        nextActor(expectedState) === record.playerSeat
          ? pendingForPhase(expectedState.phase)
          : null,
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

describe('C-67 · 状态重建：两次 stateOf 结果一致（真正的 FINISHED 用例在 finished-game.test.ts）', () => {
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

describe('C-133 · 夜间默认 pending 只给当前行动者', () => {
  it('旁观者的 GET 不带 pending，也不会有 legalTargets', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();

    // 玩家坐 1 号（不保证是神职），推进到夜间的某个行动相位
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: 1,
    });
    let current = record;
    const stateOf = () => registry.stateOf(current);
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const wolf = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((e) => e.seat === seat.seat),
      )?.seat;
      if (wolf === undefined) break;
      const r = await registry.submit(
        session,
        current,
        { type: 'WOLF_CHAT', ts: 1, seat: wolf, text: '' } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }

    const app = buildApp({ store, bus: new StreamBus() });
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}`,
      headers: { cookie: `session=${session.id}` },
    });

    const body = res.json<{ view: ProjectedContext }>();
    // 夜间相位被折叠成 'NIGHT'（RFC-007 C-28）；旁观者不该拿到 pending，
    // 也就没有 legalTargets（C-133）。
    expect(body.view.phase).toBe('NIGHT');
    expect(body.view.pending).toBeNull();
    expect(body.view.legalTargets).toEqual([]);
  });
});

describe('C-127 · 重投的合法目标只有并列者', () => {
  it('RUNOFF 的 legalTargets 不含非并列者，也不含弃权', async () => {
    const { legalTargetsOf } = await import('@server/project/targets');

    const state = {
      phase: 'DAY_VOTE_RUNOFF',
      seats: [
        { seat: 1, alive: true, role: 'villager' },
        { seat: 2, alive: true, role: 'villager' },
        { seat: 3, alive: true, role: 'villager' },
        { seat: 4, alive: true, role: 'villager' },
      ],
      runoff: [2, 3],
    } as never;

    // 4 号活着但不在 runoff 里：回退成 `[...alive]` 会把 4 号列进来（M-R5-6）
    const targets = legalTargetsOf(state, 'vote', [1, 2, 3, 4] as never, 1 as never);
    expect(targets).toEqual([2, 3]);
    expect(targets).not.toContain('abstain');
  });
});

describe('RUL-13 · 旧 WOLF_KILL 走路由会被拒绝', () => {
  it('任何存活狼直接下刀都返回 LEGACY_ACTION_DISABLED', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 3, playerSeat: 1 },
    });
    const raw = created.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WOLF_KILL', ts: 0, seat: 1, target: 2 },
        expectedVersion: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'LEGACY_ACTION_DISABLED' }));
  });
});
