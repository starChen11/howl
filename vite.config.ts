import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { ALIAS } from './configs/alias.ts';

const API_PORT = process.env.PORT ?? '3000';
const WEB_PORT = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig({
  // 纯玩家 + 脚本替身的对局：狼队准备门槛从 30 秒降到 5 秒（RUL-14）。
  define: { __HOWL_FAKE_AI__: JSON.stringify(process.env.HOWL_FAKE_AI === '1') },
  plugins: [react()],
  resolve: { alias: ALIAS },
  server: {
    // strictPort：端口被占用时直接失败，不要静默换一个端口——
    // 否则 /api 代理与 AC-12 的验证地址就会指向不存在的地方。
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}` },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
});
