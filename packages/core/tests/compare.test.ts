import { describe, expect, it } from 'vitest';

import { RANK_LABEL, type Rank } from '../src/cards';
import { canFollow, compareKey } from '../src/compare';
import { identifyPattern } from '../src/patterns';
import type { Pattern } from '../src/types';
import { cards } from './helpers';

/**
 * 比较与压制测试。
 * 黄金用例编号照抄《开发文档》13.2（C-01 ~ C-13），并补齐 4~10 等值可压、
 * J 以上比花色、顺子/同花/同花顺、档位与炸弹的各种边界。
 */

function pattern(text: string): Pattern {
  const result = identifyPattern(cards(text));
  if (result === null) throw new Error(`期望识别出牌型，但返回 null：${text}`);
  return result;
}

/** candidate 能否压过 current */
function canBeat(candidate: string, current: string): boolean {
  return canFollow(pattern(candidate), pattern(current));
}

describe('compareKey（《开发文档》5.1）', () => {
  it('key 完全相等返回 0', () => {
    expect(compareKey(pattern('♣5'), pattern('♦5'))).toBe(0);
    expect(compareKey(pattern('♥4 ♦5 ♠6 ♥7 ♠8'), pattern('♦4 ♠5 ♣6 ♦7 ♥8'))).toBe(0);
  });

  it('主键不同时返回主键之差，与次键无关', () => {
    expect(compareKey(pattern('♣6'), pattern('♣5'))).toBeGreaterThan(0);
    expect(compareKey(pattern('♣5'), pattern('♣6'))).toBeLessThan(0);
    // 单张 3 最大
    expect(compareKey(pattern('♠3'), pattern('♠2'))).toBeGreaterThan(0);
    expect(compareKey(pattern('♠2'), pattern('♠A'))).toBeGreaterThan(0);
  });

  it('主键相同比次键：J 以上比花色', () => {
    expect(compareKey(pattern('♠J'), pattern('♥J'))).toBeGreaterThan(0);
    expect(compareKey(pattern('♥J'), pattern('♠J'))).toBeLessThan(0);
  });

  it('同花 / 同花顺先比花色，再比最大牌点数', () => {
    // 次键是「最大牌点数」，因此花色更大者即使点数更小也更大
    const weakHigh = pattern('♦4 ♦6 ♦7 ♦9 ♦A'); // key [1, 14]
    const strongLow = pattern('♠4 ♠5 ♠6 ♠7 ♠9'); // key [4, 9]
    expect(compareKey(strongLow, weakHigh)).toBeGreaterThan(0);
    expect(compareKey(weakHigh, strongLow)).toBeLessThan(0);

    // 同花色时比较最大牌点数
    expect(compareKey(pattern('♠9 ♠10 ♠J ♠Q ♠K'), pattern('♠4 ♠5 ♠6 ♠7 ♠8'))).toBeGreaterThan(0);
  });

  it('顺子先比最大牌点数，最大牌 J 以上再比花色', () => {
    expect(compareKey(pattern('♥5 ♦6 ♠7 ♣8 ♦9'), pattern('♥4 ♦5 ♠6 ♥7 ♠8'))).toBeGreaterThan(0);
    expect(compareKey(pattern('♠7 ♥8 ♦9 ♣10 ♠J'), pattern('♥7 ♦8 ♠9 ♣10 ♥J'))).toBeGreaterThan(0);
  });
});

