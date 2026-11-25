import { expect, test } from '@playwright/test';

import { dismissResultModal, waitForMyTurn } from './helpers';

/**
 * RFC-016 §5 AC-1 / AC-2 / AC-3 / AC-8：跨浏览器主路径、能力兜底与首屏请求。
 *
 * 这个文件在 Chromium / Firefox / WebKit 三个 project 上各跑一遍；
 * 其余 e2e 只在 Chromium 上跑，避免把总时长乘三。
 */

test('主路径：开始一局 → 发言 → 投票', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/?home=1&seed=13');
  // 打开页面时看到的是首页，不是一局陌生的游戏（AC-8）
  await expect(page.getByRole('heading', { name: 'Howl' })).toBeVisible();

  // 首屏到「开始一局」可点期间，不该有任何后端请求（A 方案：首屏不碰后端）
  const apiBeforeStart = requests.filter((url) => url.includes('/api/'));
  expect(apiBeforeStart).toEqual([]);

  await page.getByRole('button', { name: '开始一局' }).click();
  await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 });

  // 轮到自己时发言（夜间行动先点掉）
  await waitForMyTurn(page, 45_000);
  const box = page.getByLabel('你的发言');
  await box.fill('我来说一句。');
  await box.press('Enter');

  // 进入投票后投一票
  await dismissResultModal(page);
  const voteButton = page.getByRole('button', { name: /^投 \d+ 号$/ }).first();
  await expect(voteButton).toBeVisible({ timeout: 30_000 });
  await voteButton.click();

  // 这一票真的进了票型（公开事件面板），而不是等按钮消失靠时序碰运气
  await expect(page.getByText(/1 号投 \d+ 号|1 号弃权/).first()).toBeVisible({
    timeout: 30_000,
  });
});

test.describe('能力兜底（AC-3）', () => {
  test('缺 EventSource 时显示中文提示，不白屏', async ({ page }) => {
    // 在页面脚本之前把 EventSource 摘掉，模拟老浏览器
    await page.addInitScript(() => {
      Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true });
    });
    await page.goto('/');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('这个浏览器暂时不能玩');
    await expect(page.getByRole('alert')).toContainText('实时消息');
    // 没有白屏：body 里确实有内容
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
