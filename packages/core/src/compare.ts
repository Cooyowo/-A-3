import type { Pattern } from './types';

/**
 * 比较两个牌型的归一化比较键（《开发文档》5.1）。
 * 返回 >0 表示 a 大，=0 表示一样大，<0 表示 a 小。
 */
export function compareKey(a: Pattern, b: Pattern): number {
  if (a.key[0] !== b.key[0]) return a.key[0] - b.key[0];
  return a.key[1] - b.key[1];
}

/**
 * 能否用 candidate 跟 current（《开发文档》5.2，核心函数）。
 *
 * - current === null → 自由领出，返回 true。
 * - 大类必须相同（单张 / 对子 / 牌组），否则 false。
 * - 单张 / 对子：比 key；key 相等时只有 4~10（equalAllowed）才允许压。
 * - 牌组：先比档位（高的能压）；档位相同再比 key，key 相等时看 candidate.equalAllowed。
 *
 * 注意：炸弹不能压单张/对子（大类不同），但炸弹能压同花顺（档位 8 > 6）。
 */
export function canFollow(candidate: Pattern, current: Pattern | null): boolean {
  // 自由领出：不受任何限制
  if (current === null) return true;

  // 1) 大类必须一致（单张 / 对子 / 牌组）
  if (candidate.category !== current.category) return false;

  // 2) 单张 / 对子：直接比较 key
  if (candidate.category !== 'GROUP') {
    const compared = compareKey(candidate, current);
    if (compared > 0) return true;
    if (compared === 0) return candidate.equalAllowed; // 4~10 等值可压
    return false;
  }

  // 3) 牌组：先比档位，档位高的无条件能压
  if (candidate.tier !== current.tier) return candidate.tier > current.tier;

  // 4) 同档位：比 key，key 相等时看是否允许等值可压
  const compared = compareKey(candidate, current);
  if (compared > 0) return true;
  if (compared === 0) return candidate.equalAllowed;
  return false;
}
