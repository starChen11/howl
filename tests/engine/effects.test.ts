import { describe, expect, it } from 'vitest';

import type { GameState } from '@shared/domain';
import type { Effect } from '@shared/effects';
import { EFFECT_ORDER } from '@shared/effects';

import type { Modifier } from '@engine/effects';
import { applyEffects, applyModifiers, orderEffects } from '@engine/effects';
import { UnknownEffectError } from '@engine/errors';

import { startedState } from '../fixtures/states';

/**
 * AC-10 / AC-11 / AC-12：效果管道（ARCH-5 / F7）。
 *
 * 三条 AC 分别守：顺序、扩展插入点、以及「没有扩展时行为与没有这套机制一致」的回归基线。
 */

function makeEffect(id: string, order: number, type = 'record'): Effect {
  return { id, source: 'system', type, target: null, payload: {}, order };
}

/** 记录被应用的 id 顺序，返回状态时不动它。 */
function recordingApplier(applied: string[]) {
  return (state: GameState, effect: Effect): GameState => {
    applied.push(effect.id);
    return state;
  };
}

describe('AC-10 · 效果的规范化顺序', () => {
  it('order 升序，同 order 按 id 字典序', () => {
    const effects = [
      makeEffect('c', EFFECT_ORDER.DEATH_TRIGGER),
      makeEffect('b', EFFECT_ORDER.CANCEL),
      makeEffect('a', EFFECT_ORDER.DEATH),
      makeEffect('a', EFFECT_ORDER.CANCEL),
      makeEffect('b', EFFECT_ORDER.DEATH),
    ];

    expect(orderEffects(effects).map((effect) => `${effect.order}:${effect.id}`)).toEqual([
      '0:a',
      '0:b',
      '100:a',
      '100:b',
      '200:c',
    ]);
  });

  it('应用顺序与规范化顺序一致，且不改入参', () => {
    const effects = [makeEffect('z', EFFECT_ORDER.DEATH), makeEffect('y', EFFECT_ORDER.CANCEL)];
    const snapshot = structuredClone(effects);
    const applied: string[] = [];

    applyEffects(startedState(), effects, { record: recordingApplier(applied) });

    expect(applied).toEqual(['y', 'z']);
    expect(effects).toEqual(snapshot);
  });

  it('同一组效果两次应用结果深度相等', () => {
    const state = startedState();
    const effects = [
      makeEffect('bump', EFFECT_ORDER.DEATH),
      makeEffect('bump2', EFFECT_ORDER.CANCEL),
    ];
    const appliers = {
      record: (current: GameState, effect: Effect): GameState => ({
        ...current,
        day: current.day + (effect.id === 'bump' ? 1 : 10),
      }),
    };

    expect(applyEffects(state, effects, appliers)).toEqual(applyEffects(state, effects, appliers));
  });

  it('未注册 applier 的效果抛 UnknownEffectError（不静默跳过）', () => {
    const effects = [makeEffect('x', EFFECT_ORDER.CANCEL, 'nobody-owns-me')];

    expect(() => applyEffects(startedState(), effects, {})).toThrow(UnknownEffectError);
  });

  it('空效果列表返回等价状态', () => {
    const state = startedState();

    expect(applyEffects(state, [], {})).toEqual(state);
  });
});

describe('AC-11 · 扩展插入点', () => {
  it('注册到 VOTE_RESOLVE 的 modifier 注入的效果会改变最终状态', () => {
    const state = startedState();
    const baseEffects = [makeEffect('base', EFFECT_ORDER.CANCEL)];

    // 基线：没有 modifier 时状态只受 baseEffects 影响
    const withoutModifier = applyEffects(state, baseEffects, {
      record: (current) => ({ ...current, mode: 'slaughter-all' }),
    });

    const invalidateVote: Modifier = (point, _current, effects) =>
      point === 'VOTE_RESOLVE'
        ? [...effects, makeEffect('extra', EFFECT_ORDER.EXTENSION, 'invalidate-vote')]
        : [...effects];

    const extended = applyModifiers('VOTE_RESOLVE', state, baseEffects, [invalidateVote]);
    const withModifier = applyEffects(state, extended, {
      record: (current) => ({ ...current, mode: 'slaughter-all' }),
      'invalidate-vote': (current) => ({ ...current, day: current.day + 1 }),
    });

    expect(extended.map((effect) => effect.id)).toEqual(['base', 'extra']);
    expect(withModifier).not.toEqual(withoutModifier);
    expect(withModifier.day).toBe(withoutModifier.day + 1);
  });

  it('modifier 只在它关心的结算点注入', () => {
    const state = startedState();
    const effects = [makeEffect('base', EFFECT_ORDER.CANCEL)];
    const modifier: Modifier = (point, _s, list) =>
      point === 'NIGHT_RESOLVE'
        ? [...list, makeEffect('night-only', EFFECT_ORDER.EXTENSION)]
        : [...list];

    expect(applyModifiers('VOTE_RESOLVE', state, effects, [modifier])).toHaveLength(1);
    expect(applyModifiers('NIGHT_RESOLVE', state, effects, [modifier])).toHaveLength(2);
  });

  it('多个 modifier 依次折叠，后一个能看到前一个的产出', () => {
    const state = startedState();
    const first: Modifier = (_p, _s, list) => [...list, makeEffect('a', EFFECT_ORDER.EXTENSION)];
    const second: Modifier = (_p, _s, list) => [...list, makeEffect('b', EFFECT_ORDER.EXTENSION)];

    const result = applyModifiers('WIN_CHECK', state, [], [first, second]);

    expect(result.map((effect) => effect.id)).toEqual(['a', 'b']);
  });
});

describe('AC-12 · 没有 modifier 时与没有这套机制一致', () => {
  it('不注册 modifier 时只做顺序规范化', () => {
    const state = startedState();
    const effects = [makeEffect('b', EFFECT_ORDER.DEATH), makeEffect('a', EFFECT_ORDER.CANCEL)];

    const result = applyModifiers('VOTE_RESOLVE', state, effects);

    expect(result).toEqual(orderEffects(effects));
    expect(result).toHaveLength(effects.length);
  });

  it('已按规范顺序排好的输入，输出与输入深度相等', () => {
    const state = startedState();
    const effects = orderEffects([
      makeEffect('b', EFFECT_ORDER.DEATH),
      makeEffect('a', EFFECT_ORDER.CANCEL),
    ]);

    expect(applyModifiers('DEATH_RESOLVE', state, effects, [])).toEqual(effects);
  });
});
