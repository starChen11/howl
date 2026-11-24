import { describe, expect, it } from 'vitest';

import { loadPhaseTimers } from '@server/config/phase-timers';
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
  it('第一夜从 GAME_STARTED 起算 100 秒', () => {
    const timer = phaseTimer(
      record([{ type: 'GAME_STARTED', ts: NOW - 5_000, payload: {} }]),
      'NIGHT_WOLF_CHAT',
      {},
      NOW,
    );
    expect(timer?.totalSeconds).toBe(100);
    expect(timer?.remainingSeconds).toBe(95);
  });

  it.each([
    ['NIGHT_WOLF_CHAT', 100],
    ['NIGHT_WOLVES', 20],
    ['NIGHT_WOLF_RUNOFF', 20],
    ['NIGHT_SEER', 120],
    ['NIGHT_WITCH', 120],
    ['NIGHT_HUNTER_SHOOT', 120],
    ['DAY_SPEECH', 120],
    ['DAY_PK_SPEECH', 120],
    ['DAY_VOTE', 120],
    ['DAY_VOTE_RUNOFF', 120],
    ['DAY_HUNTER_SHOOT', 120],
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

  it('同一天的第二夜用新的 PHASE_CHANGED 起点，不沿用第一夜（默认 100 秒）', () => {
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
    expect(timer?.remainingSeconds).toBe(95);
  });
});

describe('RFC-021 · 环境变量覆盖', () => {
  it('默认值全部是原来的两倍', () => {
    const timers = loadPhaseTimers({});
    expect(timers.wolfChatMs).toBe(100_000);
    expect(timers.wolfVoteMs).toBe(20_000);
    expect(timers.daySpeechMs).toBe(120_000);
    expect(timers.pkSpeechMs).toBe(120_000);
    expect(timers.dayVoteMs).toBe(120_000);
    expect(timers.dayVoteRunoffMs).toBe(120_000);
    expect(timers.seerMs).toBe(120_000);
    expect(timers.witchMs).toBe(120_000);
    expect(timers.hunterShootMs).toBe(120_000);
  });

  it('单个环境变量会同时改变倒计时上限', () => {
    const timer = phaseTimer(
      record([phaseChanged('DAY_SPEECH', NOW - 1_000)]),
      'DAY_SPEECH',
      { HOWL_DAY_SPEECH_MS: '30000' } as NodeJS.ProcessEnv,
      NOW,
    );
    expect(timer?.totalSeconds).toBe(30);
    expect(timer?.remainingSeconds).toBe(29);
  });

  it('非法值明确报错，不静默回退', () => {
    expect(() => loadPhaseTimers({ HOWL_DAY_VOTE_MS: 'abc' })).toThrow(/HOWL_DAY_VOTE_MS/);
    expect(() => loadPhaseTimers({ HOWL_DAY_VOTE_MS: '0' })).toThrow(/HOWL_DAY_VOTE_MS/);
  });
});