describe('canFollow：13.2 黄金用例（C-01 ~ C-13）', () => {
  it('C-01 ♦5 跟 ♣5 → 可压（4~10 等值可压）', () => {
    expect(canBeat('♦5', '♣5')).toBe(true);
    expect(canBeat('♣5', '♦5')).toBe(true);
  });

  it('C-02 ♥J 跟 ♠J → 不可压（红桃 < 黑桃）', () => {
    expect(canBeat('♥J', '♠J')).toBe(false);
  });

  it('C-03 ♠J 跟 ♥J → 可压（黑桃 > 红桃）', () => {
    expect(canBeat('♠J', '♥J')).toBe(true);
  });

  it('C-04 45678 跟 45678（另一套花色）→ 可压（最大牌 8，等值可压）', () => {
    expect(canBeat('♦4 ♠5 ♣6 ♦7 ♥8', '♥4 ♦5 ♠6 ♥7 ♠8')).toBe(true);
    expect(canBeat('♥4 ♦5 ♠6 ♥7 ♠8', '♦4 ♠5 ♣6 ♦7 ♥8')).toBe(true);
  });

  it('C-05 ♥78910J 跟 ♠78910J → 不可压（最大牌 J，比花色）', () => {
    const current = '♠7 ♥8 ♣9 ♦10 ♠J';
    const candidate = '♥7 ♣8 ♦9 ♠10 ♥J';
    expect(canBeat(candidate, current)).toBe(false);
    expect(canBeat(current, candidate)).toBe(true);
  });

  it('C-06 ♠同花 跟 ♦同花 → ♠ 可压（同花先比花色）', () => {
    const diamondFlush = '♦4 ♦6 ♦7 ♦9 ♦J';
    const spadeFlush = '♠4 ♠6 ♠7 ♠9 ♠J';
    expect(canBeat(spadeFlush, diamondFlush)).toBe(true);
    expect(canBeat(diamondFlush, spadeFlush)).toBe(false);
  });

  it('C-07 ♠45678 同花顺 压过 ♥10JQKA 同花顺（花色优先）', () => {
    const spadeSf = '♠4 ♠5 ♠6 ♠7 ♠8';
    const heartRoyal = '♥10 ♥J ♥Q ♥K ♥A';
    expect(canBeat(heartRoyal, spadeSf)).toBe(false);
    expect(canBeat(spadeSf, heartRoyal)).toBe(true);
  });

  it('C-08 ♣同花 跟 顺子 10JQKA → 可压（档位 4 > 3）', () => {
    const royalStraight = '♥10 ♦J ♠Q ♣K ♥A';
    const clubFlush = '♣4 ♣5 ♣6 ♣7 ♣9';
    expect(canBeat(clubFlush, royalStraight)).toBe(true);
    expect(canBeat(royalStraight, clubFlush)).toBe(false);
  });

  it('C-09 顺子 45678 跟 三条夹一 333+4 → 可压（档位 3 > 2）', () => {
    const tripleOne = '♠3 ♥3 ♣3 ♦4';
    const straight = '♥4 ♦5 ♠6 ♥7 ♠8';
    expect(canBeat(straight, tripleOne)).toBe(true);
    expect(canBeat(tripleOne, straight)).toBe(false);
  });

  it('C-10 炸弹 4444 不能压单张 ♠3（大类不同，炸弹不能压单张/对子）', () => {
    expect(canBeat('♠4 ♥4 ♣4 ♦4', '♠3')).toBe(false);
    expect(canBeat('♠3', '♠4 ♥4 ♣4 ♦4')).toBe(false);
    // 对子同理
    expect(canBeat('♠4 ♥4 ♣4 ♦4', '♠7 ♥7')).toBe(false);
    expect(canBeat('♠7 ♥7', '♠4 ♥4 ♣4 ♦4')).toBe(false);
  });

  it('C-11 炸弹 4444 跟 顺子 45678 → 炸弹可压（档位 8 > 3）', () => {
    expect(canBeat('♠4 ♥4 ♣4 ♦4', '♥4 ♦5 ♠6 ♥7 ♠8')).toBe(true);
    expect(canBeat('♥4 ♦5 ♠6 ♥7 ♠8', '♠4 ♥4 ♣4 ♦4')).toBe(false);
  });

  it('C-12 三条夹一不可被三条压（降维非法；档位 1 < 2）', () => {
    // 文档 13.2 的 C-12 列顺序与 C-01/C-05 等相反，这里按规则双向断言：
    const triple = '♠5 ♥5 ♣5';
    const tripleOne = '♠4 ♥4 ♣4 ♦3';
    expect(canBeat(triple, tripleOne)).toBe(false); // 三条 vs 三条夹一：降维，不可压
    expect(canBeat(tripleOne, triple)).toBe(true); // 升维，可压（边界要求）
  });

  it('C-13 三条夹双 444+33 跟 三条夹一 555+3 → 可压（档位 5 > 2）', () => {
    const tripleOne = '♠5 ♥5 ♣5 ♦3';
    const triplePair = '♠4 ♥4 ♣4 ♦3 ♣3';
    expect(canBeat(triplePair, tripleOne)).toBe(true);
    expect(canBeat(tripleOne, triplePair)).toBe(false);
  });
});

