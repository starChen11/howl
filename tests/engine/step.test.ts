import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';
import type { GameState } from '@shared/domain';

import type { Modifier } from '@engine/effects';
import { applyModifiers } from '@engine/effects';
import { createEngine, DEFAULT_HANDLERS, reduce, step } from '@engine/step';
import { DEFAULT_APPLIERS } from '@engine/step';
import { DEFAULT_TRANSITIONS } from '@engine/transitions';

import { lobbyState, startActionOf, startedState } from '../fixtures/states';

/**
 * AC-1 / AC-2：`reduce` 与 `step` 的关系，以及 `step` 的纯函数性。
 *
 * 这两条是引擎的地基。`reduce === step.state` 不是靠两条代码路径对齐出来的，
 * 而是因为 `step` 只会把事件交给 `applyEvent` 折叠（见 `src/engine/step.ts`）。
 */

/** 覆盖各 action 类型的样本；只有 `START` 在 RFC-002 的允许集合内，其余走拒绝路径。 */
const SAMPLE_ACTIONS: readonly Action[] = [
  { type: 'START', ts: 1_000, seed: 20_261_117, mode: 'slaughter-side', playerSeat: 3 },
  { type: 'WOLF_CHAT', ts: 1_001, seat: 1, text: '今夜刀 2 号' },
  { type: 'WOLF_KILL', ts: 1_002, seat: 1, target: 2 },
  { type: 'SEER_CHECK', ts: 1_003, seat: 4, target: 5 },
  { type: 'WITCH_ACT', ts: 1_004, seat: 5, potion: 'none' },
  { type: 'HUNTER_SHOOT', ts: 1_005, seat: 6 },
  { type: 'SPEECH', ts: 1_006, seat: 2, text: '我是好人' },
  { type: 'SPEECH_SKIP', ts: 1_007, seat: 2 },
  { type: 'VOTE', ts: 1_008, seat: 2, target: 'abstain' },
  { type: 'SELF_EXPOSE', ts: 1_009, seat: 1 },
];

describe('AC-1 · reduce(s, a) 与 step(s, a).state 深度相等', () => {
  it.each(SAMPLE_ACTIONS.map((action) => [action.type, action] as const))('%s', (_type, action) => {
    const state = lobbyState();

    expect(reduce(state, action)).toEqual(step(state, action).state);
  });

  it('在已开局的状态上同样成立（拒绝路径）', () => {
    const state = startedState();
    const action = SAMPLE_ACTIONS[3];
    if (action === undefined) throw new Error('样本缺失');

    expect(reduce(state, action)).toEqual(step(state, action).state);
  });
});

describe('AC-2 · step 是纯函数', () => {
  it('同一 (state, action) 两次调用返回深度相等的结果', () => {
    const state = lobbyState();
    const action = startActionOf(state);

    const first = step(state, action);
    const second = step(state, action);

    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
  });

  it('不修改传入的 state（冻结后调用不抛错）', () => {
    const state = lobbyState();
    const frozen: GameState = Object.freeze(structuredClone(state));

    expect(() => step(frozen, startActionOf(state))).not.toThrow();
    // 原对象一个字段都没变
    expect(frozen).toEqual(state);
  });

  it('不修改传入的 action', () => {
    const state = lobbyState();
    const action = startActionOf(state);
    const snapshot = structuredClone(action);

    step(state, action);

    expect(action).toEqual(snapshot);
  });

  it('不同 seed 得到不同发牌（防止把 seed 忽略掉也能通过）', () => {
    const a = lobbyState({ seed: 1 });
    const b = lobbyState({ seed: 2 });

    expect(a.seats.map((seat) => seat.role)).not.toEqual(b.seats.map((seat) => seat.role));
  });
});

describe('N9 · modifier 通过 step 的入口传到 handler', () => {
  it('传给 step 的 modifiers 会出现在 handler 的 context 里', () => {
    const seen: string[] = [];
    const modifier: Modifier = (point, state, effects) => {
      seen.push(`${point}@${state.phase}`);
      return [...effects];
    };

    // 自定义 handler：把「拿到的 modifier 数量」写进事件，证明参数确实流到了 handler 里。
    const engine = createEngine({
      transitions: DEFAULT_TRANSITIONS,
      handlers: {
        START: (_state, action, context) => [
          {
            type: 'REJECTED',
            visibleTo: 'public',
            payload: {
              actionType: action.type,
              code: context.modifiers.length > 0 ? 'SAW_MODIFIER' : 'NO_MODIFIER',
              message: '',
            },
          },
        ],
      },
      appliers: {},
    });

    const lobby = lobbyState();
    const action = startActionOf(lobby);

    expect(engine.step(lobby, action).events[0]?.payload).toMatchObject({ code: 'NO_MODIFIER' });
    expect(engine.step(lobby, action, [modifier]).events[0]?.payload).toMatchObject({
      code: 'SAW_MODIFIER',
    });

    // handler 里若真的用了 applyModifiers，modifier 会被调用一次
    const handler = (state: typeof lobby, list: readonly Modifier[]) =>
      applyModifiers('VOTE_RESOLVE', state, [], list);
    expect(handler(lobby, [modifier])).toEqual([]);
    expect(seen).toEqual(['VOTE_RESOLVE@LOBBY']);
  });
});

describe('N11 · 一个 action 产出多条事件时 seq 仍然连续', () => {
  it('handler 返回 3 个草稿，seq 为 +1 / +2 / +3 且状态 seq 跟上', () => {
    const engine = createEngine({
      transitions: DEFAULT_TRANSITIONS,
      handlers: {
        START: (_state, action) => [
          {
            type: 'REJECTED',
            visibleTo: 'public',
            payload: { actionType: action.type, code: 'C1', message: '' },
          },
          {
            type: 'REJECTED',
            visibleTo: 'public',
            payload: { actionType: action.type, code: 'C2', message: '' },
          },
          {
            type: 'REJECTED',
            visibleTo: 'public',
            payload: { actionType: action.type, code: 'C3', message: '' },
          },
        ],
      },
      appliers: {},
    });

    const lobby = lobbyState();
    const result = engine.step(lobby, startActionOf(lobby));

    expect(result.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(result.state.seq).toBe(3);
  });
});

describe('createEngine · 注入能力', () => {
  it('可以注入自定义 transitions 与 handlers，且不影响默认实例', () => {
    const engine = createEngine({
      transitions: { ...DEFAULT_TRANSITIONS, LOBBY: [] },
      handlers: DEFAULT_HANDLERS,
      appliers: DEFAULT_APPLIERS,
    });

    const state = lobbyState();
    const viaCustom = engine.step(state, startActionOf(state));
    const viaDefault = step(state, startActionOf(state));

    expect(viaCustom.events[0]?.type).toBe('REJECTED');
    expect(viaDefault.events[0]?.type).toBe('GAME_STARTED');
  });
});
