/**
 * M3 联机协议（客户端 ⇄ 服务端）。
 *
 * 原则：
 * - 服务端权威：客户端只发「我想做什么」，发牌、合法动作、结算、供牌全在服务端算；
 * - 不下发别人的手牌：每个座位收到的 view 里只有自己的手牌与公开信息；
 * - 断线重连：join 时带上第一次进房拿到的 token 即可恢复同一座位（30 秒内有效）。
 */

import { z } from 'zod';
import type { Card, GameEvent, PatternType, PlayerState, Result } from '@a3/core';

/** 客户端 → 服务端 */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), name: z.string().min(1).max(16) }),
  z.object({ t: z.literal('join'), room: z.string().min(4).max(8), name: z.string().min(1).max(16) }),
  /** 用上次拿到的 token 重连（断线 30 秒内） */
  z.object({ t: z.literal('resume'), token: z.string().min(8) }),
  z.object({ t: z.literal('action'), action: z.unknown() }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** 服务端下发给单个座位的玩家视图（绝不含他人手牌） */
export interface PlayerView {
  room: string;
  seat: number;
  handNo: number;
  phase: string;
  players: {
    seat: number;
    name: string;
    handCount: number;
    out: boolean;
    locked: boolean;
    rank: number | null;
    connected: boolean;
  }[];
  /** 只有自己的手牌 */
  hand: Card[];
  doubleSeat: number | null;
  revealedSeat: number | null;
  landlordSeats: number[];
  currentSeat: number;
  firstSeat: number | null;
  topPattern: { type: PatternType; cards: Card[]; seat: number | null } | null;
  threePhase: boolean;
  isFirstPlay: boolean;
  supplyPaused: boolean;
  supplyStep: string | null;
  supplyPool: Card[];
  supplyFromMe: Card[];
  returnPool: Card[];
  publicCards: number[];
  result: Result | null;
  log: GameEvent[];
}

/** 服务端 → 客户端 */
export type ServerMessage =
  | { t: 'joined'; token: string; room: string; seat: number; resumed: boolean }
  | { t: 'view'; view: PlayerView }
  | { t: 'error'; message: string }
  | { t: 'pong' };

/** 把内部 PlayerState 压成对外可见的字段（不含手牌） */
export function publicPlayer(player: PlayerState, connected: boolean) {
  return {
    seat: player.seat,
    name: '',
    handCount: player.hand.length,
    out: player.out,
    locked: player.locked,
    rank: player.rank,
    connected,
  };
}
