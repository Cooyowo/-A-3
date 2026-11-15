import {
  cmpCard,
  holderOf,
  isEligibleForSupply,
  maxCard,
  removeCards,
  sortDesc,
  type Card,
} from './cards';
import { FIRST_CARD, type Debt, type GameState, type Result } from './types';
import { rankScore } from './teams';

/** 不以 ♠3 / ♠A 作为供牌/回牌（《玩法说明》7.3 / 7.5） */
export function eligibleCards(hand: readonly Card[]): Card[] {
  return hand.filter(isEligibleForSupply);
}

/**
 * CHECK：本局债务每个输家都能交够张数（排除 ♠3/♠A 后仍够）。
 * 只可能失败的场景：双地明牌输、欠 12 张、下局又是双地（最多只有 11 张可交）。
 */
export function checkSupplyPossible(state: GameState, debt: Debt): boolean {
  for (const seat of debt.losers) {
    const player = state.players[seat];
    if (player === undefined) return false;
    if (eligibleCards(player.hand).length < debt.amountPerLoser) return false;
  }
  return true;
}

/**
 * COLLECT：每个输家自动交出「最大的 N 张合法牌」（排除 ♠3/♠A），
 * 从各自手牌移除，汇总成供牌池（池按从大到小排序）。
 *
 * 直接修改 `state.players[*].hand`（引擎内部约定，调用方负责先克隆状态）。
 */
export function collectSupply(
  state: GameState,
  debt: Debt,
): { pool: Card[]; perLoser: Map<number, Card[]> } {
  const pool: Card[] = [];
  const perLoser = new Map<number, Card[]>();

  for (const seat of debt.losers) {
    const player = state.players[seat];
    if (player === undefined) {
      throw new Error(`collectSupply：座位 ${seat} 不存在`);
    }
    const picked = sortDesc(eligibleCards(player.hand)).slice(0, debt.amountPerLoser);
    if (picked.length < debt.amountPerLoser) {
      // 正常流程由 checkSupplyPossible 拦住，走到这里说明不变量被破坏（Q-051）
      throw new Error(
        `collectSupply：座位 ${seat} 可交的牌不足（需要 ${debt.amountPerLoser} 张，只有 ${picked.length} 张）`,
      );
    }
    perLoser.set(seat, picked);
    player.hand = removeCards(player.hand, picked);
    pool.push(...picked);
  }

  pool.sort((a, b) => cmpCard(b, a));
  return { pool, perLoser };
}

/** 某个赢家在本局结算口径下的得分（决定分供牌的先后） */
function doubleWinnerScore(state: GameState, seat: number): number {
  const rank = state.players[seat]?.rank ?? null;
  if (state.landlordSeats.includes(seat)) {
    // 双地 L：拿到第 1/2 名得 2 分，否则 0 分（《玩法说明》6.3）
    return rank !== null && rank <= 2 ? 2 : 0;
  }
  // 双地 F：拿到第 1/2 名得 1 分，否则 0 分（提前锁定的 F 是 0 分）
  return rank !== null && rank <= 2 ? 1 : 0;
}

/** 分供牌时用的「得分」：非双地用名次分 3/2/1/0，双地用 6.3 的计分口径 */
function winnerScore(state: GameState, seat: number, mode: Debt['mode']): number {
  if (mode === 'DOUBLE') return doubleWinnerScore(state, seat);
  return rankScore(state.players[seat]?.rank ?? null);
}

/** 分供牌时的同分 tie-break：名次靠前优先，未定名次排最后 */
function winnerRankOrder(state: GameState, seat: number): number {
  return state.players[seat]?.rank ?? 5;
}

/**
 * DISTRIBUTE：赢家按「得分高优先、同分名次靠前」轮流拿供牌池里当前最大的牌，
 * 分配结果直接进各自手牌；返回每个赢家收到的张数。
 *
 * 池已从大到小（collectSupply 的输出）；这里防御性地再排一次，保证调用方传乱序也不出错。
 * 轮流分配等价于 Q-038 的「base + 前 remainder 个多拿 1 张」。
 */
export function distributeSupply(
  state: GameState,
  pool: readonly Card[],
  debt: Debt,
): Map<number, number> {
  const perWinner = new Map<number, number>();
  const winners = [...debt.winners];
  if (winners.length === 0) return perWinner;

  // 得分高优先；同分按名次靠前；再并列（理论上不可达）按座位号升序（Q-011/Q-037）
  const order = winners.sort((a, b) => {
    const byScore = winnerScore(state, b, debt.mode) - winnerScore(state, a, debt.mode);
    if (byScore !== 0) return byScore;
    const byRank = winnerRankOrder(state, a) - winnerRankOrder(state, b);
    if (byRank !== 0) return byRank;
    return a - b;
  });
  for (const seat of order) perWinner.set(seat, 0);

  const supplyPool = sortDesc(pool);
  supplyPool.forEach((card, index) => {
    const seat = order[index % order.length] as number;
    const player = state.players[seat];
    if (player === undefined) {
      throw new Error(`distributeSupply：座位 ${seat} 不存在`);
    }
    player.hand.push(card);
    perWinner.set(seat, (perWinner.get(seat) ?? 0) + 1);
  });

  return perWinner;
}

