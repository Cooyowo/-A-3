import {
  buildDebt,
  checkSupplyPossible,
  cmpCard,
  currentReturnPicker,
  isLandlordCard,
  lockEligible,
  rankScore,
} from '@a3/core';
import type { Card, GameState, PlayerState, Result } from '@a3/core';

/** 座位显示名（0~3 号位，下家 = +1） */
export const SEAT_LABELS = ['1 号位', '2 号位', '3 号位', '4 号位'] as const;

export function getSeatLabel(seat: number): string {
  return SEAT_LABELS[seat] ?? `${seat + 1} 号位`;
}

/** 按牌面从大到小排序（手牌展示用） */
export function sortHandDesc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => cmpCard(b, a));
}

/** 按牌面从小到大排序 */
export function sortHandAsc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => cmpCard(a, b));
}

/** 从牌 id 反查牌对象（手牌、供牌池、回牌池、已提交回牌里找） */
export function cardsByIds(game: GameState, ids: readonly number[]): Card[] {
  const index = new Map<number, Card>();
  const put = (cards: readonly Card[] | undefined): void => {
    for (const card of cards ?? []) index.set(card.id, card);
  };
  for (const player of game.players) put(player.hand);
  const context = game.supplyContext;
  if (context !== null) {
    put(context.pool);
    put(context.returnPool);
    for (const cards of context.perLoser.values()) put(cards);
    for (const cards of context.returns.values()) put(cards);
  }
  return ids.map((id) => index.get(id)).filter((card): card is Card => card !== undefined);
}

/** 公开区域的牌（明牌公开的两张、锁定公开的 13 张） */
export function publicCardList(game: GameState): Card[] {
  return cardsByIds(game, game.publicCards);
}

/**
 * 当前需要谁来操作（热座靠它切换显示谁的手牌）。
 * LOCK_WINDOW 返回 null：所有达标的人都要各自表态，由界面列出来。
 */
export function getActiveSeat(game: GameState): number | null {
  switch (game.phase) {
    case 'REVEAL':
      return game.doubleSeat;
    case 'SUPPLY': {
      const context = game.supplyContext;
      const debt = game.pendingDebt;
      if (context === null || debt === null) return null;
      if (context.step === 'CHECK' && !checkSupplyPossible(game, debt)) return debt.losers[0] ?? null;
      if (context.step === 'RETURN_SELECT') {
        return debt.winners.find((seat) => !context.returns.has(seat)) ?? null;
      }
      if (context.step === 'RETURN_PICK') return currentReturnPicker(game);
      return null;
    }
    case 'PLAYING':
      return game.currentSeat;
    case 'LOCK_WINDOW':
    case 'SETTLE':
    case 'DEAL':
      return null;
    default:
      return null;
  }
}

/** 一句话说明现在在等什么（顶部状态条） */
export function getTurnHint(game: GameState): string {
  const active = getActiveSeat(game);
  const label = active === null ? '' : getSeatLabel(active);
  switch (game.phase) {
    case 'REVEAL':
      return `${label} 同时拿到 ♠3 和 ♠A（双地），请决定是否明牌。`;
    case 'SUPPLY': {
      const context = game.supplyContext;
      if (context === null) return '供牌环节。';
      if (context.step === 'CHECK') return '供牌检查：有人交不够牌，需要在「明牌」和「重新发牌」里选一个。';
      if (context.step === 'RETURN_SELECT') return `${label} 请选择要返还的牌。`;
      if (context.step === 'RETURN_PICK') return `${label} 请从回牌池里挑一张。`;
      return '供牌中…';
    }
    case 'LOCK_WINDOW':
      return '锁定窗口（固定 5 秒的位置，现在等所有人表态后点「开始出牌」）。';
    case 'PLAYING': {
      const leading = game.topPattern === null;
      return `${label} ${leading ? '领出' : `跟牌（要压过 ${game.topPattern?.type ?? ''}）`}。`;
    }
    case 'SETTLE':
      return '本局结束，看看结算。';
    default:
      return '发牌中…';
  }
}

