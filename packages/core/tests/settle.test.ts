import { describe, expect, it } from 'vitest';

import { cardToText, type Card } from '../src/cards';
import {
  assignRemainingRanks,
  buildDebt,
  checkSupplyPossible,
  collectSupply,
  computeResult,
  defaultReturnCards,
  distributeSupply,
  eligibleCards,
  pickReturnOrder,
  resolveFirstSeat,
} from '../src/settle';
import type { Debt } from '../src/types';

import { cards, makeState } from './helpers';

/** 把一手牌转成可读文字，方便断言具体牌面 */
function texts(hand: readonly Card[]): string[] {
  return hand.map(cardToText);
}

/** 手工构造债务（测试里只覆盖关心的字段） */
function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    winners: [],
    losers: [],
    amountPerLoser: 1,
    total: 2,
    revealed: false,
    mode: 'NORMAL',
    ...overrides,
  };
}

// ===========================================================================
// 黄金用例 S-01 ~ S-12（《开发文档》13.4 + 结算表 §10.3）
// ===========================================================================

describe('S-01 / S-02 / S-03：非双地结算表', () => {
  it('S-01 顺序 L1,L2,F1,F2 → L 5:1 大赢，F 每人供 2 张（共 4 张）', () => {
    const state = makeState({ landlordSeats: [0, 1], ranks: [1, 2, 3, 4] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'NORMAL',
      lScore: 5,
      fScore: 1,
      scoreDiff: 4,
      winnerSeats: [0, 1],
      loserSeats: [2, 3],
      draw: false,
    });

    expect(buildDebt(state, result)).toEqual({
      winners: [0, 1],
      losers: [2, 3],
      amountPerLoser: 2,
      total: 4,
      revealed: false,
      mode: 'NORMAL',
    });
  });

  it('S-02 顺序 L1,F1,L2,F2 → L 4:2 小赢，F 每人供 1 张（共 2 张）', () => {
    const state = makeState({ landlordSeats: [0, 1], ranks: [1, 3, 2, 4] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'NORMAL',
      lScore: 4,
      fScore: 2,
      scoreDiff: 2,
      winnerSeats: [0, 1],
      loserSeats: [2, 3],
      draw: false,
    });

    expect(buildDebt(state, result)).toEqual({
      winners: [0, 1],
      losers: [2, 3],
      amountPerLoser: 1,
      total: 2,
      revealed: false,
      mode: 'NORMAL',
    });
  });

  it('S-03 顺序 L1,F1,F2,L2 → 3:3 平局，不供牌（debt = null）', () => {
    const state = makeState({ landlordSeats: [0, 1], ranks: [1, 4, 2, 3] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'NORMAL',
      lScore: 3,
      fScore: 3,
      scoreDiff: 0,
      draw: true,
    });

    expect(buildDebt(state, result)).toBeNull();
  });
});

describe('S-04 / S-05 / S-06：双地结算表（不补名次）', () => {
  it('S-04 双地 L 第 1 名 → L 2:0，未明牌 3 个 F 各供 2 张（共 6 张）', () => {
    const state = makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [1, null, null, null] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'DOUBLE',
      lScore: 2,
      fScore: 0,
      winnerSeats: [0],
      loserSeats: [1, 2, 3],
      draw: false,
    });

    expect(buildDebt(state, result)).toEqual({
      winners: [0],
      losers: [1, 2, 3],
      amountPerLoser: 2,
      total: 6,
      revealed: false,
      mode: 'DOUBLE',
    });
  });

  it('S-05 双地 L 第 2 名 → L 2:1，未明牌 3 个 F 各供 2 张', () => {
    const state = makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [2, 1, null, null] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'DOUBLE',
      lScore: 2,
      fScore: 1,
      winnerSeats: [0],
      loserSeats: [1, 2, 3],
      draw: false,
    });

    expect(buildDebt(state, result)).toMatchObject({
      losers: [1, 2, 3],
      amountPerLoser: 2,
      total: 6,
    });
  });

  it('S-06 双地两个 F 先出完 → F 2:0，L 供 6 张；未走完的 F 不补名次', () => {
    const state = makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [null, 1, 2, null] });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'DOUBLE',
      lScore: 0,
      fScore: 2,
      winnerSeats: [1, 2, 3],
      loserSeats: [0],
      draw: false,
    });
    // 双地不补名次：没有出完的 F（座位 3）rank 仍为 null
    expect(state.players[3]!.rank).toBeNull();

    expect(buildDebt(state, result)).toEqual({
      winners: [1, 2, 3],
      losers: [0],
      amountPerLoser: 6,
      total: 6,
      revealed: false,
      mode: 'DOUBLE',
    });
  });
});

