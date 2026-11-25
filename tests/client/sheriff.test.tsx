import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
import { EventPanel, buildPanelEntries } from '@client/components/EventPanel';
import { StatusBar } from '@client/components/StatusBar';
import { BadgeTransferPanel, SheriffOrderPicker } from '@client/components/SheriffPanel';
import type { EventEnvelope } from '@shared/events';
import type { ProjectedContext, SheriffElectionView } from '@shared/project';

/**
 * RFC-022 §7 / §8：警长竞选的界面。
 *
 * 这些测试从 `App` 进入，而不是只测面板：面板挂没挂上去、动作有没有接对座位与
 * `expectedVersion`，只有整页测试才看得到。
 */

afterEach(cleanup);

const ALL_SEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function election(partial: Partial<SheriffElectionView> = {}): SheriffElectionView {
  return {
    phase: 'signup',
    candidates: [],
    voters: [],
    withdrawn: [],
    signups: [],
    runoff: [],
    isCandidate: false,
    isVoter: false,
    ...partial,
  };
}

function view(partial: Partial<ProjectedContext> = {}): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: true, personaId: null },
    phase: 'DAY_SHERIFF_SIGNUP',
    day: 1,
    aliveSeats: [...ALL_SEATS],
    deadSeats: [],
    publicEvents: [],
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
    sheriffSeat: null,
    badge: 'none',
    sheriff: election(),
    ...partial,
  };
}

function ev(seq: number, type: string, payload: unknown): EventEnvelope {
  return { gameId: 'g', seq, ts: 0, type, visibleTo: 'public', payload } as never;
}

function fakeClient(ctx: ProjectedContext) {
  const submitted: { action: Record<string, unknown> }[] = [];
  const client = {
    game: async () => ({ version: 7, view: ctx, timer: null }),
    openStream: () => () => undefined,
    draft: async () => undefined,
    submit: async (_gameId: string, body: { action: Record<string, unknown> }) => {
      submitted.push(body);
      return { ok: true as const };
    },
    truth: async () => null,
    replay: async () => null,
  } as unknown as ApiClient;
  return { client, submitted };
}

async function renderApp(ctx: ProjectedContext) {
  const { client, submitted } = fakeClient(ctx);
  render(<App gameId="g" client={client} />);
  // 身份卡出现说明第一次投影已经渲染完。
  await screen.findByRole('heading', { name: '你的身份' });
  return { submitted };
}

