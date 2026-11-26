import { z } from 'zod';

import type { ReplaySnapshot } from '@shared/replay';
import { ROLE_LABELS } from '@shared/terms';
import type { PostmortemRequest, PostmortemResponse } from '@shared/postmortem';

import { completeText } from './llm/client';
import { loadLlmConfig } from './llm/config';

type History = { seat: number; target: number; question: string; answer: string }[];

export const PostmortemRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('questions'),
    seat: z.number().int().min(1).max(9),
    history: z
      .array(
        z.object({
          seat: z.number().int().min(1).max(9),
          target: z.number().int().min(1).max(9),
          question: z.string().max(500),
          answer: z.string().max(1000),
        }),
      )
      .max(60),
  }),
  z.object({
    kind: z.literal('answer'),
    seat: z.number().int().min(1).max(9),
    target: z.number().int().min(1).max(9),
    question: z.string().min(1).max(500),
    history: z
      .array(
        z.object({
          seat: z.number().int().min(1).max(9),
          target: z.number().int().min(1).max(9),
          question: z.string().max(500),
          answer: z.string().max(1000),
        }),
      )
      .max(60),
  }),
  z.object({
    kind: z.literal('vote'),
    seat: z.number().int().min(1).max(9),
    candidates: z.array(z.number().int().min(1).max(9)).min(1).max(9),
    history: z
      .array(
        z.object({
          seat: z.number().int().min(1).max(9),
          target: z.number().int().min(1).max(9),
          question: z.string().max(500),
          answer: z.string().max(1000),
        }),
      )
      .max(60),
  }),
  z.object({
    kind: z.literal('speech'),
    seat: z.number().int().min(1).max(9),
    reason: z.string().max(500),
  }),
]);

function contextText(snapshot: ReplaySnapshot): string {
  const roles = snapshot.seats
    .map((seat) => `${seat.seat}号=${seat.roleLabel}${seat.alive ? '' : '（已出局）'}`)
    .join('、');
  const timeline = snapshot.timeline
    .slice(-80)
    .map((entry) => `第${entry.day}天 ${entry.text}`)
    .join('\n');
  const thoughts = snapshot.thoughts
    .slice(-30)
    .map(
      (thought) =>
        `${thought.seat}号 [${thought.kind}] ${thought.reason}${thought.chose === '' ? '' : `（${thought.chose}）`}`,
    )
    .join('\n');
  return `对局结果：${snapshot.result === 'wolf' ? `${ROLE_LABELS.wolf}胜` : '好人胜'}（${snapshot.winCondition}）\n身份：${roles}\n\n时间线：\n${timeline}\n\nAI 当时的部分推理：\n${thoughts}`;
}

function historyText(history: History): string {
  if (!Array.isArray(history) || history.length === 0) return '（还没有人拷问）';
  return history
    .map(
      (item) =>
        `${item.seat}号问${item.target}号：${item.question}\n${item.target}号答：${item.answer}`,
    )
    .join('\n');
}

function parseQuestions(text: string, self: number): { target: number; question: string }[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const raw: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (entry): entry is { target?: unknown; question?: unknown } =>
          typeof entry === 'object' && entry !== null,
      )
      .map((entry) => ({
        target: Number(entry.target),
        question: String(entry.question ?? '').trim(),
      }))
      .filter(
        (entry) =>
          Number.isInteger(entry.target) &&
          entry.target >= 1 &&
          entry.target <= 9 &&
          entry.target !== self &&
          entry.question !== '',
      )
      .slice(0, 2);
  } catch {
    return [];
  }
}

/** 赛后拷问的模型调用（RFC-023）。 */
export async function answerPostmortem(
  snapshot: ReplaySnapshot,
  request: PostmortemRequest,
  env: NodeJS.ProcessEnv = process.env,
  complete = completeText,
): Promise<PostmortemResponse> {
  const config = loadLlmConfig(env);
  const context = contextText(snapshot);
  const system = `你是身份推理游戏赛后复盘中的一名玩家。所有身份已经公开，可以自由吐槽、甩锅、拷问，但不能编造对局里没发生的事实，也不能改称自己的身份（身份以给出的列表为准）。用简体中文，口语化，不超过 120 字。\n\n${context}`;

  if (request.kind === 'questions') {
    const prompt = `现在轮到 ${request.seat} 号拷问。你可以选择 0～2 个你认为该为失败负责的座位，向每个座位提一个问题；如果觉得没有可问的，返回空数组。只返回 JSON 数组，格式 [{"target":2,"question":"..."}]。\n\n已有问答：\n${historyText(request.history)}`;
    const text = await complete(config, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    return { kind: 'questions', questions: parseQuestions(text, request.seat) };
  }

  if (request.kind === 'answer') {
    const prompt = `${request.seat} 号拷问你（${request.target} 号）：“${request.question}”\n请以 ${request.target} 号的身份回答，可以解释、反击或甩锅。只返回回答正文。\n\n已有问答：\n${historyText(request.history)}`;
    return {
      kind: 'answer',
      text: await complete(config, [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]),
    };
  }

  if (request.kind === 'vote') {
    const prompt = `请以 ${request.seat} 号的身份，从 ${request.candidates.join('、')} 号中选出你认为本局最大责任人（可以选自己）。只返回座位数字，不要解释。\n\n已有问答：\n${historyText(request.history)}`;
    const text = await complete(config, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    const target = Number(text.match(/\d+/)?.[0]);
    return {
      kind: 'vote',
      target: request.candidates.includes(target)
        ? target
        : (request.candidates[0] ?? request.seat),
    };
  }

  const prompt = `你（${request.seat} 号）被大家投为“最大责任人”。请发表一句赛后感想，可以认错、辩解或甩锅；不超过 80 字。`;
  return {
    kind: 'speech',
    text: await complete(config, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]),
  };
}
