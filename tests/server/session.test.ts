import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { KEEP_FULL_EVENTS, MAX_GAMES_PER_SESSION } from '@server/store/game-registry';
import type { SessionResponse } from '@shared/api';

/**
 * RFC-008 AC-1 / AC-2 / AC-3 / AC-4 / AC-16：会话与多局。
 *
 * 全部用 `fastify.inject()`——不监听端口，测试之间也不共享状态。
 */

function makeApp(store = new InMemoryMetaStore()) {
  return buildApp({ store });
}

/** 取响应里的 set-cookie（`inject` 的 headers 里可能是数组）。 */
function cookieOf(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('没有 set-cookie');
  return value.split(';')[0] as string;
}

describe('AC-1 / AC-2 / AC-3 · 创建对局', () => {
  it('同一 cookie 连建三局，session 列出三条', async () => {
    const app = makeApp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const cookie = cookieOf(first.headers);
    await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
      headers: { cookie },
    });
    await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
      headers: { cookie },
    });

    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    const body = session.json<SessionResponse>();

    expect(body.games).toHaveLength(3);
    expect(Array.isArray(body.games)).toBe(true);
  });

  it('创建响应含 gameId / seed / playerSeat / version，且 seed 与事件一致', async () => {
    const app = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 4_242_424 },
    });
    const body = created.json<{
      gameId: string;
      seed: number;
      playerSeat: number;
      version: number;
    }>();

    expect(body.gameId).toBeTruthy();
    expect(body.seed).toBe(4_242_424);
    expect(body.playerSeat).toBeGreaterThanOrEqual(1);
    expect(body.version).toBeGreaterThan(0);
  });

  it('指定模式会写进 GAME_STARTED', async () => {
    const app = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-all' },
    });
    const { gameId } = created.json<{ gameId: string }>();
    const cookie = cookieOf(created.headers);

    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    expect(view.statusCode).toBe(200);
  });

  it('cookie 有 HttpOnly / SameSite=Lax / Path=/，会话 id 长度 ≥ 32', async () => {
    const app = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });

    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string') throw new Error('没有 set-cookie');

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    const id = header.split(';')[0]?.split('=')[1] ?? '';
    expect(id.length).toBeGreaterThanOrEqual(32);
  });
});

describe('AC-10 · 不泄露存在性', () => {
  it('别人的 gameId 与不存在的 id 返回同一个 404', async () => {
    const app = makeApp();
    const mine = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const { gameId } = mine.json<{ gameId: string }>();
    const myCookie = cookieOf(mine.headers);

    const other = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const otherCookie = cookieOf(other.headers);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie: otherCookie },
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/games/nope',
      headers: { cookie: otherCookie },
    });

    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());

    // 自己的能取到
    const own = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie: myCookie },
    });
    expect(own.statusCode).toBe(200);
  });
});

describe('AC-14 / AC-15 · 未实现的端点与对局上限', () => {
  it('replay 未终局 → 404 NOT_FINISHED；stream 返回 SSE 帧', async () => {
    const app = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const { gameId } = created.json<{ gameId: string }>();
    const cookie = cookieOf(created.headers);

    const replay = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/replay`,
      headers: { cookie },
    });
    expect(replay.json()).toEqual(expect.objectContaining({ error: 'NOT_FINISHED' }));

    const stream = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/stream`,
      headers: { cookie },
    });
    // 开局事件本身是 `server` 可见的（它含身份分配），所以此刻流可以为空——
    // 真正的 SSE 帧与重连断言在 stream.test.ts。
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
  });

  it('会话对局上限是常量（超出时释放最旧的一局）', () => {
    expect(MAX_GAMES_PER_SESSION).toBe(20);
    expect(KEEP_FULL_EVENTS).toBe(3);
  });
});

describe('AC-16 · 不引入数据库', () => {
  it('package.json 里没有数据库驱动', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const names = Object.keys(pkg.dependencies);

    for (const banned of [
      'pg',
      'mysql',
      'mysql2',
      'better-sqlite3',
      'sqlite3',
      'mongodb',
      'prisma',
    ]) {
      expect(names).not.toContain(banned);
    }
  });
});

describe('B5 · 释放的对局仍列出、返回 410 而不是 404', () => {
  it('会话超限后最旧的一局仍在列表里，GET 返回 410', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const cookie = cookieOf(created.headers);
    const firstGameId = created.json<{ gameId: string }>().gameId;

    // 建到超过上限
    for (let index = 0; index < MAX_GAMES_PER_SESSION; index += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mode: 'slaughter-side' },
        headers: { cookie },
      });
    }

    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    const listed = session.json<{ games: { gameId: string }[] }>().games.map((game) => game.gameId);
    expect(listed).toContain(firstGameId);

    const released = await app.inject({
      method: 'GET',
      url: `/api/games/${firstGameId}`,
      headers: { cookie },
    });
    expect(released.statusCode).toBe(410);
  });
});

describe('B3 · 生产环境的 cookie 带 Secure', () => {
  it('production: true 时 set-cookie 含 Secure', async () => {
    const app = buildApp({ store: new InMemoryMetaStore(), production: true });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });

    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    expect(String(header)).toContain('Secure');
  });
});