describe('S-07 / S-08：双地明牌翻倍 6 → 12', () => {
  it('S-07 双地明牌 L 赢 → 3 个 F 各供 4 张（共 12 张）', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      revealedSeat: 0,
      ranks: [1, null, null, null],
    });

    const result = computeResult(state);
    expect(result).toMatchObject({ mode: 'DOUBLE', lScore: 2, fScore: 0, winnerSeats: [0] });

    expect(buildDebt(state, result)).toEqual({
      winners: [0],
      losers: [1, 2, 3],
      amountPerLoser: 4,
      total: 12,
      revealed: true,
      mode: 'DOUBLE',
    });
  });

  it('S-08 双地明牌 L 输 → L 一人供 12 张', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      revealedSeat: 0,
      ranks: [null, 1, 2, null],
    });

    const result = computeResult(state);
    expect(result).toMatchObject({ mode: 'DOUBLE', lScore: 0, fScore: 2, winnerSeats: [1, 2, 3] });

    expect(buildDebt(state, result)).toEqual({
      winners: [1, 2, 3],
      losers: [0],
      amountPerLoser: 12,
      total: 12,
      revealed: true,
      mode: 'DOUBLE',
    });
  });

  it('明牌翻倍的依据只看本局 revealedSeat：未明牌 6 张，明牌 12 张', () => {
    const notRevealed = makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [1, null, null, null] });
    const revealed = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      revealedSeat: 0,
      ranks: [1, null, null, null],
    });

    expect(buildDebt(notRevealed, computeResult(notRevealed))?.total).toBe(6);
    expect(buildDebt(revealed, computeResult(revealed))?.total).toBe(12);
  });
});

describe('S-09：供牌时跳过 ♠3 / ♠A', () => {
  it('S-09 输家最大的牌是 ♠3 → 跳过，取下一张最大的', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      hands: [[], cards('♠3 ♥3 ♠2 ♣8 ♣9'), [], []],
    });

    const supply = collectSupply(state, makeDebt({ losers: [1], amountPerLoser: 2, total: 2 }));

    expect(texts(supply.pool)).toEqual(['♥3', '♠2']);
    expect(texts(supply.perLoser.get(1) ?? [])).toEqual(['♥3', '♠2']);
    // 交出的牌从手牌移除，♠3 留在手里
    expect(texts(state.players[1]!.hand)).toEqual(['♠3', '♣8', '♣9']);
  });

  it('S-09b 输家最大的牌是 ♠A → 同样跳过', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      hands: [[], [], cards('♠A ♥2 ♣9 ♦4'), []],
    });

    const supply = collectSupply(state, makeDebt({ losers: [2], amountPerLoser: 2, total: 2 }));

    expect(texts(supply.pool)).toEqual(['♥2', '♣9']);
    expect(texts(state.players[2]!.hand)).toEqual(['♠A', '♦4']);
  });
});

describe('S-10：回牌不能回 ♠3 / ♠A', () => {
  it('合法回牌集合排除两张地主牌；自动回牌只从合法牌里取最小', () => {
    const hand = cards('♠A ♠3 ♦4 ♥5 ♣6 ♠7 ♥8 ♣9 ♠10 ♥J ♦Q ♣K ♠2');

    expect(hand).toHaveLength(13);
    expect(eligibleCards(hand)).toHaveLength(11);
    expect(texts(eligibleCards(hand))).not.toContain('♠A');
    expect(texts(eligibleCards(hand))).not.toContain('♠3');

    // 手里最小的合法牌是 ♦4（♠A/♠3 比它大且非法），自动回牌只能回合法牌
    expect(texts(defaultReturnCards(hand, 1))).toEqual(['♦4']);
    expect(texts(defaultReturnCards(hand, 2))).toEqual(['♦4', '♥5']);
    expect(texts(defaultReturnCards(hand, 2))).not.toContain('♠A');
  });
});

