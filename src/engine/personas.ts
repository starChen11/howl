import type { RngState } from '@shared/domain';

import { nextInt } from './rng';

/**
 * AI 人格库（RFC-009 §2.1）。
 *
 * 人格是**结构化描述**，不是一句自由文本：`tone` / `verbosity` / `aggression` 都能被
 * 断言，而「说话像个老手」不能。8 个 AI 各取一个、互不重复、整局不变。
 *
 * 人格与身份**正交**（AC-3）：先发牌，再独立分配；两者不得互相约束。
 */

export interface Persona {
  id: string;
  label: string;
  tone: 'assertive' | 'hesitant' | 'sarcastic' | 'plain' | 'analytical';
  /** 发言长短档：1 短、2 中、3 长。 */
  verbosity: 1 | 2 | 3;
  /** 指认强度：0 少、1 中、2 多。 */
  aggression: 0 | 1 | 2;
  quirk?: string;
}

export const PERSONAS: readonly Persona[] = [
  { id: 'blunt', label: '直来直去', tone: 'assertive', verbosity: 1, aggression: 2 },
  { id: 'careful', label: '谨慎观察', tone: 'analytical', verbosity: 3, aggression: 0 },
  { id: 'smirk', label: '阴阳怪气', tone: 'sarcastic', verbosity: 2, aggression: 1, quirk: '呵' },
  { id: 'plain', label: '平平无奇', tone: 'plain', verbosity: 1, aggression: 0 },
  { id: 'pushy', label: '强势带节奏', tone: 'assertive', verbosity: 2, aggression: 2 },
  { id: 'doubtful', label: '疑神疑鬼', tone: 'hesitant', verbosity: 2, aggression: 1 },
  { id: 'calm', label: '冷静推理', tone: 'analytical', verbosity: 2, aggression: 1 },
  { id: 'quiet', label: '惜字如金', tone: 'plain', verbosity: 1, aggression: 0 },
  {
    id: 'chatty',
    label: '絮絮叨叨',
    tone: 'plain',
    verbosity: 3,
    aggression: 0,
    quirk: '我先捋一下',
  },
  { id: 'sharp', label: '一针见血', tone: 'assertive', verbosity: 1, aggression: 1 },
  { id: 'wry', label: '自嘲', tone: 'sarcastic', verbosity: 2, aggression: 0 },
  { id: 'measured', label: '不紧不慢', tone: 'hesitant', verbosity: 3, aggression: 1 },
];

/** 每局要分配的人格数 = 8 个 AI 席位。 */
export const PERSONAS_PER_GAME = 8;

/**
 * 从库里不重复地取 8 个，并洗牌成「哪个 AI 拿哪个」。
 *
 * 用**发牌之后的** rng 序列：换种子会换人格，但不影响身份（AC-3 的正交性）。
 */
export function assignPersonas(rng: RngState): { personas: Persona[]; rng: RngState } {
  const pool = [...PERSONAS];
  const picked: Persona[] = [];
  let cursor = rng;

  for (let index = 0; index < PERSONAS_PER_GAME; index += 1) {
    const drawn = nextInt(cursor, pool.length);
    cursor = drawn.rng;
    const [taken] = pool.splice(drawn.value, 1);
    if (taken === undefined) throw new Error('人格池不够分配');
    picked.push(taken);
  }

  return { personas: picked, rng: cursor };
}

/** 按 id 取人格；未知 id 抛错而不是给默认值（演数据要炸出来）。 */
export function personaOf(id: string): Persona {
  const found = PERSONAS.find((persona) => persona.id === id);
  if (found === undefined) throw new Error(`未知人格：${id}`);
  return found;
}

/**
 * 风格画像：把人格压成两个可断言的数字。
 *
 * AC-4 要求「同一局内至少 3 个 AI 的发言在可观测指标上有差异」。真正的句长要等模型生成
 * （RFC-010/011），本 RFC 能保证的是**目标风格不同**——提示里会照着这两个数去约束。
 */
export function styleOf(id: string): { targetSentences: number; aggression: number } {
  const persona = personaOf(id);
  return { targetSentences: persona.verbosity, aggression: persona.aggression };
}
