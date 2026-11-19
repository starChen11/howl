import { useEffect, useState } from 'react';

/**
 * 局内记事板（RFC-013 §2.4）。
 *
 * 内容只存在**浏览器本地**：不进事件流、不进投影、不进提示词。
 * 这是「AI 不作弊」的一部分——玩家写给自己看的东西不该被模型看到。
 */

export function notepadKey(gameId: string): string {
  return `howl.notepad.${gameId}`;
}

export function Notepad({ gameId }: { gameId: string }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(notepadKey(gameId)) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(notepadKey(gameId), text);
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }, [gameId, text]);

  return (
    <section className="notepad" aria-label="记事板">
      <h2>记事板（只有你能看到）</h2>
      <textarea
        className="notepad__box"
        aria-label="记事板内容"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </section>
  );
}
