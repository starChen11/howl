import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pnpm, REPO_ROOT } from './helpers/run';

/**
 * RFC-001 AC-13：`pnpm build` 产出 `dist/client/index.html` 与 `dist/server/index.js`，
 * 且 `dist/client` 里不含密钥字符串（SEC-1 / SEC-2）。
 *
 * 扫描的是**构建产物**，不是源码。源码里没有密钥不证明打包后没有——这正是这条 AC 的
 * 意义所在。
 */

const DIST_CLIENT = join(REPO_ROOT, 'dist', 'client');
const DIST_SERVER_ENTRY = join(REPO_ROOT, 'dist', 'server', 'index.js');

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

describe('AC-13 · 构建产物', () => {
  it('pnpm build 退出 0', async () => {
    // 先删产物再构建（评审 N2）：P18 把 server 的 outDir 改成 dist/server2 后，上一轮留下的
    // dist/server/index.js 让「产物存在」这条断言仍然通过——脏工作树会掩盖构建回归。
    rmSync(join(REPO_ROOT, 'dist'), { recursive: true, force: true });
    expect(existsSync(join(REPO_ROOT, 'dist'))).toBe(false);

    const result = await pnpm(['build']);

    expect(result.code, result.stderr).toBe(0);
  });

  it('产出 dist/client/index.html 与 dist/server/index.js', () => {
    expect(existsSync(join(DIST_CLIENT, 'index.html')), '缺少 dist/client/index.html').toBe(true);
    expect(existsSync(DIST_SERVER_ENTRY), '缺少 dist/server/index.js').toBe(true);
  });

  it('dist/client 内不含 DEEPSEEK_API_KEY', () => {
    const offenders: string[] = [];

    for (const file of walk(DIST_CLIENT)) {
      if (readFileSync(file, 'utf8').includes('DEEPSEEK_API_KEY')) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('dist/client 内没有服务端代码（OPS-4 / SEC-2）', () => {
    const offenders: string[] = [];

    for (const file of walk(DIST_CLIENT)) {
      if (!file.endsWith('.js')) continue;
      if (readFileSync(file, 'utf8').includes('@fastify/static')) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
