import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';

import { buildApp } from './app';

/** Fastify 监听端口，默认 3000（RFC-001 Q-001-1）。 */
const API_PORT = Number(process.env.PORT ?? 3000);

/**
 * 生产环境的前端产物目录。
 *
 * `src/server/index.ts`（dev）与 `dist/server/index.js`（build）向上两级都落在仓库根，
 * 所以同一个相对路径在两种启动方式下都指向 `<repo>/dist/client`。
 */
const CLIENT_DIST = fileURLToPath(new URL('../../dist/client', import.meta.url));

const app = buildApp({ logger: true });

// 前端没构建过就不托管静态资源，只提供 API——否则 `@fastify/static` 会因为
// root 不存在而启动失败，把「还没 build」变成「起不来」。
if (existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST });
}

await app.listen({ port: API_PORT, host: '0.0.0.0' });
