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
 * 次序上先判「狼是否灭绝」：狼全灭时好人立即获胜。理论上「狼全灭 + 神全灭」同时成立的
 * 局面不该出现——RUL-1 规定胜负判定先于死亡触发技能，所以狼胜成立的瞬间对局已结束、
 * hunter 没有开枪机会。这里的次序是防御性的：真要构造出这种局面，好人胜。
 */
export function checkWin(state: GameState): WinResult | null {
  const alive = state.seats.filter((seat) => seat.alive);

  const wolvesAlive = alive.some((seat) => FACTION_OF[seat.role] === 'wolf');
  if (!wolvesAlive) {
    return { result: 'good', condition: 'all-wolves-dead' };
  }

  const godsAlive = alive.some((seat) => GOD_ROLES.has(seat.role));
  const villagersAlive = alive.some((seat) => seat.role === 'villager');

  if (state.mode === 'slaughter-all') {
    const goodAlive = alive.some((seat) => FACTION_OF[seat.role] === 'good');
    return goodAlive ? null : { result: 'wolf', condition: 'all-good-dead' };
  }

  // 屠边：杀光所有神或所有民即胜。
  if (!godsAlive) {
    return { result: 'wolf', condition: 'all-gods-dead' };
  }
  if (!villagersAlive) {
    return { result: 'wolf', condition: 'all-villagers-dead' };
  }

  return null;
}
