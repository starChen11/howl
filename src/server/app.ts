import Fastify, { type FastifyInstance } from 'fastify';

import { registerGameRoutes } from './routes/games';
import { registerStreamRoutes } from './routes/stream';
import type { GameLoop } from './game-loop';
import { ChannelRegistry } from './channels/session';
import { StreamBus } from './stream/bus';
import { GameRegistry } from './store/game-registry';
import { InMemoryMetaStore, type MetaStore } from './store/meta-store';

/** 健康检查路径。AC-12 与 `pnpm start` 的探活都用它。 */
export const HEALTH_PATH = '/api/health';

export interface BuildAppOptions {
  /** 是否开启 Fastify 的请求日志。测试里关掉，生产入口打开。 */
  logger?: boolean;
  /** 注入存储（AC-11：存在第二个实现时全部会话测试仍通过）。 */
  store?: MetaStore;
  /** 生产环境：cookie 加 `Secure`。 */
  production?: boolean;
  /** 流式事件总线（测试注入，默认新建）。 */
  bus?: StreamBus;
  /** 通道注册表（测试注入，默认新建）。 */
  channels?: ChannelRegistry;
  /** 整局入口（生产入口传入；测试可注入脚本化 decider）。 */
  loop?: GameLoop | null;
}

/**
 * 只负责构建 Fastify 实例，不监听端口。
 *
 * 分开是为了让测试用 `app.inject()` 打路由，不需要真实端口，也不需要关进程。
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get(HEALTH_PATH, async () => ({ ok: true }));

  const store = options.store ?? new InMemoryMetaStore();
  const registry = new GameRegistry(store);
  const production = options.production ?? false;
  const bus = options.bus ?? new StreamBus();
  const channels = options.channels ?? new ChannelRegistry(bus);
  registerGameRoutes(app, {
    registry,
    production,
    channels,
    loop: options.loop ?? null,
  });
  registerStreamRoutes(app, { registry, bus, production });

  return app;
}
