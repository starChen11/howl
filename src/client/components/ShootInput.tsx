/**
 * 出局后的开枪选择（RFC-012 AC-11 的延伸）。
 *
 * 出局后要自己决定开不开枪。这个决定属于玩家——哪怕他已经死了，
 * 所以它和发言/投票一样走输入通道，而不是让 AI 代打。
 */
export function ShootInput({
  targets,
  onShoot,
}: {
  targets: number[];
  onShoot: (target: number | null) => void;
}) {
  return (
    <section className="shoot" aria-label="开枪">
      <p className="shoot__hint">你出局了，但可以开枪带走一个人。</p>
      <div className="shoot__buttons">
        {targets.map((seat) => (
          <button key={seat} type="button" className="button" onClick={() => onShoot(seat)}>
            开枪带走 {seat} 号
          </button>
        ))}
        <button type="button" className="button" onClick={() => onShoot(null)}>
          不开枪
        </button>
      </div>
    </section>
  );
}
