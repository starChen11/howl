import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
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

    const { rerender } = render(<App gameId="g" client={client} />);

    // 讨论阶段：可以直接跳过
    await screen.findByRole('button', { name: '跳过' });
    await user.click(screen.getByRole('button', { name: '跳过' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ action: { type: 'WOLF_CHAT', seat: 1 } });
    rerender(<App gameId="g" client={client} />);
  });
});
