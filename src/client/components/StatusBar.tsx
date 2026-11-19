import { useEffect, useState } from 'react';

import { countdownText } from '../game-state';

/**
 * 顶部状态条（RFC-012 §2.1 / AC-1 / AC-14）。
 *
 * 倒计时用 `aria-live="polite"`，但**不每秒播报**：每 10 秒或最后 10 秒才更新，
 * 否则读屏会被读秒刷屏。
 */
export function StatusBar({
  day,
  phase,
  aliveCount,
  remaining,
  speakingSeat,
}: {
  day: number;
  phase: string;
  aliveCount: number;
  remaining: number;
  speakingSeat: number | null;
}) {
  const [announced, setAnnounced] = useState(remaining);

  useEffect(() => {
    // 只在「整十秒」与「最后十秒」更新播报文本
    if (remaining <= 10 || announced - remaining >= 10 || remaining > announced) {
      setAnnounced(remaining);
    }
  }, [remaining, announced]);

  return (
    <header className="status" aria-label="对局状态">
      <h1 className="status__title">Howl</h1>
      <dl className="status__facts">
        <div>
          <dt>天数</dt>
          <dd>第 {day} 天</dd>
        </div>
        <div>
          <dt>阶段</dt>
          <dd>{phase === 'DAY_SPEECH' ? '轮流发言' : phase}</dd>
        </div>
        <div>
          <dt>存活</dt>
          <dd>{aliveCount} 人</dd>
        </div>
        <div>
          <dt>轮次</dt>
          <dd>{speakingSeat === null ? '等待' : `${speakingSeat} 号发言`}</dd>
        </div>
      </dl>
      <p className="status__timer" role="timer" aria-live="polite">
        {countdownText(announced)}
      </p>
    </header>
  );
}
