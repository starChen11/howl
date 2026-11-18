import type { SeatId } from '@shared/domain';
import type { ProjectedPhase } from '@shared/project';

/**
 * 每次模型调用的元数据（RFC-006 §2.5）。
 *
 * **不记录对话全文**：日志会膨胀，而且提示里含整局的公开发言——那是玩家内容。
 * 复盘需要的是「这次调用花了多久、几次、成没成」，不是聊天记录。
 */
export interface CallMeta {
  gameId: string;
  seat: SeatId;
  seq: number;
  day: number;
  /** 观察者视角的阶段（夜间折成 `'NIGHT'`，见 RFC-007 的 C-28）。 */
  phase: ProjectedPhase;
  model: string;
  thinking: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  attempt: number;
  ok: boolean;
  errorCode?: string;
}

/** 收集与导出元数据。默认只留在内存；落盘形态由 RFC-008 决定（本 RFC 的实现者选择）。 */
export class CallMetaLog {
  private readonly entries: CallMeta[] = [];

  record(meta: CallMeta): void {
    this.entries.push(meta);
  }

  all(): readonly CallMeta[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}
