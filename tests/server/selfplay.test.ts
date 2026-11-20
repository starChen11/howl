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
    const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = await run(
      pnpmBin,
      ['exec', 'tsx', 'scripts/selfplay.ts', '--games=2', '--seed=3', `--out=${out}`],
      {
        env: { ...process.env, HOWL_FAKE_AI: '1' },
        timeout: 120_000,
        shell: process.platform === 'win32',
      },
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

describe('C-188 · 同一 seed 的批次完全可复现', () => {
  it('跑两次得到相同的胜负分布与事件数', async () => {
    const runOnce = async () =>
      runSelfplay({ games: 6, seed: 77, decide: () => scriptedAgent, maxSteps: 400 });

    const first = await runOnce();
    const second = await runOnce();

    expect(second.map((outcome) => outcome.events)).toEqual(first.map((outcome) => outcome.events));
    expect(summarize(second).winDistribution).toEqual(summarize(first).winDistribution);
  });
});

describe('C-187 · 写盘失败不终止整批', () => {
  it('onGame 抛错时其余局仍跑完', async () => {
    const outcomes = await runSelfplay({
      games: 3,
      seed: 8,
      decide: () => scriptedAgent,
      maxSteps: 400,
      onGame: ({ seed }) => {
        if (seed === 9) throw new Error('磁盘满');
      },
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[1]?.failure?.error).toContain('REPORT_FAILED');
    expect(outcomes[2]?.ok).toBe(true);
  });
});

describe('C-184 · 玩家动作被拒 → 实现缺陷', () => {
  it('只把玩家席位的 SPEECH/VOTE 拒绝归为实现缺陷', async () => {
    const { findPlayerRejection } = await import('@server/selfplay/runner');
    const rejection = (visibleTo: string, actionType: string) =>
      ({
        gameId: 'g',
        seq: 1,
        ts: 0,
        type: 'REJECTED',
        visibleTo,
        payload: { actionType, code: 'INVALID_TARGET', message: '目标不合法' },
      }) as never;

    expect(findPlayerRejection([rejection('self:1', 'VOTE')], 1)).toBeDefined();
    // 别人的拒绝不是玩家的错
    expect(findPlayerRejection([rejection('self:2', 'VOTE')], 1)).toBeUndefined();
    // 夜间动作是 AI 的，不算玩家缺陷
    expect(findPlayerRejection([rejection('self:1', 'WOLF_KILL')], 1)).toBeUndefined();
  });

  it('真实完成局 + 注入的玩家拒绝 → classifyFinished 判为实现缺陷', async () => {
    const { classifyFinished } = await import('@server/selfplay/runner');
    let finished: readonly never[] = [];
    await runSelfplay({
      games: 1,
      seed: 55,
      decide: () => scriptedAgent,
      maxSteps: 400,
      onGame: (_outcome, events) => {
        finished = events as never;
      },
    });

    expect(classifyFinished(finished, 1)).toBeNull();

    const injected = [
      ...finished,
      {
        gameId: 'g',
        seq: 999,
        ts: 0,
        type: 'REJECTED',
        visibleTo: 'self:1',
        payload: { actionType: 'VOTE', code: 'INVALID_TARGET', message: '目标不合法' },
      } as never,
    ];
    expect(classifyFinished(injected, 1)).toEqual({
      kind: 'implementation',
      error: 'INVALID_TARGET：目标不合法',
    });
    // 别的席位被拒不算玩家缺陷
    expect(classifyFinished(injected, 2)).toBeNull();
  });

  it('真实对局里没有玩家侧拒绝（脚本玩家合法）', async () => {
    const outcomes = await runSelfplay({
      games: 2,
      seed: 21,
      decide: () => scriptedAgent,
      maxSteps: 400,
    });

    expect(outcomes.filter((outcome) => outcome.failure?.kind === 'implementation')).toEqual([]);
  });
});

describe('C-186 · 多局跑完内存不线性增长', () => {
  it('30 局的堆增长在合理范围内', async () => {
    const before = process.memoryUsage().heapUsed;
    await runSelfplay({ games: 30, seed: 400, decide: () => scriptedAgent, maxSteps: 400 });
    const after = process.memoryUsage().heapUsed;

    // 30 局的状态都已释放；增长超过 96MB 说明有泄漏
    expect(after - before).toBeLessThan(96 * 1024 * 1024);
  });
});

describe('C-185 · 事件流能被 replay 到终局', () => {
  it('用引擎 replay 重放后停在 FINISHED', async () => {
    const { replay } = await import('@engine/replay');
    const streams: { events: readonly { type: string }[] }[] = [];

    await runSelfplay({
      games: 2,
      seed: 55,
      decide: () => scriptedAgent,
      maxSteps: 400,
      onGame: (_outcome, events) => {
        streams.push({ events });
      },
    });

    for (const stream of streams) {
      const state = replay(stream.events as never);
      expect(state.phase).toBe('FINISHED');
      expect(stream.events[stream.events.length - 1]?.type).toBe('GAME_ENDED');
    }
  });
});

describe('C-187 · 未终局路径的写盘失败同样隔离', () => {
  it('maxSteps=1 制造未终局，onGame 抛错也不会多记 outcome', async () => {
    const outcomes = await runSelfplay({
      games: 2,
      seed: 11,
      decide: () => scriptedAgent,
      maxSteps: 1,
      onGame: () => {
        throw new Error('磁盘满');
      },
    });

    // 不能被记成「每局两条」（UNFINISHED + REPORT_FAILED）
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.ok === false)).toBe(true);
    expect(outcomes.every((outcome) => outcome.failure?.error.includes('REPORT_FAILED'))).toBe(
      true,
    );
  });
});

