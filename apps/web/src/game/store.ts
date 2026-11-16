import { create } from 'zustand';

import {
  applyAction,
  autoAdvance,
  checkSupplyPossible,
  cmpCard,
  createGame,
  currentReturnPicker,
  defaultReturnCards,
  isLandlordCard,
  legalActions,
  lockEligible,
  maxCard,
  resolveLockWindow,
  settleAndNextHand,
  validatePlay,
} from '@a3/core';
import type { Action, Card, GameState, Rng } from '@a3/core';

import { mulberry32 } from './rng';
import { cardsByIds, getActiveSeat } from './selectors';

/** 热座（M2）状态：一个页面、四人轮流在同一个设备上操作 */
export interface HotseatGame {
  game: GameState;
  seed: number;
  /** 第几次「新开一局」：用来让所有倒计时 key 一起重置（否则新开一局倒计时不会重新开始） */
  session: number;
  /** 当前点选（等待出牌/回牌）的牌 id */
  selectedCardIds: number[];
  /** 顶部提示（非法操作原因、操作成功反馈等） */
  notice: string | null;
  noticeTone: 'info' | 'error' | 'success';
  /** 测试用的「手动切视角」：null = 跟随当前行动者，0~3 = 固定看某个座位 */
  viewSeat: number | null;
  /** 挑回牌时，桌面中间被点亮的回牌 id（点【选这张】才真正拿走） */
  highlightedReturnId: number | null;
}

export interface HotseatActions {
  newGame(seed?: number): void;
  toggleCard(cardId: number): void;
  clearSelection(): void;
  playSelected(): void;
  pass(): void;
  hint(): void;
  reveal(): void;
  skipReveal(): void;
  redeal(): void;
  setLockIntent(seat: number, on: boolean): void;
  finishLockWindow(): void;
  submitReturnSelected(): void;
  autoReturn(): void;
  pickReturn(cardId: number): void;
  nextHand(): void;
  dismissNotice(): void;
  /** 测试用：循环切换视角（自动 → 1 号位 → 2 号位 → 3 号位 → 4 号位 → 自动） */
  cycleViewSeat(): void;
  /** 挑回牌：点亮桌面中间的一张回牌 */
  highlightReturn(cardId: number): void;
  /** 挑回牌：确认拿走当前点亮的回牌 */
  confirmPickReturn(): void;
  /** 挑回牌超时：自动拿最大的那张回牌（用户口径：超时默认选最大的回牌） */
  autoPickReturn(): void;
}

export type HotseatStore = HotseatGame & HotseatActions;

function initialState(seed: number, session = 0): HotseatGame {
  const rng: Rng = mulberry32(seed);
  const game = autoAdvance(createGame(rng));
  return {
    game,
    seed,
    session,
    selectedCardIds: [],
    notice: null,
    noticeTone: 'info',
    viewSeat: null,
    highlightedReturnId: null,
  };
}

/** 包一层：引擎抛错一律转成提示，不让界面崩掉 */
function guard(fn: () => HotseatGame | Partial<HotseatGame>): (draft: HotseatGame) => HotseatGame {
  return (draft: HotseatGame) => {
    try {
      const patch = fn();
      return { ...draft, noticeTone: 'info', ...patch } as HotseatGame;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...draft, notice: message, noticeTone: 'error' };
    }
  };
}

/** 当前座位的手牌 */
function activeHand(game: GameState): { seat: number | null; hand: readonly Card[] } {
  const seat = getActiveSeat(game);
  const hand = seat === null ? [] : (game.players[seat]?.hand ?? []);
  return { seat, hand };
}

