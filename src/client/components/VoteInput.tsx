/**
 * 投票输入（RFC-012 AC-11 的「发言 → 投票」；RFC-022 §7 的警下投票复用同一套按钮）。
 *
 * 用一组按钮而不是下拉框：键盘可直接 Tab + Enter，读屏也能读出每个目标。
 */
export function VoteInput({
  targets,
  allowAbstain,
  onVote,
  title = '投票',
  hint,
  abstainLabel = '弃权',
}: {
  /** 允许投的席位：重投时只有并列者（来自投影的 `legalTargets`）。 */
  targets: number[];
  /** 重投不能弃权（RUL-2 / RFC-022 的警长重投）。 */
  allowAbstain: boolean;
  onVote: (target: number) => void;
  /** 面板标题。警长投票传「警下投票」/「警长重投」。 */
  title?: string;
  /** 面板说明。 */
  hint?: string;
  abstainLabel?: string;
}) {
  return (
    <section className="vote" aria-label={title}>
      <h2>{title}</h2>
      {hint === undefined ? null : <p className="vote__hint">{hint}</p>}
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
          {abstainLabel}
        </button>
      ) : null}
    </section>
  );
}
