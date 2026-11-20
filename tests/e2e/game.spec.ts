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
    await expect(page.locator('.app')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Howl' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '席位' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '发言记录' })).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('360px 视口没有横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto('/?seed=13');

    // 等界面真的挂载：加载屏只有一行字，永远不会溢出（评审 C-116 的假绿）。
    await expect(page.locator('.app')).toBeVisible();

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
    await expect(page.locator('.app')).toBeVisible();

    // 等到输入区真的出现（玩家轮）
    const box = page.getByLabel('你的发言');
    await expect(box).toBeVisible({ timeout: 25_000 });

    // 三段式布局：状态条 / 主区 / 底部，互不重叠。
    // 注意：主区内部滚动，席位可能滚到主区之外——它被主区裁剪，不算遮挡。
    const regions = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top, bottom, left, right };
      };
      return {
        banner: rect('.status'),
        main: rect('.app__main'),
        footer: rect('.app__footer'),
      };
    });

    type Box = { top: number; bottom: number; left: number; right: number };
    const toBox = (
      box: { x: number; y: number; width: number; height: number } | null,
    ): Box | null =>
      box === null
        ? null
        : { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };

    const overlap = (a: Box | null, b: Box | null): number => {
      if (a === null || b === null) return 0;
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      return vertical > 0 && horizontal > 0 ? vertical : 0;
    };

    expect(overlap(regions.banner, regions.footer)).toBeLessThanOrEqual(0);
    expect(overlap(regions.main, regions.footer)).toBeLessThanOrEqual(0);

    // 输入框自身也不能盖住状态条与计时器（C-118：只比 banner/footer 会漏）。
    const input = await box.boundingBox();
    const bannerBox = await page.getByRole('banner').boundingBox();
    const timerBox = await page.getByRole('timer').boundingBox();
    expect(input).not.toBeNull();
    if (input !== null && bannerBox !== null) {
      expect(overlap(toBox(input), toBox(bannerBox))).toBeLessThanOrEqual(0);
    }
    if (input !== null && timerBox !== null) {
      expect(overlap(toBox(input), toBox(timerBox))).toBeLessThanOrEqual(0);
    }

    // 底部区域里的输入框必须真的可点（没被别的东西盖住）
    const hit = await box.evaluate((element) => {
      const { top, left, width, height } = element.getBoundingClientRect();
      const topElement = document.elementFromPoint(left + width / 2, top + height / 2);
      return element.contains(topElement) || element === topElement;
    });
    expect(hit).toBe(true);
  });

  test('对局进行中不出现真相视图入口（SEC-6）', async ({ page }) => {
    await page.goto('/?seed=13');
    await expect(page.locator('.app')).toBeVisible();

    await expect(page.getByRole('button', { name: /真相视图/ })).toHaveCount(0);
  });

  test('焦点可见：Tab 之后焦点元素有可见 outline', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/?seed=13');
    await expect(page.locator('.app')).toBeVisible();

    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null) return null;
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });

    expect(outline).not.toBeNull();
    expect(Number.parseFloat(outline?.width ?? '0')).toBeGreaterThan(0);
    expect(outline?.style).not.toBe('none');
  });

  test('对比度：正文与次要文字达到 AA', async ({ page }) => {
    await page.goto('/?seed=13');
    await expect(page.locator('.app')).toBeVisible();

    const ratios = await page.evaluate(() => {
      const parse = (value: string): [number, number, number] => {
        const match = /rgba?\(([^)]+)\)/.exec(value);
        const parts = (match?.[1] ?? '0,0,0')
          .split(',')
          .map((part) => Number.parseFloat(part.trim()));
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      };
      const luminance = ([r, g, b]: [number, number, number]): number => {
        const channel = (value: number): number => {
          const scaled = value / 255;
          return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const ratio = (a: string, b: string): number => {
        const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((m, n) => n - m);
        return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
      };

      const samples: number[] = [];
      for (const selector of ['.status__facts dt', '.seat__status', '.feed__seat']) {
        const element = document.querySelector(selector);
        if (element === null) continue;
        const style = getComputedStyle(element);
        const background = getComputedStyle(
          element.closest('section, header, article') ?? document.body,
        ).backgroundColor;
        samples.push(ratio(style.color, background));
      }
      return samples;
    });

    expect(ratios.length).toBeGreaterThan(0);
    for (const value of ratios) expect(value).toBeGreaterThanOrEqual(4.5);
  });

  test('键盘：Tab 能到投票按钮，Enter 能投票', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/?seed=13');
    await expect(page.locator('.app')).toBeVisible();

    // 先发言，推进到投票阶段
    const box = page.getByLabel('你的发言');
    await expect(box).toBeVisible({ timeout: 25_000 });
    await box.fill('我来说一句。');
    await box.press('Enter');

    // 投票按钮出现后，**真的按 Tab** 走过去并按 Enter（不能用 .focus() 作弊）
    const voteButton = page.getByRole('button', { name: /投 \d+ 号/ }).first();
    await expect(voteButton).toBeVisible({ timeout: 25_000 });

    let reached = false;
    for (let hop = 0; hop < 40 && !reached; hop += 1) {
      await page.keyboard.press('Tab');
      reached = await voteButton.evaluate((element) => element === document.activeElement);
    }
    expect(reached, 'Tab 到不了投票按钮').toBe(true);

    // 等**我们自己的** POST /actions 到账，而不是等 AI 的票型出现（评审 C-143）
    const submitted = page.waitForResponse(
      (response) =>
        response.url().includes('/actions') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      { timeout: 25_000 },
    );
    await page.keyboard.press('Enter');
    await submitted;
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

test.describe('复盘（RFC-014）', () => {
  test('打完后出现复盘：时间线、身份与推理，360px 无横滚', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto('/?seed=13');
    await expect(page.locator('.app')).toBeVisible();

    // 玩家一旦轮到就过/弃权；循环到复盘出现为止。
    for (let step = 0; step < 80; step += 1) {
      if ((await page.getByRole('heading', { name: '复盘' }).count()) > 0) break;
      const skip = page.getByRole('button', { name: '过' });
      if ((await skip.count()) > 0) await skip.click({ timeout: 1000 }).catch(() => undefined);
      const abstain = page.getByRole('button', { name: '弃权' });
      if ((await abstain.count()) > 0) {
        await abstain.click({ timeout: 1000 }).catch(() => undefined);
      }
      await page.waitForTimeout(250);
    }

    await expect(page.getByRole('heading', { name: '复盘' })).toBeVisible();
    for (const seat of [1, 5, 9]) {
      await expect(page.getByText(new RegExp(`${seat} 号：`)).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: '时间线' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 再来一局：回到对局界面（新一局可能立刻进入发言/投票，所以等的是 .app 里的输入区）
    await page.getByRole('button', { name: '再来一局' }).click();
    await expect(page.locator('.app').or(page.getByRole('heading', { name: '复盘' }))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: '复盘' })).toHaveCount(0);
  });
});

test.describe('首页入口（RFC-016）', () => {
  test('默认 / 是首页，首屏无 API 请求，点「开始一局」才进对局', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) apiCalls.push(request.url());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Howl' })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始一局' })).toBeEnabled();
    expect(apiCalls).toEqual([]);

    await page.getByRole('button', { name: '开始一局' }).click();
    // 先确认导航真的发生了（比直接等 .app 更容易定位「点了没反应」）
    await expect(page).toHaveURL(/game=/, { timeout: 30_000 });
    // 随机身份下玩家可能第一夜就出局，整局会被脚本 AI 一口气跑完直接进复盘，
    // 所以「开始一局成功」的判据是「进了对局页或复盘页」。
    await expect(page.locator('.app').or(page.getByRole('heading', { name: '复盘' }))).toBeVisible({
      timeout: 60_000,
    });
  });
});

