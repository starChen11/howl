import { describe, expect, it } from 'vitest';

import { importSpecifiers } from './import-scan';

/**
 * 扫描器自身的回归测试。
 *
 * 依赖方向检查的价值等于它的扫描器的价值：扫描器漏掉一种写法，整条 ARCH-2 / AC-10 / AC-11
 * 就在那里静默失效。评审的 M5 探针证明过这一点——`shared` 里写
 * `await import('@server/app')` 时五个断言全绿。
 */

describe('importSpecifiers', () => {
  it('识别静态导入、类型导入与再导出', () => {
    const source = [
      "import { buildApp } from '@server/app';",
      "import type { SeatId } from './domain';",
      "export { x } from './x';",
      "export type { Y } from '../y';",
    ].join('\n');

    expect(importSpecifiers(source).sort()).toEqual(
      ['@server/app', './domain', './x', '../y'].sort(),
    );
  });

  it('识别仅副作用的导入', () => {
    expect(importSpecifiers("import './side-effect';")).toEqual(['./side-effect']);
  });

  it('识别具名与命名空间导入', () => {
    const source = ["import * as ns from 'node:fs';", "import { a as b } from 'zod';"].join('\n');

    expect(importSpecifiers(source).sort()).toEqual(['node:fs', 'zod']);
  });

  it('识别动态 import —— 这是评审 F5 指出的缺口', () => {
    const cases = [
      "const m = await import('@server/app');",
      'const m = await import("@server/app");',
      'const m = import(\n  "@server/app"\n);',
      'void import( /* 注释 */ "@server/app" )',
    ];

    for (const source of cases) {
      expect(importSpecifiers(source), source).toContain('@server/app');
    }
  });

  it('识别 require', () => {
    expect(importSpecifiers('const m = require("@shared/domain");')).toContain('@shared/domain');
  });

  it('同一模块被多种写法引用时只出现一次', () => {
    const source = [
      "import { a } from '@server/app';",
      "const b = await import('@server/app');",
    ].join('\n');

    expect(importSpecifiers(source)).toEqual(['@server/app']);
  });
});
