import { describe, expect, it } from 'vitest';

import type { InputChannel, PlayerInput } from '@shared/channels';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { runGame } from '@server/orchestrator';
import { scriptedAgent } from '@server/ai/agent';

/**
 * RFC-011 §5 AC-11 / AC-12：用 stub 通道在**无浏览器、无 LLM** 的情况下
 * 把一局真正跑完（到 FINISHED），并证明 AI 看到的是**自己的**投影（SEC-5）。
 */

function stubInput(text: string): InputChannel {
  return {
    async read(): Promise<PlayerInput> {
      return { kind: 'speak', text };
    },
    close() {},
  };
}

describe('AC-11 · stub 通道把一局跑完', () => {
  it('推进到 FINISHED，且事件流 seq 连续', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const created = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 20_261_117,
      playerSeat: 1,
    });

    const result = await runGame({
      registry,
      session,
      input: stubInput('我过关。'),
      output: { emit() {}, async flush() {} },
      decide: async ({ seat, ctx }) => {
        const record = await registry.getGame(created.gameId);
        if (record === undefined) return { action: undefined };
        const state = registry.stateOf(record);
        return scriptedAgent({ seat, ctx, phase: state.phase });
      },
      maxSteps: 400,
    });

    expect(result.record.status).toBe('finished');
    const seqs = result.record.events.map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
  });
});

describe('SEC-5 · AI 只能看到自己的投影', () => {
  it('decide 收到的 ctx.self.seat 恒等于被问的席位', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const created = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 20_261_117,
      playerSeat: 1,
    });

    const mismatches: { asked: number; self: number }[] = [];
    let asked = 0;

    await runGame({
      registry,
      session,
      input: stubInput('我过关。'),
      output: { emit() {}, async flush() {} },
      decide: async ({ seat, ctx }) => {
        asked += 1;
        if (ctx.self.seat !== seat) mismatches.push({ asked: seat, self: ctx.self.seat });
        const record = await registry.getGame(created.gameId);
        if (record === undefined) return { action: undefined };
        return scriptedAgent({ seat, ctx, phase: registry.stateOf(record).phase });
      },
      maxSteps: 60,
    });

    expect(asked).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});
