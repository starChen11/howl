import { useCallback, useEffect, useRef, useState } from 'react';

import type { PostmortemRequest, PostmortemResponse } from '@shared/postmortem';
import type { ReplaySnapshot } from '@shared/replay';

type Entry = { seat: number; target: number; question: string; answer: string };
type Phase = 'questioning' | 'voting' | 'speech' | 'done';

const SEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function PostmortemPanel({
  snapshot,
  playerSeat,
  ask,
}: {
  snapshot: ReplaySnapshot;
  playerSeat: number;
  ask: (body: PostmortemRequest) => Promise<PostmortemResponse>;
}) {
  const [phase, setPhase] = useState<Phase>('questioning');
  const [turnSeat, setTurnSeat] = useState(1);
  const [history, setHistory] = useState<Entry[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [winners, setWinners] = useState<number[]>([]);
  const [speeches, setSpeeches] = useState<Record<number, string>>({});
  const [speechDraft, setSpeechDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiTurn = useRef('');
  const askRef = useRef(ask);
  askRef.current = ask;

  const runAiQuestioning = useCallback(async () => {
    const key = `q:${turnSeat}`;
    if (aiTurn.current === key) return;
    aiTurn.current = key;
    setBusy(true);
    try {
      const generated = await askRef.current({ kind: 'questions', seat: turnSeat, history });
      if (generated.kind !== 'questions') return;
      const next: Entry[] = [];
      for (const item of generated.questions) {
        const answer = await askRef.current({
          kind: 'answer',
          seat: turnSeat,
          target: item.target,
          question: item.question,
          history: [...history, ...next],
        });
        if (answer.kind === 'answer') {
          next.push({
            seat: turnSeat,
            target: item.target,
            question: item.question,
            answer: answer.text,
          });
        }
      }
      setHistory((previous) => [...previous, ...next]);
      setTurnSeat((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '赛后对话失败');
    } finally {
      setBusy(false);
    }
  }, [history, turnSeat]);

  useEffect(() => {
    if (phase !== 'questioning' || turnSeat > 9) return;
    if (turnSeat === playerSeat) return;
    void runAiQuestioning();
  }, [phase, turnSeat, playerSeat, runAiQuestioning]);

  useEffect(() => {
    if (phase === 'questioning' && turnSeat > 9) setPhase('voting');
  }, [phase, turnSeat]);

  const askTarget = async () => {
    if (target === null || question.trim() === '') return;
    setBusy(true);
    try {
      const response = await askRef.current({
        kind: 'answer',
        seat: turnSeat,
        target,
        question: question.trim(),
        history,
      });
      if (response.kind === 'answer') {
        setHistory((previous) => [
          ...previous,
          { seat: turnSeat, target, question: question.trim(), answer: response.text },
        ]);
        setQuestion('');
        setTarget(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提问失败');
    } finally {
      setBusy(false);
    }
  };

  const finishTurn = () => {
    setTarget(null);
    setQuestion('');
    setTurnSeat((value) => value + 1);
  };

  const castVote = async (mine: number) => {
    setBusy(true);
    try {
      const candidates = SEATS.map((seat) => seat);
      const others = await Promise.all(
        candidates
          .filter((seat) => seat !== playerSeat)
          .map(async (seat) => {
            const response = await askRef.current({ kind: 'vote', seat, candidates, history });
            return response.kind === 'vote' ? ([seat, response.target] as const) : null;
          }),
      );
      const next: Record<number, number> = { [playerSeat]: mine };
      for (const pair of others) if (pair !== null) next[pair[0]] = pair[1];
      setVotes(next);
      const tally = new Map<number, number>();
      for (const seat of Object.values(next)) tally.set(seat, (tally.get(seat) ?? 0) + 1);
      const top = Math.max(0, ...tally.values());
      const topSeats = [...tally.entries()]
        .filter(([, count]) => count === top)
        .map(([seat]) => seat);
      setWinners(topSeats);
      setPhase('speech');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '投票失败');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== 'speech' || winners.length === 0) return;
    const aiWinners = winners.filter((seat) => seat !== playerSeat);
    if (aiWinners.length === 0) return;
    let cancelled = false;
    void Promise.all(
      aiWinners.map(async (seat) => {
        const response = await askRef.current({ kind: 'speech', seat, reason: '被投为最大责任人' });
        return response.kind === 'speech' ? ([seat, response.text] as const) : null;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<number, string> = {};
      for (const pair of pairs) if (pair !== null) next[pair[0]] = pair[1];
      setSpeeches(next);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, playerSeat, winners]);

  const submitSpeech = () => {
    if (speechDraft.trim() === '') return;
    setSpeeches((previous) => ({ ...previous, [playerSeat]: speechDraft.trim() }));
    setSpeechDraft('');
  };

  const label = (seat: number) => {
    const info = snapshot.seats.find((entry) => entry.seat === seat);
    return `${seat} 号${info === undefined ? '' : `·${info.roleLabel}`}`;
  };

  return (
    <section className="postmortem" aria-label="赛后拷问" aria-busy={busy}>
      <h2>赛后拷问 / 甩锅</h2>
      <p className="postmortem__hint">
        身份已经公开。按 1～9 号轮流拷问：可以问多个席位，也可以直接结束自己的回合。
        所有人问完后，大家一起投出本局“最大责任人”。
      </p>
      {error === null ? null : <p className="postmortem__error">{error}</p>}

      {phase === 'questioning' ? (
        <div className="postmortem__turn">
          <h3>轮到 {label(turnSeat)}</h3>
          {turnSeat === playerSeat ? (
            <>
              <div className="postmortem__targets">
                {SEATS.filter((seat) => seat !== playerSeat).map((seat) => (
                  <button
                    key={seat}
                    type="button"
                    className={`button${target === seat ? ' button--selected' : ''}`}
                    onClick={() => setTarget(seat)}
                  >
                    {label(seat)}
                  </button>
                ))}
              </div>
              <label className="postmortem__question">
                拷问内容
                <textarea
                  className="postmortem__box"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={2}
                  maxLength={500}
                />
              </label>
              <div className="postmortem__actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={busy || target === null || question.trim() === ''}
                  onClick={() => void askTarget()}
                >
                  提问
                </button>
                <button className="button" type="button" disabled={busy} onClick={finishTurn}>
                  结束我的拷问
                </button>
              </div>
            </>
          ) : (
            <p className="postmortem__status">{busy ? '正在思考要拷问谁…' : '等待对方发言…'}</p>
          )}
        </div>
      ) : null}

      {phase === 'questioning' && turnSeat > 9 ? <p>所有人拷问完毕，进入责任投票。</p> : null}

      {phase === 'voting' ? (
        <div className="postmortem__vote">
          <h3>投票：本局最大责任人</h3>
          <p>每个人一票，可以投自己。最高票者负责发表感想；并列则并列者共同承担。</p>
          <div className="postmortem__targets">
            {SEATS.map((seat) => (
              <button
                key={seat}
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void castVote(seat)}
              >
                投 {label(seat)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {phase === 'speech' ? (
        <div className="postmortem__result">
          <h3>最大责任人：{winners.map(label).join('、')}</h3>
          <p>
            得票：
            {Object.entries(votes)
              .map(([seat, vote]) => `${seat}→${vote}`)
              .join('，')}
          </p>
          {winners.map((seat) => (
            <article key={seat} className="postmortem__speech">
              <h4>{label(seat)} 的感想</h4>
              {seat === playerSeat ? (
                speeches[seat] === undefined ? (
                  <div>
                    <textarea
                      value={speechDraft}
                      onChange={(event) => setSpeechDraft(event.target.value)}
                      rows={3}
                      maxLength={500}
                    />
                    <button className="button button--primary" type="button" onClick={submitSpeech}>
                      发表感想
                    </button>
                  </div>
                ) : (
                  <p>{speeches[seat]}</p>
                )
              ) : (
                <p>{speeches[seat] ?? '正在酝酿感想…'}</p>
              )}
            </article>
          ))}
          <button className="button" type="button" onClick={() => setPhase('done')}>
            结束赛后环节
          </button>
        </div>
      ) : null}

      {phase === 'done' ? <p className="postmortem__status">赛后环节结束。</p> : null}

      {history.length === 0 ? null : (
        <ol className="postmortem__history">
          {history.map((entry, index) => (
            <li key={`${entry.seat}-${entry.target}-${index}`}>
              <strong>
                {label(entry.seat)} 问 {label(entry.target)}：
              </strong>
              {entry.question}
              <p>
                <span className="postmortem__answer-tag">答</span>
                {entry.answer}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
