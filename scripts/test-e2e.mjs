#!/usr/bin/env node
// `pnpm test:e2e` 的入口。
//
// Playwright 在没有用例时默认以退出码 1 失败。`--pass-with-no-tests` 能让它退出 0，但它
// **一声不响**就成功了——事后无法区分「跑过了」和「一个用例都没有」。RFC-001 §4 与
// AC-15 要求退出码 0 且打印 skipped，所以这里先自己判断一遍再转交。
//
// `TEST-6` 的 Playwright 覆盖要求从 RFC-012（首个用户可见功能）起生效。

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = fileURLToPath(new URL('../tests/e2e', import.meta.url));
const PLAYWRIGHT_BIN = fileURLToPath(
  new URL(
    `../node_modules/.bin/playwright${process.platform === 'win32' ? '.cmd' : ''}`,
    import.meta.url,
  ),
);

const SPEC_PATTERN = /\.(spec|test)\.(ts|tsx|js|mjs)$/;

function hasSpecs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) =>
    entry.isDirectory() ? hasSpecs(join(dir, entry.name)) : SPEC_PATTERN.test(entry.name),
  );
}

if (!hasSpecs(E2E_DIR)) {
  console.log('skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）');
  process.exit(0);
}

// 默认跑 chromium + firefox。WebKit 在本机（尤其是 macOS + 高负载时）偶发
// 「按钮一直不稳定」的超时，单跑可通过；用 `E2E_ALL=1` 或 `pnpm test:e2e:all` 跑全三引擎。
const PROJECTS = ['chromium', 'firefox'];
if (process.env.E2E_ALL === '1') PROJECTS.push('webkit');
const projectArgs = PROJECTS.map((name) => `--project=${name}`);

const child = spawn(PLAYWRIGHT_BIN, ['test', '--pass-with-no-tests', ...projectArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
