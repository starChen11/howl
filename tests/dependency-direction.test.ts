import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * RFC-001 AC-10 / AC-11：依赖方向。
 *
 * 用静态扫描源码里的 import 说明符，不依赖打包器解析——这样即使某个别名配置错了、
 * 模块只是「碰巧」能加载，方向违规仍然会被拦下。
 *
 * 注意：`src/engine/` 在本 RFC 阶段还不存在（RFC-002 才建），相关断言在无文件时
 * 恒真。这不是放水，而是「有文件之后一定会被检查」的守卫。
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

type Layer = 'shared' | 'engine' | 'server' | 'client';

const ALIAS_LAYER: Record<string, Layer> = {
  '@shared/': 'shared',
  '@engine/': 'engine',
  '@server/': 'server',
  '@client/': 'client',
};

/**
 * 允许的跨层引用。
 *
 * `engine` 与 `shared` 的外部依赖只允许 `zod`——比 AC-11 更严一档，用来落实 ARCH-1
 * （引擎不得 import 网络库、UI 或 DOM 类型）。
 */
const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  shared: [],
  engine: ['shared'],
  server: ['engine', 'shared'],
  client: ['shared'],
};

const ALLOWED_EXTERNALS: Record<Layer, readonly string[]> = {
  shared: ['zod'],
  engine: ['zod'],
  server: ['fastify', '@fastify/static', '@fastify/cookie', 'openai', 'zod'],
  client: ['react', 'react-dom', 'zod'],
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

function layerOf(absolutePath: string): Layer | null {
  const rel = relative(SRC, absolutePath).split(sep);
  const first = rel[0];
  if (first === 'shared' || first === 'engine' || first === 'server' || first === 'client') {
    return first;
  }
  return null;
}

/** 收集 `from 'x'` 与 `import 'x'` 两类说明符，去重。 */
function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [/\bfrom\s+['"]([^'"]+)['"]/g, /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function sourceFiles(): { file: string; layer: Layer; specifiers: string[] }[] {
  return walk(SRC).flatMap((file) => {
    const layer = layerOf(file);
    if (layer === null) return [];
    return [{ file, layer, specifiers: importSpecifiers(readFileSync(file, 'utf8')) }];
  });
}

function displayPath(file: string): string {
  return relative(resolve(SRC, '..'), file);
}

/** 说明符 → 包名。作用域包（`@fastify/static`）要取两段，否则会被当成 `@fastify`。 */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  const first = parts[0] ?? specifier;
  if (first.startsWith('@') && parts.length > 1) {
    return `${first}/${parts[1] ?? ''}`;
  }
  return first;
}

describe('AC-10 / AC-11 · 依赖方向', () => {
  const files = sourceFiles();

  it('扫描到了源文件（防止测试因为走空而假通过）', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((entry) => entry.layer === 'shared')).toBe(true);
    expect(files.some((entry) => entry.layer === 'server')).toBe(true);
    expect(files.some((entry) => entry.layer === 'client')).toBe(true);
  });

  it('跨层引用只走别名，且只允许白名单方向', () => {
    const violations: string[] = [];

    for (const { file, layer, specifiers } of files) {
      for (const specifier of specifiers) {
        const aliasEntry = Object.entries(ALIAS_LAYER).find(([prefix]) =>
          specifier.startsWith(prefix),
        );
        if (aliasEntry === undefined) continue;

        const targetLayer = aliasEntry[1];
        if (!ALLOWED_LAYERS[layer].includes(targetLayer)) {
          violations.push(`${displayPath(file)} 引用了 ${specifier}（${layer} → ${targetLayer}）`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('相对路径不得跨层逃逸', () => {
    const violations: string[] = [];

    for (const { file, layer, specifiers } of files) {
      for (const specifier of specifiers) {
        if (!specifier.startsWith('.')) continue;
        const resolved = resolve(dirname(file), specifier);
        const targetLayer = layerOf(resolved);
        if (targetLayer !== null && targetLayer !== layer) {
          violations.push(
            `${displayPath(file)} 用相对路径跨到了 ${targetLayer}（${specifier}），请改用别名`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('每层的外部依赖都在白名单内（shared 除 zod 外无运行时依赖）', () => {
    const violations: string[] = [];

    for (const { file, layer, specifiers } of files) {
      for (const specifier of specifiers) {
        if (specifier.startsWith('.')) continue;
        if (Object.keys(ALIAS_LAYER).some((prefix) => specifier.startsWith(prefix))) continue;

        // Node 内置模块只有服务端可以用：shared 必须保持纯类型，client 跑在浏览器里。
        if (specifier.startsWith('node:')) {
          if (layer !== 'server') {
            violations.push(
              `${displayPath(file)} 依赖了 ${specifier}（${layer} 层不能用 Node 内置模块）`,
            );
          }
          continue;
        }

        const packageName = packageNameOf(specifier);
        if (!ALLOWED_EXTERNALS[layer].includes(packageName)) {
          violations.push(`${displayPath(file)} 依赖了 ${packageName}（${layer} 层不允许）`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('shared 不引用任何其它层（AC-10）', () => {
    const sharedFiles = files.filter((entry) => entry.layer === 'shared');
    expect(sharedFiles.length).toBeGreaterThan(0);

    const forbidden = sharedFiles.flatMap(({ file, specifiers }) =>
      specifiers
        .filter(
          (specifier) =>
            specifier.startsWith('@engine/') ||
            specifier.startsWith('@server/') ||
            specifier.startsWith('@client/'),
        )
        .map((specifier) => `${displayPath(file)} → ${specifier}`),
    );

    expect(forbidden).toEqual([]);
  });
});
