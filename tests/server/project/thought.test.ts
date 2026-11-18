import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';
import type { GameEvent } from '@shared/events';

import { applyEvent } from '@engine/apply';
import { replay } from '@engine/replay';
import { project } from '@server/project';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../../fixtures/states';

/**
 * AC-15：`AI_THOUGHT` 只对该席位可见，且不破坏投影与重放（C-41）。
 *
 * 这条以前没有测试：把 `applyEvent` 里整个 `AI_THOUGHT` 分支删掉，全套 400 个用例照样
 * 全绿——因为没有任何用例把它喂进事件流。
 */

function gameWithThought(): { events: GameEvent[]; thought: GameEvent } {
  const lobby = lobbyState({ seed: 20_261_117 });
  // 用真实开局事件做前缀，再追加一条 AI_THOUGHT（模拟 AI 决策产生的事件）。
  const first = step(lobby, startActionOf(lobby, 1));

  const thought = {
    gameId: first.state.gameId,
    seq: first.events.length + 1,
    ts: 2,
    type: 'AI_THOUGHT',
    visibleTo: 'self:3',
    payload: { reason: '我觉得 2 号像狼', decisionSeq: 1 },
  } as unknown as GameEvent;

  return { events: [...first.events, thought], thought };
}

describe('AC-15 · AI_THOUGHT 的可见性与折叠', () => {
  it('applyEvent 不抛错，replay 能重建', () => {
    const { events } = gameWithThought();

    expect(() => replay(events)).not.toThrow();
  });

  it('只有该席位看得到它', () => {
    const { events, thought } = gameWithThought();
    const state = replay(events);

    for (const observer of SEAT_IDS) {
      const ctx = project({ state, events, observer, pending: null });
      const visible = [...ctx.publicEvents, ...ctx.privateEvents].some(
        (event) => event.seq === thought.seq,
      );
      expect(visible, `observer=${observer}`).toBe(observer === 3);
    }
  });

  it('它不会出现在 publicEvents 里，也不会改变状态', () => {
    const { events, thought } = gameWithThought();
    const state = replay(events);
    const ctx = project({ state, events, observer: 3 as SeatId, pending: null });

    expect(ctx.publicEvents.some((event) => event.seq === thought.seq)).toBe(false);
    expect(ctx.privateEvents.some((event) => event.seq === thought.seq)).toBe(true);
    // 状态里没有承载 reason 的字段：它只以事件存在
    expect(JSON.stringify(state)).not.toContain('我觉得 2 号像狼');
  });

  it('applyEvent 对它是空折叠：折叠前后除 seq 外一致', () => {
    const { events, thought } = gameWithThought();
    const before = replay(events.slice(0, -1));
    const after = applyEvent(before, thought);

    expect(after.seq).toBe(before.seq + 1);
    expect({ ...after, seq: before.seq }).toEqual(before);
  });
});
