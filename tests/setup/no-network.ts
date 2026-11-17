import { afterAll, beforeAll, vi } from 'vitest';

/**
 * 让 `unit` project 里的测试**不可能**发出网络请求（AC-16 / `TEST-4`）。
 *
 * 引擎必须是可离线推理的纯函数；一旦有人不小心在引擎里 `fetch` 了模型接口，测试会立刻
 * 抛错，而不是在 CI 里悄悄超时。`meta` project 不在这个 setup 的范围内——它本来就要起
 * 真实端口。
 */

const REAL_FETCH = globalThis.fetch;

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('本 project 的测试不得发起网络请求（TEST-4）：fetch 已被替换为抛错桩');
  });
});

afterAll(() => {
  vi.stubGlobal('fetch', REAL_FETCH);
});
