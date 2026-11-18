import type { Role } from '@shared/domain';

import { initialStateFromSeed, shuffle } from './rng';
import type { RngState } from '@shared/domain';

/**
 * 板子与发牌（RFC-003 §2.1）。
 *
 * 从 `init.ts` 抽出来单独一层，是因为「板子长什么样」和「状态怎么构造」是两件事：
 * RFC-015 的 headless 与将来多套板子（F45，v1 延后）只需要前者。
 */

/** 固定板子：3 wolf / seer / witch / hunter / 3 villager，共 9 席（RFC-003 §2.1）。 */
export const DECK: readonly Role[] = [
  'wolf',
  'wolf',
  'wolf',
  'seer',
  'witch',
  'hunter',
  'villager',
  'villager',
  'villager',
];

/**
 * 用种子发一次牌。产物是**候选**：一旦 `GAME_STARTED` 事件存在，事件里的 `roles` 才是
 * 唯一权威（RFC-002 §2.2）。
 */
export function dealRoles(
  seed: number,
  deck: readonly Role[] = DECK,
): { roles: Role[]; rng: RngState } {
  const dealt = shuffle(initialStateFromSeed(seed), deck);
  return { roles: dealt.items, rng: dealt.rng };
}
