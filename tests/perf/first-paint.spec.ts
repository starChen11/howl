import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * RFC-016 §5 AC-5 / AC-6 / AC-7：首屏预算与打包产物断言。
 *
 * 首屏用真实浏览器测**冷启动**：每次一个全新 context（清 HTTP 缓存），
 * 测 `goto` 到「开始一局」**可点击**的时间，取 5 次中位数（NFR-8）。
 */

const BUDGET_MS = 2000;
const SAMPLES = 5;

test('AC-6 / AC-7 · 首屏入口 chunk 不含复盘、流式接口与模型地址', async () => {
  const assets = await readdir('dist/client/assets');
  const entry = assets.find((name) => name.startsWith('index-') && name.endsWith('.js'));
  expect(entry).toBeDefined();

  const source = await readFile(join('dist/client/assets', entry as string), 'utf8');
  expect(source).not.toContain('复盘时间线');
  expect(source).not.toContain('/stream');
  expect(source).not.toContain('api.deepseek');
  expect(source).not.toContain('DEEPSEEK_API_KEY');

  // 复盘页确实被拆出去了
  const replay = assets.find((name) => name.startsWith('ReplayPage-') && name.endsWith('.js'));
  expect(replay).toBeDefined();
  expect(await readFile(join('dist/client/assets', replay as string), 'utf8')).toContain(
    '复盘时间线',
  );
});

test('AC-7 · 全部客户端产物都不含模型调用代码', async () => {
  const assets = await readdir('dist/client/assets');
  for (const name of assets.filter((file) => file.endsWith('.js'))) {
    const source = await readFile(join('dist/client/assets', name), 'utf8');
    for (const marker of ['api.deepseek.com', 'DEEPSEEK_API_KEY', 'openai', '/chat/completions']) {
      expect(source, `${name} 含 ${marker}`).not.toContain(marker);
    }
  }
});

test('AC-5 · 首屏可交互 ≤ 2 秒（冷启动 5 次中位数）', async ({ browser }) => {
  const samples: number[] = [];
  const transferredPerSample: number[] = [];

  for (let attempt = 0; attempt < SAMPLES; attempt += 1) {
    // 每次全新 context：没有 HTTP 缓存，才是真的冷启动
    const context = await browser.newContext();
    const page = await context.newPage();
    let transferred = 0;

    page.on('response', async (response) => {
      if (response.url().endsWith('/') || response.url().includes('/assets/')) {
        const sizes = await response.request().sizes();
        transferred += sizes.responseBodySize;
      }
    });

    const before = Date.now();
    await page.goto('/');

    const button = page.getByRole('button', { name: '开始一局' });
    await button.waitFor({ state: 'visible' });
    await expect(button).toBeEnabled();

    const elapsed = Date.now() - before;
    samples.push(elapsed);
    transferredPerSample.push(transferred);
    await context.close();
  }

  // **每一次**都必须是冷启动：真的下载了入口 JS（否则量到的是缓存或空白页）
  for (const [index, size] of transferredPerSample.entries()) {
    expect(size, `第 ${index + 1} 次只下载了 ${size} 字节`).toBeGreaterThan(50_000);
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
  expect(median, `样本：${samples.join(' / ')}ms`).toBeLessThanOrEqual(BUDGET_MS);
});
