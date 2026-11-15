// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { legalActions } from '@a3/core';

import App from '../src/App';
import { getActiveSeat } from '../src/game/selectors';
import { supplyDeadlocked, useHotseatStore } from '../src/game/store';

/**
 * M2 界面测试（jsdom + Testing Library）：
 * 真实挂载 <App />，验证各阶段界面能渲染、按钮能点、点击后状态正确推进。
 * 视觉与手感最终仍由人工在浏览器里验收，这里挡的是「接线错 / 按钮无响应 / 阶段没接上」。
 *
 * 注意：不能用 react-dom/server 做快照渲染——zustand v5 的 SSR 快照永远取初始 state。
 */

function store() {
  return useHotseatStore.getState();
}

function boot(seed = 20261115): void {
  store().newGame(seed);
  store().dismissNotice();
}

function advanceToPlaying(): void {
  let guard = 0;
  while (store().game.phase !== 'PLAYING') {
    if (++guard > 5000) throw new Error(`推进失败，卡在 ${store().game.phase}`);
    const { game } = store();
    switch (game.phase) {
      case 'REVEAL':
        store().skipReveal();
        break;
      case 'SUPPLY': {
        if (supplyDeadlocked(game)) {
          store().reveal();
          break;
        }
        const context = game.supplyContext;
        if (context === null) throw new Error('SUPPLY 缺上下文');
        if (context.step === 'RETURN_SELECT') store().autoReturn();
        else if (context.step === 'RETURN_PICK') {
          const card = context.returnPool[0];
          if (card === undefined) throw new Error('回牌池为空');
          store().pickReturn(card.id);
        } else throw new Error(`SUPPLY 意外步骤 ${context.step}`);
        break;
      }
      case 'LOCK_WINDOW':
        store().finishLockWindow();
        break;
      default:
        throw new Error(`意外阶段 ${game.phase}`);
    }
    if (store().noticeTone === 'error') throw new Error(`store 报错：${store().notice ?? ''}`);
  }
}

function playToSettle(): void {
  let guard = 0;
  while (store().game.phase !== 'SETTLE') {
    if (++guard > 20_000) throw new Error('打不完，疑似卡死');
    const { game } = store();
    if (game.phase === 'PLAYING') {
      const seat = getActiveSeat(game);
      if (seat === null) throw new Error('出牌阶段没有行动座位');
      const action = legalActions(game, seat)[0];
      if (action === undefined) throw new Error('没有合法动作');
      if (action.kind === 'PLAY') {
        for (const card of action.cards) store().toggleCard(card.id);
        store().playSelected();
      } else {
        store().pass();
      }
    } else {
      advanceToPlaying();
    }
    if (store().noticeTone === 'error') throw new Error(`store 报错：${store().notice ?? ''}`);
  }
}

afterEach(() => {
  cleanup();
});

describe('M2 界面（jsdom）', () => {
  it('初始渲染：标题、四家座位、规则速查都在', () => {
    boot();
    render(<App />);

    expect(screen.getByText('葵A葵3')).toBeTruthy();
    for (const label of ['1 号位', '2 号位', '3 号位', '4 号位']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('规则速查')).toBeTruthy();
    expect(screen.getByText(/随机种子/)).toBeTruthy();
  });

  it('出牌阶段：点一张牌 →「出牌」变可用 → 点完手牌少一张', () => {
    boot();
    advanceToPlaying();
    const seat = getActiveSeat(store().game);
    if (seat === null) throw new Error('没有行动座位');
    const before = store().game.players[seat]?.hand.length ?? 0;
    expect(before).toBeGreaterThan(0);

    render(<App />);

    const hand = screen.getByLabelText('手牌');
    const cardButtons = hand.querySelectorAll('button');
    expect(cardButtons.length).toBe(before);

    const playButton = screen.getByRole('button', { name: '出牌' }) as HTMLButtonElement;
    expect(playButton.disabled).toBe(true); // 还没选牌时不可点

    fireEvent.click(cardButtons[0] as HTMLButtonElement);
    expect(store().selectedCardIds.length).toBe(1);
    expect(playButton.disabled).toBe(false);

    fireEvent.click(playButton);
    expect(store().game.players[seat]?.hand.length).toBe(before - 1);
    expect(store().selectedCardIds).toEqual([]);
  });

  it('锁定窗口阶段：渲染「开始出牌」，点了能进入出牌', () => {
    boot();
    let guard = 0;
    while (store().game.phase !== 'LOCK_WINDOW') {
      if (++guard > 5000) throw new Error('推进不到锁定窗口');
      const { game } = store();
      if (game.phase === 'REVEAL') store().skipReveal();
      else if (game.phase === 'SUPPLY') {
        if (supplyDeadlocked(game)) store().reveal();
        else if (game.supplyContext?.step === 'RETURN_SELECT') store().autoReturn();
        else if (game.supplyContext?.step === 'RETURN_PICK') {
          const card = game.supplyContext.returnPool[0];
          if (card !== undefined) store().pickReturn(card.id);
        } else throw new Error(`SUPPLY 意外步骤 ${game.supplyContext?.step}`);
      } else throw new Error(`意外阶段 ${game.phase}`);
    }

    render(<App />);
    const finish = screen.getByRole('button', { name: '开始出牌' });
    fireEvent.click(finish);
    expect(store().game.phase).toBe('PLAYING');
  });

  it('结算阶段：显示比分与「下一局」，点了进入下一局', () => {
    boot();
    playToSettle();

    render(<App />);
    // 结算面板里「下一局」会出现多次（按钮 + 供牌预告 + 首发预告），所以用 getAllByText
    expect(screen.getAllByText(/下一局/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/地主方/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '下一局' }));
    expect(store().game.handNo).toBe(2);
    expect(store().game.phase).not.toBe('SETTLE');
  });

  it('领出时「不要」按钮是禁用的（不能空过）', () => {
    boot();
    advanceToPlaying();
    // 保证当前是领出（本局第一手）
    expect(store().game.isFirstPlay).toBe(true);

    render(<App />);
    const passButton = screen.getByRole('button', { name: '不要' }) as HTMLButtonElement;
    expect(passButton.disabled).toBe(true);
  });

  it('「新开一局」按钮会重置到新的一局', () => {
    boot();
    advanceToPlaying();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '新开一局' }));
    expect(store().game.handNo).toBe(1);
    expect(store().game.phase).not.toBe('SETTLE');
  });
});
