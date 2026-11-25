import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import { decide, extractSpeechIncrement, LlmError } from '@server/llm/client';
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

describe('B4 · 301 字发言在 decide 层被截断（不是被拒）', () => {
  it('模型返回 301 字发言 → schema 通过（不拒绝）', async () => {
    const fetchImpl = (async () =>
      chatResponse({
        id: 'x',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                action: 'speak',
                speech: 'x'.repeat(301),
                reason: '说完了',
              }),
            },
          },
        ],
        usage: {},
      })) as unknown as typeof fetch;

    const outcome = await decide(
      { config: CONFIG, fetchImpl },
      {
        gameId: 'g',
        seq: 1,
        ctx: { ...CTX, phase: 'DAY_SPEECH', pending: 'speak' },
        mode: 'slaughter-side',
      },
    );
    if ('duplicate' in outcome) throw new Error('不应被判为重复');

    // schema 层不再拒绝长发言
    expect(outcome.decision.speech).toHaveLength(301);
  });
});

describe('B6 · 重试分类要能区分错误码', () => {
  it('超时被记成 TIMEOUT（而不是笼统的 SERVER_ERROR）', async () => {
    const log = new CallMetaLog();
    const fetchImpl = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl, metaLog: log },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toSatisfy((error: unknown) => (error as LlmError).code === 'TIMEOUT');

    expect(log.all().map((meta) => meta.errorCode)).toEqual(['TIMEOUT', 'TIMEOUT']);
  });

  it('网络错误被记成 NETWORK', async () => {
    const log = new CallMetaLog();
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      decide(
        { config: CONFIG, fetchImpl, metaLog: log },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toSatisfy((error: unknown) => (error as LlmError).code === 'NETWORK');
  });
});

describe('C-55 · 真实超时路径（AbortSignal.timeout）', () => {
  it('假 fetch 在 signal abort 时拒绝 → 归为 TIMEOUT 而不是 SERVER_ERROR', async () => {
    const log = new CallMetaLog();
    // 关键：不主动抛错，而是**等 signal 真的 abort**。SDK 会把这种取消包成
    // `APIUserAbortError`，与「立即抛一个 TimeoutError」是两条不同路径。
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (signal === null || signal === undefined) {
          reject(new Error('缺少 signal'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason ?? new DOMException('timeout', 'TimeoutError'));
        });
      })) as unknown as typeof fetch;

    await expect(
      decide(
        { config: { ...CONFIG, timeoutMs: 10 }, fetchImpl, metaLog: log },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      ),
    ).rejects.toSatisfy((error: unknown) => (error as LlmError).code === 'TIMEOUT');

    expect(log.all().every((meta) => meta.errorCode === 'TIMEOUT')).toBe(true);
  });
});

describe('C-77 · 人格的 verbosity 影响 maxOutputTokens', () => {
  async function maxTokensForPersona(personaId: string | null): Promise<number> {
    let body: { max_tokens?: number } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as { max_tokens?: number };
      return chatResponse(GOOD_BODY);
    }) as unknown as typeof fetch;

    await decide(
      { config: CONFIG, fetchImpl },
      { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side', personaId },
    );

    if (body.max_tokens === undefined) throw new Error('请求里没有 max_tokens');
    return body.max_tokens;
  }

  it('短话痨 vs 絮叨：1 档是 0.5 倍、3 档是 1.5 倍', async () => {
    const quiet = await maxTokensForPersona('quiet'); // verbosity 1
    const chatty = await maxTokensForPersona('chatty'); // verbosity 3

    expect(quiet).toBe(400); // 800 * 0.5
    expect(chatty).toBe(1200); // 800 * 1.5
  });

  it('没有人格（玩家席位）时用配置值', async () => {
    expect(await maxTokensForPersona(null)).toBe(800);
  });

  it('超时不受人格影响', async () => {
    // 人格只改输出上限，不改 timeoutMs —— 超时是网络问题，与性格无关。
    expect(CONFIG.timeoutMs).toBe(50);
  });
});

describe('token 级流式发言', () => {
  it('extractSpeechIncrement 逐段解码 speech，不重复也不提前吐出未完成的转义', () => {
    const state = { emitted: 0 };
    expect(extractSpeechIncrement('{"action":"speak","speech":"你', state)).toBe('你');
    expect(extractSpeechIncrement('{"action":"speak","speech":"你好', state)).toBe('好');
    expect(extractSpeechIncrement('{"action":"speak","speech":"你好\\n世界', state)).toBe('\n世界');
    expect(extractSpeechIncrement('{"action":"speak","speech":"你好\\n世界"', state)).toBe('');
  });

  it('decide 在提供 onDelta 时用 stream:true，并按 speech 字段回调', async () => {
    const parts = ['{"action":"speak","reason":"测试","speech":"你', '好，世界"}'];
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: 'x',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'm',
                choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
              })}\n\n`,
            ),
          );
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: 'x',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'm',
              choices: [],
              usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const deltas: string[] = [];
    const result = await decide(
      { config: CONFIG, fetchImpl },
      {
        gameId: 'g',
        seq: 1,
        ctx: CTX,
        mode: 'slaughter-side',
        onDelta: (text) => deltas.push(text),
      },
    );
    if ('duplicate' in result) throw new Error('不应重复');
    expect(deltas.join('')).toBe('你好，世界');
    expect(result.decision).toEqual({ action: 'speak', reason: '测试', speech: '你好，世界' });
  });
});

describe('模型输出容错', () => {
  it('容忍 ```json 代码块和前后解释文字', async () => {
    for (const content of [
      '```json\n{"action":"speak","reason":"测试","speech":"你好"}\n```',
      '好的，这是结果：\n{"action":"speak","reason":"测试","speech":"你好"}\n希望有用。',
    ]) {
      const fetchImpl = (async () =>
        chatResponse({
          id: 'x',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        })) as unknown as typeof fetch;
      const result = await decide(
        { config: CONFIG, fetchImpl },
        { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
      );
      if ('duplicate' in result) throw new Error('不应重复');
      expect(result.decision.action).toBe('speak');
    }
  });

  it('reason 超过 200 字只截断，不让整条决策失败', async () => {
    const content = JSON.stringify({
      action: 'speak',
      reason: '很长的理由'.repeat(100),
      speech: '你好',
    });
    const fetchImpl = (async () =>
      chatResponse({
        id: 'x',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      })) as unknown as typeof fetch;
    const result = await decide(
      { config: CONFIG, fetchImpl },
      { gameId: 'g', seq: 1, ctx: CTX, mode: 'slaughter-side' },
    );
    if ('duplicate' in result) throw new Error('不应重复');
    expect(result.decision.reason.length).toBe(200);
  });
});
