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

/** 问 ESLint：这个文件的**生效**规则等级（不是配置文本，是合并 preset 与 files 匹配之后的）。 */
async function effectiveSeverity(file: string, rule: string): Promise<unknown> {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile(file);
  return severityOf(config, rule);
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

  // 评审 M8：配置只留 `**/*.ts`、去掉 `**/*.tsx` 时，原来只查 .ts 的断言不会红。
  it('两条规则对 .tsx 源文件同样生效为 error', async () => {
    for (const rule of GUARDED_RULES) {
      const severity = await effectiveSeverity('src/client/main.tsx', rule);
      expect(['error', 2], `${rule} 在 .tsx 上的生效等级是 ${String(severity)}`).toContain(
        severity,
      );
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

  // 评审 M9：原来只断言退出码，把 skipped 文案改成 done 也不会红。AC-15 的核心正是
  // 「零用例时明确说 skipped，而不是静默成功」。
  it('pnpm test:e2e 退出 0，且打印 skipped 而不是静默成功', async () => {
    const result = await pnpm(['test:e2e']);

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('skipped');
    // 没有 spec 时不该真的转交给 Playwright 跑
    expect(result.stdout).not.toContain('Running ');
  });
});
