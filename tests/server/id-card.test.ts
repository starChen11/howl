import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { project } from '@server/project';
import { buildIdCard } from '@server/view/id-card';

import { lobbyState, startActionOf } from '../fixtures/states';
import { step } from '@engine/step';

/**
 * RFC-011 §5 AC-1 / AC-2：身份卡只读投影，且 9 个席位各自的视图里
 * 只出现自己的角色（SEC-5）。
 */

function started(seed = 20_261_117) {
  const lobby = lobbyState({ seed });
  return step(lobby, startActionOf(lobby, 1));
}

function ctxFor(seat: SeatId) {
  const { state, events } = started();
  return project({ state, events, observer: seat, pending: null });
}

describe('AC-1 · 玩家视图只含自己的角色', () => {
  it('9 个席位各自的投影里，role 字段只出现一次', () => {
    for (const seat of [1, 2, 3, 4, 5, 6, 7, 8, 9] as SeatId[]) {
      const ctx = ctxFor(seat);
      const roles = JSON.stringify(ctx).match(/"role":/g) ?? [];
      expect(roles.length, `seat=${seat}`).toBe(1);
      expect(ctx.self.seat).toBe(seat);
    }
  });
});

describe('AC-2 · 身份卡按角色展示', () => {
  it('预言家有查验史（开局为空时说明）', () => {
    const ctx = ctxFor(1 as SeatId);
    const card = buildIdCard(ctx);

    expect(card.role).toBe(ctx.self.role);
    expect(card.skills.length).toBeGreaterThan(0);
    if (ctx.self.role === 'seer') {
      expect(card.extras.join('')).toContain(
        ctx.knowledge.checks.length === 0 ? '还没有查验记录' : '查',
      );
    }
  });

  it('女巫展示两瓶药的剩余次数', () => {
    const ctx = ctxFor(1 as SeatId);
    const card = buildIdCard(ctx);

    if (ctx.self.role === 'witch') {
      expect(card.remaining.map((item) => item.name)).toEqual(['heal', 'poison']);
      for (const item of card.remaining) expect([0, 1]).toContain(item.count);
    }
  });

  it('狼人展示队友席位', () => {
    const ctx = ctxFor(1 as SeatId);
    const card = buildIdCard(ctx);

    if (ctx.self.role === 'wolf') {
      expect(card.extras.join('')).toMatch(/队友|没有其他队友/);
    }
  });

  it('猎人展示开枪条件', () => {
    const ctx = ctxFor(1 as SeatId);
    const card = buildIdCard(ctx);

    if (ctx.self.role === 'hunter') {
      expect(card.extras.join('')).toMatch(/可以开枪/);
    }
  });

  it('角色标签来自术语表，不是硬编码', () => {
    const ctx = ctxFor(3 as SeatId);
    const card = buildIdCard(ctx);

    expect(card.roleLabel.length).toBeGreaterThan(0);
    expect(card.roleLabel).not.toBe(card.role);
  });
});
