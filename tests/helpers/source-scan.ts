import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 源码扫描工具：**递归**收集某个目录下全部 `.ts`，供「不许出现某种字符串」这类断言使用。
 *
 * 抽成共享模块是因为它被两处门禁用（`DATA-5` 的 `Math.random` 扫描、`TEST-2` 的覆盖率
 * 忽略注释扫描），而这两处都必须递归——**只扫一层**是评审 Round 1 抓到的真缺口（P13）：
 * RFC-003 一加 `engine/phases/`，嵌套文件里的违规就再也扫不到。
 *
 * 递归本身由 `tests/helpers/source-scan.test.ts` 用临时目录证明，不需要往 `src/` 里放夹具。
 */

export interface ScannedFile {
  /** 相对被扫描根目录的路径，用于失败消息。 */
  relativePath: string;
  absolutePath: string;
  source: string;
}

/** 递归列出 `rootDir` 下所有 `.ts` 文件（跳过 `.tsx`、`node_modules` 与隐藏目录）。 */
export function collectTypeScriptFiles(rootDir: string): ScannedFile[] {
  const found: ScannedFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push({
          relativePath: relative(rootDir, absolutePath),
          absolutePath,
          source: readFileSync(absolutePath, 'utf8'),
        });
      }
    }
  };

  walk(rootDir);

  return found;
}

/** 返回命中 `needle` 的文件（相对路径），空数组表示干净。 */
export function findFilesContaining(files: readonly ScannedFile[], needle: string): string[] {
  return files.filter((file) => file.source.includes(needle)).map((file) => file.relativePath);
}
