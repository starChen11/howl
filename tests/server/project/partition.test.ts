import { describe, expect, it } from 'vitest';

import type { GameState, SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
import { isVisibleTo } from '@shared/visibility';

import { applyEvent } from '@engine/apply';
import { createEmptyState } from '@engine/init';
import { step } from '@engine/step';
import { project } from '@server/project';

import { lobbyState, startActionOf } from '../../fixtures/states';

/**
 * AC-8 / AC-9：分区的**独立**验证。
 *
 * 之前的写法是「投影的自己和自己比」——把 `GAME_STARTED`（含全员身份）塞进每个观察者的
 * privateEvents，测试照样全绿。这里在测试里**独立算一遍**期望集合：按 §2.3 折叠，
 * 逐条用 `isVisibleTo` 判定，再与投影输出比。
 */

/** 跑一局，收集完整事件流。 */
function playGame(seed: number): { state: GameState; events: EventEnvelope[] } {
  let state = lobbyState({ seed });
  const events: EventEnvelope[] = [];
  let ts = 1;

  for (let guard = 0; guard < 200 && state.phase !== 'FINISHED'; guard += 1) {
    const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const pick = (list: readonly SeatId[]): SeatId => list[(seed + guard) % list.length] as SeatId;
    let action;

    switch (state.phase) {
      case 'LOBBY':
        action = startActionOf(state, ts);
        break;
      case 'NIGHT_WOLF_CHAT': {
        const speaker = state.seats.find(
          (seat) =>
            seat.alive &&
            seat.role === 'wolf' &&
            !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
        )?.seat;
        if (speaker === undefined) {
          const notReady = state.seats.find(
            (seat) =>
              seat.alive && seat.role === 'wolf' && !(state.wolfReady ?? []).includes(seat.seat),
          )?.seat;
          if (notReady === undefined) return { state, events };
          action = { type: 'WOLF_READY' as const, ts, seat: notReady };
          break;
        }
        action = { type: 'WOLF_CHAT' as const, ts, seat: speaker, text: '' };
        break;
      }
      case 'NIGHT_WOLVES': {
        const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
        const victims = state.seats
          .filter((seat) => seat.alive && seat.role !== 'wolf')
          .map((seat) => seat.seat);
        if (wolf === undefined || victims.length === 0) return { state, events };
        action = { type: 'WOLF_KILL' as const, ts, seat: wolf, target: pick(victims) };
        break;
      }
      case 'NIGHT_SEER': {
        const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
        const targets = state.seats
          .filter((seat) => seat.alive && seat.role !== 'seer')
          .map((seat) => seat.seat);
        if (seer === undefined || targets.length === 0) return { state, events };
        action = { type: 'SEER_CHECK' as const, ts, seat: seer, target: pick(targets) };
        break;
      }
      case 'NIGHT_WITCH': {
        const witch = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
        if (witch === undefined) return { state, events };
        action = { type: 'WITCH_ACT' as const, ts, seat: witch, potion: 'none' as const };
        break;
      }
      case 'NIGHT_HUNTER_SHOOT':
      case 'DAY_HUNTER_SHOOT': {
        const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
        if (hunter === undefined) return { state, events };
        action = { type: 'HUNTER_SHOOT' as const, ts, seat: hunter };
        break;
      }
      case 'DAY_SPEECH': {
        const spoken = new Set(state.speech?.spoken ?? []);
        const speaker = state.seats.find((seat) => seat.alive && !spoken.has(seat.seat))?.seat;
        if (speaker === undefined) return { state, events };
        action = { type: 'SPEECH_SKIP' as const, ts, seat: speaker };
        break;
      }
      case 'DAY_VOTE':
      case 'DAY_VOTE_RUNOFF': {
        const voter = state.seats.find(
          (seat) => seat.alive && !(state.votes ?? []).some((vote) => vote.seat === seat.seat),
        )?.seat;
        if (voter === undefined) return { state, events };
        action = {
          type: 'VOTE' as const,
          ts,
          seat: voter,
          target: state.phase === 'DAY_VOTE_RUNOFF' ? (state.runoff?.[0] as SeatId) : pick(alive),
        };
        break;
      }
      default:
        return { state, events };
    }

    const result = step(state, action);
    if (result.events[0]?.type === 'REJECTED') return { state, events };
    state = result.state;
    events.push(...result.events);
    ts += 1;
  }

  return { state, events };
}

/** 独立算一遍：按序折叠，逐条判定可见性。 */
function expectedVisibleSeqs(
  events: readonly EventEnvelope[],
  observer: SeatId,
): { publicSeqs: number[]; privateSeqs: number[] } {
  let cursor = createEmptyState();
  const publicSeqs: number[] = [];
  const privateSeqs: number[] = [];

  for (const event of events) {
    cursor = applyEvent(cursor, event as never);
    if (!isVisibleTo(event, observer, cursor)) continue;
    if (event.visibleTo === 'public') publicSeqs.push(event.seq);
    else privateSeqs.push(event.seq);
  }

  return { publicSeqs, privateSeqs };
}

const GAME = playGame(777);

describe('AC-8 / AC-9 · 分区与独立折叠结果一致', () => {
  it('9 个观察者的 public / private 集合都等于独立折叠的结果', () => {
    expect(GAME.events.length).toBeGreaterThan(10);

    for (const observer of SEAT_IDS) {
      const ctx = project({
        state: GAME.state,
        events: GAME.events,
        observer,
        pending: null,
      });
      const expected = expectedVisibleSeqs(GAME.events, observer);

      expect(
        ctx.publicEvents.map((event) => event.seq),
        `observer=${observer}`,
      ).toEqual(expected.publicSeqs);
      expect(
        ctx.privateEvents.map((event) => event.seq),
        `observer=${observer}`,
      ).toEqual(expected.privateSeqs);
    }
  });

  it('两个桶都不含任何 server 事件（含 GAME_STARTED 的全员身份）', () => {
    for (const observer of SEAT_IDS) {
      const ctx = project({ state: GAME.state, events: GAME.events, observer, pending: null });
      const all = [...ctx.publicEvents, ...ctx.privateEvents];

      expect(
        all.filter((event) => event.visibleTo === 'server'),
        `observer=${observer}`,
      ).toEqual([]);
      // GAME_STARTED 是 server 可见的：它绝不能出现在任何观察者的投影里
      expect(all.some((event) => event.type === 'GAME_STARTED')).toBe(false);
    }
  });

  it('public 与 private 的 seq 无交集', () => {
    for (const observer of SEAT_IDS) {
      const ctx = project({ state: GAME.state, events: GAME.events, observer, pending: null });
      const pub = new Set(ctx.publicEvents.map((event) => event.seq));
      const overlap = ctx.privateEvents.filter((event) => pub.has(event.seq));

      expect(overlap, `observer=${observer}`).toEqual([]);
    }
  });
});
