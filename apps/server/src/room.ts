/**
 * 房间与对局驱动（服务端权威）。
 *
 * - 一个房间 4 个座位，创建时生成 6 位邀请码；
 * - 所有动作都交给 @a3/core 的 applyAction 判定，非法动作直接把错误回给客户端；
 * - 时间推进（明牌/供牌/锁定/回牌超时）由服务端定时器驱动，客户端只负责展示；
 * - 每个座位拿到的 PlayerView 只含自己的手牌。
 */

import {
  applyAction,
  autoAdvance,
  checkSupplyPossible,
  createGame,
  currentReturnPicker,
  defaultReturnCards,
  lockEligible,
  maxCard,
  resolveLockWindow,
  settleAndNextHand,
} from '@a3/core';
import type { Action, Card, GameState, Rng } from '@a3/core';

import type { PlayerView } from './protocol.ts';
import { publicPlayer } from './protocol.ts';

export const TIMING = {
  reveal: 4000,
  supplyWait: 4000,
  returnSelect: 20000,
  returnPick: 15000,
  lock: 5000,
  nextHandDelay: 4000,
};

/** 邀请码：去掉容易混淆的 0/O/1/I */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function makeToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 让外部（ws 层）能收到「这个座位有更新」 */
export interface RoomSocket {
  send(message: string): void;
  close(): void;
}

interface Seat {
  seat: number;
  name: string;
  token: string;
  socket: RoomSocket | null;
  lastSeen: number;
}

