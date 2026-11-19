import { useEffect, useRef } from 'react';

/**
 * 发言流（RFC-012 §2.1 / §4）。
 *
 * 滚动跟随只在用户已经在底部时启用；否则会把正在往上翻的人顶走。
 */
export interface SpeechLine {
  id: number;
  seat: number;
  text: string;
  degraded?: boolean;
}

export function SpeechFeed({
  lines,
  highlightSeq,
}: {
  lines: SpeechLine[];
  highlightSeq?: number | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    if (!atBottom) return;
    // jsdom（测试环境）没有实现 scrollIntoView；浏览器里才有。
    const target = endRef.current as
      (HTMLElement & { scrollIntoView?: (options?: unknown) => void }) | null;
    target?.scrollIntoView?.({ block: 'end' });
  }, [lines.length]);

  return (
    <section className="feed" aria-label="发言记录">
      <h2>发言记录</h2>
      <ol className="feed__list" ref={containerRef} aria-live="polite">
        {lines.map((line) => (
          <li
            key={line.id}
            className={`feed__line${line.id === highlightSeq ? ' feed__line--highlight' : ''}`}
            data-seq={line.id}
          >
            <span className="feed__seat">{line.seat} 号</span>
            <span className="feed__text">{line.text}</span>
            {line.degraded === true ? <span className="feed__degraded">（模型降级）</span> : null}
          </li>
        ))}
        {lines.length === 0 ? <li className="feed__empty">还没有人发言。</li> : null}
      </ol>
      <div ref={endRef} />
    </section>
  );
}
