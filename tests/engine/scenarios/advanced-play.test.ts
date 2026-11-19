import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';

import { annotate } from '@engine/annotate';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';

/**
 * RFC-009 AC-9：三类打法都能在**真实开局**的对局里触发（C-80）。
 *
 * 真实对局里 `AI_THOUGHT` 由服务端产出（RFC-006），引擎只负责「这条声称合不合法」。
 * 所以这里用真实 `step` 开局 + 真实 `SELF_EXPOSE`，再按 RFC-006 的形状注入三条
 * `AI_THOUGHT`（模拟三只 wolf 各跳一次 / 各指认一次），最后跑标注。
 */

function startGame(seed = 20_261_117) {
  const lobby = lobbyState({ seed });
  return step(lobby, startActionOf(lobby, 1));
}

function thought(seq: number, seat: SeatId, claim: Record<string, unknown>): EventEnvelope {
  return {
    gameId: 'g',
    seq,
    ts: 0,
    type: 'AI_THOUGHT',
    visibleTo: `self:${seat}`,
    payload: { reason: '', claim, decisionSeq: seq },
  } as unknown as EventEnvelope;
}

describe('AC-9 · 真实对局里的三类打法各能触发至少 3 次', () => {
  it('三只 wolf 各悍跳一次、各查杀同伴一次，再加三次自曝', () => {
    const { state, events } = startGame();
    const wolves = state.seats
      .filter((seat) => seat.alive && seat.role === 'wolf')
      .map((seat) => seat.seat);
    if (wolves.length !== 3) throw new Error('板子应有 3 只 wolf');

    const injected: EventEnvelope[] = [];
    let seq = events.length + 1;

    for (const wolf of wolves) {
      injected.push(thought(seq, wolf, { role: 'seer', checks: [{ target: 6, result: 'wolf' }] }));
      seq += 1;
    }
    for (let index = 0; index < wolves.length; index += 1) {
      const speaker = wolves[index] as SeatId;
      const target = wolves[(index + 1) % wolves.length] as SeatId;
      injected.push(thought(seq, speaker, { accuses: [{ target, as: 'wolf' }] }));
      seq += 1;
    }

    // 三次自曝：用真实 step（相位设成白天，避免把整夜走完）
    const day = { ...state, phase: 'DAY_SPEECH' as const };
    const exposed: EventEnvelope[] = [];
    let dayCursor = day;
    for (const wolf of wolves) {
      const result = step(dayCursor, { type: 'SELF_EXPOSE', ts: 1, seat: wolf });
      exposed.push(...result.events);
      dayCursor = { ...dayCursor, phase: 'DAY_SPEECH' as const };
    }

    const marks = annotate({
      events: [...events, ...injected, ...exposed],
      state: day,
      speakerOf: (event) => {
        const match = /^self:(\d)$/.exec(String((event as { visibleTo?: string }).visibleTo));
        return match === null ? undefined : (Number(match[1]) as SeatId);
      },
    });

    const count = (kind: string) => marks.filter((mark) => mark.kind === kind).length;

    expect(count('fake-seer-claim')).toBeGreaterThanOrEqual(3);
    expect(count('wolf-accuses-wolf')).toBeGreaterThanOrEqual(3);
    expect(count('self-expose')).toBeGreaterThanOrEqual(3);
  });
});
