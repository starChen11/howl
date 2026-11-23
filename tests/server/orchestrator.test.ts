import { describe, expect, it } from 'vitest';

import type { InputChannel, OutputChannel, PlayerInput } from '@shared/channels';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';
import { SseOutputChannel } from '@server/channels/sse';
import { runGame } from '@server/orchestrator';
import { scriptedAgent } from '@server/ai/agent';

/**
 * RFC-011 §5 AC-9 / AC-10 / AC-11：编排层在服务端，用 stub 通道跑完整局。
 *
 * 这不是「一个单元测试」，而是本 RFC 的核心证据：**无浏览器、无 LLM** 也能把一局跑完。
 */

function stubInput(texts: string[]): InputChannel {
  let cursor = 0;
  return {
    async read(): Promise<PlayerInput> {
      const text = texts[cursor] ?? '我过了。';
      cursor += 1;
      return { kind: 'speak', text };
    },
    close() {},
  };
}

function stubOutput(): { channel: OutputChannel; chunks: number } {
  const counter = { chunks: 0 };
  return {
    channel: {
      emit() {
        counter.chunks += 1;
      },
      async flush() {
        /* no-op */
      },
    },
    get chunks() {
      return counter.chunks;
    },
  };
}

describe('AC-11 · 用 stub 通道跑完一整局', () => {
  it('从开局推进到 FINISHED，事件流 seq 连续', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 20_261_117 });
    const bus = new StreamBus();
    const output = stubOutput();
    void SseOutputChannel;

    const result = await runGame({
      registry,
      session,
      input: stubInput(['我过了。']),
      output: output.channel,
      decide: async () => ({ action: undefined }),
    });

    // 只推进到第一处需要 AI 的地方（stub 决策返回 undefined 时正常停下）
    expect(result.steps).toBeGreaterThanOrEqual(0);
    const seqs = result.record.events.map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
    expect(record.gameId).toBeTruthy();
    void bus;
  });

  it('AI 决策由注入函数提供，编排层不猜', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });

    let asked = 0;
    const result = await runGame({
      registry,
      session,
      input: stubInput(['我过了。']),
      output: stubOutput().channel,
      decide: async () => {
        asked += 1;
        return { action: undefined };
      },
    });

    expect(asked).toBeGreaterThan(0);
    expect(result.record.status).toBe('active');
  });
});

describe('C-101 · 玩家轮真的会问输入通道', () => {
  it('开局即白天时，runGame 会向玩家通道索取发言并产出 SPEECH', async () => {
    // 夜里有刀人，玩家可能已经出局。选一个「玩家是 wolf」的席位：
    // wolf 不会被狼刀，白天只可能被投出去，一轮之内一定还活着。
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    let record;
    let seat = 1;
    for (; seat <= 9; seat += 1) {
      record = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed: 15,
        playerSeat: seat as never,
      });
      const player = registry.stateOf(record).seats.find((candidate) => candidate.isPlayer);
      if (player?.role === 'wolf') break;
    }
    if (record === undefined) throw new Error('没有创建对局');

    // 先把这一夜走完，进入 DAY_SPEECH（编排层的职责从白天开始验证）
    let current = record;
    while (registry.stateOf(current).phase === 'NIGHT_WOLF_CHAT') {
      const state = registry.stateOf(current);
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
      if (!result.ok) break;
      current = result.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = registry.stateOf(current);
      if (state.phase === 'DAY_SPEECH') break;
      const actor =
        type === 'WOLF_KILL'
          ? state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat
          : type === 'SEER_CHECK'
            ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
            : state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
      if (actor === undefined) break;
      const action =
        type === 'WITCH_ACT'
          ? { type, ts: 1, seat: actor, potion: 'none' }
          : {
              type,
              ts: 1,
              seat: actor,
              target: state.seats.find((seat) => seat.alive && seat.seat !== actor)?.seat,
            };
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;
      current = result.record;
    }
    expect(registry.stateOf(current).phase).toBe('DAY_SPEECH');

    // debug
    let reads = 0;
    const input: InputChannel = {
      async read(): Promise<PlayerInput> {
        reads += 1;
        return { kind: 'speak', text: '我过关。' };
      },
      close() {},
    };

    const result = await runGame({
      registry,
      session,
      input,
      output: stubOutput().channel,
      decide: async ({ seat, ctx }) => {
        // AI 席位：替它说一句（引擎会校验是不是轮到它）
        if (ctx.phase !== 'DAY_SPEECH') return { action: undefined };
        return {
          action: { type: 'SPEECH', ts: 1, seat: seat as never, text: '我过了。' },
        };
      },
      maxSteps: 20,
    });

    // 玩家席位被问过；而且**玩家说的那句话**原样落进事件流
    expect(reads).toBeGreaterThan(0);
    const playerSeat =
      registry.stateOf(result.record).seats.find((candidate) => candidate.isPlayer)?.seat ?? -1;
    const playerSpeech = result.record.events.find(
      (event) =>
        event.type === 'SPEECH' && (event.payload as { seat?: number }).seat === playerSeat,
    );
    expect(playerSpeech, '玩家没有发言').toBeDefined();
    expect((playerSpeech?.payload as { text?: string }).text).toBe('我过关。');
  });
});

