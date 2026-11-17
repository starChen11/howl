import { describe, expect, it } from 'vitest';

import { ROLES } from '@shared/domain';
import type { TermKey } from '@shared/terms';
import { ROLE_LABELS, TERMS } from '@shared/terms';

/**
 * RFC-001 AC-8：术语表是 UI 文案的唯一来源（UI-2 / NFR-11）。
 *
 * 期望表把「键」与「标签」写在一起，一次断言两件事：键集合没有多也没有少、标签顺序与
 * PRD 术语表一致。只数个数挡不住「删掉警长那条、换个别的词凑数」这种退化。
 */

const PRD_GLOSSARY: readonly (readonly [TermKey, string])[] = [
  ['knife', '刀'],
  ['check', '验 / 查验'],
  ['vote', '票'],
  ['banish', '放逐'],
  ['fakeSeerClaim', '悍跳'],
  ['fakeSeerClaimEvent', '悍跳事件'],
  ['wolfAccusesWolf', '狼查杀狼事件'],
  ['selfExposeEvent', '自曝事件'],
  ['selfExpose', '自曝'],
  ['sheriff', '警长 / 警徽流'],
  ['slaughterSide', '屠边'],
  ['slaughterAll', '屠城'],
  ['bait', '垫飞'],
];

describe('AC-8 · 术语表', () => {
  it('覆盖 PRD 术语表的 13 个条目', () => {
    expect(PRD_GLOSSARY).toHaveLength(13);
    expect(Object.keys(TERMS)).toHaveLength(13);
  });

  it('键集合与 PRD 术语表完全一致（不多不少）', () => {
    expect(Object.keys(TERMS).sort()).toEqual(PRD_GLOSSARY.map(([key]) => key).sort());
  });

  it('标签与顺序和 PRD 术语表逐项一致', () => {
    // TERMS[key] 的类型索引本身就是断言：任何一个键不在 TermKey 里都会编译失败。
    const labels = PRD_GLOSSARY.map(([key]) => TERMS[key].label);

    expect(labels).toEqual(PRD_GLOSSARY.map(([, label]) => label));
    expect(labels).toEqual(Object.values(TERMS).map((term) => term.label));
  });

  it('每个条目都有非空定义', () => {
    for (const [key] of PRD_GLOSSARY) {
      expect(TERMS[key].definition.length, `${key} 缺少定义`).toBeGreaterThan(0);
    }
  });

  it('警长 / 警徽流 的定义注明 v1 不实现', () => {
    expect(TERMS.sheriff.definition).toContain('v1 不实现');
  });
});

describe('AC-8 · 身份名', () => {
  it('ROLE_LABELS 含 5 个身份，键与 ROLES 一致且顺序相同', () => {
    expect(Object.keys(ROLE_LABELS)).toEqual([...ROLES]);
    expect(Object.values(ROLE_LABELS)).toEqual(['狼人', '预言家', '女巫', '猎人', '村民']);
  });
});
