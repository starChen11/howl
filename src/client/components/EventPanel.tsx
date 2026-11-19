import type { ProjectedContext } from '@shared/project';

/**
 * 公开事件面板（RFC-013 §2.1）。
 *
 * 只显示三类：**死亡播报**、**放逐结果**、**票型**。角色与夜间细节一律不进来——
 * 面板是「已经公开的事实」，不是第二份真相。
 *
 * 每条还带 `anchor`：发言流里最近一条「此前已发生」的发言 `seq`。事件与发言是两套
 * 不同的 `seq`，直接用自己的 `seq` 去高亮永远匹配不到（评审 C-134）。
 */

export interface PanelEntry {
  seq: number;
  day: number;
  kind: 'death' | 'banish' | 'vote';
  text: string;
  /** 发言流里可以定位到的 `seq`；没有对应发言时为 `null`。 */
  anchor: number | null;
}

export function buildPanelEntries(ctx: ProjectedContext): PanelEntry[] {
  const entries: PanelEntry[] = [];
  let day = ctx.day;

  // 发言事件按 seq 递增，方便「找此前的最后一条」。
  const speeches = ctx.publicEvents
    .filter((event) => event.type === 'SPEECH')
    .map((event) => event.seq);

  const anchorFor = (seq: number): number | null => {
    let found: number | null = null;
    for (const speechSeq of speeches) {
      if (speechSeq <= seq) found = speechSeq;
      else break;
    }
    return found ?? speeches[0] ?? null;
  };

  for (const event of ctx.publicEvents) {
    if (event.type === 'DAY_STARTED') {
      const payload = event.payload as { day: number; diedLastNight: number[] };
      day = payload.day;
      // 夜间死亡在「天亮」时公布——这才是玩家看到的死亡播报（C-135）。
      for (const seat of payload.diedLastNight) {
        entries.push({
          seq: event.seq,
          day,
          kind: 'death',
          text: `${seat} 号出局`,
          anchor: anchorFor(event.seq),
        });
      }
      continue;
    }

    if (event.type === 'PLAYER_DIED') {
      const payload = event.payload as { seat: number; cause: string };
      // 夜间死亡已经由「天亮」那条播报过了；这里只补**放逐**与**枪杀**。
      if (payload.cause === 'lynch' || payload.cause === 'shoot') {
        entries.push({
          seq: event.seq,
          day,
          kind: payload.cause === 'lynch' ? 'banish' : 'death',
          text:
            payload.cause === 'lynch' ? `${payload.seat} 号被放逐` : `${payload.seat} 号被开枪带走`,
          anchor: anchorFor(event.seq),
        });
      }
      continue;
    }

    if (event.type === 'VOTE_REVEALED') {
      const votes = (event.payload as { votes: { seat: number; target: number | 'abstain' }[] })
        .votes;
      const parts = votes.map((vote) =>
        vote.target === 'abstain' ? `${vote.seat} 号弃权` : `${vote.seat} 号投 ${vote.target} 号`,
      );
      entries.push({
        seq: event.seq,
        day,
        kind: 'vote',
        text: parts.join('，'),
        anchor: anchorFor(event.seq),
      });
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
          <li key={`${entry.seq}-${entry.kind}-${entry.text}`} className="panel__item">
            <button
              type="button"
              className="panel__jump"
              onClick={() => {
                if (entry.anchor !== null) onJump?.(entry.anchor);
              }}
              disabled={entry.anchor === null}
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
