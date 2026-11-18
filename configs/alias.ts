import { fileURLToPath } from 'node:url';

function dir(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

/**
 * 路径别名的单一来源。
 *
 * `tsconfig.json` 的 `paths` 必须与本表逐项一致（RFC-001 §2.2）。改一处就要改另一处，
 * `tests/meta/tsconfig.test.ts` 会断言两边不漂移。
 */
export const ALIAS = {
  '@shared': dir('../src/shared'),
  '@engine': dir('../src/engine'),
  '@server': dir('../src/server'),
  '@client': dir('../src/client'),
} as const;
