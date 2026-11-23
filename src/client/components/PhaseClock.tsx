import { countdownText, clockText } from '../game-state';

/** 本阶段的大号倒计时：不随页面滚动消失，最后 10 秒变红。 */
export function PhaseClock({ remaining }: { remaining: number }) {
  const urgent = remaining > 0 && remaining <= 10;
  return (
    <div className={`phase-clock${urgent ? ' phase-clock--urgent' : ''}`}>
      <span className="phase-clock__label">本阶段剩余</span>
      <strong className="phase-clock__value">{clockText(remaining)}</strong>
      <span className="phase-clock__hint">{countdownText(remaining)}</span>
    </div>
  );
}
