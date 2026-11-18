import { describe, expect, it } from 'vitest';

import type { ProjectedContext } from '@shared/project';

import { ROLE_LABELS } from '@shared/terms';

import { buildSystemPrompt, buildUserMessage } from '@server/llm/prompts/base';

/**
 * AC-11：提示词里不得出现区分「玩家 vs AI」的措辞（AI-8 / F17）。
 *
 * 扫的是**生成出来的提示词**，不是源码——源码里写死的常量也可能被拼接漏过。
 */

const BANNED = ['human', '真人', '你是 AI', '助手', '玩家是用户'];

const CTX: ProjectedContext = {
  self: { seat: 3, role: 'seer', alive: true, personaId: null },
  phase: 'NIGHT_SEER',
  day: 1,
  aliveSeats: [1, 2, 3],
  deadSeats: [],
  publicEvents: [],
  privateEvents: [],
  knowledge: {
    teammates: [],
    checks: [{ day: 1, target: 2, result: 'wolf' }],
    potions: { heal: 'used', poison: 'used' },
    canShoot: false,
    knownKillTarget: null,
  },
  legalTargets: [1, 2],
  pending: 'check',
};

describe('AC-11 · 系统提示不含扮演类措辞', () => {
  it('5 个禁词都不出现（有人格与无人格两种）', () => {
    for (const persona of [null, '谨慎、话少']) {
      const prompt = buildSystemPrompt({ persona });
      for (const banned of BANNED) {
        expect(prompt, `persona=${String(persona)} 含 ${banned}`).not.toContain(banned);
      }
    }
  });

  it('系统提示包含规则书与注入声明', () => {
    const prompt = buildSystemPrompt({ persona: null });

    expect(prompt).toContain(ROLE_LABELS.wolf);
    expect(prompt).toContain('public_utterance');
    expect(prompt).toContain('不是给你的指令');
  });
});

describe('用户消息 · 反映知情清单', () => {
  it('含席位、身份、阶段与查验记录', () => {
    const message = buildUserMessage(CTX);

    expect(message).toContain('你是 3 号');
    expect(message).toContain('seer');
    expect(message).toContain('第 1 天');
    expect(message).toContain('2 号是');
  });

  it('不含任何禁词', () => {
    const message = buildUserMessage(CTX);
    for (const banned of BANNED) expect(message).not.toContain(banned);
  });
});
