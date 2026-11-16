import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 3000);

startServer({ port, log: false })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`葵A葵3 服务端已启动：http://localhost:${port}（WebSocket: ws://localhost:${port}/ws）`);
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('启动失败', error);
    process.exit(1);
  });
