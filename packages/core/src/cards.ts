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
