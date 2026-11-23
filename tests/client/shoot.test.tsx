import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
import { NightAction } from '@client/components/NightAction';
import { ShootInput } from '@client/components/ShootInput';
import type { ProjectedContext } from '@shared/project';

/**
 * 猎人出局后仍要能自己决定是否开枪。
 *
 * 这条路径曾经卡死：玩家是猎人、夜里被杀后，服务端的脚本 AI 不认识这个相位，
 * 对局停在那里，界面上也只剩「打开真相视图」。
 */

afterEach(cleanup);

describe('ShootInput', () => {
  it('列出目标并可选择不开枪', async () => {
    const user = userEvent.setup();
    const picked: (number | null)[] = [];
    render(<ShootInput targets={[2]} onShoot={(target) => picked.push(target)} />);

    await user.click(screen.getByRole('button', { name: '开枪带走 2 号' }));
    await user.click(screen.getByRole('button', { name: '不开枪' }));

    expect(picked).toEqual([2, null]);
  });
});

function hunterView(): ProjectedContext {
  return {
    self: { seat: 1, role: 'hunter', alive: false, personaId: null },
    phase: 'NIGHT',
    day: 1,
    aliveSeats: [2, 3],
    deadSeats: [1],
    publicEvents: [],
    privateEvents: [],
    knowledge: {
      teammates: [],
      checks: [],
      potions: { heal: 'used', poison: 'used' },
      canShoot: true,
      knownKillTarget: null,
    },
    legalTargets: [2, 3],
    pending: 'shoot',
  } as ProjectedContext;
}

