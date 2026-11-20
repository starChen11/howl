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
