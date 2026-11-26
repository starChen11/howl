import { useEffect, useMemo, useState } from 'react';

import type { ProjectedContext } from '@shared/project';

import type { ReplaySnapshot } from '@shared/replay';
import type { PostmortemRequest, PostmortemResponse } from '@shared/postmortem';
import { ROLE_LABELS } from '@shared/terms';

import { PerspectiveFilter } from '../components/PerspectiveFilter';
import { ThoughtCard } from '../components/ThoughtCard';
import { Timeline } from '../components/Timeline';
import { PostmortemPanel } from '../components/PostmortemPanel';

/**
 * 复盘主视图（RFC-014 §3）。
 *
 * 对局结束后在**同一个页面**切换过来（用户选的 A 方案）：不加路由、不加导航。
 * 「再来一局」交给调用方（App）处理，这一页只负责展示与通知。
 */
export interface ReplayPageProps {
  snapshot: ReplaySnapshot;
  onRestart: () => void;
  restarting?: boolean;
  /** 取某席位在某个 seq 的视角；不传则不显示视角面板（单测用）。 */
  loadPerspective?: (
    seat: number,
    seq: number,
  ) => Promise<{ seat: number; seq: number; view: ProjectedContext } | null>;
  /** 赛后拷问的模型入口；单测不传时不显示赛后环节。 */
  postmortem?: (body: PostmortemRequest) => Promise<PostmortemResponse>;
  playerSeat?: number;
}

export function ReplayPage({
  snapshot,
  onRestart,
  restarting = false,
  loadPerspective,
  postmortem,
  playerSeat,
}: ReplayPageProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [perspective, setPerspective] = useState<{
    seat: number;
    seq: number;
    view: ProjectedContext;
  } | null>(null);

  // 选中席位时拉取「它当时的世界」（AC-9 ~ AC-11）。
  useEffect(() => {
    if (selected === null || loadPerspective === undefined) {
      setPerspective(null);
      return;
    }
    const seq = snapshot.timeline[snapshot.timeline.length - 1]?.seq ?? 0;
    let cancelled = false;
    void loadPerspective(selected, seq).then((value) => {
      if (!cancelled) setPerspective(value);
    });
    return () => {
      cancelled = true;
    };
  }, [loadPerspective, selected, snapshot.timeline]);

  // 筛选不改变时间线，只叠加「该席位当时的推理」（AC-10）。
  const thoughts = useMemo(
    () =>
      selected === null
        ? snapshot.thoughts
        : snapshot.thoughts.filter((thought) => thought.seat === selected),
    [snapshot.thoughts, selected],
  );

  return (
    <div className="replay">
      <header className="replay__header">
        <h1>复盘</h1>
        <p className="replay__result" role="status">
          {snapshot.result === 'wolf' ? `${ROLE_LABELS.wolf}阵营胜利` : '好人阵营胜利'}：
          {snapshot.winCondition}
        </p>
        <p className="replay__meta">
          共 {snapshot.timeline.length} 条记录 · 降级 {snapshot.degraded.length} 次
          {snapshot.usage === undefined || snapshot.usage.calls === 0
            ? ''
            : ` · 模型调用 ${snapshot.usage.calls} 次，输入 ${snapshot.usage.inputTokens} / 输出 ${snapshot.usage.outputTokens} tokens`}
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={onRestart}
          disabled={restarting}
        >
          {restarting ? '正在开新局…' : '再来一局'}
        </button>
      </header>

      <section className="replay__seats" aria-label="身份">
        <h2>身份</h2>
        <ul>
          {snapshot.seats.map((seat) => (
            <li key={seat.seat}>
              {seat.seat} 号：{seat.roleLabel}
              {seat.personaLabel === null ? '' : `（${seat.personaLabel}）`}
              {seat.alive ? '' : '（已出局）'}
            </li>
          ))}
        </ul>
      </section>

      <PerspectiveFilter seats={snapshot.seats} selected={selected} onSelect={setSelected} />

      {perspective === null ? null : (
        <section className="replay__perspective" aria-label="席位视角">
          <h2>{perspective.seat} 号当时知道什么</h2>
          <ul>
            {perspective.view.publicEvents.map((event) => (
              <li key={`pub-${event.seq}`}>公开：{event.type}</li>
            ))}
            {perspective.view.privateEvents.map((event) => (
              <li key={`priv-${event.seq}`}>私有：{event.type}</li>
            ))}
            {perspective.view.publicEvents.length + perspective.view.privateEvents.length === 0 ? (
              <li>什么都不知道。</li>
            ) : null}
          </ul>
        </section>
      )}

      <Timeline entries={snapshot.timeline} degraded={snapshot.degraded} highlightSeq={highlight} />

      <section className="replay__thoughts" aria-label="推理">
        <h2>推理</h2>
        {thoughts.length === 0 ? (
          <p>这一局没有记录到推理。脚本替身 AI 不产出理由；接入真实模型后，每一轮都会有。</p>
        ) : null}
        {thoughts.map((thought) => (
          <button
            key={`${thought.seq}-${thought.seat}`}
            type="button"
            className="thought__jump"
            onClick={() => setHighlight(thought.seq)}
            aria-label={`跳到第 ${thought.seq} 条`}
          >
            <ThoughtCard thought={thought} />
          </button>
        ))}
      </section>
      {postmortem === undefined || playerSeat === undefined ? null : (
        <PostmortemPanel snapshot={snapshot} playerSeat={playerSeat} ask={postmortem} />
      )}
    </div>
  );
}
