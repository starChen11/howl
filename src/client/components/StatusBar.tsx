import type { SheriffBadgeState } from '@shared/domain';
import { dayLabel, phaseLabel } from '@shared/phase-labels';

import { countdownText } from '../game-state';

/**
 * 顶部状态条（RFC-012 §2.1 / AC-1 / AC-14；RFC-022 §7 增加警长）。
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
  sheriffSeat,
  badge,
}: {
  day: number;
  phase: string;
  aliveCount: number;
  remaining: number | null;
  speakingSeat: number | null;
  /** `number` = 当前警长；`null` = 本局无警长；`undefined` = 还没产生（旧投影）。 */
  sheriffSeat?: number | null | undefined;
  badge?: SheriffBadgeState | undefined;
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
        <div>
          <dt>警长</dt>
          <dd>{sheriffText(sheriffSeat, badge)}</dd>
        </div>
      </dl>
      {remaining === null ? null : (
        <p className="status__timer" role="timer" aria-live="off">
          {countdownText(remaining)}
        </p>
      )}
    </header>
  );
}

/** 警长一栏的文案：既是「谁」，也是 1.5 票的可见说明（RFC-022 §3.1 / §7）。 */
export function sheriffText(
  sheriffSeat: number | null | undefined,
  badge: SheriffBadgeState | undefined,
): string {
  if (typeof sheriffSeat === 'number') return `${sheriffSeat} 号（1.5 票）`;
  if (badge === 'destroyed') return '警徽已撕';
  if (sheriffSeat === null) return '本局无警长';
  return '尚未产生';
}
