import type { ProjectedContext } from '@shared/project';
import { INJECTION_NOTICE } from '@shared/injection';
import { wrapPublicUtterance } from '@server/project/inject';
import { ROLE_LABELS } from '@shared/terms';

import { RULES_TEXT, winConditionText } from './rules';

/**
 * 提示组装（RFC-006 §2.4）。
 *
 * 系统提示里**不出现**区分「玩家 vs AI」的措辞（AI-8 / F17）：9 个席位走同一份提示，
 * 唯一的差异是它们各自的知情清单。
 */
export function buildSystemPrompt(input: {
  persona: string | null;
  mode: 'slaughter-side' | 'slaughter-all';
}): string {
  const lines = [
    '你正在参与一局身份推理对局，扮演其中一个席位。',
    RULES_TEXT,
    winConditionText(input.mode),
    INJECTION_NOTICE,
    '回答必须是一个 JSON 对象，包含 action、target（若需要）、reason 三个字段；reason 用一句话说明你的判断依据。',
  ];

  // 人格在 RFC-009 之前恒为 null；留出接缝，但不填假值。
  if (input.persona !== null) {
    lines.push(`你的性格设定：${input.persona}`);
  }

  return lines.join('\n');
}

/** 把一条公开事件渲染成可读的一行。**内容**才是模型要分析的东西，事件类型不是。 */
function renderEvent(event: ProjectedContext['publicEvents'][number]): string {
  switch (event.type) {
    case 'SPEECH': {
      const payload = event.payload as { seat: number; text: string };
      const wrapped = wrapPublicUtterance({
        seat: payload.seat as ProjectedContext['self']['seat'],
        text: payload.text,
      });
      return wrapped.ok ? wrapped.text : `${payload.seat} 号发言（过长，已省略）`;
    }
    case 'SPEECH_SKIPPED':
      return `${(event.payload as { seat: number }).seat} 号选择了跳过发言。`;
    case 'VOTE_REVEALED': {
      const votes = (event.payload as { votes: { seat: number; target: number | 'abstain' }[] })
        .votes;
      const parts = votes.map((vote) =>
        vote.target === 'abstain' ? `${vote.seat} 号弃权` : `${vote.seat} 号投 ${vote.target} 号`,
      );
      return `投票结果：${parts.join('，')}。`;
    }
    case 'DAY_STARTED': {
      const payload = event.payload as { diedLastNight: number[] };
      const died =
        payload.diedLastNight.length === 0
          ? '没有人出局'
          : `${payload.diedLastNight.join('、')} 号出局`;
      return `天亮了：${died}。`;
    }
    case 'PLAYER_DIED':
      return `${(event.payload as { seat: number }).seat} 号出局。`;
    case 'SELF_EXPOSE':
      return `${(event.payload as { seat: number }).seat} 号自曝是 ${ROLE_LABELS.wolf}。`;
    case 'WOLF_CHAT_POSTED': {
      const payload = event.payload as { seat: number; text: string };
      return `狼队频道 ${payload.seat} 号：${payload.text}`;
    }
    default:
      return event.type;
  }
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
  if (ctx.knowledge.potions.heal !== 'used' || ctx.knowledge.potions.poison !== 'used') {
    lines.push(
      `你的药：解药${ctx.knowledge.potions.heal === 'used' ? '已用' : '可用'}，毒药${ctx.knowledge.potions.poison === 'used' ? '已用' : '可用'}。`,
    );
  }
  if (ctx.knowledge.knownKillTarget !== null) {
    lines.push(`你看到今晚被袭击的是 ${ctx.knowledge.knownKillTarget} 号。`);
  }
  if (ctx.knowledge.canShoot) {
    lines.push('你被出局了，现在可以开枪带走一人（也可以选择不开）。');
  }
  if (ctx.legalTargets.length > 0) {
    lines.push(`本阶段可以指向：${ctx.legalTargets.join('、')}。`);
  }
  lines.push(`当前需要你做出：${ctx.pending ?? '无'} 决策。`);
  lines.push(
    '可选动作：kill、check、heal、poison、none、vote、abstain、speak、skip、shoot、expose、chat。',
  );

  if (ctx.publicEvents.length > 0) {
    lines.push('以下是已经公开发生的事（按时间顺序）：');
    for (const event of ctx.publicEvents) {
      lines.push(`- ${renderEvent(event)}`);
    }
  }

  return lines.join('\n');
}
