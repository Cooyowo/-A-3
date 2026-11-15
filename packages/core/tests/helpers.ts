import { makeCard, type Card, type Rank, type Rng, type Suit } from '../src/cards';
import type { Debt, GameState, Pattern, Phase, PlayerState } from '../src/types';

/**
 * 测试共用工具：确定性随机源、按文字构造牌、手工构造 GameState。
 * 所有测试都可以 import 这里，避免各写一套。
 */

/** 确定性伪随机数（mulberry32），同 seed 结果完全一致 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUIT_CODE: Readonly<Record<string, Suit>> = { '♦': 1, '♣': 2, '♥': 3, '♠': 4 };

const RANK_CODE: Readonly<Record<string, Rank>> = {
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  '2': 15,
  '3': 16,
};

/** 构造一张牌：c(7, 4) = ♠7 */
export function c(rank: Rank, suit: Suit): Card {
  return makeCard(rank, suit);
}

/**
 * 按文字构造一组牌，例如：
 *   cards('♠7 ♥7 ♣7')  → 三条 7
 *   cards('♠4 ♥5 ♠6 ♦7 ♠8') → 顺子
 */
export function cards(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const suitSymbol = token[0] as string;
      const rankText = token.slice(1);
      const suit = SUIT_CODE[suitSymbol];
      const rank = RANK_CODE[rankText];
      if (suit === undefined || rank === undefined) {
        throw new Error(`无法解析牌面：${token}`);
      }
      return makeCard(rank, suit);
    });
}

export interface MakeStateOptions {
  hands?: readonly (readonly Card[])[];
  phase?: Phase;
  handNo?: number;
  landlordSeats?: number[];
  doubleSeat?: number | null;
  revealedSeat?: number | null;
  pendingDebt?: Debt | null;
  firstSeat?: number | null;
  firstSeatBySupply?: number | null;
  currentSeat?: number;
  topPattern?: Pattern | null;
  topSeat?: number | null;
  threePhase?: boolean;
  isFirstPlay?: boolean;
  passesSinceLastPlay?: number;
  ranks?: readonly (number | null)[];
  outSeats?: readonly number[];
  lockedSeats?: readonly number[];
  publicCards?: number[];
  rankTaken?: boolean[];
  nextRankSlot?: number;
  redealCount?: number;
}

/** 手工构造一个牌局状态，未指定的字段取「刚开局」的默认值 */
export function makeState(options: MakeStateOptions = {}): GameState {
  const hands = options.hands ?? [[], [], [], []];
  const ranks = options.ranks ?? [null, null, null, null];

  const players: PlayerState[] = [0, 1, 2, 3].map((seat) => {
    const rank = ranks[seat] ?? null;
    const out = options.outSeats !== undefined ? options.outSeats.includes(seat) : rank !== null;
    return {
      seat,
      hand: [...(hands[seat] ?? [])],
      out,
      locked: options.lockedSeats !== undefined && options.lockedSeats.includes(seat),
      rank,
    };
  });

  const rankTaken: boolean[] =
    options.rankTaken ??
    (() => {
      const taken = [false, false, false, false, false];
      for (let seat = 0; seat < 4; seat++) {
        const seatRank = ranks[seat];
        if (seatRank !== null && seatRank !== undefined && seatRank >= 1 && seatRank <= 4) {
          taken[seatRank] = true;
        }
      }
      return taken;
    })();

  const landlordSeats = options.landlordSeats ?? [0, 1];
  const doubleSeat = options.doubleSeat !== undefined ? options.doubleSeat : null;

  return {
    handNo: options.handNo ?? 1,
    phase: options.phase ?? 'PLAYING',
    players,
    landlordSeats,
    doubleSeat,
    revealedSeat: options.revealedSeat ?? null,
    pendingDebt: options.pendingDebt ?? null,
    supplyContext: null,
    firstSeat: options.firstSeat !== undefined ? options.firstSeat : 0,
    firstSeatBySupply: options.firstSeatBySupply ?? null,
    currentSeat: options.currentSeat ?? 0,
    topPattern: options.topPattern ?? null,
    topSeat: options.topSeat ?? null,
    threePhase: options.threePhase ?? false,
    isFirstPlay: options.isFirstPlay ?? (options.topPattern === undefined || options.topPattern === null),
    passesSinceLastPlay: options.passesSinceLastPlay ?? 0,
    trickNo: 0,
    publicCards: options.publicCards ?? [],
    finishOrder: [],
    nextRankSlot: options.nextRankSlot ?? 1,
    rankTaken,
    redealCount: options.redealCount ?? 0,
    supplyGainedIds: [],
    lockIntents: new Map<number, boolean>(),
    result: null,
    log: [],
  };
}

/** 构造一副完整 52 张牌（用于发牌类测试） */
export function fullDeckCards(): Card[] {
  const deck: Card[] = [];
  for (const suit of [1, 2, 3, 4] as Suit[]) {
    for (const rank of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as Rank[]) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}
