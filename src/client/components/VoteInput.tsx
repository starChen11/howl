/**
 * 投票输入（RFC-012 AC-11 的「发言 → 投票」）。
 *
 * 用一组按钮而不是下拉框：键盘可直接 Tab + Enter，读屏也能读出每个目标。
 */
export function VoteInput({
  targets,
  allowAbstain,
  onVote,
}: {
  /** 允许投的席位：重投时只有并列者（来自投影的 `legalTargets`）。 */
  targets: number[];
  /** 重投不能弃权（RUL-2）。 */
  allowAbstain: boolean;
  onVote: (target: number) => void;
}) {
  return (
    <section className="vote" aria-label="投票">
      <h2>投票</h2>
      <ul className="vote__list">
        {targets.map((seat) => (
          <li key={seat}>
            <button type="button" className="button" onClick={() => onVote(seat)}>
              投 {seat} 号
            </button>
          </li>
        ))}
      </ul>
      {allowAbstain ? (
        <button type="button" className="button" onClick={() => onVote(-1)}>
          弃权
        </button>
      ) : null}
    </section>
  );
}
