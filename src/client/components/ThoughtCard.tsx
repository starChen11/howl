import type { ThoughtEntry } from '@shared/replay';

/**
 * 单条推理（RFC-014 §2.3）。
 *
 * 只展示结构化 `reason` 与 `claim`——这是「AI 真的在推理」的唯一可信证据。
 */
export function ThoughtCard({ thought }: { thought: ThoughtEntry }) {
  return (
    <article className="thought" aria-label={`${thought.seat} 号在第 ${thought.seq} 步的推理`}>
      <header className="thought__header">
        <span className="thought__seat">{thought.seat} 号</span>
        <span className="thought__kind">{thought.kind === 'speech' ? '发言' : thought.kind}</span>
      </header>
      <p className="thought__reason">{thought.reason}</p>
      {thought.claim === undefined ? null : (
        <p className="thought__claim">
          声称：
          {thought.claim.role === undefined ? '—' : thought.claim.role}
          {thought.claim.checks === undefined || thought.claim.checks.length === 0
            ? ''
            : `；查验 ${thought.claim.checks
                .map((check) => `${check.target} 号是${check.result === 'wolf' ? '狼' : '好人'}`)
                .join('、')}`}
          {thought.claim.accuses === undefined || thought.claim.accuses.length === 0
            ? ''
            : `；指认 ${thought.claim.accuses.map((accuse) => `${accuse.target} 号`).join('、')}`}
        </p>
      )}
    </article>
  );
}