describe('S-11 / S-12：下一局首发', () => {
  it('S-11 没有供牌（平局 / 首局）→ ♦4 持有者首发', () => {
    const state = makeState({ hands: [[], [], cards('♦4 ♣5'), []] });

    expect(resolveFirstSeat(state)).toBe(2);
  });

  it('S-12 本局明牌 → 明牌者首发（压过供牌最大牌者与 ♦4）', () => {
    const state = makeState({
      revealedSeat: 3,
      firstSeatBySupply: 1,
      hands: [cards('♦4 ♣4'), [], [], []],
    });

    expect(resolveFirstSeat(state)).toBe(3);
  });
});

// ===========================================================================
// 供牌收牌 / 分牌
// ===========================================================================

describe('collectSupply（COLLECT）', () => {
  it('每个输家交出最大的 N 张合法牌，从手牌移除，汇总成从大到小的供牌池', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      hands: [
        [],
        cards('♥3 ♠2 ♣8'),
        cards('♣3 ♦2 ♥7'),
        [],
      ],
    });

    const supply = collectSupply(
      state,
      makeDebt({ losers: [1, 2], amountPerLoser: 2, total: 4 }),
    );

    expect(texts(supply.pool)).toEqual(['♥3', '♣3', '♠2', '♦2']);
    expect(texts(supply.perLoser.get(1) ?? [])).toEqual(['♥3', '♠2']);
    expect(texts(supply.perLoser.get(2) ?? [])).toEqual(['♣3', '♦2']);
    // 手牌被移除已交出的牌
    expect(texts(state.players[1]!.hand)).toEqual(['♣8']);
    expect(texts(state.players[2]!.hand)).toEqual(['♥7']);
  });
});

describe('distributeSupply（DISTRIBUTE，《玩法说明》9.7）', () => {
  it('赢家 C(3 分) D(2 分)，池 ♥3 ♣3 ♠2 ♦2 → C 拿 ♥3 ♠2，D 拿 ♣3 ♦2', () => {
    // L 方 = 座位 2 (C) / 座位 3 (D)，名次 1、2 → 5:1 大赢
    const state = makeState({
      landlordSeats: [2, 3],
      ranks: [null, null, 1, 2],
      hands: [[], [], [], []],
    });
    // 非地主方（座位 0、1）手里最大的牌就是 9.7 里交出的那四张
    state.players[0]!.hand = cards('♥3 ♠2 ♣8');
    state.players[1]!.hand = cards('♣3 ♦2 ♥7');

    const result = computeResult(state);
    expect(result).toMatchObject({ mode: 'NORMAL', lScore: 5, fScore: 1, scoreDiff: 4 });

    const debt = buildDebt(state, result);
    expect(debt).not.toBeNull();
    const supply = collectSupply(state, debt as Debt);
    expect(texts(supply.pool)).toEqual(['♥3', '♣3', '♠2', '♦2']);

    const perWinner = distributeSupply(state, supply.pool, debt as Debt);
    expect(perWinner.get(2)).toBe(2);
    expect(perWinner.get(3)).toBe(2);
    // C 先拿：♥3、♠2；D 后拿：♣3、♦2
    expect(texts(state.players[2]!.hand)).toEqual(['♥3', '♠2']);
    expect(texts(state.players[3]!.hand)).toEqual(['♣3', '♦2']);
  });

  it('双地 L 赢（1 个赢家）：3 个 F 各供 2 张，6 张全部给 L', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      ranks: [1, null, null, null],
      hands: [
        cards('♠3 ♠A'),
        cards('♥3 ♣8'),
        cards('♣3 ♣9'),
        cards('♥2 ♦2'),
      ],
    });

    const result = computeResult(state);
    const debt = buildDebt(state, result) as Debt;
    expect(debt.total).toBe(6);

    const supply = collectSupply(state, debt);
    expect(texts(supply.pool)).toEqual(['♥3', '♣3', '♥2', '♦2', '♣9', '♣8']);

    const perWinner = distributeSupply(state, supply.pool, debt);
    expect(perWinner.get(0)).toBe(6);
    expect(state.players[0]!.hand).toHaveLength(8);
  });
});

