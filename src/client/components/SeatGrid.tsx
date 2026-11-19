import type { SeatView } from '../game-state';

/**
 * 席位与发言顺序（RFC-012 §2.3）。
 *
 * 三项状态都要能看出来：当前发言者、未发言者、已出局者。**不只用颜色**——
 * 每个状态都带文字（AC-14）。
 */
export function SeatGrid({
  seats,
  onSelect,
}: {
  seats: SeatView[];
  onSelect?: (seat: number) => void;
}) {
  return (
    <section className="seats" aria-label="席位">
      <h2>席位</h2>
      <ul className="seats__list">
        {seats.map((seat) => {
          const status = !seat.alive
            ? '已出局'
            : seat.speaking
              ? '正在发言'
              : seat.hasSpoken
                ? '已发言'
                : '未发言';

          return (
            <li
              key={seat.seat}
              className={`seat seat--${!seat.alive ? 'dead' : seat.speaking ? 'speaking' : 'alive'}`}
            >
              <button
                type="button"
                className="seat__button"
                aria-pressed={seat.speaking}
                aria-label={`${seat.seat} 号：${status}${seat.isSelf ? '（你）' : ''}`}
                onClick={() => onSelect?.(seat.seat)}
                disabled={onSelect === undefined}
              >
                <span className="seat__number">{seat.seat}</span>
                <span className="seat__status">{status}</span>
                {seat.isSelf ? <span className="seat__you">你</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
