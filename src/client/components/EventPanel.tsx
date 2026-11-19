import type { ProjectedContext } from '@shared/project';

/**
 * 公开事件面板（RFC-013 §2.1）。
 *
 * 只显示三类：**死亡播报**、**放逐结果**、**票型**。角色与夜间细节一律不进来——
 * 面板是「已经公开的事实」，不是第二份真相。
 */

export interface PanelEntry {
  seq: number;
  day: number;
  kind: 'death' | 'banish' | 'vote';
  text: string;
}

export function buildPanelEntries(ctx: ProjectedContext): PanelEntry[] {
  const entries: PanelEntry[] = [];
  let day = ctx.day;
  let banished: number | null = null;

  for (const event of ctx.publicEvents) {
    if (event.type === 'DAY_STARTED') {
      day = (event.payload as { day: number }).day;
      continue;
    }

    if (event.type === 'PLAYER_DIED') {
      const seat = (event.payload as { seat: number }).seat;
      entries.push({ seq: event.seq, day, kind: 'death', text: `${seat} 号出局` });
      continue;
    }

    if (event.type === 'VOTE_REVEALED') {
      const votes = (event.payload as { votes: { seat: number; target: number | 'abstain' }[] })
        .votes;
      const parts = votes.map((vote) =>
        vote.target === 'abstain' ? `${vote.seat} 号弃权` : `${vote.seat} 号投 ${vote.target} 号`,
      );
      entries.push({ seq: event.seq, day, kind: 'vote', text: parts.join('，') });
      continue;
    }

    if (event.type === 'PHASE_CHANGED') {
      const to = (event.payload as { to: string }).to;
      if (to === 'DAY_LYNCH' && banished !== null) {
        entries.push({ seq: event.seq, day, kind: 'banish', text: `${banished} 号被放逐` });
        banished = null;
      }
      continue;
    }

    if (event.type === 'VOTE_CAST') {
      banished = null;
    }
  }

  return entries;
}

export function EventPanel({
  entries,
  onJump,
}: {
  entries: PanelEntry[];
  onJump?: (seq: number) => void;
}) {
  return (
    <section className="panel" aria-label="公开事件">
      <h2>公开事件</h2>
      <ol className="panel__list">
        {entries.map((entry) => (
          <li key={`${entry.seq}-${entry.kind}`} className="panel__item">
            <button
              type="button"
              className="panel__jump"
              onClick={() => onJump?.(entry.seq)}
              aria-label={`第 ${entry.day} 天，${entry.text}，跳到发言`}
            >
              第 {entry.day} 天 · #{entry.seq}
            </button>
            <span className="panel__text">{entry.text}</span>
          </li>
        ))}
        {entries.length === 0 ? <li className="panel__empty">还没有公开事件。</li> : null}
      </ol>
    </section>
  );
}
