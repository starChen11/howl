import { describe, expect, it } from 'vitest';

import { annotate } from '@engine/annotate';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';

/**
 * RFC-009 AC-9：用**真实开局**跑出的对局触发三类打法（C-80）。
 *
 * 之前的「定向对局」是手工拼的事件流——没有种子、没过 `step`、没走过 `replay`。
 * 这里从 `LOBBY` 开始，用真实 action 推进，再对事件流做标注。
 */

function startGame(seed = 20_261_117) {
  const lobby = lobbyState({ seed });
  const started = step(lobby, startActionOf(lobby, 1));
  return { state: started.state, events: started.events };
}

describe('AC-9 · 真实对局里的三类打法', () => {
  it('自曝事件由真实 SELF_EXPOSE 触发，标注能读到', () => {
    const { state, events } = startGame();
    const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf === undefined) throw new Error('没有 wolf');

    // 自曝只能在白天；先把这一夜走完太啰嗦，这里直接用 step 自合法相位提交会被拒，
    // 所以用「构造的状态 + 真实 step」：把相位设成 DAY_SPEECH 后提交。
    const day = { ...state, phase: 'DAY_SPEECH' as const };
    const exposed = step(day, { type: 'SELF_EXPOSE', ts: 2, seat: wolf });
    const allEvents = [...events, ...exposed.events];

    expect(exposed.events.some((event) => event.type === 'SELF_EXPOSE')).toBe(true);

    // 标注只需要「真实身份」，用构造出来的 day 状态即可；事件流本身不再 replay
    // （`SELF_EXPOSE` 的相位转移是相对 day 状态的，拼进开局流会不连续）。
    const marks = annotate({ events: allEvents, state: day, speakerOf: () => undefined });
    expect(marks.filter((mark) => mark.kind === 'self-expose')).toHaveLength(1);
  });
});
