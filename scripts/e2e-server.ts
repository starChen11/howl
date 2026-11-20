/**
 * 端到端测试用的服务端（RFC-012）。
 *
 * 与生产入口的差别只有两点：脚本化 AI（`HOWL_FAKE_AI=1`）与不注册静态资源托管
 * （测试用 `page.goto` 访问的是同一个进程的 `/`，由 Vite 产物提供）。
 */
import { ChannelRegistry } from '../src/server/channels/session';
import { buildApp } from '../src/server/app';
import { GameLoop } from '../src/server/game-loop';
import { agentFor } from '../src/server/ai/agent';
import { GameRegistry } from '../src/server/store/game-registry';
import { InMemoryMetaStore } from '../src/server/store/meta-store';
import { StreamBus } from '../src/server/stream/bus';

// CLI 参数优先（`pnpm test:perf` 传 `--port`），其次环境变量，最后默认 4180。
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const PORT = Number(portArg?.slice('--port='.length) ?? process.env.E2E_PORT ?? 4180);

const store = new InMemoryMetaStore();
const bus = new StreamBus();
const channels = new ChannelRegistry(bus);
const registry = new GameRegistry(store);
const loop = new GameLoop({
  registry,
  channels,
  makeDecider: (gameId) => agentFor('scripted', { gameId, seq: () => 0, mode: 'slaughter-side' }),
});

const app = buildApp({ store, bus, channels, loop });

// 托管构建产物（与生产入口同一路径）。端到端前先 `pnpm build`。
const { existsSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { default: fastifyStatic } = await import('@fastify/static');
const dist = fileURLToPath(new URL('../dist/client', import.meta.url));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
}

await app.listen({ port: PORT, host: '127.0.0.1' });