describe('canFollow：单张 / 对子的等值可压边界', () => {
  it('4~10 单张同点数互相可压（不分花色）', () => {
    const ranks: readonly Rank[] = [4, 5, 6, 7, 8, 9, 10];
    for (const rank of ranks) {
      const label = RANK_LABEL[rank];
      expect(canBeat(`♦${label}`, `♠${label}`)).toBe(true);
      expect(canBeat(`♠${label}`, `♦${label}`)).toBe(true);
    }
  });

  it('J 以上单张严格比花色（同点数小花色压不过大花色）', () => {
    const ranks: readonly Rank[] = [11, 12, 13, 14, 15, 16];
    for (const rank of ranks) {
      const label = RANK_LABEL[rank];
      expect(canBeat(`♥${label}`, `♠${label}`)).toBe(false);
      expect(canBeat(`♠${label}`, `♥${label}`)).toBe(true);
    }
  });

  it('4~10 对子同点数互相可压', () => {
    expect(canBeat('♦7 ♣7', '♠7 ♥7')).toBe(true);
    expect(canBeat('♠7 ♥7', '♦7 ♣7')).toBe(true);
  });

  it('J 以上对子比「这对牌的最大花色」，严格大于才能压', () => {
    expect(canBeat('♠J ♣J', '♥J ♦J')).toBe(true); // 最大花色 ♠ > ♥
    expect(canBeat('♥J ♦J', '♠J ♣J')).toBe(false);
    expect(canBeat('♥K ♠K', '♣K ♦K')).toBe(true); // 最大花色 ♠ > ♣
  });

  it('单张与对子属于不同大类，不能互压', () => {
    expect(canBeat('♠7 ♥7', '♠7')).toBe(false);
    expect(canBeat('♠7', '♠7 ♥7')).toBe(false);
  });
});

describe('canFollow：顺子边界', () => {
  it('最大牌是 8/9/10 时同点数可以互相压（不看花色）', () => {
    const equalPairs: readonly (readonly [string, string])[] = [
      ['♥4 ♦5 ♠6 ♥7 ♠8', '♦4 ♠5 ♣6 ♦7 ♥8'],
      ['♥5 ♦6 ♠7 ♣8 ♠9', '♦5 ♠6 ♣7 ♥8 ♦9'],
      ['♥6 ♦7 ♠8 ♣9 ♠10', '♦6 ♠7 ♣8 ♥9 ♦10'],
    ];
    for (const [a, b] of equalPairs) {
      expect(canBeat(a, b)).toBe(true);
      expect(canBeat(b, a)).toBe(true);
    }
  });

  it('最大牌是 J/Q/K/A 时同点数必须比最大牌花色', () => {
    const suitPairs: readonly (readonly [string, string])[] = [
      ['♥7 ♦8 ♠9 ♣10 ♥J', '♦7 ♠8 ♣9 ♦10 ♠J'], // 最大 J
      ['♥8 ♦9 ♠10 ♣J ♥Q', '♦8 ♠9 ♣10 ♦J ♠Q'], // 最大 Q
      ['♥9 ♦10 ♠J ♣Q ♥K', '♦9 ♠10 ♣J ♦Q ♠K'], // 最大 K
      ['♥10 ♦J ♠Q ♣K ♥A', '♦10 ♠J ♣Q ♦K ♠A'], // 最大 A
    ];
    for (const [heartTop, spadeTop] of suitPairs) {
      expect(canBeat(spadeTop, heartTop)).toBe(true); // ♠ 花色大
      expect(canBeat(heartTop, spadeTop)).toBe(false);
    }
  });

  it('最大牌点数不同时比点数', () => {
    expect(canBeat('♥5 ♦6 ♠7 ♣8 ♦9', '♥4 ♦5 ♠6 ♥7 ♠8')).toBe(true);
    expect(canBeat('♥4 ♦5 ♠6 ♥7 ♠8', '♥5 ♦6 ♠7 ♣8 ♦9')).toBe(false);
  });
});

