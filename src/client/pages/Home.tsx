import { useState } from 'react';

/**
 * 首页（RFC-016 §2.2 / AC-8）。
 *
 * 首屏只渲染这一页，**不发起任何对局或 AI 请求**——「开始一局」之后才建局。
 * 这样链接发给别人时，对方先看到这是什么，而不是掉进一局陌生的游戏。
 */
export function Home({ seed }: { seed: number | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await fetch('/api/games', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'slaughter-side',
          ...(seed === null ? {} : { seed }),
        }),
      });
      if (!created.ok) throw new Error(`开局失败：${created.status}`);

      const game = (await created.json()) as { gameId?: string };
      if (game.gameId === undefined) throw new Error('开局失败：没有对局 id');

      await fetch(`/api/games/${game.gameId}/play`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      window.location.search = `?game=${game.gameId}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开局失败');
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <h1 className="home__title">Howl</h1>
      <p className="home__lead">在浏览器里和 AI 玩一局推理游戏。九个人，一整局，从发牌到天亮。</p>
      <ul className="home__points">
        <li>每个 AI 都会说话、投票，并给自己找理由</li>
        <li>你出局后可以继续观战，也可以打开真相视图</li>
        <li>打完能看完整复盘：谁是谁，谁当时在想什么</li>
      </ul>
      <button
        type="button"
        className="button button--primary home__start"
        onClick={() => void start()}
        disabled={busy}
      >
        {busy ? '正在开局…' : '开始一局'}
      </button>
      {error === null ? null : (
        <p className="home__error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
