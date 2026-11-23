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
async function finishedGame(existing?: InMemoryMetaStore) {
  const store = existing ?? new InMemoryMetaStore();
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
  return { registry, session, record, store };
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
    const { usageMetaLog, usageOf, resetUsage } = await import('@server/llm/usage');
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
    usageMetaLog.record({ ...base, inputTokens: 10, outputTokens: 5, cachedTokens: 2 });
    usageMetaLog.record({ ...base, inputTokens: 20, outputTokens: 7, cachedTokens: 0 });

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

describe('AC-3 · 真实产出 AI_THOUGHT（不是只定义）', () => {
  it('决策带 thought 时，事件流与快照里都有这条推理', async () => {
    const store = new InMemoryMetaStore();
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    await registry.createGame(session, { mode: 'slaughter-side', seed: 15, playerSeat: 1 });

    const input: InputChannel = {
      async read() {
        return { kind: 'skip' };
      },
      close() {},
    };

    // 用脚本 AI 保证动作合法，再给每一步补一条 thought
    await runGame({
      registry,
      session,
      input,
      output: { emit() {}, async flush() {} },
      decide: async (input) => {
        const base = await scriptedAgent(input);
        if (base.action === undefined) return base;
        return { ...base, thought: { reason: `${input.seat} 号决定过` } };
      },
      maxSteps: 40,
    });

    const record = await registry.getGame(session.gameIds[0] ?? '');
    if (record === undefined) throw new Error('对局丢失');
    const thoughts = record.events.filter((event) => event.type === 'AI_THOUGHT');
    expect(thoughts.length).toBeGreaterThan(0);

    const snapshot = buildReplaySnapshot(registry.stateOf(record), record.events, {
      gameId: record.gameId,
      seed: record.seed,
      finishedAt: 0,
    });
    expect(snapshot.thoughts.length).toBe(thoughts.length);
    expect(snapshot.thoughts[0]?.reason).toBe((thoughts[0]?.payload as { reason: string }).reason);
  });
});

describe('AC-8 · 失败与重试也计入用量', () => {
  it('一次失败 + 一次成功 → calls 2', async () => {
    const { usageMetaLog, usageOf, resetUsage } = await import('@server/llm/usage');
    resetUsage();

    const base = {
      gameId: 'g2',
      seat: 1 as never,
      seq: 1,
      day: 1,
      phase: 'DAY_SPEECH' as never,
      model: 'm',
      thinking: true,
      attempt: 1,
      latencyMs: 1,
    };
    usageMetaLog.record({
      ...base,
      ok: false,
      errorCode: 'TIMEOUT',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    });
    usageMetaLog.record({ ...base, ok: true, inputTokens: 10, outputTokens: 5, cachedTokens: 0 });

    expect(usageOf('g2').calls).toBe(2);
    expect(usageOf('g2').inputTokens).toBe(10);
  });
});

describe('AC-9 ~ AC-11 · 视角端点走真实路由', () => {
  it('3 席 × 3 seq：响应等于截断后的 project()', async () => {
    const { buildApp } = await import('@server/app');
    const { project } = await import('@server/project');
    const { replay } = await import('@engine/replay');
    const { StreamBus } = await import('@server/stream/bus');

    const store = new InMemoryMetaStore();
    const { registry, session, record } = await finishedGame(store);
    const app = buildApp({ store, bus: new StreamBus() });
    expect(await registry.getSession(session.id)).toBeDefined();

    const seqs = [
      record.events[1]?.seq ?? 1,
      record.events[Math.floor(record.events.length / 2)]?.seq ?? 1,
      record.events[record.events.length - 1]?.seq ?? 1,
    ];

    for (const seat of [1, 3, 5]) {
      for (const seq of seqs) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/games/${record.gameId}/replay/seat/${seat}?seq=${seq}`,
          headers: { cookie: `session=${session.id}` },
        });
        expect(res.statusCode).toBe(200);

        const truncated = record.events.filter((event) => event.seq <= seq);
        const expected = project({
          state: replay(truncated as never),
          events: truncated,
          observer: seat as never,
          pending: null,
        });
        expect(res.json<{ view: unknown }>().view).toEqual(expected);
      }
    }
  });
});

describe('AC-13 · 已释放局：复盘可读、视角端点优雅拒绝', () => {
  it('release 后 GET /replay 返回完整快照；视角端点返回 410 而不是 500', async () => {
    const { buildApp } = await import('@server/app');
    const { StreamBus } = await import('@server/stream/bus');

    const store = new InMemoryMetaStore();
    const { registry, session, record } = await finishedGame(store);
    await registry.release(record.gameId);

    const app = buildApp({ store, bus: new StreamBus() });
    const replayRes = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/replay`,
      headers: { cookie: `session=${session.id}` },
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json<{ seats: unknown[] }>().seats).toHaveLength(9);

    const perspective = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/replay/seat/1?seq=5`,
      headers: { cookie: `session=${session.id}` },
    });
    expect(perspective.statusCode).toBe(410);
  });
});

describe('AC-3 · 事件流里真的存在 AI_THOUGHT', () => {
  it('完成局里 thoughts 数量等于事件流里的 AI_THOUGHT 数量', async () => {
    // 上一版用真实对局却没断言「事件里至少一条」；这里直接锁住产出路径（C-156）。
    const { record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;
    const fromEvents = record.events.filter((event) => event.type === 'AI_THOUGHT').length;

    expect(snapshot.thoughts.length).toBe(fromEvents);
  });
});

describe('C-176 · 终局后追加的推理也要进快照', () => {
  it('appendEvents 在 finished 记录上重建快照', async () => {
    const store = new InMemoryMetaStore();
    const { registry, record } = await finishedGame(store);
    const before = (record.snapshot as { thoughts: unknown[] }).thoughts.length;

    const updated = await registry.appendEvents(record, [
      {
        gameId: record.gameId,
        seq: record.events.length + 1,
        ts: 0,
        type: 'AI_THOUGHT',
        visibleTo: 'self:2',
        payload: { reason: '最后一轮的理由', decisionSeq: record.events.length, seat: 2 },
      } as never,
    ]);

    const snapshot = updated.snapshot as { thoughts: { reason: string }[] };
    expect(snapshot.thoughts).toHaveLength(before + 1);
    expect(snapshot.thoughts.at(-1)?.reason).toBe('最后一轮的理由');

    const persisted = await registry.getGame(record.gameId);
    expect(
      (persisted?.snapshot as { thoughts: { reason: string }[] }).thoughts.at(-1)?.reason,
    ).toBe('最后一轮的理由');
  });
});

describe('C-157 · 生产接线真的把 metaLog 传给了 decide', () => {
  it('createLlmAgent 调 decide 时带上 usageMetaLog，调用会被计入', async () => {
    const { createLlmAgent } = await import('@server/ai/agent');
    const { usageOf, resetUsage } = await import('@server/llm/usage');
    resetUsage();
    const previousKey = process.env['DEEPSEEK_API_KEY'];
    process.env['DEEPSEEK_API_KEY'] = 'test-key';

    const agent = createLlmAgent({
      gameId: 'wired',
      seq: () => 1,
      mode: 'slaughter-side',
      decideFn: (async (deps: { metaLog?: { record(meta: never): void } }) => {
        deps.metaLog?.record({
          gameId: 'wired',
          seat: 1,
          seq: 1,
          day: 1,
          phase: 'DAY_SPEECH',
          model: 'm',
          thinking: false,
          attempt: 1,
          latencyMs: 1,
          ok: true,
          inputTokens: 7,
          outputTokens: 3,
          cachedTokens: 0,
        } as never);

        return {
          decision: { action: 'skip', reason: '测试' },
          meta: {
            gameId: 'wired',
            seat: 1,
            seq: 1,
            day: 1,
            phase: 'DAY_SPEECH',
            model: 'm',
            thinking: false,
            attempt: 1,
            latencyMs: 1,
            ok: true,
            inputTokens: 7,
            outputTokens: 3,
            cachedTokens: 0,
          },
        } as never;
      }) as never,
    });

    const ctx = {
      self: { seat: 1, role: 'villager', alive: true, personaId: null },
      phase: 'DAY_SPEECH',
      day: 1,
      aliveSeats: [1, 2],
      deadSeats: [],
      publicEvents: [],
      privateEvents: [],
      knowledge: {
        teammates: [],
        checks: [],
        potions: { heal: 'used', poison: 'used' },
        canShoot: false,
        knownKillTarget: null,
      },
      legalTargets: [2],
      pending: 'speak',
    } as never;

    await agent({ seat: 1, ctx, phase: 'DAY_SPEECH' });

    expect(usageOf('wired').calls).toBe(1);
    expect(usageOf('wired').inputTokens).toBe(7);

    if (previousKey === undefined) delete process.env['DEEPSEEK_API_KEY'];
    else process.env['DEEPSEEK_API_KEY'] = previousKey;
  });
});

describe('C-163 · 快照的身份 / 人格 / 结果与对局一致', () => {
  it('逐席与 state 比对，result 与 GAME_ENDED 一致', async () => {
    const { registry, record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;
    const state = registry.stateOf(record);

    for (const seat of state.seats) {
      const fromSnapshot = snapshot.seats.find((candidate) => candidate.seat === seat.seat);
      expect(fromSnapshot?.role).toBe(seat.role);
      expect(fromSnapshot?.personaId ?? null).toBe(seat.personaId ?? null);
      expect(fromSnapshot?.alive).toBe(seat.alive);
    }

    const ended = record.events.find((event) => event.type === 'GAME_ENDED');
    const payload = ended?.payload as { result: 'wolf' | 'good'; condition: string } | undefined;
    expect(snapshot.result).toBe(payload?.result);
    // 快照里的胜负条件是给人看的中文，事件里是机器枚举
    expect(snapshot.winCondition).not.toBe('');
    expect(snapshot.winCondition).not.toContain('-');
    void payload;

    // 角色分布必须是 3 狼 / 4 民 / 3 神这类真实配置，而不是全同一角色
    const roles = new Set(snapshot.seats.map((seat) => seat.role));
    expect(roles.size).toBeGreaterThan(1);
  });
});

describe('复盘时间线：天数与相位名要说人话', () => {
  it('第一夜的记录是第 1 夜、相位是中文、死因是中文', async () => {
    const { registry, record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;

    const nightEntries = snapshot.timeline.filter((entry) => entry.text.includes('夜聊'));
    expect(nightEntries.length).toBeGreaterThan(0);
    for (const entry of nightEntries) expect(`${entry.day}`).not.toBe('0');

    // 不再出现原始枚举与英文死因
    expect(snapshot.timeline.some((entry) => /NIGHT_|DAY_|FINISHED/.test(entry.text))).toBe(false);
    expect(
      snapshot.timeline.some((entry) => /（wolf）|（lynch）|（poison）/.test(entry.text)),
    ).toBe(false);
    void registry;
  });
});

describe('复盘时间线包含狼队投票（RUL-13）', () => {
  it('有 WOLF_VOTE_CAST 的对局会显示每狼的票与唱票', async () => {
    const { registry, record } = await finishedGame();
    const snapshot = record.snapshot as ReturnType<typeof buildReplaySnapshot>;
    const votes = snapshot.timeline.filter((entry) => entry.text.includes('（狼队）'));

    expect(votes.length).toBeGreaterThan(0);
    expect(snapshot.timeline.some((entry) => entry.text.startsWith('狼队票型'))).toBe(true);
    void registry;
  });
});

describe('RUL-15 · 弃权票的复盘用中文显示', () => {
  it('WOLF_VOTE_CAST target=abstain 显示「弃权」而不是 abstain', async () => {
    const { buildReplaySnapshot } = await import('@server/replay/snapshot');
    const { nightStart } = await import('../fixtures/night');
    const state = nightStart();
    const events = [
      {
        gameId: state.gameId,
        seq: 1,
        ts: 0,
        type: 'PHASE_CHANGED',
        visibleTo: 'server',
        payload: { from: 'NIGHT_WOLF_CHAT', to: 'NIGHT_WOLVES' },
      },
      {
        gameId: state.gameId,
        seq: 2,
        ts: 0,
        type: 'WOLF_VOTE_CAST',
        visibleTo: 'wolves',
        payload: { seat: 1, target: 'abstain', confirmed: true },
      },
    ] as never;

    const snapshot = buildReplaySnapshot(state, events, {
      gameId: state.gameId,
      seed: state.seed,
      finishedAt: 0,
    });
    const text = snapshot.timeline.map((entry) => entry.text).join('\n');
    expect(text).toContain('1 号弃权（狼队）');
    expect(text).not.toContain('abstain');
  });
});
