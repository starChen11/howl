import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '@client/App';
import type { ApiClient } from '@client/api';
import { latestKeyResult } from '@client/key-result';
import type { ProjectedContext } from '@shared/project';

const DAY_STARTED = {
  gameId: 'g',
  seq: 10,
  ts: 0,
  type: 'DAY_STARTED',
  visibleTo: 'public',
  payload: { day: 2, diedLastNight: [2], speechStartSeat: 3 },
} as never;

const BANISHED = {
  gameId: 'g',
  seq: 20,
  ts: 0,
  type: 'PLAYER_DIED',
  visibleTo: 'public',
  payload: { seat: 4, cause: 'vote' },
} as never;

const GAME_OVER = {
  gameId: 'g',
  seq: 30,
  ts: 0,
  type: 'GAME_ENDED',
  visibleTo: 'public',
  payload: { result: 'good', condition: 'all-wolves-dead' },
} as never;

function view(events: ProjectedContext['publicEvents']): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: true, personaId: null },
    phase: 'DAY_SPEECH',
    day: 2,
    aliveSeats: [1, 3, 4],
    deadSeats: [2],
    publicEvents: events,
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
  } as ProjectedContext;
}

function clientFor(ctx: ProjectedContext): ApiClient {
  return {
    game: async () => ({ version: 3, view: ctx }),
    openStream: () => () => undefined,
    draft: async () => undefined,
    submit: async () => ({ ok: true as const }),
    truth: async () => null,
    replay: async () => null,
  } as unknown as ApiClient;
}

afterEach(cleanup);

describe('关键结果弹窗', () => {
  it('天亮公布死者时弹出「天亮了」', async () => {
    render(<App gameId="g" client={clientFor(view([DAY_STARTED]))} />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('天亮了')).toBeTruthy();
    expect(screen.getByText('昨晚 2 号出局。')).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('放逐出局与终局都能识别', () => {
    expect(latestKeyResult([BANISHED])?.body).toBe('4 号被放逐。');
    expect(latestKeyResult([GAME_OVER])?.title).toBe('对局结束');
    expect(latestKeyResult([GAME_OVER])?.body).toContain('好人阵营胜利');
  });

  it('入夜时弹出「第 N 夜」提示', () => {
    const night = {
      gameId: 'g',
      seq: 5,
      ts: 0,
      type: 'PHASE_CHANGED',
      visibleTo: 'public',
      payload: { from: 'DAY_LYNCH', to: 'NIGHT_WOLF_CHAT' },
    } as never;
    expect(latestKeyResult([night], 2)?.title).toBe('第 2 夜');
    expect(latestKeyResult([night], 2)?.body).toContain('天黑请闭眼');
  });

  it('没有关键事件时不弹窗', () => {
    expect(latestKeyResult([])).toBeNull();
  });
});
