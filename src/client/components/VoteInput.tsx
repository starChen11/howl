/**
 * 投票输入（RFC-012 AC-11 的「发言 → 投票」）。
 *
 * 用一组按钮而不是下拉框：键盘可直接 Tab + Enter，读屏也能读出每个目标。
 */
export function VoteInput({
  aliveSeats,
  onVote,
}: {
  aliveSeats: number[];
  onVote: (target: number) => void;
}) {
  return (
    <section className="vote" aria-label="投票">
      <h2>投票</h2>
      <ul className="vote__list">
        {aliveSeats.map((seat) => (
          <li key={seat}>
            <button type="button" className="button" onClick={() => onVote(seat)}>
              投 {seat} 号
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="button" onClick={() => onVote(-1)}>
        弃权
      </button>
    </section>
  );
}
