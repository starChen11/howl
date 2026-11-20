import { describe, expect, it } from 'vitest';

import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { runGame } from '@server/orchestrator';
import { scriptedAgent } from '@server/ai/agent';

/**
 * RFC-018 / RUL-14：狼队讨论是限时聊天室。
 *
 * 用极短时限验证：玩家一直不说话 → 讨论到点自动准备；投票到点自动弃权。
 */
describe('RUL-14 · 讨论与投票的时限', () => {
  async function runWithSilentPlayer() {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });
    expect(registry.stateOf(record).seats.find((seat) => seat.seat === 1)?.role).toBe('wolf');

    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          await new Promise((resolve) => setTimeout(resolve, prompt.timeoutMs ?? 1));
          return { kind: 'timeout', text: '' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      wolfChatMs: 20,
      wolfReadyMs: 0,
      wolfVoteMs: 20,
      maxSteps: 8,
    });

    return { registry, result };
  }

  it('讨论超时 → 未准备的玩家被代准备，相位推进', async () => {
    const { registry, result } = await runWithSilentPlayer();
    const ready = result.record.events.filter((event) => event.type === 'WOLF_READY_MARKED');

    expect(ready.some((event) => (event.payload as { seat: number }).seat === 1)).toBe(true);
    expect(registry.stateOf(result.record).phase).not.toBe('NIGHT_WOLF_CHAT');
  }, 20_000);

  it('投票超时 → 玩家那一票记为弃权', async () => {
    const { result } = await runWithSilentPlayer();
    const casts = result.record.events.filter((event) => event.type === 'WOLF_VOTE_CAST');

    expect(
      casts.some((event) => {
        const payload = event.payload as { seat: number; target: string };
        return payload.seat === 1 && payload.target === 'abstain';
      }),
    ).toBe(true);
  }, 20_000);
});

describe('RFC-018 AC-8 · AI 能看到玩家刚发的消息', () => {
  it('玩家发言后，AI 的投影里包含这条 WOLF_CHAT_POSTED', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });
    const seen: unknown[][] = [];
    let reads = 0;

    await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read() {
          reads += 1;
          return reads === 1 ? { kind: 'speak', text: '队友们，今晚刀 5 号' } : { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async (input) => {
        if (input.phase === 'NIGHT_WOLF_CHAT') {
          seen.push(input.ctx.privateEvents as never[]);
          return {
            action: {
              type: 'WOLF_CHAT',
              ts: 0,
              seat: input.seat as never,
              text: '收到',
            },
          };
        }
        return scriptedAgent(input);
      },
      wolfChatMs: 2_000,
      wolfReadyMs: 0,
      wolfVoteMs: 50,
      maxSteps: 6,
    });

    const sawPlayerMessage = seen.some((events) =>
      events.some(
        (event) =>
          (event as { type: string }).type === 'WOLF_CHAT_POSTED' &&
          (event as { payload: { seat: number; text: string } }).payload.seat === 1,
      ),
    );
    expect(sawPlayerMessage).toBe(true);
  }, 20_000);
});

describe('RFC-018 B1 · 重投超时不能弃权', () => {
  it('玩家在重投里超时 → 自动投并列者，而不是弃权', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });
    let reads = 0;

    const result = await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read() {
          reads += 1;
          return reads === 1 ? { kind: 'skip' } : { kind: 'timeout', text: '' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async (input) => {
        if (input.phase === 'NIGHT_WOLF_CHAT') {
          return {
            action: { type: 'WOLF_CHAT', ts: 0, seat: input.seat as never, text: '' },
          };
        }
        if (input.phase === 'NIGHT_WOLVES' || input.phase === 'NIGHT_WOLF_RUNOFF') {
          const targets = input.ctx.legalTargets
            .filter((candidate) => typeof candidate === 'number')
            .map((candidate) => Number(candidate));
          const target = targets[input.seat % targets.length];
          return target === undefined
            ? { action: undefined }
            : {
                action: {
                  type: 'WOLF_VOTE',
                  ts: 0,
                  seat: input.seat as never,
                  target: target as never,
                },
              };
        }
        return scriptedAgent(input);
      },
      wolfChatMs: 300,
      wolfReadyMs: 0,
      wolfVoteMs: 30,
      maxSteps: 8,
    });

    expect(registry.stateOf(result.record).phase).not.toBe('NIGHT_WOLF_RUNOFF');
    const casts = result.record.events
      .filter((event) => event.type === 'WOLF_VOTE_CAST')
      .map((event) => event.payload as { seat: number; target: string | number })
      .filter((payload) => payload.seat === 1);
    // 第一轮弃权、重投那一票必须是合法目标
    expect(casts.some((payload) => payload.target !== 'abstain')).toBe(true);
  }, 20_000);
});
