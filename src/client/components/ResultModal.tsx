import { useEffect, useRef } from 'react';

import type { KeyResult } from '../key-result';

/** 关键结果的醒目标注（RFC-019 之后的体验补充）。 */
export function ResultModal({ result, onClose }: { result: KeyResult; onClose: () => void }) {
  // 父组件每次轮询都会重建 onClose；自动收起的定时器不能因此反复重置。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 入夜这类信息提示自动收起，不挡后续操作；出局/终局必须自己确认。
  useEffect(() => {
    if (result.tone !== 'info') return;
    const timer = setTimeout(() => closeRef.current(), 2_000);
    return () => clearTimeout(timer);
  }, [result.seq, result.tone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="result-modal__backdrop" role="presentation" onClick={onClose}>
      <section
        className={`result-modal result-modal--${result.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
        aria-describedby="result-modal-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="result-modal-title" className="result-modal__title">
          {result.title}
        </h2>
        <p id="result-modal-body" className="result-modal__body">
          {result.body}
        </p>
        <button type="button" className="button button--primary" autoFocus onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  );
}
