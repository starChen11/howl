import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';
import { PHASES } from '@shared/domain';

import { UnhandledTransitionError } from '@engine/errors';
import { createEngine, DEFAULT_HANDLERS } from '@engine/step';
import type { TransitionTable } from '@engine/transitions';
import { DEFAULT_TRANSITIONS } from '@engine/transitions';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-9：`transitions` 表里每个 `(phase, action)` 允许对都必须有 handler。
 *
 * 这条 AC 是「声明与实现不许脱节」的守门人：RFC-003/004 往表里加一个允许对、却忘了写
 * handler 时，测试会立刻红，而不是等某个玩家撞上一个静默卡死的阶段。
 */

const DECLARED_PAIRS: readonly (readonly [string, Action['type']])[] = Object.entries(
  DEFAULT_TRANSITIONS,
).flatMap(([phase, actions]) => actions.map((action) => [phase, action] as const));

describe('AC-9 · 声明与实现一致', () => {
  it('表覆盖全部 26 个 phase（漏一个阶段会变成运行时 undefined）', () => {
    for (const phase of PHASES) {
      expect(DEFAULT_TRANSITIONS[phase], `缺少阶段 ${phase}`).toBeDefined();
    }
    expect(Object.keys(DEFAULT_TRANSITIONS)).toHaveLength(PHASES.length);
  });

  it('声明随 RFC 推进而扩张：RFC-003 之后夜晚阶段、RFC-022 之后竞选阶段已登记', () => {
    // RFC-002 §6 原文：「其余阶段由后续 RFC 追加到同一张表，测试自动覆盖」。
    const declared = Object.entries(DEFAULT_TRANSITIONS)
      .filter(([, actions]) => actions.length > 0)
      .map(([phase]) => phase);

    expect(declared).toEqual([
      'LOBBY',
      'NIGHT_WOLF_CHAT',
      'NIGHT_WOLVES',
      'NIGHT_WOLF_RUNOFF',
      'NIGHT_SEER',
      'NIGHT_WITCH',
      'NIGHT_HUNTER_SHOOT',
      'DAY_SHERIFF_SIGNUP',
      'DAY_SHERIFF_SPEECH',
      'DAY_SHERIFF_WITHDRAW',
      'DAY_SHERIFF_VOTE',
      'DAY_SHERIFF_PK',
      'DAY_SHERIFF_RUNOFF',
      'DAY_BADGE_TRANSFER',
      'DAY_SHERIFF_ORDER',
      'DAY_SPEECH',
      'DAY_SHERIFF_FINAL_SPEECH',
      'DAY_VOTE',
      'DAY_PK_SPEECH',
      'DAY_VOTE_RUNOFF',
      'DAY_HUNTER_SHOOT',
    ]);
    expect(DEFAULT_TRANSITIONS.LOBBY).toEqual(['START']);
    expect(DEFAULT_TRANSITIONS.FINISHED).toEqual([]);
    // 无 action 的阶段：夜聊（RFC-005）与自动结算、以及白天（RFC-004）
    expect(DEFAULT_TRANSITIONS.NIGHT_WOLF_CHAT).toEqual(['WOLF_CHAT', 'WOLF_READY']);
    expect(DEFAULT_TRANSITIONS.NIGHT_RESOLVE).toEqual([]);
    // 自动阶段没有允许的 action：天亮、放逐、竞选结果都由 step 的自动循环推进
    expect(DEFAULT_TRANSITIONS.DAY_ANNOUNCE).toEqual([]);
    expect(DEFAULT_TRANSITIONS.DAY_LYNCH).toEqual([]);
    expect(DEFAULT_TRANSITIONS.DAY_SHERIFF_RESULT).toEqual([]);
  });

  it('表里每个允许对都有 handler', () => {
    expect(DECLARED_PAIRS.length).toBeGreaterThan(0);

    for (const [phase, actionType] of DECLARED_PAIRS) {
      expect(
        DEFAULT_HANDLERS[actionType],
        `${phase} 允许 ${actionType} 但没有 handler`,
      ).toBeDefined();
    }
  });

  it('声明了允许对却没有 handler 时抛 UnhandledTransitionError', () => {
    const engine = createEngine({
      transitions: DEFAULT_TRANSITIONS,
      // 故意不提供任何 handler
      handlers: {},
      appliers: {},
    });

    const lobby = lobbyState();

    expect(() => engine.step(lobby, startActionOf(lobby))).toThrow(UnhandledTransitionError);
  });

  it('表缺阶段时构造引擎就抛错（宁可在启动时炸，也不要运行时 undefined）', () => {
    const incomplete: Record<string, readonly Action['type'][]> = { ...DEFAULT_TRANSITIONS };
    delete incomplete.NIGHT_SEER;

    expect(() =>
      createEngine({
        transitions: incomplete as unknown as TransitionTable,
        handlers: DEFAULT_HANDLERS,
        appliers: {},
      }),
    ).toThrow(/transitions 表缺少阶段 NIGHT_SEER/);
  });

  it('未在表里的 action 走拒绝路径，而不是抛错', () => {
    const engine = createEngine({
      transitions: DEFAULT_TRANSITIONS,
      handlers: DEFAULT_HANDLERS,
      appliers: {},
    });
    const lobby = lobbyState();

    const result = engine.step(lobby, { type: 'SPEECH_SKIP', ts: 1, seat: 2 });

    expect(result.events[0]?.type).toBe('REJECTED');
  });
});
