import { describe, expect, it } from 'vitest';

import { phaseTimer } from '@server/project/timer';

const NOW = 1_700_000_000_000;

function record(events: unknown[]) {
  return { events } as never;
}

function phaseChanged(to: string, ts: number) {
  return {
    type: 'PHASE_CHANGED',
    ts,
    payload: { from: 'X', to },
  };
}

describe('阶段倒计时（每个相位、跨天）', () => {
  it('第一夜从 GAME_STARTED 起算 50 秒', () => {
    const timer = phaseTimer(
      record([{ type: 'GAME_STARTED', ts: NOW - 5_000, payload: {} }]),
      'NIGHT_WOLF_CHAT',
      {},
      NOW,
    );
    expect(timer?.totalSeconds).toBe(50);
    expect(timer?.remainingSeconds).toBe(45);
  });

  it.each([
    ['NIGHT_WOLF_CHAT', 50],
    ['NIGHT_WOLVES', 10],
    ['NIGHT_WOLF_RUNOFF', 10],
    ['NIGHT_SEER', 60],
    ['NIGHT_WITCH', 60],
    ['NIGHT_HUNTER_SHOOT', 60],
    ['DAY_SPEECH', 60],
    ['DAY_PK_SPEECH', 60],
    ['DAY_VOTE', 60],
    ['DAY_VOTE_RUNOFF', 60],
    ['DAY_HUNTER_SHOOT', 60],
  ])('%s 有倒计时且上限为 %i 秒', (phase, total) => {
    const timer = phaseTimer(record([phaseChanged(phase, NOW - 3_000)]), phase, {}, NOW);
    expect(timer).not.toBeNull();
    expect(timer?.totalSeconds).toBe(total);
    expect(timer?.remainingSeconds).toBe(total - 3);
  });

  it.each(['NIGHT_RESOLVE', 'DAY_ANNOUNCE', 'DAY_LYNCH', 'FINISHED', 'LOBBY'])(
    '%s 是自动/终局相位，不显示倒计时',
    (phase) => {
      expect(phaseTimer(record([phaseChanged(phase, NOW)]), phase, {}, NOW)).toBeNull();
    },
  );

  it('同一天的第二夜用新的 PHASE_CHANGED 起点，不沿用第一夜', () => {
    const timer = phaseTimer(
      record([
        phaseChanged('NIGHT_WOLF_CHAT', NOW - 80_000),
        { type: 'DAY_STARTED', ts: NOW - 60_000, payload: {} },
        phaseChanged('DAY_SPEECH', NOW - 60_000),
        phaseChanged('DAY_VOTE', NOW - 40_000),
        phaseChanged('DAY_LYNCH', NOW - 30_000),
        phaseChanged('NIGHT_WOLF_CHAT', NOW - 5_000),
      ]),
      'NIGHT_WOLF_CHAT',
      {},
      NOW,
    );
    expect(timer?.remainingSeconds).toBe(45);
  });
});
