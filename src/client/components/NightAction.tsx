import { useEffect, useState } from 'react';

import { ROLE_LABELS, TERMS } from '@shared/terms';

/**
 * 夜间行动（玩家亲自操作）。
 *
 * 之前夜间全由脚本/模型代劳，玩家当狼时会「一觉醒来天亮了」。现在狼要发言与刀人、
 * 神职要查验或用药——目标都从投影的合法清单里选。
 */
export function NightAction({
  pending,
  targets,
  potions,
  killTarget,
  wolfChats,
  wolfVotes,
  selfConfirmed = false,
  selfSeat = 0,
  onConfirmVote,
  chatSeconds = 50,
  readyAfterSeconds = 30,
  readySeats = [],
  wolfCount = 0,
  selfReady = false,
  onReady,
  onChat,
  onTarget,
  onWitch,
}: {
  pending: 'chat' | 'kill' | 'wolf-vote' | 'wolf-runoff' | 'check' | 'witch';
  targets: number[];
  potions: { heal: 'available' | 'used'; poison: 'available' | 'used' };
  /** 用药者看到的刀口（没有则为 null）。 */
  killTarget: number | null;
  /** 狼队频道：自己和队友说过的话（只有狼看得到）。 */
  wolfChats: { seat: number; text: string }[];
  /** 狼队当前票型（只有狼看得到）。 */
  wolfVotes: { seat: number; target: number | 'abstain'; confirmed: boolean }[];
  /** 狼队投票进行中、但还轮不到自己（或自己已投）：面板保留但只读。 */
  waiting?: boolean;
  /** 自己这一票是否已经投出（用于区分错误文案）。 */
  hasVoted?: boolean;
  /** 自己的狼票是否已确认。 */
  selfConfirmed?: boolean;
  selfSeat?: number;
  onConfirmVote?: () => void;
  /** 讨论总时长（秒）。 */
  chatSeconds?: number;
  /** 多少秒后才允许点「准备完成」。 */
  readyAfterSeconds?: number;
  /** 已经准备的狼。 */
  readySeats?: number[];
  /** 本局存活狼数。 */
  wolfCount?: number;
  /** 自己是否已准备。 */
  selfReady?: boolean;
  onReady?: () => void;
  onChat: (text: string) => void;
  onTarget: (target: number) => void;
  onWitch: (choice: 'none' | `heal:${number}` | `poison:${number}`) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [pending]);

  if (pending === 'chat') {
    const remaining = Math.max(0, chatSeconds - elapsed);
    const canReady = elapsed >= readyAfterSeconds;

    return (
      <section className="night" aria-label={`${ROLE_LABELS.wolf}队讨论`}>
        <p className="night__hint">狼队讨论：还剩 {remaining} 秒，超时自动进入投票。</p>
        {wolfChats.length === 0 ? null : (
          <ul className="night__chat-log" aria-label="狼队消息">
            {wolfChats.map((chat, index) => (
              <li key={`${chat.seat}-${index}`}>
                {chat.seat} 号：{chat.text === '' ? '（没说话）' : chat.text}
              </li>
            ))}
          </ul>
        )}
        <p className="night__hint">
          已准备 {readySeats.length}/{wolfCount} 人{selfReady ? '（你已准备）' : ''}
        </p>
        {onReady === undefined ? null : (
          <button
            type="button"
            className="button"
            disabled={!canReady || selfReady}
            onClick={onReady}
          >
            {selfReady
              ? '已准备，等待队友'
              : canReady
                ? '准备完成'
                : `准备完成（${Math.max(0, readyAfterSeconds - elapsed)} 秒后可点）`}
          </button>
        )}
        <form
          className="night__chat"
          onSubmit={(event) => {
            event.preventDefault();
            const text = new FormData(event.currentTarget).get('wolf-chat');
            if (typeof text === 'string' && text.trim() !== '') onChat(text);
            event.currentTarget.reset();
          }}
        >
          <label className="sr-only" htmlFor="wolf-chat">
            狼队讨论
          </label>
          <input id="wolf-chat" name="wolf-chat" className="input" autoComplete="off" />
          <button type="submit" className="button">
            说
          </button>
        </form>
      </section>
    );
  }

  if (pending === 'witch') {
    return (
      <section className="night" aria-label={`${ROLE_LABELS.witch}用药`}>
        <p className="night__hint">
          今晚的刀口是 {killTarget === null ? '没人' : `${killTarget} 号`}。
        </p>
        <div className="night__buttons">
          {potions.heal === 'available' && killTarget !== null ? (
            <button type="button" className="button" onClick={() => onWitch(`heal:${killTarget}`)}>
              用解药救 {killTarget} 号
            </button>
          ) : null}
          {potions.poison === 'available'
            ? targets.map((seat) => (
                <button
                  key={`poison-${seat}`}
                  type="button"
                  className="button"
                  onClick={() => onWitch(`poison:${seat}`)}
                >
                  用毒药毒 {seat} 号
                </button>
              ))
            : null}
          <button type="button" className="button" onClick={() => onWitch('none')}>
            不用药
          </button>
        </div>
      </section>
    );
  }

  if (pending === 'wolf-vote' || pending === 'wolf-runoff') {
    const isRunoff = pending === 'wolf-runoff';
    const ownVote = wolfVotes.find((vote) => vote.seat === selfSeat);

    return (
      <section className="night" aria-label={`${ROLE_LABELS.wolf}队投票`}>
        <p className="night__hint">
          {isRunoff
            ? '平票了，只能投并列者（且不能弃权）。'
            : '狼队投票决定今晚刀谁；票型只有狼看得到。'}
          {selfConfirmed ? '' : ` 还剩 ${Math.max(0, 10 - elapsed)} 秒。`}
        </p>
        {wolfChats.length === 0 ? null : (
          <ul className="night__chat-log" aria-label="狼队消息">
            {wolfChats.map((chat, index) => (
              <li key={`${chat.seat}-${index}`}>
                {chat.seat} 号：{chat.text === '' ? '（没说话）' : chat.text}
              </li>
            ))}
          </ul>
        )}
        {wolfVotes.length === 0 ? null : (
          <p className="night__hint" aria-live="polite">
            已确认 {wolfVotes.filter((vote) => vote.confirmed).length}/{wolfCount} 票
          </p>
        )}
        {wolfVotes.length === 0 ? null : (
          <ul className="night__chat-log" aria-label="当前票型">
            {wolfVotes.map((vote, index) => (
              <li key={`${vote.seat}-${index}`}>
                {vote.seat} 号
                {vote.confirmed
                  ? vote.target === 'abstain'
                    ? '已确认弃权'
                    : `已确认投 ${vote.target} 号`
                  : vote.target === 'abstain'
                    ? '想弃权（未确认）'
                    : `想投 ${vote.target} 号（未确认）`}
              </li>
            ))}
          </ul>
        )}
        {selfConfirmed ? (
          <p className="night__hint">
            你已确认
            {ownVote?.target === 'abstain' ? '弃权' : `投 ${ownVote?.target ?? '?'} 号`}
            ，不能再改。
          </p>
        ) : (
          <>
            <p className="night__hint">
              {ownVote === undefined
                ? '先选一个目标；确认前可以改。'
                : ownVote.target === 'abstain'
                  ? '当前选择：弃权（未确认）'
                  : `当前选择：${ownVote.target} 号（未确认）`}
            </p>
            <div className="night__buttons">
              {targets.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={`button${ownVote?.target === seat ? ' button--selected' : ''}`}
                  onClick={() => onTarget(seat)}
                >
                  选 {seat} 号
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={ownVote === undefined}
              onClick={() => onConfirmVote?.()}
            >
              确认
            </button>
          </>
        )}
      </section>
    );
  }

  const verb = pending === 'kill' ? TERMS.knife.label : TERMS.check.label;
  return (
    <section
      className="night"
      aria-label={pending === 'kill' ? `${ROLE_LABELS.wolf}刀人` : `${ROLE_LABELS.seer}查验`}
    >
      {pending === 'kill' ? (
        <>
          <p className="night__hint">
            狼队今晚只有一刀：<strong>你选谁，今晚就刀谁</strong>。
          </p>
        </>
      ) : (
        <p className="night__hint">选择今晚要{verb}的人。</p>
      )}
      <div className="night__buttons">
        {targets.map((seat) => (
          <button key={seat} type="button" className="button" onClick={() => onTarget(seat)}>
            {verb} {seat} 号
          </button>
        ))}
      </div>
    </section>
  );
}
