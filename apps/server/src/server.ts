/**
 * HTTP + WebSocket 服务（M3）。
 *
 * - HTTP：健康检查 / 创建房间 / 查询房间；
 * - WebSocket：进房、断线重连、动作上报、状态下发。
 *
 * 服务端权威：所有牌局计算都在这里，客户端拿不到别人的手牌。
 */

import fastify from 'fastify';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { RoomManager } from './room.ts';
import { clientMessageSchema } from './protocol.ts';
import type { ServerMessage } from './protocol.ts';

export interface ServerOptions {
  port?: number;
  host?: string;
  log?: boolean;
}

function rngFactory(): () => number {
  let seed = Date.now() >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildServer(options: ServerOptions = {}) {
  const app = fastify({ logger: options.log ?? false });
  const manager = new RoomManager();

  app.get('/api/health', async () => ({ ok: true, rooms: manager.list().length }));

  app.post('/api/rooms', async () => {
    const room = manager.create(rngFactory());
    return { code: room.code };
  });

  app.get('/api/rooms/:code', async (request) => {
    const { code } = request.params as { code: string };
    const room = manager.get(code.toUpperCase());
    if (room === undefined) return { ok: false, error: '房间不存在' };
    return { ok: true, players: room.playerCount, started: room.started };
  });

  const wss = new WebSocketServer({ noServer: true });

  interface SocketState {
    roomCode: string | null;
    seat: number | null;
  }
  const socketState = new WeakMap<WebSocket, SocketState>();

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  wss.on('connection', (socket: WebSocket) => {
    const state: SocketState = { roomCode: null, seat: null };
    socketState.set(socket, state);

    const adapter = {
      send: (data: string) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
      close: () => socket.close(),
    };

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(socket, { t: 'error', message: '消息不是合法 JSON' });
        return;
      }
      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        send(socket, { t: 'error', message: '消息格式不正确' });
        return;
      }
      const message = result.data;

      try {
        if (message.t === 'create') {
          const room = manager.create(rngFactory());
          const joined = room.join(message.name, adapter);
          if (joined === null) throw new Error('创建房间失败');
          manager.bindToken(joined.token, room);
          state.roomCode = room.code;
          state.seat = joined.seat;
          send(socket, { t: 'joined', token: joined.token, room: room.code, seat: joined.seat, resumed: false });
          room.broadcast();
          return;
        }

        if (message.t === 'join') {
          const room = manager.get(message.room.toUpperCase());
          if (room === undefined) throw new Error('房间不存在');
          const joined = room.join(message.name, adapter);
          if (joined === null) throw new Error('房间已满（4 人）');
          manager.bindToken(joined.token, room);
          state.roomCode = room.code;
          state.seat = joined.seat;
          send(socket, { t: 'joined', token: joined.token, room: room.code, seat: joined.seat, resumed: false });
          room.broadcast();
          return;
        }

        if (message.t === 'resume') {
          const room = manager.roomByToken(message.token);
          if (room === undefined) throw new Error('重连凭证已失效');
          const joined = room.join('', adapter, message.token);
          if (joined === null) throw new Error('重连失败');
          state.roomCode = room.code;
          state.seat = joined.seat;
          send(socket, { t: 'joined', token: joined.token, room: room.code, seat: joined.seat, resumed: true });
          room.broadcast();
          return;
        }

        if (message.t === 'ping') {
          send(socket, { t: 'pong' });
          return;
        }

        if (message.t === 'action') {
          if (state.roomCode === null || state.seat === null) throw new Error('还没进房');
          const room = manager.get(state.roomCode);
          if (room === undefined) throw new Error('房间不存在');
          room.action(state.seat, message.action);
        }
      } catch (error) {
        send(socket, { t: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('close', () => {
      if (state.roomCode === null || state.seat === null) return;
      const room = manager.get(state.roomCode);
      if (room === undefined) return;
      room.markDisconnected(state.seat);
      // 30 秒内可以用 token 重连；过期就当作离线
      setTimeout(() => {
        const target = manager.get(state.roomCode as string);
        if (target !== undefined && !target.isConnected(state.seat as number)) {
          target.broadcast();
        }
      }, 30_000);
    });
  });

  app.server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  app.addHook('onClose', async () => {
    wss.close();
  });

  return app;
}

export async function startServer(options: ServerOptions = {}) {
  const app = buildServer(options);
  await app.listen({ port: options.port ?? 3000, host: options.host ?? '0.0.0.0' });
  return app;
}
