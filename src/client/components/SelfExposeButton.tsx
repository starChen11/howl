import { useState } from 'react';

import { ROLE_LABELS } from '@shared/terms';

/**
 * 自曝（RFC-005 的界面入口）。
 *
 * 规则上自曝**不要求轮到自己发言**，但后果很重：当日立即结束、投票取消。
 * 所以这里要两步确认，避免误点。
 */
export function SelfExposeButton({ onExpose }: { onExpose: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="button button--danger" onClick={() => setConfirming(true)}>
        自曝身份（{ROLE_LABELS.wolf}）
      </button>
    );
  }

  return (
    <span className="self-expose__confirm" role="group" aria-label="确认自曝">
      <span className="self-expose__hint">自曝会让白天立即结束、投票取消。</span>
      <button type="button" className="button button--danger" onClick={onExpose}>
        确认自曝
      </button>
      <button type="button" className="button" onClick={() => setConfirming(false)}>
        取消
      </button>
    </span>
  );
}