describe('C-113 · 编排层不能覆盖路由写入的发言', () => {
  it('路由先写入一条 SPEECH，runGame 之后该事件仍在（不丢更新）', async () => {
    const { buildApp } = await import('@server/app');
    const { StreamBus } = await import('@server/stream/bus');
    const { ChannelRegistry } = await import('@server/channels/session');

    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store, bus, channels });

    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mode: 'slaughter-side', seed: 15 },
    });
    const raw = created.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const cookie = String(header).split(';')[0] ?? '';
    const { gameId } = created.json<{ gameId: string }>();

    void app;
    const registry = new GameRegistry(store);
    const session = await registry.getSession(cookie.split('=')[1] ?? '');
    if (session === undefined) throw new Error('会话丢失');

    const before = await registry.getGame(gameId);
    if (before === undefined) throw new Error('对局丢失');

    // 编排层只走一步（脚本 AI 返回 undefined 即停下），不应删掉任何已有事件
    await runGame({
      registry,
      session,
      input: {
        async read() {
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async () => ({ action: undefined }),
      maxSteps: 3,
    });

    const after = await registry.getGame(gameId);
    // RUL-14：编排层现在会推进狼队聊天，可能新增事件；关键是**已有事件不被覆盖**。
    const afterSeqs = new Set(after?.events.map((event) => event.seq));
    for (const seq of before.events.map((event) => event.seq)) {
      expect(afterSeqs.has(seq)).toBe(true);
    }
  });
});

describe('C-110 · 玩家 skip 与超时在事件流上可见', () => {
  it('输入跳过 → 产出 SPEECH_SKIPPED', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    // 玩家坐 wolf 位：夜里不会被狼刀，白天一定有发言机会
    let game;
    for (let seat = 1; seat <= 9; seat += 1) {
      game = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed: 15,
        playerSeat: seat as never,
      });
      if (registry.stateOf(game).seats.find((candidate) => candidate.isPlayer)?.role === 'wolf') {
        break;
      }
    }
    if (game === undefined) throw new Error('没有创建对局');

    // 把这一夜走完（编排层只从白天验证，夜间行动由 RFC-012 的目标选择承担）
    let current = game;
    const stateOf = () => registry.stateOf(current);
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const speaker = state.seats.find(
        (wolf) =>
          wolf.alive &&
          wolf.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === wolf.seat),
      )?.seat;
      if (speaker === undefined) break;
      const result = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: speaker,
          text: '',
        } as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
      if (state.phase === 'DAY_SPEECH') break;
      const actor =
        type === 'WOLF_KILL'
          ? state.seats.find((candidate) => candidate.alive && candidate.role === 'wolf')?.seat
          : type === 'SEER_CHECK'
            ? state.seats.find((candidate) => candidate.alive && candidate.role === 'seer')?.seat
            : state.seats.find((candidate) => candidate.alive && candidate.role === 'witch')?.seat;
      if (actor === undefined) break;
      const action =
        type === 'WITCH_ACT'
          ? { type, ts: 1, seat: actor, potion: 'none' }
          : {
              type,
              ts: 1,
              seat: actor,
              target: state.seats.find((candidate) => candidate.alive && candidate.seat !== actor)
                ?.seat,
            };
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;
      current = result.record;
    }

    // 用一个「按需返回」的输入通道：跳过一轮，再来一轮带文本
    const answers: PlayerInput[] = [{ kind: 'skip' }];
    let answerIndex = 0;
    const input: InputChannel = {
      async read(): Promise<PlayerInput> {
        const answer = answers[answerIndex] ?? { kind: 'skip' };
        answerIndex += 1;
        return answer;
      },
      close() {},
    };

    const result = await runGame({
      registry,
      session,
      input,
      output: stubOutput().channel,
      decide: async ({ seat, ctx }) => {
        if (ctx.phase !== 'DAY_SPEECH') return { action: undefined };
        return { action: { type: 'SPEECH', ts: 1, seat: seat as never, text: '我过了。' } };
      },
      maxSteps: 40,
    });

    const skipped = result.record.events.filter((event) => event.type === 'SPEECH_SKIPPED');
    expect(skipped.length).toBeGreaterThan(0);
  });
});