/** 本局阶段的中文名 */
export function getPhaseName(game: GameState): string {
  switch (game.phase) {
    case 'REVEAL':
      return '明牌决策';
    case 'SUPPLY':
      return '供牌 / 回牌';
    case 'LOCK_WINDOW':
      return '锁定窗口';
    case 'PLAYING':
      return '出牌';
    case 'SETTLE':
      return '结算';
    default:
      return '发牌';
  }
}

export type SeatIdentity = 'LANDLORD' | 'FARMER' | 'DOUBLE' | 'UNKNOWN';

/**
 * 某个座位的身份在界面上能不能显示。
 * - 明牌后 / 结算后：全部公开；
 * - 该座位打出过地主牌：这个座位公开；
 * - 正在展示手牌的座位：自己知道自己的身份。
 */
export function getSeatIdentity(game: GameState, seat: number, activeSeat: number | null): SeatIdentity {
  const isLandlord = game.landlordSeats.includes(seat);
  const revealedAll = game.revealedSeat !== null || game.phase === 'SETTLE';

  if (revealedAll) {
    if (!isLandlord) return 'FARMER';
    return game.doubleSeat === seat ? 'DOUBLE' : 'LANDLORD';
  }

  const playedLandlordCard = game.log.some(
    (event) => event.t === 'PLAY' && event.seat === seat && event.cards.some((card) => isLandlordCard(card)),
  );
  if (playedLandlordCard) {
    return game.doubleSeat === seat ? 'DOUBLE' : 'LANDLORD';
  }

  if (activeSeat === seat) {
    // 正在展示这个人的手牌 → 他自己知道身份
    if (!isLandlord) return 'FARMER';
    return game.doubleSeat === seat ? 'DOUBLE' : 'LANDLORD';
  }

  return 'UNKNOWN';
}

export const IDENTITY_TEXT: Record<SeatIdentity, string> = {
  LANDLORD: '地主方',
  FARMER: '非地主方',
  DOUBLE: '双地（1 打 3）',
  UNKNOWN: '身份未公开',
};

export interface SeatStatus {
  seat: number;
  label: string;
  isActive: boolean;
  identity: SeatIdentity;
  handCount: number;
  out: boolean;
  locked: boolean;
  rank: number | null;
  isLockEligible: boolean;
  lockIntent: boolean;
  revealed: boolean;
}

export function getSeatStatuses(game: GameState): SeatStatus[] {
  const active = getActiveSeat(game);
  return game.players.map((player: PlayerState) => ({
    seat: player.seat,
    label: getSeatLabel(player.seat),
    isActive: active === player.seat,
    identity: getSeatIdentity(game, player.seat, active),
    handCount: player.hand.length,
    out: player.out,
    locked: player.locked,
    rank: player.rank,
    isLockEligible: game.phase === 'LOCK_WINDOW' && lockEligible(game, player.seat),
    lockIntent: game.lockIntents.get(player.seat) === true,
    revealed: game.revealedSeat === player.seat,
  }));
}

export interface SupplyView {
  step: string;
  pool: Card[];
  perLoser: { seat: number; label: string; cards: Card[] }[];
  returns: { seat: number; label: string; cards: Card[] }[];
  returnPool: Card[];
  requiredByWinner: { seat: number; label: string; count: number; done: boolean }[];
  pickOrder: { seat: number; label: string }[];
}

