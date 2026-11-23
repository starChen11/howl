import type { Page } from '@playwright/test';

/**
 * 把夜间行动点掉（e2e 用）。
 *
 * 夜间现在也由玩家操作：狼要讨论与刀人、神职要查验或用药。测试只关心白天流程时，
 * 用这个把夜间推进过去。返回是否点到了东西。
 */
/** 关键结果弹窗会盖住页面；测试里一律点「知道了」关掉。 */
export async function dismissResultModal(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '知道了' });
  if ((await button.count()) > 0) {
    await button
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
}

export async function passNight(page: Page): Promise<boolean> {
  await dismissResultModal(page);
  for (let guard = 0; guard < 6; guard += 1) {
    const skipChat = page.getByRole('button', { name: '跳过' });
    if ((await skipChat.count()) > 0) {
      await skipChat
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      continue;
    }

    const target = page.getByRole('button', { name: /^(刀|验 \/ 查验|查验|选) \d+ 号$/ });
    if ((await target.count()) > 0) {
      await target
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      continue;
    }

    // 狼队投票（RUL-13）：点第一个候选
    // 狼队自由投票：选目标 → 确认
    const wolfVote = page.getByRole('button', { name: /^选 \d+ 号$/ });
    if ((await wolfVote.count()) > 0) {
      await wolfVote
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      const confirm = page.getByRole('button', { name: '确认' });
      await confirm.click({ timeout: 2_000 }).catch(() => undefined);
      continue;
    }

    const noPotion = page.getByRole('button', { name: '不用药' });
    if ((await noPotion.count()) > 0) {
      await noPotion
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      continue;
    }

    return guard > 0;
  }
  return true;
}

/** 等到「轮到我发言」的输入框出现，途中把夜间行动点掉。 */
export async function waitForMyTurn(page: Page, timeoutMs = 45_000): Promise<void> {
  const box = page.getByLabel('你的发言');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissResultModal(page);
    if ((await box.count()) > 0 && (await box.first().isVisible())) return;
    if (await page.getByRole('heading', { name: '复盘' }).count()) {
      throw new Error('对局已经结束，等不到发言输入框');
    }

    // 轮到我投票时先投掉，否则等不到下一次发言（平票重投不能弃权）
    const abstain = page.getByRole('button', { name: '弃权' });
    if ((await abstain.count()) > 0) {
      await abstain
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      continue;
    }
    const vote = page.getByRole('button', { name: /^(投|选) \d+ 号$/ });
    if ((await vote.count()) > 0) {
      await vote
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      const confirm = page.getByRole('button', { name: '确认' });
      await confirm.click({ timeout: 2_000 }).catch(() => undefined);
      continue;
    }

    await passNight(page);
    await page.waitForTimeout(250);
  }
  throw new Error('等到超时也没轮到我发言');
}
