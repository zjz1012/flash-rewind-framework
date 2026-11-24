import { defineConfig } from 'vite';

// 所有资源走 ./ 相对路径发布（方案 4.1：默认相对路径，无 CDN）
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // wasm 作为静态资源原样拷贝，交给 ruffle.js 按 publicPath 加载
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: { port: 5173, host: '127.0.0.1' },
});
