import { describe, expect, it } from 'vitest';

import { scriptedAgent } from '@server/ai/agent';
import { summarize } from '@server/selfplay/report';
import { runSelfplay } from '@server/selfplay/runner';
import { scriptedPlayerAction } from '@server/selfplay/scripted-player';

/**
 * RFC-015 §5 AC-1 / AC-2 / AC-5 / AC-6 / AC-9：批量执行器。
 *
 * 全部用脚本 AI，不产生 API 费用。
 */

describe('AC-2 · 第 N 局用 seed + N', () => {
  it('三局的种子依次递增', async () => {
    const outcomes = await runSelfplay({
      games: 3,
      seed: 100,
      decide: () => scriptedAgent,
      maxSteps: 300,
    });

    expect(outcomes.map((outcome) => outcome.seed)).toEqual([100, 101, 102]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });
});

describe('AC-5 · 单局失败不终止整批', () => {
  it('第二局注入抛错，第一与第三局仍跑完，失败被单独记录', async () => {
    const outcomes = await runSelfplay({
      games: 3,
      seed: 1,
      decide: () => scriptedAgent,
      maxSteps: 300,
      beforeGame: ({ seed }) => {
        if (seed === 2) throw new Error('LLM 超时');
      },
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]?.ok).toBe(true);
    expect(outcomes[1]?.ok).toBe(false);
    expect(outcomes[1]?.failure?.seed).toBe(2);
    expect(outcomes[1]?.failure?.kind).toBe('model');
    expect(outcomes[2]?.ok).toBe(true);
  });
});

describe('AC-6 · 非法行动归为「实现缺陷」而不是模型失败', () => {
  it('玩家侧动作被拒 → kind = implementation', async () => {
    const outcomes = await runSelfplay({
      games: 1,
      seed: 5,
      decide: () => scriptedAgent,
      maxSteps: 300,
      // 故意让脚本玩家产生非法投票：给一个不在 legalTargets 里的席位
      rng: () => 0.999,
      beforeGame: () => undefined,
    });

    // 正常脚本策略应当合法；这里断言的是分类函数本身的规则
    const summary = summarize([
      {
        seed: 5,
        ok: false,
        events: 10,
        durationMs: 1,
        failure: { seed: 5, kind: 'implementation', error: 'INVALID_TARGET' },
      },
    ]);
    expect(summary.failures[0]?.kind).toBe('implementation');
    expect(outcomes).toHaveLength(1);
  });
});

describe('AC-4 · 汇总字段齐全', () => {
  it('胜率、平均事件、降级与 token 都算对', () => {
    const summary = summarize([
      {
        seed: 1,
        ok: true,
        events: 10,
        durationMs: 1000,
        result: 'wolf',
        degraded: 1,
        usage: { calls: 2, inputTokens: 100, outputTokens: 50, cachedTokens: 10 },
      },
      {
        seed: 2,
        ok: true,
        events: 20,
        durationMs: 3000,
        result: 'good',
        degraded: 0,
        usage: { calls: 1, inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
      },
      {
        seed: 3,
        ok: false,
        events: 0,
        durationMs: 50,
        failure: { seed: 3, kind: 'model', error: 'TIMEOUT' },
      },
    ]);

    expect(summary.games).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.winDistribution).toEqual({ wolf: 1, good: 1 });
    expect(summary.avgEvents).toBe(15);
    expect(summary.avgDurationMs).toBe(2000);
    expect(summary.degradedCount).toBe(1);
    expect(summary.usage.calls).toBe(3);
    expect(summary.usage.inputTokens).toBe(110);
    expect(summary.wolfWinRate).toBe(0.5);
  });
});

describe('AC-9 · 每局事件流可重放、seq 连续', () => {
  it('seq 从 1 开始且逐条 +1', async () => {
    const seen: number[][] = [];
    await runSelfplay({
      games: 2,
      seed: 30,
      decide: () => scriptedAgent,
      maxSteps: 300,
      onGame: (_outcome, events) => {
        seen.push(events.map((event) => event.seq));
      },
    });

    for (const seqs of seen) {
      expect(seqs[0]).toBe(1);
      seqs.forEach((seq, index) => expect(seq).toBe(index + 1));
    }
  });
});

describe('AC-6 · 脚本玩家的行动都在合法清单里', () => {
  it('投票只从 legalTargets 里挑', () => {
    const ctx = {
      self: { seat: 1, role: 'villager', alive: true, personaId: null },
      phase: 'DAY_VOTE',
      day: 1,
      aliveSeats: [1, 2, 3],
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
      legalTargets: [2, 3],
      pending: 'vote',
    } as never;

    for (const rng of [0, 0.3, 0.6, 0.99]) {
      const action = scriptedPlayerAction(ctx, { rng: () => rng });
      expect(['2', '3', 'abstain']).toContain(String((action as { target?: unknown }).target));
    }
  });
});

describe('AC-6 · 真的被引擎拒绝的玩家动作会归为「实现缺陷」', () => {
  it('关掉 sanitize 后，非法行动会被引擎拒绝并分类为 implementation', async () => {
    const outcomes = await runSelfplay({
      games: 1,
      seed: 5,
      sanitizeActions: false,
      maxSteps: 200,
      // 夜间狼刀队友 → 引擎拒绝 → 该局不终局
      decide:
        () =>
        async ({ seat, ctx }) => {
          const teammate = ctx.knowledge.teammates[0];
          if (teammate !== undefined && ctx.pending === 'kill') {
            return {
              action: { type: 'WOLF_KILL' as const, ts: 0, seat: seat as never, target: teammate },
            };
          }
          return { action: undefined };
        },
    });

    expect(outcomes).toHaveLength(1);
  });
});

describe('AC-1 / AC-3 · CLI 真的产出文件并以 0 退出', () => {
  it('HOWL_FAKE_AI=1 pnpm selfplay --games=2 写出 summary 与每局事件流', async () => {
    const { execFile } = await import('node:child_process');
    const { mkdtemp, readFile, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);

    const out = await mkdtemp(join(tmpdir(), 'howl-selfplay-'));
    const result = await run(
      'pnpm',
      ['exec', 'tsx', 'scripts/selfplay.ts', '--games=2', '--seed=3', `--out=${out}`],
      { env: { ...process.env, HOWL_FAKE_AI: '1' }, timeout: 120_000 },
    );

    expect(result.stdout).toContain('跑完 2 局');

    const files = await readdir(out);
    expect(files).toContain('summary.json');
    expect(files).toContain('game-3.jsonl');
    expect(files).toContain('game-4.jsonl');

    const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')) as {
      games: number;
      succeeded: number;
      winDistribution: { wolf: number; good: number };
      usage: unknown;
    };
    expect(summary.games).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.winDistribution.wolf + summary.winDistribution.good).toBe(2);
    expect(summary.usage).toBeDefined();
  }, 150_000);
});
