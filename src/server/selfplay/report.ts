import type { UsageTotals } from '../llm/usage';

/**
 * 批量对局的汇总（RFC-015 §2.3 / AC-4）。
 *
 * 三类结果必须分开：**成局**、**模型/基础设施失败**、**实现缺陷**（脚本玩家产生了
 * 引擎拒绝的行动）。混在一起会让胜率与成功率都失真（AC-6）。
 */

export interface GameFailure {
  seed: number;
  kind: 'model' | 'implementation';
  error: string;
}

export interface SelfplaySummary {
  games: number;
  succeeded: number;
  failed: number;
  failures: GameFailure[];
  /** 胜负分布：只统计成局的。 */
  winDistribution: { wolf: number; good: number };
  /** 平均每局事件数（只统计成局）。 */
  avgEvents: number;
  /** 平均每局耗时（毫秒，只统计成局）。 */
  avgDurationMs: number;
  /** 降级总次数。 */
  degradedCount: number;
  /** 胜率（仅成局的样本）。 */
  wolfWinRate: number;
  usage: UsageTotals;
}

export interface GameOutcome {
  seed: number;
  ok: boolean;
  events: number;
  durationMs: number;
  result?: 'wolf' | 'good';
  degraded?: number;
  usage?: UsageTotals;
  failure?: GameFailure;
}

const EMPTY_USAGE: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
  };
}

export function summarize(outcomes: readonly GameOutcome[]): SelfplaySummary {
  const succeeded = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes
    .filter((outcome) => !outcome.ok && outcome.failure !== undefined)
    .map((outcome) => outcome.failure as GameFailure);

  const wolf = succeeded.filter((outcome) => outcome.result === 'wolf').length;
  const good = succeeded.filter((outcome) => outcome.result === 'good').length;
  const totalEvents = succeeded.reduce((sum, outcome) => sum + outcome.events, 0);
  const totalDuration = succeeded.reduce((sum, outcome) => sum + outcome.durationMs, 0);

  return {
    games: outcomes.length,
    succeeded: succeeded.length,
    failed: outcomes.length - succeeded.length,
    failures,
    winDistribution: { wolf, good },
    avgEvents: succeeded.length === 0 ? 0 : totalEvents / succeeded.length,
    avgDurationMs: succeeded.length === 0 ? 0 : totalDuration / succeeded.length,
    degradedCount: succeeded.reduce((sum, outcome) => sum + (outcome.degraded ?? 0), 0),
    wolfWinRate: succeeded.length === 0 ? 0 : wolf / succeeded.length,
    usage: succeeded.reduce(
      (sum, outcome) => addUsage(sum, outcome.usage ?? EMPTY_USAGE),
      EMPTY_USAGE,
    ),
  };
}
