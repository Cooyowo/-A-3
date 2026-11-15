import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 全部测试集中在各 workspace 的 tests/ 目录
    include: ['packages/*/tests/**/*.test.{ts,tsx}', 'apps/*/tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // 默认 forks 池会 fork 子进程，本机受限环境下会报 spawn EPERM；
    // threads 池用 worker_threads，不 fork，速度也更快。
    pool: 'threads',
  },
});
