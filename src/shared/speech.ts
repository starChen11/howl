import type { PlayerInput } from './channels';

/**
 * 发言规则（RFC-011 §2.2）：**前后端共用**。
 *
 * 放在 `shared` 是为了让「300 字」只有一个来源——前端限制与后端校验用同一个函数，
 * 否则两边迟早不一致（SEC-4）。
 */

export const SPEECH_TIMEOUT_MS = 60_000;
export const SPEECH_MAX_CHARS = 300;

/** 按 **Unicode 字符数** 计算：emoji 算一个，不是两个。 */
export function charCount(text: string): number {
  return [...text].length;
}

export function isWithinLimit(text: string): boolean {
  return charCount(text) <= SPEECH_MAX_CHARS;
}

export function normalizeInput(input: { text: string; timedOut: boolean }): PlayerInput {
  if (!input.timedOut) {
    return input.text.trim().length === 0 ? { kind: 'skip' } : { kind: 'speak', text: input.text };
  }

  return input.text.trim().length === 0 ? { kind: 'skip' } : { kind: 'timeout', text: input.text };
}

export function remainingSeconds(input: {
  startedAt: number;
  now: number;
  timeoutMs?: number;
}): number {
  const timeout = input.timeoutMs ?? SPEECH_TIMEOUT_MS;
  const left = timeout - (input.now - input.startedAt);
  return Math.max(0, Math.ceil(left / 1000));
}
