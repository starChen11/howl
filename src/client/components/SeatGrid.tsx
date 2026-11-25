import type { SeatView } from '../game-state';

/**
 * 席位与发言顺序（RFC-012 §2.3 / RFC-022 §7）。
 *
 * 三项状态都要能看出来：当前发言者、未发言者、已出局者。**不只用颜色**——
 * 每个状态都带文字（AC-14）。警长 / 警上 / 警下同样用文字标出。
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

          const tags = [
            seat.sheriff === true ? '警长' : null,
            seat.withdrawn === true ? '已退水' : seat.candidate === true ? '警上' : null,
            seat.voter === true ? '警下' : null,
          ].filter((tag): tag is string => tag !== null);

          return (
            <li
              key={seat.seat}
              className={`seat seat--${!seat.alive ? 'dead' : seat.speaking ? 'speaking' : 'alive'}`}
            >
              <button
                type="button"
                className="seat__button"
                aria-pressed={seat.speaking}
                aria-label={`${seat.seat} 号：${status}${
                  tags.length === 0 ? '' : `（${tags.join('，')}）`
                }${seat.isSelf ? '（你）' : ''}`}
                onClick={() => onSelect?.(seat.seat)}
                disabled={onSelect === undefined}
              >
                <span className="seat__number">{seat.seat}</span>
                <span className="seat__status">{status}</span>
                {seat.sheriff === true ? <span className="seat__badge">警长 · 1.5 票</span> : null}
                {seat.withdrawn === true ? (
                  <span className="seat__tag">已退水</span>
                ) : seat.candidate === true ? (
                  <span className="seat__tag">警上</span>
                ) : null}
                {seat.voter === true ? <span className="seat__tag">警下</span> : null}
                {seat.isSelf ? <span className="seat__you">你</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