describe('canFollow：同花 / 同花顺边界', () => {
  it('同花先比花色：花色更大者即使最大牌更小也能压', () => {
    expect(canBeat('♠4 ♠5 ♠6 ♠7 ♠9', '♦4 ♦6 ♦7 ♦9 ♦A')).toBe(true);
    expect(canBeat('♦4 ♦6 ♦7 ♦9 ♦A', '♠4 ♠5 ♠6 ♠7 ♠9')).toBe(false);
  });

  it('同花同花色时比最大牌', () => {
    expect(canBeat('♠8 ♠10 ♠J ♠Q ♠K', '♠4 ♠5 ♠6 ♠7 ♠9')).toBe(true);
    expect(canBeat('♠4 ♠5 ♠6 ♠7 ♠9', '♠8 ♠10 ♠J ♠Q ♠K')).toBe(false);
  });

  it('同花顺先比花色：♥皇家同花顺小于 ♠45678', () => {
    expect(canBeat('♠4 ♠5 ♠6 ♠7 ♠8', '♥10 ♥J ♥Q ♥K ♥A')).toBe(true);
    expect(canBeat('♥10 ♥J ♥Q ♥K ♥A', '♠4 ♠5 ♠6 ♠7 ♠8')).toBe(false);
  });

  it('同花顺同花色时比最大牌', () => {
    expect(canBeat('♠9 ♠10 ♠J ♠Q ♠K', '♠4 ♠5 ♠6 ♠7 ♠8')).toBe(true);
    expect(canBeat('♠4 ♠5 ♠6 ♠7 ♠8', '♠9 ♠10 ♠J ♠Q ♠K')).toBe(false);
  });

  it('顺子压不过同花（档位 3 < 4）', () => {
    expect(canBeat('♥4 ♦5 ♠6 ♥7 ♠8', '♠4 ♠6 ♠7 ♠9 ♠J')).toBe(false);
  });
});

