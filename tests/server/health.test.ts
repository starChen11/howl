import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { buildApp, HEALTH_PATH } from '@server/app';

/**
 * RFC-001 AC-12 的一手验证：不经端口，直接用 `app.inject()` 打路由。
 *
 * 代理那一半（`:5173` → `:3000`）需要真实端口，放在 `tests/meta/dev-proxy.test.ts`。
 */

describe('AC-12 · GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('常量本身就是 AC-12 的字面路径 /api/health', () => {
    // 用例如果只用 HEALTH_PATH 请求，把常量改成 /api/health2 也照样绿（评审 F5）。
    expect(HEALTH_PATH).toBe('/api/health');
  });

  it('返回 200 且响应体为 {"ok":true}', async () => {
    const response = await app.inject({ method: 'GET', url: HEALTH_PATH });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ ok: true });
  });

  it('未知路由返回 404，不会误命中健康检查', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health/nope' });

    expect(response.statusCode).toBe(404);
  });
});
