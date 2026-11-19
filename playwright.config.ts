import { defineConfig } from '@playwright/test';

/**
 * 端到端配置（TEST-6 / RFC-012）。
 *
 * 两件事值得注意：
 * 1. 用 **`channel: 'chrome'`**：CI 与本地都已有 Chrome，不必再下载一份 Playwright 浏览器。
 * 2. 测试自己起服务（`webServer`），并且用 **`HOWL_FAKE_AI=1`**：脚本化 AI 让一局能稳定跑完，
 *    不依赖模型与网络——这是 TEST-4 的「引擎可离线推理」在端到端的延伸。
 */

const PORT = Number(process.env.E2E_PORT ?? 4180);

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-server.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      E2E_PORT: String(PORT),
      HOWL_FAKE_AI: '1',
    },
  },
});
