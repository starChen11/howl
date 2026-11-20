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
  onChat,
  onTarget,
  onWitch,
}: {
  pending: 'chat' | 'kill' | 'check' | 'witch';
  targets: number[];
  potions: { heal: 'available' | 'used'; poison: 'available' | 'used' };
  /** 用药者看到的刀口（没有则为 null）。 */
  killTarget: number | null;
  onChat: (text: string) => void;
  onTarget: (target: number) => void;
  onWitch: (choice: 'none' | `heal:${number}` | `poison:${number}`) => void;
}) {
  if (pending === 'chat') {
    return (
      <section className="night" aria-label={`${ROLE_LABELS.wolf}队讨论`}>
        <p className="night__hint">和队友说一句（不说也行）。</p>
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

  const verb = pending === 'kill' ? TERMS.knife.label : TERMS.check.label;
  return (
    <section
      className="night"
      aria-label={pending === 'kill' ? `${ROLE_LABELS.wolf}刀人` : `${ROLE_LABELS.seer}查验`}
    >
      <p className="night__hint">选择今晚要{verb}的人。</p>
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
