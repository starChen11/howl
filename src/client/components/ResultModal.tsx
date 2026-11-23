import { useEffect } from 'react';

import type { KeyResult } from '../key-result';

/** 关键结果的醒目标注（RFC-019 之后的体验补充）。 */
export function ResultModal({ result, onClose }: { result: KeyResult; onClose: () => void }) {
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
