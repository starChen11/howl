import type { TimelineEntry } from '@shared/replay';

/**
 * 复盘时间线（RFC-014 §2.2）。
 *
 * 按 `seq` 升序渲染；每条带天数与阶段，降级轮次有标注。
 */
export function Timeline({
  entries,
  degraded,
  highlightSeq,
}: {
  entries: TimelineEntry[];
  degraded?: number[];
  highlightSeq?: number | null;
}) {
  const degradedSet = new Set(degraded ?? []);

  return (
    <section className="replay-timeline" aria-label="复盘时间线">
      <h2>时间线</h2>
      <ol className="replay-timeline__list">
        {entries.map((entry) => (
          <li
            key={entry.seq}
            className={`replay-timeline__item${
              entry.seq === highlightSeq ? ' replay-timeline__item--highlight' : ''
            }`}
            data-replay-seq={entry.seq}
          >
            <span className="replay-timeline__day">第 {entry.day} 天</span>
            {degradedSet.has(entry.seq) ? (
              <span className="replay-timeline__degraded">降级</span>
            ) : null}
            <span className="replay-timeline__text">{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
