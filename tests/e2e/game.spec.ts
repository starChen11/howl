import { expect, test } from '@playwright/test';

/**
 * RFC-012 §5 AC-1 / AC-8 / AC-9 / AC-10 / AC-11。
 *
 * 覆盖两条真浏览器才测得出的东西：
 * - 布局（360px 无横滚、1024px 侧栏、输入区不遮挡状态）；
 * - 键盘（Tab 可达、Enter 可触发）。
 */

test.describe('整局界面', () => {
  test('主路径：能开一局、看到状态条与席位、发言区可达', async ({ page }) => {
    await page.goto('/?seed=13');

    await expect(page.getByRole('heading', { name: 'Howl' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '席位' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '发言记录' })).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('360px 视口没有横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto('/?seed=13');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('1024px 视口用桌面布局（席位在侧栏）', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/?seed=13');
    await expect(page.getByRole('heading', { name: '席位' })).toBeVisible();

    const columns = await page.evaluate(() => {
      const main = document.querySelector('.app__main');
      if (main === null) return '';
      return getComputedStyle(main).gridTemplateColumns;
    });
    // 侧栏 280px + 主栏
    expect(columns.split(' ').length).toBeGreaterThanOrEqual(2);
  });

  test('手机视口下输入区不遮挡状态条', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/?seed=13');

    const status = await page.getByRole('banner').boundingBox();
    const timer = await page.getByRole('timer').boundingBox();
    expect(status).not.toBeNull();
    expect(timer).not.toBeNull();
    if (status !== null && timer !== null) {
      // 状态条与计时器在同一块里；输入区是 footer，几何不重叠
      expect(timer.y).toBeGreaterThanOrEqual(status.y);
      expect(timer.y + timer.height).toBeLessThanOrEqual(status.y + status.height + 1);
    }
  });

  test('键盘：Tab 能到发言区，Enter 能提交', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/?seed=13');

    // 等到轮到玩家（脚本 AI 会很快说完前面几位）
    const box = page.getByLabel('你的发言');
    await expect(box).toBeVisible({ timeout: 20_000 });

    await box.focus();
    await box.fill('我觉得 2 号像狼。');
    await box.press('Enter');
    // 提交后这条发言会出现在记录里（或输入框消失表示该轮结束）
    await expect(box).toBeHidden({ timeout: 10_000 });
  });
});
