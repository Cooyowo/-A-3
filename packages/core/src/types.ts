/**
 * 规则引擎的共享类型与常量。
 * 与《开发文档.md》第 2、3 节对应；冲突处已按《玩法说明.md》与 open-questions 的确认结论修正。
 */

import type { Card } from './cards';

export type { Card, CardKey, Rank, Rng, Suit } from './cards';

// ---------------------------------------------------------------------------
// 牌型
// ---------------------------------------------------------------------------

export type PatternType =
  | 'SINGLE' // 单张
  | 'PAIR' // 对子
  | 'TRIPLE' // 三条
  | 'TRIPLE_ONE' // 三条夹一
  | 'STRAIGHT' // 顺子
  | 'FLUSH' // 同花
  | 'TRIPLE_PAIR' // 三条夹双
  | 'STRAIGHT_FLUSH' // 同花顺
  | 'FOUR_ONE' // 四夹一
  | 'BOMB'; // 炸弹

/** 三个大类：单张 / 对子 / 牌组 */
export type Category = 'SINGLE' | 'PAIR' | 'GROUP';

/** 牌组档位（单张、对子为 0，不参与档位比较） */
export const TIER: Readonly<Record<PatternType, number>> = {
  SINGLE: 0,
  PAIR: 0,
  TRIPLE: 1,
  TRIPLE_ONE: 2,
  STRAIGHT: 3,
  FLUSH: 4,
  TRIPLE_PAIR: 5,
  STRAIGHT_FLUSH: 6,
  FOUR_ONE: 7,
  BOMB: 8,
};

/** 已识别的牌型；`key` 是归一化比较键，见《开发文档》3.1 */
export interface Pattern {
  readonly type: PatternType;
  readonly cards: readonly Card[];
  readonly category: Category;
  readonly tier: number;
  /** [主键, 次键]：单张=点数/花色、对子=点数/最大花色、顺子=最大牌点数/花色、同花/同花顺=花色/最大牌点数… */
  readonly key: readonly [number, number];
  /** key 完全相等时是否仍可压（只有 4~10 的场景为 true） */
  readonly equalAllowed: boolean;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** ♠3 —— 地主牌 */
export const LANDLORD_3 = { rank: 16, suit: 4 } as const;
/** ♠A —— 地主牌 */
export const LANDLORD_A = { rank: 14, suit: 4 } as const;
/** ♦4 —— 没有供牌/明牌时的首发牌 */
export const FIRST_CARD = { rank: 4, suit: 1 } as const;

/** 提前锁定窗口（固定等满，不提前结束：open-questions Q-053） */
export const LOCK_WINDOW_MS = 5000;
/** 明牌决策超时（联机）：Q-001 */
export const REVEAL_TIMEOUT_MS = 10_000;
/** 回牌 / 挑回牌超时（联机）：Q-041 / Q-042 */
export const RETURN_TIMEOUT_MS = 10_000;
/** 同一局重新发牌上限：Q-074 */
export const MAX_REDEAL = 20;

// ---------------------------------------------------------------------------
// 牌局状态
// ---------------------------------------------------------------------------

export type Phase = 'DEAL' | 'REVEAL' | 'SUPPLY' | 'LOCK_WINDOW' | 'PLAYING' | 'SETTLE';

export interface PlayerState {
  readonly seat: number;
  hand: Card[];
  /** 已出完（含提前锁定） */
  out: boolean;
  /** 提前锁定第三名 */
  locked: boolean;
  /** 1..4；未确定时为 null */
  rank: number | null;
}

/** 上一局结算产生、本局发牌后要执行的供牌债务 */
export interface Debt {
  winners: number[];
  losers: number[];
  /** 每个输家要交几张 */
  amountPerLoser: number;
  /** 合计张数 */
  total: number;
  /** 上一局是否明牌（双地翻倍） */
  revealed: boolean;
  mode: 'NORMAL' | 'DOUBLE';
}

export type SupplyStep =
  | 'CHECK'
  | 'COLLECT'
  | 'DISTRIBUTE'
  | 'RETURN_SELECT'
  | 'RETURN_PICK'
  | 'DONE';

export interface SupplyContext {
  step: SupplyStep;
  /** 供牌池（公开） */
  pool: Card[];
  /** 回牌池（公开） */
  returnPool: Card[];
  /** 每个输家上交的牌 */
  perLoser: Map<number, Card[]>;
  /** 每个赢家收到几张（决定要返还几张） */
  perWinner: Map<number, number>;
  /** 每个输家上交的最大牌（决定回牌挑选顺序） */
  biggestCardByLoser: Map<number, Card>;
  /** 赢家已提交的回牌 */
  returns: Map<number, Card[]>;
  /**
   * 供牌流向（谁交给谁），供牌动画用：
   * from = 输家座位，to = 赢家座位，card = 那张牌
   */
  transfers: { from: number; to: number; card: Card }[];
}

/** 结算结果 */
export interface NormalResult {
  mode: 'NORMAL';
  /** 地主方总分 */
  lScore: number;
  /** 非地主方总分 */
  fScore: number;
  /** |lScore - fScore|，4 = 大赢，2 = 小赢，0 = 平局 */
  scoreDiff: number;
  winnerSeats: number[];
  loserSeats: number[];
  draw: boolean;
}

export interface DoubleResult {
  mode: 'DOUBLE';
  lScore: number;
  fScore: number;
  winnerSeats: number[];
  loserSeats: number[];
  draw: false;
}

export type Result = NormalResult | DoubleResult;

export interface GameState {
  handNo: number;
  phase: Phase;

