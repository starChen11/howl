/**
 * 浏览器能力探测（RFC-016 §2.1）。
 *
 * v1 不做降级实现：缺能力时给一条**明确的中文提示**，而不是白屏或诡异的半残界面。
 * 降级路径没人维护，比直接告知更危险。
 */

export interface CapabilityReport {
  ok: boolean;
  missing: string[];
  message: string | null;
}

/** 我们真正依赖的能力。每一项都必须说清「缺了会怎样」。 */
const REQUIRED: { name: string; label: string; probe: (scope: typeof globalThis) => boolean }[] = [
  {
    name: 'EventSource',
    label: '实时消息（EventSource）',
    probe: (scope) => typeof scope.EventSource === 'function',
  },
  {
    name: 'TextDecoder',
    label: '文本解码（TextDecoder）',
    probe: (scope) => typeof scope.TextDecoder === 'function',
  },
  {
    name: 'fetch',
    label: '网络请求（fetch）',
    probe: (scope) => typeof scope.fetch === 'function',
  },
];

export function detectCapabilities(target: typeof globalThis = globalThis): CapabilityReport {
  const missing = REQUIRED.filter((capability) => !capability.probe(target)).map(
    (capability) => capability.label,
  );

  if (missing.length === 0) return { ok: true, missing: [], message: null };

  return {
    ok: false,
    missing,
    message: `这个浏览器缺少：${missing.join('、')}。请换用最近两个版本的 Chrome、Edge、Safari 或 Firefox。`,
  };
}
