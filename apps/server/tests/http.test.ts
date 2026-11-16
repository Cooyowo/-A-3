import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.ts';

/** HTTP 接口冒烟（用 fastify.inject，不需要真正监听端口） */
describe('HTTP 接口', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('健康检查返回 ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });

  it('创建房间返回 6 位邀请码，并能查到房间信息', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/rooms' });
    expect(created.statusCode).toBe(200);
    const { code } = created.json() as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const info = await app.inject({ method: 'GET', url: `/api/rooms/${code}` });
    expect(info.json()).toMatchObject({ ok: true, players: 0, started: false });
  });

  it('查询不存在的房间返回错误', async () => {
    const info = await app.inject({ method: 'GET', url: '/api/rooms/ZZZZZZ' });
    expect(info.json()).toMatchObject({ ok: false });
  });
});
