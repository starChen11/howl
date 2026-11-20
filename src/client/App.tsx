import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GameViewResponse } from './api';
import { ApiClient } from './api';
import { boardAnnouncement, buildBoard, speakingSeat } from './game-state';
import { IdCard } from './components/IdCard';
import { VoteInput } from './components/VoteInput';
import { ShootInput } from './components/ShootInput';
import { NightAction } from './components/NightAction';
import { EventPanel, buildPanelEntries } from './components/EventPanel';
import { SpectatorBar } from './components/SpectatorBar';
import { Notepad } from './components/Notepad';
import { toggleTruth, initialTruthState } from './state/truth-view';
const ReplayPage = lazy(() =>
  import('./pages/ReplayPage').then((m) => ({ default: m.ReplayPage })),
);
import type { ReplaySnapshot } from '@shared/replay';
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
export function App({ gameId, client }: { gameId: string; client?: ApiClient }) {
  // 客户端实例必须**在多次渲染之间保持同一个**：`client` 出现在 effect 的依赖里，
  // 每次渲染新建一个会让 SSE 订阅与轮询在每次渲染时重建——浏览器会对同一个流
  // 反复重连，日志里就是刷屏的 `stream closed prematurely`（真实 bug，e2e 没抓到
  // 是因为测试注入的假 client 恰好是稳定的）。
  const clientRef = useRef<ApiClient | null>(null);
  if (clientRef.current === null) clientRef.current = client ?? new ApiClient();
  const api = clientRef.current;
  const [view, setView] = useState<GameViewResponse | null>(null);
  const [stream, setStream] = useState<StreamState>(initialStreamState);
  const [remaining, setRemaining] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [truth, setTruth] = useState(initialTruthState);
  const [truthData, setTruthData] = useState<TruthView | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [replay, setReplay] = useState<ReplaySnapshot | null>(null);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setView(await api.game(gameId));
      setError(null);
    } catch (cause) {
      // 对局已被释放（GET 410）时仍然可以看复盘：这里退到复盘接口。
      setError(cause instanceof Error ? cause.message : '读取对局失败');
      const snapshot = await api.replay(gameId);
      if (snapshot !== null) setReplay(snapshot);
    }
  }, [api, gameId]);

  // 还有待决定（例如出局后的开枪）时不开放真相视图：否则可以直接按身份挑人。
  const deciding = view?.view.pending !== null && view?.view.pending !== undefined;
  useEffect(() => {
    if (deciding && truth.enabled) setTruth({ enabled: false });
  }, [deciding, truth.enabled]);

  // 终局后取复盘（RFC-014）：同一个页面切换，不加路由。
  useEffect(() => {
    if (view?.view.phase !== 'FINISHED') return;
    let cancelled = false;
    void api.replay(gameId).then((snapshot) => {
      if (!cancelled) setReplay(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [api, gameId, view?.view.phase]);

  useEffect(() => {
    void refresh();
    const close = api.openStream(gameId, (message) =>
      setStream((previous) => streamReducer(previous, message, Date.now())),
    );
    const timer = setInterval(() => void refresh(), 1_000);
    return () => {
      close();
      clearInterval(timer);
    };
  }, [api, gameId, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);

  // 草稿同步（RFC-011 AC-6）：超时后服务端用最后一次草稿提交，而不是丢成弃权。
  const syncDraft = useCallback(
    (text: string) => {
      void api.draft(gameId, text);
    },
    [api, gameId],
  );

  const board = useMemo(() => (view === null ? null : buildBoard(view.view)), [view]);
  const panelEntries = useMemo(() => (view === null ? [] : buildPanelEntries(view.view)), [view]);

  const restart = useCallback(() => {
    setRestarting(true);
    void api.restart().then((nextGameId) => {
      if (nextGameId !== null) window.location.search = `?game=${nextGameId}`;
      else setRestarting(false);
    });
  }, [api]);

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
    setTruthData(await api.truth(gameId));
  }, [api, gameId, truth]);

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
    if (replay !== null) {
      return (
        <Suspense fallback={<p role="status">正在载入…</p>}>
          <ReplayPage snapshot={replay} onRestart={restart} />
        </Suspense>
      );
    }
    return <p role="status">正在载入对局…</p>;
  }

  if (view.view.phase === 'FINISHED' && replay !== null) {
    return (
      <Suspense fallback={<p role="status">正在载入…</p>}>
        <ReplayPage
          snapshot={replay}
          loadPerspective={(seat, seq) => api.replayPerspective(gameId, seat, seq)}
          restarting={restarting}
          onRestart={restart}
        />
      </Suspense>
    );
  }

  const ctx = view.view;
  const speaking = speakingSeat(ctx);
  const myTurn = speaking === ctx.self.seat;

  const nightAction = async (action: {
    type: string;
    target?: number;
    text?: string;
    potion?: string;
  }) => {
    const result = await api.submit(gameId, {
      action: { ...action, ts: Date.now(), seat: ctx.self.seat } as never,
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const shoot = async (target: number | null) => {
    const result = await api.submit(gameId, {
      action: {
        type: 'HUNTER_SHOOT',
        ts: Date.now(),
        seat: ctx.self.seat,
        ...(target === null ? {} : { target: target as never }),
      },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const submit = async (text: string) => {
    const result = await api.submit(gameId, {
      action: { type: 'SPEECH', ts: Date.now(), seat: ctx.self.seat, text },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const vote = async (target: number) => {
    const result = await api.submit(gameId, {
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
    const result = await api.submit(gameId, {
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
        {ctx.self.alive || ctx.pending !== null ? null : (
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
        {ctx.pending === 'chat' ||
        ctx.pending === 'kill' ||
        ctx.pending === 'check' ||
        ctx.pending === 'witch' ||
        ctx.wolfVoteOpen === true ? (
          <NightAction
            pending={
              ctx.pending === 'wolf-vote' || ctx.pending === 'wolf-runoff'
                ? ctx.pending
                : ctx.wolfVoteOpen === true
                  ? 'wolf-vote'
                  : (ctx.pending as 'chat' | 'kill' | 'check' | 'witch')
            }
            hasVoted={currentWolfVotes(ctx.privateEvents).some(
              (vote) => vote.seat === ctx.self.seat,
            )}
            waiting={
              ctx.wolfVoteOpen === true &&
              ctx.pending !== 'wolf-vote' &&
              ctx.pending !== 'wolf-runoff'
            }
            targets={
              ctx.wolfCandidates ??
              ctx.legalTargets
                .filter(
                  (target) =>
                    typeof target === 'number' &&
                    target !== ctx.self.seat &&
                    // 刀人不能指向队友（旧 WOLF_KILL 路径仍保留这一过滤）
                    !(ctx.pending === 'kill' && ctx.knowledge.teammates.includes(target)),
                )
                .map((target) => Number(target))
            }
            wolfVotes={currentWolfVotes(ctx.privateEvents)}
            wolfChats={ctx.privateEvents
              .filter((event) => event.type === 'WOLF_CHAT_POSTED')
              .map((event) => ({
                seat: (event.payload as { seat: number }).seat,
                text: (event.payload as { text: string }).text,
              }))}
            potions={ctx.knowledge.potions}
            killTarget={ctx.knowledge.knownKillTarget}
            onChat={(text) => void nightAction({ type: 'WOLF_CHAT', text })}
            onTarget={(target) =>
              void nightAction(
                ctx.pending === 'wolf-vote' || ctx.pending === 'wolf-runoff'
                  ? { type: 'WOLF_VOTE', target }
                  : {
                      type: ctx.pending === 'kill' ? 'WOLF_KILL' : 'SEER_CHECK',
                      target,
                    },
              )
            }
            onWitch={(choice) => {
              if (choice === 'none') {
                void nightAction({ type: 'WITCH_ACT', potion: 'none' });
                return;
              }
              const [potion, raw] = choice.split(':');
              void nightAction({
                type: 'WITCH_ACT',
                potion: potion as 'heal' | 'poison',
                target: Number(raw),
              });
            }}
          />
        ) : null}
        {ctx.pending === 'shoot' ? (
          <ShootInput
            targets={ctx.legalTargets
              .filter((target) => typeof target === 'number' && target !== ctx.self.seat)
              .map((target) => Number(target))}
            onShoot={(target) => void shoot(target)}
          />
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

/**
 * 当前这一轮狼队票型（RUL-13）。
 *
 * 不能把整局的 `WOLF_VOTE_CAST` 都算进去：唱票（`WOLF_VOTE_REVEALED`）会开新一轮，
 * 跨夜与跨轮都要重置，否则界面会显示上一轮甚至上一夜的票。
 */
function currentWolfVotes(
  events: { type: string; payload: unknown }[],
): { seat: number; target: number }[] {
  let current: { seat: number; target: number }[] = [];
  for (const event of events) {
    if (event.type === 'WOLF_VOTE_REVEALED') {
      current = [];
      continue;
    }
    if (event.type === 'WOLF_VOTE_CAST') {
      const payload = event.payload as { seat: number; target: number };
      current = [...current, { seat: payload.seat, target: payload.target }];
    }
  }
  return current;
}
