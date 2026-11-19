import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';

import { currentSpeaker } from '@engine/phases/day';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';

/**
 * RFC-008 AC-13（C-73）：**终局**记录不缓存状态，每次都重新 replay。
 *
 * 之前的用例只把副本的 `status` 翻成 `finished`，既没有真的走到 FINISHED，也没有
 * 走 GET / release，所以「给终局记录加缓存」照样全绿。
 */

/** 把一局真的打到 FINISHED。 */
async function playToFinish(
  registry: GameRegistry,
  session: Awaited<ReturnType<GameRegistry['createSession']>>,
) {
  const created = await registry.createGame(session, { mode: 'slaughter-side', seed: 4_242_424 });
  let record = await registry.getGame(created.gameId);
  if (record === undefined) throw new Error('记录丢失');

  for (let guard = 0; guard < 800; guard += 1) {
    const state = registry.stateOf(record);
    if (state.phase === 'FINISHED') return record;

    const alive = state.seats.filter((seat) => seat.alive);
    const roleOf = (role: string) => alive.find((seat) => seat.role === role)?.seat;
    const anyAlive = (exclude?: SeatId) =>
      alive.find((seat) => seat.seat !== exclude)?.seat ?? ('abstain' as const);

    let action: Record<string, unknown> | undefined;
    switch (state.phase) {
      case 'NIGHT_WOLF_CHAT': {
        const speaker = state.seats.find(
          (seat) =>
            seat.alive &&
            seat.role === 'wolf' &&
            !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
        )?.seat;
        if (speaker === undefined) return record;
        action = { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' };
        break;
      }
      case 'NIGHT_WOLVES': {
        const wolf = roleOf('wolf');
        const victim = alive.find((seat) => seat.role !== 'wolf')?.seat;
        if (wolf === undefined || victim === undefined) return record;
        action = { type: 'WOLF_KILL', ts: 1, seat: wolf, target: victim };
        break;
      }
      case 'NIGHT_SEER': {
        const seer = roleOf('seer');
        const target = alive.find((seat) => seat.role !== 'seer')?.seat;
        if (seer === undefined || target === undefined) return record;
        action = { type: 'SEER_CHECK', ts: 1, seat: seer, target };
        break;
      }
      case 'NIGHT_WITCH': {
        const witch = roleOf('witch');
        if (witch === undefined) return record;
        action = { type: 'WITCH_ACT', ts: 1, seat: witch, potion: 'none' };
        break;
      }
      case 'NIGHT_HUNTER_SHOOT':
      case 'DAY_HUNTER_SHOOT': {
        const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
        if (hunter === undefined) return record;
        action = { type: 'HUNTER_SHOOT', ts: 1, seat: hunter };
        break;
      }
      case 'DAY_SPEECH': {
        // 必须问引擎「现在轮到谁」——自己按座位挑会被判 NOT_YOUR_TURN。
        const speaker = currentSpeaker(state);
        if (speaker === undefined) return record;
        action = { type: 'SPEECH_SKIP', ts: 1, seat: speaker };
        break;
      }
      case 'DAY_VOTE':
      case 'DAY_VOTE_RUNOFF': {
        const voter = state.seats.find(
          (seat) => seat.alive && !(state.votes ?? []).some((vote) => vote.seat === seat.seat),
        )?.seat;
        if (voter === undefined) return record;
        const target =
          state.phase === 'DAY_VOTE_RUNOFF' ? (state.runoff?.[0] as SeatId) : anyAlive(voter);
        action = { type: 'VOTE', ts: 1, seat: voter, target };
        break;
      }
      default:
        return record;
    }

    const result = await registry.submit(session, record, action as never, state.seq);
    if (!result.ok) return record;
    record = result.record;
    if (registry.stateOf(record).seq === state.seq) return record;
  }

  return record;
}

describe('AC-13 · 终局记录每次都重新 replay', () => {
  it('真的打到 FINISHED 后，两次 stateOf 深度相等且改返回值不影响下一次', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await playToFinish(registry, session);

    expect(registry.stateOf(record).phase).toBe('FINISHED');

    const first = registry.stateOf(record);
    const second = registry.stateOf(record);
    expect(second).toEqual(first);

    (registry.stateOf(record) as { day: number }).day = 99;
    expect(registry.stateOf(record).day).toBe(first.day);
  });

  it('释放后该局取不到状态（事件流是唯一权威），GET 返回 410', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await playToFinish(registry, session);

    await registry.release(record.gameId);
    const released = await registry.getGame(record.gameId);
    if (released === undefined) throw new Error('记录丢失');

    expect(released.events).toEqual([]);
    expect(() => registry.stateOf(released)).toThrow();
  });
});
