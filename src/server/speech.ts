import type { PlayerInput } from '@shared/channels';

/**
 * 发言输入的规则（RFC-011 §2.2）。
 *
 * 全部是**纯函数**：倒计时、字数、弃权都不依赖 DOM，所以能在 node 里测，
 * 也方便 RFC-012 的界面直接复用。
 */

/** 单轮发言时间（Q-011-1 的假设值，可配置）。 */
export const SPEECH_TIMEOUT_MS = 60_000;

/** 单轮最大字符数。 */
export const SPEECH_MAX_CHARS = 300;

/**
 * 按 **Unicode 字符数** 计算长度。
 *
 * `String.length` 把 emoji 算两个、把某些组合字符算更多——用它做上限，玩家会
 * 莫名其妙地「还没到 300 就说不了了」。
 */
export function charCount(text: string): number {
  return [...text].length;
}

/** 前端限制与后端校验共用的判据（SEC-4：两边都要做）。 */
export function isWithinLimit(text: string): boolean {
  return charCount(text) <= SPEECH_MAX_CHARS;
}

/**
 * 把一次输入归一成「说话」或「弃权」。
 *
 * - 空白输入 → 弃权（`SPEECH_SKIPPED`）；「说了一空格」不是发言。
 * - 超时 → 用**已输入的内容**（可能为空，空就是弃权）。
 */
export function normalizeInput(input: { text: string; timedOut: boolean }): PlayerInput {
  if (!input.timedOut) {
    return input.text.trim().length === 0 ? { kind: 'skip' } : { kind: 'speak', text: input.text };
  }

  return input.text.trim().length === 0 ? { kind: 'skip' } : { kind: 'timeout', text: input.text };
}

/**
 * 剩余秒数：**以服务端起点为准**（AC-13）。
 *
 * 刷新页面后不回满——因为起点在服务端，客户端只负责显示。
 */
export function remainingSeconds(input: {
  startedAt: number;
  now: number;
  timeoutMs?: number;
}): number {
  const timeout = input.timeoutMs ?? SPEECH_TIMEOUT_MS;
  const left = timeout - (input.now - input.startedAt);
  return Math.max(0, Math.ceil(left / 1000));
}
