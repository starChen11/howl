import type { ProjectedContext } from '@shared/project';

import { ROLE_LABELS } from '@shared/terms';

/**
 * 身份卡（RFC-011 §2.1 的界面部分）。
 *
 * 只读投影推导出来的卡片（`buildIdCard`），不自己算任何身份信息。
 */
export function IdCard({ ctx }: { ctx: ProjectedContext }) {
  const role = ctx.self.role;
  const label = ROLE_LABELS[role] ?? role;

  return (
    <section className="idcard" aria-label="你的身份">
      <h2>你的身份</h2>
      <p className="idcard__role">
        {ctx.self.seat} 号 · {label}
        {ctx.self.alive ? '' : '（已出局）'}
      </p>
      <p className="idcard__goal">{goalOf(ctx)}</p>
      <ul className="idcard__skills">
        {skillsOf(ctx).map((skill) => (
          <li key={skill}>{skill}</li>
        ))}
      </ul>
      {remainingOf(ctx).length > 0 ? (
        <p className="idcard__remaining">
          剩余：
          {remainingOf(ctx)
            .map((item) => `${item.name} ${item.count} 次`)
            .join('，')}
        </p>
      ) : null}
      <ul className="idcard__facts">
        {role === 'seer'
          ? ctx.knowledge.checks.map((check) => (
              <li key={`${check.target}-${check.day}`}>
                第 {check.day} 天查 {check.target} 号：
                {check.result === 'wolf' ? ROLE_LABELS.wolf : '好人'}
              </li>
            ))
          : null}
        {role === 'witch' ? (
          <li>
            解药{ctx.knowledge.potions.heal === 'used' ? '已用' : '可用'}；毒药
            {ctx.knowledge.potions.poison === 'used' ? '已用' : '可用'}
          </li>
        ) : null}
        {role === 'hunter' ? <li>{ctx.knowledge.canShoot ? '可以开枪' : '暂不能开枪'}</li> : null}
        {role === 'wolf' ? (
          <li>
            队友：
            {ctx.knowledge.teammates.length === 0
              ? '没有'
              : `${ctx.knowledge.teammates.join('、')} 号`}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** 技能与目标（与 RFC-011 的服务端身份卡同一套语义，但只读投影）。 */
function skillsOf(ctx: ProjectedContext): string[] {
  switch (ctx.self.role) {
    case 'seer':
      return ['每晚查验一名玩家的阵营'];
    case 'witch':
      return ['一瓶解药、一瓶毒药，各用一次'];
    case 'hunter':
      return ['出局时可以开枪带走一人（被毒杀除外）'];
    case 'wolf':
      return ['每晚与队友共同袭击一人'];
    default:
      return [`没有特殊能力，靠发言与投票找出${ROLE_LABELS.wolf}`];
  }
}

function goalOf(ctx: ProjectedContext): string {
  if (!ctx.self.alive) {
    // 出局不等于没事做：轮到你开枪时要说清这一点。
    if (ctx.pending === 'shoot') return '你已出局，但可以开枪带走一个人（或不开枪）。';
    return '你已经出局，只能旁观。';
  }
  switch (ctx.self.role) {
    case 'seer':
      return '今晚挑一个最可疑的人查验。';
    case 'witch':
      return '留意今晚谁被袭击，决定用不用解药。';
    case 'hunter':
      return ctx.knowledge.canShoot ? '你可以开枪带走一人。' : '活着，并在出局时准备开枪。';
    case 'wolf':
      return '今晚和队友选一个人袭击，白天别露馅。';
    default:
      return '白天听发言，把票投给最像狼的人。';
  }
}

function remainingOf(ctx: ProjectedContext): { name: string; count: number }[] {
  if (ctx.self.role !== 'witch') return [];
  return [
    { name: '解药', count: ctx.knowledge.potions.heal === 'used' ? 0 : 1 },
    { name: '毒药', count: ctx.knowledge.potions.poison === 'used' ? 0 : 1 },
  ];
}
