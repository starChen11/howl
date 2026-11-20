import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
import type { ProjectedContext } from '@shared/project';

/**
 * RFC-012 §5 AC-9 / AC-13 / AC-14 / AC-15：整页集成。
 *
 * 组件单测看不到「有没有被挂上去」——删掉 `<IdCard>` 或读屏区，组件测试仍然全绿。
 */

afterEach(cleanup);

function view(partial: Partial<ProjectedContext> = {}): ProjectedContext {
  return {
    self: { seat: 1, role: 'seer', alive: true, personaId: null },
    phase: 'DAY_SPEECH',
    day: 2,
    aliveSeats: [1, 2, 3],
    deadSeats: [],
    publicEvents: [
      {
        gameId: 'g',
        seq: 1,
        ts: 0,
        type: 'DAY_STARTED',
        visibleTo: 'public',
        payload: { day: 2, diedLastNight: [], speechStartSeat: 1 },
      } as never,
    ],
    privateEvents: [],
    knowledge: {
      teammates: [],
      checks: [{ day: 1, target: 2, result: 'wolf' }],
      potions: { heal: 'used', poison: 'used' },
      canShoot: false,
      knownKillTarget: null,
    },
    legalTargets: [2, 3],
    pending: 'speak',
    ...partial,
  } as ProjectedContext;
}

function fakeClient(ctx: ProjectedContext) {
  const calls = { drafts: [] as string[], submitted: 0 };
  const client = {
    game: async () => ({ version: 10, view: ctx }),
    openStream: () => () => undefined,
    draft: async (_gameId: string, text: string) => {
      calls.drafts.push(text);
    },
    submit: async () => {
      calls.submitted += 1;
      return { ok: true as const };
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('AC-15 · 身份卡与读屏区在整页里真的存在', () => {
  it('渲染「你的身份」与读屏公告', async () => {
    const { client } = fakeClient(view());
    render(<App gameId="g" client={client} />);

    expect(await screen.findByRole('heading', { name: '你的身份' })).toBeTruthy();
    // 公告在 effect 里写入，等它出现
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('你是 1 号'));
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('第 2 天');
    expect(status.textContent).not.toContain('时间到');
  });

  it('重投阶段显示「平票重投」而不是原始枚举', async () => {
    const { client } = fakeClient(view({ phase: 'DAY_VOTE_RUNOFF', legalTargets: [2] }));
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('平票重投'));
  });
});

describe('AC-13 · 重投只列并列者', () => {
  it('RUNOFF 时投票按钮只来自 legalTargets，且没有弃权', async () => {
    const { client } = fakeClient(view({ phase: 'DAY_VOTE_RUNOFF', legalTargets: [2] }));
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.getByRole('button', { name: '投 2 号' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '投 3 号' })).toBeNull();
    expect(screen.queryByRole('button', { name: '弃权' })).toBeNull();
  });
});

describe('AC-11 · 草稿同步真的接上', () => {
  it('在输入框里打字会调用 client.draft', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(
      view({ self: { seat: 1, role: 'seer', alive: true, personaId: null } }),
    );
    render(<App gameId="g" client={client} />);

    const box = await screen.findByLabelText('你的发言');
    await user.click(box);
    await user.paste('我怀疑 2 号。');

    await waitFor(() => expect(calls.drafts.at(-1)).toBe('我怀疑 2 号。'));
  });
});

describe('回归：SSE 不能在每次渲染时重建', () => {
  it('传入不同 client 实例重渲染，openStream 仍然只调用一次', async () => {
    const makeClient = () => {
      const state = { opens: 0, closes: 0 };
      const client = {
        game: async () => ({ version: 1, view: view() }),
        openStream: () => {
          state.opens += 1;
          return () => {
            state.closes += 1;
          };
        },
        draft: async () => undefined,
        submit: async () => ({ ok: true as const }),
        truth: async () => null,
        replay: async () => null,
      } as unknown as ApiClient;
      return { client, state };
    };

    const first = makeClient();
    const second = makeClient();
    const { rerender } = render(<App gameId="g" client={first.client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    rerender(<App gameId="g" client={second.client} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '你的身份' })).toBeTruthy());

    // 客户端实例被换掉也不能重开流：否则浏览器会不停重连（日志刷屏）
    expect(first.state.opens).toBe(1);
    expect(second.state.opens).toBe(0);
  });
});