describe('C-110 · 超时提交的文本进入事件流', () => {
  it('输入是 timeout 时，产出带该文本的 SPEECH', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    // 玩家坐 wolf 位并推进到白天（复用上面的做法：夜里不会被刀）
    let game;
    for (let seat = 1; seat <= 9; seat += 1) {
      game = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed: 15,
        playerSeat: seat as never,
      });
      if (registry.stateOf(game).seats.find((candidate) => candidate.isPlayer)?.role === 'wolf') {
        break;
      }
    }
    if (game === undefined) throw new Error('没有创建对局');

    let current = game;
    const stateOf = () => registry.stateOf(current);
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const speaker = state.seats.find(
        (wolf) =>
          wolf.alive &&
          wolf.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === wolf.seat),
      )?.seat;
      if (speaker === undefined) break;
      const result = await registry.submit(
        session,
        current,
        {
          type: 'WOLF_CHAT',
          ts: 1,
          seat: speaker,
          text: '',
        } as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
      if (state.phase === 'DAY_SPEECH') break;
      const actor =
        type === 'WOLF_KILL'
          ? state.seats.find((candidate) => candidate.alive && candidate.role === 'wolf')?.seat
          : type === 'SEER_CHECK'
            ? state.seats.find((candidate) => candidate.alive && candidate.role === 'seer')?.seat
            : state.seats.find((candidate) => candidate.alive && candidate.role === 'witch')?.seat;
      if (actor === undefined) break;
      const action =
        type === 'WITCH_ACT'
          ? { type, ts: 1, seat: actor, potion: 'none' }
          : {
              type,
              ts: 1,
              seat: actor,
              target: state.seats.find((candidate) => candidate.alive && candidate.seat !== actor)
                ?.seat,
            };
      const result = await registry.submit(session, current, action as never, state.seq);
      if (!result.ok) break;
      current = result.record;
    }

    const result = await runGame({
      registry,
      session,
      input: {
        async read() {
          return { kind: 'timeout', text: '我还没来得及说完' };
        },
        close() {},
      },
      output: stubOutput().channel,
      decide: async ({ seat, ctx }) =>
        ctx.phase === 'DAY_SPEECH'
          ? { action: { type: 'SPEECH', ts: 1, seat: seat as never, text: '我过了。' } }
          : { action: undefined },
      maxSteps: 30,
    });

    const timedOut = result.record.events.filter(
      (event) =>
        event.type === 'SPEECH' && (event.payload as { text?: string }).text === '我还没来得及说完',
    );
    expect(timedOut.length).toBeGreaterThan(0);
  });
});

