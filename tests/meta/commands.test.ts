import { describe, expect, it } from 'vitest';

import { pnpm, pnpmBackground, waitForHttp, delay } from './helpers/run';

/**
 * RFC-001 AC-1：五条命令全部以退出码 0 结束。
 *
 * `pnpm test` 这里跑的是 `--project unit`：在本测试里再跑一遍完整 `pnpm test` 会连自己
 * 一起收进去，无限递归（TEST-STRATEGY.md §7 T-4）。完整套件的结果由实现会话贴在
 * `RFCs/RFC-001-project-scaffold-and-shared-contracts.md` §8.5。
 *
 * 顺序有意义：`start` 依赖 `build` 产出的 `dist/server/index.js`，所以 build 在 start 之前。
 */

const START_PORT = '3999';
const START_HEALTH = `http://127.0.0.1:${START_PORT}/api/health`;

describe('AC-1 · 五条命令', () => {
  it('pnpm typecheck 退出 0', async () => {
    const result = await pnpm(['typecheck']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('pnpm lint 退出 0', async () => {
    const result = await pnpm(['lint']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('pnpm test 的单元与集成部分退出 0', async () => {
    const result = await pnpm(['exec', 'vitest', 'run', '--project', 'unit']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('pnpm build 退出 0', async () => {
    const result = await pnpm(['build']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('pnpm start 起得来、能响应健康检查、能被关掉', async () => {
    // 生产入口默认接真实模型：启动时会校验 key 是否存在（不联网），所以给一个假 key。
    const server = pnpmBackground(['start'], { PORT: START_PORT, DEEPSEEK_API_KEY: 'test-key' });

    try {
      const response = await waitForHttp(START_HEALTH, 30_000);
      if (response === null) {
        throw new Error(`pnpm start 30s 内未响应（GET ${START_HEALTH}）：\n${server.output()}`);
      }

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      server.stop();
      await delay(1_000);
    }
  });
});
