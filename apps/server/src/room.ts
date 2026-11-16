/**
 * 房间与对局驱动（服务端权威）。
 *
 * - 一个房间 4 个座位，创建时生成 6 位邀请码；**满 4 人且都进房后才发牌开局**；
 * - 所有动作都交给 @a3/core 的 applyAction 判定，非法动作直接把错误回给客户端；
 * - 时间推进（明牌 / 供牌确认 / 回牌 / 锁定 / 下一局）由服务端定时器驱动，
 *   下发的 view 里带 `deadline`，客户端只负责显示倒计时；
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

import type { PlayerView, RoomInfo } from './protocol.ts';

export const TIMING = {
  reveal: 4000,
  supplyWait: 4000,
  returnSelect: 20000,
  returnPick: 15000,
  lock: 5000,
  nextHandDelay: 5000,
};

/** 让客户端在倒计时结束后自己判断「大约该动了」的兜底：服务端才是唯一权威 */
export const SEAT_COUNT = 4;

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
  game: GameState | null = null;
  private rng: Rng;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 当前等待阶段的截止时间（epoch ms），随 view 下发 */
  private deadline: number | null = null;

  constructor(code: string, rng: Rng) {
    this.code = code;
    this.rng = rng;
  }

  get playerCount(): number {
    return this.seats.length;
  }

  /** 4 人齐、已经发牌开局 */
  get started(): boolean {
    return this.game !== null;
  }

  join(
    name: string,
    socket: RoomSocket | null,
    resumeToken?: string,
  ): { token: string; seat: number; resumed: boolean } | null {
    if (resumeToken !== undefined) {
      const existing = this.seats.find((seat) => seat.token === resumeToken);
      if (existing === undefined) return null;
      existing.socket = socket;
      existing.lastSeen = Date.now();
      return { token: existing.token, seat: existing.seat, resumed: true };
    }
    if (this.seats.length >= SEAT_COUNT) return null;
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
    return this.seats.find((item) => item.seat === seat)?.socket != null;
  }

  /** 满 4 人后发牌开局（重复调用无副作用） */
  startIfReady(): boolean {
    if (this.game !== null) return false;
    if (this.seats.length < SEAT_COUNT) return false;
    this.game = autoAdvance(createGame(this.rng, { pauseSupply: true }));
    return true;
  }

  roomInfo(mySeat: number | null = null): RoomInfo {
    return {
      room: this.code,
      seats: this.seats.map((seat) => ({
        seat: seat.seat,
        name: seat.name,
        connected: seat.socket !== null,
      })),
      started: this.started,
      mySeat,
    };
  }

  /** 大厅信息（还没开局时用） */
  broadcastRoom(): void {
    for (const seat of this.seats) {
      seat.socket?.send(JSON.stringify({ t: 'room', info: this.roomInfo(seat.seat) }));
    }
  }

  /** 把每个座位的视图各发一份；开局后同时安排下一个定时推进 */
  broadcast(): void {
    if (this.game === null) {
      this.broadcastRoom();
      return;
    }
    for (const seat of this.seats) {
      seat.socket?.send(JSON.stringify({ t: 'view', view: this.viewFor(seat.seat) }));
    }
    this.scheduleNext();
  }

  viewFor(seat: number): PlayerView {
    const game = this.game as GameState;
    const context = game.supplyContext;
    const debt = game.pendingDebt;
    const topPattern =
      game.topPattern === null
        ? null
        : { type: game.topPattern.type, cards: [...game.topPattern.cards], seat: game.topSeat };

    // 把公开的牌 id 还原成牌面（明牌的两张、锁定的 13 张等）
    const byId = new Map<number, Card>();
    for (const player of game.players) {
      for (const card of player.hand) byId.set(card.id, card);
    }
    if (context !== null) {
      for (const card of context.pool) byId.set(card.id, card);
      for (const card of context.returnPool) byId.set(card.id, card);
      for (const cards of context.perLoser.values()) {
        for (const card of cards) byId.set(card.id, card);
      }
    }
    const revealedCards = [...new Set(game.publicCards)]
      .map((id) => byId.get(id))
      .filter((card): card is Card => card !== undefined);

    const pickSeat =
      context !== null && context.step === 'RETURN_PICK' ? currentReturnPicker(game) : null;
    const pickAutoMode =
      debt !== null && context !== null && context.step === 'RETURN_PICK'
        ? debt.losers.length === 1 && debt.amountPerLoser >= 12
        : false;

    return {
      room: this.code,
      seat,
      handNo: game.handNo,
      phase: game.phase,
      players: game.players.map((player) => ({
        seat: player.seat,
        name: this.seats.find((item) => item.seat === player.seat)?.name ?? '',
        handCount: player.hand.length,
        out: player.out,
        locked: player.locked,
        rank: player.rank,
        connected: this.isConnected(player.seat),
      })),
      hand: [...(game.players[seat]?.hand ?? [])],
      doubleSeat: game.doubleSeat,
      revealedSeat: game.revealedSeat,
      landlordSeats: [...game.landlordSeats],
      currentSeat: game.currentSeat,
      firstSeat: game.firstSeat,
      trickNo: game.trickNo,
      topPattern,
      threePhase: game.threePhase,
      isFirstPlay: game.isFirstPlay,
      supplyPaused: game.supplyPaused,
      supplyStep: context?.step ?? null,
      supplyPool: context === null ? [] : [...context.pool],
      supplyFromMe: context === null ? [] : [...(context.perLoser.get(seat) ?? [])],
      supplyGainedIds: game.supplyGainedIds.filter((id) =>
        (game.players[seat]?.hand ?? []).some((card) => card.id === id),
      ),
      returnPool: context === null ? [] : [...context.returnPool],
      debt:
        debt === null
          ? null
          : {
              winners: [...debt.winners],
              losers: [...debt.losers],
              amountPerLoser: debt.amountPerLoser,
              total: debt.total,
              revealed: debt.revealed,
              mode: debt.mode,
            },
      firstSeatBySupply: game.firstSeatBySupply,
      supplyDeadlocked: this.supplyDeadlocked(),
      myLockEligible: game.phase === 'LOCK_WINDOW' ? lockEligible(game, seat) : false,
      myLockIntent: game.lockIntents.get(seat) === true,
      publicCards: revealedCards,
      revealedCards,
      pickSeat,
      returnRequired:
        context !== null && context.step === 'RETURN_SELECT' && !context.returns.has(seat)
          ? (context.perWinner.get(seat) ?? 0)
          : null,
      pickAutoMode,
      result: game.result,
      deadline: this.deadline,
      log: [...game.log],
    };
  }

  /** 处理某座位的动作；失败会抛错，由调用方转成 error 消息 */
  action(seat: number, action: unknown): void {
    if (this.game === null) throw new Error('等满 4 个人才能开始');
    this.game = autoAdvance(applyAction(this.game, seat, action as Action, this.rng));
    this.broadcast();
  }

  /** 12 张供不出时，该玩家是否需要在「明牌 / 重新发牌」里二选一 */
  supplyDeadlocked(): boolean {
    if (this.game === null) return false;
    const debt = this.game.pendingDebt;
    if (debt === null) return false;
    return !checkSupplyPossible(this.game, debt);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.deadline = null;
    const game = this.game;
    if (game === null) return;

    const later = (delay: number, fn: () => void): void => {
      this.deadline = Date.now() + delay;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.deadline = null;
        try {
          if (this.game === null) return;
          fn();
        } catch {
          /* 定时驱动失败不打断房间：下一次动作/广播会重新安排 */
        }
      }, delay);
    };

    // 明牌决策：超时视为不明牌（Q-001）
    if (game.phase === 'REVEAL' && game.doubleSeat !== null) {
      later(TIMING.reveal, () => {
        if (this.game === null || this.game.phase !== 'REVEAL') return;
        const seat = this.game.doubleSeat;
        if (seat === null) return;
        this.game = autoAdvance(applyAction(this.game, seat, { kind: 'PASS' }));
        this.broadcast();
      });
      return;
    }

    // 供牌等待：引擎 pauseSupply 停住，这里倒计时结束后确认执行（A 组要求：先展示几秒再飞牌）
    if (game.phase === 'SUPPLY' && game.supplyPaused) {
      later(TIMING.supplyWait, () => {
        if (this.game === null || !this.game.supplyPaused) return;
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
        if (this.game === null || this.game.phase !== 'LOCK_WINDOW') return;
        const intents = [...this.game.lockIntents.entries()]
          .filter(([, want]) => want === true)
          .map(([seat]) => seat)
          .filter((seat) => lockEligible(this.game as GameState, seat));
        this.game = autoAdvance(resolveLockWindow(this.game, intents));
        this.broadcast();
      });
      return;
    }

    if (game.phase === 'SETTLE') {
      later(TIMING.nextHandDelay, () => {
        if (this.game === null || this.game.phase !== 'SETTLE') return;
        this.game = autoAdvance(settleAndNextHand(this.game, this.rng, { pauseSupply: true }));
        this.broadcast();
      });
    }
  }

  private autoReturnAll(): void {
    const game = this.game;
    if (game === null) return;
    const context = game.supplyContext;
    const debt = game.pendingDebt;
    if (context === null || debt === null) return;
    for (const seat of debt.winners) {
      if (this.game === null) return;
      const current = this.game.supplyContext;
      if (current === null || current.returns.has(seat)) continue;
      const required = current.perWinner.get(seat) ?? 0;
      const cards = defaultReturnCards(this.game.players[seat]?.hand ?? [], required);
      this.game = autoAdvance(applyAction(this.game, seat, { kind: 'RETURN_CARDS', cards }));
    }
  }

  private autoPickOne(): void {
    const game = this.game;
    if (game === null) return;
    const context = game.supplyContext;
    if (context === null) return;
    const picker = currentReturnPicker(game);
    if (picker === null) return;
    const card = maxCard(context.returnPool);
    if (card === null) return;
    this.game = autoAdvance(applyAction(game, picker, { kind: 'PICK_RETURN', card }));
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
    return this.rooms.get(code.toUpperCase());
  }

  bindToken(token: string, room: Room): void {
    this.tokens.set(token, room);
  }

  roomByToken(token: string): Room | undefined {
    return this.tokens.get(token);
  }

  remove(code: string): void {
    const room = this.rooms.get(code);
    room?.dispose();
    this.rooms.delete(code);
  }

  list(): { code: string; players: number; started: boolean }[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      players: room.playerCount,
      started: room.started,
    }));
  }
}
