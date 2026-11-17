import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pnpm, REPO_ROOT } from './helpers/run';

/**
 * AC-14：`src/engine/` 的行覆盖率 ≥ 90%、分支覆盖率 ≥ 85%（`TEST-2`）。
 *
 * 为什么不把覆盖率塞进 `pnpm test`：那会让每次本地迭代都多跑一遍 v8 插桩，而覆盖率只在
 * 「准备提交/评审」时才有意义。所以阈值写在 `vitest.config.ts`，由这条门禁测试显式带
 * `--coverage` 跑一次并断言。
 *
 * `TEST-2` 还要求「不得用忽略注释排除未测分支」——所以这里同时扫一遍引擎源码，确认没有
 * `c8 ignore` / `v8 ignore` / `istanbul ignore`。
 */

const SUMMARY_PATH = join(REPO_ROOT, 'coverage', 'coverage-summary.json');

interface CoverageMetric {
  pct: number;
}

interface CoverageSummary {
  total: { lines: CoverageMetric; branches: CoverageMetric };
}

describe('AC-14 · 引擎覆盖率门禁', () => {
  it('带 --coverage 跑 unit project 时退出码为 0（阈值由 vitest.config.ts 判定）', async () => {
    const result = await pnpm(['exec', 'vitest', 'run', '--project', 'unit', '--coverage']);

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('覆盖率报告里的行 / 分支数字达到 90 / 85', () => {
    const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as CoverageSummary;

    expect(summary.total.lines.pct).toBeGreaterThanOrEqual(90);
    expect(summary.total.branches.pct).toBeGreaterThanOrEqual(85);
  });

  it('引擎源码里没有覆盖率忽略注释（TEST-2 明令禁止）', () => {
    const offenders: string[] = [];

    for (const file of [
      'apply.ts',
      'effects.ts',
      'errors.ts',
      'init.ts',
      'replay.ts',
      'rng.ts',
      'step.ts',
      'transitions.ts',
      'win.ts',
    ]) {
      const source = readFileSync(join(REPO_ROOT, 'src', 'engine', file), 'utf8');
      for (const marker of ['c8 ignore', 'v8 ignore', 'istanbul ignore']) {
        if (source.includes(marker)) offenders.push(`${file} 含 ${marker}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
