import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GameViewResponse } from './api';
import { ApiClient } from './api';
import {
  boardAnnouncement,
  buildBoard,
  effectiveBadge,
  effectiveSheriffSeat,
  hasCastSheriffVote,
  hasPendingSheriffChoice,
  isSheriffElectionPhase,
  maskDeathsDuringElection,
  ownWithdrawalDecision,
  sheriffElectionOf,
  sheriffOrderOptions,
  shouldHideDeaths,
} from './game-state';
import { IdCard } from './components/IdCard';
import { VoteInput } from './components/VoteInput';
import { ShootInput } from './components/ShootInput';
import { SelfExposeButton } from './components/SelfExposeButton';
import { NightAction } from './components/NightAction';
import { EventPanel, buildPanelEntries } from './components/EventPanel';
import { SpectatorBar } from './components/SpectatorBar';
import { Notepad } from './components/Notepad';
import { toggleTruth, initialTruthState } from './state/truth-view';
const ReplayPage = lazy(() =>
  import('./pages/ReplayPage').then((m) => ({ default: m.ReplayPage })),
);
import type { ReplaySnapshot } from '@shared/replay';
import { dayLabel } from '@shared/phase-labels';
import { ROLE_LABELS } from '@shared/terms';
import type { TruthView } from '@shared/truth';
import { SeatGrid } from './components/SeatGrid';
import { SpeechFeed, type SpeechLine } from './components/SpeechFeed';
import { SpeechInput } from './components/SpeechInput';
import { StatusBar } from './components/StatusBar';
import { OnboardingHints } from './components/OnboardingHints';
import { ResultModal } from './components/ResultModal';
import { PhaseClock } from './components/PhaseClock';
import {
  BadgeTransferPanel,
  SheriffOrderPicker,
  SheriffSignup,
  SheriffVoteInput,
  SheriffWithdraw,
} from './components/SheriffPanel';
import { latestKeyResult } from './key-result';
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
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedResultSeq, setDismissedResultSeq] = useState(0);
  const [wolfTarget, setWolfTarget] = useState<number | null>(null);
  const [truth, setTruth] = useState(initialTruthState);
  const [truthData, setTruthData] = useState<TruthView | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [replay, setReplay] = useState<ReplaySnapshot | null>(null);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.game(gameId);
      setView(next);
      setRemaining(
        next.timer === null || next.timer === undefined
          ? null
          : Math.max(0, next.timer.remainingSeconds),
      );
      setError(null);
    } catch (cause) {
      // 对局已被释放（GET 410）时仍然可以看复盘：这里退到复盘接口。
      setError(cause instanceof Error ? cause.message : '读取对局失败');
      const snapshot = await api.replay(gameId);
      if (snapshot !== null) setReplay(snapshot);
    }
  }, [api, gameId]);

  // 还有待决定（例如出局后的开枪、死亡警长选警徽去向）时不开放真相视图：
  // 否则可以直接按身份挑人。服务端尚未为警长动作产出 `pending` 时，用相位 + 警长字段兜底。
  const deciding =
    view !== null &&
    ((view.view.pending !== null && view.view.pending !== undefined) ||
      hasPendingSheriffChoice(view.view));
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
    // 轮询快一点：夜间结算/天亮公告要尽快反映到界面（SSE 只承载发言流）。
    const timer = setInterval(() => void refresh(), 150);
    return () => {
      close();
      clearInterval(timer);
    };
  }, [api, gameId, refresh]);

  useEffect(() => {
    const timer = setInterval(
      () => setRemaining((value) => (value === null ? null : Math.max(0, value - 1))),
      1_000,
    );
    return () => clearInterval(timer);
  }, []);

  // 草稿同步（RFC-011 AC-6）：超时后服务端用最后一次草稿提交，而不是丢成弃权。
  const syncDraft = useCallback(
    (text: string) => {
      void api.draft(gameId, text);
    },
    [api, gameId],
  );

  // 首夜竞选期间，投影里即使提前出现了死亡也不能进界面（RFC-022 §13.1）。
  // 这里统一算一份「可展示」的视图，下面所有渲染都读它。
  const safeView = useMemo(
    () => (view === null ? null : maskDeathsDuringElection(view.view)),
    [view],
  );
  const board = useMemo(() => (safeView === null ? null : buildBoard(safeView)), [safeView]);
  const panelEntries = useMemo(
    () => (safeView === null ? [] : buildPanelEntries(safeView)),
    [safeView],
  );

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
    safeView === null ? '' : `${safeView.phase}|${safeView.day}|${board?.speakingSeat ?? 'x'}`;
  useEffect(() => {
    if (safeView === null) return;
    // 播报里不放倒计时：它每秒都变，会把读屏刷屏。
    setAnnouncement(boardAnnouncement(safeView));
  }, [announcementKey]);

  const lines: SpeechLine[] = useMemo(() => {
    if (safeView === null) return [];
    const committed = safeView.publicEvents
      .filter((event) => event.type === 'SPEECH' || event.type === 'SHERIFF_SPEECH')
      .map((event) => {
        const payload = event.payload as { seat: number; text: string };
        return {
          id: event.seq,
          seat: payload.seat,
          text: payload.text,
          // 竞选发言与白天发言分开显示，避免把竞选进度误读成第一天的正式发言。
          ...(event.type === 'SHERIFF_SPEECH' ? { tag: '竞选发言' } : {}),
        };
      })
      // 同一个人连续两条完全相同的正文只保留一条（引擎正常不会产生；
      // 这里兜住流式/重连造成的重复渲染）。
      .filter((line, index, list) => {
        const previous = list[index - 1];
        return previous === undefined || previous.seat !== line.seat || previous.text !== line.text;
      });
    const live =
      stream.phase === 'speaking' || stream.phase === 'done'
        ? [{ id: 1_000_000, seat: stream.seat ?? 0, text: stream.text }]
        : [];
    // 流式发言结束后，引擎的同一条 SPEECH 也会进入 committed；两者文本相同就
    // 不要再显示第二遍（真实模型流式接入后出现的「同一人连发两条」）。
    const liveLine = live[0];
    const duplicated =
      liveLine !== undefined &&
      committed.some((line) => line.seat === liveLine.seat && line.text === liveLine.text);
    return duplicated ? committed : [...committed, ...live];
  }, [safeView, stream]);

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
          playerSeat={view.view.self.seat}
          postmortem={(body) => api.postmortem(gameId, body)}
          loadPerspective={(seat, seq) => api.replayPerspective(gameId, seat, seq)}
          restarting={restarting}
          onRestart={restart}
        />
      </Suspense>
    );
  }

  const ctx = view.view;
  const display = safeView ?? maskDeathsDuringElection(ctx);
  const election = sheriffElectionOf(display);
  const sheriffSeat = effectiveSheriffSeat(display);
  const badge = effectiveBadge(display);
  const orderOptions = sheriffOrderOptions(display);
  const selfSeat = ctx.self.seat;
  const electionActive = isSheriffElectionPhase(ctx.phase);
  const badgeTransferMine =
    ctx.phase === 'DAY_BADGE_TRANSFER' && sheriffSeat === selfSeat && !ctx.self.alive;
  const orderMine = ctx.phase === 'DAY_SHERIFF_ORDER' && sheriffSeat === selfSeat && ctx.self.alive;
  const withdrawalDecision = ownWithdrawalDecision(ctx);
  const castSheriffVote = hasCastSheriffVote(ctx);

  const keyResult =
    latestKeyResult(display.publicEvents, display.day) ??
    // 第一夜由 GAME_STARTED 直接进入，没有 PHASE_CHANGED 事件；这里补一条。
    ((display.phase === 'NIGHT' || display.phase === 'NIGHT_WOLF_CHAT') && display.day === 1
      ? {
          seq: 1,
          title: dayLabel(display.day, display.phase),
          body: `天黑请闭眼，${ROLE_LABELS.wolf}开始行动。`,
          tone: 'info' as const,
        }
      : null);
  const speaking = board.speakingSeat;
  const myTurn = speaking === selfSeat;
  const speechCopy = speechCopyFor(ctx.phase);

  const expose = async () => {
    const result = await api.submit(gameId, {
      action: { type: 'SELF_EXPOSE', ts: Date.now(), seat: ctx.self.seat },
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  /** 警长类动作共用的提交路径（座位、时间戳、版本号都只有一处）。 */
  const sheriffAction = async (action: Record<string, unknown>) => {
    const result = await api.submit(gameId, {
      action: { ...action, ts: Date.now(), seat: selfSeat } as never,
      expectedVersion: view.version,
    });
    if (!result.ok) setError(result.error.message);
    await refresh();
  };

  const nightAction = async (action: {
    type: string;
    target?: number;
    text?: string;
    potion?: string;
    confirmed?: boolean;
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

  const sheriffVote = async (target: number) => {
    await sheriffAction({ type: 'SHERIFF_VOTE', target: target < 0 ? 'abstain' : target });
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
        sheriffSeat={sheriffSeat}
        badge={badge}
      />
      <main className="app__main">
        <div className="app__side">
          <IdCard ctx={display} />
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
        {ctx.phase === 'FINISHED' || remaining === null ? null : (
          <PhaseClock remaining={remaining} />
        )}
        {display.self.alive || ctx.pending !== null || badgeTransferMine ? null : (
          <SpectatorBar truthEnabled={truth.enabled} onToggleTruth={() => void onToggleTruth()} />
        )}
        {shouldHideDeaths(ctx) || !truth.enabled || truthData === null ? null : (
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
            <h3>狼队票型</h3>
            <ul>
              {truthData.wolfVotes.length === 0 ? <li>还没有狼队投票。</li> : null}
              {truthData.wolfVotes.map((round, index) => (
                <li key={`wolf-${round.day}-${index}`}>
                  第 {round.day} 夜：
                  {round.votes
                    .map(
                      (vote) => `${vote.seat}→${vote.target === 'abstain' ? '弃权' : vote.target}`,
                    )
                    .join('、')}
                  {round.tied === undefined ? '' : `（平票：${round.tied.join('、')}）`}
                </li>
              ))}
            </ul>
            <h3>出局</h3>
            <ul>
              {truthData.deaths.length === 0 ? <li>还没有人出局。</li> : null}
              {truthData.deaths.map((death, index) => (
                <li key={`${death.seat}-${index}`}>
                  {death.seat} 号（
                  {dayLabel(
                    death.day,
                    death.cause === 'wolf' || death.cause === 'poison' ? 'NIGHT' : 'DAY',
                  )}
                  ，{death.cause}）
                </li>
              ))}
            </ul>
          </section>
        )}
        {ctx.phase === 'DAY_SHERIFF_SIGNUP' && display.self.alive ? (
          <SheriffSignup
            election={election}
            selfSeat={selfSeat}
            onSignup={(run) => void sheriffAction({ type: 'SHERIFF_SIGNUP', run })}
          />
        ) : null}
        {ctx.phase === 'DAY_SHERIFF_WITHDRAW' ? (
          <SheriffWithdraw
            candidates={election.candidates}
            withdrawn={election.withdrawn}
            selfSeat={selfSeat}
            decided={withdrawalDecision}
            onWithdraw={(withdraw) => void sheriffAction({ type: 'SHERIFF_WITHDRAW', withdraw })}
          />
        ) : null}
        {(ctx.phase === 'DAY_SHERIFF_VOTE' || ctx.phase === 'DAY_SHERIFF_RUNOFF') &&
        election.isVoter &&
        display.self.alive &&
        !castSheriffVote ? (
          <SheriffVoteInput
            election={election}
            selfSeat={selfSeat}
            onVote={(target) => void sheriffVote(target)}
          />
        ) : null}
        {orderMine ? (
          <SheriffOrderPicker
            options={orderOptions}
            onChoose={(startSeat, direction) =>
              void sheriffAction({ type: 'SHERIFF_ORDER', startSeat, direction })
            }
          />
        ) : null}
        {badgeTransferMine ? (
          <BadgeTransferPanel
            targets={ctx.aliveSeats.filter((seat) => seat !== selfSeat)}
            onTransfer={(target) => void sheriffAction({ type: 'BADGE_TRANSFER', target })}
          />
        ) : null}
        {display.self.alive && myTurn ? (
          <SpeechInput
            remaining={remaining ?? 0}
            onSubmit={submit}
            onSkip={skip}
            onDraft={syncDraft}
            heading={speechCopy.heading}
            hint={speechCopy.hint}
            submitLabel={speechCopy.submitLabel}
            skipLabel={speechCopy.skipLabel}
          />
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
            chatSeconds={view.timer?.totalSeconds ?? 100}
            currentRemaining={remaining}
            readyAfterSeconds={__HOWL_FAKE_AI__ ? 0 : 30}
            readySeats={currentNightWolfEvents(ctx.privateEvents)
              .filter((event) => event.type === 'WOLF_READY_MARKED')
              .map((event) => (event.payload as { seat: number }).seat)}
            wolfCount={
              ctx.knowledge.teammates.filter((teammate) => ctx.aliveSeats.includes(teammate))
                .length + 1
            }
            selfReady={currentNightWolfEvents(ctx.privateEvents).some(
              (event) =>
                event.type === 'WOLF_READY_MARKED' &&
                (event.payload as { seat: number }).seat === ctx.self.seat,
            )}
            onReady={() => void nightAction({ type: 'WOLF_READY' })}
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
            selfSeat={ctx.self.seat}
            localTarget={wolfTarget}
            selfConfirmed={currentWolfVotes(ctx.privateEvents).some(
              (vote) => vote.seat === ctx.self.seat && vote.confirmed,
            )}
            onConfirmVote={() => {
              // 原子确认：直接带目标提交一条 confirmed 的票，避免「选择还没落库、
              // 确认按钮已可点」的竞态。
              const target =
                wolfTarget ??
                currentWolfVotes(ctx.privateEvents).find((vote) => vote.seat === ctx.self.seat)
                  ?.target;
              if (typeof target !== 'number') return;
              setWolfTarget(null);
              void nightAction({ type: 'WOLF_VOTE', target, confirmed: true });
            }}
            wolfChats={currentNightWolfEvents(ctx.privateEvents)
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
                  ? (setWolfTarget(target), { type: 'WOLF_VOTE', target, confirmed: false })
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
        {display.self.alive && (ctx.phase === 'DAY_VOTE' || ctx.phase === 'DAY_VOTE_RUNOFF') ? (
          <VoteInput
            targets={ctx.legalTargets
              .filter(
                (target) =>
                  typeof target === 'number' &&
                  target !== ctx.self.seat &&
                  // 第二道防线：即使服务端清单晚了一拍，客户端也不显示已知出局的人。
                  ctx.aliveSeats.includes(target),
              )
              .map((target) => Number(target))}
            allowAbstain={ctx.phase === 'DAY_VOTE'}
            onVote={vote}
          />
        ) : null}
        {display.self.alive && ctx.self.role === 'wolf' && canSelfExpose(ctx.phase) ? (
          <SelfExposeButton onExpose={() => void expose()} />
        ) : null}
        <p className="app__hint">
          {electionActive
            ? '竞选阶段：上警的人发言，警下的人投票选出警长。'
            : '轮到你时可以说说你的怀疑；不认识的词可以在下方的说明里查。'}
        </p>
        <OnboardingHints role={ctx.self.role} goal="先听一两轮，再决定信谁。" />
      </footer>
      {error === null ? null : (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
      {keyResult !== null && keyResult.seq > dismissedResultSeq ? (
        <ResultModal result={keyResult} onClose={() => setDismissedResultSeq(keyResult.seq)} />
      ) : null}
    </div>
  );
}

interface SpeechCopy {
  heading: string;
  hint: string;
  submitLabel: string;
  skipLabel: string;
}

/** 竞选 / PK / 归票复用同一个输入框，只换文案（RFC-022 §7）。 */
function speechCopyFor(phase: string): SpeechCopy {
  switch (phase) {
    case 'DAY_SHERIFF_SPEECH':
      return {
        heading: '竞选发言',
        hint: '你是警上候选人：说说你为什么适合当警长，以及你打算怎么带队。',
        submitLabel: '发言',
        skipLabel: '跳过',
      };
    case 'DAY_SHERIFF_PK':
      return {
        heading: 'PK 发言',
        hint: '平票了：再说一轮，争取警下的票。',
        submitLabel: '发言',
        skipLabel: '跳过',
      };
    case 'DAY_SHERIFF_FINAL_SPEECH':
      return {
        heading: '警长归票发言',
        hint: '所有人都说完了。这是你额外的一次归票发言，说完就进入投票。',
        submitLabel: '归票发言',
        skipLabel: '跳过',
      };
    default:
      return {
        heading: '你的发言',
        hint: '可以说说：你怀疑谁、为什么；你相信谁、为什么。',
        submitLabel: '发言',
        skipLabel: '过',
      };
  }
}

/** 自曝在竞选期间也能提交（RFC-022 §2.2）；归票阶段引擎只收发言。 */
function canSelfExpose(phase: string): boolean {
  return (
    phase === 'DAY_SPEECH' ||
    phase === 'DAY_PK_SPEECH' ||
    phase === 'DAY_VOTE' ||
    isSheriffElectionPhase(phase)
  );
}

/**
 * 当前这一轮狼队票型（RUL-13）。
 *
 * 不能把整局的 `WOLF_VOTE_CAST` 都算进去：唱票（`WOLF_VOTE_REVEALED`）会开新一轮，
 * 跨夜与跨轮都要重置，否则界面会显示上一轮甚至上一夜的票。
 */
function currentNightWolfEvents(events: { type: string; payload: unknown }[]) {
  // 新一夜从「上一次唱票/刀口」之后开始：聊天、准备、票型都只取这一段。
  let start = 0;
  events.forEach((event, index) => {
    if (event.type === 'WOLF_VOTE_REVEALED' || event.type === 'WOLF_KILL_CHOSEN') {
      start = index + 1;
    }
  });
  return events.slice(start);
}

function currentWolfVotes(
  events: { type: string; payload: unknown }[],
): { seat: number; target: number | 'abstain'; confirmed: boolean }[] {
  const votes = new Map<number, { seat: number; target: number | 'abstain'; confirmed: boolean }>();
  for (const event of currentNightWolfEvents(events)) {
    if (event.type === 'WOLF_VOTE_CAST') {
      const payload = event.payload as {
        seat: number;
        target: number | 'abstain';
        confirmed: boolean;
      };
      votes.set(payload.seat, payload);
    }
    if (event.type === 'WOLF_VOTE_CONFIRMED') {
      const payload = event.payload as { seat: number };
      const existing = votes.get(payload.seat);
      if (existing !== undefined) votes.set(payload.seat, { ...existing, confirmed: true });
    }
  }
  return [...votes.values()];
}
