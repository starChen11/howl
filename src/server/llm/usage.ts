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

/**
 * 供 `decide()` 用的元数据 sink。
 *
 * 它记录**每一次调用**（包括失败与重试），这样复盘的「调用次数」与真实调用一致——
 * 只在成功时记账会少算失败的那次重试。
 */
export const usageMetaLog = {
  record(meta: CallMeta): void {
    recordUsage(meta.gameId, meta);
  },
  get size(): number {
    return totals.size;
  },
};
