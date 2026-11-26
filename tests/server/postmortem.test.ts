import { describe, expect, it } from 'vitest';

import type { ReplaySnapshot } from '@shared/replay';
import { answerPostmortem } from '@server/postmortem';

const snapshot = {
  gameId: 'g',
  seed: 1,
  finishedAt: 0,
  result: 'good',
  winCondition: 'all-wolves-dead',
  timeline: [{ seq: 1, day: 1, phase: 'DAY_VOTE', text: '1 号投 2 号' }],
  seats: [
    {
      seat: 1,
      role: 'villager',
      roleLabel: '村民',
      personaId: null,
      personaLabel: null,
      alive: true,
    },
    { seat: 2, role: 'wolf', roleLabel: '狼人', personaId: null, personaLabel: null, alive: false },
  ],
  thoughts: [],
  degraded: [],
} as unknown as ReplaySnapshot;

const configEnv = { DEEPSEEK_API_KEY: 'test' };

describe('RFC-023 · 赛后拷问模型调用', () => {
  it('questions 解析为合法目标', async () => {
    const calls: string[] = [];
    const complete = async (_config: unknown, messages: { content: string }[]) => {
      calls.push(messages[messages.length - 1]?.content ?? '');
      return '[{"target":2,"question":"你为什么投我？"}]';
    };
    const result = await answerPostmortem(
      snapshot,
      { kind: 'questions', seat: 1, history: [] },
      configEnv,
      complete as never,
    );
    expect(result).toEqual({
      kind: 'questions',
      questions: [{ target: 2, question: '你为什么投我？' }],
    });
    expect(calls[0]).toContain('1 号拷问');
  });

  it('answer 返回正文', async () => {
    const result = await answerPostmortem(
      snapshot,
      { kind: 'answer', seat: 1, target: 2, question: '为什么？', history: [] },
      configEnv,
      (async () => '因为我判断错了。') as never,
    );
    expect(result).toEqual({ kind: 'answer', text: '因为我判断错了。' });
  });

  it('vote 只返回候选座位', async () => {
    const result = await answerPostmortem(
      snapshot,
      { kind: 'vote', seat: 1, candidates: [1, 2], history: [] },
      configEnv,
      (async () => '2') as never,
    );
    expect(result).toEqual({ kind: 'vote', target: 2 });
  });
});