describe('Q-049：双地 F 赢且有一个 F 提前锁定 → 3 个 F 都是赢家', () => {
  it('3 个 F 都进 winnerSeats，L 供的 6 张由 3 个 F 各拿 2 张（锁定者排最后）', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      ranks: [null, 1, 2, 3],
      lockedSeats: [3],
      hands: [
        // L(双地) 手里 13 张：♠3/♠A 不能供
        cards('♠3 ♠A ♥3 ♣3 ♦3 ♠2 ♥2 ♣2 ♠4 ♥4 ♣4 ♦4 ♣5'),
        [],
        [],
        [],
      ],
    });

    const result = computeResult(state);
    expect(result.mode).toBe('DOUBLE');
    expect(result.lScore).toBe(0);
    expect(result.fScore).toBe(2);
    // 胜方必须包含全部 3 个 F（含已锁定的座位 3）
    expect(result.winnerSeats).toHaveLength(3);
    expect([...result.winnerSeats].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.loserSeats).toEqual([0]);

    const debt = buildDebt(state, result) as Debt;
    expect(debt).toEqual({
      winners: [1, 2, 3],
      losers: [0],
      amountPerLoser: 6,
      total: 6,
      revealed: false,
      mode: 'DOUBLE',
    });

    const supply = collectSupply(state, debt);
    expect(texts(supply.pool)).toEqual(['♥3', '♣3', '♦3', '♠2', '♥2', '♣2']);
    // ♠3 / ♠A 留在 L 手里
    expect(texts(state.players[0]!.hand)).toContain('♠3');
    expect(texts(state.players[0]!.hand)).toContain('♠A');

    const perWinner = distributeSupply(state, supply.pool, debt);
    expect(perWinner.get(1)).toBe(2);
    expect(perWinner.get(2)).toBe(2);
    expect(perWinner.get(3)).toBe(2);
    expect(texts(state.players[1]!.hand)).toEqual(['♥3', '♠2']);
    expect(texts(state.players[2]!.hand)).toEqual(['♣3', '♥2']);
    expect(texts(state.players[3]!.hand)).toEqual(['♦3', '♣2']);
  });

  it('Q-049 排序：得分 1 分的两个 F 按名次在前，锁定者（0 分）最后', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      ranks: [null, 3, 2, 1],
      lockedSeats: [1],
    });

    const result = computeResult(state);

    expect(result.winnerSeats).toEqual([3, 2, 1]);
  });

  it('Q-049 明牌翻倍：L 供 12 张，3 个 F 各拿 4 张', () => {
    const state = makeState({
      landlordSeats: [0],
      doubleSeat: 0,
      revealedSeat: 0,
      ranks: [null, 1, 2, 3],
      lockedSeats: [3],
    });

    const result = computeResult(state);
    const debt = buildDebt(state, result) as Debt;
    expect(debt).toMatchObject({ total: 12, amountPerLoser: 12, revealed: true, losers: [0] });

    const pool = cards('♥3 ♣3 ♦3 ♠2 ♥2 ♣2 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6');
    const perWinner = distributeSupply(state, pool, debt);
    expect(perWinner.get(1)).toBe(4);
    expect(perWinner.get(2)).toBe(4);
    expect(perWinner.get(3)).toBe(4);
  });
});

// ===========================================================================
// 回牌
// ===========================================================================

