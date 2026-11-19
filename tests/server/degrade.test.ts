import { describe, expect, it } from 'vitest';

import {
  DEGRADE_SENTENCES,
  DEGRADE_SENTENCE_LIMIT,
  UNSTABLE_AFTER,
  decideDegrade,
  degradeSentence,
  initialDegradation,
  isTimedOut,
  recordDegradation,
  recordSuccess,
  shouldAttempt,
} from '@server/llm/degrade';

/**
 * RFC-010 §5 AC-7 / 8 / 11 / 12：降级路径。
 *
 * 全部用注入的判定函数，不依赖真实模型。
 */

describe('AC-7 · 超时触发降级，短句不超过 10 字', () => {
  it('超过硬超时 → 降级，句子长度 ≤ 10', () => {
    const decision = decideDegrade({
      seat: 1 as never,
      startedAt: 0,
      now: 10_000,
      limitMs: 5_000,
      failed: false,
      sentenceIndex: 0,
    });

    expect(decision.degrade).toBe(true);
    expect((decision.sentence ?? '').length).toBeLessThanOrEqual(DEGRADE_SENTENCE_LIMIT);
  });

  it('未超时且未失败 → 不降级', () => {
    expect(
      decideDegrade({
        seat: 1 as never,
        startedAt: 0,
        now: 100,
        limitMs: 5_000,
        failed: false,
        sentenceIndex: 0,
      }).degrade,
    ).toBe(false);
  });

  it('调用失败（即使没超时）也降级', () => {
    expect(
      decideDegrade({
        seat: 1 as never,
        startedAt: 0,
        now: 100,
        limitMs: 5_000,
        failed: true,
        sentenceIndex: 1,
      }).degrade,
    ).toBe(true);
  });

  it('句库本身每条都 ≤ 10 字', () => {
    for (const sentence of DEGRADE_SENTENCES) {
      expect(sentence.length).toBeLessThanOrEqual(DEGRADE_SENTENCE_LIMIT);
    }
  });
});

describe('AC-8 · 重试成功则不降级', () => {
  it('第一次失败、第二次成功 → 不降级（由调用方把 failed 传 false）', () => {
    expect(
      decideDegrade({
        seat: 1 as never,
        startedAt: 0,
        now: 100,
        limitMs: 5_000,
        failed: false,
        sentenceIndex: 0,
      }).degrade,
    ).toBe(false);
  });
});

describe('AC-11 / 12 · 连续失败计数与「不许全跳过」', () => {
  it('连续 3 次降级后置 warned；第 4 次仍应尝试真实调用', () => {
    let state = initialDegradation();
    for (let index = 0; index < UNSTABLE_AFTER; index += 1) state = recordDegradation(state);

    expect(state.warned).toBe(true);
    expect(shouldAttempt()).toBe(true);
    expect(state.total).toBe(UNSTABLE_AFTER);
  });

  it('成功一次后连续计数清零', () => {
    let state = recordDegradation(recordDegradation(initialDegradation()));
    state = recordSuccess(state);

    expect(state.consecutive).toBe(0);
    expect(state.total).toBe(2);
  });
});

describe('超时判定边界', () => {
  it('恰好等于上限不算超时，超过才算', () => {
    expect(isTimedOut({ startedAt: 0, now: 5_000, limitMs: 5_000 })).toBe(false);
    expect(isTimedOut({ startedAt: 0, now: 5_001, limitMs: 5_000 })).toBe(true);
  });

  it('degradeSentence 按下标取，越界回绕', () => {
    expect(degradeSentence(0)).toBe(DEGRADE_SENTENCES[0]);
    expect(degradeSentence(DEGRADE_SENTENCES.length)).toBe(DEGRADE_SENTENCES[0]);
  });
});
