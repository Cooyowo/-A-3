/**
 * M3 联机协议（客户端 ⇄ 服务端共用）。
 *
 * 原则：
 * - 服务端权威：客户端只发「我想做什么」，发牌、合法动作、结算、供牌全在服务端算；
 * - 不下发别人的手牌：每个座位收到的 view 里只有自己的手牌与公开信息；
 * - 断线重连：带上第一次进房拿到的 token 即可恢复同一座位（30 秒内有效）。
 */

import { z } from 'zod';
import type { Card, GameEvent, PatternType, Result } from '@a3/core';

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

/** 房间大厅信息（还没开始 / 已经在打都发它，用于显示谁在哪个座位） */
export interface RoomInfo {
  room: string;
  seats: { seat: number; name: string; connected: boolean }[];
  /** 4 人齐、已经发牌开局 */
  started: boolean;
  /** 我自己的座位（服务端按连接补上） */
  mySeat: number | null;
}

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
  /** 第几墩（界面用来清空「本墩打出的牌 / 不出」） */
  trickNo: number;
  topPattern: { type: PatternType; cards: Card[]; seat: number | null } | null;
  threePhase: boolean;
  isFirstPlay: boolean;
  /** 供牌前的等待（引擎 pauseSupply）：此时显示倒计时，结束后服务端自动 CONFIRM_SUPPLY */
  supplyPaused: boolean;
  supplyStep: string | null;
  supplyPool: Card[];
  /** 我自己要交出去的供牌（只有本人看得到；供牌执行后这里是空的，看 plannedSupply） */
  supplyFromMe: Card[];
  /** 本局我通过供牌收到的牌 id（只有赢家非空；开始游戏前用于标色） */
  supplyGainedIds: number[];
  returnPool: Card[];
  /** 本局供牌债务（公开信息：谁给谁、几张） */
  debt: {
    winners: number[];
    losers: number[];
    amountPerLoser: number;
    total: number;
    revealed: boolean;
    mode: 'NORMAL' | 'DOUBLE';
  } | null;
  /** 供产生的首发座位（给「下一局谁先出」用） */
  firstSeatBySupply: number | null;
  /** 12 张供不出：本局需要在「明牌 / 重新发牌」里二选一 */
  supplyDeadlocked: boolean;
  /** 我是否满足提前锁定条件（只下发自己的，避免泄露别人手牌信息） */
  myLockEligible: boolean;
  /** 我在锁定窗口里的当前意向 */
  myLockIntent: boolean;
  /** 明牌 / 锁定公开的牌（含牌面，前端直接渲染） */
  publicCards: Card[];
  revealedCards: Card[];
  /** 当前轮到谁挑回牌（RETURN_PICK 阶段）；null 表示不适用 */
  pickSeat: number | null;
  /** 如果我是「正在选回牌」的赢家，这是必须返还的张数；否则 null */
  returnRequired: number | null;
  /** 双地明牌输、1 人供 12 张：跳过手动挑选，整批自动转回 */
  pickAutoMode: boolean;
  result: Result | null;
  /** 当前等待阶段的截止时间（epoch ms），前端据此显示倒计时 */
  deadline: number | null;
  log: GameEvent[];
}

/** 服务端 → 客户端 */
export type ServerMessage =
  | { t: 'joined'; token: string; room: string; seat: number; resumed: boolean }
  | { t: 'room'; info: RoomInfo }
  | { t: 'view'; view: PlayerView }
  | { t: 'error'; message: string }
  | { t: 'pong' };
