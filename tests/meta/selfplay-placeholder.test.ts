import { describe, expect, it } from 'vitest';

import { pnpm } from './helpers/run';

/**
 * RFC-001 AC-16：`pnpm selfplay` 以退出码 1 结束并提示未实现。
 *
 * 这是对 `OPS-3` 的**临时偏离**（RFCS.md C-5），由 RFC-015 消除。断言「失败」而不是
 * 「成功」是刻意的：批量对局还没实现，静默成功会让人误以为已经能用。
 */

describe('AC-16 · selfplay 占位', () => {
  it('以退出码 1 结束，且提示指向 RFC-015', async () => {
    const result = await pnpm(['selfplay']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('RFC-015');
  });
});
