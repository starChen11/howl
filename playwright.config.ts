import { defineConfig } from '@playwright/test';

/**
 * 本 RFC 阶段 `tests/e2e/` 为空，`pnpm test:e2e` 由 `scripts/test-e2e.mjs` 拦下并打印
 * `skipped`（AC-15）；只有出现 spec 时才会真的走到 Playwright。
 * `TEST-6` 的 Playwright 要求从 RFC-012（首个用户可见功能）起生效。
 *
 * `baseURL` 用 `localhost` 而不是 `127.0.0.1`：Vite 的默认 host 在 macOS 上只监听 `::1`，
 * 写死 IPv4 会在 RFC-012 加用例时连不上（评审 3.5-2）。
 *
 * AC-12 的 `/api` 代理验证没有放在这里：它只需要一次 HTTP 请求，不需要浏览器内核，
 * 用 `tests/meta/dev-proxy.test.ts` 直接打真实端口。偏离已记入 TEST-STRATEGY.md §7。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: { baseURL: `http://localhost:${process.env.VITE_PORT ?? 5173}` },
});
