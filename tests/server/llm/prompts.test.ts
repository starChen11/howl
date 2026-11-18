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
      const prompt = buildSystemPrompt({ persona, mode: 'slaughter-side' });
      for (const banned of BANNED) {
        expect(prompt, `persona=${String(persona)} 含 ${banned}`).not.toContain(banned);
      }
    }
  });

  it('系统提示包含规则书与注入声明', () => {
    const prompt = buildSystemPrompt({ persona: null, mode: 'slaughter-side' });

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

describe('B3 · 用户消息要带上对局内容，而不只是事件类型', () => {
  it('发言原文、票型、死者都出现在消息里，且发言经封装', () => {
    const ctx: ProjectedContext = {
      ...CTX,
      phase: 'DAY_VOTE',
      publicEvents: [
        {
          gameId: 'g',
          seq: 1,
          ts: 1,
          type: 'DAY_STARTED',
          visibleTo: 'public',
          payload: { day: 2, diedLastNight: [4], speechStartSeat: 5 },
        },
        {
          gameId: 'g',
          seq: 2,
          ts: 2,
          type: 'SPEECH',
          visibleTo: 'public',
          payload: { seat: 5, text: '我觉得 2 号像狼' },
        },
        {
          gameId: 'g',
          seq: 3,
          ts: 3,
          type: 'VOTE_REVEALED',
          visibleTo: 'public',
          payload: { votes: [{ seat: 5, target: 2 }] },
        },
      ] as never,
    };

    const message = buildUserMessage(ctx);

    expect(message).toContain('4 号出局');
    expect(message).toContain('public_utterance seat="5"');
    expect(message).toContain('我觉得 2 号像狼');
    expect(message).toContain('5 号投 2 号');
    // 不再只是事件类型清单
    expect(message).not.toContain('- SPEECH\n');
  });

  it('列出 12 个可选动作与当前待决事项', () => {
    const message = buildUserMessage(CTX);

    expect(message).toContain('可选动作');
    expect(message).toContain('kill');
    expect(message).toContain('chat');
    expect(message).toContain('当前需要你做出：check 决策');
  });

  it('女巫看得到刀口与药水位', () => {
    const witchCtx: ProjectedContext = {
      ...CTX,
      self: { seat: 5, role: 'witch', alive: true, personaId: null },
      knowledge: {
        ...CTX.knowledge,
        potions: { heal: 'available', poison: 'available' },
        knownKillTarget: 7,
      },
    };

    const message = buildUserMessage(witchCtx);
    expect(message).toContain('今晚被袭击的是 7 号');
    expect(message).toContain('解药可用');
  });
});

describe('B3 · 胜利条件按模式生成', () => {
  it('屠边与屠城的措辞不同', () => {
    const side = buildSystemPrompt({ persona: null, mode: 'slaughter-side' });
    const all = buildSystemPrompt({ persona: null, mode: 'slaughter-all' });

    expect(side).toContain('神职全部出局');
    expect(all).toContain('所有好人全部出局');
    expect(side).not.toBe(all);
  });
});
