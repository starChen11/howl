import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, run } from './helpers/run';

/**
 * RFC-001 AC-2 / AC-3 / AC-4。
 *
 * AC-4 的字面要求「五个严格开关任一项被关闭时 `pnpm typecheck` 会报错」在逻辑上不成立：
 * 类型检查的严格开关是单向的，打开只增加错误、关闭只减少错误，所以「关闭 → 报错」永远
 * 不会发生。实测（TypeScript 6.0.3）：`strict: true` + 另外四个全关 → 退出码 0；
 * 五个全关 → 退出码 0。
 *
 * 因此这里用**两向夹具**证明同样的事，而且更严格：为每个开关准备一个「只有在开启时才
 * 违规」的夹具，开启时编译必须失败，关闭时必须通过。这既证明了开关生效，也证明了开关
 * 是有实际约束力的。文档措辞的缺陷已登记为 RFCS.md 的 C-11。
 */

interface TsConfigFile {
  compilerOptions?: Record<string, unknown>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8')) as T;
}

const STRICT_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'verbatimModuleSyntax',
] as const;

const FIXTURES = join(REPO_ROOT, 'tests', 'meta', 'fixtures');
const TSC_JS = join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');

const ALL_FLAGS_ON: Record<string, boolean> = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  verbatimModuleSyntax: true,
};

interface FlagCase {
  readonly flag: (typeof STRICT_FLAGS)[number];
  readonly fixture: string;
  /** 关闭该开关时的附加改动：`strict` 一关，依赖它的两个选项必须同时关，否则会撞 TS5052。 */
  readonly disable: Record<string, boolean>;
}

const FLAG_CASES: readonly FlagCase[] = [
  {
    flag: 'strict',
    fixture: 'strict.ts',
    disable: {
      strict: false,
      exactOptionalPropertyTypes: false,
      noUncheckedIndexedAccess: false,
    },
  },
  {
    flag: 'noUncheckedIndexedAccess',
    fixture: 'no-unchecked-indexed-access.ts',
    disable: { noUncheckedIndexedAccess: false },
  },
  {
    flag: 'exactOptionalPropertyTypes',
    fixture: 'exact-optional-property-types.ts',
    disable: { exactOptionalPropertyTypes: false },
  },
  {
    flag: 'noImplicitOverride',
    fixture: 'no-implicit-override.ts',
    disable: { noImplicitOverride: false },
  },
  {
    flag: 'verbatimModuleSyntax',
    fixture: 'verbatim-module-syntax.ts',
    disable: { verbatimModuleSyntax: false },
  },
];

/** 把夹具复制到临时目录，用给定的开关组合编译一次，返回 tsc 的输出与退出码。 */
async function compileFixture(
  fixture: string,
  overrides: Record<string, boolean>,
): Promise<{ code: number; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'howl-flag-'));

  try {
    for (const name of readdirSync(FIXTURES)) {
      copyFileSync(join(FIXTURES, name), join(dir, name));
    }

    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        noEmit: true,
        ...ALL_FLAGS_ON,
        ...overrides,
      },
      files: [fixture],
    };
    writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);

    const result = await run('node', [TSC_JS, '-p', join(dir, 'tsconfig.json')]);
    return { code: result.code, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('AC-2 · package.json 的运行时契约', () => {
  const pkg = readJson<{
    packageManager?: string;
    type?: string;
    engines?: { node?: string };
  }>('package.json');

  it('锁定了 pnpm 版本（OPS-1）', () => {
    expect(pkg.packageManager).toBe('pnpm@10.33.0');
  });

  it('声明了 Node 版本下限（OPS-5）', () => {
    expect(pkg.engines?.node).toBe('>=22.13.0');
  });

  it('模块格式为 ESM', () => {
    expect(pkg.type).toBe('module');
  });
});

describe('AC-3 · 三份 tsconfig', () => {
  it('三份配置都存在', () => {
    for (const file of ['tsconfig.json', 'tsconfig.server.json', 'tsconfig.client.json']) {
      expect(existsSync(join(REPO_ROOT, file)), `缺少 ${file}`).toBe(true);
    }
  });

  it('typecheck 使用的模式为 bundler + ES2022', () => {
    const root = readJson<TsConfigFile>('tsconfig.json');

    expect(root.compilerOptions?.moduleResolution).toBe('bundler');
    expect(root.compilerOptions?.target).toBe('ES2022');
  });

  it('子配置继承根配置，只覆盖 include / lib / types', () => {
    for (const file of ['tsconfig.server.json', 'tsconfig.client.json']) {
      const config = readJson<TsConfigFile & { extends?: string }>(file);

      expect(config.extends).toBe('./tsconfig.json');
      expect(config.compilerOptions?.moduleResolution).toBeUndefined();
      expect(config.compilerOptions?.target).toBeUndefined();
    }
  });

  it('server 配置不含 DOM，client 配置不含 Node 类型', () => {
    const server = readJson<TsConfigFile>('tsconfig.server.json');
    const client = readJson<TsConfigFile>('tsconfig.client.json');

    expect(server.compilerOptions?.lib).toEqual(['ES2022']);
    expect(client.compilerOptions?.lib).toEqual(['ES2022', 'DOM', 'DOM.Iterable']);
    expect(client.compilerOptions?.types).toEqual([]);
  });
});

describe('AC-4 · 五个严格开关', () => {
  it('root tsconfig 把五个开关全部打开', () => {
    const root = readJson<TsConfigFile>('tsconfig.json');

    for (const flag of STRICT_FLAGS) {
      expect(root.compilerOptions?.[flag], `${flag} 未开启`).toBe(true);
    }
  });

  for (const { flag, fixture, disable } of FLAG_CASES) {
    it(`${flag} 开启时夹具编译失败、关闭时通过`, async () => {
      const on = await compileFixture(fixture, {});
      expect(on.code, `开启 ${flag} 时 ${fixture} 本应编译失败：\n${on.output}`).not.toBe(0);
      expect(on.output).toContain('error TS');

      const off = await compileFixture(fixture, disable);
      expect(off.code, `关闭 ${flag} 时 ${fixture} 本应通过：\n${off.output}`).toBe(0);
      expect(off.output).not.toContain('error TS');
    });
  }
});