/**
 * 回牌挑选顺序：按各输家「上交的最大牌」从大到小（并列按花色，见 open-questions Q-011）。
 * `cmpCard` 点数相同比花色（♠>♥>♣>♦），因此 4~10 同点数的并列也能唯一确定先后。
 * 完全并列（理论不可能）按座位号升序兜底。
 */
export function pickReturnOrder(perLoser: Map<number, Card[]>): number[] {
  const entries = [...perLoser.entries()].map(([seat, supplied]) => ({
    seat,
    top: maxCard(supplied),
  }));

  entries.sort((a, b) => {
    if (a.top !== null && b.top !== null) {
      const byCard = cmpCard(b.top, a.top);
      if (byCard !== 0) return byCard;
    } else if (a.top !== null) {
      return -1;
    } else if (b.top !== null) {
      return 1;
    }
    return a.seat - b.seat;
  });

  return entries.map((entry) => entry.seat);
}

/**
 * 回牌超时 / 自动：从合法牌（排除 ♠3/♠A）里取最小的 count 张（Q-041）。
 * 返回顺序为从小到大；合法牌不足时返回全部合法牌（正常流程不会发生，Q-044）。
 */
export function defaultReturnCards(hand: readonly Card[], count: number): Card[] {
  if (count <= 0) return [];
  const eligible = eligibleCards(hand).sort((a, b) => cmpCard(a, b));
  return eligible.slice(0, Math.min(count, eligible.length));
}

/** 取下一个空名次槽（1..4），跳过已被占用的名次（含提前锁定占用的 3） */
function nextFreeRank(state: GameState): number {
  while (state.nextRankSlot <= 4 && state.rankTaken[state.nextRankSlot] === true) {
    state.nextRankSlot += 1;
  }
  return state.nextRankSlot;
}

/**
 * 非双地提前结束时，给还没出完的人补名次（按剩余手牌数从少到多，文档 §10.1）。
 * 手牌数相同按座位号升序（Q-064）。
 * 直接修改传入的 state.players / rankTaken / nextRankSlot。已 out 的人不改。
 */
export function assignRemainingRanks(state: GameState): void {
  const rest = state.players
    .filter((player) => !player.out)
    .sort((a, b) => a.hand.length - b.hand.length || a.seat - b.seat);

  for (const player of rest) {
    const rank = nextFreeRank(state);
    if (rank > 4) break; // 名次槽用尽（正常对局不会发生）
    player.rank = rank;
    state.rankTaken[rank] = true;
  }
}

/** 双地 F 赢时，3 个 F 的展示/分牌顺序：得分高的先、同分名次靠前、锁定者（0 分）最后（Q-049） */
function orderDoubleWinners(state: GameState, seats: readonly number[]): number[] {
  return [...seats].sort((a, b) => {
    const byScore = doubleWinnerScore(state, b) - doubleWinnerScore(state, a);
    if (byScore !== 0) return byScore;
    const byRank = winnerRankOrder(state, a) - winnerRankOrder(state, b);
    if (byRank !== 0) return byRank;
    return a - b;
  });
}

/**
 * 结算（《开发文档》10.2 / 《玩法说明》第 6 节）。
 *
 * - 双地：L 拿到名次 <=2 → lScore=2，否则 0；F 里名次<=2 的每人 1 分；没有平局。
 *   双地不补名次：未走完的人 rank 保持 null，不计分。
 * - 非双地：先 assignRemainingRanks 补齐未出完者名次，再按 3/2/1/0 求和。
 * - scoreDiff = |lScore - fScore|（4 大赢 / 2 小赢 / 0 平局）。
 * - winnerSeats / loserSeats 必须包含该方全部成员（含提前锁定者、双地时含锁定的 F：Q-049）。
 * - 平局没有胜负方，winnerSeats / loserSeats 均为空（供牌由 buildDebt 返回 null）。
 */
