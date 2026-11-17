import Fastify, { type FastifyInstance } from 'fastify';

/** 健康检查路径。AC-12 与 `pnpm start` 的探活都用它。 */
export const HEALTH_PATH = '/api/health';

export interface BuildAppOptions {
  /** 是否开启 Fastify 的请求日志。测试里关掉，生产入口打开。 */
  logger?: boolean;
}

/**
 * 只负责构建 Fastify 实例，不监听端口。
 *
 * 分开是为了让测试用 `app.inject()` 打路由，不需要真实端口，也不需要关进程。
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get(HEALTH_PATH, async () => ({ ok: true }));

  return app;
}
