import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import { decide, LlmError } from '@server/llm/client';
import { DEFAULT_LLM_CONFIG, loadLlmConfig, type LlmConfig } from '@server/llm/config';
import { DecisionLog } from '@server/llm/decision-log';
import { CallMetaLog } from '@server/llm/meta';

/**
 * AC-3 ~ AC-5 / AC-8 / AC-12 / AC-14：客户端行为。
 *
 * 全程用假 `fetch`：本 RFC 不做真实调用（§6）。`tests/setup/no-network.ts` 另有兜底，
 * 真联网会直接失败。
 */

const CONFIG: LlmConfig = {
  apiKey: 'test-key',
  model: 'deepseek-flash',
  thinking: true,
  temperature: 0.8,
  maxOutputTokens: 800,
  timeoutMs: 50,
  maxRetries: 1,
  baseURL: 'https://api.deepseek.com',
};

const CTX: ProjectedContext = {
  self: { seat: 3, role: 'seer', alive: true, personaId: null },
  phase: 'NIGHT_SEER',
  day: 1,
  aliveSeats: [1, 2, 3],
  deadSeats: [],
  publicEvents: [],
  privateEvents: [],
  knowledge: {
    teammates: [],
    checks: [],
    potions: { heal: 'used', poison: 'used' },
    canShoot: false,
    knownKillTarget: null,
  },
  legalTargets: [1, 2],
  pending: 'check',
};

/** 构造一个假的 OpenAI 兼容响应。 */
function chatResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GOOD_BODY = {
  id: 'x',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({ action: 'check', target: 1, reason: '他像狼' }),
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('AC-14 · 正常路径：解析决策并写元数据', () => {
  it('返回 Decision，且 CallMeta 含 13 个字段、attempt=1', async () => {
    const log = new CallMetaLog();
    const fetchImpl = (async () => chatResponse(GOOD_BODY)) as unknown as typeof fetch;

    const outcome = await decide(
      { config: CONFIG, fetchImpl, metaLog: log },
      { gameId: 'g', seq: 4, ctx: CTX, mode: 'slaughter-side' },
    );
    if ('duplicate' in outcome) throw new Error('不应被判为重复');
    const { decision, meta } = outcome;

    expect(decision.action).toBe('check');
    expect(decision.target).toBe(1);
    expect(log.size).toBe(1);
    expect(Object.keys(meta)).toHaveLength(13);
    expect(meta.attempt).toBe(1);
    expect(meta.ok).toBe(true);
    expect(meta.inputTokens).toBe(10);
  });
});

describe('AC-3 · 错误信息不含响应体原文', () => {
  it('500 响应里的敏感内容不出现在错误里', async () => {
    const secret = 'sk-SECRET-DO-NOT-LEAK';
    const fetchImpl = (async () =>
      chatResponse({ error: { message: `boom ${secret}` } }, 500)) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(LlmError);
      const message = (error as LlmError).message;
      expect(message).not.toContain(secret);
      return true;
    });
  });
});

describe('AC-5 · 可重试与不可重试', () => {
  it('5xx 会重试一次（共两次调用），attempt 递增', async () => {
    const log = new CallMetaLog();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return chatResponse({ error: { message: 'x' } }, 500);
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl, metaLog: log },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toThrow();

    expect(calls).toBe(2);
    expect(log.all().map((meta) => meta.attempt)).toEqual([1, 2]);
  });

  it('4xx 不重试（只调用一次）', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return chatResponse({ error: { message: 'bad' } }, 400);
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toThrow();

    expect(calls).toBe(1);
  });

  it('超时会重试', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toThrow();

    expect(calls).toBe(2);
  });
});

describe('AC-8 · 格式校验失败要回喂错误', () => {
  it('第二次请求里带上第一次的校验错误文本，且第二次成功', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      bodies.push(body);
      calls += 1;
      return calls === 1
        ? chatResponse({
            id: 'x',
            choices: [{ index: 0, message: { role: 'assistant', content: '{"action":"check"}' } }],
            usage: {},
          })
        : chatResponse(GOOD_BODY);
    }) as unknown as typeof fetch;

    const outcome = await decide(
      { config: CONFIG, fetchImpl },
      { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
    );
    if ('duplicate' in outcome) throw new Error('不应被判为重复');

    expect(outcome.decision.reason).toBe('他像狼');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('不符合格式要求');
    expect(bodies[1]).toContain('reason');
  });
});

describe('AC-4 · 配置与环境变量', () => {
  it('未设置时取默认值', () => {
    const config = loadLlmConfig({ DEEPSEEK_API_KEY: 'k' } as NodeJS.ProcessEnv);

    expect(config.timeoutMs).toBe(DEFAULT_LLM_CONFIG.timeoutMs);
    expect(config.maxRetries).toBe(DEFAULT_LLM_CONFIG.maxRetries);
    expect(config.model).toBe('deepseek-flash');
  });

  it('环境变量可以覆盖 timeout 与 maxRetries', () => {
    const config = loadLlmConfig({
      DEEPSEEK_API_KEY: 'k',
      LLM_TIMEOUT_MS: '1234',
      LLM_MAX_RETRIES: '3',
    } as NodeJS.ProcessEnv);

    expect(config.timeoutMs).toBe(1234);
    expect(config.maxRetries).toBe(3);
  });

  it('缺 key 时抛错，而不是给空串', () => {
    expect(() => loadLlmConfig({} as NodeJS.ProcessEnv)).toThrow(/DEEPSEEK_API_KEY/);
  });
});

describe('AC-6 · 同一决策轮次至多一条 action', () => {
  it('同一 (gameId, seq, seat) 第二次调用返回 duplicate，且不重复调用模型', async () => {
    const log = new DecisionLog();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return chatResponse(GOOD_BODY);
    }) as unknown as typeof fetch;

    const input = { gameId: 'g', seq: 7, ctx: CTX, mode: 'slaughter-side' as const };
    const first = await decide({ config: CONFIG, fetchImpl, decisionLog: log }, input);
    const second = await decide({ config: CONFIG, fetchImpl, decisionLog: log }, input);

    expect('duplicate' in first).toBe(false);
    expect(second).toEqual({ duplicate: true });
    expect(calls).toBe(1);
  });

  it('不同 seq（下一轮）不会被判重复', async () => {
    const log = new DecisionLog();
    const fetchImpl = (async () => chatResponse(GOOD_BODY)) as unknown as typeof fetch;

    await decide(
      { config: CONFIG, fetchImpl, decisionLog: log },
      {
        gameId: 'g',
        seq: 7,
        ctx: CTX,
        mode: 'slaughter-side',
      },
    );
    const next = await decide(
      { config: CONFIG, fetchImpl, decisionLog: log },
      {
        gameId: 'g',
        seq: 8,
        ctx: CTX,
        mode: 'slaughter-side',
      },
    );

    expect('duplicate' in next).toBe(false);
  });
});

describe('AC-5 · 429 与网络错误也会重试', () => {
  it('429 重试一次', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return chatResponse({ error: { message: 'rate limited' } }, 429);
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('网络错误（非超时）重试一次', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
