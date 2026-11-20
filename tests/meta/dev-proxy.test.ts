import { describe, expect, it } from 'vitest';

import { delay, pnpmBackground, waitForHttp } from './helpers/run';

/**
 * RFC-001 AC-12 的代理部分：`pnpm dev` 同时起 Vite 与 Fastify，`/api` 必须经 Vite 代理
 * 打到后端。
 *
 * 用真实 HTTP 请求而不是 Playwright：这件事不需要浏览器内核，装一套浏览器只为验证一条
 * 代理规则不划算。偏离已记入 TEST-STRATEGY.md §7。
 *
 * 用默认端口 3000 / 5173，因为 AC-12 就是按这两个地址写的；`vite.config.ts` 的
 * `strictPort` 保证端口被占时这里直接失败，而不是静默换端口后指向别处。
 */

// 用 `localhost` 而不是 127.0.0.1：Vite 的默认 host 在 macOS 上只监听 ::1，
// 写死 IPv4 会连不上。`localhost` 同时也是 AC-12 的原文措辞。
const API_DIRECT = 'http://localhost:3000/api/health';
const API_VIA_PROXY = 'http://localhost:5173/api/health';

describe('AC-12 · Vite 开发代理', () => {
  it('直连 3000 与经 5173 代理都返回 200 与 {"ok":true}', async () => {
    // dev 也默认接真实模型：给一个假 key 通过启动校验（不联网）。
    const dev = pnpmBackground(['dev'], {
      PORT: '3000',
      VITE_PORT: '5173',
      DEEPSEEK_API_KEY: 'test-key',
    });

    try {
      const direct = await waitForHttp(API_DIRECT, 60_000);
      if (direct === null) {
        throw new Error(`后端 60s 内未就绪（GET ${API_DIRECT}）：\n${dev.output()}`);
      }

      const proxied = await waitForHttp(API_VIA_PROXY, 60_000);
      if (proxied === null) {
        throw new Error(`经 5173 的代理未生效（GET ${API_VIA_PROXY}）：\n${dev.output()}`);
      }

      expect(direct.status).toBe(200);
      expect(await direct.json()).toEqual({ ok: true });

      expect(proxied.status).toBe(200);
      expect(await proxied.json()).toEqual({ ok: true });
    } finally {
      dev.stop();
      // 给 vite 与 tsx 一点时间退出，别把端口漏给下一个用例。
      await delay(1_000);
    }
  });
});
