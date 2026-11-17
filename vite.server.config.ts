import { defineConfig } from 'vite';

import { ALIAS } from './configs/alias.ts';

/**
 * 服务端构建。
 *
 * `pnpm build` 先用 `vite.config.ts` 出 `dist/client`，再用本文件出 `dist/server/index.js`。
 * 选择用 Vite 打包而不是 `tsc` 直出，是因为 `tsc` 不重写 `paths`：编译产物里若留着
 * `@shared/*` 说明符，`node dist/server/index.js` 会直接 ERR_MODULE_NOT_FOUND。
 * 详见 `RFCs/RFC-001-project-scaffold-and-shared-contracts.md` 的 C-9 与 Implementation Notes。
 *
 * `dependencies` 里的包（fastify 等）默认保持 external，运行时从 node_modules 解析。
 */
export default defineConfig({
  resolve: { alias: ALIAS },
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
});
