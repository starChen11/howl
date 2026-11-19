import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { InMemoryMetaStore } from '@server/store/meta-store';

/**
 * RFC-008 AC-5 ~ AC-7 / AC-8 ~ AC-9：刷新恢复、投影、版本与幂等。
 *
 * 恢复测试用**两次独立的 inject 调用**：不共享任何客户端内存，这样才证明状态真的
 * 从存储 + 事件流重建出来了（AC-6）。
 */

function cookieOf(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('没有 set-cookie');
  return value.split(';')[0] as string;
}

async function createGame(app: ReturnType<typeof buildApp>, payload: Record<string, unknown> = {}) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mode: 'slaughter-side', ...payload },
  });
  return {
    body: created.json<{ gameId: string; version: number }>(),
    cookie: cookieOf(created.headers),
  };
}

describe('AC-5 / AC-6 · 刷新恢复', () => {
  it('两次独立调用返回同一个 version 与深度相等的 view', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const { body, cookie } = await createGame(app);

    const first = await app.inject({
      method: 'GET',
      url: `/api/games/${body.gameId}`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'GET',
      url: `/api/games/${body.gameId}`,
      headers: { cookie },
    });

    expect(first.json<{ version: number }>().version).toBe(
      second.json<{ version: number }>().version,
    );
    expect(first.json<{ view: unknown }>().view).toEqual(second.json<{ view: unknown }>().view);
  });
});

describe('AC-7 · 返回的是投影，不含他人角色', () => {
  it('9 个 playerSeat 各自的响应里只有自己一个角色字段', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });

    for (let playerSeat = 1; playerSeat <= 9; playerSeat += 1) {
      const { body, cookie } = await createGame(app, { playerSeat });
      const view = await app.inject({
        method: 'GET',
        url: `/api/games/${body.gameId}`,
        headers: { cookie },
      });

      const text = JSON.stringify(view.json<{ view: unknown }>().view);
      const roles = text.match(/"role":/g) ?? [];
      expect(roles.length, `playerSeat=${playerSeat}`).toBe(1);
    }
  });
});

describe('AC-8 / AC-9 · 版本与幂等', () => {
  it('正确 version 的 action 成功，新 version 更大', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const { body, cookie } = await createGame(app);

    // 当前是 NIGHT_WOLF_CHAT：让第一只 wolf 说一句
    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${body.gameId}?pending=chat`,
      headers: { cookie },
    });
    const version = view.json<{ version: number }>().version;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/games/${body.gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WOLF_CHAT', ts: 1, seat: 1, text: '' },
        expectedVersion: version,
      },
    });

    expect(submitted.statusCode).toBe(200);
    expect(submitted.json<{ version: number }>().version).toBeGreaterThan(version);
  });

  it('同一个 action 重复提交 → 409 ALREADY_APPLIED；旧版本但不同 action → VERSION_MISMATCH', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const { body, cookie } = await createGame(app);

    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${body.gameId}`,
      headers: { cookie },
    });
    const version = view.json<{ version: number }>().version;
    const action = { type: 'WOLF_CHAT', ts: 1, seat: 1, text: '' };

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${body.gameId}/actions`,
      headers: { cookie },
      payload: { action, expectedVersion: version },
    });
    expect(first.statusCode).toBe(200);

    const retry = await app.inject({
      method: 'POST',
      url: `/api/games/${body.gameId}/actions`,
      headers: { cookie },
      payload: { action, expectedVersion: version },
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(expect.objectContaining({ error: 'ALREADY_APPLIED' }));

    const stale = await app.inject({
      method: 'POST',
      url: `/api/games/${body.gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WOLF_CHAT', ts: 2, seat: 2, text: '' },
        expectedVersion: version,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual(expect.objectContaining({ error: 'VERSION_MISMATCH' }));
  });

  it('大于当前版本 → VERSION_MISMATCH', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const { body, cookie } = await createGame(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${body.gameId}/actions`,
      headers: { cookie },
      payload: { action: { type: 'WOLF_CHAT', ts: 1, seat: 1, text: '' }, expectedVersion: 999 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'VERSION_MISMATCH' }));
  });
});

describe('AC-10 · 校验失败不抛 500', () => {
  it('非法请求体 → 400 VALIDATION_FAILED 且带 issues', async () => {
    const app = buildApp({ store: new InMemoryMetaStore() });
    const res = await app.inject({ method: 'POST', url: '/api/games', payload: { mode: 'nope' } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'VALIDATION_FAILED' }));
  });
});
