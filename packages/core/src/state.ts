import type { Card, Rng } from './cards';
import {
  cmpCard,
  containsCards,
  dealHands,
  isLandlordCard,
  removeCards,
} from './cards';
import { validatePlay } from './legality';
import { identifyPattern } from './patterns';
import {
  buildDebt,
  checkSupplyPossible,
  collectSupply,
  computeResult,
  distributeSupply,
  pickReturnOrder,
  resolveFirstSeat,
} from './settle';
import { activeSeats, computeIdentity, lockEligible } from './teams';
import { MAX_REDEAL } from './types';
import type { Action, GameState, Phase, PlayerState, Result, SupplyContext } from './types';

/**
 * 状态机（《开发文档》第 7 节 + open-questions 已确认口径）。
 *
 * 阶段流转：
 *   DEAL → REVEAL（仅当存在双地玩家）→ SUPPLY（仅当有 pendingDebt 且未明牌）
 *        → LOCK_WINDOW → PLAYING → SETTLE → （下一局）DEAL
 *
 * 约定（重要，三处实现必须一致）：
 * - **纯函数**：`applyAction` / `resolveLockWindow` / `nextHand` 一律不修改入参，
 *   内部先 `cloneState` 再改，最后返回新状态。
 * - **不发牌自己随机**：随机源由调用方注入 `rng`。
 * - **不作时间判断**：锁定窗口、明牌超时、回牌超时都由调用方（服务端计时器 / 热座按钮）决定后
 *   再调 `resolveLockWindow` / 对应 Action，引擎只处理「已经发生的决定」。
 *
 * 补充（M1 实现说明）：
 * - `applyAction` 的 REDEAL 需要重新洗牌发牌，但骨架签名没有 rng。这里增加**可选第 4 参** `rng`：
 *   调用方不传时用一个「由当前状态派生种子」的确定性伪随机源（同状态 + 同动作序列 → 同结果，
 *   保证回归可复现；见 Q-081 的可回放要求）。3 参调用保持兼容。
 */

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function playerAt(state: GameState, seat: number): PlayerState {
  const player = state.players[seat];
  if (player === undefined) throw new Error(`座位号非法：${seat}`);
  return player;
}

function isTripleLike(pattern: { type: string }): boolean {
  return pattern.type === 'TRIPLE' || pattern.type === 'TRIPLE_ONE';
}

/**
 * 当前是否处于「领出」。
 * 常规：topPattern === null；三条阶段内一墩已结束时会保留基准牌，
 * 此时 currentSeat === topSeat 表示由最后出牌者继续领出（Q-023）。
 */
function isLeading(state: GameState): boolean {
  if (state.topPattern === null) return true;
  return state.threePhase && state.topSeat !== null && state.currentSeat === state.topSeat;
}

/** 下家（逆时针，方向固定为 seat + 1，与 settle.resolveFirstSeat 的 Q-015 口径一致） */
function nextActiveSeat(state: GameState, from: number): number {
  for (let step = 1; step <= state.players.length; step += 1) {
    const seat = (from + step) % state.players.length;
    if (playerAt(state, seat).out !== true) return seat;
  }
  throw new Error('没有仍在场的玩家可以接替出牌');
}

/** 下一个空名次槽（1..4），跳过已被占用的名次（含提前锁定占用的第 3 名） */
function nextFreeRank(state: GameState): number {
  let slot = state.nextRankSlot;
  while (slot <= 4 && state.rankTaken[slot] === true) slot += 1;
  state.nextRankSlot = slot;
  return slot;
}

function emptySupplyContext(): SupplyContext {
  return {
    step: 'CHECK',
    pool: [],
    returnPool: [],
    perLoser: new Map<number, Card[]>(),
    perWinner: new Map<number, number>(),
    biggestCardByLoser: new Map<number, Card>(),
    returns: new Map<number, Card[]>(),
  };
}

function cloneSupplyContext(context: SupplyContext | null): SupplyContext | null {
  if (context === null) return null;
  const perLoser = new Map<number, Card[]>();
  for (const [seat, cards] of context.perLoser) perLoser.set(seat, [...cards]);
  const returns = new Map<number, Card[]>();
  for (const [seat, cards] of context.returns) returns.set(seat, [...cards]);
  return {
    step: context.step,
    pool: [...context.pool],
    returnPool: [...context.returnPool],
    perLoser,
    perWinner: new Map(context.perWinner),
    biggestCardByLoser: new Map(context.biggestCardByLoser),
    returns,
  };
}

