// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { legalActions } from '@a3/core';

import App from '../src/App';
import { getActiveSeat } from '../src/game/selectors';
import { supplyDeadlocked, useHotseatStore } from '../src/game/store';

/**
 * M2 横屏界面测试（jsdom + Testing Library）。
 * 覆盖：欢迎页 → 牌桌、出牌交互、锁定窗口、结算、切换视角、提示、规则速查。
 * 供牌/回牌的时序动画依赖真实计时器，交给浏览器人工验收；这里只测「界面能挂载 + 按钮能推进状态」。
 */

function store() {
  return useHotseatStore.getState();
}

function boot(seed = 20261115): void {
  store().newGame(seed);
  store().dismissNotice();
}

/** 渲染并点「进入游戏」 */
function renderEntered() {
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '进入游戏' }));
  return view;
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

/** 手牌按钮（aria-label 是「♠J」这种） */
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
  it('欢迎页：标题 + 进入游戏按钮', () => {
    boot();
    render(<App />);

    expect(screen.getByText('葵A葵3')).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入游戏' })).toBeTruthy();
    expect(screen.getByText('请把手机横过来使用')).toBeTruthy();
  });

  it('进入游戏后：牌桌、四家座位、自己信息、调试按钮都在', () => {
    boot();
    renderEntered();

    expect(document.querySelector('.felt')).not.toBeNull();
    expect(document.querySelectorAll('.slot').length).toBe(3);
    expect(document.querySelector('.self-info')).not.toBeNull();
    expect(screen.getByRole('button', { name: /切换视角/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新开一局' })).toBeTruthy();
  });

  it('出牌阶段：手牌可点、「出牌」选中后可用、出完手牌 -1', () => {
    boot();
    advanceToPlaying();
    const seat = getActiveSeat(store().game);
    if (seat === null) throw new Error('没有行动座位');
    const before = store().game.players[seat]?.hand.length ?? 0;

    renderEntered();

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

  it('操作条文案：不出 / 提示 / 清空 都在', () => {
    boot();
    advanceToPlaying();
    renderEntered();

    expect(screen.getByRole('button', { name: '不出' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '提示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
  });

  it('「提示」会自动选中一手合法牌', () => {
    boot();
    advanceToPlaying();
    renderEntered();

    expect(store().selectedCardIds.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(store().selectedCardIds.length).toBeGreaterThan(0);
  });

  it('领出时「不出」按钮是禁用的', () => {
    boot();
    advanceToPlaying();
    expect(store().game.isFirstPlay).toBe(true);

    renderEntered();
    const passButton = screen.getByRole('button', { name: '不出' }) as HTMLButtonElement;
    expect(passButton.disabled).toBe(true);
  });

  it('「切换视角」能切换', () => {
    boot();
    advanceToPlaying();
    renderEntered();

    expect(store().viewSeat).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /切换视角/ }));
    expect(store().viewSeat).toBe(0);
  });

  it('供牌结束：不弹窗，桌面中间只有倒计时数字', () => {
    boot();
    advanceToLockWindow();
    renderEntered();

    expect(document.querySelector('.center-card__timer')).not.toBeNull();
    expect(screen.queryByText('开始出牌')).toBeNull();
  });

  it('结算：出现「下一局」，点了进入下一局', () => {
    boot();
    playToSettle();
    renderEntered();

    expect(screen.getAllByText(/下一局/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '下一局' }));
    expect(store().game.handNo).toBe(2);
  });

  it('规则速查：点「?」打开浮层', () => {
    boot();
    renderEntered();

    fireEvent.click(screen.getByRole('button', { name: '规则速查' }));
    expect(screen.getByText('牌组档位（高的无条件压低的）', { exact: false })).toBeTruthy();
  });
});
