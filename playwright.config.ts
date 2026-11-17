import { defineConfig } from '@playwright/test';

/**
 * 本 RFC 阶段 `tests/e2e/` 为空，`pnpm test:e2e` 以 `--passWithNoTests` 退出 0（AC-15）。
 * `TEST-6` 的 Playwright 要求从 RFC-012（首个用户可见功能）起生效。
 *
 * AC-12 的 `/api` 代理验证没有放在这里：它只需要一次 HTTP 请求，不需要浏览器内核，
 * 用 `tests/meta/dev-proxy.test.ts` 直接打真实端口。偏离已记入 TEST-STRATEGY.md §7。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${process.env.VITE_PORT ?? 5173}` },
});