function cloneResult(result: Result | null): Result | null {
  if (result === null) return null;
  if (result.mode === 'NORMAL') {
    return {
      ...result,
      winnerSeats: [...result.winnerSeats],
      loserSeats: [...result.loserSeats],
    };
  }
  return {
    ...result,
    winnerSeats: [...result.winnerSeats],
    loserSeats: [...result.loserSeats],
  };
}

/** 复制债务对象（避免跨局共享可变引用） */
function cloneDebt(debt: GameState['pendingDebt']): GameState['pendingDebt'] {
  if (debt === null) return null;
  return { ...debt, winners: [...debt.winners], losers: [...debt.losers] };
}

/** mulberry32（与测试 helpers 同算法），用于 REDEAL 的兜底随机源 */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由当前状态派生确定性种子（含 handNo / redealCount / 手牌 id），保证 REDEAL 可复现 */
function fallbackRng(state: GameState): Rng {
  let hash = 2166136261;
  hash = Math.imul(hash ^ state.handNo, 16777619);
  hash = Math.imul(hash ^ state.redealCount, 16777619);
  for (const player of state.players) {
    for (const card of player.hand) {
      hash = Math.imul(hash ^ card.id, 16777619);
    }
  }
  return mulberry32(hash >>> 0);
}

/** 复制状态（深拷贝，含 Map/数组；Card 是只读对象可以共享引用） */
export function cloneState(state: GameState): GameState {
  const players: PlayerState[] = state.players.map((player) => ({
    seat: player.seat,
    hand: [...player.hand],
    out: player.out,
    locked: player.locked,
    rank: player.rank,
  }));

  return {
    ...state,
    players,
    landlordSeats: [...state.landlordSeats],
    pendingDebt: cloneDebt(state.pendingDebt),
    supplyContext: cloneSupplyContext(state.supplyContext),
    topPattern:
      state.topPattern === null ? null : { ...state.topPattern, cards: [...state.topPattern.cards] },
    publicCards: [...state.publicCards],
    finishOrder: [...state.finishOrder],
    rankTaken: [...state.rankTaken],
    lockIntents: new Map(state.lockIntents),
    result: cloneResult(state.result),
    log: [...state.log],
  };
}

// ---------------------------------------------------------------------------
// 开局
// ---------------------------------------------------------------------------

/**
 * 开新局（DEAL 阶段）：洗牌发牌 → 计算身份 → 进入 REVEAL 或 SUPPLY。
 *
 * - handNo = 1，phase = 'DEAL'，其余字段重置（含 lockIntents、rankTaken、finishOrder…）。
 * - 若存在双地玩家 → phase = 'REVEAL'；否则 → phase = 'SUPPLY'。
 * - pendingDebt 由调用方传入（首局为 null）。
 */
export function createGame(
  rng: Rng,
  options?: { pendingDebt?: GameState['pendingDebt']; handNo?: number },
): GameState {
  const handNo = options?.handNo ?? 1;
  const pendingDebt = cloneDebt(options?.pendingDebt ?? null);
  const hands = dealHands(rng);

  const players: PlayerState[] = [0, 1, 2, 3].map((seat) => ({
    seat,
    hand: [...(hands[seat] ?? [])],
    out: false,
    locked: false,
    rank: null,
  }));

  const { landlordSeats, doubleSeat } = computeIdentity(players);

  const state: GameState = {
    handNo,
    phase: doubleSeat !== null ? 'REVEAL' : 'SUPPLY',
    players,
    landlordSeats: [...landlordSeats],
    doubleSeat,
    revealedSeat: null,
    pendingDebt,
    supplyContext: null,
    firstSeat: null,
    firstSeatBySupply: null,
    currentSeat: doubleSeat ?? 0,
    topPattern: null,
    topSeat: null,
    threePhase: false,
    isFirstPlay: true,
    passesSinceLastPlay: 0,
    publicCards: [],
    finishOrder: [],
    nextRankSlot: 1,
    rankTaken: [false, false, false, false, false],
    redealCount: 0,
    lockIntents: new Map<number, boolean>(),
    result: null,
    log: [{ t: 'DEAL', handNo }],
  };

  return autoAdvance(state);
}

// ---------------------------------------------------------------------------
// 自动推进
// ---------------------------------------------------------------------------

