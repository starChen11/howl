import OpenAI from 'openai';

import type { ProjectedContext } from '@shared/project';

import type { LlmConfig } from './config';
import { styleOf } from '@engine/personas';
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
  /** 人格 id（RFC-009）：决定风格段与 `maxOutputTokens`。 */
  personaId?: string | null;
  /** 对局模式决定胜利条件的措辞，不能写死。 */
  mode: 'slaughter-side' | 'slaughter-all';
  /** 上一次动作被拒绝的原因，回喂给模型重试。 */
  feedback?: string;
  /** 额外指令（例如「现在明确回答是否准备」）。 */
  instruction?: string;
  /** 外部取消信号：新的调用会取消同一席位尚未完成的旧调用。 */
  signal?: AbortSignal;
  /** 白天发言：每收到一段 speech 文本就回调一次（token 级流式）。 */
  onDelta?: (text: string) => void;
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
      content: buildSystemPrompt({ personaId: input.personaId ?? null, mode: input.mode }),
    },
    { role: 'user', content: buildUserMessage(input.ctx) },
  ];
  if (input.instruction !== undefined) {
    messages.push({ role: 'user', content: input.instruction });
  }
  if (input.feedback !== undefined) {
    messages.push({
      role: 'user',
      content: `你上一次的 action 被拒绝：${input.feedback}。请换一个合法动作，仍然只返回 JSON。`,
    });
  }

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
      const signal =
        input.signal === undefined
          ? AbortSignal.timeout(config.timeoutMs)
          : AbortSignal.any([AbortSignal.timeout(config.timeoutMs), input.signal]);
      const streamThis = input.onDelta !== undefined && attempt === 1;
      const tokenBudget = maxTokensFor(config, input.personaId ?? null) * (attempt === 1 ? 1 : 2);

      let content = '';
      let usage:
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          }
        | undefined;

      if (streamThis) {
        const stream = await client.chat.completions.create(
          {
            model: config.model,
            messages,
            temperature: config.temperature,
            max_tokens: tokenBudget,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal },
        );
        const tracker = { emitted: 0 };
        for await (const chunk of stream) {
          const piece = chunk.choices[0]?.delta?.content ?? '';
          if (piece !== '') {
            content += piece;
            const addition = extractSpeechIncrement(content, tracker);
            if (addition !== '') input.onDelta?.(addition);
          }
          if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage;
        }
      } else {
        const response = await client.chat.completions.create(
          {
            model: config.model,
            messages,
            temperature: config.temperature,
            max_tokens: tokenBudget,
          },
          { signal },
        );
        content = response.choices[0]?.message.content ?? '';
        usage = response.usage;
      }

      if (content.trim() === '') {
        console.warn('[llm] 模型返回空正文', {
          seat: input.ctx.self.seat,
          phase: input.ctx.phase,
          maxTokens: maxTokensFor(config, input.personaId ?? null),
        });
      }
      const parsed = DecisionSchema.safeParse(normalizeDecision(safeJson(content)));

      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        lastError = new LlmError('INVALID_OUTPUT', '模型返回的格式不符合契约');
        console.warn('[llm] 模型输出不符合契约', {
          seat: input.ctx.self.seat,
          phase: input.ctx.phase,
          detail,
        });
        deps.metaLog?.record({
          ...baseMeta,
          latencyMs: Date.now() - startedAt,
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
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
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
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

/**
 * 输出上限：以配置为基线，按人格的 `verbosity` 缩放。
 *
 * 没有性格（玩家席位 / 未分配）时用配置值。
 */
function maxTokensFor(config: LlmConfig, personaId: string | null): number {
  if (personaId === null) return config.maxOutputTokens;
  const style = styleOf(personaId);
  const factor = style.targetSentences / 2; // 1 档 → 0.5，2 档 → 1，3 档 → 1.5
  return Math.max(120, Math.round(config.maxOutputTokens * factor));
}

/**
 * 从**尚未完成的 JSON**里提取 `speech` 字段的增量。
 *
 * 模型是一边生成 JSON、一边被消费的；`speech` 可能只写到一半。
 * 这里只解码已经完整的转义序列，返回相对上次新增的文本。
 */
export function extractSpeechIncrement(content: string, state: { emitted: number }): string {
  const key = content.indexOf('"speech"');
  if (key < 0) return '';
  const colon = content.indexOf(':', key + 8);
  if (colon < 0) return '';
  let start = colon + 1;
  while (start < content.length && /\s/.test(content[start] ?? '')) start += 1;
  if (content[start] !== '"') return '';
  start += 1;

  let raw = '';
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index] ?? '';
    if (escaped) {
      if (char === 'u') {
        const hex = content.slice(index + 1, index + 5);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
        raw += `\\u${hex}`;
        index += 4;
        escaped = false;
        continue;
      }
      raw += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') break;
    raw += char;
  }

  let decoded: string;
  try {
    decoded = JSON.parse(`"${raw}"`) as string;
  } catch {
    return '';
  }
  if (decoded.length <= state.emitted) return '';
  const addition = decoded.slice(state.emitted);
  state.emitted = decoded.length;
  return addition;
}

/** 归一化模型常见的 null / 字符串数字 / 大写动作，避免整条决策作废。 */
function normalizeDecision(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof copy['action'] === 'string') {
    copy['action'] = copy['action'].trim().toLowerCase();
  }
  if (typeof copy['target'] === 'string' && /^\d+$/.test(copy['target'].trim())) {
    copy['target'] = Number(copy['target']);
  }
  for (const key of ['target', 'speech', 'claim', 'reason']) {
    if (copy[key] === null) delete copy[key];
  }
  if (typeof copy['reason'] === 'string') copy['reason'] = copy['reason'].slice(0, 200);
  if (copy['claim'] !== null && typeof copy['claim'] === 'object') {
    const claim = { ...(copy['claim'] as Record<string, unknown>) };
    for (const key of ['role', 'checks', 'accuses']) {
      if (claim[key] === null) delete claim[key];
    }
    // claim 只是展示用的附带信息；格式不对时丢掉它，不让整条行动失败。
    if (!DecisionSchema.shape.claim.safeParse(claim).success) delete copy['claim'];
    else copy['claim'] = claim;
  }
  return copy;
}

/** 解析 JSON；容忍模型常见的 ```json 代码块和前后解释文字。 */
function safeJson(content: string): unknown {
  const candidates = [content];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1]);
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(content.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试下一个候选。
    }
  }
  return undefined;
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