export class Room {
  readonly code: string;
  readonly seats: Seat[] = [];
  game: GameState;
  finished = false;
  private rng: Rng;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, rng: Rng) {
    this.code = code;
    this.rng = rng;
    this.game = autoAdvance(createGame(rng, { pauseSupply: true }));
  }

  get playerCount(): number {
    return this.seats.length;
  }

  get started(): boolean {
    return this.seats.length === 4;
  }

  join(name: string, socket: RoomSocket | null, resumeToken?: string): { token: string; seat: number; resumed: boolean } | null {
    if (resumeToken !== undefined) {
      const existing = this.seats.find((seat) => seat.token === resumeToken);
      if (existing === undefined) return null;
      existing.socket = socket;
      existing.lastSeen = Date.now();
      return { token: existing.token, seat: existing.seat, resumed: true };
    }
    if (this.seats.length >= 4) return null;
    const seat = this.seats.length;
    const token = makeToken();
    this.seats.push({ seat, name, token, socket, lastSeen: Date.now() });
    return { token, seat, resumed: false };
  }

  markDisconnected(seat: number): void {
    const target = this.seats.find((item) => item.seat === seat);
    if (target !== undefined) {
      target.socket = null;
      target.lastSeen = Date.now();
    }
  }

  isConnected(seat: number): boolean {
    return this.seats.find((item) => item.seat === seat)?.socket !== null;
  }

  /** 把所有座位的视图各发一份（别人的手牌不会被带上） */
  broadcast(): void {
    for (const seat of this.seats) {
      seat.socket?.send(JSON.stringify({ t: 'view', view: this.viewFor(seat.seat) }));
    }
    this.scheduleNext();
  }

  viewFor(seat: number): PlayerView {
    const game = this.game;
    const context = game.supplyContext;
    const topPattern =
      game.topPattern === null
        ? null
        : { type: game.topPattern.type, cards: [...game.topPattern.cards], seat: game.topSeat };
    return {
      room: this.code,
      seat,
      handNo: game.handNo,
      phase: game.phase,
      players: game.players.map((player) => ({
        ...publicPlayer(player, this.isConnected(player.seat)),
        name: this.seats.find((item) => item.seat === player.seat)?.name ?? '',
      })),
      hand: [...(game.players[seat]?.hand ?? [])],
      doubleSeat: game.doubleSeat,
      revealedSeat: game.revealedSeat,
      landlordSeats: [...game.landlordSeats],
      currentSeat: game.currentSeat,
      firstSeat: game.firstSeat,
      topPattern,
      threePhase: game.threePhase,
      isFirstPlay: game.isFirstPlay,
      supplyPaused: game.supplyPaused,
      supplyStep: context?.step ?? null,
      supplyPool: context === null ? [] : [...context.pool],
      supplyFromMe: context === null ? [] : [...(context.perLoser.get(seat) ?? [])],
      returnPool: context === null ? [] : [...context.returnPool],
      publicCards: [...game.publicCards],
      result: game.result,
      log: [...game.log],
    };
  }

  /** 处理某座位的动作；失败会抛错，由调用方转成 error 消息 */
  action(seat: number, action: unknown): void {
    if (!this.started) throw new Error('等满 4 个人才能开始');
    this.game = autoAdvance(applyAction(this.game, seat, action as Action, this.rng));
    this.broadcast();
  }

  private scheduleNext(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const game = this.game;
    const later = (delay: number, fn: () => void): void => {
      this.timer = setTimeout(() => {
        try {
          fn();
        } catch {
          /* 定时驱动失败不打断房间 */
        }
      }, delay);
    };

    if (game.phase === 'REVEAL' && game.doubleSeat !== null) {
      later(TIMING.reveal, () => {
        this.game = autoAdvance(applyAction(this.game, game.doubleSeat as number, { kind: 'PASS' }));
        this.broadcast();
      });
      return;
    }

    if (game.phase === 'SUPPLY' && game.supplyPaused) {
      later(TIMING.supplyWait, () => {
        this.game = autoAdvance(applyAction(this.game, 0, { kind: 'CONFIRM_SUPPLY' }));
        this.broadcast();
      });
      return;
    }

    const step = game.supplyContext?.step;
    if (game.phase === 'SUPPLY' && step === 'RETURN_SELECT') {
      later(TIMING.returnSelect, () => {
        this.autoReturnAll();
        this.broadcast();
      });
      return;
    }

    if (game.phase === 'SUPPLY' && step === 'RETURN_PICK') {
      later(TIMING.returnPick, () => {
        this.autoPickOne();
        this.broadcast();
      });
      return;
    }

    if (game.phase === 'LOCK_WINDOW') {
      later(TIMING.lock, () => {
        const intents = [...game.lockIntents.entries()]
          .filter(([, want]) => want === true)
          .map(([seat]) => seat)
          .filter((seat) => lockEligible(game, seat));
        this.game = autoAdvance(resolveLockWindow(this.game, intents));
        this.broadcast();
      });
      return;
    }

    if (game.phase === 'SETTLE') {
      later(TIMING.nextHandDelay, () => {
        this.game = autoAdvance(settleAndNextHand(this.game, this.rng, { pauseSupply: true }));
        this.broadcast();
      });
    }
  }

  private autoReturnAll(): void {
    const context = this.game.supplyContext;
    const debt = this.game.pendingDebt;
    if (context === null || debt === null) return;
    for (const seat of debt.winners) {
      if (context.returns.has(seat)) continue;
      const required = context.perWinner.get(seat) ?? 0;
      const cards: Card[] = defaultReturnCards(this.game.players[seat]?.hand ?? [], required);
      this.game = autoAdvance(applyAction(this.game, seat, { kind: 'RETURN_CARDS', cards }));
    }
  }

  private autoPickOne(): void {
    const context = this.game.supplyContext;
    if (context === null) return;
    const picker = currentReturnPicker(this.game);
    if (picker === null) return;
    const card = maxCard(context.returnPool);
    if (card === null) return;
    this.game = autoAdvance(applyAction(this.game, picker, { kind: 'PICK_RETURN', card }));
  }

  /** 12 张供不出时的二选一（由该玩家决定） */
  canConfirmSupply(): boolean {
    return this.game.supplyPaused;
  }

  supplyPossible(): boolean {
    return this.game.pendingDebt === null || checkSupplyPossible(this.game, this.game.pendingDebt);
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private tokens = new Map<string, Room>();

  create(rng: Rng): Room {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code, rng);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  bindToken(token: string, room: Room): void {
    this.tokens.set(token, room);
  }

  roomByToken(token: string): Room | undefined {
    return this.tokens.get(token);
  }

  list(): { code: string; players: number; started: boolean }[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      players: room.playerCount,
      started: room.started,
    }));
  }
}