export function getSupplyView(game: GameState): SupplyView | null {
  const context = game.supplyContext;
  if (context === null) return null;
  const debt = game.pendingDebt;
  const winners = debt?.winners ?? [];
  return {
    step: context.step,
    pool: context.pool,
    perLoser: [...context.perLoser.entries()].map(([seat, cards]) => ({
      seat,
      label: getSeatLabel(seat),
      cards,
    })),
    returns: [...context.returns.entries()].map(([seat, cards]) => ({
      seat,
      label: getSeatLabel(seat),
      cards,
    })),
    returnPool: context.returnPool,
    requiredByWinner: winners.map((seat) => ({
      seat,
      label: getSeatLabel(seat),
      count: context.perWinner.get(seat) ?? 0,
      done: context.returns.has(seat),
    })),
    pickOrder: [...context.perLoser.keys()]
      .sort((a, b) => {
        const cardA = context.perLoser.get(a)?.[0];
        const cardB = context.perLoser.get(b)?.[0];
        if (cardA === undefined || cardB === undefined) return a - b;
        return cmpCard(cardB, cardA);
      })
      .map((seat) => ({ seat, label: getSeatLabel(seat) })),
  };
}

export interface SettleRow {
  seat: number;
  label: string;
  rank: number | null;
  score: number;
  isLandlord: boolean;
  locked: boolean;
  out: boolean;
  handCount: number;
}

export interface SettleView {
  result: Result;
  landlordScore: number;
  farmerScore: number;
  outcomeText: string;
  rows: SettleRow[];
  nextDebtText: string;
  nextFirstText: string;
}

function outcomeTextOf(result: Result): string {
  if (result.mode === 'NORMAL') {
    if (result.draw) return '平局（3:3）';
    const winner = result.lScore > result.fScore ? '地主方' : '非地主方';
    const diff = result.scoreDiff;
    return `${winner}${diff >= 4 ? '大赢' : '小赢'}（${result.lScore}:${result.fScore}）`;
  }
  const winner = result.lScore > result.fScore ? '地主方' : '非地主方';
  return `${winner}赢（${result.lScore}:${result.fScore}）`;
}

export function getNextDebtText(game: GameState): string {
  const result = game.result;
  if (result === null) return '';
  if (result.draw) return '本局平局：不供牌、不回牌。';
  const debt = buildDebt(game, result);
  if (debt === null) return '本局平局：不供牌、不回牌。';
  const losers = debt.losers.map(getSeatLabel).join('、');
  const winners = debt.winners.map(getSeatLabel).join('、');
  const extra = debt.revealed ? '，且本局明牌 → 张数翻倍' : '';
  return `下一局 ${losers} 向 ${winners} 供牌：每人 ${debt.amountPerLoser} 张（共 ${debt.total} 张）${extra}。`;
}

export function getNextFirstText(game: GameState): string {
  if (game.revealedSeat !== null) {
    return `下一局由 ${getSeatLabel(game.revealedSeat)} 首发（明牌者）。`;
  }
  if (game.firstSeatBySupply !== null) {
    return `下一局由 ${getSeatLabel(game.firstSeatBySupply)} 首发（上交的牌最大）。`;
  }
  return '下一局由 ♦4 的持有者首发（发牌后确定）。';
}

export function getSettleView(game: GameState): SettleView | null {
  const result = game.result;
  if (result === null) return null;
  return {
    result,
    landlordScore: result.lScore,
    farmerScore: result.fScore,
    outcomeText: outcomeTextOf(result),
    rows: game.players.map((player) => ({
      seat: player.seat,
      label: getSeatLabel(player.seat),
      rank: player.rank,
      score: rankScore(player.rank),
      isLandlord: game.landlordSeats.includes(player.seat),
      locked: player.locked,
      out: player.out,
      handCount: player.hand.length,
    })),
    nextDebtText: getNextDebtText(game),
    nextFirstText: getNextFirstText(game),
  };
}

/** 最近一手牌（桌面中央展示） */
export function getLastPlayText(game: GameState): { seat: number; label: string; cards: Card[] } | null {
  for (let index = game.log.length - 1; index >= 0; index -= 1) {
    const event = game.log[index];
    if (event !== undefined && event.t === 'PLAY') {
      return { seat: event.seat, label: getSeatLabel(event.seat), cards: event.cards };
    }
  }
  return null;
}
