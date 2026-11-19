import type { SeatId } from '@shared/domain';
import type { ProjectedContext } from '@shared/project';
import { ROLE_LABELS } from '@shared/terms';

/**
 * 身份卡（RFC-011 §2.1）。
 *
 * 它**只读投影**：`skills` / `remaining` / `extras` 全部来自 `ProjectedContext`，
 * 不另查状态、不另写一套裁剪逻辑（UI-1 / SEC-5）。
 */

export interface IdCard {
  seat: SeatId;
  role: string;
  roleLabel: string;
  alive: boolean;
  skills: string[];
  /** 这一局还能用几次的能力（药水、开枪）。 */
  remaining: { name: string; count: number }[];
  /** 角色专属信息（查验史、队友……）。 */
  extras: string[];
}

export function buildIdCard(ctx: ProjectedContext): IdCard {
  const role = ctx.self.role;
  const card: IdCard = {
    seat: ctx.self.seat,
    role,
    roleLabel: ROLE_LABELS[role] ?? role,
    alive: ctx.self.alive,
    skills: [],
    remaining: [],
    extras: [],
  };

  switch (role) {
    case 'seer': {
      card.skills.push('每晚查验一名玩家的阵营');
      if (ctx.knowledge.checks.length === 0) {
        card.extras.push('还没有查验记录');
      } else {
        for (const check of ctx.knowledge.checks) {
          card.extras.push(
            `第 ${check.day} 天查 ${check.target} 号：${check.result === 'wolf' ? ROLE_LABELS.wolf : '好人'}`,
          );
        }
      }
      break;
    }
    case 'witch': {
      card.skills.push('一瓶解药、一瓶毒药，各用一次');
      card.remaining.push({ name: 'heal', count: ctx.knowledge.potions.heal === 'used' ? 0 : 1 });
      card.remaining.push({
        name: 'poison',
        count: ctx.knowledge.potions.poison === 'used' ? 0 : 1,
      });
      break;
    }
    case 'hunter': {
      card.skills.push('出局时可以开枪带走一人（被毒杀除外）');
      card.extras.push(ctx.knowledge.canShoot ? '现在可以开枪' : '现在不能开枪');
      break;
    }
    case 'wolf': {
      card.skills.push('每晚与队友共同袭击一人');
      card.extras.push(
        ctx.knowledge.teammates.length === 0
          ? '没有其他队友'
          : `队友：${ctx.knowledge.teammates.join('、')} 号`,
      );
      break;
    }
    default: {
      card.skills.push(`没有特殊能力，靠发言与投票找出${ROLE_LABELS.wolf}`);
      break;
    }
  }

  return card;
}
