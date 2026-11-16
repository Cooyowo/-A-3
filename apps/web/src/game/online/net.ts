/**
 * 联机连接层：一条到服务端 /ws 的 WebSocket。
 *
 * - 只负责收发与断线重连（指数退避，最长 5 秒一次）；
 * - 「重连后要 resume 哪个 token」由上层 store 决定；
 * - 心跳 ping 每 20 秒一次，避免被中间层掐断。
 */

import type { ClientMessage, ServerMessage } from '@a3/protocol';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface NetHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: NetStatus) => void;
}

/** 默认地址：开发时连本机 3000；生产（M4 同源 /ws）可用 VITE_WS_URL 覆盖 */
export function defaultWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname;
  const devPort = import.meta.env.DEV ? ':3000' : '';
  return `${protocol}://${host}${devPort}/ws`;
}

export class GameConnection {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers: NetHandlers;
  private closedByUs = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') this.ensureOpen();
  };

  constructor(url: string, handlers: NetHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closedByUs = false;
    if (this.socket !== null) return;
    this.open();
  }

  /** 页面回到前台时补一次连接（手机锁屏常见） */
  watchVisibility(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisible);
  }

  dispose(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): void {
    if (!this.isOpen) return;
    this.socket?.send(JSON.stringify(message));
  }

  private ensureOpen(): void {
    if (this.closedByUs) return;
    if (this.socket === null) this.open();
  }

  private open(): void {
    this.handlers.onStatus('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.retry = 0;
      this.handlers.onStatus('open');
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.isOpen) socket.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage));
      }, 20_000);
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as ServerMessage;
        this.handlers.onMessage(parsed);
      } catch {
        /* 忽略坏消息 */
      }
    });

    socket.addEventListener('close', () => {
      this.handlers.onStatus('closed');
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.socket = null;
      if (this.closedByUs) return;
      this.retry = Math.min(this.retry + 1, 6);
      const delay = Math.min(500 * 2 ** (this.retry - 1), 5000);
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.ensureOpen(), delay);
    });

    socket.addEventListener('error', () => {
      /* close 事件会跟着来，这里不用处理 */
    });
  }
}
