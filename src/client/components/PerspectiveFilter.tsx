/**
 * 视角筛选（RFC-014 §2.4 / AC-9 ~ AC-11）。
 *
 * 选中某个 AI 后，只展示「它当时知道什么」——数据来自把事件截断到该 `seq` 后
 * 重新投影，而不是界面猜。
 */
export function PerspectiveFilter({
  seats,
  selected,
  onSelect,
}: {
  seats: { seat: number; roleLabel: string }[];
  selected: number | null;
  onSelect: (seat: number | null) => void;
}) {
  return (
    <section className="perspective" aria-label="视角筛选">
      <h2>视角</h2>
      <div className="perspective__buttons" role="group" aria-label="选择席位视角">
        <button
          type="button"
          className="button"
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
        >
          全部
        </button>
        {seats.map((seat) => (
          <button
            key={seat.seat}
            type="button"
            className="button"
            aria-pressed={selected === seat.seat}
            onClick={() => onSelect(seat.seat)}
          >
            {seat.seat} 号
          </button>
        ))}
      </div>
    </section>
  );
}