describe('canFollow：牌组档位与炸弹边界', () => {
  it('档位高的一律能压档位低的，与点数无关（完整档位阶梯 1→8）', () => {
    // 下标即档位减 1：TRIPLE(1) → BOMB(8)
    const ladder: readonly string[] = [
      '♠5 ♥5 ♣5', // 1 三条
      '♠4 ♥4 ♣4 ♦3', // 2 三条夹一
      '♥4 ♦5 ♠6 ♥7 ♠8', // 3 顺子
      '♠4 ♠6 ♠7 ♠9 ♠J', // 4 同花
      '♠6 ♥6 ♣6 ♦4 ♣4', // 5 三条夹双
      '♠4 ♠5 ♠6 ♠7 ♠8', // 6 同花顺
      '♠7 ♥7 ♣7 ♦7 ♦9', // 7 四夹一
      '♠3 ♥3 ♣3 ♦3', // 8 炸弹
    ];
    for (let low = 0; low < ladder.length; low++) {
      for (let high = low + 1; high < ladder.length; high++) {
        expect(canBeat(ladder[high] as string, ladder[low] as string)).toBe(true);
        expect(canBeat(ladder[low] as string, ladder[high] as string)).toBe(false);
      }
    }
  });

  it('炸弹能压同花顺（档位 8 > 6），同花顺压不过炸弹', () => {
    const bomb = '♠4 ♥4 ♣4 ♦4';
    const sf = '♠4 ♠5 ♠6 ♠7 ♠8';
    expect(canBeat(bomb, sf)).toBe(true);
    expect(canBeat(sf, bomb)).toBe(false);
  });

  it('四条夹一 与 炸弹：炸弹更大（档位 7 < 8）', () => {
    const fourOne = '♠7 ♥7 ♣7 ♦7 ♦9';
    const bomb = '♠4 ♥4 ♣4 ♦4';
    expect(canBeat(bomb, fourOne)).toBe(true);
    expect(canBeat(fourOne, bomb)).toBe(false);
  });

  it('四条夹一 能压同花顺（档位 7 > 6）', () => {
    const fourOne = '♠7 ♥7 ♣7 ♦7 ♦9';
    const sf = '♠4 ♠5 ♠6 ♠7 ♠8';
    expect(canBeat(fourOne, sf)).toBe(true);
    expect(canBeat(sf, fourOne)).toBe(false);
  });

  it('三条夹一能压三条（升维），三条不能压三条夹一（降维）', () => {
    expect(canBeat('♠4 ♥4 ♣4 ♦3', '♠5 ♥5 ♣5')).toBe(true);
    expect(canBeat('♠5 ♥5 ♣5', '♠4 ♥4 ♣4 ♦3')).toBe(false);
  });

  it('同档位比 key：三条 666 压 555、三条夹双 666+44 压 555+33', () => {
    expect(canBeat('♠6 ♥6 ♣6', '♠5 ♥5 ♣5')).toBe(true);
    expect(canBeat('♠5 ♥5 ♣5', '♠6 ♥6 ♣6')).toBe(false);
    expect(canBeat('♠6 ♥6 ♣6 ♦4 ♣4', '♠5 ♥5 ♣5 ♦3 ♣3')).toBe(true);
  });

  it('炸弹之间比四张点数：3333 最大', () => {
    expect(canBeat('♠3 ♥3 ♣3 ♦3', '♠4 ♥4 ♣4 ♦4')).toBe(true);
    expect(canBeat('♠4 ♥4 ♣4 ♦4', '♠3 ♥3 ♣3 ♦3')).toBe(false);
  });

  it('同档位且 key 完全相等时：equalAllowed=false 不能等值压', () => {
    // 三条 / 炸弹 / 同花 / 三条夹双 / 最大牌 J+ 的顺子：equalAllowed=false
    const noEqual: readonly string[] = [
      '♠5 ♥5 ♣5',
      '♠7 ♥7 ♣7 ♦7',
      '♠4 ♠6 ♠7 ♠9 ♠J',
      '♠6 ♥6 ♣6 ♦4 ♣4',
      '♠7 ♥8 ♣9 ♦10 ♠J',
      '♠4 ♠5 ♠6 ♠7 ♠8',
    ];
    for (const text of noEqual) {
      const p = pattern(text);
      expect(canFollow(p, p)).toBe(false);
    }
  });

  it('同档位且 key 完全相等时：equalAllowed=true 可以等值压（4~10 的顺子）', () => {
    const straight = pattern('♥4 ♦5 ♠6 ♥7 ♠8');
    expect(straight.equalAllowed).toBe(true);
    expect(canFollow(straight, straight)).toBe(true);
  });

  it('三条夹一 / 四夹一 等值 key（equalAllowed=false）也不能互压', () => {
    const tripleOne = pattern('♠7 ♥7 ♣7 ♦9');
    expect(canFollow(tripleOne, tripleOne)).toBe(false);
    const fourOne = pattern('♠7 ♥7 ♣7 ♦7 ♦9');
    expect(canFollow(fourOne, fourOne)).toBe(false);
  });

  it('free lead：current 为 null 时任何牌型都能出', () => {
    for (const text of ['♠7', '♠7 ♥7', '♠5 ♥5 ♣5', '♠3 ♥3 ♣3 ♦3']) {
      expect(canFollow(pattern(text), null)).toBe(true);
    }
  });

  it('三个大类之间互不压制', () => {
    expect(canBeat('♠5 ♥5 ♣5', '♠7')).toBe(false); // 牌组 vs 单张
    expect(canBeat('♠7', '♠5 ♥5 ♣5')).toBe(false); // 单张 vs 牌组
    expect(canBeat('♠7 ♥7', '♠5 ♥5 ♣5')).toBe(false); // 对子 vs 牌组
    expect(canBeat('♠5 ♥5 ♣5', '♠7 ♥7')).toBe(false); // 牌组 vs 对子
  });
});
