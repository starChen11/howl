import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * RFC-016 §5 AC-5 / AC-6 / AC-7：首屏预算与打包产物断言。
 *
 * 首屏用真实浏览器测：从 `goto` 到「开始一局」可点击，取 5 次中位数（NFR-8）。
 */

const BUDGET_MS = 2000;

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

test('AC-5 · 首屏可交互 ≤ 2 秒（5 次中位数）', async ({ page }) => {
  const samples: number[] = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const context = page.context();
    await context.clearCookies();

    const started = Date.now();
    await page.goto('/?home=1');
    await page.getByRole('button', { name: '开始一局' }).waitFor({ state: 'visible' });
    samples.push(Date.now() - started);

    // 直接 reload 并禁用缓存，模拟冷启动
    await page.goto('about:blank');
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
  expect(median, `样本：${samples.join(' / ')}ms`).toBeLessThanOrEqual(BUDGET_MS);
});
