import { describe, expect, it } from 'vitest';

/**
 * AC-16：引擎测试期间零网络调用（`TEST-4`）。
 *
 * `fetch` 由 `tests/setup/no-network.ts` 在 `unit` project 的每个测试文件里换成抛错桩。
 * 这条测试直接证明「桩真的装上了」——否则 setup 文件写错了也没人知道，而它的失效方式
 * 恰恰是「测试全都通过」。
 */

describe('AC-16 · 网络被切断', () => {
  it('fetch 已被替换为抛错桩', () => {
    expect(() => fetch('https://example.com')).toThrow(/不得发起网络请求/);
  });

  it('全局 fetch 不再是原生实现', () => {
    expect(fetch.name).not.toBe('fetch');
  });
});
