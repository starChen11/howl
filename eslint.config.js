import tseslint from 'typescript-eslint';

/**
 * 只用 `typescript-eslint` 的 recommended，不引入 `@eslint/js`：
 * 未定义变量由 TypeScript 负责，而 `RULES.md` §2 的依赖表里没有 `@eslint/js`，
 * 为一个预设再加一个未登记依赖不值得（DOC-2）。
 *
 * AC-14 要求的两条规则显式设为 error，不依赖预设的取值。
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'tests/meta/fixtures/**',
      // 固化的技能资产，只读，本项目不改也不 lint（AGENTS.md「技能」）。
      '.dsh/**',
      // 文档层不是代码。
      'docs/**',
      'changes/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
);
