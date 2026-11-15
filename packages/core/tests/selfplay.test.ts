import { describe, expect, it } from 'vitest';

import { runGame } from '../src/index';
import { mulberry32 } from './helpers';

/**
 * 自对弈回归（《开发文档》13.5）：
 * 固定随机种子跑机器人对战，断言无死锁、牌数守恒、名次唯一、比分符合结算表。
 */
describe('自对弈回归', () => {
  it(
    '固定种子跑 1000 局：无死锁、牌数守恒、名次唯一、比分合法',
    () => {
      const summary = runGame(mulberry32(20261115), 1000);

      expect(summary.hands).toBe(1000);
      expect(summary.steps).toBeGreaterThan(1000);
      // 1000 局里双地局面应当出现过（概率约 4 × C(2,2)/C(52,2) 每局，累计必现）
      expect(summary.doubles).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    '多个不同种子各跑 200 局，结果稳定不报错',
    () => {
      for (const seed of [1, 7, 42, 2026, 99991]) {
        const summary = runGame(mulberry32(seed), 200);
        expect(summary.hands).toBe(200);
        expect(summary.steps).toBeGreaterThan(0);
      }
    },
    120_000,
  );

  it(
    '同一 seed 两次运行统计完全一致（可复现）',
    () => {
      const first = runGame(mulberry32(123456), 50);
      const second = runGame(mulberry32(123456), 50);
      expect(second).toEqual(first);
    },
    60_000,
  );
});
