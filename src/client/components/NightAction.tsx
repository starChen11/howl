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
  waiting = false,
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
  wolfVotes: { seat: number; target: number }[];
  /** 自己已投票、等队友：面板保留但只读。 */
  waiting?: boolean;
  onChat: (text: string) => void;
  onTarget: (target: number) => void;
  onWitch: (choice: 'none' | `heal:${number}` | `poison:${number}`) => void;
}) {
  if (pending === 'chat') {
    return (
      <section className="night" aria-label={`${ROLE_LABELS.wolf}队讨论`}>
        <p className="night__hint">和队友说一句（不说也行）。</p>
        {wolfChats.length === 0 ? null : (
          <ul className="night__chat-log" aria-label="狼队消息">
            {wolfChats.map((chat, index) => (
              <li key={`${chat.seat}-${index}`}>
                {chat.seat} 号：{chat.text === '' ? '（没说话）' : chat.text}
              </li>
            ))}
          </ul>
        )}
        <form
          className="night__chat"
          onSubmit={(event) => {
            event.preventDefault();
            const text = new FormData(event.currentTarget).get('wolf-chat');
            onChat(typeof text === 'string' ? text : '');
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
          <button type="button" className="button" onClick={() => onChat('')}>
            跳过
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
    return (
      <section className="night" aria-label={`${ROLE_LABELS.wolf}队投票`}>
        <p className="night__hint">
          {isRunoff
            ? '平票了，只能投并列者（且不能弃权）。'
            : '狼队投票决定今晚刀谁；票型只有狼看得到。'}
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
          <ul className="night__chat-log" aria-label="当前票型">
            {wolfVotes.map((vote, index) => (
              <li key={`${vote.seat}-${index}`}>
                {vote.seat} 号投 {vote.target} 号
              </li>
            ))}
          </ul>
        )}
        {waiting ? <p className="night__hint">你已投票，等待队友…</p> : null}
        <div className="night__buttons">
          {targets.map((seat) => (
            <button
              key={seat}
              type="button"
              className="button"
              disabled={waiting}
              onClick={() => onTarget(seat)}
            >
              投 {seat} 号
            </button>
          ))}
        </div>
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
