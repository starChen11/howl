import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { pnpm } from './helpers/run';

/**
 * RFC-001 AC-14 / AC-15。
 *
 * 用 ESLint 的 API 问「这个文件的**生效**规则是什么」，而不是去解析配置文件文本：
 * 生效值能反映 preset 覆盖与 files 匹配，文本匹配不能。
 */

const GUARDED_RULES = [
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-non-null-assertion',
];

function severityOf(
  config: Awaited<ReturnType<ESLint['calculateConfigForFile']>>,
  rule: string,
): unknown {
  const entry = config?.rules?.[rule];
  return Array.isArray(entry) ? entry[0] : entry;
}

describe('AC-14 · ESLint 规则等级', () => {
  it('两条规则对 .ts 源文件生效为 error', async () => {
    const eslint = new ESLint();
    const config = await eslint.calculateConfigForFile('src/shared/domain.ts');

    for (const rule of GUARDED_RULES) {
      const severity = severityOf(config, rule);
      expect(['error', 2], `${rule} 的生效等级是 ${String(severity)}`).toContain(severity);
    }
  });

  it('pnpm lint 退出 0', async () => {
    const result = await pnpm(['lint']);

    expect(result.code, result.stderr).toBe(0);
  });
});

describe('AC-15 · 格式化与 e2e 门禁', () => {
  it('pnpm format:check 退出 0', async () => {
    const result = await pnpm(['format:check']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('pnpm test:e2e 退出 0（本阶段无用例）', async () => {
    const result = await pnpm(['test:e2e']);

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
