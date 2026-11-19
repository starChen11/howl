import { useState } from 'react';

import { SPEECH_MAX_CHARS, charCount } from '@shared/speech';

/**
 * 玩家输入区（RFC-011 §2.2 / RFC-012 §2.2）。
 *
 * - 300 字上限按 Unicode 算（与后端同一函数）；
 * - 引导提示**不代填**；
 * - 倒计时只是显示，服务端才是权威。
 */
export function SpeechInput({
  remaining,
  onSubmit,
  onSkip,
  onDraft,
}: {
  remaining: number;
  onSubmit: (text: string) => void;
  onSkip: () => void;
  /** 草稿同步（节流由调用方负责）。 */
  onDraft?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const count = charCount(text);
  const over = count > SPEECH_MAX_CHARS;

  return (
    <form
      className="input"
      aria-label="发言区"
      onSubmit={(event) => {
        event.preventDefault();
        if (over) return;
        const trimmed = text.trim();
        if (trimmed.length === 0) onSkip();
        else onSubmit(text);
      }}
    >
      <label className="input__label" htmlFor="speech">
        你的发言
      </label>
      <p className="input__meta">
        {count}/{SPEECH_MAX_CHARS} 字 · {remaining} 秒
      </p>
      <p className="input__hint" id="speech-hint">
        可以说说：你怀疑谁、为什么；你相信谁、为什么。
      </p>
      <textarea
        id="speech"
        className="input__box"
        aria-describedby="speech-hint"
        value={text}
        maxLength={SPEECH_MAX_CHARS + 50}
        onChange={(event) => {
          setText(event.target.value);
          onDraft?.(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter 提交、Shift+Enter 换行——否则纯键盘用户要按很多次 Tab。
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          const trimmed = text.trim();
          if (over) return;
          if (trimmed.length === 0) onSkip();
          else onSubmit(text);
        }}
      />
      <div className="input__actions">
        <button type="submit" className="button button--primary" disabled={over}>
          发言
        </button>
        <button type="button" className="button" onClick={onSkip}>
          过
        </button>
      </div>
      {over ? (
        <p className="input__error" role="alert">
          超过 {SPEECH_MAX_CHARS} 字，请删减后再发。
        </p>
      ) : null}
    </form>
  );
}
