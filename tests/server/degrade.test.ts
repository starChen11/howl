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

describe('C-87 · 一轮发言的编排（重试 → 降级 → 可推进的 SPEECH）', () => {
  it('第一次失败、第二次成功：不降级，尝试 2 次', async () => {
    const { runTurn } = await import('@server/llm/turn');
    let calls = 0;

    const result = await runTurn({
      seat: 1 as never,
      attempt: async () => {
        calls += 1;
        return calls === 1 ? { text: '', failed: true } : { text: '我过了', failed: false };
      },
      startedAt: 0,
      now: () => 100,
      limitMs: 5_000,
      degradation: initialDegradation(),
      sentenceIndex: 0,
    });

    expect(result.degraded).toBe(false);
    expect(result.text).toBe('我过了');
    expect(result.attempts).toBe(2);
  });

  it('两次都失败：降级，短句 ≤ 10 字，且产出 DEGRADED + SPEECH', async () => {
    const { runTurn, degradeEvents } = await import('@server/llm/turn');

    const result = await runTurn({
      seat: 2 as never,
      attempt: async () => ({ text: '', failed: true }),
      startedAt: 0,
      now: () => 100,
      limitMs: 5_000,
      degradation: initialDegradation(),
      sentenceIndex: 1,
    });

    expect(result.degraded).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(DEGRADE_SENTENCE_LIMIT);
    expect(result.attempts).toBe(2);

    const events = degradeEvents({
      gameId: 'g',
      ts: 1,
      seat: 2 as never,
      text: result.text,
      seq: 1,
    });
    expect(events.map((event) => event.type)).toEqual(['DEGRADED', 'SPEECH']);
  });

  it('连续 3 次降级后第 4 次仍然尝试真实调用（不许全跳过）', async () => {
    const { runTurn, canAttempt } = await import('@server/llm/turn');
    let state = initialDegradation();
    let calls = 0;

    for (let index = 0; index < 4; index += 1) {
      const result = await runTurn({
        seat: 1 as never,
        attempt: async () => {
          calls += 1;
          return { text: '', failed: true };
        },
        startedAt: 0,
        now: () => 100,
        limitMs: 5_000,
        degradation: state,
        sentenceIndex: index,
      });
      state = result.degradation;
      expect(canAttempt(state)).toBe(true);
    }

    // 每次都重试一次 → 4 轮 × 2 次
    expect(calls).toBe(8);
  });
});

describe('C-87 · attempt 抛错也必须被接住', () => {
  it('第一次抛错、第二次成功 → 不降级，尝试 2 次', async () => {
    const { runTurn } = await import('@server/llm/turn');
    let calls = 0;

    const result = await runTurn({
      seat: 1 as never,
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error('network');
        return { text: '我过了', failed: false };
      },
      startedAt: 0,
      now: () => 100,
      limitMs: 5_000,
      degradation: initialDegradation(),
      sentenceIndex: 0,
    });

    expect(result.degraded).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('两次都抛错 → 降级而不是把异常抛给调用方', async () => {
    const { runTurn } = await import('@server/llm/turn');

    const result = await runTurn({
      seat: 1 as never,
      attempt: async () => {
        throw new Error('network');
      },
      startedAt: 0,
      now: () => 100,
      limitMs: 5_000,
      degradation: initialDegradation(),
      sentenceIndex: 0,
    });

    expect(result.degraded).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('重试不会突破整体预算：第一次就超时则不再重试', async () => {
    const { runTurn } = await import('@server/llm/turn');
    let calls = 0;

    const result = await runTurn({
      seat: 1 as never,
      attempt: async () => {
        calls += 1;
        return { text: '', failed: true };
      },
      startedAt: 0,
      now: () => 10_000,
      limitMs: 5_000,
      degradation: initialDegradation(),
      sentenceIndex: 0,
    });

    expect(calls).toBe(1);
    expect(result.degraded).toBe(true);
  });
});

describe('C-87 · 整体耗时不超过硬上限', () => {
  it('两次各 40ms、上限 50ms：整体不超过 80ms，且最终降级', async () => {
    const { runTurn } = await import('@server/llm/turn');
    const started = Date.now();
    let calls = 0;

    const result = await runTurn({
      seat: 1 as never,
      attempt: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { text: '', failed: true };
      },
      startedAt: started,
      now: () => Date.now(),
      limitMs: 50,
      degradation: initialDegradation(),
      sentenceIndex: 0,
    });

    const elapsed = Date.now() - started;
    expect(result.degraded).toBe(true);
    // 关键：不是 40 + 40 = 80ms，而是被剩余预算截断
    expect(elapsed).toBeLessThan(75);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
