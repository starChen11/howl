import type { Phase } from '@shared/domain';

import type { AutoPhaseEntry } from './auto';
import { dayAnnounceEntry } from './day';
import { lynchEntry } from './lynch';
import { resolveNightEntry } from './night';

/**
 * 自动阶段登记表。
 *
 * 单独一个文件是为了避免循环 import：`step.ts` 要读这张表，而各阶段的 handler 要读
 * `step.ts` 的类型。把「谁登记为自动阶段」放在既不被 handler 依赖、也不依赖 handler
 * 的地方，依赖方向就只剩 `step.ts → auto-table.ts → phases/*.ts → step.ts（仅类型）`。
 */
export const AUTO_PHASE_ENTRIES: Partial<Record<Phase, AutoPhaseEntry>> = {
  NIGHT_RESOLVE: resolveNightEntry,
  DAY_ANNOUNCE: dayAnnounceEntry,
  DAY_LYNCH: lynchEntry,
};

/** 自动阶段推进的循环上限。正常情况下一次 action 最多推进两三个自动阶段。 */
export const AUTO_PHASE_LIMIT = 8;
