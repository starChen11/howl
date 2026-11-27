import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { PostmortemRequest, PostmortemResponse } from '@shared/postmortem';
import type { ReplaySnapshot } from '@shared/replay';
import { PostmortemPanel } from '@client/components/PostmortemPanel';

afterEach(cleanup);

const snapshot = {
  gameId: 'g',
  seed: 1,
  finishedAt: 0,
  result: 'good',
  winCondition: 'all-wolves-dead',
  timeline: [],
  seats: Array.from({ length: 9 }, (_, index) => ({
    seat: index + 1,
    role: index === 1 ? 'wolf' : 'villager',
    roleLabel: index === 1 ? '狼人' : '村民',
    personaId: null,
    personaLabel: null,
    alive: true,
  })),
  thoughts: [],
  degraded: [],
} as unknown as ReplaySnapshot;

describe('RFC-023 · 赛后拷问面板', () => {
  it('玩家可以选目标提问并看到回答', async () => {
    const requests: PostmortemRequest[] = [];
    const ask = async (body: PostmortemRequest): Promise<PostmortemResponse> => {
      requests.push(body);
      if (body.kind === 'answer') return { kind: 'answer', text: '我当时听错了。' };
      if (body.kind === 'questions') return { kind: 'questions', questions: [] };
      if (body.kind === 'vote') return { kind: 'vote', target: body.seat };
      return { kind: 'speech', text: '我的。' };
    };

    render(<PostmortemPanel snapshot={snapshot} playerSeat={1} ask={ask} />);

    await userEvent.setup().click(screen.getByRole('button', { name: '2 号·狼人' }));
    await userEvent.setup().type(screen.getByLabelText('拷问内容'), '你为什么投我？');
    await userEvent.setup().click(screen.getByRole('button', { name: '提问' }));

    await waitFor(() => expect(screen.getByText('我当时听错了。')).toBeTruthy());
    expect(requests.some((request) => request.kind === 'answer' && request.target === 2)).toBe(
      true,
    );
  });
});

describe('RFC-023 · 完整责任投票', () => {
  it('AI 回合自动推进，投票后可发表最大责任人感想', async () => {
    const ask = async (body: PostmortemRequest): Promise<PostmortemResponse> => {
      if (body.kind === 'questions') return { kind: 'questions', questions: [] };
      if (body.kind === 'answer') return { kind: 'answer', text: '答' };
      if (body.kind === 'vote') return { kind: 'vote', target: 2 };
      return { kind: 'speech', text: 'AI 感想' };
    };
    render(<PostmortemPanel snapshot={snapshot} playerSeat={1} ask={ask} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '结束我的拷问' }));
    await waitFor(() => expect(screen.getByText('投票：本局最大责任人')).toBeTruthy(), {
      timeout: 5_000,
    });

    await user.click(screen.getByRole('button', { name: '投 2 号·狼人' }));
    await waitFor(() => expect(screen.getByText('AI 感想')).toBeTruthy(), { timeout: 5_000 });
    expect(screen.getByText('最大责任人：2 号·狼人')).toBeTruthy();
  });
}, 20_000);

describe('RFC-023 · 真人被 AI 拷问', () => {
  it('AI 问到玩家时停下来让玩家自己回答，不调用模型替他回答', async () => {
    const requests: PostmortemRequest[] = [];
    const ask = async (body: PostmortemRequest): Promise<PostmortemResponse> => {
      requests.push(body);
      if (body.kind === 'questions') {
        return body.seat === 2
          ? { kind: 'questions', questions: [{ target: 1, question: '你为什么投我？' }] }
          : { kind: 'questions', questions: [] };
      }
      if (body.kind === 'answer') return { kind: 'answer', text: '模型代答' };
      if (body.kind === 'vote') return { kind: 'vote', target: 1 };
      return { kind: 'speech', text: '我的。' };
    };
    render(<PostmortemPanel snapshot={snapshot} playerSeat={1} ask={ask} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '结束我的拷问' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '2 号·狼人 问你' })).toBeTruthy(),
    );
    expect(screen.getByLabelText('你的回答')).toBeTruthy();

    await user.type(screen.getByLabelText('你的回答'), '因为你的票型最像狼。');
    await user.click(screen.getByRole('button', { name: '回答' }));
    await waitFor(() => expect(screen.getByText('因为你的票型最像狼。')).toBeTruthy());
    expect(requests.some((request) => request.kind === 'answer' && request.target === 1)).toBe(
      false,
    );
  });
});
