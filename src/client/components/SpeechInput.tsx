import { useState } from 'react';

import { SPEECH_MAX_CHARS, charCount } from '@shared/speech';

/**
 * 玩家输入区（RFC-011 §2.2 / RFC-012 §2.2 / RFC-022 §7）。
 *
 * - 300 字上限按 Unicode 算（与后端同一函数）；
 * - 引导提示**不代填**；
 * - 倒计时只是显示，服务端才是权威；
 * - 竞选发言、PK 发言与警长归票发言复用同一个输入框，只换标题与提示（不复制一套逻辑）。
 */
export function SpeechInput({
  remaining,
  onSubmit,
  onSkip,
  onDraft,
  heading = '你的发言',
  hint = '可以说说：你怀疑谁、为什么；你相信谁、为什么。',
  submitLabel = '发言',
  skipLabel = '过',
}: {
  remaining: number;
  onSubmit: (text: string) => void;
  onSkip: () => void;
  /** 草稿同步（节流由调用方负责）。 */
  onDraft?: (text: string) => void;
  /** 输入区标题。竞选 / PK / 归票会传入不同的标题。 */
  heading?: string;
  /** 输入区提示。 */
  hint?: string;
  submitLabel?: string;
  skipLabel?: string;
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
        {heading}
      </label>
      <p className="input__meta">
        {count}/{SPEECH_MAX_CHARS} 字 · {remaining} 秒
      </p>
      <p className="input__hint" id="speech-hint">
        {hint}
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
          {submitLabel}
        </button>
        <button type="button" className="button" onClick={onSkip}>
          {skipLabel}
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
