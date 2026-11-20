import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端配置（TEST-6 / RFC-012 / RFC-016）。
 *
 * 三件事值得注意：
 * 1. 三个引擎各跑一个 project：Chromium（含 Edge，同引擎）、Firefox、WebKit（Safari 近似）。
 *    `tests/e2e/browsers.spec.ts` 是唯一在三个引擎上跑的；其余用例只在 Chromium 上跑，
 *    避免把总时长乘三。
 * 2. 测试自己起服务（`webServer`），并且用 **`HOWL_FAKE_AI=1`**：脚本化 AI 让一局能稳定跑完。
 * 3. 本机 Chrome 已经够用时，Chromium 走 `channel: 'chrome'`；Firefox / WebKit 用 Playwright
 *    自带的浏览器（`pnpm exec playwright install firefox webkit`）。
 */

const PORT = Number(process.env.E2E_PORT ?? 4180);

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  timeout: 60_000,
  // 对局是有状态的：多个 worker 同时开新局会互相拖慢，个别用例偶发超时。
  // 18 条用例串行只要十几秒，稳定性值得这点时间。
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /browsers\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /browsers\.spec\.ts/ },
  ],
  webServer: {
    // 先构建：否则改了源码仍在跑旧 bundle（C-130）。
    command: 'pnpm build && pnpm exec tsx scripts/e2e-server.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      E2E_PORT: String(PORT),
      HOWL_FAKE_AI: '1',
    },
  },
});
