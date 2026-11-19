import { useState } from 'react';

/**
 * 新手引导（RFC-012 §2.2 / AC-5）。
 *
 * 三件套独立可关；关闭状态写到 `localStorage`，刷新后不再出现。
 */
export const ONBOARDING_KEY = 'howl.onboarding.dismissed';

export function OnboardingHints({ role, goal }: { role: string; goal: string }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <aside className="onboarding" aria-label="新手提示">
      <h2>怎么看</h2>
      <ul>
        <li>
          你的身份是 {role}。{goal}
        </li>
        <li>术语下面有下划线的地方，悬停或聚焦可以看到解释。</li>
        <li>轮到你时，底部会出现输入框；说完了就按「发言」。</li>
      </ul>
      <button
        type="button"
        className="button"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(ONBOARDING_KEY, '1');
          } catch {
            /* 隐私模式下写不进去，忽略 */
          }
        }}
      >
        知道了，不再提示
      </button>
    </aside>
  );
}
