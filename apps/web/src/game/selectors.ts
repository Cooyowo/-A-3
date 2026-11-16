import {
  buildDebt,
  checkSupplyPossible,
  cmpCard,
  currentReturnPicker,
  eligibleCards,
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
  /** 身份：'♠A' / '♠3' / '♠3♠A'（双地）/ '-'（非地主方） */
  identityText: string;
  /** 下一局供牌收支：赢家 +n（绿），输家 -n（红），平局 0 */
  gain: number;
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
  const debt = result.draw ? null : buildDebt(game, result);
  const gainOf = (seat: number): number => {
    if (debt === null) return 0;
    // 牌数守恒：输家每人 -n，赢家平分总张数（双地明牌 L 输：L −12、其余三家各 +4）
    if (debt.losers.includes(seat)) return -debt.amountPerLoser;
    if (debt.winners.includes(seat)) {
      return Math.round(debt.total / Math.max(1, debt.winners.length));
    }
    return 0;
  };
  // 地主牌归属：先看手牌，再看日志里谁打出过 ♠3/♠A；实在找不到就按地主座位顺序兜底
  const landlordCardOwner = (rank: 14 | 16): number | null => {
    for (const player of game.players) {
      if (player.hand.some((card) => card.rank === rank && card.suit === 4)) return player.seat;
    }
    for (let index = game.log.length - 1; index >= 0; index -= 1) {
      const event = game.log[index];
      if (event?.t === 'PLAY' && event.cards.some((card) => card.rank === rank && card.suit === 4)) {
        return event.seat;
      }
    }
    return null;
  };
  const ownerA = landlordCardOwner(14);
  const owner3 = landlordCardOwner(16);
  const identityOf = (seat: number): string => {
    if (game.doubleSeat === seat) return '♠3♠A';
    if (!game.landlordSeats.includes(seat)) return '-';
    const marks: string[] = [];
    if (owner3 === seat) marks.push('♠3');
    if (ownerA === seat) marks.push('♠A');
    if (marks.length === 0) {
      // 兜底：非双地两个地主座位里，靠前的当 ♠3、靠后的当 ♠A
      const order = [...game.landlordSeats].sort((a, b) => a - b);
      return order[0] === seat ? '♠3' : '♠A';
    }
    return marks.join('');
  };
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
      identityText: identityOf(player.seat),
      gain: gainOf(player.seat),
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

// ---------------------------------------------------------------------------
// 横屏斗地主界面的派生数据
// ---------------------------------------------------------------------------

/** 某座位在本墩（trickNo）里的最后一次动作：出牌 / 不出 / 无 */
export type SeatTrickAction = { kind: 'PLAY'; cards: Card[] } | { kind: 'PASS' };

export function getSeatTrickAction(game: GameState, seat: number): SeatTrickAction | null {
  // 用户 2026-11-16：某家打出的牌/「不出」要一直留着，直到下一次轮到他出牌（不再按「墩」清空）
  for (let index = game.log.length - 1; index >= 0; index -= 1) {
    const event = game.log[index];
    if (event === undefined) continue;
    if (event.t !== 'PLAY' && event.t !== 'PASS') continue;
    if (event.seat !== seat) continue;
    return event.t === 'PLAY' ? { kind: 'PLAY', cards: event.cards } : { kind: 'PASS' };
  }
  return null;
}

/** 该座位的地主身份是否已公开（明牌 / 打出过 ♠3 或 ♠A / 已结算） */
export function isLandlordPublic(game: GameState, seat: number): boolean {
  if (game.phase === 'SETTLE') return game.landlordSeats.includes(seat);
  if (game.revealedSeat === seat) return true;
  return game.log.some(
    (event) => event.t === 'PLAY' && event.seat === seat && event.cards.some((card) => isLandlordCard(card)),
  );
}

/** 打完的名次 → 金银铜牌（1/2/3），第 4 名没有奖牌 */
export function getMedal(game: GameState, seat: number): 1 | 2 | 3 | null {
  const rank = game.players[seat]?.rank ?? null;
  if (rank === 1 || rank === 2 || rank === 3) return rank;
  return null;
}

/** 「自己」是哪个座位：测试时可以手动切视角，否则跟着当前行动者 */
export function getSelfSeat(game: GameState, viewSeat: number | null): number {
  if (viewSeat !== null) return viewSeat;
  return getActiveSeat(game) ?? game.firstSeat ?? 0;
}

/** 「轮到谁」的短提示（横屏顶部小字） */
export function getTurnLabel(game: GameState): string {
  if (game.phase !== 'PLAYING') {
    switch (game.phase) {
      case 'REVEAL':
        return '等待明牌决策';
      case 'SUPPLY':
        return '供牌 / 回牌';
      case 'LOCK_WINDOW':
        return '等待锁定表态';
      case 'SETTLE':
        return '本局结束';
      default:
        return '发牌中';
    }
  }
  const active = getActiveSeat(game);
  const label = active === null ? '' : getSeatLabel(active);
  if (game.isFirstPlay) return `轮到 ${label} 领出`;
  return `轮到 ${label} 出牌`;
}

// ---------------------------------------------------------------------------
// 供牌 / 回牌流程（桌面内嵌 + 动画用）
// ---------------------------------------------------------------------------

export interface PlannedSupply {
  losers: { seat: number; label: string; cards: Card[] }[];
  winners: number[];
  amountPerLoser: number;
  total: number;
  revealed: boolean;
}

/**
 * 本局「将要供哪些牌」：发牌后、供牌执行前（REVEAL 或 SUPPLY/CHECK）就能先把输家要交的牌标上颜色。
 * 供牌已经执行后（COLLECT 之后）不再适用，返回 null。
 */
export function getPlannedSupply(game: GameState): PlannedSupply | null {
  const debt = game.pendingDebt;
  if (debt === null || game.revealedSeat !== null) return null;
  const beforeSupply =
    game.phase === 'REVEAL' || (game.phase === 'SUPPLY' && game.supplyContext?.step === 'CHECK');
  if (!beforeSupply) return null;

  const losers = debt.losers.map((seat) => ({
    seat,
    label: getSeatLabel(seat),
    cards: sortHandDesc(eligibleCards(game.players[seat]?.hand ?? [])).slice(0, debt.amountPerLoser),
  }));
  if (losers.some((row) => row.cards.length < debt.amountPerLoser)) return null;

  return {
    losers,
    winners: debt.winners,
    amountPerLoser: debt.amountPerLoser,
    total: debt.total,
    revealed: debt.revealed,
  };
}

/** 供牌流向（输家 → 赢家），用于飞牌动画 */
export function getSupplyTransfers(game: GameState): { from: number; to: number; card: Card }[] {
  return game.supplyContext?.transfers ?? [];
}

/** 供来的牌 id（正式开始前标色用） */
export function getSupplyGainedIds(game: GameState): number[] {
  return game.supplyGainedIds;
}

/** 现在是否处于「正式开始之前」——供来的牌需要标色 */
export function shouldTintSupply(game: GameState): boolean {
  return game.phase === 'SUPPLY' || game.phase === 'LOCK_WINDOW';
}

export interface ReturnSelectState {
  winner: number;
  label: string;
  required: number;
  hand: Card[];
  tintedIds: number[];
  submitted: boolean;
}

/** 当前正在选回牌的赢家（没有则 null） */
export function getReturnSelectState(game: GameState): ReturnSelectState | null {
  const context = game.supplyContext;
  const debt = game.pendingDebt;
  if (context === null || debt === null || context.step !== 'RETURN_SELECT') return null;
  const winner = debt.winners.find((seat) => !context.returns.has(seat));
  if (winner === undefined) return null;
  return {
    winner,
    label: getSeatLabel(winner),
    required: context.perWinner.get(winner) ?? 0,
    hand: sortHandDesc(game.players[winner]?.hand ?? []),
    tintedIds: game.supplyGainedIds,
    submitted: false,
  };
}

export interface PickState {
  picker: number;
  pickerLabel: string;
  pool: Card[];
  /** 各输家还要挑几张（挑满 13 张为止） */
  rows: { seat: number; label: string; remaining: number }[];
  /** 双地明牌输（1 个输家、要挑 12 张）→ 跳过手动挑选，倒计时结束后整批转过去 */
  autoMode: boolean;
}

/** 当前挑回牌的阶段信息（没有则 null） */
export function getPickState(game: GameState): PickState | null {
  const context = game.supplyContext;
  const debt = game.pendingDebt;
  if (context === null || debt === null || context.step !== 'RETURN_PICK') return null;
  const picker = currentReturnPicker(game);
  if (picker === null) return null;
  const rows = debt.losers.map((seat) => ({
    seat,
    label: getSeatLabel(seat),
    remaining: Math.max(0, 13 - (game.players[seat]?.hand.length ?? 13)),
  }));
  return {
    picker,
    pickerLabel: getSeatLabel(picker),
    pool: context.returnPool,
    rows,
    autoMode: debt.losers.length === 1 && debt.amountPerLoser >= 12,
  };
}

/** 供牌/回牌阶段的桌面中央大提示 */
export function getSupplyStageText(game: GameState): string {
  if (game.phase === 'REVEAL') return '供牌倒计时';
  if (game.phase === 'LOCK_WINDOW') return '锁定窗口';
  const step = game.supplyContext?.step;
  if (game.phase !== 'SUPPLY' || step === undefined) return '供牌';
  switch (step) {
    case 'CHECK':
      return '供牌检查';
    case 'COLLECT':
      return '供牌';
    case 'DISTRIBUTE':
      return '供牌';
    case 'RETURN_SELECT':
      return '回牌';
    case 'RETURN_PICK':
      return '挑选回牌';
    default:
      return '供牌';
  }
}



// ---------------------------------------------------------------------------
// 回牌（同步）：所有赢家各自回牌，可以切视角操作任意没交牌的人
// ---------------------------------------------------------------------------

export interface ReturnSeatRow {
  seat: number;
  label: string;
  /** 需要返还几张 */
  required: number;
  /** 是否已经交过 */
  done: boolean;
}

export interface ReturnState {
  seats: ReturnSeatRow[];
  /** 已提交的回牌（公开） */
  returned: { seat: number; label: string; cards: Card[] }[];
}

/** 回牌阶段：每个赢家各自要交几张、交没交；UI 用它决定显示谁的手牌/谁能操作 */
export function getReturnState(game: GameState): ReturnState | null {
  const context = game.supplyContext;
  const debt = game.pendingDebt;
  if (context === null || debt === null || context.step !== 'RETURN_SELECT') return null;
  return {
    seats: debt.winners.map((seat) => ({
      seat,
      label: getSeatLabel(seat),
      required: context.perWinner.get(seat) ?? 0,
      done: context.returns.has(seat),
    })),
    returned: [...context.returns.entries()].map(([seat, cards]) => ({
      seat,
      label: getSeatLabel(seat),
      cards,
    })),
  };
}
