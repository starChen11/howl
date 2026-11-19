/**
 * 观战态提示与真相开关（RFC-013 §2.2 / §2.3）。
 *
 * 真相视图**只在观战态**出现，且默认关闭；开关状态在组件内存里，刷新即关。
 */
export function SpectatorBar({
  truthEnabled,
  onToggleTruth,
}: {
  truthEnabled: boolean;
  onToggleTruth: () => void;
}) {
  return (
    <section className="spectator" aria-label="观战">
      <p className="spectator__notice">你已出局，正在观战。不能再发言或投票。</p>
      <button type="button" className="button" aria-pressed={truthEnabled} onClick={onToggleTruth}>
        {truthEnabled ? '关闭真相视图' : '打开真相视图'}
      </button>
    </section>
  );
}