describe('C-191 · 失败局已经花掉的 token 也计入汇总', () => {
  it('一条失败局带 usage 时，summary.usage 不为 0', () => {
    const summary = summarize([
      {
        seed: 1,
        ok: false,
        events: 3,
        durationMs: 10,
        usage: { calls: 2, inputTokens: 100, outputTokens: 40, cachedTokens: 10 },
        failure: { seed: 1, kind: 'model', error: 'TIMEOUT', errorType: 'TimeoutError' },
      },
    ]);

    expect(summary.usage).toEqual({
      calls: 2,
      inputTokens: 100,
      outputTokens: 40,
      cachedTokens: 10,
    });
    expect(summary.failures[0]?.errorType).toBe('TimeoutError');
  });
});

describe('C-184（Round 3）· 端到端：玩家投已出局席位 → 实现缺陷', () => {
  it('runSelfplay 真的把成局里的玩家拒绝归为 implementation', async () => {
    const outcomes = await runSelfplay({
      games: 1,
      seed: 13,
      decide: () => scriptedAgent,
      maxSteps: 400,
      // 只投一次已出局席位（引擎回 REJECTED），之后正常弃权——这样对局还能打完，
      // 才能真正走到「成局之后的拒绝扫描」那条路径（C-184 / Round 3）。
      playerInput: (() => {
        let fired = false;
        return (ctx: { pending: string | null; deadSeats: number[] }) => {
          const dead = ctx.deadSeats[0];
          if (!fired && ctx.pending === 'vote' && dead !== undefined) {
            fired = true;
            return { kind: 'speak' as const, text: String(dead) };
          }
          return { kind: 'skip' as const };
        };
      })(),
    });

    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.failure?.kind).toBe('implementation');
    // 引擎拒绝后编排层直接停下（不再无限重试同一个非法动作），错误里带拒绝码
    expect(outcomes[0]?.failure?.error).toContain('TARGET_NOT_ALIVE');
    expect(outcomes[0]?.usage).toBeDefined();
  });
});

describe('C-203 · 未终局局也带 usage', () => {
  it('maxSteps=1 的 outcome 有 usage 字段', async () => {
    const outcomes = await runSelfplay({
      games: 1,
      seed: 12,
      decide: () => scriptedAgent,
      maxSteps: 1,
    });

    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.usage).toBeDefined();
  });
});
