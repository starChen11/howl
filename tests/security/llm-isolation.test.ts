import { describe, expect, it } from 'vitest';

import { collectTypeScriptFiles, findFilesContaining } from '../helpers/source-scan';

/**
 * AC-1 / AC-2 / AC-13：LLM 接入的隔离性。
 *
 * 三条都是「谁能碰什么」的静态约束：
 * - `api.deepseek.com` 只许出现在 `client.ts`（否则有一条绕过统一调用的路径）；
 * - `DEEPSEEK_API_KEY` 只许被 `config.ts` 读（否则密钥会散到各处）；
 * - 模型名只许出现在 `config.ts`（业务代码硬编码模型会让换模型变成全仓 grep）。
 */

const SRC = 'src';

function files() {
  return collectTypeScriptFiles(SRC);
}

describe('AC-1 · API 端点只在一处', () => {
  it('api.deepseek.com 只出现在 client.ts', () => {
    const hits = findFilesContaining(files(), 'api.deepseek.com');

    expect(hits.length).toBeGreaterThan(0);
    for (const path of hits) {
      expect(['server/llm/client.ts']).toContain(path);
    }
  });
});

describe('AC-2 · 密钥只被 config.ts 读取', () => {
  it('DEEPSEEK_API_KEY 只出现在 config.ts 与测试/文档之外', () => {
    const hits = findFilesContaining(files(), 'DEEPSEEK_API_KEY');

    expect(hits).toEqual(['server/llm/config.ts']);
  });

  it('src/client/ 与密钥字符串无关', () => {
    const clientFiles = files().filter((file) => file.relativePath.startsWith('client/'));

    for (const file of clientFiles) {
      expect(file.source).not.toContain('DEEPSEEK_API_KEY');
      expect(file.source).not.toContain('api.deepseek.com');
    }
  });
});

describe('AC-13 · 模型名只在配置里', () => {
  it('deepseek-flash 字面量只出现在 config.ts 与提示词无关的文件', () => {
    const hits = findFilesContaining(files(), 'deepseek-flash');

    expect(hits).toEqual(['server/llm/config.ts']);
  });
});
