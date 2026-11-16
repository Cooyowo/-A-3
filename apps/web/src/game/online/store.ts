/**
 * 联机模式 store（M3）。
 *
 * 与热座 store 的区别：这里**没有本地引擎**——所有判定都在服务端，我们只保存
 * 服务端下发的 PlayerView（已适配成 GameState 供界面复用），动作统一走 WS 上报。
 *
 * 断线重连：
 * - 第一次进房拿到的 token 存 localStorage；页面刷新/断线后自动 resume 回原座位；
 * - 服务端保留座位 30 秒，超时后凭证失效，需要重新加入房间。
 */

import { create } from 'zustand';

import { defaultReturnCards, validatePlay } from '@a3/core';
import type { Action, Card, GameState } from '@a3/core';
import type { PlayerView, RoomInfo, ServerMessage } from '@a3/protocol';

import { viewToGameState } from './adapter';
import { defaultWsUrl, GameConnection } from './net';
import type { NetStatus } from './net';

const TOKEN_KEY = 'a3.token';
const ROOM_KEY = 'a3.room';
const NAME_KEY = 'a3.name';

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下写不了就只保留内存态 */
  }
}

export type OnlineScreen = 'home' | 'room' | 'table';

export interface OnlineState {
  status: NetStatus;
  screen: OnlineScreen;
  name: string;
  roomInput: string;
  token: string | null;
  room: RoomInfo | null;
  view: PlayerView | null;
  game: GameState | null;
  seat: number | null;
  error: string | null;
  /** 手牌点选（出牌 / 回牌共用） */
  selectedIds: number[];
  /** 挑回牌时桌面中间高亮的牌 */
  pickedReturnId: number | null;

  start(): void;
  createRoom(): void;
  joinRoom(): void;
  leaveRoom(): void;
  setName(name: string): void;
  setRoomInput(code: string): void;
  dismissError(): void;

  toggleCard(cardId: number): void;
  clearSelection(): void;
  playSelected(): void;
  pass(): void;
  reveal(): void;
  skipReveal(): void;
  redeal(): void;
  toggleLock(): void;
  submitReturn(): void;
  autoReturn(): void;
  pickReturn(cardId: number): void;
  confirmPickReturn(): void;
}

let connection: GameConnection | null = null;
let started = false;

