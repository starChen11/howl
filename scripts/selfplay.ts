/**
 * `pnpm selfplay` 的入口（RFC-015 §2.1 / AC-1 / AC-7 / AC-8）。
 *
 * 没有浏览器、没有 Vite、没有 DOM：只跑引擎与编排。
 *
 * ```
 * pnpm selfplay --games=100 --seed=42 --out=./reports
 * ```
 */

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { createLlmAgent, scriptedAgent } from '../src/server/ai/agent';
import { resetUsage } from '../src/server/llm/usage';
import { summarize } from '../src/server/selfplay/report';
import { runSelfplay } from '../src/server/selfplay/runner';

interface Args {
  games: number;
  seed: number;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const read = (name: string, fallback: number | undefined): number | undefined => {
    const prefix = `--${name}=`;
    const hit = argv.find((arg) => arg.startsWith(prefix));
    if (hit === undefined) return fallback;
    const value = Number(hit.slice(prefix.length));
    return Number.isFinite(value) ? value : fallback;
  };

  const outArg = argv.find((arg) => arg.startsWith('--out='));

  return {
    games: read('games', 1) ?? 1,
    seed: read('seed', 1) ?? 1,
    out: outArg?.slice('--out='.length) ?? './reports',
  };
}

async function writeAtomic(path: string, content: string): Promise<void> {
  // 先写临时文件再改名：避免崩溃时留下半截 JSON（§4）。
  const temp = `${path}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  resetUsage();

  // 有 key 走真实模型；`HOWL_FAKE_AI=1` 用脚本替身（零费用，用于冒烟）。
  const fake = process.env['HOWL_FAKE_AI'] === '1';

  const outcomes = await runSelfplay({
    games: args.games,
    seed: args.seed,
    decide: fake
      ? () => scriptedAgent
      : ({ gameId }) =>
          createLlmAgent({
            gameId,
            seq: () => 0,
            mode: 'slaughter-side',
          }),
    onGame: async (outcome, events) => {
      await writeAtomic(
        join(args.out, `game-${outcome.seed}.jsonl`),
        events.map((event) => JSON.stringify(event)).join('\n'),
      );
    },
  });

  const summary = summarize(outcomes);
  await writeAtomic(join(args.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(
    `跑完 ${summary.games} 局：成 ${summary.succeeded} / 败 ${summary.failed}；` +
      `狼人胜率 ${(summary.wolfWinRate * 100).toFixed(1)}%；` +
      `平均 ${summary.avgEvents.toFixed(1)} 条事件、${(summary.avgDurationMs / 1000).toFixed(1)} 秒`,
  );
  if (summary.failures.length > 0) {
    for (const failure of summary.failures) {
      console.error(`  种子 ${failure.seed}（${failure.kind}）：${failure.error}`);
    }
  }

  // 失败局不阻塞整批，但有失败就以非 0 退出，方便 CI 与人工注意（AC-5 的边界）。
  process.exitCode = summary.succeeded === summary.games ? 0 : 1;
}

await main();
