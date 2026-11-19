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

describe('AC-5 / AC-6 的后端保障', () => {
  it('后端拒绝超过 300 字的发言（不是只在提示词里截断）', async () => {
    const { buildApp } = await import('@server/app');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

    const app = buildApp({ store: new InMemoryMetaStore() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'SPEECH', ts: 1, seat: 1, text: '字'.repeat(301) },
        expectedVersion: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'VALIDATION_FAILED' }));
  });

  it('超时提交已输入的草稿', async () => {
    const { HttpInputChannel } = await import('@server/channels/http');
    const channel = new HttpInputChannel({ timeoutMs: 20 });
    const pending = channel.read({ seat: 1 as never, timeoutMs: 20, kind: 'speech' });

    channel.setDraft('我说到一半');
    expect(await pending).toEqual({ kind: 'timeout', text: '我说到一半' });
  });
});
