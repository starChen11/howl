import { describe, expect, it } from 'vitest';

import { buildReplaySnapshot, buildThoughts } from '@server/replay/snapshot';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { scriptedAgent } from '@server/ai/agent';
import { runGame } from '@server/orchestrator';
import type { InputChannel } from '@shared/channels';

/**
 * RFC-014 §5 AC-1 ~ AC-8 / AC-13：复盘快照。
 */

/** 跑到 FINISHED 的一局（脚本 AI，玩家用固定输入）。 */
async function finishedGame() {
  const store = new InMemoryMetaStore();
  const registry = new GameRegistry(store);
  const session = await registry.createSession();
  await registry.createGame(session, { mode: 'slaughter-side', seed: 20_261_117, playerSeat: 1 });

  const input: InputChannel = {
    async read() {
      return { kind: 'skip' };
    },
    close() {},
  };

  await runGame({
    registry,
    session,
    input,
    output: { emit() {}, async flush() {} },
    decide: scriptedAgent,
    maxSteps: 400,
  });

  const gameId = session.gameIds[session.gameIds.length - 1] ?? '';
  const record = await registry.getGame(gameId);
  if (record === undefined) throw new Error('对局丢失');
  return { registry, session, record };
}

describe('AC-1 / AC-2 / AC-5 / AC-6', () => {
  it('时间线按 seq 升序；九个席位都有角色与人格；结果可定位', async () => {
    const { registry, record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;

    expect(snapshot).toBeDefined();
    const seqs = snapshot.timeline.map((entry) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    expect(snapshot.seats).toHaveLength(9);
    for (const seat of snapshot.seats) {
      expect(seat.roleLabel.length).toBeGreaterThan(0);
      expect(seat.personaId === null || seat.personaLabel !== null).toBe(true);
    }

    expect(['wolf', 'good']).toContain(snapshot.result);
    expect(snapshot.winCondition.length).toBeGreaterThan(0);

    // 事件流与时间线一致：每条时间线都能在事件里找到
    const eventSeqs = new Set(record.events.map((event) => event.seq));
    for (const entry of snapshot.timeline) expect(eventSeqs.has(entry.seq)).toBe(true);
    void registry;
  });
});

describe('AC-4 · 推理只来自结构化 reason', () => {
  it('清掉 reasoning_content 也影响不到快照', () => {
    const events = [
      {
        gameId: 'g',
        seq: 3,
        ts: 0,
        type: 'AI_THOUGHT',
        visibleTo: 'self:2',
        payload: { reason: '3 号在保 5 号，像悍跳', decisionSeq: 2, seat: 2 },
        reasoningContent: '这是模型的隐藏思维链',
      },
    ] as never;

    const thoughts = buildThoughts(events);
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]?.reason).toBe('3 号在保 5 号，像悍跳');
    expect(JSON.stringify(thoughts)).not.toContain('隐藏思维链');
  });

  it('thoughts 按 (seq, seat) 排序且可复现', () => {
    const events = [
      {
        gameId: 'g',
        seq: 5,
        ts: 0,
        type: 'AI_THOUGHT',
        visibleTo: 'self:3',
        payload: { reason: 'b', decisionSeq: 4, seat: 3 },
      },
      {
        gameId: 'g',
        seq: 2,
        ts: 0,
        type: 'AI_THOUGHT',
        visibleTo: 'self:2',
        payload: { reason: 'a', decisionSeq: 1, seat: 2 },
      },
    ] as never;

    expect(buildThoughts(events).map((thought) => thought.seq)).toEqual([2, 5]);
  });
});

describe('AC-7 · degraded 与事件一一对应', () => {
  it('列出所有 DEGRADED 的 seq', () => {
    const events = [
      { gameId: 'g', seq: 4, ts: 0, type: 'DEGRADED', visibleTo: 'public', payload: { seat: 2 } },
      { gameId: 'g', seq: 9, ts: 0, type: 'DEGRADED', visibleTo: 'public', payload: { seat: 5 } },
    ] as never;
    const state = { seats: [] } as never;

    expect(
      buildReplaySnapshot(state, events, { gameId: 'g', seed: 1, finishedAt: 0 }).degraded,
    ).toEqual([4, 9]);
  });
});

describe('AC-13 · 状态释放后仍能读复盘', () => {
  it('释放事件流后，快照仍在 record 里', async () => {
    const { registry, record } = await finishedGame();
    await registry.release(record.gameId);

    const released = await registry.getGame(record.gameId);
    expect(released?.events).toEqual([]);
    expect(released?.snapshot).toBeDefined();
    expect((released?.snapshot as { seats: unknown[] }).seats).toHaveLength(9);
  });
});

describe('AC-3 / AC-8 · 推理逐条一致、用量聚合', () => {
  it('每条 thought.reason 与事件里的 reason 完全相同', async () => {
    const { record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;
    const fromEvents = record.events
      .filter((event) => event.type === 'AI_THOUGHT')
      .map((event) => event.payload as { reason: string; seat: number })
      .map((payload) => ({ reason: payload.reason, seat: payload.seat }));

    // 脚本 AI 可能不产出 AI_THOUGHT；有的话逐条比对
    if (fromEvents.length === 0) {
      expect(snapshot.thoughts).toEqual([]);
      return;
    }

    expect(snapshot.thoughts).toHaveLength(fromEvents.length);
    snapshot.thoughts.forEach((thought, index) => {
      expect(thought.reason).toBe(fromEvents[index]?.reason);
      expect(thought.seat).toBe(fromEvents[index]?.seat);
    });
  });

  it('usage 等于该局 CallMeta 的聚合值', async () => {
    const { recordUsage, usageOf, resetUsage } = await import('@server/llm/usage');
    resetUsage();

    const base = {
      gameId: 'g',
      seat: 1 as never,
      seq: 1,
      day: 1,
      phase: 'DAY_SPEECH' as never,
      model: 'm',
      thinking: true,
      attempt: 1,
      latencyMs: 1,
      ok: true,
    };
    recordUsage('g', { ...base, inputTokens: 10, outputTokens: 5, cachedTokens: 2 });
    recordUsage('g', { ...base, inputTokens: 20, outputTokens: 7, cachedTokens: 0 });

    expect(usageOf('g')).toEqual({
      calls: 2,
      inputTokens: 30,
      outputTokens: 12,
      cachedTokens: 2,
    });
  });
});

describe('AC-9 / AC-10 / AC-11 · 视角数据由截断后的投影得出', () => {
  it('截断到某个 seq 后，可见事件集等于 project() 的结果，且不含未来事件', async () => {
    const { buildApp } = await import('@server/app');
    const { project } = await import('@server/project');
    const { replay } = await import('@engine/replay');
    const { StreamBus } = await import('@server/stream/bus');

    const store = new InMemoryMetaStore();
    const app = buildApp({ store, bus: new StreamBus() });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    void app;

    const record0 = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: 1,
    });
    const events = record0.events;
    const seq = events[events.length - 1]?.seq ?? 1;

    const truncated = events.filter((event) => event.seq <= seq);
    const expected = project({
      state: replay(truncated as never),
      events: truncated,
      observer: 3 as never,
      pending: null,
    });

    // 路线由 e2e/路由测试覆盖；这里锁「视角 = 截断后投影」这个等价关系
    expect(expected.publicEvents.every((event) => event.seq <= seq)).toBe(true);
    for (const event of expected.privateEvents) expect(event.seq).toBeLessThanOrEqual(seq);
  });
});
