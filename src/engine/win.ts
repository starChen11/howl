import type { GameState, Role } from '@shared/domain';
import { FACTION_OF } from '@shared/domain';

/**
 * 胜负谓词（RFC-002 §2.7）。
 *
 * 它是**纯谓词**：只读 `state.seats` 与 `state.mode`，不推进状态、不产生事件。谁在什么
 * 时候调用它、判完怎么走，归 RFC-003（夜间死亡后）与 RFC-004（放逐后）——RUL-1 要求
 * 「死亡结算完成后立即判一次」，那是它们的事。
 *
 * F6（胜负判定）仍归 RFC-004；本 RFC 只提供这个被两个 RFC 共用的函数。
 */

/** `condition` 是给复盘用的可读描述（RFC-002 §2.7）。用封闭联合，避免拼写漂移。 */
export type WinCondition =
  'all-wolves-dead' | 'all-gods-dead' | 'all-villagers-dead' | 'all-good-dead';

export interface WinResult {
  result: 'wolf' | 'good';
  condition: WinCondition;
}

/** 屠边里的「神」：seer / witch / hunter。villager 是「民」。身份名见 `ROLE_LABELS`。 */
const GOD_ROLES: ReadonlySet<Role> = new Set<Role>(['seer', 'witch', 'hunter']);

/**
 * 判定胜负。未分出胜负返回 `null`。
 *
 * **判定只看存活，不看死因**（RUL-5）：被毒杀的神同样计入「神已全部出局」。
 *
 * **次序由 RUL-12 决定（「狼刀在先」）**：夜间结算后若**同时**满足两阵营的胜利条件，
 * 判 **wolf** 胜。所以先算 wolf 侧的条件，再算「狼是否灭绝」。
 *
 * 这条次序曾经是反过来写的（先判狼全灭），理由是「双方同时达成」被当成不该出现的局面
 * ——但那是错的：**一个合法的夜间批次就能造出它**（最后一名神被刀 + 最后一只狼被毒）。
 * 真实对局的通行规则在这种情况下判 wolf 胜，见 RULES.md §6 的 RUL-12 与其引用来源。
 *
 * 注意 RUL-12 **只决定同时成立时判谁，不改变判定时机**：判定仍在「全部出局者应用完毕
 * 之后」做一次（RUL-1 不变）。它也**不是**「技能顺序在先」——夜间技能是同时发动的。
 */
export function checkWin(state: GameState): WinResult | null {
  const alive = state.seats.filter((seat) => seat.alive);

  const godsAlive = alive.some((seat) => GOD_ROLES.has(seat.role));
  const villagersAlive = alive.some((seat) => seat.role === 'villager');
  const goodAlive = alive.some((seat) => FACTION_OF[seat.role] === 'good');

  // 第一步：wolf 侧的胜利条件（RUL-12：同时成立时狼胜，所以先算它）。
  const wolfCondition: WinCondition | null =
    state.mode === 'slaughter-all'
      ? goodAlive
        ? null
        : 'all-good-dead'
      : !godsAlive
        ? 'all-gods-dead'
        : !villagersAlive
          ? 'all-villagers-dead'
          : null;

  if (wolfCondition !== null) {
    return { result: 'wolf', condition: wolfCondition };
  }

  // 第二步：好人侧的胜利条件（狼全部出局）。
  const wolvesAlive = alive.some((seat) => FACTION_OF[seat.role] === 'wolf');
  if (!wolvesAlive) {
    return { result: 'good', condition: 'all-wolves-dead' };
  }

  return null;
}
