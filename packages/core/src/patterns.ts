import type { Card } from './cards';
import { maxCard } from './cards';
import { TIER, type Category, type Pattern, type PatternType } from './types';

/**
 * 牌型识别（《开发文档》第 4 节 / 《玩法说明》第 3 节）。
 *
 * 规则要点：
 * - 张数 + 点数分布基本唯一确定牌型；识别不出来返回 null。
 * - 5 张既同花又连续 → 一律 STRAIGHT_FLUSH（不能当顺子或同花）。
 * - 顺子：点数连续 5 张，范围 4~A（rank 4..14）；2(15)、3(16) 不能进顺子。
 * - 三条夹一 / 四夹一：夹的牌不能与三张/四张同点数。
 * - 同花：5 张同花色（不要求连续）。
 *
 * 返回的 Pattern 必须填好 type / cards / category / tier / key / equalAllowed，
 * key 与 equalAllowed 的定义见《开发文档》3.1（注意同花/同花顺是「先花色后点数」，
 * 顺子是「先点数，最大牌 >= J 才比花色」）。
 */

/** 组装 Pattern：统一补上 category / tier，cards 做一份拷贝避免外部改动 */
function makePattern(
  type: PatternType,
  cards: readonly Card[],
  key: readonly [number, number],
  equalAllowed: boolean,
): Pattern {
  return {
    type,
    cards: [...cards],
    category: categoryOf(type),
    tier: TIER[type],
    key,
    equalAllowed,
  };
}

/** 按 rank 统计张数 */
function countByRank(cards: readonly Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

/** 找出恰好出现 wanted 次的 rank；没有返回 null */
function rankWithCount(counts: ReadonlyMap<number, number>, wanted: number): number | null {
  for (const [rank, count] of counts) {
    if (count === wanted) return rank;
  }
  return null;
}

/** 5 张是否同花色 */
function isFlush(cards: readonly Card[]): boolean {
  const suit = (cards[0] as Card).suit;
  return cards.every((card) => card.suit === suit);
}

/**
 * 5 张是否构成顺子：点数互不相同、相邻差 1，且整体落在 4~A（rank 4..14）。
 * 2(15)、3(16) 不能进顺子。
 */
function isStraight(cards: readonly Card[]): boolean {
  const ranks = cards.map((card) => card.rank).sort((a, b) => a - b);
  const min = ranks[0] as number;
  const max = ranks[ranks.length - 1] as number;
  if (min < 4 || max > 14) return false;
  for (let i = 1; i < ranks.length; i++) {
    if ((ranks[i] as number) - (ranks[i - 1] as number) !== 1) return false;
  }
  return true;
}

export function identifyPattern(cards: readonly Card[]): Pattern | null {
  const n = cards.length;
  if (n < 1 || n > 5) return null;

  // 1 张：单张。4~10 不分花色（key[1]=0），J 以上比花色。
  if (n === 1) {
    const card = cards[0] as Card;
    return makePattern(
      'SINGLE',
      cards,
      [card.rank, card.rank >= 11 ? card.suit : 0],
      card.rank <= 10,
    );
  }

  // 2 张：同点数才是对子。
  if (n === 2) {
    const a = cards[0] as Card;
    const b = cards[1] as Card;
    if (a.rank !== b.rank) return null;
    const maxSuit = a.suit > b.suit ? a.suit : b.suit;
    return makePattern(
      'PAIR',
      cards,
      [a.rank, a.rank >= 11 ? maxSuit : 0],
      a.rank <= 10,
    );
  }

  const counts = countByRank(cards);

  // 3 张：同点数才是三条。
  if (n === 3) {
    if (counts.size !== 1) return null;
    const rank = (cards[0] as Card).rank;
    return makePattern('TRIPLE', cards, [rank, 0], false);
  }

  // 4 张：4 张同点数 = 炸弹；3+1 = 三条夹一；其余非法。
  if (n === 4) {
    if (counts.size === 1) {
      const rank = (cards[0] as Card).rank;
      return makePattern('BOMB', cards, [rank, 0], false);
    }
    const tripleRank = rankWithCount(counts, 3);
    if (tripleRank !== null) {
      return makePattern('TRIPLE_ONE', cards, [tripleRank, 0], false);
    }
    return null;
  }

  // n === 5
  const flush = isFlush(cards);
  const straight = isStraight(cards);
  const top = maxCard(cards) as Card;

  // 同花顺优先：5 张既同花又连续，只能算同花顺。
  if (flush && straight) {
    return makePattern('STRAIGHT_FLUSH', cards, [top.suit, top.rank], false);
  }

  // 4+1 = 四夹一（夹的牌不能与四张同点数，counts 分布为 4+1）。
  const quadRank = rankWithCount(counts, 4);
  if (quadRank !== null) {
    return makePattern('FOUR_ONE', cards, [quadRank, 0], false);
  }

  // 3+2 = 三条夹双。
  const tripleRank = rankWithCount(counts, 3);
  const pairRank = rankWithCount(counts, 2);
  if (tripleRank !== null && pairRank !== null) {
    return makePattern('TRIPLE_PAIR', cards, [tripleRank, 0], false);
  }

  // 同花：key = [花色, 最大牌点数]，先花色后点数。
  if (flush) {
    return makePattern('FLUSH', cards, [top.suit, top.rank], false);
  }

  // 顺子：key = [最大牌点数, 最大牌 >= J ? 最大牌花色 : 0]，
  // 最大牌是 8/9/10 时 equalAllowed = true（4~10 不分花色）。
  if (straight) {
    return makePattern(
      'STRAIGHT',
      cards,
      [top.rank, top.rank >= 11 ? top.suit : 0],
      top.rank <= 10,
    );
  }

  return null;
}

/** 牌型 → 大类（单张 / 对子 / 牌组） */
export function categoryOf(type: PatternType): Category {
  if (type === 'SINGLE') return 'SINGLE';
  if (type === 'PAIR') return 'PAIR';
  return 'GROUP';
}