/** 供牌自动收集：清空供牌池数据、写日志、公开牌、算 firstSeatBySupply，然后进入 DISTRIBUTE */
function doCollect(state: GameState, context: SupplyContext): void {
  const debt = state.pendingDebt;
  if (debt === null) throw new Error('供牌阶段缺少债务');

  const { pool, perLoser } = collectSupply(state, debt);

  context.pool = pool;
  context.perLoser = new Map<number, Card[]>();

  for (const [seat, cards] of perLoser) {
    const player = playerAt(state, seat);
    // collectSupply 已从手牌移除；这里再做一次幂等清理，防止依赖实现细节
    player.hand = removeCards(player.hand, cards);
    context.perLoser.set(seat, [...cards]);
    state.log.push({ t: 'SUPPLY', from: seat, cards: [...cards] });
  }

  for (const card of pool) state.publicCards.push(card.id);

  // 首发：上交牌最大的输家（并列口径见 Q-011 / pickReturnOrder）
  state.firstSeatBySupply = pickReturnOrder(context.perLoser)[0] ?? null;

  context.step = 'DISTRIBUTE';
}

/** 供牌自动分配：分给赢家、写日志，然后按是否需要回牌进入 RETURN_SELECT / DONE */
function doDistribute(state: GameState, context: SupplyContext): void {
  const debt = state.pendingDebt;
  if (debt === null) throw new Error('供牌阶段缺少债务');

  // 记录分配前各赢家手牌，用于生成 DISTRIBUTE 事件里的具体牌
  const before = new Map<number, Set<number>>();
  for (const seat of debt.winners) {
    before.set(seat, new Set(playerAt(state, seat).hand.map((card) => card.id)));
  }

  const gained = distributeSupply(state, context.pool, debt);

  context.perWinner = new Map<number, number>();
  let total = 0;
  for (const seat of debt.winners) {
    const count = gained.get(seat) ?? 0;
    context.perWinner.set(seat, count);
    total += count;
    const known = before.get(seat) ?? new Set<number>();
    const received = playerAt(state, seat).hand.filter((card) => !known.has(card.id));
    state.log.push({ t: 'DISTRIBUTE', to: seat, cards: received });
  }
  for (const [seat, count] of gained) {
    if (!context.perWinner.has(seat)) context.perWinner.set(seat, count);
  }

  context.step = total > 0 ? 'RETURN_SELECT' : 'DONE';
}

/**
 * 当前该挑回牌的输家（按上交最大牌从大到小**轮流**挑，Q-039 / §7.5）。
 *
 * 每个输家上交的张数相同（`Debt.amountPerLoser`），因此可以按「已挑总数 % 输家数」定位轮次：
 * 已挑总数 = 供牌总张数 - 回牌池剩余张数。手牌 13 张即挑满。
 */
function pickerRoundRobin(state: GameState, context: SupplyContext): number | null {
  const order = pickReturnOrder(context.perLoser);
  if (order.length === 0) return null;

  let totalSupplied = 0;
  for (const cards of context.perLoser.values()) totalSupplied += cards.length;
  const picksDone = totalSupplied - context.returnPool.length;
  const index = ((picksDone % order.length) + order.length) % order.length;

  const candidate = order[index];
  if (candidate !== undefined && playerAt(state, candidate).hand.length < 13) return candidate;

  // 防御：轮次定位失败时退化为「按顺序找第一个还没挑满的输家」
  for (const seat of order) {
    if (playerAt(state, seat).hand.length < 13) return seat;
  }
  return null;
}

/** 当前该挑回牌的输家（对外暴露给服务端 / 热座 UI；非 RETURN_PICK 时返回 null） */
export function currentReturnPicker(state: GameState): number | null {
  if (state.phase !== 'SUPPLY' || state.supplyContext === null) return null;
  if (state.supplyContext.step !== 'RETURN_PICK') return null;
  return pickerRoundRobin(state, state.supplyContext);
}

/**
 * 推动流程到下一个「等待玩家输入」的点（幂等，可多次调用）：
 *
 * 1. phase === 'REVEAL' && doubleSeat === null → 进入 SUPPLY；
 * 2. phase === 'REVEAL' && 已有明牌/不明牌结论 → 进入 SUPPLY；
 * 3. phase === 'SUPPLY'：
 *    - `pendingDebt === null` 或已明牌 → 直接进 LOCK_WINDOW；
 *    - step === 'CHECK'：若 checkSupplyPossible 为 false，等待该玩家在 REVEAL/SUPPLY 里
 *      发 `REVEAL` 或 `REDEAL`（不自动推进）；否则 → COLLECT；
 *    - step === 'COLLECT' → 自动收供牌、算 firstSeatBySupply → DISTRIBUTE；
 *    - step === 'DISTRIBUTE' → 自动分配 → RETURN_SELECT（若无需回牌则直接 DONE）；
 *    - step === 'RETURN_SELECT' → 等赢家提交 RETURN_CARDS；
 *    - step === 'RETURN_PICK' → 等输家提交 PICK_RETURN；
 *    - step === 'DONE' → LOCK_WINDOW；
 * 4. phase === 'LOCK_WINDOW' → 等待 `resolveLockWindow`（窗口固定等满 5s，不提前结束 Q-053）；
 * 5. phase === 'PLAYING' 且某座位 out → 轮转跳过（由 applyAction 处理）。
 *
 * 返回可能推进过的状态。
 */
