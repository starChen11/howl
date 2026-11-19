import { describe, expect, it } from 'vitest';

import { project } from '@server/project';
import { buildUserMessage } from '@server/llm/prompts/base';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';

/**
 * RFC-013 §5 AC-13 / AC-14：记事板不得进入投影与 AI 上下文。
 *
 * 服务端**根本没有**记事板这个概念：它只存在浏览器 `localStorage`。这条用例把
 * 「根本没有」变成可断言的事实——如果有人未来把记事板塞进投影，这里会红。
 */

const NOTEPAD_MARKER = '这是我写在记事板里的内容：3 号可疑';

describe('AC-13 / AC-14 · 记事板与投影、提示词隔离', () => {
  it('投影与提示词里都不出现记事板文本', () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    return (async () => {
      const session = await registry.createSession();
      const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });
      const ctx = project({
        state: registry.stateOf(record),
        events: record.events,
        observer: record.playerSeat,
        pending: null,
      });

      // 1) 投影序列化后不含记事板文本（也没有 notepad 字段）
      const serialized = JSON.stringify(ctx);
      expect(serialized).not.toContain(NOTEPAD_MARKER);
      expect(serialized.toLowerCase()).not.toContain('notepad');

      // 2) 提示词里同样不含
      const prompt = buildUserMessage(ctx);
      expect(prompt).not.toContain(NOTEPAD_MARKER);
    })();
  });

  it('服务端源码里没有记事板的内存/存储字段', async () => {
    const { collectTypeScriptFiles } = await import('../helpers/source-scan');
    const files = collectTypeScriptFiles('src/server');
    const offenders = files
      .filter((file) => /notepad/i.test(file.source))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });
});