export const useOnlineStore = create<OnlineState>((set, get) => {
  const send = (action: Action): void => {
    if (connection === null) {
      set({ error: '还没连上服务器' });
      return;
    }
    connection.send({ t: 'action', action });
    // 动作发出去先清掉本地选择，等服务端 view 回来
    set({ selectedIds: [], pickedReturnId: null });
  };

  const handleMessage = (message: ServerMessage): void => {
    switch (message.t) {
      case 'joined': {
        writeStorage(TOKEN_KEY, message.token);
        writeStorage(ROOM_KEY, message.room);
        set({
          token: message.token,
          seat: message.seat,
          roomInput: message.room,
          error: null,
          screen: 'room',
        });
        return;
      }
      case 'room': {
        const info = message.info;
        set({
          room: info,
          seat: info.mySeat ?? get().seat,
          screen: info.started ? 'table' : 'room',
        });
        return;
      }
      case 'view': {
        set({
          view: message.view,
          game: viewToGameState(message.view),
          seat: message.view.seat,
          screen: 'table',
          error: null,
        });
        return;
      }
      case 'error': {
        set({ error: message.message });
        return;
      }
      case 'pong':
      default:
        return;
    }
  };

  const ensureConnection = (): boolean => {
    if (connection !== null) return true;
    connection = new GameConnection(defaultWsUrl(), {
      onMessage: handleMessage,
      onStatus: (status) => {
        set({ status });
        // 重连成功后自动用 token 回到原座位
        if (status === 'open') {
          const token = readStorage(TOKEN_KEY);
          if (token !== null && connection !== null) {
            connection.send({ t: 'resume', token });
          }
        }
      },
    });
    connection.watchVisibility();
    connection.connect();
    return true;
  };

  const myGame = (): GameState | null => get().game;

  return {
    status: 'idle',
    screen: 'home',
    name: readStorage(NAME_KEY) ?? '',
    roomInput: readStorage(ROOM_KEY) ?? '',
    token: readStorage(TOKEN_KEY),
    room: null,
    view: null,
    game: null,
    seat: null,
    error: null,
    selectedIds: [],
    pickedReturnId: null,

    start() {
      if (started) return;
      started = true;
      ensureConnection();
    },

    setName(name) {
      writeStorage(NAME_KEY, name);
      set({ name });
    },

    setRoomInput(code) {
      set({ roomInput: code.toUpperCase().slice(0, 8) });
    },

    dismissError() {
      set({ error: null });
    },

    createRoom() {
      const name = get().name.trim();
      if (name === '') return set({ error: '先填个昵称' });
      if (!ensureConnection()) return;
      set({ error: null });
      connection?.send({ t: 'create', name });
    },

    joinRoom() {
      const name = get().name.trim();
      const code = get().roomInput.trim().toUpperCase();
      if (name === '') return set({ error: '先填个昵称' });
      if (code.length < 4) return set({ error: '邀请码不对' });
      if (!ensureConnection()) return;
      set({ error: null });
      connection?.send({ t: 'join', room: code, name });
    },

    leaveRoom() {
      writeStorage(TOKEN_KEY, null);
      writeStorage(ROOM_KEY, null);
      set({
        screen: 'home',
        status: 'idle',
        room: null,
        view: null,
        game: null,
        seat: null,
        token: null,
        error: null,
        selectedIds: [],
        pickedReturnId: null,
      });
      connection?.dispose();
      connection = null;
      // 允许下次再点「在线对战」时重新建立连接
      started = false;
    },

    toggleCard(cardId) {
      const { selectedIds } = get();
      set({
        selectedIds: selectedIds.includes(cardId)
          ? selectedIds.filter((id) => id !== cardId)
          : [...selectedIds, cardId],
      });
    },

    clearSelection() {
      set({ selectedIds: [] });
    },

    playSelected() {
      const game = myGame();
      const seat = get().seat;
      const { selectedIds } = get();
      if (game === null || seat === null) return;
      if (selectedIds.length === 0) return set({ error: '先选要出的牌' });
      const cards = (game.players[seat]?.hand ?? []).filter((card) => selectedIds.includes(card.id));
      const check = validatePlay(game, seat, cards);
      if (!check.ok) return set({ error: check.reason });
      send({ kind: 'PLAY', cards });
    },

    pass() {
      send({ kind: 'PASS' });
    },

    reveal() {
      send({ kind: 'REVEAL' });
    },

    skipReveal() {
      send({ kind: 'PASS' });
    },

    redeal() {
      send({ kind: 'REDEAL' });
    },

    toggleLock() {
      const view = get().view;
      if (view === null) return;
      send({ kind: view.myLockIntent ? 'UNLOCK' : 'LOCK' });
    },

    submitReturn() {
      const view = get().view;
      const game = myGame();
      const seat = get().seat;
      if (view === null || game === null || seat === null) return;
      const required = view.returnRequired ?? 0;
      const { selectedIds } = get();
      if (selectedIds.length !== required) {
        return set({ error: `需要选 ${required} 张回牌` });
      }
      const cards = (game.players[seat]?.hand ?? []).filter((card) => selectedIds.includes(card.id));
      send({ kind: 'RETURN_CARDS', cards });
    },

    autoReturn() {
      const view = get().view;
      const game = myGame();
      const seat = get().seat;
      if (view === null || game === null || seat === null) return;
      const required = view.returnRequired ?? 0;
      const cards: Card[] = defaultReturnCards(game.players[seat]?.hand ?? [], required);
      send({ kind: 'RETURN_CARDS', cards });
    },

    pickReturn(cardId) {
      set({ pickedReturnId: cardId });
    },

    confirmPickReturn() {
      const view = get().view;
      const { pickedReturnId } = get();
      if (view === null) return;
      const card = pickedReturnId === null ? null : view.returnPool.find((item) => item.id === pickedReturnId);
      if (card === undefined || card === null) {
        return set({ error: '先在桌面中间点一张回牌' });
      }
      send({ kind: 'PICK_RETURN', card });
    },
  };
});

/** 供外部（App / 测试）拿连接状态用：连接是模块级单例 */
export function onlineConnection(): GameConnection | null {
  return connection;
}