export function autoAdvance(state: GameState): GameState {
  const next = cloneState(state);

  for (let guard = 0; guard < 200; guard += 1) {
    let changed = false;

    switch (next.phase) {
      case 'REVEAL': {
        // 没有双地玩家，或已经做出明牌决定 → 进入供牌阶段
        if (next.doubleSeat === null || next.revealedSeat !== null) {
          next.phase = 'SUPPLY';
          changed = true;
        }
        break;
      }

      case 'SUPPLY': {
        // 无债务 / 已明牌（债务作废）→ 跳过供牌
        if (next.revealedSeat !== null || next.pendingDebt === null) {
          next.phase = 'LOCK_WINDOW';
          changed = true;
          break;
        }

        const context = next.supplyContext ?? emptySupplyContext();
        next.supplyContext = context;

        switch (context.step) {
          case 'CHECK': {
            if (!checkSupplyPossible(next, next.pendingDebt)) {
              // 12 张供不出：等待 REVEAL / REDEAL 二选一（Q-008 / Q-096）
              break;
            }
            context.step = 'COLLECT';
            changed = true;
            break;
          }
          case 'COLLECT': {
            doCollect(next, context);
            changed = true;
            break;
          }
          case 'DISTRIBUTE': {
            doDistribute(next, context);
            changed = true;
            break;
          }
          case 'RETURN_SELECT': {
            const pending = [...context.perWinner.entries()].filter(
              ([seat, count]) => count > 0 && !context.returns.has(seat),
            );
            if (pending.length === 0) {
              const returnPool: Card[] = [];
              for (const cards of context.returns.values()) returnPool.push(...cards);
              context.returnPool = returnPool.sort((a, b) => cmpCard(b, a));
              for (const card of context.returnPool) next.publicCards.push(card.id);
              context.step = context.returnPool.length > 0 ? 'RETURN_PICK' : 'DONE';
              changed = true;
            }
            break;
          }
          case 'RETURN_PICK': {
            if (context.returnPool.length === 0) {
              for (const player of next.players) {
                if (player.hand.length !== 13) {
                  throw new Error(
                    `供牌/回牌结束后座位 ${player.seat} 手牌 ${player.hand.length} 张，应为 13 张`,
                  );
                }
              }
              context.step = 'DONE';
              changed = true;
            } else if (pickerRoundRobin(next, context) === null) {
              throw new Error('回牌池还有牌，但所有输家手牌都已经是 13 张');
            }
            break;
          }
          case 'DONE': {
            // 供牌执行完毕：债务兑现，清空 pendingDebt（Q-036：平局 / 明牌作废 / 供牌完成三种情况）
            next.pendingDebt = null;
            next.phase = 'LOCK_WINDOW';
            changed = true;
            break;
          }
        }
        break;
      }

      default:
        break;
    }

    if (!changed) break;
  }

  return next;
}

// ---------------------------------------------------------------------------
// 明牌 / 重新发牌
// ---------------------------------------------------------------------------

/** 本局供牌是否「必定供不出」（唯一可达场景：双地明牌输欠 12 张、本局又是双地） */
function supplyImpossible(state: GameState): boolean {
  return state.pendingDebt !== null && !checkSupplyPossible(state, state.pendingDebt);
}

/** 明牌（自愿或强制，Q-075 两者完全等同）：公开 ♠3/♠A、作废本局债务 */
function doReveal(state: GameState, seat: number, forced: boolean): void {
  const player = playerAt(state, seat);
  state.revealedSeat = seat;
  state.pendingDebt = null;
  for (const card of player.hand) {
    if (isLandlordCard(card) && !state.publicCards.includes(card.id)) {
      state.publicCards.push(card.id);
    }
  }
  state.log.push({ t: 'REVEALED', seat, forced });
  state.phase = 'SUPPLY';
}

