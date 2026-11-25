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

describe('RUL-14 · 讨论里可以准备', () => {
  it('NIGHT_WOLF_CHAT 的 ready 映射成 WOLF_READY', () => {
    const chat = { ...BASE, phase: 'NIGHT_WOLF_CHAT' as const };
    expect(toAction(decision({ action: 'ready' }), chat, 1)).toEqual({
      action: { type: 'WOLF_READY', ts: 1, seat: 3 },
    });
  });
});

describe('RUL-13 · 重投相位也能投票', () => {
  it('NIGHT_WOLF_RUNOFF 的 kill 也翻译成 WOLF_VOTE', () => {
    const runoff = {
      ...BASE,
      phase: 'NIGHT_WOLF_RUNOFF' as const,
      legalTargets: [1] as SeatId[],
    };
    expect(toAction(decision({ action: 'kill', target: 1 }), runoff, 1)).toEqual({
      action: { type: 'WOLF_VOTE', ts: 1, seat: 3, target: 1 },
    });
  });
});

describe('RFC-020 · PK 发言也是合法动作', () => {
  it('DAY_PK_SPEECH 接受 speak / skip', () => {
    const ctx = {
      seat: 1 as never,
      phase: 'DAY_PK_SPEECH' as never,
      day: 1,
      legalTargets: [],
    };
    expect(toAction({ action: 'speak', reason: '自证', speech: '我不是狼' }, ctx, 1)).toMatchObject(
      {
        action: { type: 'SPEECH', text: '我不是狼' },
      },
    );
    expect(toAction({ action: 'skip', reason: '过' }, ctx, 1)).toMatchObject({
      action: { type: 'SPEECH_SKIP' },
    });
  });
});

describe('猎人可以选择不开枪', () => {
  it('shoot 没有 target 时翻译成不开枪，而不是拒绝', () => {
    const ctx = {
      seat: 2 as never,
      phase: 'DAY_HUNTER_SHOOT' as never,
      day: 1,
      legalTargets: [3, 4],
    };
    expect(toAction({ action: 'shoot', reason: '没有信息' }, ctx as never, 1)).toMatchObject({
      action: { type: 'HUNTER_SHOOT', seat: 2 },
    });
  });
});

describe('RFC-022 · 警长相关动作', () => {
  const seat = 3 as SeatId;

  it('上警 / 不上警 → SHERIFF_SIGNUP', () => {
    const ctx = { seat, phase: 'DAY_SHERIFF_SIGNUP' as const, day: 1, legalTargets: [] };
    expect(toAction({ action: 'signup', reason: '想上警' }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_SIGNUP', ts: 1, seat, run: true },
    });
    expect(toAction({ action: 'no-signup', reason: '不参选' }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_SIGNUP', ts: 1, seat, run: false },
    });
  });

  it('退水 / 留在警上 → SHERIFF_WITHDRAW', () => {
    const ctx = { seat, phase: 'DAY_SHERIFF_WITHDRAW' as const, day: 1, legalTargets: [] };
    expect(toAction({ action: 'withdraw', reason: '退水' }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_WITHDRAW', ts: 1, seat, withdraw: true },
    });
    expect(toAction({ action: 'stay', reason: '继续选' }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_WITHDRAW', ts: 1, seat, withdraw: false },
    });
  });

  it('警下投票映射成 SHERIFF_VOTE；重投不能弃权', () => {
    const ctx = {
      seat: 5 as SeatId,
      phase: 'DAY_SHERIFF_VOTE' as const,
      day: 1,
      legalTargets: [2, 3, 'abstain'] as (SeatId | 'abstain')[],
    };
    expect(toAction({ action: 'vote', reason: '投 2', target: 2 }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_VOTE', ts: 1, seat: 5, target: 2 },
    });
    expect(toAction({ action: 'abstain', reason: '都不满意' }, ctx, 1)).toEqual({
      action: { type: 'SHERIFF_VOTE', ts: 1, seat: 5, target: 'abstain' },
    });
    expect(
      toAction(
        { action: 'abstain', reason: '想弃权' },
        { ...ctx, phase: 'DAY_SHERIFF_RUNOFF' as const, legalTargets: [2, 3] },
        1,
      ),
    ).toEqual({ reject: expect.stringContaining('不能弃权') });
  });

  it('警徽移交：vote → 目标，tear → 撕徽，abstain 被拒', () => {
    const ctx = {
      seat,
      phase: 'DAY_BADGE_TRANSFER' as const,
      day: 1,
      legalTargets: [2, 4] as (SeatId | 'abstain')[],
    };
    expect(toAction({ action: 'vote', reason: '交给 4', target: 4 }, ctx, 1)).toEqual({
      action: { type: 'BADGE_TRANSFER', ts: 1, seat, target: 4 },
    });
    expect(toAction({ action: 'tear', reason: '撕掉' }, ctx, 1)).toEqual({
      action: { type: 'BADGE_TRANSFER', ts: 1, seat, target: 'tear' },
    });
    expect(toAction({ action: 'abstain', reason: '不处理' }, ctx, 1)).toEqual({
      reject: expect.stringContaining('不能弃权'),
    });
  });

  it('定序：带方向时按合法选项翻译，非法起点被拒', () => {
    const ctx = {
      seat: 2 as SeatId,
      phase: 'DAY_SHERIFF_ORDER' as const,
      day: 1,
      legalTargets: [3, 8] as (SeatId | 'abstain')[],
      orderOptions: [
        { startSeat: 3 as SeatId, direction: 'clockwise' as const },
        { startSeat: 8 as SeatId, direction: 'counterclockwise' as const },
      ],
    };
    expect(
      toAction(
        { action: 'order', reason: '死右', target: 8, direction: 'counterclockwise' },
        ctx,
        1,
      ),
    ).toEqual({
      action: {
        type: 'SHERIFF_ORDER',
        ts: 1,
        seat: 2,
        startSeat: 8,
        direction: 'counterclockwise',
      },
    });
    expect(toAction({ action: 'order', reason: '乱选', target: 9 }, ctx, 1)).toEqual({
      reject: expect.stringContaining('不在本阶段的合法清单里'),
    });
  });

  it('竞选发言用 speak/skip，竞选期间可以自曝', () => {
    const ctx = {
      seat,
      phase: 'DAY_SHERIFF_SPEECH' as const,
      day: 1,
      legalTargets: [],
    };
    expect(toAction({ action: 'speak', reason: '拉票', speech: '请投我' }, ctx, 1)).toMatchObject({
      action: { type: 'SPEECH', text: '请投我' },
    });
    expect(toAction({ action: 'skip', reason: '过' }, ctx, 1)).toEqual({
      action: { type: 'SPEECH_SKIP', ts: 1, seat },
    });
    expect(toAction({ action: 'expose', reason: '自曝' }, ctx, 1)).toEqual({
      action: { type: 'SELF_EXPOSE', ts: 1, seat },
    });
  });
});