export const useHotseatStore = create<HotseatStore>((set, get) => {
  const apply = (patch: Partial<HotseatGame>): void => {
    set({ ...patch });
  };

  /** 统一入口：跑一个引擎动作并推进到下一个需要人操作的点 */
  const runAction = (seat: number, action: Action): void => {
    const { game, seed } = get();
    try {
      const rng = mulberry32(seed + game.handNo * 1000 + game.redealCount);
      const next = autoAdvance(applyAction(game, seat, action, rng));
      apply({
        game: next,
        selectedCardIds: [],
        highlightedReturnId: null,
        notice: null,
        noticeTone: 'info',
      });
    } catch (error) {
      apply({
        notice: error instanceof Error ? error.message : String(error),
        noticeTone: 'error',
      });
    }
  };

  return {
    ...initialState(20261115),

    newGame(seed) {
      const nextSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
      const session = get().session + 1;
      set({
        ...initialState(nextSeed, session),
        notice: `新开一局（种子 ${nextSeed}）`,
        noticeTone: 'success',
      });
    },

    toggleCard(cardId) {
      const { selectedCardIds } = get();
      const exists = selectedCardIds.includes(cardId);
      apply({ selectedCardIds: exists ? selectedCardIds.filter((id) => id !== cardId) : [...selectedCardIds, cardId] });
    },

    clearSelection() {
      apply({ selectedCardIds: [] });
    },

    playSelected() {
      const { game, selectedCardIds } = get();
      const seat = getActiveSeat(game);
      if (seat === null) return apply({ notice: '现在不是出牌环节', noticeTone: 'error' });
      if (selectedCardIds.length === 0) return apply({ notice: '请先点选要出的牌', noticeTone: 'error' });
      const cards = cardsByIds(game, selectedCardIds);
      const check = validatePlay(game, seat, cards);
      if (!check.ok) return apply({ notice: check.reason, noticeTone: 'error' });
      runAction(seat, { kind: 'PLAY', cards });
    },

    pass() {
      const { game } = get();
      const seat = getActiveSeat(game);
      if (seat === null) return apply({ notice: '现在不能过牌', noticeTone: 'error' });
      runAction(seat, { kind: 'PASS' });
    },

    /** 提示：自动选中「最小的一手合法牌」（先按张数少，再按牌面小） */
    hint() {
      const { game } = get();
      const seat = getActiveSeat(game);
      if (seat === null || game.phase !== 'PLAYING') {
        return apply({ notice: '现在没有可提示的出牌', noticeTone: 'error' });
      }
      const plays = legalActions(game, seat).filter(
        (action): action is { kind: 'PLAY'; cards: Card[] } => action.kind === 'PLAY',
      );
      if (plays.length === 0) {
        return apply({ notice: '没有能压过的牌，只能选「不出」', noticeTone: 'info' });
      }
      const weakest = plays.sort((a, b) => {
        if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
        const maxA = a.cards.reduce((best, card) => (cmpCard(card, best) > 0 ? card : best));
        const maxB = b.cards.reduce((best, card) => (cmpCard(card, best) > 0 ? card : best));
        return cmpCard(maxA, maxB);
      })[0];
      if (weakest === undefined) return;
      apply({ selectedCardIds: weakest.cards.map((card) => card.id), notice: null, noticeTone: 'info' });
    },

    cycleViewSeat() {
      const order: (number | null)[] = [null, 0, 1, 2, 3];
      const { viewSeat } = get();
      const index = order.indexOf(viewSeat);
      const next = order[(index + 1) % order.length] ?? null;
      apply({
        viewSeat: next,
        selectedCardIds: [],
        notice: next === null ? '视角：跟随当前行动者' : `视角：${next + 1} 号位`,
        noticeTone: 'info',
      });
    },

    reveal() {
      const { game } = get();
      // 明牌有两个入口：REVEAL 阶段的主动明牌；以及「12 张供不出」时在 SUPPLY/CHECK 的二选一
      const inRevealPhase = game.phase === 'REVEAL' && game.doubleSeat !== null;
      const inDeadlock = supplyDeadlocked(game);
      if (!inRevealPhase && !inDeadlock) {
        return apply({ notice: '当前不能明牌', noticeTone: 'error' });
      }
      const seat = game.doubleSeat ?? game.pendingDebt?.losers[0] ?? null;
      if (seat === null) return apply({ notice: '找不到可以明牌的座位', noticeTone: 'error' });
      runAction(seat, { kind: 'REVEAL' });
    },

    skipReveal() {
      const { game } = get();
      if (game.phase !== 'REVEAL' || game.doubleSeat === null) {
        return apply({ notice: '当前不能跳过明牌', noticeTone: 'error' });
      }
      runAction(game.doubleSeat, { kind: 'PASS' });
    },

    redeal() {
      const { game } = get();
      const { seat } = activeHand(game);
      const target = seat ?? game.pendingDebt?.losers[0] ?? null;
      if (target === null) return apply({ notice: '当前不能重新发牌', noticeTone: 'error' });
      runAction(target, { kind: 'REDEAL' });
    },

    setLockIntent(seat, on) {
      const { game } = get();
      if (game.phase !== 'LOCK_WINDOW') return apply({ notice: '现在不是锁定窗口', noticeTone: 'error' });
      if (!lockEligible(game, seat)) return apply({ notice: '该玩家手牌不满足锁定条件', noticeTone: 'error' });
      runAction(seat, { kind: on ? 'LOCK' : 'UNLOCK' });
    },

    finishLockWindow() {
      const { game } = get();
      if (game.phase !== 'LOCK_WINDOW') return apply({ notice: '现在不是锁定窗口', noticeTone: 'error' });
      const intents = game.players
        .map((player) => player.seat)
        .filter((seat) => game.lockIntents.get(seat) === true);
      try {
        const next = autoAdvance(resolveLockWindow(game, intents));
        apply({ game: next, selectedCardIds: [], notice: null, noticeTone: 'info' });
      } catch (error) {
        apply({ notice: error instanceof Error ? error.message : String(error), noticeTone: 'error' });
      }
    },

    submitReturnSelected() {
      const { game, selectedCardIds, viewSeat } = get();
      const context = game.supplyContext;
      if (game.phase !== 'SUPPLY' || context === null || context.step !== 'RETURN_SELECT') {
        return apply({ notice: '现在不是选择回牌的环节', noticeTone: 'error' });
      }
      const winners = game.pendingDebt?.winners ?? [];
      // 回牌是同步的：切到哪个赢家的视角，就用那个人的手牌回；否则用第一个还没交的
      const target =
        viewSeat !== null && winners.includes(viewSeat) && !context.returns.has(viewSeat)
          ? viewSeat
          : winners.find((seat) => !context.returns.has(seat)) ?? null;
      if (target === null) return apply({ notice: '所有赢家都已经回过牌了', noticeTone: 'error' });

      const required = context.perWinner.get(target) ?? 0;
      const cards = cardsByIds(game, selectedCardIds);
      if (cards.length !== required) {
        return apply({ notice: `需要选 ${required} 张回牌，当前选了 ${cards.length} 张`, noticeTone: 'error' });
      }
      if (cards.some((card) => isLandlordCard(card))) {
        return apply({ notice: '♠3 和 ♠A 不能作为回牌', noticeTone: 'error' });
      }
      runAction(target, { kind: 'RETURN_CARDS', cards });
    },

    autoReturn() {
      const { game, viewSeat } = get();
      const context = game.supplyContext;
      if (game.phase !== 'SUPPLY' || context === null || context.step !== 'RETURN_SELECT') {
        return apply({ notice: '现在不是选择回牌的环节', noticeTone: 'error' });
      }
      const winners = game.pendingDebt?.winners ?? [];
      const target =
        viewSeat !== null && winners.includes(viewSeat) && !context.returns.has(viewSeat)
          ? viewSeat
          : winners.find((seat) => !context.returns.has(seat)) ?? null;
      if (target === null) return;
      const required = context.perWinner.get(target) ?? 0;
      const hand = game.players[target]?.hand ?? [];
      runAction(target, { kind: 'RETURN_CARDS', cards: defaultReturnCards(hand, required) });
    },

    pickReturn(cardId) {
      const { game } = get();
      if (game.phase !== 'SUPPLY' || game.supplyContext?.step !== 'RETURN_PICK') {
        return apply({ notice: '现在不是挑选回牌的环节', noticeTone: 'error' });
      }
      const picker = currentReturnPicker(game);
      if (picker === null) return apply({ notice: '找不到需要挑牌的输家', noticeTone: 'error' });
      const card = game.supplyContext.returnPool.find((item) => item.id === cardId);
      if (card === undefined) return apply({ notice: '回牌池里没有这张牌', noticeTone: 'error' });
      runAction(picker, { kind: 'PICK_RETURN', card });
    },

    /** 点亮桌面中间的一张回牌（再点【选这张】才真正拿走，防误触） */
    highlightReturn(cardId) {
      const { game } = get();
      if (game.phase !== 'SUPPLY' || game.supplyContext?.step !== 'RETURN_PICK') {
        return apply({ notice: '现在不是挑回牌的环节', noticeTone: 'error' });
      }
      const exists = game.supplyContext.returnPool.some((card) => card.id === cardId);
      apply({ highlightedReturnId: exists ? cardId : null });
    },

    /** 【选这张】：拿走当前点亮的回牌（没点亮时提示） */
    confirmPickReturn() {
      const { game, highlightedReturnId } = get();
      if (game.phase !== 'SUPPLY' || game.supplyContext?.step !== 'RETURN_PICK') {
        return apply({ notice: '现在不是挑回牌的环节', noticeTone: 'error' });
      }
      const picker = currentReturnPicker(game);
      if (picker === null) return apply({ notice: '找不到需要挑牌的输家', noticeTone: 'error' });
      const pool = game.supplyContext.returnPool;
      const target =
        highlightedReturnId === null ? null : pool.find((card) => card.id === highlightedReturnId) ?? null;
      if (target === null) {
        return apply({ notice: '请先在桌面中间点一张回牌', noticeTone: 'error' });
      }
      runAction(picker, { kind: 'PICK_RETURN', card: target });
    },

    /** 挑回牌超时：自动拿最大的那张回牌（用户口径） */
    autoPickReturn() {
      const { game } = get();
      if (game.phase !== 'SUPPLY' || game.supplyContext?.step !== 'RETURN_PICK') return;
      const picker = currentReturnPicker(game);
      if (picker === null) return;
      const target = maxCard(game.supplyContext.returnPool);
      if (target === null) return;
      runAction(picker, { kind: 'PICK_RETURN', card: target });
    },

    nextHand() {
      const { game, seed } = get();
      if (game.phase !== 'SETTLE') return apply({ notice: '本局还没结束', noticeTone: 'error' });
      try {
        const rng = mulberry32(seed + game.handNo * 7919 + 13);
        const next = autoAdvance(settleAndNextHand(game, rng));
        apply({ game: next, selectedCardIds: [], notice: null, noticeTone: 'info' });
      } catch (error) {
        apply({ notice: error instanceof Error ? error.message : String(error), noticeTone: 'error' });
      }
    },

    dismissNotice() {
      set({ notice: null, noticeTone: 'info' });
    },
  };
});

/** 供选择界面用：当前行动者还能不能动 */
export function canAct(store: HotseatStore): boolean {
  const { game } = store;
  if (game.phase === 'SETTLE') return false;
  return getActiveSeat(game) !== null || game.phase === 'LOCK_WINDOW';
}

/** 当前是否有 12 张供不出的死锁（需要二选一） */
export function supplyDeadlocked(game: GameState): boolean {
  return (
    game.phase === 'SUPPLY' &&
    game.supplyContext?.step === 'CHECK' &&
    game.pendingDebt !== null &&
    !checkSupplyPossible(game, game.pendingDebt)
  );
}

/** 供 debug 用：统一 guard 工具（供测试时手动构造状态） */
export { guard };