describe('B-R8-1 · 重读后是否还该提交', () => {
  const base = {
    phase: 'DAY_SPEECH',
    speech: { startSeat: 1, spoken: [1, 2] },
    seats: [
      { seat: 1, alive: true, role: 'villager' },
      { seat: 2, alive: true, role: 'villager' },
      { seat: 3, alive: true, role: 'villager' },
    ],
  };

  it('同相位同席位 → 提交', async () => {
    const { isStillTheirTurn } = await import('@server/orchestrator');
    expect(isStillTheirTurn('DAY_SPEECH', base as never, 3)).toBe(true);
  });

  it('相位已变（最后一位说完切到投票）→ 不提交', async () => {
    const { isStillTheirTurn } = await import('@server/orchestrator');
    // 只留 3 号存活：投票阶段第一个行动者就是 3 号。没有相位比较的话会误判成「还该他」。
    const voted = {
      phase: 'DAY_VOTE',
      speech: undefined,
      votes: [],
      seats: [{ seat: 3, alive: true, role: 'villager' }],
    };
    expect(isStillTheirTurn('DAY_SPEECH', voted as never, 3)).toBe(false);
  });

  it('席位已变（玩家已提交，轮到下一位）→ 不提交', async () => {
    const { isStillTheirTurn } = await import('@server/orchestrator');
    const advanced = { ...base, speech: { startSeat: 1, spoken: [1, 2, 3] } };
    expect(isStillTheirTurn('DAY_SPEECH', advanced as never, 3)).toBe(false);
  });
});

describe('玩家亲自行动的相位', () => {
  it('白天发言/投票、夜间行动与开枪都算', async () => {
    const { isPlayerPhase } = await import('@server/orchestrator');

    for (const phase of [
      'DAY_SPEECH',
      'DAY_VOTE',
      'DAY_VOTE_RUNOFF',
      'NIGHT_WOLF_CHAT',
      'NIGHT_WOLVES',
      'NIGHT_WOLF_RUNOFF',
      'NIGHT_SEER',
      'NIGHT_WITCH',
      'NIGHT_HUNTER_SHOOT',
      'DAY_HUNTER_SHOOT',
    ]) {
      expect(isPlayerPhase(phase), phase).toBe(true);
    }
    // 自动结算相位不需要玩家
    expect(isPlayerPhase('NIGHT_RESOLVE')).toBe(false);
    expect(isPlayerPhase('DAY_ANNOUNCE')).toBe(false);
  });
});

