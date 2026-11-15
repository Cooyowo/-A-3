import { describe, expect, it } from 'vitest';

import { cardToText, createDeck, RANKS, SUITS } from '../src/index';

describe('createDeck（M0 冒烟用例）', () => {
  it('一副牌正好 52 张', () => {
    expect(createDeck()).toHaveLength(52);
  });

  it('id 唯一且落在 0..51', () => {
    const ids = createDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(52);
    expect(Math.min(...ids)).toBe(0);
    expect(Math.max(...ids)).toBe(51);
  });

  it('每个「点数 × 花色」组合恰好一张，没有大小王', () => {
    const deck = createDeck();
    const keys = deck.map((c) => `${c.rank}-${c.suit}`);
    expect(new Set(keys).size).toBe(52);

    for (const rank of RANKS) {
      for (const suit of SUITS) {
        expect(keys).toContain(`${rank}-${suit}`);
      }
    }
  });

  it('牌面文字可读：♦4 / ♣10 / ♥J / ♠3', () => {
    const deck = createDeck();
    const find = (rank: number, suit: number) =>
      deck.find((c) => c.rank === rank && c.suit === suit)!;

    expect(cardToText(find(4, 1))).toBe('♦4');
    expect(cardToText(find(10, 2))).toBe('♣10');
    expect(cardToText(find(11, 3))).toBe('♥J');
    expect(cardToText(find(16, 4))).toBe('♠3');
  });
});
