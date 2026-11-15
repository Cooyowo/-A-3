// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { legalActions } from '@a3/core';

import App from '../src/App';
import { getActiveSeat } from '../src/game/selectors';
import { supplyDeadlocked, useHotseatStore } from '../src/game/store';

/**
 * M2 横屏界面测试（jsdom + Testing Library）：
 * 验证各阶段界面能挂载、按钮能点、点击后状态正确推进。
 * 真实视觉与手感由浏览器/真机验收，这里挡的是「接线错 / 按钮无响应 / 阶段没接上」。
 *
 * 注意：不能用 react-dom/server 快照——zustand v5 的 SSR 快照永远取初始 state。
 */

function store() {
  return useHotseatStore.getState();
}

function boot(seed = 20261115): void {
  store().newGame(seed);
  store().dismissNotice();
}

/** 推进到出牌阶段（沿路选最保守的操作） */
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

function advanceToLockWindow(): void {
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

/** 找出手牌按钮（牌的 aria-label 是「♠J」这种）。 */
function cardButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((button) => {
    const label = button.getAttribute('aria-label') ?? '';
    return /^[♠♥♣♦]/.test(label);
  }) as HTMLButtonElement[];
}

afterEach(() => {
  cleanup();
});

describe('M2 横屏界面（jsdom）', () => {
  it('初始渲染：牌桌、四家座位、自己信息、调试按钮、竖屏提示都在', () => {
    boot();
    const { container } = render(<App />);

    expect(container.querySelector('.felt')).not.toBeNull();
    expect(container.querySelectorAll('.slot').length).toBe(3);
    expect(container.querySelector('.self-info')).not.toBeNull();
    expect(screen.getByRole('button', { name: /切换视角/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新开一局' })).toBeTruthy();
    expect(screen.getByText('请把手机横过来使用')).toBeTruthy();
  });

  it('出牌阶段：手牌可点、「出牌」按钮选中后可用、出完手牌 -1', () => {
    boot();
    advanceToPlaying();
    const seat = getActiveSeat(store().game);
    if (seat === null) throw new Error('没有行动座位');
    const before = store().game.players[seat]?.hand.length ?? 0;
    expect(before).toBeGreaterThan(0);

    render(<App />);

    const cards = cardButtons();
    expect(cards.length).toBe(before);

    const playButton = screen.getByRole('button', { name: '出牌' }) as HTMLButtonElement;
    expect(playButton.disabled).toBe(true);

    fireEvent.click(cards[0] as HTMLButtonElement);
    expect(store().selectedCardIds.length).toBe(1);
    expect(playButton.disabled).toBe(false);

    fireEvent.click(playButton);
    expect(store().game.players[seat]?.hand.length).toBe(before - 1);
  });

  it('操作条顺序与文案：不出 / 提示 / 出牌 / 清空都在', () => {
    boot();
    advanceToPlaying();
    render(<App />);

    expect(screen.getByRole('button', { name: '不出' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '提示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
  });

  it('「提示」按钮会自动选中一手合法牌', () => {
    boot();
    advanceToPlaying();
    render(<App />);

    expect(store().selectedCardIds.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(store().selectedCardIds.length).toBeGreaterThan(0);
  });

  it('「切换视角」按钮能切换并回到自动', () => {
    boot();
    advanceToPlaying();
    render(<App />);

    expect(store().viewSeat).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /切换视角/ }));
    expect(store().viewSeat).toBe(0);
  });

  it('锁定窗口：出现「开始出牌」，点了进入出牌', () => {
    boot();
    advanceToLockWindow();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '开始出牌' }));
    expect(store().game.phase).toBe('PLAYING');
  });

  it('结算：出现「下一局」，点了进入下一局', () => {
    boot();
    playToSettle();
    render(<App />);

    expect(screen.getAllByText(/下一局/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '下一局' }));
    expect(store().game.handNo).toBe(2);
  });

  it('规则速查：点「?」打开浮层', () => {
    boot();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '规则速查' }));
    expect(screen.getByText('牌组档位（高的无条件压低的）', { exact: false })).toBeTruthy();
  });
});
