import { describe, expect, it } from 'vitest';

import { legalActions, lockEligible } from '@a3/core';

import { getActiveSeat } from '../src/game/selectors';
import { supplyDeadlocked, useHotseatStore } from '../src/game/store';

/**
 * 热座 store 的端到端测试（不依赖 DOM）：
 * 直接驱动 store 的动作，把整局打完，验证「页面点按钮」这一层接线是对的。
 * 引擎本身的规则由 @a3/core 的测试保证，这里只查 UI 层有没有接错。
 */

const MAX_STEPS = 20_000;

function snapshot() {
  return useHotseatStore.getState();
}

/** 打一局：随机做合法决策，直到 SETTLE */
function playOneHand(): number {
  let steps = 0;
  while (snapshot().game.phase !== 'SETTLE') {
    if (++steps > MAX_STEPS) {
      throw new Error(`疑似卡死，停在阶段 ${snapshot().game.phase}`);
    }
    const { game } = snapshot();

    switch (game.phase) {
      case 'REVEAL': {
        if (Math.random() < 0.5) snapshot().reveal();
        else snapshot().skipReveal();
        break;
      }
      case 'SUPPLY': {
        if (supplyDeadlocked(game)) {
          if (Math.random() < 0.5) snapshot().reveal();
          else snapshot().redeal();
          break;
        }
        const context = game.supplyContext;
        if (context === null) throw new Error('SUPPLY 阶段缺少上下文');
        if (context.step === 'RETURN_SELECT') {
          snapshot().autoReturn();
          break;
        }
        if (context.step === 'RETURN_PICK') {
          const card = context.returnPool[0];
          if (card === undefined) throw new Error('回牌池为空');
          snapshot().pickReturn(card.id);
          break;
        }
        throw new Error(`SUPPLY 卡在无法处理的步骤：${context.step}`);
      }
      case 'LOCK_WINDOW': {
        for (const player of game.players) {
          if (lockEligible(game, player.seat)) {
            snapshot().setLockIntent(player.seat, Math.random() < 0.3);
          }
        }
        snapshot().finishLockWindow();
        break;
      }
      case 'PLAYING': {
        const seat = getActiveSeat(game);
        if (seat === null) throw new Error('PLAYING 阶段却没有行动座位');
        const actions = legalActions(game, seat);
        if (actions.length === 0) throw new Error('没有任何合法动作');
        const action = actions[Math.floor(Math.random() * actions.length)];
        if (action === undefined) throw new Error('挑选动作失败');
        if (action.kind === 'PLAY') {
          for (const card of action.cards) snapshot().toggleCard(card.id);
          snapshot().playSelected();
        } else if (action.kind === 'PASS') {
          snapshot().pass();
        } else {
          throw new Error(`出牌阶段出现意外动作：${action.kind}`);
        }
        break;
      }
      default:
        throw new Error(`未知阶段：${game.phase}`);
    }

    if (snapshot().noticeTone === 'error') {
      throw new Error(`store 报错：${snapshot().notice ?? '(无提示)'}`);
    }
  }
  return steps;
}

describe('热座 store 端到端', () => {
  it('能从发牌一路点到结算（含明牌/供牌/锁定/出牌）', () => {
    snapshot().newGame(20261115);
    snapshot().dismissNotice();

    const steps = playOneHand();
    const { game } = snapshot();

    expect(steps).toBeGreaterThan(2);
    expect(game.phase).toBe('SETTLE');
    expect(game.result).not.toBeNull();

    const result = game.result;
    if (result === null) throw new Error('结算结果缺失');
    if (result.mode === 'NORMAL') {
      expect(result.lScore + result.fScore).toBe(6);
      expect([0, 2, 4]).toContain(result.scoreDiff);
    } else {
      expect(['2:0', '2:1', '0:2']).toContain(`${result.lScore}:${result.fScore}`);
    }
  });

  it('点「下一局」会重新发牌、局数 +1、手牌回到 13 张', () => {
    snapshot().newGame(777);
    snapshot().dismissNotice();
    playOneHand();

    const before = snapshot().game;
    expect(before.phase).toBe('SETTLE');

    snapshot().nextHand();
    expect(snapshot().noticeTone).not.toBe('error');

    const after = snapshot().game;
    expect(after.handNo).toBe(before.handNo + 1);
    expect(after.phase === 'REVEAL' || after.phase === 'LOCK_WINDOW' || after.phase === 'SUPPLY' || after.phase === 'PLAYING').toBe(true);
    const total = after.players.reduce((sum, player) => sum + player.hand.length, 0);
    expect(total).toBe(52);
  });

  it('连续打 10 局不报错（覆盖跨局供牌债务）', () => {
    snapshot().newGame(424242);
    snapshot().dismissNotice();

    for (let hand = 0; hand < 10; hand++) {
      playOneHand();
      if (hand < 9) {
        snapshot().nextHand();
        expect(snapshot().noticeTone).not.toBe('error');
      }
    }
    expect(snapshot().game.handNo).toBe(10);
    expect(snapshot().game.phase).toBe('SETTLE');
  });

  it('没选牌就点出牌：只给提示，状态不变', () => {
    snapshot().newGame(99);
    snapshot().dismissNotice();
    // 推进到出牌阶段
    let guard = 0;
    while (snapshot().game.phase !== 'PLAYING') {
      if (++guard > 500) throw new Error('推进不到出牌阶段');
      const { game } = snapshot();
      if (game.phase === 'REVEAL') snapshot().skipReveal();
      else if (game.phase === 'SUPPLY') {
        if (supplyDeadlocked(game)) snapshot().reveal();
        else if (game.supplyContext?.step === 'RETURN_SELECT') snapshot().autoReturn();
        else if (game.supplyContext?.step === 'RETURN_PICK') {
          const card = game.supplyContext.returnPool[0];
          if (card !== undefined) snapshot().pickReturn(card.id);
        } else throw new Error(`SUPPLY 意外步骤 ${game.supplyContext?.step}`);
      } else if (game.phase === 'LOCK_WINDOW') snapshot().finishLockWindow();
      else throw new Error(`意外阶段 ${game.phase}`);
    }

    const beforeGame = snapshot().game;
    snapshot().playSelected();
    expect(snapshot().noticeTone).toBe('error');
    expect(snapshot().game).toBe(beforeGame);
  });

  it('点选 / 取消点选是幂等的', () => {
    snapshot().newGame(5);
    const { game } = snapshot();
    const firstHand = game.players[0]?.hand[0];
    if (firstHand === undefined) throw new Error('手牌为空');

    snapshot().toggleCard(firstHand.id);
    expect(snapshot().selectedCardIds).toEqual([firstHand.id]);
    snapshot().toggleCard(firstHand.id);
    expect(snapshot().selectedCardIds).toEqual([]);
  });
});
