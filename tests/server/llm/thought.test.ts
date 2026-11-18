import { describe, expect, it } from 'vitest';

import { SEAT_IDS } from '@shared/domain';

import { project } from '@server/project';
import { toThought } from '@server/llm/thought';

import { lobbyState, startActionOf } from '../../fixtures/states';
import { step } from '@engine/step';

/**
 * AC（B2 修复）：`AI_THOUGHT` 必须真的被产出，且只对该席位可见。
 *
 * RFC-007 §8.6 把「产出」留给本 RFC；如果只定义了类型不产出，复盘里就永远没有推理。
 */

function started() {
  const lobby = lobbyState({ seed: 20_261_117 });
  const result = step(lobby, startActionOf(lobby, 1));
  return { state: result.state, events: result.events };
}

describe('AI_THOUGHT 的产出', () => {
  it('带 reason 与 decisionSeq，可见性是 self:<seat>', () => {
    const thought = toThought({
      seat: 3,
      decisionSeq: 5,
      decision: { action: 'check', target: 2, reason: '他像狼' },
    });

    expect(thought.type).toBe('AI_THOUGHT');
    expect(thought.visibleTo).toBe('self:3');
    expect(thought.payload.reason).toBe('他像狼');
    expect(thought.payload.decisionSeq).toBe(5);
  });

  it('claim 原样带入，不扁平化', () => {
    const claim = { role: 'seer' as const, checks: [{ target: 2, result: 'wolf' as const }] };
    const thought = toThought({
      seat: 1,
      decisionSeq: 1,
      decision: { action: 'speak', reason: '我是预言家', claim },
    });

    expect(thought.payload.claim).toEqual(claim);
  });

  it('只有该席位在投影里看得到它', () => {
    const { state, events } = started();
    const thought = toThought({
      seat: 3,
      decisionSeq: state.seq + 1,
      decision: { action: 'check', target: 2, reason: '他像狼' },
    });

    const full = [...events, { ...thought, gameId: state.gameId, seq: state.seq + 1, ts: 9 }];
    const replayed = project({ state, events: full as never, observer: 3, pending: null });

    for (const observer of SEAT_IDS) {
      const ctx = project({ state, events: full as never, observer, pending: null });
      const visible = [...ctx.publicEvents, ...ctx.privateEvents].some(
        (event) => event.type === 'AI_THOUGHT',
      );
      expect(visible, `observer=${observer}`).toBe(observer === 3);
    }
    expect(replayed.privateEvents.some((event) => event.type === 'AI_THOUGHT')).toBe(true);
  });
});
