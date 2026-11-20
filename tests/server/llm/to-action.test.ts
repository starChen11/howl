import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import type { DecisionContext } from '@server/llm/to-action';
import { toAction } from '@server/llm/to-action';

/**
 * AC-9 / AC-10：决策 → 动作的映射。
 *
 * 边界两类：**阶段不匹配**（AI 说了句不属于当前阶段的话）与**目标不合法**（说了个
 * 不在清单里的号）。两类都返回 `{ reject }`，由调用方产出 `Rejected` 事件。
 */

const BASE: DecisionContext = {
  seat: 3,
  phase: 'DAY_VOTE',
  day: 2,
  legalTargets: [1, 2, 4, 'abstain'] as (SeatId | 'abstain')[],
};

function decision(partial: Partial<Parameters<typeof toAction>[0]>) {
  return { action: 'vote' as const, reason: '理由', ...partial };
}

describe('AC-9 · 投票', () => {
  it('vote + 合法 target → VOTE', () => {
    const result = toAction(decision({ target: 2 }), BASE, 100);

    expect(result).toEqual({ action: { type: 'VOTE', ts: 100, seat: 3, target: 2 } });
  });

  it('vote + 非法 target → reject', () => {
    const result = toAction(decision({ target: 9 }), BASE, 100);

    expect(result).toEqual({ reject: expect.stringContaining('不在本阶段的合法清单里') });
  });

  it('重投阶段 abstain → reject（RUL-2）', () => {
    const runoff = { ...BASE, phase: 'DAY_VOTE_RUNOFF' as const };
    const result = toAction(decision({ action: 'abstain' }), runoff, 100);

    expect(result).toEqual({ reject: expect.stringContaining('不能弃权') });
  });

  it('发言超长被截断到 300 字，而不是整条拒绝', () => {
    const result = toAction(
      decision({ action: 'speak', speech: 'x'.repeat(400) }),
      { ...BASE, phase: 'DAY_SPEECH', legalTargets: [] },
      100,
    );

    expect('action' in result).toBe(true);
    if (!('action' in result)) throw new Error('应当产出 action');
    expect(result.action.type).toBe('SPEECH');
    if (result.action.type !== 'SPEECH') throw new Error('类型窄化失败');
    expect(result.action.text).toHaveLength(300);
  });

  it('abstain → target: abstain 的 VOTE', () => {
    const result = toAction(decision({ action: 'abstain' }), BASE, 100);

    expect(result).toEqual({ action: { type: 'VOTE', ts: 100, seat: 3, target: 'abstain' } });
  });
});

describe('AC-10 · 发言与开枪', () => {
  it('speak + 空 speech → reject', () => {
    const result = toAction(
      decision({ action: 'speak', speech: '' }),
      { ...BASE, phase: 'DAY_SPEECH', legalTargets: [] },
      100,
    );

    expect(result).toEqual({ reject: expect.stringContaining('speak') });
  });

  it('speak + 有文本 → SPEECH', () => {
    const result = toAction(
      decision({ action: 'speak', speech: '我觉得 2 号像狼' }),
      { ...BASE, phase: 'DAY_SPEECH', legalTargets: [] },
      100,
    );

    expect(result).toEqual({
      action: { type: 'SPEECH', ts: 100, seat: 3, text: '我觉得 2 号像狼' },
    });
  });

  it('shoot 在非开枪阶段 → reject', () => {
    const result = toAction(decision({ action: 'shoot', target: 1 }), BASE, 100);

    expect(result).toEqual({ reject: expect.stringContaining('不接受动作 shoot') });
  });

  it('shoot 在开枪阶段 → HUNTER_SHOOT', () => {
    const result = toAction(
      decision({ action: 'shoot', target: 1 }),
      { ...BASE, phase: 'NIGHT_HUNTER_SHOOT', legalTargets: [1] },
      100,
    );

    expect(result).toEqual({ action: { type: 'HUNTER_SHOOT', ts: 100, seat: 3, target: 1 } });
  });
});

describe('其余动作', () => {
  it('kill / check / heal / poison 各自映射到对应 action', () => {
    // RUL-13：夜间 `kill` 现在翻译成狼队投票，而不是直接下刀。
    const night = { ...BASE, phase: 'NIGHT_WOLVES' as const, legalTargets: [1] as SeatId[] };
    expect(toAction(decision({ action: 'kill', target: 1 }), night, 1)).toEqual({
      action: { type: 'WOLF_VOTE', ts: 1, seat: 3, target: 1 },
    });

    const seer = { ...BASE, phase: 'NIGHT_SEER' as const, legalTargets: [1] as SeatId[] };
    expect(toAction(decision({ action: 'check', target: 1 }), seer, 1)).toEqual({
      action: { type: 'SEER_CHECK', ts: 1, seat: 3, target: 1 },
    });

    const witch = { ...BASE, phase: 'NIGHT_WITCH' as const, legalTargets: [1] as SeatId[] };
    expect(toAction(decision({ action: 'heal', target: 1 }), witch, 1)).toEqual({
      action: { type: 'WITCH_ACT', ts: 1, seat: 3, potion: 'heal', target: 1 },
    });
    expect(toAction(decision({ action: 'poison', target: 1 }), witch, 1)).toEqual({
      action: { type: 'WITCH_ACT', ts: 1, seat: 3, potion: 'poison', target: 1 },
    });
    expect(toAction(decision({ action: 'none' }), witch, 1)).toEqual({
      action: { type: 'WITCH_ACT', ts: 1, seat: 3, potion: 'none' },
    });
  });

  it('skip / expose / chat', () => {
    const day = { ...BASE, phase: 'DAY_SPEECH' as const, legalTargets: [] };
    expect(toAction(decision({ action: 'skip' }), day, 1)).toEqual({
      action: { type: 'SPEECH_SKIP', ts: 1, seat: 3 },
    });
    expect(toAction(decision({ action: 'expose' }), day, 1)).toEqual({
      action: { type: 'SELF_EXPOSE', ts: 1, seat: 3 },
    });

    const chat = { ...BASE, phase: 'NIGHT_WOLF_CHAT' as const, legalTargets: [] };
    expect(toAction(decision({ action: 'chat', speech: '刀 2 号' }), chat, 1)).toEqual({
      action: { type: 'WOLF_CHAT', ts: 1, seat: 3, text: '刀 2 号' },
    });
  });
});
