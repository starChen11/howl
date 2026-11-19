/**
 * 真相视图的开关（RFC-013 §2.3）。
 *
 * **只存在内存里**：刷新即回落为关闭。持久化会让玩家忘记自己开着，
 * 之后看到的一切都带着「我已经知道答案」的偏差。
 */

export interface TruthState {
  enabled: boolean;
}

export const initialTruthState: TruthState = { enabled: false };

export function toggleTruth(state: TruthState): TruthState {
  return { enabled: !state.enabled };
}

export function resetTruth(): TruthState {
  return { ...initialTruthState };
}
