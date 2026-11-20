import { describe, expect, it } from 'vitest';

import { ApiClient } from '@client/api';

/**
 * RFC-013 §5 AC-9 / API-1：真相响应用共享 schema 校验。
 *
 * 契约不一致时要**返回 null**（界面回落到「没有真相数据」），而不是把半截对象
 * 交给渲染层——那会在 UI 深处炸掉（C-151）。
 */

function clientReturning(body: unknown, ok = true) {
  return new ApiClient({
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 403,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

describe('truth 响应校验', () => {
  it('合法响应被解析成 TruthView', async () => {
    const client = clientReturning({
      seats: [{ seat: 1, role: 'wolf', roleLabel: '狼人', alive: true, actions: ['袭击了 2 号'] }],
      deaths: [{ seat: 2, day: 1, cause: 'wolf' }],
      wolfVotes: [{ day: 1, votes: [{ seat: 1, target: 2 }] }],
    });

    const truth = await client.truth('g');
    expect(truth?.seats[0]?.actions).toEqual(['袭击了 2 号']);
  });

  it('缺字段的响应返回 null，而不是半个对象', async () => {
    const client = clientReturning({ seats: [{ seat: 1, roleLabel: '狼人' }] });
    expect(await client.truth('g')).toBeNull();
  });

  it('403（对局进行中）返回 null', async () => {
    const client = clientReturning({ error: 'TRUTH_LOCKED' }, false);
    expect(await client.truth('g')).toBeNull();
  });
});

describe('C-171 · 非 2xx 必须抛错，不能把错误体当视图', () => {
  it('game() 对 410 抛出', async () => {
    const client = new ApiClient({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: 'GAME_EXPIRED' }), { status: 410 })) as never,
    });
    await expect(client.game('g')).rejects.toThrow(/410/);
  });
});