/** 重新发牌（Q-074 / Q-077 / Q-078 / Q-079）：保留 pendingDebt 与 handNo，redealCount +1 */
function doRedeal(state: GameState, rng?: Rng): void {
  const hands = dealHands(rng ?? fallbackRng(state));
  for (let seat = 0; seat < state.players.length; seat += 1) {
    const player = playerAt(state, seat);
    player.hand = [...(hands[seat] ?? [])];
    player.out = false;
    player.locked = false;
    player.rank = null;
  }

  const { landlordSeats, doubleSeat } = computeIdentity(state.players);
  state.landlordSeats = [...landlordSeats];
  state.doubleSeat = doubleSeat;
  state.revealedSeat = null;
  state.supplyContext = null;
  state.firstSeat = null;
  state.firstSeatBySupply = null;
  state.currentSeat = doubleSeat ?? 0;
  state.topPattern = null;
  state.topSeat = null;
  state.threePhase = false;
  state.isFirstPlay = true;
  state.passesSinceLastPlay = 0;
  state.publicCards = [];
  state.finishOrder = [];
  state.nextRankSlot = 1;
  state.rankTaken = [false, false, false, false, false];
  state.lockIntents = new Map<number, boolean>();
  state.result = null;
  state.redealCount += 1;
  state.phase = doubleSeat !== null ? 'REVEAL' : 'SUPPLY';
  state.log.push({ t: 'REDEAL', handNo: state.handNo });
}

// ---------------------------------------------------------------------------
// 应用动作
// ---------------------------------------------------------------------------

function applyPlay(state: GameState, seat: number, cards: readonly Card[]): void {
  const pattern = identifyPattern(cards);
  if (pattern === null) throw new Error('无法识别的牌型');

  const wasFirstPlay = state.isFirstPlay;

  state.topPattern = pattern;
  state.topSeat = seat;
  state.passesSinceLastPlay = 0;

  if (wasFirstPlay) {
    // 只有本局第一手（且由首发打出，已由 validatePlay 保证）是三条/三条夹一才开启阶段
    state.threePhase = isTripleLike(pattern);
    state.isFirstPlay = false;
  } else if (!isTripleLike(pattern)) {
    // 改出其它牌型 → 三条阶段立即结束（Q-023 / Q-029）
    state.threePhase = false;
  }

  const player = playerAt(state, seat);
  player.hand = removeCards(player.hand, cards);
  state.log.push({ t: 'PLAY', seat, cards: [...cards], type: pattern.type });

  if (player.hand.length === 0) {
    finishPlayer(state, seat);
    return;
  }

  state.currentSeat = nextActiveSeat(state, seat);
}

/** 出完最后一手：分配名次；顺风立即结束本墩、结束三条阶段，由下家领出（Q-024 / Q-025） */
function finishPlayer(state: GameState, seat: number): void {
  const player = playerAt(state, seat);
  player.out = true;

  const rank = nextFreeRank(state);
  if (rank > 4) throw new Error('名次槽已用尽，无法分配名次');
  player.rank = rank;
  state.rankTaken[rank] = true;
  state.finishOrder.push(seat);
  state.log.push({ t: 'FINISH', seat, rank });

  // 顺风：本墩立即结束，三条阶段立即结束，topPattern 清空（Q-024）
  state.threePhase = false;
  state.topPattern = null;
  state.passesSinceLastPlay = 0;

  if (isGameOver(state)) {
    state.phase = 'SETTLE';
    state.result = computeResult(state);
    return;
  }

  state.currentSeat = nextActiveSeat(state, seat);
}

function applyPass(state: GameState, seat: number): void {
  if (seat !== state.currentSeat) throw new Error('还没轮到你行动');
  if (isLeading(state)) throw new Error('领出时不能选择不要，必须出牌');

  state.log.push({ t: 'PASS', seat });
  state.passesSinceLastPlay += 1;

  const active = activeSeats(state);
  const topSeatActive =
    state.topSeat !== null && state.players[state.topSeat]?.out !== true ? 1 : 0;
  // Q-021：门限用「其余在场的玩家数」，不依赖 topSeat 一定在场
  const otherActive = active.length - topSeatActive;

  if (state.passesSinceLastPlay >= otherActive) {
    // 本墩结束：最后出牌者领出；三条阶段内保留基准牌（Q-023 / Q-032）
    const leader = state.topSeat;
    if (leader === null) throw new Error('本墩没有出牌者，无法结算');
    state.passesSinceLastPlay = 0;
    if (!state.threePhase) state.topPattern = null;
    state.currentSeat = leader;
    return;
  }

  state.currentSeat = nextActiveSeat(state, seat);
}

