/**
 * 把服务端下发的 PlayerView 适配成界面层熟悉的 GameState。
 *
 * 为什么要适配：整个 M2 的 selectors / 组件都是按 `GameState` 写的。
 * 联机时我们只有「自己的手牌 + 公开信息 + 别人的张数」，所以这里用**占位牌**
 * 把别人的手牌补成对应张数（只有 length 有用，牌面永远不会被渲染出来）。
 *
 * 安全注意：占位牌使用负数 id，且不参与任何展示；别人手牌内容根本不在客户端内存里。
 */

import { eligibleCards, identifyPattern, sortDesc, TIER, categoryOf } from '@a3/core';
import type {
  Card,
  Debt,
  GameState,
  Pattern,
  Phase,
  PlayerState,
  SupplyContext,
  SupplyStep,
} from '@a3/core';
import type { PlayerView } from '@a3/protocol';

const PHASES: readonly Phase[] = ['DEAL', 'REVEAL', 'SUPPLY', 'LOCK_WINDOW', 'PLAYING', 'SETTLE'];

function asPhase(value: string): Phase {
  return (PHASES.find((phase) => phase === value) ?? 'PLAYING') as Phase;
}

/** 占位牌：只有张数意义，绝不渲染 */
const placeholderCache = new Map<number, Card>();
function placeholderCard(index: number): Card {
  const cached = placeholderCache.get(index);
  if (cached !== undefined) return cached;
  const card: Card = { id: -1_000_000 - index, rank: 4, suit: 1 };
  placeholderCache.set(index, card);
  return card;
}

function placeholderHand(seat: number, count: number): Card[] {
  return Array.from({ length: count }, (_, index) => placeholderCard(seat * 100 + index));
}

/**
 * PlayerView 里的 topPattern 只有类型与牌面，没有比较键。
 * 这里用同一套牌面重新识别一次，拿到真实的 key / tier ——
 * 否则「能不能压」在客户端会算错（服务端仍会兜底校验，但会白白收到错误）。
 */
function toPattern(top: PlayerView['topPattern']): Pattern | null {
  if (top === null) return null;
  const identified = identifyPattern(top.cards);
  if (identified !== null && identified.type === top.type) return identified;
  return {
    type: top.type,
    cards: [...top.cards],
    category: categoryOf(top.type),
    tier: TIER[top.type],
    key: [0, 0],
    equalAllowed: false,
  };
}

function toDebt(view: PlayerView): Debt | null {
  if (view.debt === null) return null;
  return {
    winners: [...view.debt.winners],
    losers: [...view.debt.losers],
    amountPerLoser: view.debt.amountPerLoser,
    total: view.debt.total,
    revealed: view.debt.revealed,
    mode: view.debt.mode,
  };
}

function toSupplyContext(view: PlayerView): SupplyContext | null {
  if (view.supplyStep === null) return null;
  const perLoser = new Map<number, Card[]>();
  if (view.supplyFromMe.length > 0) perLoser.set(view.seat, [...view.supplyFromMe]);
  return {
    step: view.supplyStep as SupplyStep,
    pool: [...view.supplyPool],
    returnPool: [...view.returnPool],
    perLoser,
    perWinner: new Map<number, number>(),
    biggestCardByLoser: new Map<number, Card>(),
    returns: new Map<number, Card[]>(),
    transfers: [],
  };
}

/** 主适配函数：联机视图 → 界面用的 GameState */
export function viewToGameState(view: PlayerView): GameState {
  const players: PlayerState[] = view.players.map((player) => ({
    seat: player.seat,
    hand: player.seat === view.seat ? [...view.hand] : placeholderHand(player.seat, player.handCount),
    out: player.out,
    locked: player.locked,
    rank: player.rank,
  }));

  const topPattern = toPattern(view.topPattern);
  const rankTaken = [false, false, false, false, false];
  for (const player of view.players) {
    if (player.rank !== null && player.rank >= 1 && player.rank <= 4) rankTaken[player.rank] = true;
  }

  return {
    handNo: view.handNo,
    phase: asPhase(view.phase),
    players,
    landlordSeats: [...view.landlordSeats],
    doubleSeat: view.doubleSeat,
    revealedSeat: view.revealedSeat,
    pendingDebt: toDebt(view),
    supplyContext: toSupplyContext(view),
    firstSeat: view.firstSeat,
    firstSeatBySupply: view.firstSeatBySupply,
    currentSeat: view.currentSeat,
    topPattern,
    topSeat: view.topPattern?.seat ?? null,
    threePhase: view.threePhase,
    isFirstPlay: view.isFirstPlay,
    passesSinceLastPlay: 0,
    trickNo: view.trickNo,
    publicCards: view.publicCards.map((card) => card.id),
    finishOrder: [],
    nextRankSlot: 1,
    rankTaken,
    redealCount: 0,
    supplyPauseRequested: false,
    supplyPaused: view.supplyPaused,
    supplyGainedIds: [...view.supplyGainedIds],
    lockIntents: new Map<number, boolean>([[view.seat, view.myLockIntent]]),
    result: view.result,
    log: [...view.log],
  };
}

/**
 * 供牌倒计时期间，我要交出去的牌（本地按规则算：排除 ♠3/♠A 后取最大的 N 张）。
 * 服务端执行供牌后以 `supplyFromMe` 为准。
 */
export function plannedSupplyFromSelf(view: PlayerView): Card[] {
  const debt = view.debt;
  if (debt === null || !debt.losers.includes(view.seat)) return [];
  if (view.supplyFromMe.length > 0) return view.supplyFromMe;
  return sortDesc(eligibleCards(view.hand)).slice(0, debt.amountPerLoser);
}
