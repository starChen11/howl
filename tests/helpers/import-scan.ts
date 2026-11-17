/**
 * 从源码里抽出**全部**模块说明符，供依赖方向检查使用。
 *
 * 覆盖四种写法——只认 `from '…'` 会漏掉后两种（评审 F5：`import('@server/app')` 能
 * 直接穿过 `shared → server` 的边界而不被发现）：
 *
 * 1. `import … from 'x'` / `export … from 'x'` / `import type … from 'x'`
 * 2. `import 'x'`（仅副作用）
 * 3. `import('x')`（动态导入）
 * 4. `require('x')`
 *
 * 用正则而不是 TypeScript AST 是有意的取舍：这里只需要说明符字符串，不需要语义。
 * 两个已知代价，都偏向「误报」而不是「漏报」：
 * - 注释或普通字符串里出现 `from '…'` 也会被算作依赖；
 * - 只认字符串字面量形式的动态导入（`import(someVariable)` 无法静态判定，本来也不该出现）。
 *
 * 宁可吵，不要静默——漏报会让 ARCH-2 / AC-10 / AC-11 整条静默失效，误报只会让人改一行注释。
 */

/** 两个 token 之间允许出现的空白与注释。动态导入里写注释是合法的，不能因此漏报。 */
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*`;

const PATTERNS = [
  new RegExp(String.raw`\bfrom${GAP}['"]([^'"]+)['"]`, 'g'),
  new RegExp(String.raw`(?:^|\n)[ \t]*import${GAP}['"]([^'"]+)['"]`, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*${GAP}['"]([^'"]+)['"]`, 'g'),
  new RegExp(String.raw`\brequire\s*\(\s*${GAP}['"]([^'"]+)['"]`, 'g'),
];

export function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();

  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }

  return [...specifiers];
}