/**
 * 应用一个玩家动作（纯函数，不修改入参）。
 *
 * 各阶段接受的 Action：
 * - REVEAL（有双地时）：`REVEAL` = 明牌；`PASS` = 不明牌（超时默认，Q-001）；
 *   `REDEAL` = 重新发牌（只在该局 12 张供不出时由 REVEAL 阶段给出二选一，Q-008）。
 * - SUPPLY：
 *   - step COLLECT 前若 CHECK 失败：`REVEAL`（明牌，债务作废）/ `REDEAL`（重发，≤ MAX_REDEAL，Q-074）；
 *   - step RETURN_SELECT：赢家 `RETURN_CARDS`（张数 = 收到张数，且不能含 ♠3/♠A）；
 *   - step RETURN_PICK：输家 `PICK_RETURN`（从回牌池里挑一张）；
 * - LOCK_WINDOW：`LOCK` / `UNLOCK` 记录意向（Q-056 窗口内可反复切换），窗口结束由 resolveLockWindow 结算；
 * - PLAYING：`PLAY`（必须合法，非法抛错）/ `PASS`（领出时不允许 PASS）。
 * - 其它阶段 / 非该行动的座位 → 抛错（错误信息用中文说明）。
 */
export function applyAction(
  state: GameState,
  seat: number,
  action: Action,
  rng?: Rng,
): GameState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    throw new Error(`座位号非法：${seat}`);
  }

  const next = cloneState(state);

  switch (next.phase) {
    case 'REVEAL': {
      const doubleSeat = next.doubleSeat;
      if (doubleSeat === null) throw new Error('当前阶段不需要明牌决策');
      if (seat !== doubleSeat) throw new Error('只有双地玩家可以决定是否明牌');
      if (next.revealedSeat !== null) throw new Error('本局已经明过牌，不能重复决定');

      if (action.kind === 'REVEAL') {
        // 触达重发上限后的明牌属于「强制明牌」（Q-075）
        const forced = supplyImpossible(next) && next.redealCount >= MAX_REDEAL;
        doReveal(next, seat, forced);
        return autoAdvance(next);
      }

      if (action.kind === 'PASS') {
        // 不明牌（含超时默认，Q-001）→ 进入供牌阶段；供不出时会在 CHECK 停下等二选一
        next.phase = 'SUPPLY';
        return autoAdvance(next);
      }

      if (action.kind === 'REDEAL') {
        if (!supplyImpossible(next)) {
          throw new Error('当前不需要重新发牌（只有 12 张供不出时才能重发）');
        }
        if (next.redealCount >= MAX_REDEAL) {
          throw new Error(`已达重新发牌上限（${MAX_REDEAL} 次），只能选择明牌`);
        }
        doRedeal(next, rng);
        return autoAdvance(next);
      }

      throw new Error('明牌阶段只能选择明牌、不明牌或重新发牌');
    }

    case 'SUPPLY': {
      const context = next.supplyContext;
      if (context === null) throw new Error('当前没有正在执行的供牌流程');

      if (context.step === 'CHECK') {
        if (next.pendingDebt === null) throw new Error('本局没有供牌债务');
        if (checkSupplyPossible(next, next.pendingDebt)) {
          throw new Error('本局供牌可以正常执行，不需要明牌或重新发牌');
        }

        if (action.kind === 'REVEAL') {
          const doubleSeat = next.doubleSeat;
          if (doubleSeat === null || seat !== doubleSeat) {
            throw new Error('只有需要供牌的双地玩家可以明牌');
          }
          const forced = next.redealCount >= MAX_REDEAL;
          doReveal(next, seat, forced);
          return autoAdvance(next);
        }

        if (action.kind === 'REDEAL') {
          const doubleSeat = next.doubleSeat;
          if (doubleSeat === null || seat !== doubleSeat) {
            throw new Error('只有需要供牌的双地玩家可以重新发牌');
          }
          if (next.redealCount >= MAX_REDEAL) {
            throw new Error(`已达重新发牌上限（${MAX_REDEAL} 次），只能选择明牌`);
          }
          doRedeal(next, rng);
          return autoAdvance(next);
        }

        throw new Error('供牌不足时只能选择明牌或重新发牌');
      }

      if (context.step === 'RETURN_SELECT') {
        if (action.kind !== 'RETURN_CARDS') throw new Error('当前需要赢家选择回牌');
        const debt = next.pendingDebt;
        if (debt === null) throw new Error('本局没有供牌债务');
        if (!debt.winners.includes(seat)) throw new Error('只有赢家需要提交回牌');
        if (context.returns.has(seat)) throw new Error('已经提交过回牌，不能重复提交');

        const expected = context.perWinner.get(seat) ?? 0;
        const cards = action.cards;

        if (new Set(cards.map((card) => card.id)).size !== cards.length) {
          throw new Error('回牌中存在重复的牌');
        }
        if (cards.length !== expected) {
          throw new Error(`需要返还 ${expected} 张牌，实际提交了 ${cards.length} 张`);
        }
        for (const card of cards) {
          if (isLandlordCard(card)) throw new Error('不能返还 ♠3 或 ♠A');
        }
        const player = playerAt(next, seat);
        if (!containsCards(player.hand, cards)) throw new Error('回牌的牌不在手上');

        player.hand = removeCards(player.hand, cards);
        context.returns.set(seat, [...cards]);
        next.log.push({ t: 'RETURN', from: seat, cards: [...cards], auto: false });
        return autoAdvance(next);
      }

      if (context.step === 'RETURN_PICK') {
        if (action.kind !== 'PICK_RETURN') throw new Error('当前需要输家挑选回牌');
        const picker = pickerRoundRobin(next, context);
        if (picker === null) throw new Error('当前没有需要挑牌的输家');
        if (seat !== picker) throw new Error(`现在轮到座位 ${picker} 挑回牌`);

        const index = context.returnPool.findIndex((card) => card.id === action.card.id);
        if (index < 0) throw new Error('这张牌不在回牌池里');
        const card = context.returnPool.splice(index, 1)[0] as Card;

        const player = playerAt(next, seat);
        player.hand = [...player.hand, card];
        next.log.push({ t: 'PICK_RETURN', by: seat, card, auto: false });
        return autoAdvance(next);
      }

      throw new Error(`当前供牌步骤（${context.step}）不接受玩家动作`);
    }

    case 'LOCK_WINDOW': {
      if (action.kind === 'LOCK') {
        if (!lockEligible(next, seat)) {
          throw new Error('不符合提前锁定条件（需未出完、手牌 13 张且全部为 4~10）');
        }
        next.lockIntents.set(seat, true);
        return next;
      }
      if (action.kind === 'UNLOCK') {
        next.lockIntents.set(seat, false);
        return next;
      }
      throw new Error('锁定窗口内只能选择「锁定」或「取消锁定」');
    }

    case 'PLAYING': {
      if (seat !== next.currentSeat) throw new Error('还没轮到你行动');

      if (action.kind === 'PLAY') {
        const checked = validatePlay(next, seat, action.cards);
        if (!checked.ok) throw new Error(checked.reason);
        applyPlay(next, seat, action.cards);
        return next;
      }

      if (action.kind === 'PASS') {
        applyPass(next, seat);
        return next;
      }

      throw new Error('出牌阶段只能出牌或选择不要');
    }

    case 'SETTLE':
      throw new Error('本局已结算，请开始下一局');
    case 'DEAL':
      throw new Error('发牌阶段不接受玩家动作');
    default:
      throw new Error(`未知阶段：${String(next.phase)}`);
  }
}

