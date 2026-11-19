import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GameViewResponse } from './api';
import { ApiClient } from './api';
import { boardAnnouncement, buildBoard, speakingSeat } from './game-state';
import { IdCard } from './components/IdCard';
import { VoteInput } from './components/VoteInput';
import { EventPanel, buildPanelEntries } from './components/EventPanel';
import { SpectatorBar } from './components/SpectatorBar';
import { Notepad } from './components/Notepad';
import { toggleTruth, initialTruthState } from './state/truth-view';
import type { TruthView } from '@shared/truth';
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
  const [truth, setTruth] = useState(initialTruthState);
  const [truthData, setTruthData] = useState<TruthView | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

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
  const panelEntries = useMemo(() => (view === null ? [] : buildPanelEntries(view.view)), [view]);

  const jumpTo = useCallback((seq: number) => {
    setHighlight(seq);
    // 滚动到对应发言（用 data-seq 精确定位）
    const target = document.querySelector(`[data-seq="${seq}"]`);
    (target as HTMLElement | null)?.scrollIntoView?.({ block: 'center' });
  }, []);

  const onToggleTruth = useCallback(async () => {
    const next = toggleTruth(truth);
    setTruth(next);
    if (!next.enabled) {
      setTruthData(null);
      return;
    }
    // 真相数据只对已出局者开放；服务端活着会回 403（SEC-6）。
    setTruthData(await client.truth(gameId));
  }, [client, gameId, truth]);

  // 读屏公告只在「阶段 / 天数 / 轮到谁」变化时更新；跟着倒计时每秒刷会淹掉读屏（C-123）。
  const [announcement, setAnnouncement] = useState('');
  const announcementKey =
    view === null ? '' : `${view.view.phase}|${view.view.day}|${board?.speakingSeat ?? 'x'}`;
  useEffect(() => {
    if (view === null) return;
    // 播报里不放倒计时：它每秒都变，会把读屏刷屏。
    setAnnouncement(boardAnnouncement(view.view));
  }, [announcementKey]);

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
          <EventPanel entries={panelEntries} onJump={jumpTo} />
          <Notepad gameId={gameId} />
        </div>
        <SpeechFeed lines={lines} highlightSeq={highlight} />
      </main>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <footer className="app__footer">
        {ctx.self.alive ? null : (
          <SpectatorBar truthEnabled={truth.enabled} onToggleTruth={() => void onToggleTruth()} />
        )}
        {truth.enabled && truthData !== null ? (
          <section className="truth" aria-label="真相视图">
            <h2>真相视图</h2>
            <ul>
              {truthData.seats.map((seat) => (
                <li key={seat.seat}>
                  {seat.seat} 号：{seat.roleLabel}
                  {seat.alive ? '' : '（已出局）'}
                  {seat.actions.length > 0 ? `：${seat.actions.join('；')}` : ''}
                </li>
              ))}
            </ul>
            <h3>出局</h3>
            <ul>
              {truthData.deaths.length === 0 ? <li>还没有人出局。</li> : null}
              {truthData.deaths.map((death, index) => (
                <li key={`${death.seat}-${index}`}>
                  {death.seat} 号（第 {death.day} 天，{death.cause}）
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {ctx.self.alive && myTurn ? (
          <SpeechInput remaining={remaining} onSubmit={submit} onSkip={skip} onDraft={syncDraft} />
        ) : null}
        {ctx.self.alive && (ctx.phase === 'DAY_VOTE' || ctx.phase === 'DAY_VOTE_RUNOFF') ? (
          <VoteInput
            targets={ctx.legalTargets
              .filter((target) => typeof target === 'number' && target !== ctx.self.seat)
              .map((target) => Number(target))}
            allowAbstain={ctx.phase === 'DAY_VOTE'}
            onVote={vote}
          />
        ) : null}
        <p className="app__hint">轮到你时可以说说你的怀疑；不认识的词可以在下方的说明里查。</p>
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
