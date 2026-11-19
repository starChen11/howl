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
  const calls = { submits: 0, drafts: 0, truth: 0 };
  const client = {
    game: async () => ({ version: 5, view: ctx }),
    openStream: () => () => undefined,
    draft: async () => {
      calls.drafts += 1;
    },
    submit: async () => {
      calls.submits += 1;
      return { ok: true as const };
    },
    replay: async () => null,
    truth: async () => {
      calls.truth += 1;
      return {
        seats: [
          { seat: 1, role: 'villager', roleLabel: '村民', alive: false, actions: [] },
          { seat: 2, role: 'wolf', roleLabel: '狼人', alive: true, actions: ['袭击了 1 号'] },
        ],
        deaths: [{ seat: 1, day: 2, cause: 'wolf' }],
      };
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('AC-12 · 活着的玩家没有真相入口', () => {
  it('进行中不渲染观战条，也没有真相按钮', async () => {
    const { client } = fakeClient(
      view({ self: { seat: 1, role: 'villager', alive: true, personaId: null } }),
    );
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.queryByText(/你已出局/)).toBeNull();
    expect(screen.queryByRole('button', { name: /真相视图/ })).toBeNull();
  });
});

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
    // 关闭后内容必须真的消失，而不只是标题消失（评审 C-136）
    await user.click(screen.getByRole('button', { name: '关闭真相视图' }));
    await waitFor(() => expect(screen.queryByText(/2 号：狼人/)).toBeNull());
    expect(screen.queryByRole('heading', { name: '真相视图' })).toBeNull();

    // 开关是纯视图状态：没有任何写操作，视图快照也没变（AC-11）
    expect(calls.submits).toBe(0);
    expect(calls.drafts).toBe(0);
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

describe('AC-4 · 点面板条目真的定位到发言', () => {
  it('高亮对应 data-seq 的行并调用 scrollIntoView', async () => {
    const user = userEvent.setup();
    const scrolls: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolls.push(this.dataset['seq'] ?? '');
    };

    try {
      const ctx = view({
        self: { seat: 1, role: 'villager', alive: false, personaId: null },
        publicEvents: [
          {
            gameId: 'g',
            seq: 1,
            ts: 0,
            type: 'DAY_STARTED',
            visibleTo: 'public',
            payload: { day: 2, diedLastNight: [1], speechStartSeat: 2 },
          } as never,
          {
            gameId: 'g',
            seq: 2,
            ts: 0,
            type: 'SPEECH',
            visibleTo: 'public',
            payload: { seat: 2, text: '我觉得 3 号像' },
          } as never,
        ],
      });
      const { client } = fakeClient(ctx);
      render(<App gameId="g" client={client} />);

      await screen.findByRole('heading', { name: '你的身份' });
      await user.click(screen.getByRole('button', { name: /1 号出局/ }));

      await waitFor(() => expect(scrolls).toContain('2'));
      const line = document.querySelector('[data-seq="2"]');
      expect(line?.className).toContain('feed__line--highlight');
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('AC-5 / AC-7 · 观战仍能看发言与公开事件', () => {
  it('出局后发言流与事件面板都在', async () => {
    const ctx = view({
      publicEvents: [
        {
          gameId: 'g',
          seq: 1,
          ts: 0,
          type: 'DAY_STARTED',
          visibleTo: 'public',
          payload: { day: 2, diedLastNight: [1], speechStartSeat: 2 },
        } as never,
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'SPEECH',
          visibleTo: 'public',
          payload: { seat: 2, text: '后面这局我看完了' },
        } as never,
      ],
    });
    const { client } = fakeClient(ctx);
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.getByText('后面这局我看完了')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '公开事件' })).toBeTruthy();
  });
});

describe('AC-13 / AC-14 · 记事板内容不会随发言提交', () => {
  it('写了记事板再发言，提交的文本里不含记事板内容', async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    const ctx = view({
      self: { seat: 1, role: 'villager', alive: true, personaId: null },
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
    });
    const drafts: string[] = [];
    const client = {
      game: async () => ({ version: 3, view: ctx }),
      openStream: () => () => undefined,
      draft: async (_gameId: string, text: string) => {
        drafts.push(text);
      },
      submit: async (_gameId: string, body: { action: { text?: string } }) => {
        submitted.push(body.action.text ?? '');
        return { ok: true as const };
      },
      truth: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);
    const notepad = await screen.findByLabelText('记事板内容');
    await user.click(notepad);
    await user.paste('3 号可疑（私密）');

    const box = await screen.findByLabelText('你的发言');
    await user.click(box);
    await user.paste('我只说公开的话。');
    // 提交按钮（与 Enter 等价；这里用按钮更贴近真实操作）
    await user.click(screen.getByRole('button', { name: '发言' }));

    await waitFor(() => expect(submitted).toContain('我只说公开的话。'));
    for (const text of submitted) expect(text).not.toContain('3 号可疑');
    // 草稿同样不能把记事板带出去（C-140 的真实泄漏路径）
    expect(drafts.length).toBeGreaterThan(0);
    for (const text of drafts) expect(text).not.toContain('3 号可疑');
  });
});

describe('AC-7 · 对局结束后仍能看到完整信息', () => {
  it('FINISHED 时观战条、发言流与公开事件都在', async () => {
    const ctx = view({
      phase: 'FINISHED',
      publicEvents: [
        {
          gameId: 'g',
          seq: 1,
          ts: 0,
          type: 'DAY_STARTED',
          visibleTo: 'public',
          payload: { day: 2, diedLastNight: [1], speechStartSeat: 2 },
        } as never,
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'SPEECH',
          visibleTo: 'public',
          payload: { seat: 2, text: '这局打完了' },
        } as never,
      ],
    });
    const { client } = fakeClient(ctx);
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.getByText('这局打完了')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '公开事件' })).toBeTruthy();
    expect(screen.getByText(/你已出局，正在观战/)).toBeTruthy();
  });
});

describe('AC-9 · 真相区渲染动作与出局记录', () => {
  it('显示狼的动作与死因', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient(view());
    render(<App gameId="g" client={client} />);

    await screen.findByRole('heading', { name: '你的身份' });
    await user.click(screen.getByRole('button', { name: '打开真相视图' }));

    await waitFor(() => expect(screen.getByText(/袭击了 1 号/)).toBeTruthy());
    expect(screen.getByText(/第 2 天，wolf/)).toBeTruthy();
  });
});
