import { describe, expect, it } from 'vitest';

import { detectCapabilities } from '@client/capabilities';

/**
 * RFC-016 §5 AC-3：能力探测要给出**可读的中文提示**，而不是白屏。
 */

describe('AC-3 · 能力探测', () => {
  it('三项都在时 ok', () => {
    const full = {
      EventSource: function EventSource() {},
      TextDecoder: globalThis.TextDecoder,
      fetch: globalThis.fetch,
    } as unknown as typeof globalThis;

    expect(detectCapabilities(full).ok).toBe(true);
  });

  it('缺 EventSource 时列出缺什么，并给出中文提示', () => {
    const fake = {
      EventSource: undefined,
      TextDecoder: globalThis.TextDecoder,
      fetch: globalThis.fetch,
    } as unknown as typeof globalThis;

    const report = detectCapabilities(fake);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['实时消息（EventSource）']);
    expect(report.message).toContain('这个浏览器缺少');
    expect(report.message).toContain('Chrome');
  });

  it('全缺时三项都列出来', () => {
    const report = detectCapabilities({} as typeof globalThis);
    expect(report.missing).toHaveLength(3);
    expect(report.message).toContain('实时消息');
    expect(report.message).toContain('文本解码');
    expect(report.message).toContain('网络请求');
  });
});