describe('RFC-022 AC-2 · 上警 / 不上警', () => {
  it('点「上警」提交 SHERIFF_SIGNUP { run: true }', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(view());

    await user.click(await screen.findByRole('button', { name: '上警' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({
      type: 'SHERIFF_SIGNUP',
      seat: 1,
      run: true,
    });
  });

  it('点「不上警」提交 run: false', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(view());

    await user.click(await screen.findByRole('button', { name: '不上警' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({ type: 'SHERIFF_SIGNUP', run: false });
  });

  it('已经表过态时显示状态而不是按钮', async () => {
    await renderApp(
      view({
        sheriff: election({ signups: [{ seat: 1, run: true }] }),
      }),
    );

    expect(screen.getByText(/你选择了上警，等待其他人表态/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '上警' })).toBeNull();
  });
});

describe('RFC-022 AC-3 · 退水', () => {
  const withdrawView = (partial: Partial<ProjectedContext> = {}) =>
    view({
      phase: 'DAY_SHERIFF_WITHDRAW',
      sheriff: election({
        phase: 'withdraw',
        candidates: [1, 2],
        voters: [3, 4, 5, 6, 7, 8, 9],
        signups: [
          { seat: 1, run: true },
          { seat: 2, run: true },
          { seat: 3, run: false },
        ],
        isCandidate: true,
      }),
      ...partial,
    });

  it('候选人可以点「退水」，提交 SHERIFF_WITHDRAW { withdraw: true }', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(withdrawView());

    await user.click(await screen.findByRole('button', { name: '退水' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({ type: 'SHERIFF_WITHDRAW', withdraw: true });
  });

  it('也可以点「不退水」，提交 withdraw: false', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(withdrawView());

    await user.click(await screen.findByRole('button', { name: '不退水' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({ type: 'SHERIFF_WITHDRAW', withdraw: false });
  });

  it('已经表过态时显示状态而不是按钮', async () => {
    await renderApp(
      withdrawView({
        publicEvents: [ev(1, 'SHERIFF_WITHDRAWN', { seat: 1, withdraw: true })],
        sheriff: election({
          phase: 'withdraw',
          candidates: [1, 2],
          voters: [3, 4, 5, 6, 7, 8, 9],
          withdrawn: [1],
          isCandidate: true,
        }),
      }),
    );

    expect(screen.getByText(/你选择了退水，等待其他人表态/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '退水' })).toBeNull();
  });
});

describe('RFC-022 AC-3 / AC-4 · 警下投票与重投', () => {
  it('候选人不可投、可弃权；只显示仍在警上的候选人', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(
      view({
        self: { seat: 3, role: 'villager', alive: true, personaId: null },
        phase: 'DAY_SHERIFF_VOTE',
        sheriff: election({
          phase: 'vote',
          candidates: [1, 2],
          withdrawn: [2],
          voters: [3, 4, 5, 6, 7, 8, 9],
          isVoter: true,
        }),
        legalTargets: [1, 'abstain'],
        pending: 'sheriff-vote',
      }),
    );

    expect(await screen.findByRole('heading', { name: '警下投票' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '投 1 号' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '投 2 号' })).toBeNull();
    expect(screen.getByRole('button', { name: '弃权' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '投 1 号' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({
      type: 'SHERIFF_VOTE',
      seat: 3,
      target: 1,
    });
  });

  it('候选人自己不出现投票面板', async () => {
    await renderApp(
      view({
        phase: 'DAY_SHERIFF_VOTE',
        sheriff: election({
          phase: 'vote',
          candidates: [1, 2],
          voters: [3, 4, 5, 6, 7, 8, 9],
          isCandidate: true,
        }),
        pending: 'sheriff-vote',
      }),
    );

    expect(screen.queryByRole('heading', { name: '警下投票' })).toBeNull();
  });

  it('重投只列并列者，且没有弃权', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(
      view({
        self: { seat: 4, role: 'villager', alive: true, personaId: null },
        phase: 'DAY_SHERIFF_RUNOFF',
        sheriff: election({
          phase: 'runoff',
          candidates: [1, 2, 3],
          runoff: [1, 3],
          voters: [4, 5, 6, 7, 8, 9],
          isVoter: true,
        }),
        legalTargets: [1, 3],
        pending: 'sheriff-runoff',
      }),
    );

    expect(await screen.findByRole('heading', { name: '警长重投' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '投 1 号' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '投 3 号' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '投 2 号' })).toBeNull();
    expect(screen.queryByRole('button', { name: '弃权' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '投 3 号' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({ type: 'SHERIFF_VOTE', target: 3 });
  });
});

describe('RFC-022 AC-4 · PK 发言', () => {
  it('平票者按座位顺序拿到 PK 发言输入框', async () => {
    await renderApp(
      view({
        self: { seat: 2, role: 'villager', alive: true, personaId: null },
        phase: 'DAY_SHERIFF_PK',
        sheriff: election({
          phase: 'pk',
          candidates: [1, 2, 5],
          voters: [3, 4, 6, 7, 8, 9],
          runoff: [2, 5],
          isCandidate: true,
        }),
        publicEvents: [
          ev(1, 'SHERIFF_CANDIDATES', { candidates: [1, 2, 5] }),
          ev(2, 'SHERIFF_VOTE_REVEALED', {
            votes: [],
            round: 'initial',
            tied: [2, 5],
          }),
        ],
        pending: 'sheriff-pk',
      }),
    );

    expect(await screen.findByLabelText('PK 发言')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '警下投票' })).toBeNull();
  });
});

describe('RFC-022 AC-7 · 警长定序', () => {
  it('采用服务端给出的起点/方向选项并提交 SHERIFF_ORDER', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(
      view({
        self: { seat: 3, role: 'villager', alive: true, personaId: null },
        phase: 'DAY_SHERIFF_ORDER',
        day: 1,
        aliveSeats: [1, 2, 3, 4, 6, 7, 8, 9],
        deadSeats: [5],
        sheriffSeat: 3,
        badge: 'held',
        sheriff: election({ phase: null }),
        sheriffOrderOptions: [
          { startSeat: 6, direction: 'clockwise' },
          { startSeat: 4, direction: 'counterclockwise' },
        ],
        publicEvents: [ev(1, 'DAY_STARTED', { day: 1, diedLastNight: [5], speechStartSeat: 6 })],
        pending: 'sheriff-order',
      }),
    );

    await user.click(await screen.findByRole('button', { name: '从 6 号开始（顺时针）' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({
      type: 'SHERIFF_ORDER',
      seat: 3,
      startSeat: 6,
      direction: 'clockwise',
    });
  });

  it('只有警长本人看到定序面板', async () => {
    await renderApp(
      view({
        phase: 'DAY_SHERIFF_ORDER',
        sheriffSeat: 5,
        badge: 'held',
        sheriff: election({ phase: null }),
        sheriffOrderOptions: [{ startSeat: 6, direction: 'clockwise' }],
        pending: null,
      }),
    );

    expect(screen.queryByRole('heading', { name: '决定发言顺序' })).toBeNull();
  });

  it('组件按选项渲染起点与方向', () => {
    render(
      <SheriffOrderPicker
        options={[
          { startSeat: 6, direction: 'clockwise' },
          { startSeat: 4, direction: 'counterclockwise' },
        ]}
        onChoose={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '从 6 号开始（顺时针）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '从 4 号开始（逆时针）' })).toBeTruthy();
  });
});

describe('RFC-022 AC-9 / AC-11 · 警徽移交与撕徽', () => {
  const transferView = () =>
    view({
      self: { seat: 1, role: 'villager', alive: false, personaId: null },
      phase: 'DAY_BADGE_TRANSFER',
      day: 2,
      aliveSeats: [2, 3, 4],
      deadSeats: [1],
      sheriffSeat: 1,
      badge: 'held',
      sheriff: election({ phase: null }),
      legalTargets: [2, 3, 4],
      pending: 'badge-transfer',
    });

  it('死亡警长可以移交给存活玩家', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(transferView());

    await user.click(await screen.findByRole('button', { name: '移交给 2 号' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({
      type: 'BADGE_TRANSFER',
      seat: 1,
      target: 2,
    });
  });

  it('也可以撕掉警徽', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(transferView());

    await user.click(await screen.findByRole('button', { name: '撕掉警徽' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({ type: 'BADGE_TRANSFER', target: 'tear' });
  });

  it('不是本人死亡时不出现移交面板；观战条也不抢走这个决定', async () => {
    await renderApp(
      view({
        phase: 'DAY_BADGE_TRANSFER',
        day: 2,
        aliveSeats: [1, 3, 4],
        deadSeats: [2],
        sheriffSeat: 2,
        badge: 'held',
        sheriff: election({ phase: null }),
        pending: null,
      }),
    );

    expect(screen.queryByRole('heading', { name: '移交警徽' })).toBeNull();
  });

  it('组件列出存活目标与撕徽', () => {
    const picked: (number | 'tear')[] = [];
    render(<BadgeTransferPanel targets={[2, 3]} onTransfer={(target) => picked.push(target)} />);

    expect(screen.getByRole('button', { name: '移交给 2 号' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '移交给 3 号' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '撕掉警徽' })).toBeTruthy();
  });
});

describe('RFC-022 AC-2 / §7 · 竞选与归票发言复用输入框', () => {
  it('轮到警上候选人时显示「竞选发言」', async () => {
    await renderApp(
      view({
        phase: 'DAY_SHERIFF_SPEECH',
        sheriff: election({
          phase: 'speech',
          candidates: [1, 2],
          voters: [3, 4, 5, 6, 7, 8, 9],
          isCandidate: true,
        }),
        publicEvents: [ev(1, 'SHERIFF_CANDIDATES', { candidates: [1, 2] })],
        pending: 'sheriff-speech',
      }),
    );

    expect(await screen.findByLabelText('竞选发言')).toBeTruthy();
  });

  it('轮到警长时显示「警长归票发言」，提交普通 SPEECH', async () => {
    const user = userEvent.setup();
    const { submitted } = await renderApp(
      view({
        self: { seat: 3, role: 'seer', alive: true, personaId: null },
        phase: 'DAY_SHERIFF_FINAL_SPEECH',
        sheriffSeat: 3,
        badge: 'held',
        sheriff: election({ phase: null }),
        pending: 'sheriff-final-speech',
      }),
    );

    const box = await screen.findByLabelText('警长归票发言');
    await user.click(box);
    await user.paste('最后归票：出 2 号。');
    await user.click(screen.getByRole('button', { name: '归票发言' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.action).toMatchObject({
      type: 'SPEECH',
      seat: 3,
      text: '最后归票：出 2 号。',
    });
  });
});

describe('RFC-022 §13.1 · 首夜竞选期间不显示死亡与真相入口', () => {
  it('投影提前泄漏死亡时仍显示 9 人，且没有「已出局」/真相按钮', async () => {
    await renderApp(
      view({
        self: { seat: 5, role: 'seer', alive: false, personaId: null },
        phase: 'DAY_SHERIFF_SIGNUP',
        day: 1,
        aliveSeats: [1, 2, 3, 4, 6, 7, 8, 9],
        deadSeats: [5],
        // 模拟服务端投影错误地提前公布死讯。
        publicEvents: [ev(1, 'DAY_STARTED', { day: 1, diedLastNight: [5], speechStartSeat: 6 })],
      }),
    );

    expect(await screen.findByRole('button', { name: '上警' })).toBeTruthy();
    expect(screen.queryByText('已出局')).toBeNull();
    expect(screen.queryByText(/5 号出局/)).toBeNull();
    expect(screen.queryByRole('button', { name: /真相视图/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: '真相视图' })).toBeNull();
    expect(screen.getByText('9 人')).toBeTruthy();
  });
});

describe('RFC-022 §7 · 警长与 1.5 票的可见文案', () => {
  it('状态条显示警长与 1.5 票，也覆盖新阶段名与倒计时', () => {
    render(
      <StatusBar
        day={1}
        phase="DAY_SHERIFF_SIGNUP"
        aliveCount={9}
        remaining={120}
        speakingSeat={null}
        sheriffSeat={3}
        badge="held"
      />,
    );

    expect(screen.getByText('上警')).toBeTruthy();
    expect(screen.getByText('3 号（1.5 票）')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toContain('120');
  });

  it('没有警长 / 撕徽时也有文字', () => {
    const { rerender } = render(
      <StatusBar
        day={2}
        phase="DAY_SPEECH"
        aliveCount={5}
        remaining={null}
        speakingSeat={1}
        sheriffSeat={null}
        badge="none"
      />,
    );
    expect(screen.getByText('本局无警长')).toBeTruthy();

    rerender(
      <StatusBar
        day={2}
        phase="DAY_SPEECH"
        aliveCount={5}
        remaining={null}
        speakingSeat={1}
        sheriffSeat={null}
        badge="destroyed"
      />,
    );
    expect(screen.getByText('警徽已撕')).toBeTruthy();
  });

  it('票型同时显示原始票与折算票（含警长 1.5）', () => {
    const entries = buildPanelEntries(
      view({
        phase: 'DAY_VOTE',
        publicEvents: [
          ev(2, 'VOTE_REVEALED', {
            votes: [
              { seat: 3, target: 4 },
              { seat: 5, target: 4 },
              { seat: 1, target: 5 },
            ],
            countedVotes: [
              { seat: 3, target: 4, halfVotes: 2 },
              { seat: 5, target: 4, halfVotes: 2 },
              { seat: 1, target: 5, halfVotes: 3 },
            ],
            sheriffSeat: 1,
          }),
        ],
      }),
    );

    const text = entries.find((entry) => entry.kind === 'vote')?.text ?? '';
    expect(text).toContain('1 号投 5 号（1.5 票）');
    expect(text).toContain('4 号 2 票（原始 2 票）');
    expect(text).toContain('5 号 1.5 票（原始 1 票）');

    render(<EventPanel entries={entries} />);
    expect(screen.getByText(/1 号投 5 号（1.5 票）/)).toBeTruthy();
  });
});
