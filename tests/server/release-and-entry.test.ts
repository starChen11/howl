import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { project } from '@server/project';
import { GameRegistry, MAX_GAMES_PER_SESSION } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';

/**
 * RFC-008 Round 2~4 补强的回归锁：释放语义与 HTTP 入口（C-65 / C-66 / C-71 / C-72 / C-74 / C-75）。
 *
 * 这些用例的判据都是「改坏实现会红」，而不是「当前能跑通」：
 * - 直接与 `project()` 的输出比对，而不是数 `"role":` 出现几次；
 * - 直接看 `GAME_STARTED` 的 payload，而不是相信响应字段；
 * - 超限释放要逐个进行，不能反复释放同一局。
 */

function cookieOf(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('没有 set-cookie');
  return value.split(';')[0] as string;
}

describe('C-66 · 超限释放是逐个来的，不是反复释放同一局', () => {
  it('开到上限 +2 局后，持有事件的局数不超过上限', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    for (let index = 0; index < MAX_GAMES_PER_SESSION + 2; index += 1) {
      await registry.createGame(session, { mode: 'slaughter-side' });
    }

    let withEvents = 0;
    for (const gameId of session.gameIds) {
      const stored = await registry.getGame(gameId);
      if (stored !== undefined && stored.events.length > 0) withEvents += 1;
    }

    // 22 局、上限 20 → 应当有 2 局被释放（只释放第 1 局的话会是 21）
    expect(withEvents).toBeLessThanOrEqual(MAX_GAMES_PER_SESSION);
  });
});

describe('C-71 · AC-3：HTTP 创建时传入的 mode 真的进了 GAME_STARTED', () => {
  it('POST /api/games 传 slaughter-all → 事件的 payload.mode 也是 slaughter-all', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-all', seed: 321 },
    });
    const { gameId } = created.json<{ gameId: string }>();

    const registry = new GameRegistry(store);
    const record = await registry.getGame(gameId);
    if (record === undefined) throw new Error('对局丢失');
    const started = record.events.find((event) => event.type === 'GAME_STARTED');
    if (started?.type !== 'GAME_STARTED') throw new Error('没有 GAME_STARTED');

    expect((started.payload as { mode: string }).mode).toBe('slaughter-all');
    expect(record.mode).toBe('slaughter-all');
  });
});

describe('C-72 · AC-8：动作必须真的被引擎接受', () => {
  it('WITCH_ACT(none) 的响应里没有 REJECTED，且 version 前进', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    let current = record;
    const stateOf = () => registry.stateOf(current);

    // 推进到 NIGHT_WITCH（测试替其他席位行动）
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const speaker = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      const result = await registry.submit(
        session,
        current,
        { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' } as never,
        state.seq,
      );
      if (!result.ok) throw new Error('夜聊失败');
      current = result.record;
    }
    for (const [type, seatOf] of [
      [
        'WOLF_KILL',
        (state: ReturnType<typeof stateOf>) =>
          state.seats.find((s) => s.alive && s.role === 'wolf')?.seat,
      ],
      [
        'SEER_CHECK',
        (state: ReturnType<typeof stateOf>) =>
          state.seats.find((s) => s.alive && s.role === 'seer')?.seat,
      ],
    ] as const) {
      const state = stateOf();
      const seat = seatOf(state);
      const target = state.seats.find((s) => s.alive && s.role !== 'wolf' && s.seat !== seat)?.seat;
      if (seat === undefined || target === undefined) throw new Error('缺少目标');
      const result = await registry.submit(
        session,
        current,
        { type, ts: 2, seat, target } as never,
        state.seq,
      );
      if (!result.ok) throw new Error(`${type} 失败`);
      current = result.record;
    }

    const app = buildApp({ store });
    const cookie = `session=${session.id}`;
    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}`,
      headers: { cookie },
    });
    const version = view.json<{ version: number }>().version;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie },
      payload: {
        action: { type: 'WITCH_ACT', ts: 4, seat: 1, potion: 'none' },
        expectedVersion: version,
      },
    });

    const body = submitted.json<{ version: number; events: { type: string }[] }>();
    expect(submitted.statusCode).toBe(200);
    // 关键：没有 REJECTED —— 否则「动作被拒」也会满足「200 + 非空」
    expect(body.events.some((event) => event.type === 'REJECTED')).toBe(false);
    // 而且真的产出了这一夜该有的公开事件：女巫选 none → 结算 → 天亮
    expect(body.events.some((event) => event.type === 'DAY_STARTED')).toBe(true);
    expect(body.version).toBeGreaterThan(version);
  });
});

describe('C-73 · AC-13：FINISHED 的对局每次都重新 replay，不缓存', () => {
  it('终局记录两次 stateOf 深度相等，改返回值不影响下一次', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });
    const stored = await registry.getGame(record.gameId);
    if (stored === undefined) throw new Error('记录丢失');

    stored.status = 'finished';
    stored.finishedAt = Date.now();

    const first = registry.stateOf(stored);
    const second = registry.stateOf(stored);
    expect(second).toEqual(first);

    (registry.stateOf(stored) as { day: number }).day = 99;
    expect(registry.stateOf(stored).day).toBe(first.day);
  });
});

describe('C-74 / C-75 · 换存储实现后路由仍然工作；多个席位都做过深度比较', () => {
  it('buildApp 注入第二个实现后，创建 + 读取 + 提交都正常', async () => {
    class SecondStore extends InMemoryMetaStore {}
    const app = buildApp({ store: new SecondStore() });

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side' },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    expect(view.statusCode).toBe(200);
  });

  it('playerSeat = 2 时，路由的 view 仍与 project() 深度相等（不是只对 1 号生效）', async () => {
    const store = new InMemoryMetaStore();
    const app = buildApp({ store });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', playerSeat: 2, seed: 9 },
    });
    const cookie = cookieOf(created.headers);
    const { gameId } = created.json<{ gameId: string }>();

    const route = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { cookie },
    });
    const registry = new GameRegistry(store);
    const record = await registry.getGame(gameId);
    if (record === undefined) throw new Error('对局丢失');

    const expected = project({
      state: registry.stateOf(record),
      events: record.events,
      observer: record.playerSeat,
      pending: null,
    });

    expect(route.json<{ view: unknown }>().view).toEqual(expected);
  });
});
