import type { CallMeta } from './meta';

/**
 * 按对局聚合调用元数据（RFC-014 §2.1 / NFR-13）。
 *
 * 复盘要展示「这一局花了多少 token」。数据来自 RFC-006 的 `CallMeta`，按 `gameId` 聚合。
 *
 * 用一个进程级累加器：它只增不减、进程重启即清零——复盘用量本来就是运行时统计，
 * 不是对局状态的一部分（所以不进 `MetaStore`）。
 */

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

const totals = new Map<string, UsageTotals>();

export function recordUsage(gameId: string, meta: CallMeta): void {
  const current = totals.get(gameId) ?? {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
  };

  totals.set(gameId, {
    calls: current.calls + 1,
    inputTokens: current.inputTokens + meta.inputTokens,
    outputTokens: current.outputTokens + meta.outputTokens,
    cachedTokens: current.cachedTokens + meta.cachedTokens,
  });
}

export function usageOf(gameId: string): UsageTotals {
  return totals.get(gameId) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
}

/** 测试用：清空统计。 */
export function resetUsage(): void {
  totals.clear();
}
