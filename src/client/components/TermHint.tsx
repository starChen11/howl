import { useId, useState } from 'react';

import { TERMS } from '@shared/terms';

/**
 * 术语解释（RFC-012 §2.2）。
 *
 * 用 `aria-describedby` 而不是 `title`：`title` 在触屏与读屏上都拿不到。
 * 桌面悬停、键盘聚焦、触屏点击三种触发方式等价。
 */
export function TermHint({
  termKey,
  children,
}: {
  termKey: keyof typeof TERMS;
  children: React.ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const term = TERMS[termKey];

  return (
    <span className="term">
      <button
        type="button"
        className="term__trigger"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // 触屏没有悬停：点一下打开即可（关闭交给「失焦」或再点一次别处）。
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? (
        <span id={id} role="tooltip" className="term__hint">
          {term.label}：{term.definition}
        </span>
      ) : null}
    </span>
  );
}
