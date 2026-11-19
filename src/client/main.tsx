import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles/global.css';

/**
 * 启动流程（RFC-012 AC-15 的客户端一侧）。
 *
 * 1. 读会话（服务端会下发 cookie）；
 * 2. `?game=` 有就用它，没有就**开一局并启动整局循环**；
 * 3. 渲染 `App`，之后只渲染投影与流，不推进状态机。
 */
async function boot(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const existing = params.get('game');
  if (existing !== null) return existing;

  await fetch('/api/session', { credentials: 'same-origin' });

  const seed = params.get('seed');
  const seat = params.get('seat');
  const created = await fetch('/api/games', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'slaughter-side',
      ...(seed === null ? {} : { seed: Number(seed) }),
      ...(seat === null ? {} : { playerSeat: Number(seat) }),
    }),
  });
  const game = (await created.json()) as { gameId?: string };
  if (game.gameId === undefined) throw new Error('开局失败');

  await fetch(`/api/games/${game.gameId}/play`, {
    method: 'POST',
    credentials: 'same-origin',
  });

  return game.gameId;
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('挂载点 #root 不存在');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <p role="status">正在准备对局…</p>
  </StrictMode>,
);

void boot().then((gameId) => {
  root.render(
    <StrictMode>
      <App gameId={gameId} />
    </StrictMode>,
  );
});
