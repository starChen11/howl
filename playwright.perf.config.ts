import { defineConfig, devices } from '@playwright/test';

/**
 * 首屏预算的独立配置（RFC-016 §6）。
 *
 * 它需要构建产物与一个正在跑的服务，所以不进 `pnpm test`/`pnpm test:e2e`；
 * `pnpm test:perf` 会先构建、起服务，再跑这一组。
 */

const PORT = Number(process.env.PERF_PORT ?? 4179);

export default defineConfig({
  testDir: 'tests/perf',
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome' },
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-server.ts --port=' + String(PORT),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { HOWL_FAKE_AI: '1' },
  },
  projects: [{ name: 'perf', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
