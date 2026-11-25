import type { Page } from '@playwright/test';

/**
 * 把夜间行动点掉（e2e 用）。
 *
 * 夜间现在也由玩家操作：狼要讨论与刀人、神职要查验或用药。测试只关心白天流程时，
 * 用这个把夜间推进过去。返回是否点到了东西。
 */
/** 关键结果弹窗会盖住页面；测试里一律点「知道了」关掉。 */
export async function dismissResultModal(page: Page): Promise<void> {
  // 轮询/自动收起都可能让弹窗在下一刻才出现：多试几轮，直到真的没有遮罩。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = page.getByRole('button', { name: '知道了' });
    if ((await button.count()) === 0) return;
    await button
      .first()
      .click({ timeout: 1_000 })
      .catch(() => undefined);
    if ((await page.locator('[role="alertdialog"]').count()) === 0) return;
    await page.waitForTimeout(100);
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

/**
 * 警长竞选：e2e 里玩家统一选择「不上警」，然后投第一票。
 * 返回是否点到了选举相关按钮（让 waitForMyTurn 继续下一轮）。
 */
export async function passSheriffElection(page: Page): Promise<boolean> {
  const noRun = page.getByRole('button', { name: '不上警' });
  if ((await noRun.count()) > 0) {
    await noRun
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    return true;
  }

  const stay = page.getByRole('button', { name: '不退水' });
  if ((await stay.count()) > 0) {
    await stay
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    return true;
  }

  const order = page.getByRole('button', { name: /^从 \d+ 号开始/ }).first();
  if ((await order.count()) > 0) {
    await order.click({ timeout: 2_000 }).catch(() => undefined);
    return true;
  }

  const tear = page.getByRole('button', { name: '撕掉警徽' });
  if ((await tear.count()) > 0) {
    await tear
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    return true;
  }

  // 警下投票：第一票；重投没有弃权，所以先找候选按钮。
  const sheriffVote = page.getByRole('button', { name: /^投 \d+ 号$/ }).first();
  if ((await sheriffVote.count()) > 0) {
    await sheriffVote.click({ timeout: 2_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

export async function waitForMyTurn(page: Page, timeoutMs = 45_000): Promise<void> {
  const box = page.getByLabel('你的发言');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissResultModal(page);
    if ((await box.count()) > 0 && (await box.first().isVisible())) return;
    if (await passSheriffElection(page)) continue;
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
