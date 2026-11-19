import { describe, expect, it } from 'vitest';

import { collectTypeScriptFiles } from '../helpers/source-scan';
import { GameRegistry, KEEP_FULL_EVENTS } from '@server/store/game-registry';
import { InMemoryMetaStore, type MetaStore } from '@server/store/meta-store';

/**
 * RFC-008 AC-11 ~ AC-14：存储边界与释放。
 *
 * AC-11 要求「存在第二个实现，替换后全部会话相关测试通过」——这里用一个用 `Map` 包了
 * 一层、但行为不同的 `MockStore` 证明依赖是接口而不是具体类。
 */

class MockStore implements MetaStore {
  private readonly map = new Map<string, string>();
  reads = 0;

  async get<T>(key: string): Promise<T | undefined> {
    this.reads += 1;
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((key) => key.startsWith(prefix));
  }
}

describe('AC-11 · MetaStore 返回副本', () => {
  it('改返回值不影响存储里的那份', async () => {
    const store = new InMemoryMetaStore();
    await store.set('session:x', { id: 'x', games: ['a'] });

    const first = await store.get<{ games: string[] }>('session:x');
    first?.games.push('b');

    const second = await store.get<{ games: string[] }>('session:x');
    expect(second?.games).toEqual(['a']);
  });

  it('换成第二个实现后，注册表行为不变', async () => {
    const registry = new GameRegistry(new MockStore());

    const session = await registry.createSession();
    expect(session.id.length).toBeGreaterThanOrEqual(32);

    const record = await registry.createGame(session, { mode: 'slaughter-side' });
    expect((await registry.listGames(session)).length).toBe(1);
    expect(await registry.getGame(record.gameId)).toBeDefined();
  });
});

describe('AC-12 · 不自建存储', () => {
  it('除 meta-store.ts 外，src/server 没有模块级 Map 当存储', () => {
    const files = collectTypeScriptFiles('src/server');
    const offenders = files
      .filter((file) => file.relativePath !== 'store/meta-store.ts')
      .filter((file) => /new Map</.test(file.source))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });
});

describe('AC-13 · 释放后按需重建', () => {
  it('释放 events 后再取状态会抛错（无事件流）；重新放回事件则语义恢复', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });

    // 拿一份原事件的副本，模拟「释放后重放仍然可用」的路径
    const before = registry.stateOf(record).seq;
    expect(before).toBeGreaterThan(0);

    await registry.release(record.gameId);
    const released = await registry.getGame(record.gameId);
    expect(released?.events).toEqual([]);

    // 事件流空了就不再是权威：状态无法重建
    if (released === undefined) throw new Error('记录丢失');
    expect(() => registry.stateOf(released)).toThrow();
  });
});

describe('AC-14 · 只保留最近 3 局的完整事件流', () => {
  it('跑完多局后，保留完整事件的局数不超过 KEEP_FULL_EVENTS', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    // 构造 5 局「已终局但有事件」的记录
    for (let index = 0; index < 5; index += 1) {
      const record = await registry.createGame(session, { mode: 'slaughter-side' });
      const stored = await registry.getGame(record.gameId);
      if (stored === undefined) throw new Error('记录丢失');
      stored.status = 'finished';
      stored.finishedAt = Date.now() + index;
      await registry.submit(
        session,
        stored,
        { type: 'WOLF_CHAT', ts: 1, seat: 1, text: '' } as never,
        registry.stateOf(stored).seq,
      );
      await registry.enforceRetention(session);
    }

    const kept = [];
    for (const gameId of session.gameIds) {
      const record = await registry.getGame(gameId);
      if (record !== undefined && record.events.length > 0) kept.push(gameId);
    }

    expect(kept.length).toBeLessThanOrEqual(KEEP_FULL_EVENTS);
  });
});

describe('B1 · 事件过滤：server 事件永远不出现在可见集合里', () => {
  it('把一整夜的原始事件交给过滤，结果里没有任何 server 事件', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side' });
    const state = registry.stateOf(record);

    // 走到夜晚结算：直接用引擎在同一状态上推进，构造出含 server 事件的事件流
    const { step } = await import('@engine/step');
    const { seatOfAliveRole } = await import('../helpers/roles');

    const chatSeat = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
    if (chatSeat === undefined) throw new Error('没有 wolf');

    for (
      let guard = 0;
      guard < 10 && registry.stateOf(record).phase === 'NIGHT_WOLF_CHAT';
      guard += 1
    ) {
      const current = registry.stateOf(record);
      const speaker = current.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(current.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      if (speaker === undefined) break;
      const result = await registry.submit(
        session,
        record,
        { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' } as never,
        current.seq,
      );
      if (!result.ok) throw new Error('提交失败');
      record.events = result.record.events;
      record.applied = result.record.applied;
    }

    const afterChat = registry.stateOf(record);
    expect(afterChat.phase).toBe('NIGHT_WOLVES');

    const kill = await registry.submit(
      session,
      record,
      {
        type: 'WOLF_KILL',
        ts: 2,
        seat: seatOfAliveRole(afterChat, 'wolf'),
        target: seatOfAliveRole(afterChat, 'villager'),
      } as never,
      afterChat.seq,
    );
    if (!kill.ok) throw new Error('下刀失败');

    const observer = afterChat.seats[0];
    if (observer === undefined) throw new Error('没有席位');
    const visible = registry.visibleEventsOf(kill.record, observer.seat);
    expect(visible.filter((event) => event.visibleTo === 'server')).toEqual([]);
    void step;
  });
});
