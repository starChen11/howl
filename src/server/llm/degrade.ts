import type { SeatId } from '@shared/domain';

/**
 * 超时判定与降级（RFC-010 §2.3 / §2.4）。
 *
 * 降级**不中断对局**（NFR-10）：用一句不超过 10 字的短句顶替，引擎照常推进。
 * 连续失败 3 次也不许切到「全部跳过」——否则整局会退化成没人说话。
 */

/** 降级短句的长度上限（AC-7）。 */
export const DEGRADE_SENTENCE_LIMIT = 10;

/** 连续多少次降级后提示「模型不稳定」。 */
export const UNSTABLE_AFTER = 3;

export const DEGRADE_SENTENCES = ['我先过。', '没什么好说的。', '我再看一轮。', '跳过。'] as const;

/** 从库里按索引取一句；长度必须 ≤ 10（AC-7）。 */
export function degradeSentence(index: number): string {
  const sentence = DEGRADE_SENTENCES[Math.abs(index) % DEGRADE_SENTENCES.length];
  if (sentence === undefined) throw new Error('降级短句库为空');
  if (sentence.length > DEGRADE_SENTENCE_LIMIT) {
    throw new Error(`降级短句超过 ${DEGRADE_SENTENCE_LIMIT} 字：${sentence}`);
  }
  return sentence;
}

/** 单轮是否已经超过硬超时。 */
export function isTimedOut(input: { startedAt: number; now: number; limitMs: number }): boolean {
  return input.now - input.startedAt > input.limitMs;
}

export interface DegradationState {
  consecutive: number;
  /** 是否已经向 UI 推过「模型不稳定」。 */
  warned: boolean;
  /** 总降级次数（复盘用，AC-11）。 */
  total: number;
}

export function initialDegradation(): DegradationState {
  return { consecutive: 0, warned: false, total: 0 };
}

/**
 * 记录一次降级。
 *
 * 连续计数在**成功**时清零；达到 `UNSTABLE_AFTER` 时把 `warned` 置位，只提示一次。
 */
export function recordDegradation(state: DegradationState): DegradationState {
  const consecutive = state.consecutive + 1;
  return {
    consecutive,
    warned: state.warned || consecutive >= UNSTABLE_AFTER,
    total: state.total + 1,
  };
}

export function recordSuccess(state: DegradationState): DegradationState {
  return { ...state, consecutive: 0 };
}

/**
 * 连续失败后是否仍应尝试真实调用。
 *
 * AC-12 的判据：**永远返回 `true`**。写成一个函数是为了让「不许全跳过」这条
 * 约束有一个可断言的位置，而不是靠注释存在。
 */
export function shouldAttempt(): boolean {
  return true;
}

export interface DegradeDecision {
  degrade: boolean;
  /** 降级时替换用的短句。 */
  sentence?: string;
  seat: SeatId;
}

/** 单轮结束时的判定：超时或调用失败 → 降级。 */
export function decideDegrade(input: {
  seat: SeatId;
  startedAt: number;
  now: number;
  limitMs: number;
  failed: boolean;
  sentenceIndex: number;
}): DegradeDecision {
  const timedOut = isTimedOut(input);

  if (!timedOut && !input.failed) return { degrade: false, seat: input.seat };

  return {
    degrade: true,
    sentence: degradeSentence(input.sentenceIndex),
    seat: input.seat,
  };
}