describe('出局后的猎人界面', () => {
  it('pending=shoot 时出现开枪按钮，提交 HUNTER_SHOOT', async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    const client = {
      game: async () => ({ version: 7, view: hunterView() }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async (_gameId: string, body: unknown) => {
        submitted.push(body);
        return { ok: true as const };
      },
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByRole('button', { name: '开枪带走 3 号' });
    await user.click(screen.getByRole('button', { name: '开枪带走 3 号' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({
      action: { type: 'HUNTER_SHOOT', seat: 1, target: 3 },
    });
  });
});

describe('出局但仍待决定时，不提供真相视图入口', () => {
  it('pending=shoot 时不渲染「打开真相视图」', async () => {
    const client = {
      game: async () => ({ version: 7, view: hunterView() }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByRole('button', { name: '不开枪' });
    expect(screen.queryByRole('button', { name: /真相视图/ })).toBeNull();
  });
});

describe('夜间行动由玩家操作（回归：当狼却没参与刀人）', () => {
  it('狼的讨论与刀人界面都出现，刀人提交 WOLF_KILL', async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    const client = {
      game: async () => ({
        version: 3,
        view: {
          ...hunterView(),
          self: { seat: 1, role: 'wolf', alive: true, personaId: null },
          phase: 'NIGHT',
          aliveSeats: [1, 2, 3],
          deadSeats: [],
          pending: 'chat',
          legalTargets: [],
        },
      }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async (_gameId: string, body: unknown) => {
        submitted.push(body);
        return { ok: true as const };
      },
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    // 讨论阶段：发一条真实消息（空消息不再等于「跳过 = 准备」）
    await user.type(await screen.findByLabelText('狼队讨论'), '今晚刀 2 号');
    await user.click(screen.getByRole('button', { name: '说' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({
      action: { type: 'WOLF_CHAT', seat: 1, text: '今晚刀 2 号' },
    });
  });
});

describe('夜间刀人：不列队友（实际对局中点到过「刀 4 号」）', () => {
  it('队友席位不出现在刀人按钮里', async () => {
    const client = {
      game: async () => ({
        version: 3,
        view: {
          ...hunterView(),
          self: { seat: 1, role: 'wolf', alive: true, personaId: null },
          phase: 'NIGHT',
          aliveSeats: [1, 2, 3, 4],
          deadSeats: [],
          pending: 'kill',
          legalTargets: [2, 3, 4],
          knowledge: {
            teammates: [4],
            checks: [],
            potions: { heal: 'used', poison: 'used' },
            canShoot: false,
            knownKillTarget: null,
          },
        },
      }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByRole('button', { name: '刀 2 号' });
    expect(screen.queryByRole('button', { name: '刀 4 号' })).toBeNull();
  });
});

describe('狼队频道：队友说过的话要能看到', () => {
  it('讨论阶段显示狼队消息', async () => {
    const client = {
      game: async () => ({
        version: 3,
        view: {
          ...hunterView(),
          self: { seat: 1, role: 'wolf', alive: true, personaId: null },
          phase: 'NIGHT',
          aliveSeats: [1, 2, 3, 4],
          deadSeats: [],
          pending: 'chat',
          legalTargets: [],
          privateEvents: [
            {
              gameId: 'g',
              seq: 2,
              ts: 0,
              type: 'WOLF_CHAT_POSTED',
              visibleTo: 'wolves',
              payload: { seat: 4, text: '今晚刀 3 号' },
            },
          ],
        },
      }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByText(/4 号：今晚刀 3 号/);
  });
});

describe('RUL-13 · 狼队投票界面', () => {
  function wolfVoteView(partial: Record<string, unknown> = {}) {
    return {
      ...hunterView(),
      self: { seat: 1, role: 'wolf', alive: true, personaId: null },
      phase: 'NIGHT',
      aliveSeats: [1, 2, 3, 4],
      deadSeats: [],
      pending: 'wolf-vote',
      legalTargets: [2, 3],
      wolfVoteOpen: true,
      wolfCandidates: [2, 3],
      privateEvents: [
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'WOLF_VOTE_CAST',
          visibleTo: 'wolves',
          payload: { seat: 4, target: 2 },
        },
      ],
      ...partial,
    };
  }

  function clientFor(view: unknown) {
    return {
      game: async () => ({ version: 3, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;
  }

  it('显示实时票型与候选，没有弃权', async () => {
    render(<App gameId="g" client={clientFor(wolfVoteView())} />);

    await screen.findByText(/4 号投 2 号/);
    expect(screen.getByRole('button', { name: '投 2 号' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '投 3 号' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '弃权' })).toBeNull();
  });

  it('自己投完后保留面板并显示「等待队友」，按钮不可点', async () => {
    render(
      <App
        gameId="g"
        client={clientFor(
          wolfVoteView({
            pending: null,
            legalTargets: [],
            privateEvents: [
              {
                gameId: 'g',
                seq: 2,
                ts: 0,
                type: 'WOLF_VOTE_CAST',
                visibleTo: 'wolves',
                payload: { seat: 1, target: 2 },
              },
            ],
          }),
        )}
      />,
    );

    await screen.findByText(/你已投票，等待队友/);
    expect((screen.getByRole('button', { name: '投 2 号' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('RUL-13 · 还没轮到自己投票时不能显示「已投票」', () => {
  it('后置狼等待时文案是「等队友先投」', async () => {
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'wolf', alive: true, personaId: null },
      phase: 'NIGHT',
      pending: null,
      legalTargets: [],
      wolfVoteOpen: true,
      wolfCandidates: [2, 3],
      privateEvents: [
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'WOLF_VOTE_CAST',
          visibleTo: 'wolves',
          payload: { seat: 4, target: 2 },
        },
      ],
    };
    const client = {
      game: async () => ({ version: 3, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByText(/等队友先投/);
    expect(screen.queryByText(/你已投票/)).toBeNull();
    // 待投票的狼能看到已投的票与票数
    await screen.findByText(/4 号投 2 号/);
    expect(document.body.textContent).toMatch(/已投 1\/\d+/);
  });
});

describe('RUL-13 · 票型只显示当前一轮', () => {
  it('唱票（REVEALED）之后旧票不再显示', async () => {
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'wolf', alive: true, personaId: null },
      phase: 'NIGHT',
      pending: 'wolf-vote',
      legalTargets: [2, 3],
      wolfVoteOpen: true,
      wolfCandidates: [2, 3],
      privateEvents: [
        {
          gameId: 'g',
          seq: 1,
          ts: 0,
          type: 'WOLF_VOTE_CAST',
          visibleTo: 'wolves',
          payload: { seat: 1, target: 5 },
        },
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'WOLF_VOTE_REVEALED',
          visibleTo: 'wolves',
          payload: { votes: [], tied: [2, 3] },
        },
        {
          gameId: 'g',
          seq: 3,
          ts: 0,
          type: 'WOLF_VOTE_CAST',
          visibleTo: 'wolves',
          payload: { seat: 4, target: 2 },
        },
      ],
    };
    const client = {
      game: async () => ({ version: 4, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByText(/4 号投 2 号/);
    expect(screen.queryByText(/1 号投 5 号/)).toBeNull();
  });
});

describe('狼人自曝入口', () => {
  it('存活狼在白天看到自曝，确认后提交 SELF_EXPOSE', async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'wolf', alive: true, personaId: null },
      phase: 'DAY_SPEECH',
      aliveSeats: [1, 2, 3],
      deadSeats: [],
      pending: null,
      legalTargets: [],
    };
    const client = {
      game: async () => ({ version: 5, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async (_gameId: string, body: unknown) => {
        submitted.push(body);
        return { ok: true as const };
      },
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await user.click(await screen.findByRole('button', { name: /自曝身份/ }));
    await user.click(screen.getByRole('button', { name: '确认自曝' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ action: { type: 'SELF_EXPOSE', seat: 1 } });
  });

  it('非狼看不到自曝按钮', async () => {
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'villager', alive: true, personaId: null },
      phase: 'DAY_SPEECH',
      aliveSeats: [1, 2, 3],
      deadSeats: [],
      pending: null,
      legalTargets: [],
    };
    const client = {
      game: async () => ({ version: 5, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);
    await screen.findByRole('heading', { name: '你的身份' });
    expect(screen.queryByRole('button', { name: /自曝身份/ })).toBeNull();
  });
});

describe('RUL-14 · 狼队讨论聊天室', () => {
  it('30 秒前「准备完成」不可点；0 秒门槛时可点', () => {
    const { unmount } = render(
      <NightAction
        pending="chat"
        targets={[]}
        potions={{ heal: 'available', poison: 'available' }}
        killTarget={null}
        wolfChats={[{ seat: 4, text: '今晚刀 2 号' }]}
        wolfVotes={[]}
        readyAfterSeconds={30}
        readySeats={[4]}
        wolfCount={3}
        onChat={() => undefined}
        onTarget={() => undefined}
        onWitch={() => undefined}
        onReady={() => undefined}
      />,
    );
    expect((screen.getByRole('button', { name: /准备完成/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/已准备 1\/3 人/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '跳过' })).toBeNull();
    unmount();

    render(
      <NightAction
        pending="chat"
        targets={[]}
        potions={{ heal: 'available', poison: 'available' }}
        killTarget={null}
        wolfChats={[]}
        wolfVotes={[]}
        readyAfterSeconds={0}
        readySeats={[]}
        wolfCount={3}
        onChat={() => undefined}
        onTarget={() => undefined}
        onWitch={() => undefined}
        onReady={() => undefined}
      />,
    );
    expect((screen.getByRole('button', { name: '准备完成' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('聊天室可以连续发送多条消息', async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    render(
      <NightAction
        pending="chat"
        targets={[]}
        potions={{ heal: 'available', poison: 'available' }}
        killTarget={null}
        wolfChats={[]}
        wolfVotes={[]}
        readyAfterSeconds={30}
        readySeats={[]}
        wolfCount={3}
        onChat={(text) => sent.push(text)}
        onTarget={() => undefined}
        onWitch={() => undefined}
        onReady={() => undefined}
      />,
    );

    await user.type(screen.getByLabelText('狼队讨论'), '先刀 2 号');
    await user.click(screen.getByRole('button', { name: '说' }));
    await user.clear(screen.getByLabelText('狼队讨论'));
    await user.type(screen.getByLabelText('狼队讨论'), '再刀 5 号');
    await user.click(screen.getByRole('button', { name: '说' }));

    expect(sent).toEqual(['先刀 2 号', '再刀 5 号']);
  });
});

describe('RUL-14 · 聊天室不把空消息当准备', () => {
  it('空提交不会触发 onChat（服务端不再把空串当 skip）', async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    render(
      <NightAction
        pending="chat"
        targets={[]}
        potions={{ heal: 'available', poison: 'available' }}
        killTarget={null}
        wolfChats={[]}
        wolfVotes={[]}
        readyAfterSeconds={0}
        readySeats={[]}
        wolfCount={2}
        onChat={(text) => sent.push(text)}
        onTarget={() => undefined}
        onWitch={() => undefined}
        onReady={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: '说' }));
    expect(sent).toEqual([]);
  });
});

describe('RUL-14 · 聊天室只显示本夜数据', () => {
  it('上一夜的聊天与准备状态不会带到下一夜', async () => {
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'wolf', alive: true, personaId: null },
      phase: 'NIGHT',
      pending: 'chat',
      legalTargets: [],
      knowledge: {
        teammates: [4],
        checks: [],
        potions: { heal: 'used', poison: 'used' },
        canShoot: false,
        knownKillTarget: null,
      },
      privateEvents: [
        {
          gameId: 'g',
          seq: 1,
          ts: 0,
          type: 'WOLF_CHAT_POSTED',
          visibleTo: 'wolves',
          payload: { seat: 4, text: '上一夜的旧消息', round: 'night-chat' },
        },
        {
          gameId: 'g',
          seq: 2,
          ts: 0,
          type: 'WOLF_READY_MARKED',
          visibleTo: 'wolves',
          payload: { seat: 1 },
        },
        {
          gameId: 'g',
          seq: 3,
          ts: 0,
          type: 'WOLF_KILL_CHOSEN',
          visibleTo: 'wolves',
          payload: { target: 2 },
        },
        {
          gameId: 'g',
          seq: 4,
          ts: 0,
          type: 'WOLF_CHAT_POSTED',
          visibleTo: 'wolves',
          payload: { seat: 4, text: '这一夜的新消息', round: 'night-chat' },
        },
      ],
    };
    const client = {
      game: async () => ({ version: 5, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByText(/这一夜的新消息/);
    expect(screen.queryByText(/上一夜的旧消息/)).toBeNull();
    expect(document.body.textContent).toContain('已准备 0/');
  });
});

describe('白天投票不显示已出局席位', () => {
  it('即使 legalTargets 里混进了死者，客户端也会按 aliveSeats 过滤', async () => {
    const view = {
      ...hunterView(),
      self: { seat: 1, role: 'villager', alive: true, personaId: null },
      phase: 'DAY_VOTE',
      aliveSeats: [1, 3, 4],
      deadSeats: [2],
      pending: 'vote',
      legalTargets: [2, 3, 4, 'abstain'],
    };
    const client = {
      game: async () => ({ version: 3, view }),
      openStream: () => () => undefined,
      draft: async () => undefined,
      submit: async () => ({ ok: true as const }),
      truth: async () => null,
      replay: async () => null,
    } as unknown as ApiClient;

    render(<App gameId="g" client={client} />);

    await screen.findByRole('button', { name: '投 3 号' });
    expect(screen.queryByRole('button', { name: '投 2 号' })).toBeNull();
    expect(screen.getByRole('button', { name: '弃权' })).toBeTruthy();
  });
});
