import type { ProjectedContext } from '@shared/project';
import { INJECTION_NOTICE } from '@shared/injection';
import { ROLE_LABELS } from '@shared/terms';

import { RULES_TEXT } from './rules';

/**
 * 提示组装（RFC-006 §2.4）。
 *
 * 系统提示里**不出现**区分「玩家 vs AI」的措辞（AI-8 / F17）：9 个席位走同一份提示，
 * 唯一的差异是它们各自的知情清单。
 */
export function buildSystemPrompt(input: { persona: string | null }): string {
  const lines = [
    '你正在参与一局身份推理对局，扮演其中一个席位。',
    RULES_TEXT,
    INJECTION_NOTICE,
    '回答必须是一个 JSON 对象，包含 action、target（若需要）、reason 三个字段；reason 用一句话说明你的判断依据。',
  ];

  // 人格在 RFC-009 之前恒为 null；留出接缝，但不填假值。
  if (input.persona !== null) {
    lines.push(`你的性格设定：${input.persona}`);
  }

  return lines.join('\n');
}

/** 把知情清单渲染成用户消息。 */
export function buildUserMessage(ctx: ProjectedContext): string {
  const alive = ctx.aliveSeats.join('、');
  const dead = ctx.deadSeats.length === 0 ? '无' : ctx.deadSeats.join('、');

  const lines = [
    `你是 ${ctx.self.seat} 号，身份是 ${ctx.self.role}，${ctx.self.alive ? '存活' : '已出局'}。`,
    `现在是第 ${ctx.day} 天，阶段是 ${ctx.phase}。`,
    `存活席位：${alive}；已出局：${dead}。`,
  ];

  if (ctx.knowledge.teammates.length > 0) {
    lines.push(`你的狼队友：${ctx.knowledge.teammates.join('、')}。`);
  }
  if (ctx.knowledge.checks.length > 0) {
    lines.push(
      `你的查验记录：${ctx.knowledge.checks
        .map(
          (check) => `${check.target} 号是 ${check.result === 'wolf' ? ROLE_LABELS.wolf : '好人'}`,
        )
        .join('；')}。`,
    );
  }
  if (ctx.legalTargets.length > 0) {
    lines.push(`本阶段可以指向：${ctx.legalTargets.join('、')}。`);
  }

  if (ctx.publicEvents.length > 0) {
    lines.push('以下是已经公开发生的事件（按时间顺序）：');
    for (const event of ctx.publicEvents) {
      lines.push(`- ${event.type}`);
    }
  }

  return lines.join('\n');
}
