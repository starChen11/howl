import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { collectTypeScriptFiles, findFilesContaining } from './source-scan';

/**
 * 扫描器自身的回归测试。
 *
 * 为什么要单独测它：`DATA-5`（不许 `Math.random`）与 `TEST-2`（不许覆盖率忽略注释）都靠它。
 * 扫描器只扫一层时，**两个门禁会同时静默失效**——评审 Round 1 的 P13 就是这么穿透的：
 * 在 `src/engine/nested/` 放一个 `Math.random()`，10 个用例仍然全绿。
 *
 * 这里用**临时目录**造嵌套结构，不往 `src/` 里塞夹具（那会污染生产源码）。
 */

const roots: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'howl-scan-'));
  roots.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(join(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('collectTypeScriptFiles', () => {
  it('递归进入子目录（这是 P13 的缺口）', () => {
    const root = makeTree({
      'top.ts': 'export const a = 1;',
      'phases/night.ts': 'export const b = 2;',
      'resolve/deep/deeper/deepest.ts': 'export const c = 3;',
    });

    const files = collectTypeScriptFiles(root)
      .map((file) => file.relativePath)
      .sort();

    expect(files).toEqual(['phases/night.ts', 'resolve/deep/deeper/deepest.ts', 'top.ts']);
  });

  it('只收 .ts，跳过 .tsx / .md / 其他', () => {
    const root = makeTree({
      'a.ts': 'x',
      'B.tsx': 'x',
      'notes.md': 'x',
      'data.json': '{}',
    });

    expect(collectTypeScriptFiles(root).map((file) => file.relativePath)).toEqual(['a.ts']);
  });

  it('跳过隐藏目录与 node_modules', () => {
    const root = makeTree({
      'ok.ts': 'x',
      '.cache/ignored.ts': 'x',
      'node_modules/pkg/index.ts': 'x',
    });

    expect(collectTypeScriptFiles(root).map((file) => file.relativePath)).toEqual(['ok.ts']);
  });

  it('相对路径用被扫描根目录为基准，便于失败消息定位', () => {
    const root = makeTree({ 'engine/phases/night.ts': 'x' });

    expect(collectTypeScriptFiles(root)[0]?.relativePath).toBe('engine/phases/night.ts');
  });

  it('目录为空时返回空数组（不抛错）', () => {
    expect(collectTypeScriptFiles(makeTree({}))).toEqual([]);
  });
});

describe('findFilesContaining', () => {
  it('能命中嵌套文件（P13 的直接回归）', () => {
    const root = makeTree({
      'top.ts': 'export const clean = 1;',
      'nested/violation.ts': 'export const noise = Math.random();',
    });

    const files = collectTypeScriptFiles(root);

    expect(findFilesContaining(files, 'Math.random(')).toEqual(['nested/violation.ts']);
  });

  it('干净时返回空数组', () => {
    const root = makeTree({ 'a.ts': 'const x = 1;' });

    expect(findFilesContaining(collectTypeScriptFiles(root), 'Math.random(')).toEqual([]);
  });
});
