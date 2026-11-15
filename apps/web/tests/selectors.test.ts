import { describe, expect, it } from 'vitest';

import { createGame, makeCard } from '@a3/core';
import type { GameState } from '@a3/core';

import {
  getMedal,
  getSeatTrickAction,
  getSelfSeat,
  isLandlordPublic,
} from '../src/game/selectors';

/**
 * 横屏界面相关派生函数的单元测试（不涉及 DOM）。
 * 这些函数决定「谁打到哪张牌 / 谁的地主已公开 / 谁有奖牌 / 谁是视角主角」，
 * 界面显示错了基本都出在这里。
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshGame(): GameState {
  return createGame(mulberry32(20261115));
}

describe('getSeatTrickAction：按「墩」显示每人最后动作', () => {
  it('同一墩里的出牌与不出都能取到；换墩后旧记录不再显示', () => {
    const game = freshGame();
    const seat = 1;
    const card = makeCard(7, 4);

    game.trickNo = 1;
    game.log.push({ t: 'PLAY', seat, cards: [card], type: 'SINGLE', trick: 1 });
    expect(getSeatTrickAction(game, seat)).toEqual({ kind: 'PLAY', cards: [card] });

    // 同一墩里又选择了不出 → 显示最新的「不出」
    game.log.push({ t: 'PASS', seat, trick: 1 });
    expect(getSeatTrickAction(game, seat)).toEqual({ kind: 'PASS' });

    // 进入下一墩：清空，不再显示上一墩的动作
    game.trickNo = 2;
    expect(getSeatTrickAction(game, seat)).toBeNull();

    // 其他座位没有动作
    expect(getSeatTrickAction(game, 2)).toBeNull();
  });
});

describe('isLandlordPublic：只有公开的地主才标记', () => {
  it('未公开时不标记，打出 ♠3/♠A 后标记', () => {
    const game = freshGame();
    const seat = 2;
    expect(isLandlordPublic(game, seat)).toBe(false);

    game.log.push({
      t: 'PLAY',
      seat,
      cards: [makeCard(16, 4)], // ♠3
      type: 'SINGLE',
      trick: 1,
    });
    expect(isLandlordPublic(game, seat)).toBe(true);
    expect(isLandlordPublic(game, 0)).toBe(false);
  });

  it('明牌者直接标记为公开地主', () => {
    const game = freshGame();
    game.revealedSeat = 3;
    expect(isLandlordPublic(game, 3)).toBe(true);
  });

  it('结算阶段按地主方座位标记', () => {
    const game = freshGame();
    game.phase = 'SETTLE';
    const landlordSeat = game.landlordSeats[0] as number;
    const farmerSeat = [0, 1, 2, 3].find((seat) => !game.landlordSeats.includes(seat)) as number;
    expect(isLandlordPublic(game, landlordSeat)).toBe(true);
    expect(isLandlordPublic(game, farmerSeat)).toBe(false);
  });
});

describe('getMedal：只给前三名发奖牌', () => {
  it('第 1/2/3 名返回奖牌，第 4 名返回 null', () => {
    const game = freshGame();
    game.players[0]!.rank = 1;
    game.players[1]!.rank = 2;
    game.players[2]!.rank = 3;
    game.players[3]!.rank = 4;

    expect(getMedal(game, 0)).toBe(1);
    expect(getMedal(game, 1)).toBe(2);
    expect(getMedal(game, 2)).toBe(3);
    expect(getMedal(game, 3)).toBeNull();
  });
});

describe('getSelfSeat：视角座位', () => {
  it('手动切视角时以指定座位为准，否则跟随当前行动者', () => {
    const game = freshGame();
    game.phase = 'PLAYING';
    game.currentSeat = 2;

    expect(getSelfSeat(game, null)).toBe(2);
    expect(getSelfSeat(game, 1)).toBe(1);
  });
});
