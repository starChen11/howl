import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GameViewResponse } from './api';
import { ApiClient } from './api';
import { boardAnnouncement, buildBoard, speakingSeat } from './game-state';
import { IdCard } from './components/IdCard';
import { VoteInput } from './components/VoteInput';
import { TermHint } from './components/TermHint';
import { SeatGrid } from './components/SeatGrid';
import { SpeechFeed, type SpeechLine } from './components/SpeechFeed';
import { SpeechInput } from './components/SpeechInput';
import { StatusBar } from './components/StatusBar';
import { OnboardingHints } from './components/OnboardingHints';
import { streamReducer, initialStreamState, type StreamState } from './use-stream';

/**
 * 对局界面（RFC-012）。
 *
 * 数据只有两个来源：`GET /api/games/:id` 的**投影**与 SSE 的增量。
 * 界面不推进状态机（ARCH-9）——所有 action 都 POST 到服务端。
 */
export function App({ gameId, client = new ApiClient() }: { gameId: string; client?: ApiClient }) {
  const [view, setView] = useState<GameViewResponse | null>(null);
  const [stream, setStream] = useState<StreamState>(initialStreamState);
  const [remaining, setRemaining] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await client.game(gameId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取对局失败');
    }
  }, [client, gameId]);

  useEffect(() => {
    void refresh();
    const close = client.openStream(gameId, (message) =>
      setStream((previous) => streamReducer(previous, message, Date.now())),
    );
    const timer = setInterval(() => void refresh(), 1_000);
    return () => {
      close();
      clearInterval(timer);
    };
  }, [client, gameId, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);

  // 草稿同步（RFC-011 AC-6）：超时后服务端用最后一次草稿提交，而不是丢成弃权。
  const syncDraft = useCallback(
    (text: string) => {
      void client.draft(gameId, text);
    },
    [client, gameId],
  );

  const board = useMemo(() => (view === null ? null : buildBoard(view.view)), [view]);

  const lines: SpeechLine[] = useMemo(() => {
    if (view === null) return [];
    const committed = view.view.publicEvents
      .filter((event) => event.type === 'SPEECH')
      .map((event) => {
        const payload = event.payload as { seat: number; text: string };
        return { id: event.seq, seat: payload.seat, text: payload.text };
      });
    const live =
      stream.phase === 'speaking' || stream.phase === 'done'
        ? [{ id: 1_000_000, seat: stream.seat ?? 0, text: stream.text }]
        : [];
    return [...committed, ...live];
  }, [view, stream]);

  if (view === null || board === null) {
    return <p role="status">正在载入对局…</p>;
  }

  const ctx = view.view;
  const speaking = speakingSeat(ctx);
  const myTurn = speaking === ctx.self.seat;

  const submit = async (text: string) => {
    const result = await client.submit(gameId, {
      action: { type: 'SPEECH', ts: Date.now(), seat: ctx.self.seat, text },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const vote = async (target: number) => {
    const result = await client.submit(gameId, {
      action: {
        type: 'VOTE',
        ts: Date.now(),
        seat: ctx.self.seat,
        target: (target < 0 ? 'abstain' : target) as never,
      },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const skip = async () => {
    const result = await client.submit(gameId, {
      action: { type: 'SPEECH_SKIP', ts: Date.now(), seat: ctx.self.seat },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  return (
    <div className="app">
      <StatusBar
        day={board.day}
        phase={board.phase}
        aliveCount={board.aliveCount}
        remaining={remaining}
        speakingSeat={board.speakingSeat}
      />
      <main className="app__main">
        <div className="app__side">
          <IdCard ctx={ctx} />
          <SeatGrid seats={board.seats} />
        </div>
        <SpeechFeed lines={lines} />
      </main>
      <p className="sr-only" role="status" aria-live="polite">
        {boardAnnouncement(ctx, remaining)}
      </p>
      <footer className="app__footer">
        {myTurn ? (
          <SpeechInput remaining={remaining} onSubmit={submit} onSkip={skip} onDraft={syncDraft} />
        ) : null}
        {ctx.phase === 'DAY_VOTE' && ctx.legalTargets.includes(ctx.self.seat) === false ? (
          <VoteInput
            aliveSeats={ctx.aliveSeats.filter((seat) => seat !== ctx.self.seat)}
            onVote={vote}
          />
        ) : null}
        <p className="app__hint">
          轮到你时可以说说你的怀疑；想了解
          <TermHint termKey="vote">投票</TermHint>、<TermHint termKey="knife">刀</TermHint> 或
          <TermHint termKey="fakeSeerClaim">悍跳</TermHint>
          是什么意思，悬停或聚焦即可。
        </p>
        <OnboardingHints role={ctx.self.role} goal="先听一两轮，再决定信谁。" />
      </footer>
      {error === null ? null : (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
