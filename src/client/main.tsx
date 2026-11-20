import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { detectCapabilities } from './capabilities';
import { Home } from './pages/Home';
import './styles/global.css';

/**
 * 启动流程（RFC-012 AC-15 / RFC-016 §2.2）。
 *
 * 1. 先做能力探测：缺能力就显示明确提示，不白屏；
 * 2. `?game=` 有就直接进对局（刷新/分享链接）；
 * 3. `?seed=` 有就自动开一局（e2e 与调试用）；
 * 4. 否则渲染**首页**——首屏不发起任何对局请求（AC-8）。
 */
async function boot(): Promise<
  { kind: 'home'; seed: number | null } | { kind: 'game'; gameId: string }
> {
  const params = new URLSearchParams(window.location.search);
  const existing = params.get('game');
  if (existing !== null) return { kind: 'game', gameId: existing };

  const seedParam = params.get('seed');
  const seat = params.get('seat');
  // `?home=1` 强制停在首页（e2e 用固定种子从首页开局，避免随机席位）。
  const forceHome = params.get('home') === '1';

  await fetch('/api/session', { credentials: 'same-origin' });

  if (seedParam === null || forceHome) {
    return { kind: 'home', seed: seedParam === null ? null : Number(seedParam) };
  }

  const created = await fetch('/api/games', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'slaughter-side',
      seed: Number(seedParam),
      ...(seat === null ? {} : { playerSeat: Number(seat) }),
    }),
  });
  const game = (await created.json()) as { gameId?: string };
  if (game.gameId === undefined) throw new Error('开局失败');

  await fetch(`/api/games/${game.gameId}/play`, {
    method: 'POST',
    credentials: 'same-origin',
  });

  return { kind: 'game', gameId: game.gameId };
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('挂载点 #root 不存在');
}

const root = createRoot(container);

const capabilities = detectCapabilities();
if (!capabilities.ok) {
  // 能力不足时只显示标注清楚的一句中文，不做降级实现（RFC-016 §2.1）。
  root.render(
    <StrictMode>
      <main className="fallback" role="alert">
        <h1>这个浏览器暂时不能玩</h1>
        <p>{capabilities.message}</p>
      </main>
    </StrictMode>,
  );
} else {
  const seedParam = new URLSearchParams(window.location.search).get('seed');

  void boot()
    .then(async (entry) => {
      if (entry.kind === 'home')
        return <Home seed={seedParam === null ? null : Number(seedParam)} />;
      // 对局页懒加载：首屏（首页）的 chunk 不包含流式渲染与复盘（RFC-016 AC-6）。
      const { App } = await import('./App');
      return <App gameId={entry.gameId} />;
    })
    .then((element) => root.render(<StrictMode>{element}</StrictMode>))
    .catch((cause: unknown) => {
      root.render(
        <StrictMode>
          <main className="fallback" role="alert">
            <h1>打不开对局</h1>
            <p>{cause instanceof Error ? cause.message : '未知错误'}</p>
          </main>
        </StrictMode>,
      );
    });
}
