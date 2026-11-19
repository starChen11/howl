import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPanel, buildPanelEntries } from '@client/components/EventPanel';
import { SpectatorBar } from '@client/components/SpectatorBar';
import { toggleTruth, initialTruthState } from '@client/state/truth-view';
import type { ProjectedContext } from '@shared/project';

/**
 * RFC-013 §5 AC-1 ~ AC-3 / AC-8 ~ AC-10：事件面板与真相开关。
 */

afterEach(cleanup);

function ctx(events: unknown[] = []): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: false, personaId: null },
    phase: 'DAY_SPEECH',
    day: 2,
    aliveSeats: [2, 3],
    deadSeats: [1],
    publicEvents: events as never,
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

const dayStarted = {
  gameId: 'g',
  seq: 1,
  ts: 0,
  type: 'DAY_STARTED',
  visibleTo: 'public',
  payload: { day: 2, diedLastNight: [1], speechStartSeat: 2 },
};
const died = {
  gameId: 'g',
  seq: 2,
  ts: 0,
  type: 'PLAYER_DIED',
  visibleTo: 'public',
  payload: { seat: 1, cause: 'wolf' },
};
const votes = {
  gameId: 'g',
  seq: 3,
  ts: 0,
  type: 'VOTE_REVEALED',
  visibleTo: 'public',
  payload: {
    votes: [
      { seat: 2, target: 3 },
      { seat: 3, target: 'abstain' },
    ],
  },
};
const speech = {
  gameId: 'g',
  seq: 4,
  ts: 0,
  type: 'SPEECH',
  visibleTo: 'public',
  payload: { seat: 2, text: '我觉得 3 号像' },
};

describe('AC-1 / AC-2 · 面板只有三类公开事件', () => {
  it('发言与角色不出现在面板里', () => {
    const entries = buildPanelEntries(ctx([dayStarted, died, votes, speech]));

    expect(entries.map((entry) => entry.kind)).toEqual(['death', 'vote']);
    expect(JSON.stringify(entries)).not.toContain('我觉得');
    expect(JSON.stringify(entries)).not.toContain('role');
  });
});

describe('AC-3 · 每条显示 seq 与第 N 天', () => {
  it('条目带 seq 与天数', () => {
    const entries = buildPanelEntries(ctx([dayStarted, died]));
    expect(entries[0]).toEqual({ seq: 2, day: 2, kind: 'death', text: '1 号出局' });
  });
});

describe('AC-4 · 点条目能定位到发言流', () => {
  it('点击回调带上对应 seq', async () => {
    const user = userEvent.setup();
    const jumped: number[] = [];
    render(
      <EventPanel
        entries={buildPanelEntries(ctx([dayStarted, died]))}
        onJump={(seq) => jumped.push(seq)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /1 号出局/ }));
    expect(jumped).toEqual([2]);
  });
});

describe('AC-8 / AC-10 · 真相开关默认关闭、可开可关', () => {
  it('默认 false；切换两次回到 false', () => {
    expect(initialTruthState.enabled).toBe(false);
    const on = toggleTruth(initialTruthState);
    expect(on.enabled).toBe(true);
    expect(toggleTruth(on).enabled).toBe(false);
  });

  it('观战条按钮的 aria-pressed 反映当前状态', () => {
    render(<SpectatorBar truthEnabled={false} onToggleTruth={() => undefined} />);
    expect(screen.getByRole('button', { name: '打开真相视图' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    cleanup();
    render(<SpectatorBar truthEnabled onToggleTruth={() => undefined} />);
    expect(screen.getByRole('button', { name: '关闭真相视图' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
