import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 手机竖屏联调需要局域网可访问
    host: true,
    port: 5173,
    // 端口被占用时直接报错，避免悄悄换到 5174 后用户找不到入口
    strictPort: true,
  },
  optimizeDeps: {
    // @a3/core 是 workspace 内的 TS 源码，交给 Vite 直接编译，不做预打包
    exclude: ['@a3/core'],
  },
});
