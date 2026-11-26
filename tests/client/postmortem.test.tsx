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
