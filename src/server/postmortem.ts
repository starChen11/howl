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

function seatLabel(snapshot: ReplaySnapshot, seat: number): string {
  const info = snapshot.seats.find((entry) => entry.seat === seat);
  return `${seat} 号（${info?.roleLabel ?? '未知身份'}）`;
}

function identityText(snapshot: ReplaySnapshot, seat: number): string {
  return `你的座位：${seatLabel(snapshot, seat)}。你就是这个座位本人，不要以其他座位的身份自称。`;
}

function isWolfSeat(snapshot: ReplaySnapshot, seat: number): boolean {
  return snapshot.seats.find((entry) => entry.seat === seat)?.role === 'wolf';
}

function lostSide(snapshot: ReplaySnapshot): 'wolf' | 'good' {
  return snapshot.result === 'wolf' ? 'good' : 'wolf';
}

/** 输的一方的对内分锅池：不要把自己的失败怪到敌人正常发挥上。 */
function blamePool(snapshot: ReplaySnapshot, seat: number): number[] {
  const selfIsWolf = isWolfSeat(snapshot, seat);
  const lostIsWolf = lostSide(snapshot) === 'wolf';
  const sameSide = snapshot.seats
    .filter((entry) => entry.seat !== seat && isWolfSeat(snapshot, entry.seat) === selfIsWolf)
    .map((entry) => entry.seat);
  if (selfIsWolf === lostIsWolf) return sameSide;
  return snapshot.seats.filter((entry) => entry.seat !== seat).map((entry) => entry.seat);
}

function blameRule(snapshot: ReplaySnapshot, seat: number): string {
  const selfIsWolf = isWolfSeat(snapshot, seat);
  if (selfIsWolf !== (lostSide(snapshot) === 'wolf')) return '';
  return selfIsWolf
    ? '本局是狼队输了：先把锅分在狼队内部，不要把好人正常投票当罪状。'
    : '本局是好人输了：${ROLE_LABELS.wolf}悍跳、骗人属于正常战术，不要把敌人玩得好当成罪责；先反思好人阵营自己的判断和票型。';
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

function parseQuestions(
  text: string,
  self: number,
  allowed: number[],
): { target: number; question: string }[] {
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
          allowed.includes(entry.target) &&
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
  const rules =
    '所有身份已经公开。可以自由吐槽、甩锅、拷问，但不能编造对局里没发生的事实，也不能改称自己的身份（身份以给出的列表为准）。甩锅要讲道理：敌人正常发挥不是罪，输的一方先从自己阵营找责任。用简体中文，口语化，不超过 120 字。';
  const systemFor = (seat: number, extra = '') =>
    `你是身份推理游戏赛后复盘中的一名玩家。\n${identityText(snapshot, seat)}${extra}\n${rules}\n\n${context}`;

  if (request.kind === 'questions') {
    const pool = blamePool(snapshot, request.seat);
    const allowed =
      pool.length === 0
        ? snapshot.seats.filter((entry) => entry.seat !== request.seat).map((entry) => entry.seat)
        : pool;
    const others = allowed.map((seat) => seatLabel(snapshot, seat)).join('、');
    const prompt = `你现在是 ${seatLabel(snapshot, request.seat)}，轮到你拷问。${blameRule(snapshot, request.seat)}可选座位：${others}。你可以选择 0～2 个你认为该为失败负责的座位，向每个座位提一个问题；如果觉得没有可问的，返回空数组。只返回 JSON 数组，格式 [{"target":2,"question":"..."}]。\n\n已有问答：\n${historyText(request.history)}`;
    const text = await complete(config, [
      { role: 'system', content: systemFor(request.seat) },
      { role: 'user', content: prompt },
    ]);
    return { kind: 'questions', questions: parseQuestions(text, request.seat, allowed) };
  }

  if (request.kind === 'answer') {
    const prompt = `${seatLabel(snapshot, request.seat)} 正在拷问你（${seatLabel(snapshot, request.target)}）：“${request.question}”\n你现在是 ${seatLabel(snapshot, request.target)}，请从 ${request.target} 号本人的角度回答，可以解释、反击或甩锅；不要以提问者的身份回答。${blameRule(snapshot, request.target)}只返回回答正文。\n\n已有问答：\n${historyText(request.history)}`;
    return {
      kind: 'answer',
      text: await complete(config, [
        {
          role: 'system',
          content: systemFor(
            request.target,
            `\n你正在回答 ${seatLabel(snapshot, request.seat)}的拷问。`,
          ),
        },
        { role: 'user', content: prompt },
      ]),
    };
  }

  if (request.kind === 'vote') {
    const pool = blamePool(snapshot, request.seat);
    const restricted = request.candidates.filter(
      (seat) => seat === request.seat || pool.length === 0 || pool.includes(seat),
    );
    const voteCandidates = restricted.length === 0 ? request.candidates : restricted;
    const prompt = `你现在是 ${seatLabel(snapshot, request.seat)}。${blameRule(snapshot, request.seat)}请从 ${voteCandidates.map((seat) => seatLabel(snapshot, seat)).join('、')} 中选出你认为本局最大责任人（可以选自己）。只返回座位数字，不要解释。\n\n已有问答：\n${historyText(request.history)}`;
    const text = await complete(config, [
      { role: 'system', content: systemFor(request.seat) },
      { role: 'user', content: prompt },
    ]);
    const target = Number(text.match(/\d+/)?.[0]);
    return {
      kind: 'vote',
      target: voteCandidates.includes(target) ? target : (voteCandidates[0] ?? request.seat),
    };
  }

  const prompt = `你现在是 ${seatLabel(snapshot, request.seat)}，被大家投为“最大责任人”。请发表一句赛后感想，可以认错、辩解或甩锅；不超过 80 字。`;
  return {
    kind: 'speech',
    text: await complete(config, [
      { role: 'system', content: systemFor(request.seat) },
      { role: 'user', content: prompt },
    ]),
  };
}
