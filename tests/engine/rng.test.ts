import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { initialStateFromSeed, nextInt, nextRandom, shuffle } from '@engine/rng';

/**
 * AC-13 与随机源的确定性（DATA-4 / DATA-5 / F38）。
 *
 * 最有价值的是最后一条：**扫描源码断言没有 `Math.random(`**。随机源一旦绕过 `RngState`，
 * 一局就再也重放不出来，而且不会有任何测试因此变红——除非有人主动去扫。
 */

const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));

function engineSources(): { file: string; source: string }[] {
  return readdirSync(ENGINE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => {
      const file = join(ENGINE_DIR, entry.name);
      return { file, source: readFileSync(file, 'utf8') };
    });
}

describe('AC-13 · 引擎不得使用 Math.random', () => {
  it('src/engine 下没有任何 Math.random( 调用', () => {
    const offenders = engineSources()
      .filter(({ source }) => source.includes('Math.random('))
      .map(({ file }) => relative(ENGINE_DIR, file));

    expect(offenders).toEqual([]);
  });

  it('扫描确实读到了文件（防止断言因为走空而假通过）', () => {
    expect(engineSources().length).toBeGreaterThan(5);
  });
});

describe('随机源的确定性', () => {
  it('同种子两次抽出的序列相等', () => {
    const draw = (): number[] => {
      let rng = initialStateFromSeed(1234);
      const values: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const next = nextRandom(rng);
        rng = next.rng;
        values.push(next.value);
      }
      return values;
    };

    expect(draw()).toEqual(draw());
  });

  it('不同种子抽出不同序列', () => {
    const first = nextRandom(initialStateFromSeed(1)).value;
    const second = nextRandom(initialStateFromSeed(2)).value;

    expect(first).not.toBe(second);
  });

  it('nextRandom 的值落在 [0, 1)', () => {
    let rng = initialStateFromSeed(7);
    for (let i = 0; i < 50; i += 1) {
      const next = nextRandom(rng);
      rng = next.rng;
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(1);
    }
  });

  it('nextInt 的值落在 [0, max)', () => {
    let rng = initialStateFromSeed(99);
    for (let i = 0; i < 50; i += 1) {
      const next = nextInt(rng, 9);
      rng = next.rng;
      expect(Number.isInteger(next.value)).toBe(true);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(9);
    }
  });

  it('nextInt 的非法上界抛 RangeError', () => {
    const rng = initialStateFromSeed(1);

    expect(() => nextInt(rng, 0)).toThrow(RangeError);
    expect(() => nextInt(rng, -3)).toThrow(RangeError);
    expect(() => nextInt(rng, 2.5)).toThrow(RangeError);
  });

  it('非整数种子抛 RangeError', () => {
    expect(() => initialStateFromSeed(1.5)).toThrow(RangeError);
  });

  it('洗牌是排列、可复现、且不改入参', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const snapshot = [...items];

    const first = shuffle(initialStateFromSeed(42), items);
    const second = shuffle(initialStateFromSeed(42), items);

    expect(first.items).toEqual(second.items);
    expect([...first.items].sort((a, b) => a - b)).toEqual(snapshot);
    expect(items).toEqual(snapshot);
    expect(first.rng).toEqual(second.rng);
  });

  it('洗牌确实推进了生成器状态', () => {
    const before = initialStateFromSeed(42);
    const shuffled = shuffle(before, [1, 2, 3, 4, 5]);

    expect(shuffled.rng).not.toEqual(before);
  });
});
