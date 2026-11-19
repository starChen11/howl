import { describe, expect, it } from 'vitest';

import { SPEECH_MAX_CHARS, charCount, isWithinLimit, normalizeInput } from '@server/speech';

/**
 * RFC-011 §5 AC-5 / 7：字数与弃权。前端限制与后端校验共用同一组纯函数（SEC-4）。
 */

describe('AC-5 · Unicode 计数', () => {
  it('中文按字算，emoji 算一个', () => {
    expect(charCount('狼人杀')).toBe(3);
    expect(charCount('😀😀')).toBe(2);
  });

  it('刚好 300 可以，301 不行', () => {
    expect(isWithinLimit('字'.repeat(SPEECH_MAX_CHARS))).toBe(true);
    expect(isWithinLimit('字'.repeat(SPEECH_MAX_CHARS + 1))).toBe(false);
  });
});

describe('AC-7 · 弃权', () => {
  it('纯空白算弃权', () => {
    expect(normalizeInput({ text: ' \n\t ', timedOut: false }).kind).toBe('skip');
  });

  it('有内容的超时不算弃权', () => {
    expect(normalizeInput({ text: '我还没说完', timedOut: true }).kind).toBe('timeout');
  });
});