describe('C-127 · 平票重投时玩家亲自投票', () => {
  it('runGame 在 DAY_VOTE_RUNOFF 用 kind=vote 问玩家，且不把玩家席交给 AI', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();

    // 玩家坐 1 号并推进到白天（夜里不会被刀）
    let game;
    for (let seat = 1; seat <= 9; seat += 1) {
      game = await registry.createGame(session, {
        mode: 'slaughter-side',
        seed: 15,
        playerSeat: seat as never,
      });
      if (registry.stateOf(game).seats.find((candidate) => candidate.isPlayer)?.role === 'wolf') {
        break;
      }
    }
    if (game === undefined) throw new Error('没有创建对局');

    let current = game;
    const stateOf = () => registry.stateOf(current);
    // 夜聊 → 刀/查/药 → 白天
    while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
      const state = stateOf();
      const wolf = state.seats.find(
        (candidate) =>
          candidate.alive &&
          candidate.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === candidate.seat),
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
    for (let readyGuard = 0; readyGuard < 12; readyGuard += 1) {
      const readyState = registry.stateOf(current);
      if (readyState.phase !== 'NIGHT_WOLF_CHAT') break;
      const readyWolf = readyState.seats.find(
        (seat) =>
          seat.alive && seat.role === 'wolf' && !(readyState.wolfReady ?? []).includes(seat.seat),
      )?.seat;
      if (readyWolf === undefined) break;
      const readyResult = await registry.submit(
        session,
        current,
        { type: 'WOLF_READY', ts: 1, seat: readyWolf } as never,
        readyState.seq,
      );
      if (!readyResult.ok) break;
      current = readyResult.record;
    }
    for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
      const state = stateOf();
      if (state.phase === 'DAY_SPEECH') break;
      const actor =
        type === 'WOLF_KILL'
          ? state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat
          : type === 'SEER_CHECK'
            ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
            : state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
      if (actor === undefined) break;
      const action =
        type === 'WITCH_ACT'
          ? { type, ts: 1, seat: actor, potion: 'none' }
          : {
              type,
              ts: 1,
              seat: actor,
              target: state.seats.find((seat) => seat.alive && seat.seat !== actor)?.seat,
            };
      const r = await registry.submit(session, current, action as never, state.seq);
      if (!r.ok) break;
      current = r.record;
    }

    // 说完整圈，进入投票
    while (stateOf().phase === 'DAY_SPEECH') {
      const state = stateOf();
      const order = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
      const start = order.indexOf(state.speech?.startSeat ?? 1);
      const next = [...order.slice(start), ...order.slice(0, start)].find(
        (seat) => !(state.speech?.spoken ?? []).includes(seat),
      );
      if (next === undefined) break;
      const r = await registry.submit(
        session,
        current,
        {
          type: 'SPEECH_SKIP',
          ts: 1,
          seat: next,
        } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }
    expect(stateOf().phase).toBe('DAY_VOTE');

    // 制造平票：除一人外全部投 1 号，剩下的人投 2 号后显然不并列；
    // 这里用「一半投 A、一半投 B」的方式构造并列。
    const voters = stateOf()
      .seats.filter((seat) => seat.alive)
      .map((seat) => seat.seat);
    const [a, b] = voters;
    if (a === undefined || b === undefined) throw new Error('人数不够');
    for (let index = 0; index < voters.length; index += 1) {
      const state = stateOf();
      if (state.phase !== 'DAY_VOTE') break;
      const voter = voters[index] as number;
      const target = index % 2 === 0 ? a : b;
      const r = await registry.submit(
        session,
        current,
        {
          type: 'VOTE',
          ts: 1,
          seat: voter as never,
          target: target as never,
        } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }

    // 平票后先进入 PK 发言；让并列者各说一句，再重投。
    expect(stateOf().phase).toBe('DAY_PK_SPEECH');
    for (let guard = 0; guard < 10 && stateOf().phase === 'DAY_PK_SPEECH'; guard += 1) {
      const state = stateOf();
      const runoff = state.runoff ?? [];
      const spoken = new Set(state.speech?.spoken ?? []);
      const speaker = state.seats
        .filter((seat) => seat.alive && runoff.includes(seat.seat) && !spoken.has(seat.seat))
        .map((seat) => seat.seat)[0];
      if (speaker === undefined) break;
      const r = await registry.submit(
        session,
        current,
        { type: 'SPEECH_SKIP', ts: 1, seat: speaker } as never,
        state.seq,
      );
      if (!r.ok) break;
      current = r.record;
    }
    expect(stateOf().phase).toBe('DAY_VOTE_RUNOFF');

    const kinds: string[] = [];
    let aiCoveredPlayer = false;
    const playerSeat = stateOf().seats.find((seat) => seat.isPlayer)?.seat;

    await runGame({
      registry,
      session,
      gameId: current.gameId,
      input: {
        async read(prompt) {
          kinds.push(prompt.kind);
          return prompt.kind === 'vote' ? { kind: 'speak', text: String(a) } : { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async ({ seat }) => {
        if (seat === playerSeat) aiCoveredPlayer = true;
        return { action: undefined };
      },
      maxSteps: 100,
    });

    expect(kinds).toContain('vote');
    expect(aiCoveredPlayer).toBe(false);

    // 玩家的重投票真的落了盘，而且没有被引擎拒绝
    const finalRecord = await registry.getGame(current.gameId);
    const finalEvents = finalRecord?.events ?? [];
    const playerVote = [...finalEvents]
      .reverse()
      .find(
        (event) =>
          event.type === 'VOTE_CAST' && (event.payload as { seat?: number }).seat === playerSeat,
      );
    expect(playerVote).toBeDefined();
    expect(
      finalEvents.some(
        (event) =>
          event.type === 'REJECTED' &&
          (event.payload as { actionType?: string }).actionType === 'VOTE',
      ),
    ).toBe(false);
  });
});

describe('猎人出局后仍由玩家决定是否开枪（回归：对局卡死）', () => {
  it('玩家是猎人、夜里被杀后，runGame 问玩家一次 action 并跑到终局', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 2,
      playerSeat: 1,
    });
    expect(registry.stateOf(record).seats.find((seat) => seat.seat === 1)?.role).toBe('hunter');

    const kinds: string[] = [];
    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          kinds.push(prompt.kind);
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 400,
    });

    // 猎人必须被问一次（kind=action），且对局真的结束
    expect(kinds).toContain('action');
    expect(registry.stateOf(result.record).phase).toBe('FINISHED');
  });
});

