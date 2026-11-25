/**
 * LLM 配置（RFC-006 §2.1）。
 *
 * **`DEEPSEEK_API_KEY` 只在这个文件里被读取一次**（AC-2）。别处若需要它，从这里拿，
 * 不要自己读 `process.env` —— 那是「密钥不出服务端」这条规则的第一个破口。
 */

export interface LlmConfig {
  apiKey: string;
  model: string;
  /** v1 恒为 true（RULES AI-9）；关闭需走 `/manage-changes`。 */
  thinking: boolean;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** 总尝试次数 = 1 + maxRetries。 */
  maxRetries: number;
}

export const DEFAULT_LLM_CONFIG = {
  model: 'deepseek-flash',
  thinking: true,
  temperature: 0.8,
  // 思维链也占输出预算；800 在后期容易只剩思考没有正文。
  maxOutputTokens: 4096,
  timeoutMs: 30_000,
  maxRetries: 1,
} as const;

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`环境变量 ${name} 必须是非负整数，收到 ${raw}`);
  }
  return value;
}

/**
 * 从环境变量组装配置。
 *
 * 缺 key 时抛错而不是给空串：给空串会让第一次真实调用才失败，而那时已经在对局中。
 */
/** 密钥环境变量的名字：只在本文件出现，其他模块要用就 import 它。 */
export const API_KEY_ENV = 'DEEPSEEK_API_KEY';

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env[API_KEY_ENV];
  if (apiKey === undefined || apiKey === '') {
    throw new Error('缺少 DEEPSEEK_API_KEY');
  }

  return {
    apiKey,
    model: env['LLM_MODEL'] ?? DEFAULT_LLM_CONFIG.model,
    thinking: DEFAULT_LLM_CONFIG.thinking,
    temperature: DEFAULT_LLM_CONFIG.temperature,
    maxOutputTokens: readInt(env, 'LLM_MAX_OUTPUT_TOKENS', DEFAULT_LLM_CONFIG.maxOutputTokens),
    timeoutMs: readInt(env, 'LLM_TIMEOUT_MS', DEFAULT_LLM_CONFIG.timeoutMs),
    maxRetries: readInt(env, 'LLM_MAX_RETRIES', DEFAULT_LLM_CONFIG.maxRetries),
  };
}
