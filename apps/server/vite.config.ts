import { defineConfig } from 'vite';

/**
 * M3 服务端构建：用 Vite 的 SSR 模式把 TS 打成一个 Node 可执行的 ESM 文件。
 *
 * 为什么不直接用 tsx / tsc：
 * - tsx 依赖 esbuild 的常驻子进程，本机受限环境会 `spawn EPERM`；
 * - tsc 产物里 `@a3/core` 指向的是 TS 源码（workspace 直接吃源码），Node 跑不了。
 * 所以把 @a3/core / @a3/protocol 一起打进 bundle，第三方依赖保持 external。
 */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'main.mjs',
        format: 'es',
      },
      external: ['fastify', 'ws', 'zod'],
    },
  },
});