  /** 长度固定为 4，下标即座位号 */
  players: PlayerState[];

  /** 地主方座位：非双地 2 个；双地 1 个 */
  landlordSeats: number[];
  /** 双地玩家（同时持有 ♠3 与 ♠A）；非双地为 null */
  doubleSeat: number | null;
  /** 本局明牌的座位 */
  revealedSeat: number | null;

  /** 上一局产生、本局要执行的债务 */
  pendingDebt: Debt | null;
  supplyContext: SupplyContext | null;

  /** 本局首发座位（PLAYING 开始时确定） */
  firstSeat: number | null;
  /** 供牌产生首发时的座位（供最大牌者）；由 supply 阶段写入 */
  firstSeatBySupply: number | null;
  /** 当前该行动的座位 */
  currentSeat: number;

  /** 当前需要压过的牌；null 表示自由领出 */
  topPattern: Pattern | null;
  /** 当前最大牌的座位 */
  topSeat: number | null;
  /** 是否处于三条阶段 */
  threePhase: boolean;
  /** 本局是否还没有人出过牌 */
  isFirstPlay: boolean;
  /** 自最后一次出牌以来连续 PASS 的人数 */
  passesSinceLastPlay: number;
  /**
   * 第几墩（trick）。每局从 1 开始：
   * - 进入 PLAYING 时置 1；
   * - 「其余人全部不要」后由最后出牌者领出 → +1（新一墩）；
   * - 有人打完最后一张（顺风）后由下家领出 → +1（新一墩）。
   * UI 用它判断「每人本轮打出的牌/不出」什么时候清空。
   */
  trickNo: number;

  /** 已公开的牌 id（明牌的两张、锁定者的 13 张、供牌/回牌池） */
  publicCards: number[];

  finishOrder: number[];
  nextRankSlot: number;
  /** 下标 1..4，名次是否已被占用 */
  rankTaken: boolean[];

  /** 本局已重新发牌次数（上限 MAX_REDEAL） */
  redealCount: number;

  /**
   * 供牌「等待确认」：只在调用方显式要求时启用（UI 要在供牌前先给玩家看几秒倒计时）。
   * - supplyPauseRequested = true：本局在供牌前会先停下来等 CONFIRM_SUPPLY；
   * - supplyPaused = true：当前正停在 CHECK 步骤等确认。
   * 默认都是 false，规则引擎/自对弈行为不变。
   */
  supplyPauseRequested: boolean;
  supplyPaused: boolean;

  /**
   * 本局通过「供牌」拿到的牌 id（赢家视角）。
   * 界面用它在「正式开始之前」把这些牌标成不同颜色；进入 PLAYING 时清空（复原颜色）。
   */
  supplyGainedIds: number[];

  /** 锁定窗口内各座位的最新意向（true = 申请锁定） */
  lockIntents: Map<number, boolean>;

  /** 本局结果（SETTLE 后写入） */
  result: Result | null;

  log: GameEvent[];
}

// ---------------------------------------------------------------------------
// 动作与事件
// ---------------------------------------------------------------------------

export type Action =
  | { kind: 'REVEAL' }
  | { kind: 'REDEAL' }
  | { kind: 'RETURN_CARDS'; cards: Card[] }
  | { kind: 'PICK_RETURN'; card: Card }
  | { kind: 'LOCK' }
  | { kind: 'UNLOCK' }
  | { kind: 'PLAY'; cards: Card[] }
  | { kind: 'PASS' }
  /** UI 专用：供牌倒计时结束后确认执行供牌（配合 supplyPauseRequested） */
  | { kind: 'CONFIRM_SUPPLY' };

export type GameEvent =
  | { t: 'DEAL'; handNo: number }
  | { t: 'REVEALED'; seat: number; forced: boolean }
  | { t: 'REDEAL'; handNo: number }
  | { t: 'SUPPLY'; from: number; cards: Card[] }
  | { t: 'DISTRIBUTE'; to: number; cards: Card[] }
  | { t: 'RETURN'; from: number; cards: Card[]; auto: boolean }
  | { t: 'PICK_RETURN'; by: number; card: Card; auto: boolean }
  | { t: 'LOCKED'; seat: number; cards: Card[] }
  | { t: 'LOCK_FAILED'; seats: number[] }
  | { t: 'PLAY'; seat: number; cards: Card[]; type: PatternType; trick: number }
  | { t: 'PASS'; seat: number; trick: number }
  | { t: 'FINISH'; seat: number; rank: number }
  | { t: 'FIRST_SEAT'; seat: number; reason: 'REVEAL' | 'SUPPLY' | 'DIAMOND4' | 'SUCCESSOR' }
  | { t: 'SETTLE'; result: Result };
