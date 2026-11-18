import type { SeatId } from '@shared/domain';

/**
 * 决策轮次去重（RFC-006 §2.3 / AC-6）。
 *
 * 键是 `(gameId, seq, seat)`——**不是** `action.type`：重试后模型可能把 `vote` 改成
 * `abstain`，动作类型不同但仍是同一轮、同一个席位。EC 只允许一个 action。
 *
 * 为什么放在客户端这一层：完整的编排属于 RFC-011，但「重试不能变出两个 action」是
 * 本 RFC 的验收标准，必须在这里有一道最小接缝。
 */
export interface DecisionKey {
  gameId: string;
  seq: number;
  seat: SeatId;
}

function keyOf(input: DecisionKey): string {
  return `${input.gameId}:${input.seq}:${input.seat}`;
}

export class DecisionLog {
  private readonly seen = new Set<string>();

  /** 记录本轮已产出 action；重复返回 `false`（调用方据此丢弃第二个）。 */
  claim(input: DecisionKey): boolean {
    const key = keyOf(input);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  has(input: DecisionKey): boolean {
    return this.seen.has(keyOf(input));
  }
}