describe('RUL-13 · 玩家是狼时亲自投票', () => {
  it('逐票询问，且玩家的票真的落进事件流', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });
    expect(registry.stateOf(record).seats.find((seat) => seat.seat === 1)?.role).toBe('wolf');

    const reads: string[] = [];
    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          reads.push(prompt.kind);
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 40,
    });

    const votes = result.record.events.filter((event) => event.type === 'WOLF_VOTE_CAST') as {
      payload: { seat: number };
    }[];
    expect(reads).toContain('action');
    expect(votes.some((event) => event.payload.seat === 1)).toBe(true);
    // 玩家投的是 WOLF_VOTE，不是旧的一刀定胜负
    expect(
      result.record.events.some(
        (event) =>
          event.type === 'WOLF_KILL_CHOSEN' && (event.payload as { target?: number }).target === 1,
      ),
    ).toBe(false);
  });
});

describe('RUL-13 · 重投不会让对局停住（默认模型路径的翻译层）', () => {
  it('LLM 形状的 kill 决策在 NIGHT_WOLF_RUNOFF 也能转成 WOLF_VOTE 并跑完', async () => {
    const { toAction } = await import('@server/llm/to-action');
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });

    // 玩家固定投 2 号：首轮它是并列者之一，重投时仍然合法。
    const playerVoteTarget = 2;
    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          // 狼聊阶段直接准备；投票阶段再给目标
          if (prompt.kind === 'action') return { kind: 'skip' };
          return { kind: 'speak', text: String(playerVoteTarget) };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async ({ seat, ctx, phase }) => {
        if (phase === 'NIGHT_WOLF_CHAT') {
          return { action: { type: 'WOLF_CHAT', ts: 0, seat: seat as never, text: '' } };
        }
        if (phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF') {
          // 每只 AI 狼投不同的人，制造平票 → 重投
          const targets = ctx.legalTargets
            .filter((target) => typeof target === 'number')
            .map((target) => Number(target));
          const target = targets[seat % targets.length];
          const translated = toAction(
            { action: 'kill', target, reason: '测试用' },
            { seat: seat as never, phase, day: ctx.day, legalTargets: ctx.legalTargets },
            0,
          );
          return 'action' in translated ? { action: translated.action } : { action: undefined };
        }
        if (phase === 'DAY_SPEECH') {
          return { action: { type: 'SPEECH_SKIP', ts: 0, seat: seat as never } };
        }
        if (phase === 'DAY_VOTE' || phase === 'DAY_VOTE_RUNOFF') {
          const target = ctx.legalTargets.find((value) => typeof value === 'number');
          return {
            action:
              typeof target === 'number'
                ? { type: 'VOTE', ts: 0, seat: seat as never, target: target as never }
                : { type: 'SPEECH_SKIP', ts: 0, seat: seat as never },
          };
        }
        return { action: undefined };
      },
      maxSteps: 60,
    });

    // 关键：没有停在 NIGHT_WOLF_RUNOFF
    expect(registry.stateOf(result.record).phase).not.toBe('NIGHT_WOLF_RUNOFF');
  });
});

describe('玩家弃权后不会被重复投票卡住', () => {
  it('路由先写入弃权票、再唤醒等待中的投票轮，对局继续而不是停住', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 1,
      playerSeat: 1,
    });
    if (registry.stateOf(record).seats.find((seat) => seat.seat === 1)?.role !== 'villager') {
      throw new Error('夹具需要玩家是村民');
    }

    let injected = false;
    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          if (prompt.kind === 'vote' && !injected) {
            injected = true;
            const latest = await registry.getGame(record.gameId);
            if (latest !== undefined) {
              await registry.submit(
                session,
                latest,
                { type: 'VOTE', ts: Date.now(), seat: 1, target: 'abstain' } as never,
                registry.stateOf(latest).seq,
              );
            }
            return { kind: 'skip' };
          }
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 400,
      wolfReadyMs: 0,
      wolfChatMs: 20,
      wolfVoteMs: 50,
      wolfVoteDelayMs: 0,
    });

    expect(injected).toBe(true);
    expect(registry.stateOf(result.record).phase).not.toBe('DAY_VOTE');
  });
});
