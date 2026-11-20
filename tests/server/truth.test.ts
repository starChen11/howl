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

describe('AC-11 · 真相视图零副作用', () => {
  it('请求前后事件流完全相等', async () => {
    const store = new InMemoryMetaStore();
    const { registry, session, record } = await gameWithDeadPlayer(store);
    const before = JSON.stringify((await registry.getGame(record.gameId))?.events);

    const app = buildApp({ store, bus: new StreamBus() });
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/truth`,
      headers: { cookie: `session=${session.id}` },
    });
    expect(res.statusCode).toBe(200);

    const after = JSON.stringify((await registry.getGame(record.gameId))?.events);
    expect(after).toBe(before);
  });
});

describe('AC-9 · 女巫与猎人的动作也有记录', () => {
  it('用药与开枪各自记到对应席位', async () => {
    const state = {
      seats: [
        { seat: 1, role: 'witch', alive: true },
        { seat: 2, role: 'hunter', alive: false },
        { seat: 3, role: 'villager', alive: true },
      ],
    } as never;
    const events = [
      { seq: 1, type: 'WITCH_POTION_USED', payload: { potion: 'poison', target: 3 } },
      { seq: 2, type: 'HUNTER_SHOOT', payload: { seat: 2, target: 3 } },
    ] as never;

    const truth = buildTruth(state, events);
    expect(truth.seats.find((seat) => seat.seat === 1)?.actions.join('')).toContain('毒药');
    expect(truth.seats.find((seat) => seat.seat === 2)?.actions.join('')).toContain('开枪');
  });
});

describe('C-154 · 死后的动作不再记到已出局席位', () => {
  it('狼在死后不再被记「袭击」', async () => {
    const state = {
      seats: [
        { seat: 1, role: 'wolf', alive: false },
        { seat: 2, role: 'wolf', alive: true },
        { seat: 3, role: 'villager', alive: true },
      ],
    } as never;
    const events = [
      { seq: 1, type: 'PLAYER_DIED', payload: { seat: 1, cause: 'lynch' } },
      { seq: 2, type: 'WOLF_KILL_CHOSEN', payload: { target: 3 } },
    ] as never;

    const truth = buildTruth(state, events);
    expect(truth.seats.find((seat) => seat.seat === 1)?.actions).toEqual([]);
    expect(truth.seats.find((seat) => seat.seat === 2)?.actions.join('')).toContain('袭击');
  });
});

describe('C-155 · 夜晚死亡属于第 N 天', () => {
  it('第一夜死亡记为第 1 天，而不是第 0 天', async () => {
    const store = new InMemoryMetaStore();
    const { registry, record } = await gameWithDeadPlayer(store);
    const truth = buildTruth(registry.stateOf(record), record.events);

    const first = truth.deaths[0];
    expect(first?.day).toBeGreaterThanOrEqual(1);
  });

  it('第二个夜晚的死亡记为第 2 天', () => {
    const state = { seats: [{ seat: 1, role: 'villager', alive: false }] } as never;
    const events = [
      { seq: 1, type: 'PHASE_CHANGED', payload: { from: 'DAY_ANNOUNCE', to: 'NIGHT_WOLF_CHAT' } },
      { seq: 2, type: 'PLAYER_DIED', payload: { seat: 1, cause: 'wolf' } },
    ] as never;
    // 只有 PHASE_CHANGED、没有 DAY_STARTED：夜 1
    expect(buildTruth(state, events).deaths[0]?.day).toBe(1);

    const secondNight = [
      { seq: 1, type: 'DAY_STARTED', payload: { day: 1 } },
      { seq: 2, type: 'PHASE_CHANGED', payload: { from: 'DAY_LYNCH', to: 'NIGHT_WOLF_CHAT' } },
      { seq: 3, type: 'PLAYER_DIED', payload: { seat: 1, cause: 'wolf' } },
    ] as never;
    expect(buildTruth(state, secondNight).deaths[0]?.day).toBe(2);
  });
});

describe('出局后仍待决定时不能看真相（防作弊）', () => {
  it('玩家是猎人、正等他决定开枪 → canSeeTruth 为 false', async () => {
    const { buildTruth, canSeeTruth } = await import('@server/view/truth');
    const { GameRegistry } = await import('@server/store/game-registry');
    const { InMemoryMetaStore } = await import('@server/store/meta-store');

    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 2,
      playerSeat: 1,
    });

    let current = record;
    const stateOf = () => registry.stateOf(current);
    // 推进到「玩家猎人被杀、等他开枪」的那一刻
    while (stateOf().phase !== 'NIGHT_HUNTER_SHOOT') {
      const state = stateOf();
      const action = (() => {
        switch (state.phase) {
          case 'NIGHT_WOLF_CHAT': {
            const wolf = state.seats.find(
              (seat) =>
                seat.alive &&
                seat.role === 'wolf' &&
                !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
            )?.seat;
            return wolf === undefined
              ? undefined
              : { type: 'WOLF_CHAT', ts: 0, seat: wolf, text: '' };
          }
          case 'NIGHT_WOLVES': {
            const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
            return wolf === undefined
              ? undefined
              : { type: 'WOLF_KILL', ts: 0, seat: wolf, target: 1 };
          }
          case 'NIGHT_SEER': {
            const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
            return seer === undefined
              ? undefined
              : { type: 'SEER_CHECK', ts: 0, seat: seer, target: 2 };
          }
          case 'NIGHT_WITCH': {
            const witch = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
            return witch === undefined
              ? undefined
              : { type: 'WITCH_ACT', ts: 0, seat: witch, potion: 'none' };
          }
          default:
            return undefined;
        }
      })();

      if (action === undefined) break;
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;
      current = result.record;
    }

    const state = stateOf();
    expect(state.phase).toBe('NIGHT_HUNTER_SHOOT');
    expect(canSeeTruth(state, 1)).toBe(false);
    // 数据本身还是能构造的；被拦住的是「能不能看」这道门
    expect(buildTruth(state, current.events).seats).toHaveLength(9);
  });
});
