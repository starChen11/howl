import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Phase } from '@shared/domain';
import { FACTION_OF, FACTIONS, PHASES, ROLES, SEAT_IDS, WIN_MODES } from '@shared/domain';

/**
 * 领域类型与纯量常量（AC-5 + 评审 F7）。
 *
 * 类型层面的要求在运行时是「不可见的」，所以这里同两条路都走：
 * - `as const` 数组做运行时断言（能数出个数）；
 * - `expectTypeOf` 做双向精确比较（能挡住「只加类型成员、不改数组」这类漂移）。
 */

const EXPECTED_PHASES = [
  'LOBBY',
  'NIGHT_WOLF_CHAT',
  'NIGHT_WOLVES',
  'NIGHT_WOLF_RUNOFF',
  'NIGHT_SEER',
  'NIGHT_WITCH',
  'NIGHT_RESOLVE',
  'NIGHT_HUNTER_SHOOT',
  'DAY_ANNOUNCE',
  'DAY_SPEECH',
  'DAY_VOTE',
  'DAY_PK_SPEECH',
  'DAY_VOTE_RUNOFF',
  'DAY_LYNCH',
  'DAY_HUNTER_SHOOT',
  'FINISHED',
] as const;

describe('AC-5 · Phase 的取值集合', () => {
  it('恰好 16 个取值，且与 RFC 列出的取值逐项一致', () => {
    expect(PHASES).toHaveLength(16);
    expect([...PHASES]).toEqual([...EXPECTED_PHASES]);
    expect(new Set(PHASES).size).toBe(16);
  });

  it('是封闭联合：列表外的取值无法赋给 Phase', () => {
    // @ts-expect-error 'NIGHT_MOON' 不在 14 个取值里
    const unknownPhase: Phase = 'NIGHT_MOON';
    expect(unknownPhase).toBe('NIGHT_MOON');
  });

  it('类型集合与运行时数组完全相等（加第 15 个类型成员会编译失败）', () => {
    // 评审 M1：只加类型成员、不改数组时，运行时断言与上面的夹具都仍然通过。
    // toEqualTypeOf 是双向精确比较，多一个少一个都编译失败。
    expectTypeOf<Phase>().toEqualTypeOf<(typeof EXPECTED_PHASES)[number]>();
  });
});

describe('F7 · 其余领域常量', () => {
  it('SEAT_IDS 是 1..9', () => {
    expect([...SEAT_IDS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ROLES 与 FACTION_OF 的键一致', () => {
    expect([...ROLES]).toEqual(['wolf', 'seer', 'witch', 'hunter', 'villager']);
    expect(Object.keys(FACTION_OF)).toEqual([...ROLES]);
  });

  it('FACTION_OF 把五个身份映射到正确阵营', () => {
    // `satisfies Record<Role, Faction>` 只保证类型合法：把 seer 写成 'wolf' 也能编译，
    // 只有这条断言能挡。
    expect(FACTION_OF).toEqual({
      wolf: 'wolf',
      seer: 'good',
      witch: 'good',
      hunter: 'good',
      villager: 'good',
    });
  });

  it('FACTIONS 与 WIN_MODES 的取值集合', () => {
    expect([...FACTIONS]).toEqual(['wolf', 'good']);
    expect([...WIN_MODES]).toEqual(['slaughter-side', 'slaughter-all']);
  });
});
