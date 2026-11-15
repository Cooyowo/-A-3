import { describe, expect, it } from 'vitest';

import { identifyPattern } from '../src/patterns';
import { TIER, type Pattern } from '../src/types';
import { cards } from './helpers';

/**
 * 牌型识别测试。
 * 黄金用例编号照抄《开发文档》13.1（T-01 ~ T-13）；每条用例都补了非法反例。
 */

function pattern(text: string): Pattern {
  const result = identifyPattern(cards(text));
  if (result === null) throw new Error(`期望识别出牌型，但返回 null：${text}`);
  return result;
}

function expectNull(text: string): void {
  expect(identifyPattern(cards(text))).toBeNull();
}

describe('identifyPattern：13.1 黄金用例（T-01 ~ T-13）', () => {
  it('T-01 ♣7 → SINGLE', () => {
    const p = pattern('♣7');
    expect(p.type).toBe('SINGLE');
    expect(p.category).toBe('SINGLE');
    expect(p.tier).toBe(TIER.SINGLE); // 0
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(true);
    // 反例：两张不同点数不是单张
    expectNull('♠7 ♥8');
  });

  it('T-02 ♠7 ♥7 → PAIR', () => {
    const p = pattern('♠7 ♥7');
    expect(p.type).toBe('PAIR');
    expect(p.category).toBe('PAIR');
    expect(p.tier).toBe(TIER.PAIR); // 0
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(true);
    // 反例：三张不同点数
    expectNull('♠7 ♥8 ♣9');
  });

  it('T-03 ♠7 ♥7 ♣7 → TRIPLE', () => {
    const p = pattern('♠7 ♥7 ♣7');
    expect(p.type).toBe('TRIPLE');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.TRIPLE); // 1
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(false);
    // 反例：2+1
    expectNull('♠7 ♥7 ♣8');
  });

  it('T-04 ♠7 ♥7 ♣7 ♦9 → TRIPLE_ONE', () => {
    const p = pattern('♠7 ♥7 ♣7 ♦9');
    expect(p.type).toBe('TRIPLE_ONE');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.TRIPLE_ONE); // 2
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(false);
    // 反向：4 张同点是炸弹，不是三条夹一（「夹」的牌不能与三张同点数）
    expect(pattern('♠7 ♥7 ♣7 ♦7').type).toBe('BOMB');
    // 反例：2+1+1
    expectNull('♠7 ♥7 ♣8 ♦9');
  });

  it('T-05 ♠7 ♥7 ♣7 ♦9 ♦9 → TRIPLE_PAIR', () => {
    const p = pattern('♠7 ♥7 ♣7 ♦9 ♦9');
    expect(p.type).toBe('TRIPLE_PAIR');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.TRIPLE_PAIR); // 5
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(false);
    // 反例：3+1+1
    expectNull('♠7 ♥7 ♣7 ♦9 ♣10');
  });

  it('T-06 ♠7 ♥7 ♣7 ♦7 → BOMB', () => {
    const p = pattern('♠7 ♥7 ♣7 ♦7');
    expect(p.type).toBe('BOMB');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.BOMB); // 8
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(false);
    // 反例：5 张 3+1+1
    expectNull('♠7 ♥7 ♣7 ♦8 ♦9');
  });

  it('T-07 ♠7 ♥7 ♣7 ♦7 ♦9 → FOUR_ONE', () => {
    const p = pattern('♠7 ♥7 ♣7 ♦7 ♦9');
    expect(p.type).toBe('FOUR_ONE');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.FOUR_ONE); // 7
    expect(p.key).toEqual([7, 0]);
    expect(p.equalAllowed).toBe(false);
    // 反向：3+2 是三条夹双，不是四夹一
    expect(pattern('♠7 ♥7 ♣7 ♦8 ♦8').type).toBe('TRIPLE_PAIR');
    // 反例：5 张 2+2+1
    expectNull('♠7 ♥7 ♣8 ♦8 ♣9');
  });

  it('T-08 ♠4 ♠5 ♠6 ♠7 ♠8 → STRAIGHT_FLUSH', () => {
    const p = pattern('♠4 ♠5 ♠6 ♠7 ♠8');
    expect(p.type).toBe('STRAIGHT_FLUSH');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.STRAIGHT_FLUSH); // 6
    // 同花/同花顺：先花色、后最大牌点数
    expect(p.key).toEqual([4, 8]);
    expect(p.equalAllowed).toBe(false);
    // 反例：5 张既不连续也不同花
    expectNull('♠4 ♠5 ♠6 ♠7 ♥9');
  });

  it('T-09 ♠4 ♥5 ♠6 ♦7 ♠8 → STRAIGHT', () => {
    const p = pattern('♠4 ♥5 ♠6 ♦7 ♠8');
    expect(p.type).toBe('STRAIGHT');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.STRAIGHT); // 3
    // 顺子：key = [最大牌点数, 最大牌 >= J ? 花色 : 0]
    expect(p.key).toEqual([8, 0]);
    expect(p.equalAllowed).toBe(true); // 最大牌是 8 → 等值可压
    // 反例：断档
    expectNull('♠4 ♥5 ♠6 ♦7 ♠9');
  });

  it('T-10 ♠4 ♠6 ♠7 ♠9 ♠J → FLUSH', () => {
    const p = pattern('♠4 ♠6 ♠7 ♠9 ♠J');
    expect(p.type).toBe('FLUSH');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.FLUSH); // 4
    // 同花：key = [花色, 最大牌点数]
    expect(p.key).toEqual([4, 11]);
    expect(p.equalAllowed).toBe(false);
    // 反例：混入一张其他花色，且不连续
    expectNull('♠4 ♠6 ♠7 ♠9 ♥J');
  });

  it('T-11 ♠2 ♥3 ♠4 ♦5 ♠6 → null（2/3 不能进顺子）', () => {
    expectNull('♠2 ♥3 ♠4 ♦5 ♠6');
    // 对照：A 可以作为顺子的最大牌
    const p = pattern('♠10 ♥J ♦Q ♣K ♠A');
    expect(p.type).toBe('STRAIGHT');
    expect(p.key).toEqual([14, 4]); // 最大牌 A 是 ♠，J 以上比花色
    expect(p.equalAllowed).toBe(false);
  });

  it('T-12 ♠4 ♥5 ♠6 ♦7 → null（只有 4 张，不成顺子）', () => {
    expectNull('♠4 ♥5 ♠6 ♦7');
    // 反例补充：4 张 2+1+1 也不是任何牌型
    expectNull('♠7 ♥8 ♣9 ♦J');
  });

  it('T-13 ♠3 ♠2 ♠A ♠K ♠Q → 应按规则识别为 FLUSH', () => {
    // 注意：《开发文档》13.1 的 T-13 期望写 null，但它给的输入恰好是同花色 5 张。
    // 按《玩法说明》§3.3「同花 = 5 张同花色，不要求连续」与《开发文档》§4.2 算法，
    // 5 张同花色就应识别为 FLUSH（顺子范围 4~A 只约束顺子，不约束同花）。
    // 这里按规则实现为 FLUSH，并另补一个真正非法（不同花色且不连续）的反例。
    const p = pattern('♠3 ♠2 ♠A ♠K ♠Q');
    expect(p.type).toBe('FLUSH');
    expect(p.category).toBe('GROUP');
    expect(p.tier).toBe(TIER.FLUSH); // 4
    expect(p.key).toEqual([4, 16]); // [花色♠, 最大牌点数]：3 是最大点数（16）
    expect(p.equalAllowed).toBe(false);
    // 反例：同样的点数，花色不同 → 既不同花也不连续 → null
    expectNull('♠3 ♥2 ♦A ♣K ♠Q');
  });
});