export function computeResult(state: GameState): Result {
  const landlordSeats = [...state.landlordSeats].sort((a, b) => a - b);
  const fSeats = state.players
    .filter((player) => !landlordSeats.includes(player.seat))
    .map((player) => player.seat);

  // -------------------------------------------------------------------------
  // 双地（1 打 3）
  // -------------------------------------------------------------------------
  if (landlordSeats.length === 1) {
    const lSeat = landlordSeats[0] as number;
    const lRank = state.players[lSeat]?.rank ?? null;
    const lScore = lRank !== null && lRank <= 2 ? 2 : 0;
    const fTopSeats = fSeats.filter((seat) => {
      const rank = state.players[seat]?.rank ?? null;
      return rank !== null && rank <= 2;
    });
    const fScore = fTopSeats.length;

    if (fScore > lScore) {
      // F 赢：全部 F 都是赢家（含提前锁定者，Q-049/C-03）
      return {
        mode: 'DOUBLE',
        lScore,
        fScore,
        winnerSeats: orderDoubleWinners(state, fSeats),
        loserSeats: [...landlordSeats],
        draw: false,
      };
    }
    return {
      mode: 'DOUBLE',
      lScore,
      fScore,
      winnerSeats: [...landlordSeats],
      loserSeats: [...fSeats],
      draw: false,
    };
  }

  // -------------------------------------------------------------------------
  // 非双地（2 打 2）
  // -------------------------------------------------------------------------
  assignRemainingRanks(state);

  const lScore = landlordSeats.reduce(
    (sum, seat) => sum + rankScore(state.players[seat]?.rank ?? null),
    0,
  );
  const fScore = fSeats.reduce((sum, seat) => sum + rankScore(state.players[seat]?.rank ?? null), 0);
  const scoreDiff = Math.abs(lScore - fScore);

  if (lScore === fScore) {
    return {
      mode: 'NORMAL',
      lScore,
      fScore,
      scoreDiff,
      winnerSeats: [],
      loserSeats: [],
      draw: true,
    };
  }

  const landlordWins = lScore > fScore;
  return {
    mode: 'NORMAL',
    lScore,
    fScore,
    scoreDiff,
    winnerSeats: landlordWins ? [...landlordSeats] : [...fSeats],
    loserSeats: landlordWins ? [...fSeats] : [...landlordSeats],
    draw: false,
  };
}

/**
 * 生成下一局债务（《玩法说明》7.2 / Q-005 / Q-049 / Q-075）。
 * - 平局 → null
 * - 非双地：大赢（diff 4）每人 2 张，小赢（diff 2）每人 1 张
 * - 双地：总计 6 张（未明牌）或 12 张（明牌），平分给输方所有人
 *
 * 「明牌翻倍」只读本局 `state.revealedSeat`（Q-087）；上一局债务是否作废由 state 层处理。
 */
export function buildDebt(state: GameState, result: Result): Debt | null {
  if (result.draw) return null;

  const winners = [...result.winnerSeats];
  const losers = [...result.loserSeats];

  if (result.mode === 'NORMAL') {
    if (result.scoreDiff !== 4 && result.scoreDiff !== 2) {
      throw new Error(`buildDebt：非双地比分差 ${result.scoreDiff} 不合法（只可能是 4 / 2）`);
    }
    const amountPerLoser = result.scoreDiff === 4 ? 2 : 1;
    return {
      winners,
      losers,
      amountPerLoser,
      total: amountPerLoser * losers.length,
      revealed: false,
      mode: 'NORMAL',
    };
  }

  const revealed = state.revealedSeat !== null;
  const total = revealed ? 12 : 6;
  if (losers.length === 0) {
    throw new Error('buildDebt：双地结算没有输家');
  }
  if (total % losers.length !== 0) {
    // Q-084：生成时断言必须整除（当前结算表：6 或 12 分给 3 个 F 或 1 个 L）
    throw new Error(`buildDebt：${total} 张供牌无法平分给 ${losers.length} 个输家`);
  }
  return {
    winners,
    losers,
    amountPerLoser: total / losers.length,
    total,
    revealed,
    mode: 'DOUBLE',
  };
}

/**
 * 本局首发（《玩法说明》5.2 / 7.7 / Q-011 / Q-015）。
 * 优先级：明牌者 → 供牌上交最大牌者（state.firstSeatBySupply）→ ♦4 持有者。
 * 若解析出的座位已 out（提前锁定成功，Q-015），从该座位下家起找第一个仍在场的人。
 *
 * 下家约定：座位号 +1（逆时针方向），越过 3 回到 0。
 * 找不到（全部 out / 没有 ♦4 且无前两级依据）返回 -1；正常对局不会发生。
 */
export function resolveFirstSeat(state: GameState): number {
  let seat: number;
  if (state.revealedSeat !== null) {
    seat = state.revealedSeat; // 1. 明牌者
  } else if (state.firstSeatBySupply !== null) {
    seat = state.firstSeatBySupply; // 2. 供牌上交最大牌者
  } else {
    seat = holderOf(
      state.players.map((player) => player.hand),
      FIRST_CARD,
    ); // 3. ♦4 持有者
  }

  if (seat < 0 || seat >= state.players.length) return -1;
  if (state.players[seat]?.out !== true) return seat;

  // Q-015：首发者本局锁定成功（out）→ 从他下家起找第一个仍在场的人
  for (let step = 1; step <= state.players.length; step += 1) {
    const next = (seat + step) % state.players.length;
    if (state.players[next]?.out !== true) return next;
  }
  return -1;
}