// ---------------------------------------------------------------------------
// 锁定窗口结算
// ---------------------------------------------------------------------------

/**
 * 锁定窗口结束（窗口固定等满 5 秒后由计时器/热座按钮调用，Q-053）。
 *
 * - intents 里恰好 1 人 → 锁定成功：out=true, locked=true, rank=3, rankTaken[3]=true,
 *   公开其 13 张牌，广播 LOCKED；若原首发正是该座位 → 首发顺延到其下家（Q-015）。
 * - 2 人及以上 → 全部失败，广播 LOCK_FAILED，不公开任何手牌。
 * - 之后 phase = 'PLAYING'，解析首发（resolveFirstSeat）、currentSeat = 首发。
 */
export function resolveLockWindow(state: GameState, intents: readonly number[]): GameState {
  if (state.phase !== 'LOCK_WINDOW') throw new Error('当前不是锁定窗口，不能结算锁定');

  const next = cloneState(state);

  const seats: number[] = [];
  for (const seat of intents) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= next.players.length) {
      throw new Error(`锁定意向包含非法座位号：${seat}`);
    }
    if (!seats.includes(seat)) seats.push(seat);
  }

  // 锁定前的原定首发（用于判定是否因锁定而顺延，事件 reason = SUCCESSOR）
  const baseFirstSeat = resolveFirstSeat(next);

  if (seats.length === 1) {
    const seat = seats[0] as number;
    const player = playerAt(next, seat);
    player.locked = true;
    player.out = true;
    player.rank = 3;
    next.rankTaken[3] = true;
    for (const card of player.hand) next.publicCards.push(card.id);
    next.log.push({ t: 'LOCKED', seat, cards: [...player.hand] });
  } else if (seats.length > 1) {
    next.log.push({ t: 'LOCK_FAILED', seats: [...seats] });
  }

  next.lockIntents = new Map<number, boolean>();
  next.phase = 'PLAYING';
  next.threePhase = false;
  next.topPattern = null;
  next.topSeat = null;
  next.passesSinceLastPlay = 0;
  next.isFirstPlay = true;

  // 重新解析首发（resolveFirstSeat 内部已处理「原首发已锁定 → 下家」的 Q-015 口径）
  let firstSeat = resolveFirstSeat(next);
  if (firstSeat < 0) {
    // 兜底：理论上不会发生（供牌/明牌/♦4 至少给出一条线索）
    firstSeat = next.players.find((player) => !player.out)?.seat ?? 0;
  }

  let reason: 'REVEAL' | 'SUPPLY' | 'DIAMOND4' | 'SUCCESSOR';
  if (firstSeat !== baseFirstSeat) {
    reason = 'SUCCESSOR';
  } else if (next.revealedSeat !== null) {
    reason = 'REVEAL';
  } else if (next.firstSeatBySupply !== null) {
    reason = 'SUPPLY';
  } else {
    reason = 'DIAMOND4';
  }

  next.firstSeat = firstSeat;
  next.currentSeat = firstSeat;
  next.log.push({ t: 'FIRST_SEAT', seat: firstSeat, reason });

  return next;
}

