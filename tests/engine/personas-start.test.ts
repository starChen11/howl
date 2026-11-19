import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { replay } from '@engine/replay';
import { step } from '@engine/step';
import { PERSONAS, personaOf } from '@engine/personas';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * RFC-009 AC-1 / 2 / 5 / 11 的**开局路径**（C-79）。
 *
 * 之前的用例只停在 `LOBBY`：把 `GAME_STARTED.personas` 全改成 null，485 条用例照样绿。
 * 这条链必须一路走到 `step` 与 `replay`。
 */

function started(seed = 12_345) {
  const lobby = lobbyState({ seed });
  return step(lobby, startActionOf(lobby));
}

describe('AC-1 · 开局后每个 AI 席位仍持有同一个人格', () => {
  it('seats 的 personaId 与 GAME_STARTED.payload.personas 逐位一致', () => {
    const result = started();
    const event = result.events.find((candidate) => candidate.type === 'GAME_STARTED');
    if (event?.type !== 'GAME_STARTED') throw new Error('没有 GAME_STARTED');

    const fromState = result.state.seats.map((seat) => seat.personaId ?? null);
    expect(fromState).toEqual(event.payload.personas);
  });

  it('8 个 AI 各有一个人格，玩家席位为 null', () => {
    const { state } = started();
    const ai = state.seats.filter((seat) => !seat.isPlayer);
    const player = state.seats.find((seat) => seat.isPlayer);

    expect(ai).toHaveLength(8);
    expect(ai.every((seat) => typeof seat.personaId === 'string')).toBe(true);
    expect(new Set(ai.map((seat) => seat.personaId)).size).toBe(8);
    expect(player?.personaId).toBeUndefined();
  });

  it('replay 后人格不丢', () => {
    const result = started();
    const replayed = replay(result.events);

    expect(replayed.seats.map((seat) => seat.personaId ?? null)).toEqual(
      result.state.seats.map((seat) => seat.personaId ?? null),
    );
  });
});

describe('AC-2 · 人格 id 都在库里', () => {
  it('每个 personaId 都能被 personaOf 解析', () => {
    const { state } = started();
    for (const seat of state.seats) {
      if (seat.personaId === undefined) continue;
      expect(() => personaOf(seat.personaId as string)).not.toThrow();
    }
  });
});

describe('AC-5 · 标签唯一且非空', () => {
  it('12 个人格的 label 互不重复且非空', () => {
    const labels = PERSONAS.map((persona) => persona.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.length > 0)).toBe(true);
  });
});

describe('AC-10 · 人格不影响合法性', () => {
  it('同一条非法 action，在不同人格下都被拒绝', () => {
    const { state } = started();
    // 开局在 NIGHT_WOLF_CHAT：提交一个属于白天的 action 必然被拒
    const action = { type: 'VOTE', ts: 1, seat: 1 as SeatId, target: 'abstain' } as const;

    for (const personaId of ['blunt', 'careful', 'chatty']) {
      const withPersona = {
        ...state,
        seats: state.seats.map((seat) => (seat.seat === 1 ? { ...seat, personaId } : seat)),
      };
      const result = step(withPersona, action);

      expect(result.events[0]?.type, `persona=${personaId}`).toBe('REJECTED');
    }
  });
});

describe('C-79 · 整局不变（跨 action）', () => {
  it('连续几次夜聊之后，每个席位的人格仍与开局一致', () => {
    const { state } = started();
    const before = state.seats.map((seat) => seat.personaId ?? null);

    let cursor = state;
    for (let guard = 0; guard < 3 && cursor.phase === 'NIGHT_WOLF_CHAT'; guard += 1) {
      const speaker = cursor.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(cursor.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      cursor = step(cursor, { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' }).state;
    }

    expect(cursor.seats.map((seat) => seat.personaId ?? null)).toEqual(before);
  });
});
