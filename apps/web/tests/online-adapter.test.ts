import { describe, expect, it } from 'vitest';

import { createGame, makeCard } from '@a3/core';
import type { GameState } from '@a3/core';
import type { PlayerView } from '@a3/protocol';

import { plannedSupplyFromSelf, viewToGameState } from '../src/game/online/adapter';

/**
 * 联机视图适配器测试。
 * 重点：客户端内存里**不能**出现别人的真实手牌；别人的牌只能用占位牌凑张数。
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

/** 造一个「我拿 13 张、别人各 13 张」的视图，别人手牌用假 id 表示（模拟服务端已过滤） */
function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  const game: GameState = createGame(mulberry32(7));
  const myCards = game.players[0]?.hand ?? [];
  const base: PlayerView = {
    room: 'ABC123',
    seat: 0,
    handNo: 1,
    phase: 'PLAYING',
    players: [
      { seat: 0, name: '我', handCount: 13, out: false, locked: false, rank: null, connected: true },
      { seat: 1, name: '下家', handCount: 7, out: false, locked: false, rank: null, connected: true },
      { seat: 2, name: '对家', handCount: 0, out: true, locked: false, rank: 2, connected: false },
      { seat: 3, name: '上家', handCount: 13, out: false, locked: false, rank: null, connected: true },
    ],
    hand: myCards,
    doubleSeat: null,
    revealedSeat: null,
    landlordSeats: [0, 1],
    currentSeat: 0,
    firstSeat: 0,
    trickNo: 2,
    topPattern: { type: 'SINGLE', cards: [makeCard(9, 4)], seat: 1 },
    threePhase: false,
    isFirstPlay: false,
    supplyPaused: false,
    supplyStep: null,
    supplyPool: [],
    supplyFromMe: [],
    supplyGainedIds: [],
    returnPool: [],
    debt: null,
    firstSeatBySupply: null,
    supplyDeadlocked: false,
    myLockEligible: false,
    myLockIntent: false,
    publicCards: [],
    revealedCards: [],
    pickSeat: null,
    returnRequired: null,
    pickAutoMode: false,
    result: null,
    deadline: Date.now() + 30_000,
    log: [{ t: 'PLAY', seat: 1, cards: [makeCard(9, 4)], type: 'SINGLE', trick: 2 }],
  };
  return { ...base, ...overrides };
}

describe('viewToGameState：联机视图 → 界面状态', () => {
  it('自己的手牌是真实的，别人只有张数（占位牌 id 为负数）', () => {
    const view = makeView();
    const game = viewToGameState(view);

    expect(game.players[0]?.hand.map((card) => card.id)).toEqual(view.hand.map((card) => card.id));
    expect(game.players[1]?.hand).toHaveLength(7);
    expect(game.players[2]?.hand).toHaveLength(0);
    expect(game.players[3]?.hand).toHaveLength(13);

    // 占位牌绝不能和服务端真实手牌撞 id
    for (const seat of [1, 3]) {
      for (const card of game.players[seat]?.hand ?? []) {
        expect(card.id).toBeLessThan(0);
      }
    }
    // 占位牌也不会出现在「我」的手牌里
    const realIds = new Set(view.hand.map((card) => card.id));
    for (const seat of [1, 3]) {
      for (const card of game.players[seat]?.hand ?? []) {
        expect(realIds.has(card.id)).toBe(false);
      }
    }
  });

  it('topPattern 会用牌面重新识别出正确的比较键（联机跟牌校验才对）', () => {
    const view = makeView();
    const game = viewToGameState(view);
    expect(game.topPattern?.type).toBe('SINGLE');
    expect(game.topPattern?.key[0]).toBe(9); // 单张 ♠9 的主键是点数 9
    expect(game.topPattern?.key[1]).toBe(0); // 4~10 不分花色，次键为 0
    expect(game.topPattern?.equalAllowed).toBe(true); // 9 是 4~10，等值可压
    expect(game.topSeat).toBe(1);
  });

  it('supplyContext / debt / 锁定意向等字段按视图还原', () => {
    const view = makeView({
      phase: 'SUPPLY',
      supplyStep: 'RETURN_SELECT',
      supplyPaused: false,
      supplyPool: [makeCard(7, 1)],
      returnPool: [makeCard(5, 2)],
      supplyFromMe: [makeCard(12, 3)],
      debt: { winners: [1, 2], losers: [0, 3], amountPerLoser: 2, total: 4, revealed: false, mode: 'NORMAL' },
      returnRequired: 2,
      myLockEligible: true,
      myLockIntent: true,
    });
    const game = viewToGameState(view);

    expect(game.pendingDebt?.total).toBe(4);
    expect(game.pendingDebt?.losers).toEqual([0, 3]);
    expect(game.supplyContext?.step).toBe('RETURN_SELECT');
    expect(game.supplyContext?.pool).toHaveLength(1);
    expect(game.supplyContext?.returnPool).toHaveLength(1);
    expect(game.lockIntents.get(0)).toBe(true);
    expect(game.trickNo).toBe(view.trickNo);
  });

  it('相位非法时兜底成 PLAYING，不会崩', () => {
    const game = viewToGameState(makeView({ phase: 'SOMETHING_NEW' }));
    expect(game.phase).toBe('PLAYING');
  });
});

describe('plannedSupplyFromSelf：供牌倒计时期间我该交哪些牌', () => {
  it('按规则取「排除 ♠3/♠A 后最大的 N 张」', () => {
    const hand = [
      makeCard(16, 4), // ♠3 不能供
      makeCard(14, 4), // ♠A 不能供
      makeCard(16, 3), // ♥3
      makeCard(15, 4), // ♠2
      makeCard(9, 2),
    ];
    const view = makeView({
      phase: 'SUPPLY',
      supplyPaused: true,
      supplyFromMe: [],
      hand,
      debt: { winners: [1], losers: [0], amountPerLoser: 2, total: 2, revealed: false, mode: 'NORMAL' },
    });
    expect(plannedSupplyFromSelf(view).map((card) => card.id)).toEqual([
      makeCard(16, 3).id,
      makeCard(15, 4).id,
    ]);
  });

  it('不是输家 / 没有债务时返回空数组', () => {
    expect(plannedSupplyFromSelf(makeView())).toEqual([]);
  });
});
