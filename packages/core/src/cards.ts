/**
 * 牌面编码 —— 与《开发文档.md》2.1 完全一致。
 *
 * 点数 rank（数值越大牌越大）：
 *   4→4 5→5 6→6 7→7 8→8 9→9 10→10 J→11 Q→12 K→13 A→14 2→15 3→16
 * 花色 suit（数值越大花色越大）：
 *   ♦→1 ♣→2 ♥→3 ♠→4
 * 牌 id：固定为 (suit - 1) * 13 + (rank - 4)，取值 0..51，唯一标识一张牌。
 *
 * 采用这套编码后：rank 大即牌大；rank >= 11 才需要比花色；rank <= 10（4~10）不分花色。
 */

export type Rank = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;
export type Suit = 1 | 2 | 3 | 4;

export interface Card {
  readonly id: number;
  readonly rank: Rank;
  readonly suit: Suit;
}

/** 全部点数，从小到大 */
export const RANKS: readonly Rank[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** 全部花色，从小到大：♦ ♣ ♥ ♠ */
export const SUITS: readonly Suit[] = [1, 2, 3, 4];

export const RANK_LABEL: Readonly<Record<Rank, string>> = {
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
  16: '3',
};

export const SUIT_SYMBOL: Readonly<Record<Suit, string>> = {
  1: '♦',
  2: '♣',
  3: '♥',
  4: '♠',
};

/** 计算一张牌的固定 id（0..51） */
export function cardId(rank: Rank, suit: Suit): number {
  return (suit - 1) * 13 + (rank - 4);
}

/** 由点数和花色构造一张牌 */
export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

/** 一副完整的牌：52 张，去掉大小王 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

/** 牌面文字，例如 ♠3、♦4、♥J、♣10（用于日志与 UI） */
export function cardToText(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`;
}

// ---------------------------------------------------------------------------
// 以下为 M1 规则引擎使用的牌工具
// ---------------------------------------------------------------------------

export type CardKey = Pick<Card, 'rank' | 'suit'>;

/**
 * 单张牌比较（供排序 / 供牌 / 回牌 / 首发使用）。
 * 点数不同先比点数；点数相同一律比花色（♠>♥>♣>♦）。
 * 注意：4~10 在「牌型比较」里不分花色，但这里用于取顺序，
 * 4~10 同点数按花色排不会影响「取最大的 N 张」的结果（2026-11-15 用户确认并列按花色）。
 */
export function cmpCard(a: Card, b: Card): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.suit - b.suit;
}

/** 从大到小排序（返回新数组，不改原数组） */
export function sortDesc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => cmpCard(b, a));
}

/** 从大到小排序后取最小，空数组返回 null */
export function minCard(cards: readonly Card[]): Card | null {
  if (cards.length === 0) return null;
  let best = cards[0] as Card;
  for (const card of cards) {
    if (cmpCard(card, best) < 0) best = card;
  }
  return best;
}

/** 最大的一张牌；空数组返回 null */
export function maxCard(cards: readonly Card[]): Card | null {
  if (cards.length === 0) return null;
  let best = cards[0] as Card;
  for (const card of cards) {
    if (cmpCard(card, best) > 0) best = card;
  }
  return best;
}

/** 是否 ♠3（地主牌之一，永远不能供出/回出） */
export function isLandlord3(card: Card): boolean {
  return card.rank === 16 && card.suit === 4;
}

/** 是否 ♠A（地主牌之一，永远不能供出/回出） */
export function isLandlordA(card: Card): boolean {
  return card.rank === 14 && card.suit === 4;
}

/** 是否地主牌（♠3 或 ♠A） */
export function isLandlordCard(card: Card): boolean {
  return isLandlord3(card) || isLandlordA(card);
}

/** 是否可以作为供牌 / 回牌的牌（排除 ♠3、♠A） */
export function isEligibleForSupply(card: Card): boolean {
  return !isLandlordCard(card);
}

/** 从手牌里移除指定的牌，返回新数组；找不到的牌会被跳过 */
export function removeCards(hand: readonly Card[], cards: readonly Card[]): Card[] {
  const ids = new Set(cards.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

/** 判断一手牌里是否包含指定的牌 id 集合 */
export function containsCards(hand: readonly Card[], cards: readonly Card[]): boolean {
  const ids = new Set(hand.map((card) => card.id));
  return cards.every((card) => ids.has(card.id));
}

/** 牌的唯一标识字符串，便于日志与 Set/Map 去重 */
export function cardKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

/** 找到持有指定牌（点数 + 花色）的座位；找不到返回 -1 */
export function holderOf(hands: readonly (readonly Card[])[], target: CardKey): number {
  for (let seat = 0; seat < hands.length; seat++) {
    const hand = hands[seat] as readonly Card[];
    if (hand.some((card) => card.rank === target.rank && card.suit === target.suit)) {
      return seat;
    }
  }
  return -1;
}

/** 在指定手牌里找一张牌（点数 + 花色），找不到返回 null */
export function findCard(hand: readonly Card[], rank: Rank, suit: Suit): Card | null {
  return hand.find((card) => card.rank === rank && card.suit === suit) ?? null;
}

/** 随机源：返回 [0,1) 的函数，由调用方注入，规则引擎自身不碰随机数 */
export type Rng = () => number;

/**
 * Fisher–Yates 洗牌（返回新数组）。用注入的 rng 保证可复现。
 */
export function shuffle(deck: readonly Card[], rng: Rng): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i] as Card;
    result[i] = result[j] as Card;
    result[j] = tmp;
  }
  return result;
}

/** 一副洗好的 52 张牌 */
export function createShuffledDeck(rng: Rng): Card[] {
  return shuffle(createDeck(), rng);
}

/** 发牌：洗牌后按顺序给 4 家各 13 张 */
export function dealHands(rng: Rng): Card[][] {
  const deck = createShuffledDeck(rng);
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) {
    (hands[i % 4] as Card[]).push(deck[i] as Card);
  }
  return hands;
}
