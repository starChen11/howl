import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';

import { buildApp } from './app';
import { ChannelRegistry } from './channels/session';
import { GameLoop } from './game-loop';
import { agentFor } from './ai/agent';
import { API_KEY_ENV, loadLlmConfig } from './llm/config';
import { GameRegistry } from './store/game-registry';
import { InMemoryMetaStore } from './store/meta-store';
import { StreamBus } from './stream/bus';

/** Fastify 监听端口，默认 3000（RFC-001 Q-001-1）。 */
const API_PORT = Number(process.env.PORT ?? 3000);

/**
 * 生产环境的前端产物目录。
 *
 * `src/server/index.ts`（dev）与 `dist/server/index.js`（build）向上两级都落在仓库根，
 * 所以同一个相对路径在两种启动方式下都指向 `<repo>/dist/client`。
 */
const CLIENT_DIST = fileURLToPath(new URL('../../dist/client', import.meta.url));

// 生产入口：cookie 必须带 `Secure`（RFC-008 §2.6 / B3）。
// 整局入口：默认用模型；`HOWL_FAKE_AI=1` 时用脚本替身（本地演示与端到端测试）。
const store = new InMemoryMetaStore();
const bus = new StreamBus();
const channels = new ChannelRegistry(bus);
const registry = new GameRegistry(store);
const agentKind = process.env.HOWL_FAKE_AI === '1' ? 'scripted' : 'llm';

// 没有 key 时不要「起得来但打不了」：第一轮 AI 动作会抛错、对局卡住，而原因只在日志里。
if (agentKind === 'llm') {
  try {
    loadLlmConfig(process.env);
  } catch {
    console.error(
      [
        `缺少 ${API_KEY_ENV} —— 现在可以用两种方式启动：`,
        '',
        `  1) 接真实模型：  ${API_KEY_ENV}=sk-... pnpm dev`,
        '  2) 先随便玩玩：  HOWL_FAKE_AI=1 pnpm dev   （AI 由脚本代替，不花钱）',
        '',
        '真实模型会产生 API 费用；脚本替身只跑固定台词，不会推理。',
      ].join('\n'),
    );
    process.exit(1);
  }
}

const loop = new GameLoop({
  registry,
  channels,
  makeDecider: (gameId) =>
    agentFor(agentKind, {
      gameId,
      seq: () => 0,
      mode: 'slaughter-side',
    }),
});

process.env['HOWL_WOLF_READY_MS'] ??= '5000';
process.env['HOWL_WOLF_VOTE_DELAY_MS'] ??= '1200';
// 真实模型自己决定「准备完成」；脚本替身固定 5 秒后自动准备。
process.env['HOWL_WOLF_AI_READY'] ??= process.env['HOWL_FAKE_AI'] === '1' ? 'auto' : 'model';

const app = buildApp({
  logger: true,
  production: process.env.NODE_ENV === 'production',
  store,
  bus,
  channels,
  loop,
});

// 前端没构建过就不托管静态资源，只提供 API——否则 `@fastify/static` 会因为
// root 不存在而启动失败，把「还没 build」变成「起不来」。
if (existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST });
}

await app.listen({ port: API_PORT, host: '0.0.0.0' });
