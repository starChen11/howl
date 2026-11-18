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

/**
 * 把路径里的分隔符统一成 POSIX 的 `/`。
 *
 * 为什么必须做：`path.relative` 在 Windows 返回 `nested\\violation.ts`，而断言与失败消息
 * 里写的是 `nested/violation.ts`——不归一化，同一份测试在 Windows 上必红（评审 B-R2-1）。
 *
 * 为什么兼容两种分隔符而不是只处理 `path.sep`：这样这条归一化在 macOS 上也能被测试
 * （喂一个 Windows 风格的字符串），不必等到有人在 Windows 上跑才发现它写错了。
 * POSIX 上文件名里出现反斜杠是病态情形，本项目不依赖它。
 */
export function toPosixPath(path: string): string {
  return path.split(/[\\/]/).join('/');
}

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
      if (entry.name === 'node_modules') continue;
      // 只跳过隐藏**目录**（工具缓存），隐藏的 `.ts` 文件是合法源码，必须扫到（C-22）。
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;

      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push({
          relativePath: toPosixPath(relative(rootDir, absolutePath)),
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