// ---------------------------------------------------------------------------
// 下一局
// ---------------------------------------------------------------------------

/**
 * SETTLE → 下一局：结算 → 生成 pendingDebt → handNo++ → 重新发牌进入 REVEAL/SUPPLY。
 * `result` 写入 state.result 并广播 SETTLE 事件。
 */
export function settleAndNextHand(state: GameState, rng: Rng): GameState {
  if (state.phase !== 'SETTLE') throw new Error('当前不是结算阶段，不能开始下一局');

  const settled = cloneState(state);
  const result = settled.result ?? computeResult(settled);
  settled.result = result;
  settled.log.push({ t: 'SETTLE', result });

  const pendingDebt = buildDebt(settled, result);

  const nextHand = createGame(rng, { pendingDebt, handNo: settled.handNo + 1 });
  // 保留上一局结果与「结算」事件：调用方/UI 可据此广播结算面板（新一局结算时会覆盖）
  nextHand.result = result;
  nextHand.log.unshift({ t: 'SETTLE', result });
  return nextHand;
}

// ---------------------------------------------------------------------------
// 查询工具
// ---------------------------------------------------------------------------

/** 判断本局是否已满足结束条件（《开发文档》7.5，双地不补名次） */
export function isGameOver(state: GameState): boolean {
  const landlordSeats = state.landlordSeats;
  const landlords = state.players.filter((player) => landlordSeats.includes(player.seat));
  const farmers = state.players.filter((player) => !landlordSeats.includes(player.seat));

  if (landlordSeats.length === 1) {
    // 双地：L 拿到第 1/2 名 → L 赢；有两个 F 拿到第 1/2 名 → F 赢（Q-034 / Q-086）
    const landlord = landlords[0];
    if (landlord !== undefined && landlord.rank !== null && landlord.rank <= 2) return true;
    const farmersInTop2 = farmers.filter(
      (player) => player.rank !== null && player.rank <= 2,
    ).length;
    return farmersInTop2 >= 2;
  }

  // 非双地：任一队两人都出完（out 包含提前锁定者）
  return landlords.every((player) => player.out) || farmers.every((player) => player.out);
}

/** 当前阶段的描述文案（UI / 日志用） */
export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'DEAL':
      return '发牌';
    case 'REVEAL':
      return '明牌决策';
    case 'SUPPLY':
      return '供牌/回牌';
    case 'LOCK_WINDOW':
      return '提前锁定窗口';
    case 'PLAYING':
      return '出牌';
    case 'SETTLE':
      return '结算';
    default:
      return `未知阶段（${String(phase)}）`;
  }
}
