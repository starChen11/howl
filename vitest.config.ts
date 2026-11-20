import { defineConfig } from 'vitest/config';

import { ALIAS } from './configs/alias.ts';

/**
 * 两个 project：
 *
 * - `unit`：纯函数与静态扫描，快、可并行。
 * - `client`：React 组件与无障碍断言，`jsdom` 环境。
 * - `meta`：会起子进程跑 `pnpm` 命令的门禁测试，慢且会占用端口，因此串行执行。
 *
 * 分开的理由是 `tests/meta/commands.test.ts` 要跑 `pnpm test` 自己——不隔离就会递归。
 * 内层一律用 `pnpm exec vitest run --project unit`。
 */
export default defineConfig({
  define: { __HOWL_FAKE_AI__: 'false' },
  resolve: { alias: ALIAS },
  test: {
    /**
     * 覆盖率门禁只针对 `src/engine/`（TEST-2 / AC-14）。
     *
     * 平时 `pnpm test` 不算覆盖率（否则本地每次迭代都要多跑一遍），
     * 由 `tests/meta/coverage.test.ts` 显式带 `--coverage` 跑并断言阈值。
     */
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 90, branches: 85 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          exclude: ['tests/meta/**', 'tests/e2e/**', 'tests/client/**', 'node_modules/**'],
          environment: 'node',
          // 引擎必须可离线推理（TEST-4 / AC-16）：这个 setup 把 fetch 换成抛错桩。
          setupFiles: ['tests/setup/no-network.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          include: ['tests/client/**/*.test.tsx', 'tests/client/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
      {
        extends: true,
        test: {
          name: 'meta',
          include: ['tests/meta/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
