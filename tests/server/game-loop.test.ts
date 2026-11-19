import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { ChannelRegistry } from '@server/channels/session';
import { GameLoop } from '@server/game-loop';
import { scriptedAgent } from '@server/ai/agent';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';

/**
 * RFC-012 §5 AC-15 / AC-16：整局入口。
 *
 * 一局从开局推进到 `FINISHED`；玩家席位由输入通道兑现；跑完不再重复启动。
 */

async function makeHarness() {
  const store = new InMemoryMetaStore();
  const bus = new StreamBus();
  const channels = new ChannelRegistry(bus);
  const registry = new GameRegistry(store);
  const loop = new GameLoop({
    registry,
    channels,
    makeDecider: () => scriptedAgent,
  });
  const app = buildApp({ store, bus, channels, loop });
  return { app, registry, channels, loop, bus };
}

describe('AC-15 · 一局能从开局跑到 FINISHED', () => {
  it('POST /play 后，轮询到 FINISHED；事件流 seq 连续', async () => {
    const { app, registry } = await makeHarness();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 20_261_117, playerSeat: 1 },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const started = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/play`,
      headers: { cookie },
    });
    expect(started.statusCode).toBe(202);

    // 玩家席位一出现就给一句话（脚本 AI 负责其余）
    const answer = async () => {
      const record = await registry.getGame(gameId);
      if (record === undefined) return;
      const state = registry.stateOf(record);
      if (state.phase !== 'DAY_SPEECH') return;
      const speaker = state.speech;
      if (speaker === undefined) return;
      const pending = state.seats
        .filter((seat) => seat.alive)
        .map((seat) => seat.seat)
        .find((seat) => !speaker.spoken.includes(seat));
      if (pending === undefined || !state.seats.find((s) => s.seat === pending)?.isPlayer) return;

      await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/actions`,
        headers: { cookie },
        payload: {
          action: { type: 'SPEECH', ts: Date.now(), seat: pending, text: '我来说一句' },
          expectedVersion: record.events.length,
        },
      });
    };

    for (let tick = 0; tick < 200; tick += 1) {
      const record = await registry.getGame(gameId);
      if (record?.status === 'finished') break;
      await answer();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const final = await registry.getGame(gameId);
    expect(final?.status).toBe('finished');
    const seqs = final?.events.map((event) => event.seq) ?? [];
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
  });

  it('重复 POST /play 不会开两个循环', async () => {
    // 用一个「永远不返回」的 decider 把循环挂住，才能稳定观察到「已在运行」。
    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const registry = new GameRegistry(store);
    const loop = new GameLoop({
      registry,
      channels,
      makeDecider: () => async () => new Promise(() => undefined) as never,
    });
    const app = buildApp({ store, bus, channels, loop });
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 7 },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/play`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/play`,
      headers: { cookie },
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ started: false });
  });
});

describe('C-122 · 同一会话多局时只推进指定的那一局', () => {
  it('启动第一局，第二局不受影响', async () => {
    const { app, registry } = await makeHarness();

    const first = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 15 },
    });
    const rawFirst = first.headers['set-cookie'];
    const cookie = String(Array.isArray(rawFirst) ? rawFirst[0] : rawFirst).split(';')[0] ?? '';
    const firstId = first.json<{ gameId: string }>().gameId;

    const second = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 16 },
      headers: { cookie },
    });
    const secondId = second.json<{ gameId: string }>().gameId;
    expect(secondId).not.toBe(firstId);

    const secondBefore = (await registry.getGame(secondId))?.events.length ?? 0;

    await app.inject({
      method: 'POST',
      url: `/api/games/${firstId}/play`,
      headers: { cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const firstAfter = await registry.getGame(firstId);
    const secondAfter = await registry.getGame(secondId);

    expect(firstAfter?.events.length ?? 0).toBeGreaterThan(1);
    expect(secondAfter?.events.length ?? 0).toBe(secondBefore);
  });
});
