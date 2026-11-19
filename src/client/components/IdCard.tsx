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
