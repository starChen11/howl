import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';
import { buildTruth, canSeeTruth } from '@server/view/truth';

/**
 * RFC-013 §5 AC-9 / AC-12：真相视图只对已出局者开放（SEC-6）。
 */

/** 把玩家席位在夜里杀掉，进入「出局后」的局面。 */
async function gameWithDeadPlayer(store: InMemoryMetaStore) {
  const registry = new GameRegistry(store);
  const session = await registry.createSession();
  const playerSeat = 3;
  const record = await registry.createGame(session, {
    mode: 'slaughter-side',
    seed: 15,
    playerSeat,
  });

  let current = record;
  const stateOf = () => registry.stateOf(current);

  while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
    const state = stateOf();
    const wolf = state.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (wolf === undefined) break;
    const r = await registry.submit(
      session,
      current,
      {
        type: 'WOLF_CHAT',
        ts: 1,
        seat: wolf,
        text: '',
      } as never,
      state.seq,
    );
    if (!r.ok) break;
    current = r.record;
  }

  // 狼刀玩家自己 → 玩家出局
  {
    const state = stateOf();
    const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (wolf !== undefined) {
      const r = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_KILL',
          ts: 1,
          seat: wolf,
          target: playerSeat as never,
        } as never,
        state.seq,
      );
      if (r.ok) current = r.record;
    }
  }
  for (const type of ['SEER_CHECK', 'WITCH_ACT'] as const) {
    const state = stateOf();
    const actor =
      type === 'SEER_CHECK'
        ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
        : state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
    if (actor === undefined) continue;
    const action =
      type === 'WITCH_ACT'
        ? { type, ts: 1, seat: actor, potion: 'none' as const }
        : {
            type,
            ts: 1,
            seat: actor,
            target: state.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat,
          };
    const r = await registry.submit(session, current, action as never, state.seq);
    if (!r.ok) break;
    current = r.record;
  }

  return { registry, session, record: current, playerSeat };
}

describe('AC-12 · 活着的玩家请求真相 → 403', () => {
  it('对局进行中 /truth 被拒绝（SEC-6）', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/truth`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(expect.objectContaining({ error: 'TRUTH_LOCKED' }));
  });
});

describe('AC-9 / AC-10 · 出局后能看真相，且全席位身份齐全', () => {
  it('玩家出局后 /truth 返回九个席位与角色标签', async () => {
    const store = new InMemoryMetaStore();
    const { registry, session, record, playerSeat } = await gameWithDeadPlayer(store);

    const state = registry.stateOf(record);
    expect(state.seats.find((seat) => seat.seat === playerSeat)?.alive).toBe(false);
    expect(canSeeTruth(state, playerSeat)).toBe(true);

    const app = buildApp({ store, bus: new StreamBus() });
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/truth`,
      headers: { cookie: `session=${session.id}` },
    });

    expect(res.statusCode).toBe(200);
    const truth = res.json<{ seats: { seat: number; roleLabel: string; alive: boolean }[] }>();
    expect(truth.seats).toHaveLength(9);
    expect(truth.seats.find((seat) => seat.seat === playerSeat)?.alive).toBe(false);
    for (const seat of truth.seats) expect(seat.roleLabel.length).toBeGreaterThan(0);
  });

  it('buildTruth 的返回值只读：改它不影响引擎状态', async () => {
    const store = new InMemoryMetaStore();
    const { registry, record } = await gameWithDeadPlayer(store);
    const before = JSON.stringify(registry.stateOf(record));

    buildTruth(registry.stateOf(record), record.events);

    expect(JSON.stringify(registry.stateOf(record))).toBe(before);
  });
});

describe('AC-9 · 夜间行动结果真的落到对应席位', () => {
  it('狼刀记在狼头上、查验记在预言家头上', async () => {
    const store = new InMemoryMetaStore();
    const { registry, session, record, playerSeat } = await gameWithDeadPlayer(store);
    const state = registry.stateOf(record);
    const truth = buildTruth(state, record.events);

    expect(truth.deaths.length).toBeGreaterThan(0);

    const wolfSeats = state.seats.filter((seat) => seat.role === 'wolf').map((seat) => seat.seat);
    for (const wolf of wolfSeats) {
      const seat = truth.seats.find((candidate) => candidate.seat === wolf);
      expect(
        seat?.actions.some((action) => action.includes('袭击')),
        `wolf ${wolf}`,
      ).toBe(true);
    }

    const seer = state.seats.find((seat) => seat.role === 'seer')?.seat;
    if (seer !== undefined) {
      const seat = truth.seats.find((candidate) => candidate.seat === seer);
      expect(seat?.actions.some((action) => action.includes('查验'))).toBe(true);
    }

    // 出局记录带死因（不再是 pendingDeaths）
    expect(truth.deaths.some((death) => death.cause.length > 0)).toBe(true);
    void playerSeat;
    void session;
  });
});
