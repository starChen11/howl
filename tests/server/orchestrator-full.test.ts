import { describe, expect, it } from 'vitest';

import type { InputChannel, PlayerInput } from '@shared/channels';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { runGame } from '@server/orchestrator';

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
        return { action: scriptFor(state as never, seat, ctx.legalTargets) as never };
      },
      maxSteps: 400,
    });

    expect(result.record.status).toBe('finished');
    const seqs = result.record.events.map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
  });
});

/** 按阶段给一个合法动作（脚本化 AI，不需要模型）。 */
function scriptFor(
  state: {
    phase: string;
    seats: { seat: number; alive: boolean; role: string }[];
    votes?: { seat: number }[];
    wolfChat?: { seat: number }[];
  },
  seat: number,
  legalTargets: (number | 'abstain')[],
) {
  const first = legalTargets[0];
  const target = (exclude?: number) =>
    (typeof first === 'number'
      ? first
      : (state.seats.find((candidate) => candidate.alive && candidate.seat !== exclude)?.seat ??
        1)) as never;

  switch (state.phase) {
    case 'NIGHT_WOLF_CHAT':
      return { type: 'WOLF_CHAT', ts: 1, seat: seat as never, text: '今晚刀他' };
    case 'NIGHT_WOLVES':
      return { type: 'WOLF_KILL', ts: 1, seat: seat as never, target: target(seat) };
    case 'NIGHT_SEER':
      return { type: 'SEER_CHECK', ts: 1, seat: seat as never, target: target(seat) };
    case 'NIGHT_WITCH':
      return { type: 'WITCH_ACT', ts: 1, seat: seat as never, potion: 'none' };
    case 'DAY_SPEECH':
      return { type: 'SPEECH', ts: 1, seat: seat as never, text: '我过了。' };
    case 'DAY_VOTE':
      return { type: 'VOTE', ts: 1, seat: seat as never, target: target(seat) };
    case 'DAY_VOTE_RUNOFF':
      return {
        type: 'VOTE',
        ts: 1,
        seat: seat as never,
        target: (state as never as { runoff: number[] }).runoff?.[0] ?? target(seat),
      };
    default:
      return undefined;
  }
}

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
        return {
          action: scriptFor(registry.stateOf(record) as never, seat, ctx.legalTargets) as never,
        };
      },
      maxSteps: 60,
    });

    expect(asked).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});
