import OpenAI from 'openai';

import type { ProjectedContext } from '@shared/project';

import type { LlmConfig } from './config';
import { DecisionLog, type DecisionKey } from './decision-log';
import { CallMetaLog, type CallMeta } from './meta';
import { DecisionSchema, type Decision } from './schema';
import { buildSystemPrompt, buildUserMessage } from './prompts/base';

/**
 * 模型客户端（RFC-006 §2.1 / §4）。
 *
 * **`api.deepseek.com` 只出现在这个文件里**（AC-1）：除它之外任何地方出现这个字面量，
 * 都意味着有一条绕过统一的调用路径。
 *
 * 三条来自评审史的硬约束：
 * 1. 错误信息**不含响应体原文**（SEC-7）——响应体里可能带着整段提示词或密钥回显；
 * 2. 只有**可重试**的错误才重试：超时、网络、429、5xx、格式校验失败；参数错误不重试；
 * 3. 格式校验失败时**把校验错误回喂**，否则第二次会原样再错一次。
 */

/** **唯一**出现模型端点的地方（AC-1）。 */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export class LlmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

/** 可重试的错误码。 */
const RETRYABLE = new Set(['TIMEOUT', 'NETWORK', 'RATE_LIMITED', 'SERVER_ERROR', 'INVALID_OUTPUT']);

export interface LlmDeps {
  config: LlmConfig;
  /** 测试注入假 fetch；生产不传，走全局。 */
  fetchImpl?: typeof fetch;
  metaLog?: CallMetaLog;
  /** 决策轮次去重（AC-6）：同一 `(gameId, seq, seat)` 至多一条 action。 */
  decisionLog?: DecisionLog;
}

export interface DecideInput {
  gameId: string;
  seq: number;
  ctx: ProjectedContext;
  /** 对局模式决定胜利条件的措辞，不能写死。 */
  mode: 'slaughter-side' | 'slaughter-all';
  persona?: string | null;
}

export interface DecideResult {
  decision: Decision;
  meta: CallMeta;
}

/** 同一决策轮次已产出过 action 时返回它，而不是再产一条。 */
export type DecideOutcome = DecideResult | { duplicate: true };

function statusToCode(status: number): string {
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'BAD_REQUEST';
}

/**
 * 发一次调用并解析成决策。
 *
 * `attempt` 从 1 开始；每次尝试单独产出一条 `CallMeta`（AC-12）——重试的两次是两次调用，
 * 元数据要能看出「第一次失败了」。
 */
export async function decide(deps: LlmDeps, input: DecideInput): Promise<DecideOutcome> {
  const { config } = deps;

  // AC-6：同一轮次（同一 seq、同一席位）只允许一条 action。重试不产生第二条。
  const key: DecisionKey = { gameId: input.gameId, seq: input.seq, seat: input.ctx.self.seat };
  if (deps.decisionLog !== undefined && deps.decisionLog.has(key)) {
    return { duplicate: true };
  }
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: DEEPSEEK_BASE_URL,
    ...(deps.fetchImpl === undefined ? {} : { fetch: deps.fetchImpl }),
    maxRetries: 0, // 重试由本节控制，SDK 自带的重试会让 attempt 与本节的计数对不上
  });

  const messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[] = [
    {
      role: 'system',
      content: buildSystemPrompt({ persona: input.persona ?? null, mode: input.mode }),
    },
    { role: 'user', content: buildUserMessage(input.ctx) },
  ];

  let lastError: LlmError | undefined;

  for (let attempt = 1; attempt <= 1 + config.maxRetries; attempt += 1) {
    const startedAt = Date.now();
    const baseMeta = {
      gameId: input.gameId,
      seat: input.ctx.self.seat,
      seq: input.seq,
      day: input.ctx.day,
      phase: input.ctx.phase,
      model: config.model,
      thinking: config.thinking,
      attempt,
    };

    try {
      const response = await client.chat.completions.create(
        {
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxOutputTokens,
        },
        { signal: AbortSignal.timeout(config.timeoutMs) },
      );

      const content = response.choices[0]?.message.content ?? '';
      const parsed = DecisionSchema.safeParse(safeJson(content));

      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        lastError = new LlmError('INVALID_OUTPUT', '模型返回的格式不符合契约');
        deps.metaLog?.record({
          ...baseMeta,
          latencyMs: Date.now() - startedAt,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          ok: false,
          errorCode: 'INVALID_OUTPUT',
        });

        // 回喂校验错误：不喂的话第二次会原样再错一次。
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `上面的回答不符合格式要求：${detail}。请只返回符合要求的 JSON。`,
        });
        continue;
      }

      const meta: CallMeta = {
        ...baseMeta,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        ok: true,
      };
      deps.metaLog?.record(meta);

      deps.decisionLog?.claim(key);
      return { decision: parsed.data, meta };
    } catch (error) {
      const mapped = mapError(error);
      lastError = mapped;
      deps.metaLog?.record({
        ...baseMeta,
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        ok: false,
        errorCode: mapped.code,
      });

      if (!RETRYABLE.has(mapped.code)) break;
    }
  }

  throw lastError ?? new LlmError('UNKNOWN', '调用失败且没有错误信息');
}

/** 解析 JSON；解析失败当作格式错误（由 schema 再兜一层）。 */
function safeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * 把任意错误映射成**脱敏**的 `LlmError`。
 *
 * 只保留状态码与错误类别：响应体原文可能包含提示词全文、甚至密钥回显（SEC-7）。
 */
function mapError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;

  // 顺序有讲究：SDK 把「超时」包成 `APIConnectionTimeoutError`（属于连接错误的一种），
  // 先判连接错误会把超时误归成 NETWORK，重试分类与日志都会跟着错。
  // 真实超时路径：我们传的是 `AbortSignal.timeout`，SDK 会把它表现成
  // `APIUserAbortError`（`APIError` 的子类、`status` 未定义），原始原因挂在 `cause` 上。
  // 不单独识别它，超时就会被归成 500 → SERVER_ERROR（C-55）。
  if (error instanceof OpenAI.APIUserAbortError) {
    const cause = (error as { cause?: { name?: string } }).cause;
    return cause?.name === 'TimeoutError'
      ? new LlmError('TIMEOUT', '调用超时')
      : new LlmError('ABORTED', '调用被取消');
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LlmError('TIMEOUT', '调用超时');
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmError('NETWORK', '网络错误');
  }

  if (error instanceof OpenAI.APIError) {
    return new LlmError(statusToCode(error.status ?? 500), `模型服务返回 ${String(error.status)}`);
  }

  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new LlmError('TIMEOUT', '调用超时');
  }

  return new LlmError('NETWORK', '网络错误');
}
