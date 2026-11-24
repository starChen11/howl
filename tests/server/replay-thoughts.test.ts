import { describe, expect, it } from 'vitest';

import type { EventEnvelope } from '@shared/events';
import { buildThoughts } from '@server/replay/snapshot';

function thought(payload: Record<string, unknown>, seq = 10): EventEnvelope {
  return {
    gameId: 'g',
    seq,
    ts: 0,
    type: 'AI_THOUGHT',
    visibleTo: 'self:1',
    payload,
  } as EventEnvelope;
}

describe('RFC-021 · 复盘里的投票/夜间推理', () => {
  it('投票的 AI_THOUGHT 标成「投票」并显示投给谁', () => {
    const [entry] = buildThoughts([
      thought({
        reason: '他的发言在划水',
        decisionSeq: 9,
        seat: 3,
        phase: 'DAY_VOTE',
        decisionAction: 'VOTE',
        target: 5,
      }),
    ]);
    expect(entry?.kind).toBe('vote');
    expect(entry?.chose).toBe('投 5 号');
  });

  it('弃权也记录为投票推理', () => {
    const [entry] = buildThoughts([
      thought({
        reason: '信息不足',
        decisionSeq: 9,
        seat: 3,
        phase: 'DAY_VOTE',
        decisionAction: 'abstain',
        target: 'abstain',
      }),
    ]);
    expect(entry?.kind).toBe('vote');
    expect(entry?.chose).toBe('弃权');
  });

  it('夜间动作标成「夜间行动」', () => {
    const [entry] = buildThoughts([
      thought({
        reason: '验他',
        decisionSeq: 9,
        seat: 4,
        phase: 'NIGHT_SEER',
        decisionAction: 'SEER_CHECK',
        target: 6,
      }),
    ]);
    expect(entry?.kind).toBe('night-action');
    expect(entry?.chose).toBe('选择 6 号');
  });

  it('旧对局没有 phase 字段时仍按发言显示，不崩', () => {
    const [entry] = buildThoughts([thought({ reason: '旧数据', decisionSeq: 9, seat: 2 })]);
    expect(entry?.kind).toBe('speech');
    expect(entry?.chose).toBe('');
  });
});
