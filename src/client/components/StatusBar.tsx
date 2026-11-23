import { dayLabel, phaseLabel } from '@shared/phase-labels';

import { countdownText } from '../game-state';

/**
 * 顶部状态条（RFC-012 §2.1 / AC-1 / AC-14）。
 *
 * 倒计时视觉上每秒更新（醒目），但读屏不每秒播报：`aria-live` 关闭，
 * 由 App 的阶段播报负责。
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
  return (
    <header className="status" aria-label="对局状态">
      <h1 className="status__title">Howl</h1>
      <dl className="status__facts">
        <div>
          <dt>进程</dt>
          <dd>{dayLabel(day, phase)}</dd>
        </div>
        <div>
          <dt>阶段</dt>
          <dd>{phaseLabel(phase)}</dd>
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
      <p className="status__timer" role="timer" aria-live="off">
        {countdownText(remaining)}
      </p>
    </header>
  );
}
