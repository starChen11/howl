import { describe, expect, it } from 'vitest';

import { pnpm } from './helpers/run';

/**
 * RFC-015 AC-8：`pnpm selfplay` 的占位行为被移除。
 *
 * RFC-001 AC-16 当年刻意断言「未实现 + 退出码 1」，用来防止静默成功（RFCS.md C-5）。
 * 现在它真的能跑：一条命令、零浏览器、跑完 1 局并写出汇总。
 *
 * 默认（没有 `HOWL_FAKE_AI`、没有 key）会尝试真实模型；这里用脚本替身跑冒烟，
 * 不产生费用。
 */

describe('AC-8 · selfplay 不再是占位', () => {
  it('以退出码 0 跑完一局，并打印汇总', async () => {
    const result = await pnpm(
      ['selfplay', '--games=1', '--seed=9', '--out=/tmp/howl-selfplay-meta'],
      { env: { HOWL_FAKE_AI: '1' }, timeoutMs: 120_000 },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('跑完 1 局');
    expect(result.stderr).not.toContain('未实现');
  }, 120_000);
});