describe('identifyPattern：优先级与 key/equalAllowed 边界', () => {
  it('5 张同花且连续只能算同花顺，不能拆成顺子或同花', () => {
    expect(pattern('♥4 ♥5 ♥6 ♥7 ♥8').type).toBe('STRAIGHT_FLUSH');
    // 同花顺 key 与同花同方向：[花色, 最大牌点数]
    expect(pattern('♥4 ♥5 ♥6 ♥7 ♥8').key).toEqual([3, 8]);
  });

  it('同花不要求连续，也不受顺子 4~A 范围限制', () => {
    const p = pattern('♠2 ♠3 ♠4 ♠5 ♠6');
    expect(p.type).toBe('FLUSH'); // 2/3 不能进顺子，但可以是同花
    expect(p.key).toEqual([4, 16]); // 最大牌点数：3（16），不是 6
  });

  it('顺子最大牌是 J/Q/K/A 时 key[1] 取最大牌花色', () => {
    const jSpade = pattern('♠7 ♥8 ♦9 ♣10 ♠J');
    expect(jSpade.key).toEqual([11, 4]);
    expect(jSpade.equalAllowed).toBe(false);

    const jHeart = pattern('♥7 ♦8 ♠9 ♣10 ♥J');
    expect(jHeart.key).toEqual([11, 3]);

    const qSpade = pattern('♦8 ♠9 ♣10 ♦J ♠Q');
    expect(qSpade.key).toEqual([12, 4]);

    const kHeart = pattern('♥9 ♦10 ♠J ♣Q ♥K');
    expect(kHeart.key).toEqual([13, 3]);

    const aClub = pattern('♦10 ♠J ♥Q ♦K ♣A');
    expect(aClub.key).toEqual([14, 2]);
  });

  it('顺子最大牌是 8/9/10 时 key[1]=0 且 equalAllowed=true', () => {
    const straight8 = pattern('♥4 ♦5 ♠6 ♥7 ♠8');
    expect(straight8.key).toEqual([8, 0]);
    expect(straight8.equalAllowed).toBe(true);

    const straight9 = pattern('♥5 ♦6 ♠7 ♣8 ♠9');
    expect(straight9.key).toEqual([9, 0]);
    expect(straight9.equalAllowed).toBe(true);

    const straight10 = pattern('♥6 ♦7 ♠8 ♣9 ♠10');
    expect(straight10.key).toEqual([10, 0]);
    expect(straight10.equalAllowed).toBe(true);
  });

  it('顺子不能包含 2 或 3', () => {
    expectNull('♠J ♥Q ♦K ♣A ♠2');
    expectNull('♠A ♥2 ♦3 ♣4 ♠5');
    expectNull('♦3 ♠4 ♥5 ♣6 ♦7');
    expectNull('♦2 ♠3 ♥4 ♣5 ♦6');
  });

  it('单张 J 以上 key 带花色且不可等值，4~10 不带花色且可等值', () => {
    expect(pattern('♥J').key).toEqual([11, 3]);
    expect(pattern('♥J').equalAllowed).toBe(false);
    expect(pattern('♠A').key).toEqual([14, 4]);
    expect(pattern('♠3').key).toEqual([16, 4]);
    expect(pattern('♦10').key).toEqual([10, 0]);
    expect(pattern('♦10').equalAllowed).toBe(true);
  });

  it('对子 J 以上 key[1] 取这对牌的最大花色，4~10 取 0', () => {
    expect(pattern('♥J ♦J').key).toEqual([11, 3]);
    expect(pattern('♥J ♦J').equalAllowed).toBe(false);
    expect(pattern('♠J ♣J').key).toEqual([11, 4]);
    expect(pattern('♦K ♣K').key).toEqual([13, 2]);
    const lowPair = pattern('♦7 ♣7');
    expect(lowPair.key).toEqual([7, 0]);
    expect(lowPair.equalAllowed).toBe(true);
  });

  it('三条 / 三条夹一 / 三条夹双 / 四夹一 / 炸弹的 key 只看主点数', () => {
    expect(pattern('♠7 ♥7 ♣7').key).toEqual([7, 0]);
    expect(pattern('♠7 ♥7 ♣7 ♦A').key).toEqual([7, 0]);
    expect(pattern('♠7 ♥7 ♣7 ♦9 ♦9').key).toEqual([7, 0]);
    expect(pattern('♠7 ♥7 ♣7 ♦7 ♦A').key).toEqual([7, 0]);
    expect(pattern('♠7 ♥7 ♣7 ♦7').key).toEqual([7, 0]);
    // 「夹」的牌不参与 key
    expect(pattern('♠7 ♥7 ♣7 ♦A').key).toEqual(pattern('♠7 ♥7 ♣7 ♦9').key);
  });

  it('tier 与 TIER 表一致', () => {
    const samples: readonly (readonly [string, Pattern['type']])[] = [
      ['♣7', 'SINGLE'],
      ['♠7 ♥7', 'PAIR'],
      ['♠7 ♥7 ♣7', 'TRIPLE'],
      ['♠7 ♥7 ♣7 ♦9', 'TRIPLE_ONE'],
      ['♠7 ♥7 ♣7 ♦9 ♦9', 'TRIPLE_PAIR'],
      ['♠7 ♥7 ♣7 ♦7', 'BOMB'],
      ['♠7 ♥7 ♣7 ♦7 ♦9', 'FOUR_ONE'],
      ['♠4 ♠5 ♠6 ♠7 ♠8', 'STRAIGHT_FLUSH'],
      ['♠4 ♥5 ♠6 ♦7 ♠8', 'STRAIGHT'],
      ['♠4 ♠6 ♠7 ♠9 ♠J', 'FLUSH'],
    ];
    for (const [text, type] of samples) {
      const p = pattern(text);
      expect(p.type).toBe(type);
      expect(p.tier).toBe(TIER[type]);
    }
  });

  it('张数或点数分布不支持时一律返回 null', () => {
    expect(identifyPattern([])).toBeNull();
    expectNull('♠7 ♥8'); // 2 张不同点数
    expectNull('♠7 ♥7 ♣8'); // 3 张 2+1
    expectNull('♠7 ♥8 ♣9 ♦10'); // 4 张 1+1+1+1
    expectNull('♠7 ♥7 ♣8 ♣9'); // 4 张 2+1+1
    expectNull('♠7 ♥7 ♣8 ♦9 ♠10'); // 5 张 2+1+1+1
    expectNull('♠7 ♥7 ♣7 ♦8 ♦9'); // 5 张 3+1+1
    expectNull('♠4 ♥5 ♠6 ♦7 ♠8 ♣9'); // 6 张超出牌型上限
  });

  it('识别结果保留原始牌，且 category 映射正确', () => {
    const input = cards('♠7 ♥7 ♣7');
    const p = identifyPattern(input);
    expect(p).not.toBeNull();
    expect(p?.cards.map((card) => card.id)).toEqual(input.map((card) => card.id));
    expect(p?.category).toBe('GROUP');
  });
});
