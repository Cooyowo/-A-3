import { describe, expect, it } from 'vitest';

import { activeSeats, computeIdentity, isLandlordSeat, lockEligible, rankScore } from '../src/teams';

import { cards, makeState } from './helpers';

// 13 张全部 <= 10 的合法手牌（可提前锁定）
const LOW_HAND = '♠4 ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6 ♦6 ♠7';

describe('computeIdentity（身份判定，《玩法说明》2.1~2.3）', () => {
  it('非双地：♠3 与 ♠A 分属两人 → 地主方两个座位（升序），doubleSeat = null', () => {
    const state = makeState({
      hands: [cards('♠3 ♠4'), cards('♣5'), cards('♠A ♥6'), cards('♦7')],
    });

    expect(computeIdentity(state.players)).toEqual({ landlordSeats: [0, 2], doubleSeat: null });
  });

  it('非双地：座位顺序颠倒时 landlordSeats 仍按座位号升序', () => {
    const state = makeState({
      hands: [[], cards('♠A'), [], cards('♠3')],
    });

    expect(computeIdentity(state.players)).toEqual({ landlordSeats: [1, 3], doubleSeat: null });
  });

  it('双地：♠3 与 ♠A 同桌 → landlordSeats 只有该座位，doubleSeat = 该座位', () => {
    const state = makeState({
      hands: [cards('♥5'), cards('♠3 ♠A ♣7'), cards('♦8'), cards('♥9')],
    });

    expect(computeIdentity(state.players)).toEqual({ landlordSeats: [1], doubleSeat: 1 });
  });

  it('双地：座位 0 同时持有两张地主牌 → landlordSeats = [0], doubleSeat = 0', () => {
    const state = makeState({
      hands: [cards('♠3 ♠A'), [], [], []],
    });

    expect(computeIdentity(state.players)).toEqual({ landlordSeats: [0], doubleSeat: 0 });
  });
});

describe('rankScore（名次分，《玩法说明》6.1）', () => {
  it('第 1/2/3/4 名依次 3/2/1/0 分', () => {
    expect(rankScore(1)).toBe(3);
    expect(rankScore(2)).toBe(2);
    expect(rankScore(3)).toBe(1);
    expect(rankScore(4)).toBe(0);
  });

  it('未定名次（null）记 0 分', () => {
    expect(rankScore(null)).toBe(0);
  });
});

describe('isLandlordSeat（座位是否属于地主方）', () => {
  it('在 landlordSeats 里为 true，否则 false', () => {
    expect(isLandlordSeat([0, 2], 0)).toBe(true);
    expect(isLandlordSeat([0, 2], 2)).toBe(true);
    expect(isLandlordSeat([0, 2], 1)).toBe(false);
    expect(isLandlordSeat([3], 0)).toBe(false);
  });
});

describe('activeSeats（仍在场座位，《玩法说明》5.6 / 8.4）', () => {
  it('排除已出完 / 提前锁定的座位，按座位号升序', () => {
    const state = makeState({ ranks: [null, 1, null, 2] });

    expect(activeSeats(state)).toEqual([0, 2]);
  });

  it('提前锁定者 out=true，同样被排除', () => {
    const state = makeState({ ranks: [null, null, 3, null], lockedSeats: [2] });

    expect(activeSeats(state)).toEqual([0, 1, 3]);
  });

  it('无人出完时返回全部 4 个座位', () => {
    expect(activeSeats(makeState())).toEqual([0, 1, 2, 3]);
  });
});

describe('lockEligible（提前锁定资格，《玩法说明》8.1 / Q-054）', () => {
  it('正例：未出完 + 正好 13 张 + 全部 <= 10 → 有资格', () => {
    const state = makeState({ hands: [cards(LOW_HAND), [], [], []] });

    expect(state.players[0]!.hand).toHaveLength(13);
    expect(lockEligible(state, 0)).toBe(true);
  });

  it('反例：13 张里有一张 J（rank 11 > 10）→ 无资格', () => {
    const state = makeState({
      hands: [cards('♠4 ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6 ♦6 ♠J'), [], [], []],
    });

    expect(state.players[0]!.hand).toHaveLength(13);
    expect(lockEligible(state, 0)).toBe(false);
  });

  it('反例：手牌只有 12 张（哪怕全是 4~10）→ 无资格', () => {
    const state = makeState({
      hands: [cards('♠4 ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6 ♦6'), [], [], []],
    });

    expect(state.players[0]!.hand).toHaveLength(12);
    expect(lockEligible(state, 0)).toBe(false);
  });

  it('反例：已经出完 / 提前锁定（out）→ 无资格', () => {
    const state = makeState({
      hands: [cards(LOW_HAND), [], [], []],
      ranks: [3, null, null, null],
      lockedSeats: [0],
    });

    expect(state.players[0]!.out).toBe(true);
    expect(lockEligible(state, 0)).toBe(false);
  });

  it('反例：地主牌 ♠3 / ♠A 都 >10 → 地主方永远不能锁定（Q-010）', () => {
    const withLandlord3 = makeState({
      hands: [cards('♠3 ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6 ♦6 ♠7'), [], [], []],
    });
    const withLandlordA = makeState({
      hands: [cards('♠A ♥4 ♣4 ♦4 ♠5 ♥5 ♣5 ♦5 ♠6 ♥6 ♣6 ♦6 ♠7'), [], [], []],
    });

    expect(lockEligible(withLandlord3, 0)).toBe(false);
    expect(lockEligible(withLandlordA, 0)).toBe(false);
  });
});