describe('pickReturnOrder（回牌挑选顺序，《玩法说明》7.5 / Q-011 / Q-040）', () => {
  it('按各输家上交的最大牌从大到小；点数相同按花色 ♠>♥>♣>♦', () => {
    const perLoser = new Map<number, Card[]>([
      [0, cards('♥9 ♣4')],
      [1, cards('♠9 ♦5')],
      [3, cards('♣10 ♦6')],
    ]);

    // 10 > 9；两张 9 里 ♠9 > ♥9
    expect(pickReturnOrder(perLoser)).toEqual([3, 1, 0]);
  });

  it('《玩法说明》7.5 示例：A 交 ♥3、B 交 ♣3 → A 先挑', () => {
    const perLoser = new Map<number, Card[]>([
      [0, cards('♥3 ♠2')],
      [1, cards('♣3 ♦2')],
    ]);

    expect(pickReturnOrder(perLoser)).toEqual([0, 1]);
  });

  it('4~10 同点数也按花色决定先后（Q-011）', () => {
    const perLoser = new Map<number, Card[]>([
      [2, cards('♦10 ♦6')],
      [0, cards('♣10 ♣7')],
    ]);

    expect(pickReturnOrder(perLoser)).toEqual([0, 2]);
  });
});

describe('defaultReturnCards（回牌超时自动取最小，《玩法说明》7.5 / Q-041）', () => {
  it('取最小的 count 张合法牌；count = 0 返回空', () => {
    const hand = cards('♠A ♠3 ♦4 ♥5 ♣6 ♠7');

    expect(texts(defaultReturnCards(hand, 0))).toEqual([]);
    expect(texts(defaultReturnCards(hand, 3))).toEqual(['♦4', '♥5', '♣6']);
  });
});

// ===========================================================================
// 补名次 / CHECK
// ===========================================================================

describe('assignRemainingRanks（非双地补名次，《开发文档》10.1 / Q-064）', () => {
  it('按剩余手牌数从少到多补名次，手牌数相同按座位号升序', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      ranks: [1, null, null, null],
      hands: [[], cards('♠4 ♥5 ♣6 ♦7 ♠8'), cards('♠4 ♥5'), cards('♣4 ♦5')],
    });

    assignRemainingRanks(state);

    // 座位 2、3 各 2 张（座位号小的先），座位 1 有 5 张最后
    expect(state.players[1]!.rank).toBe(4);
    expect(state.players[2]!.rank).toBe(2);
    expect(state.players[3]!.rank).toBe(3);
    // 已 out 的人不改
    expect(state.players[0]!.rank).toBe(1);
    expect(state.rankTaken.slice(1)).toEqual([true, true, true, true]);
    expect(state.nextRankSlot).toBe(4);
  });

  it('跳过提前锁定占用的第 3 名', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      ranks: [1, null, null, 3],
      lockedSeats: [3],
      hands: [[], cards('♠4'), cards('♥5 ♣6')],
    });

    assignRemainingRanks(state);

    expect(state.players[1]!.rank).toBe(2);
    expect(state.players[2]!.rank).toBe(4); // 第 3 名被锁定者占用，跳过
    expect(state.players[3]!.rank).toBe(3);
  });
});

describe('computeResult：非双地提前结束 + 锁定者（《玩法说明》8.5 三种结果）', () => {
  it('剩下的 F 拿第 1 名 → F 4:2 小赢（L 每人供 1 张）', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      ranks: [2, null, 1, 3],
      lockedSeats: [3],
      hands: [[], cards('♠4 ♥5 ♣6 ♦7 ♠8'), [], []],
    });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'NORMAL',
      lScore: 2,
      fScore: 4,
      scoreDiff: 2,
      winnerSeats: [2, 3],
      loserSeats: [0, 1],
      draw: false,
    });
    expect(buildDebt(state, result)).toEqual({
      winners: [2, 3],
      losers: [0, 1],
      amountPerLoser: 1,
      total: 2,
      revealed: false,
      mode: 'NORMAL',
    });
  });

  it('剩下的 F 拿第 2 名 → 3:3 平局', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      ranks: [1, null, 2, 3],
      lockedSeats: [3],
      hands: [[], cards('♠4 ♥5 ♣6 ♦7 ♠8'), [], []],
    });

    const result = computeResult(state);
    expect(result).toMatchObject({ lScore: 3, fScore: 3, scoreDiff: 0, draw: true });
    expect(buildDebt(state, result)).toBeNull();
  });

  it('剩下的 F 拿第 4 名 → L 5:1 大赢（F 每人供 2 张）', () => {
    const state = makeState({
      landlordSeats: [0, 1],
      ranks: [1, 2, null, 3],
      lockedSeats: [3],
      hands: [[], [], cards('♠4 ♥5 ♣6 ♦7 ♠8'), []],
    });

    const result = computeResult(state);
    expect(result).toMatchObject({
      mode: 'NORMAL',
      lScore: 5,
      fScore: 1,
      scoreDiff: 4,
      winnerSeats: [0, 1],
      loserSeats: [2, 3],
    });
    expect(buildDebt(state, result)).toMatchObject({
      winners: [0, 1],
      losers: [2, 3],
      amountPerLoser: 2,
      total: 4,
    });
  });
});