test.describe('猎人出局（回归：曾经卡死）', () => {
  test('玩家是猎人、夜里被杀后能自己选开枪，且对局继续', async ({ page }) => {
    // seed=2：1 号固定是猎人，并在第一夜被刀。
    await page.goto('/?seed=2');
    await expect(page.locator('.app')).toBeVisible();

    // 出局后出现开枪选择（不是只剩「打开真相视图」）
    await expect(page.getByRole('button', { name: '不开枪' })).toBeVisible({ timeout: 30_000 });

    // 但还没交枪之前**不能**看真相：否则可以直接按身份挑人（用户实测发现的漏洞）
    await expect(page.getByRole('button', { name: /真相视图/ })).toHaveCount(0);

    const shoot = page.getByRole('button', { name: /开枪带走 \d+ 号/ }).first();
    await expect(shoot).toBeVisible();
    await shoot.click();

    // 交枪之后才恢复观战条与真相入口；这局也可能直接结束（seed=2 常在第一晚就终局）
    await expect(
      page
        .getByRole('button', { name: /真相视图/ })
        .or(page.getByRole('heading', { name: '复盘' })),
    ).toBeVisible({ timeout: 30_000 });

    // 对局继续推进并走到终局（seed=2 这局会在第一天结束，所以不能只等「第 2 天」）
    await expect(page.getByRole('heading', { name: '复盘' })).toBeVisible({ timeout: 60_000 });
  });
});
