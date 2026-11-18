import type { Role } from './domain';

/**
 * 术语与身份名：**UI 文案的唯一来源**（UI-2 / NFR-11 / F43）。
 *
 * 覆盖面 = PRD 末尾术语表的全部 13 个条目。组件里不得再硬编码这些字符串，
 * `tests/security/no-hardcoded-terms.test.ts` 会扫描 `src/` 把硬编码身份名拦下来。
 */
export interface Term {
  label: string;
  definition: string;
}

export const TERMS = {
  knife: {
    label: '刀',
    definition: '狼人夜间击杀',
  },
  check: {
    label: '验 / 查验',
    definition: '预言家夜间查看一人身份',
  },
  vote: {
    label: '票',
    definition: '投票，或指某人的得票',
  },
  banish: {
    label: '放逐',
    definition: '白天投票出局',
  },
  fakeSeerClaim: {
    label: '悍跳',
    definition: '狼人冒充预言家',
  },
  fakeSeerClaimEvent: {
    label: '悍跳事件',
    definition:
      '某狼人 AI 在白天公开发言中声称自己是预言家，并给出至少一条具体查验目标与结论（FR-16 的验收判据）',
  },
  wolfAccusesWolf: {
    label: '狼查杀狼事件',
    definition: '某狼人 AI 在白天公开指认另一名狼人为狼（FR-16 的验收判据）',
  },
  selfExposeEvent: {
    label: '自曝事件',
    definition: '某狼人 AI 或玩家翻牌公开承认自己是狼（FR-15 / FR-16 的验收判据）',
  },
  selfExpose: {
    label: '自曝',
    definition: '狼人白天翻牌认狼，直接进黑夜。全文统一写作「自曝」，不写「翻牌自曝」',
  },
  sheriff: {
    label: '警长 / 警徽流',
    definition: 'v1 不实现，见 PRD Scope 的「v1 明确不做」',
  },
  slaughterSide: {
    label: '屠边',
    definition: '狼人杀光所有神或所有民即胜',
  },
  slaughterAll: {
    label: '屠城',
    definition: '狼人杀光全部好人即胜',
  },
  bait: {
    label: '垫飞',
    definition: '好人故意做出可疑行为，为真预言家挡刀',
  },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

/**
 * 身份名。用 `satisfies Record<Role, string>`：新增身份而忘记补标签会直接编译失败。
 */
export const ROLE_LABELS = {
  wolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  villager: '村民',
} as const satisfies Record<Role, string>;
