import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ROLE_LABELS, TERMS } from '@shared/terms';

import { collectTypeScriptFiles } from '../helpers/source-scan';

/**
 * RFC-001 AC-9：`src/` 下除 `terms.ts` 之外不得出现身份名的中文字面量（UI-2 / NFR-11）。
 *
 * 身份名只能从 `src/shared/terms.ts` 的 `ROLE_LABELS` 取。这条测试是「文案单一来源」
 * 唯一可自动化的守门人：没有它，某个组件随手写下「狼人」也不会有人发现。
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const EXEMPT = join('shared', 'terms.ts');

/** 从术语表反查，避免在测试里再抄一份身份名（否则测试自己就成了第二个来源）。 */
const ROLE_WORDS = Object.values(ROLE_LABELS);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

describe('AC-9 · 身份名不得硬编码', () => {
  it('术语表里确实有身份名（防止测试因为集合为空而假通过）', () => {
    expect(ROLE_WORDS).toHaveLength(5);
  });

  it('除 terms.ts 外，src 下没有身份名字面量', () => {
    const violations: string[] = [];

    for (const file of walk(SRC)) {
      if (file.endsWith(EXEMPT)) continue;

      const source = readFileSync(file, 'utf8');
      for (const word of ROLE_WORDS) {
        if (source.includes(word)) {
          const where = relative(resolve(SRC, '..'), file);
          violations.push(`${where} 出现了硬编码身份名「${word}」`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('AC-3（RFC-012 扩展）· 术语与解释来自 terms.ts', () => {
  it('src/client 里不出现术语标签字面量（`刀` / `放逐` / `悍跳` 等）', () => {
    const files = collectTypeScriptFiles('src/client');
    const labels = Object.values(TERMS).map((term) => term.label);
    const offenders: string[] = [];

    for (const file of files) {
      for (const label of labels) {
        // 「投票」「刀」这类短词会在注释与普通叙述里出现，只拦组件里的**字符串字面量**
        // 字符串字面量：'刀' / "刀" / `刀`
        const literal = new RegExp(`['"\`]\\s*${label}\\s*['"\`]`);
        // JSX 文本节点：<span>刀</span>
        const jsxText = new RegExp(`>\\s*${label}\\s*<`);
        if (literal.test(file.source) || jsxText.test(file.source)) {
          offenders.push(`${file.relativePath}: ${label}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
