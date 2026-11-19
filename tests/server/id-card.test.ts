import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { project } from '@server/project';
import { buildIdCard } from '@server/view/id-card';

import { lobbyState, startActionOf } from '../fixtures/states';
import { step } from '@engine/step';

/**
 * RFC-011 §5 AC-1 / AC-2：身份卡只读投影，且 9 个席位各自的视图里
 * 只出现自己的角色（SEC-5）。
 *
 * 用**按种子扫**的方式拿到每种角色的投影——否则「女巫/狼/猎人」这些分支
 * 在某个固定种子下永远不会执行，测试就是空的。
 */

function ctxOfRole(role: string) {
  for (let seed = 1; seed <= 200; seed += 1) {
    const lobby = lobbyState({ seed });
    const started = step(lobby, startActionOf(lobby, 1));
    for (const seat of [1, 2, 3, 4, 5, 6, 7, 8, 9] as SeatId[]) {
      const ctx = project({
        state: started.state,
        events: started.events,
        observer: seat,
        pending: null,
      });
      if (ctx.self.role === role) return ctx;
    }
  }
  throw new Error(`找不到角色 ${role}`);
}

describe('AC-1 · 玩家视图只含自己的角色', () => {
  it('9 个席位各自的投影里，role 字段只出现一次', () => {
    for (const seat of [1, 2, 3, 4, 5, 6, 7, 8, 9] as SeatId[]) {
      const lobby = lobbyState({ seed: 20_261_117 });
      const started = step(lobby, startActionOf(lobby, 1));
      const ctx = project({
        state: started.state,
        events: started.events,
        observer: seat,
        pending: null,
      });

      const roles = JSON.stringify(ctx).match(/"role":/g) ?? [];
      expect(roles.length, `seat=${seat}`).toBe(1);
      expect(ctx.self.seat).toBe(seat);
    }
  });
});

describe('AC-2 · 身份卡按角色展示', () => {
  it('五种角色都有技能与目标（目标不能是空串）', () => {
    for (const role of ['seer', 'witch', 'hunter', 'wolf', 'villager']) {
      const card = buildIdCard(ctxOfRole(role));
      expect(card.skills.length, role).toBeGreaterThan(0);
      expect(card.goal.length, role).toBeGreaterThan(0);
    }
  });

  it('预言家有查验史（开局为空时说明）', () => {
    const card = buildIdCard(ctxOfRole('seer'));

    expect(card.extras.join('')).toContain('还没有查验记录');
  });

  it('女巫展示两瓶药的剩余次数', () => {
    const card = buildIdCard(ctxOfRole('witch'));

    expect(card.remaining.map((item) => item.name)).toEqual(['heal', 'poison']);
    for (const item of card.remaining) expect([0, 1]).toContain(item.count);
  });

  it('狼人展示队友席位', () => {
    const card = buildIdCard(ctxOfRole('wolf'));

    expect(card.extras.join('')).toMatch(/队友/);
  });

  it('猎人展示开枪条件', () => {
    const card = buildIdCard(ctxOfRole('hunter'));

    expect(card.extras.join('')).toMatch(/开枪/);
  });

  it('角色标签来自术语表，不是硬编码', () => {
    const card = buildIdCard(ctxOfRole('seer'));

    expect(card.roleLabel.length).toBeGreaterThan(0);
    expect(card.roleLabel).not.toBe(card.role);
  });
});