describe('checkSupplyPossible（CHECK，《玩法说明》7.8 / Q-044）', () => {
  it('排除 ♠3/♠A 后够张数 → true', () => {
    const state = makeState({
      hands: [[], cards('♠3 ♥3 ♠2 ♣8 ♣9'), [], []],
    });

    expect(
      checkSupplyPossible(state, makeDebt({ losers: [1], amountPerLoser: 2, total: 2 })),
    ).toBe(true);
  });

  it('双地明牌欠 12 张、下局又持 ♠3+♠A → 只有 11 张可交 → false', () => {
    const doubleHand = cards('♠3 ♠A ♠4 ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6');
    expect(doubleHand).toHaveLength(13);
    const state = makeState({
      landlordSeats: [1],
      doubleSeat: 1,
      revealedSeat: 1,
      hands: [[], doubleHand, [], []],
    });

    expect(
      checkSupplyPossible(
        state,
        makeDebt({ losers: [1], amountPerLoser: 12, total: 12, revealed: true, mode: 'DOUBLE' }),
      ),
    ).toBe(false);

    // 欠 6 张时同一手牌够交（Q-044：只有 12 张才会触发）
    expect(
      checkSupplyPossible(
        state,
        makeDebt({ losers: [1], amountPerLoser: 6, total: 6, mode: 'DOUBLE' }),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// 首发解析（《玩法说明》5.2 / Q-011 / Q-015）
// ===========================================================================

describe('resolveFirstSeat（首发优先级 + Q-015 顺延）', () => {
  it('优先级：明牌者 > 供牌上交最大牌者 > ♦4 持有者', () => {
    const revealedWins = makeState({
      revealedSeat: 2,
      firstSeatBySupply: 1,
      hands: [cards('♦4 ♣4'), [], [], []],
    });
    const supplyWins = makeState({
      firstSeatBySupply: 1,
      hands: [cards('♦4 ♣4'), [], [], []],
    });
    const diamond4 = makeState({ hands: [cards('♦4 ♣4'), [], [], []] });

    expect(resolveFirstSeat(revealedWins)).toBe(2);
    expect(resolveFirstSeat(supplyWins)).toBe(1);
    expect(resolveFirstSeat(diamond4)).toBe(0);
  });

  it('Q-015：首发者本局锁定成功（out）→ 从他下家起找第一个仍在场的人', () => {
    // 座位 2 锁定（rank 3）→ 下家座位 3 在场
    const nextActive = makeState({
      firstSeatBySupply: 2,
      ranks: [null, null, 3, null],
      lockedSeats: [2],
    });
    expect(resolveFirstSeat(nextActive)).toBe(3);

    // 越过座位 3 回到座位 0（座位 3 也 out）
    const wrapped = makeState({
      firstSeatBySupply: 3,
      ranks: [null, null, null, 3],
      lockedSeats: [3],
    });
    expect(resolveFirstSeat(wrapped)).toBe(0);

    // 下家也 out 时继续往下找
    const skip = makeState({
      firstSeatBySupply: 1,
      ranks: [null, 3, 3, null],
      lockedSeats: [1, 2],
    });
    expect(resolveFirstSeat(skip)).toBe(3);

    // 明牌者已 out 的防御分支：同样顺延
    const revealedOut = makeState({
      revealedSeat: 0,
      ranks: [3, null, null, null],
      lockedSeats: [0],
    });
    expect(resolveFirstSeat(revealedOut)).toBe(1);
  });
});
