import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
import { Notepad, notepadKey } from '@client/components/Notepad';
import type { ProjectedContext } from '@shared/project';

/**
 * RFC-013 §5 AC-5 ~ AC-7 / AC-11 / AC-13 ~ AC-15：观战、真相零副作用、记事板隔离。
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function view(partial: Partial<ProjectedContext> = {}): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: false, personaId: null },
    phase: 'DAY_SPEECH',
    day: 2,
    aliveSeats: [2, 3],
    deadSeats: [1],
    publicEvents: [
      {
        gameId: 'g',
        seq: 1,
        ts: 0,
        type: 'DAY_STARTED',
        visibleTo: 'public',
        payload: { day: 2, diedLastNight: [1], speechStartSeat: 2 },
      } as never,
    ],
    privateEvents: [],
    knowledge: {
      teammates: [],
      checks: [],
      potions: { heal: 'used', poison: 'used' },
      canShoot: false,
      knownKillTarget: null,
    },
    legalTargets: [],
    pending: null,
    ...partial,
  } as ProjectedContext;
}

function fakeClient(ctx: ProjectedContext) {
  const calls = { submits: 0, truth: 0 };
  const client = {
    game: async () => ({ version: 5, view: ctx }),
    openStream: () => () => undefined,
    draft: async () => undefined,
    submit: async () => {
      calls.submits += 1;
      return { ok: true as const };
    },
    truth: async () => {
      calls.truth += 1;
      return {
        seats: [
          { seat: 1, roleLabel: '村民', alive: false },
          { seat: 2, roleLabel: '狼人', alive: true },
        ],
      };
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('AC-5 ~ AC-7 · 出局后观战', () => {
  it('没有发言输入、没有投票，只有观战提示', async () => {
    const { client } = fakeClient(view());
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.getByText(/你已出局，正在观战/)).toBeTruthy();
    expect(screen.queryByLabelText('你的发言')).toBeNull();
    expect(screen.queryByRole('button', { name: /投 \d+ 号/ })).toBeNull();
  });
});

describe('AC-8 ~ AC-11 · 真相视图', () => {
  it('默认关闭，开启后显示所有人身份，开关不提交任何 action', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(view());
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.queryByRole('heading', { name: '真相视图' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '打开真相视图' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '真相视图' })).toBeTruthy());
    expect(screen.getByText(/2 号：狼人/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '关闭真相视图' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '真相视图' })).toBeNull());

    // 开关是纯视图状态：没有提交任何 action（AC-11）
    expect(calls.submits).toBe(0);
    expect(calls.truth).toBe(1);
  });
});

describe('AC-13 ~ AC-15 · 记事板', () => {
  it('内容只写本地，刷新后仍在，且不会提交给服务端', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(view());
    render(<App gameId="g" client={client} />);

    const box = await screen.findByLabelText('记事板内容');
    await user.click(box);
    await user.paste('3 号发言太急，可疑。');

    expect(localStorage.getItem(notepadKey('g'))).toBe('3 号发言太急，可疑。');
    expect(calls.submits).toBe(0);

    // 重新挂载（模拟刷新）：内容仍在
    cleanup();
    render(<Notepad gameId="g" />);
    expect((screen.getByLabelText('记事板内容') as HTMLTextAreaElement).value).toBe(
      '3 号发言太急，可疑。',
    );
  });
});
