import { describe, expect, it } from 'vitest';

import {
  applyAction,
  autoAdvance,
  canFollow,
  canPlayTripleLike,
  createGame,
  currentReturnPicker,
  defaultReturnCards,
  identifyPattern,
  isGameOver,
  legalActions,
  LOCK_WINDOW_MS,
  MAX_REDEAL,
  phaseLabel,
  resolveLockWindow,
  settleAndNextHand,
  validatePlay,
} from '../src/index';
import type { Action, Card, Debt, GameState, Pattern } from '../src/index';
import { c, cards, makeState, mulberry32 } from './helpers';

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

/** 按牌面文字识别牌型（识别失败直接让测试炸出来） */
function pfx(text: string): Pattern {
  const pattern = identifyPattern(cards(text));
  if (pattern === null) throw new Error(`测试用牌型无法识别：${text}`);
  return pattern;
}

function ids(list: readonly Card[]): number[] {
  return list.map((card) => card.id).sort((a, b) => a - b);
}

function sameCards(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((card) => card.id));
  return b.every((card) => set.has(card.id));
}

/** legalActions 里是否包含「正好打出 text 这些牌」的 PLAY */
function hasPlay(actions: readonly Action[], text: string): boolean {
  const target = cards(text);
  return actions.some((action) => action.kind === 'PLAY' && sameCards(action.cards, target));
}

function playPatterns(state: GameState, seat: number): Pattern[] {
  const result: Pattern[] = [];
  for (const action of legalActions(state, seat)) {
    if (action.kind !== 'PLAY') continue;
    const pattern = identifyPattern(action.cards);
    if (pattern !== null) result.push(pattern);
  }
  return result;
}

function hasTripleLikePlay(state: GameState, seat: number): boolean {
  return playPatterns(state, seat).some(
    (pattern) => pattern.type === 'TRIPLE' || pattern.type === 'TRIPLE_ONE',
  );
}

/** 供断言用的状态快照（纯函数测试：调用后必须完全一致） */
function snapshot(state: GameState): string {
  return JSON.stringify({
    handNo: state.handNo,
    phase: state.phase,
    hands: state.players.map((player) => ids(player.hand)),
    out: state.players.map((player) => player.out),
    locked: state.players.map((player) => player.locked),
    ranks: state.players.map((player) => player.rank),
    landlordSeats: state.landlordSeats,
    doubleSeat: state.doubleSeat,
    revealedSeat: state.revealedSeat,
    pendingDebt: state.pendingDebt,
    supplyStep: state.supplyContext?.step ?? null,
    firstSeat: state.firstSeat,
    firstSeatBySupply: state.firstSeatBySupply,
    currentSeat: state.currentSeat,
    topPattern:
      state.topPattern === null
        ? null
        : { type: state.topPattern.type, cards: ids(state.topPattern.cards) },
    topSeat: state.topSeat,
    threePhase: state.threePhase,
    isFirstPlay: state.isFirstPlay,
    passesSinceLastPlay: state.passesSinceLastPlay,
    publicCards: [...state.publicCards].sort((a, b) => a - b),
    finishOrder: state.finishOrder,
    nextRankSlot: state.nextRankSlot,
    rankTaken: state.rankTaken,
    redealCount: state.redealCount,
    lockIntents: [...state.lockIntents.entries()],
    result: state.result,
    logLength: state.log.length,
  });
}

function seatOf(state: GameState, card: Card): number {
  return state.players.findIndex((player) =>
    player.hand.some((held) => held.id === card.id),
  );
}

/** 断言：4 家各 13 张、52 张不重不漏、地主牌都在牌局里 */
function expectFullDeal(state: GameState): void {
  const seen = new Set<number>();
  for (const player of state.players) {
    expect(player.hand).toHaveLength(13);
    for (const card of player.hand) {
      expect(seen.has(card.id)).toBe(false);
      seen.add(card.id);
    }
  }
  expect(seen.size).toBe(52);
  expect(seen.has(c(16, 4).id)).toBe(true); // ♠3
  expect(seen.has(c(14, 4).id)).toBe(true); // ♠A
}

/** 断言：全场正好 52 张、不重不漏（供牌中间态每人不一定是 13 张） */
function expectUnique52(state: GameState): void {
  const seen = new Set<number>();
  let total = 0;
  for (const player of state.players) {
    for (const card of player.hand) {
      expect(seen.has(card.id)).toBe(false);
      seen.add(card.id);
      total += 1;
    }
  }
  expect(total).toBe(52);
  expect(seen.size).toBe(52);
}

/** 13 张全部 <= 10 的合法锁定手牌（两家各一套，互不重复） */
const LOW_HAND_A = '♦4 ♣4 ♥4 ♠4 ♦5 ♣5 ♥5 ♠5 ♦6 ♣6 ♥6 ♠6 ♦7';
const LOW_HAND_B = '♣7 ♥7 ♠7 ♦8 ♣8 ♥8 ♠8 ♦9 ♣9 ♥9 ♠9 ♦10 ♣10';

/**
 * 上一局「双地明牌输、欠 12 张」，本局又是双地 → CHECK 必定失败（Q-008 / Q-044）。
 * 座位 0 同时持有 ♠3、♠A，可用供牌只有 11 张 < 12。
 */
function makeSupplyImpossibleState(overrides: Partial<GameState> = {}): GameState {
  const debt: Debt = {
    winners: [1, 2],
    losers: [0],
    amountPerLoser: 12,
    total: 12,
    revealed: true,
    mode: 'DOUBLE',
  };
  const state = makeState({
    phase: 'REVEAL',
    handNo: 7,
    hands: [
      cards('♠3 ♠A ♥4 ♣5 ♦6 ♥7 ♣8 ♦9 ♥10 ♣J ♦Q ♥K ♣2'),
      cards('♦4'),
      cards('♣3'),
      cards('♥3'),
    ],
    doubleSeat: 0,
    landlordSeats: [0],
    pendingDebt: debt,
    currentSeat: 0,
  });
  Object.assign(state, overrides);
  return state;
}

// ---------------------------------------------------------------------------
// createGame / 开局
// ---------------------------------------------------------------------------

describe('createGame / 开局', () => {
  it('双地局：进入 REVEAL，phase/身份正确、pendingDebt 为 null、52 张发完', () => {
    const state = createGame(mulberry32(1), { handNo: 1 });

    expect(state.phase).toBe('REVEAL');
    expect(state.doubleSeat).toBe(0);
    expect(state.landlordSeats).toEqual([0]);
    expect(state.revealedSeat).toBeNull();
    expect(state.pendingDebt).toBeNull();
    expect(state.currentSeat).toBe(0);
    expect(state.firstSeat).toBeNull();
    expect(state.isFirstPlay).toBe(true);
    expect(state.log[0]).toEqual({ t: 'DEAL', handNo: 1 });
    expectFullDeal(state);
  });

  it('非双地局：自动推进到 LOCK_WINDOW（无债务时跳过供牌）', () => {
    const state = createGame(mulberry32(2), { handNo: 1 });

    expect(state.phase).toBe('LOCK_WINDOW');
    expect(state.doubleSeat).toBeNull();
    expect(state.revealedSeat).toBeNull();
    expect(state.pendingDebt).toBeNull();
    expectFullDeal(state);
  });

  it('地主方身份由 ♠3/♠A 实际持有者决定，且身份牌不重复', () => {
    const state = createGame(mulberry32(2));
    const holder3 = seatOf(state, c(16, 4));
    const holderA = seatOf(state, c(14, 4));
    expect(holder3).not.toBe(-1);
    expect(holderA).not.toBe(-1);
    const expected = [...new Set([holder3, holderA])].sort((a, b) => a - b);
    expect([...state.landlordSeats].sort((a, b) => a - b)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 明牌（REVEAL）
// ---------------------------------------------------------------------------

describe('明牌（REVEAL 阶段）', () => {
  it('明牌：revealedSeat 正确、只公开 ♠3/♠A、债务作废、进入 LOCK_WINDOW', () => {
    const before = createGame(mulberry32(1));
    expect(before.phase).toBe('REVEAL');

    const state = applyAction(before, 0, { kind: 'REVEAL' });

    expect(state.revealedSeat).toBe(0);
    expect(state.phase).toBe('LOCK_WINDOW');
    expect(state.pendingDebt).toBeNull();
    expect([...state.publicCards].sort((a, b) => a - b)).toEqual(
      [c(16, 4).id, c(14, 4).id].sort((a, b) => a - b),
    );
    expect(state.log.some((event) => event.t === 'REVEALED' && event.seat === 0 && !event.forced)).toBe(
      true,
    );
    // 原状态不被修改
    expect(before.revealedSeat).toBeNull();
  });

  it('明牌者首发（优先于 ♦4 与供最大牌者）', () => {
    const revealed = applyAction(createGame(mulberry32(1)), 0, { kind: 'REVEAL' });
    const playing = resolveLockWindow(revealed, []);

    expect(playing.phase).toBe('PLAYING');
    expect(playing.firstSeat).toBe(0);
    expect(playing.currentSeat).toBe(0);
    expect(playing.isFirstPlay).toBe(true);
    expect(playing.threePhase).toBe(false);
    expect(playing.topPattern).toBeNull();
    expect(
      playing.log.some((event) => event.t === 'FIRST_SEAT' && event.seat === 0 && event.reason === 'REVEAL'),
    ).toBe(true);
  });

  it('不明牌（PASS）：不公开任何牌，随后由 ♦4 持有者首发', () => {
    const declined = applyAction(createGame(mulberry32(1)), 0, { kind: 'PASS' });

    expect(declined.revealedSeat).toBeNull();
    expect(declined.phase).toBe('LOCK_WINDOW');
    expect(declined.publicCards).toEqual([]);

    const playing = resolveLockWindow(declined, []);
    expect(playing.firstSeat).toBe(seatOf(playing, c(4, 1)));
    expect(
      playing.log.some(
        (event) => event.t === 'FIRST_SEAT' && event.seat === playing.firstSeat && event.reason === 'DIAMOND4',
      ),
    ).toBe(true);
  });

  it('只有双地玩家能决定明牌：其它座位 / 非法动作抛错', () => {
    const state = createGame(mulberry32(1));
    expect(() => applyAction(state, 1, { kind: 'PASS' })).toThrow();
    expect(() => applyAction(state, 0, { kind: 'LOCK' })).toThrow();
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♠3') })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 提前锁定窗口
// ---------------------------------------------------------------------------

describe('提前锁定窗口（LOCK_WINDOW）', () => {
  const lockWindowState = (): GameState =>
    makeState({
      phase: 'LOCK_WINDOW',
      hands: [cards('♠8 ♥9'), cards('♣8 ♦9'), cards(LOW_HAND_A), cards('♠10 ♥J')],
      // 原定首发 = 锁定者（用于验证 Q-015 首发顺延）
      firstSeatBySupply: 2,
      landlordSeats: [0, 1],
    });

  it('1 人锁定成功：rank=3、out/locked、公开 13 张、首发顺延到下家（Q-015）', () => {
    const state = lockWindowState();
    const before = snapshot(state);

    const next = resolveLockWindow(state, [2]);

    const locked = next.players[2] as GameState['players'][number];
    expect(locked.locked).toBe(true);
    expect(locked.out).toBe(true);
    expect(locked.rank).toBe(3);
    expect(locked.hand).toHaveLength(13);
    expect(next.rankTaken[3]).toBe(true);
    expect([...next.publicCards].sort((a, b) => a - b)).toEqual(ids(cards(LOW_HAND_A)));
    expect(next.log).toContainEqual({ t: 'LOCKED', seat: 2, cards: cards(LOW_HAND_A) });
    expect(next.phase).toBe('PLAYING');
    expect(next.isFirstPlay).toBe(true);
    // Q-015：原定首发（座位 2）已 out → 从下家（座位 3）起找第一个在场者
    expect(next.firstSeat).toBe(3);
    expect(next.currentSeat).toBe(3);
    expect(
      next.log.some((event) => event.t === 'FIRST_SEAT' && event.seat === 3 && event.reason === 'SUCCESSOR'),
    ).toBe(true);
    // 纯函数
    expect(snapshot(state)).toBe(before);
  });

  it('2 人及以上锁定全部失败：不公开任何手牌、正常开打、首发不变', () => {
    const state = makeState({
      phase: 'LOCK_WINDOW',
      hands: [cards('♠8 ♥9'), cards('♣8 ♦9'), cards(LOW_HAND_A), cards(LOW_HAND_B)],
      firstSeatBySupply: 0,
    });

    const next = resolveLockWindow(state, [2, 3]);

    expect(next.players[2]?.rank).toBeNull();
    expect(next.players[3]?.rank).toBeNull();
    expect(next.players[2]?.out).toBe(false);
    expect(next.players[3]?.out).toBe(false);
    expect(next.publicCards).toEqual([]);
    expect(next.log).toContainEqual({ t: 'LOCK_FAILED', seats: [2, 3] });
    expect(next.firstSeat).toBe(0);
    expect(next.currentSeat).toBe(0);
    expect(next.phase).toBe('PLAYING');
  });

  it('窗口内 LOCK / UNLOCK 可反复切换，关闭时以最终意向为准（Q-056）；且不提前结束（Q-053）', () => {
    let state = lockWindowState();

    state = applyAction(state, 2, { kind: 'LOCK' });
    expect(state.lockIntents.get(2)).toBe(true);
    // 只有 1 人表态也不提前关闭窗口
    expect(state.phase).toBe('LOCK_WINDOW');

    state = applyAction(state, 2, { kind: 'UNLOCK' });
    expect(state.lockIntents.get(2)).toBe(false);

    state = applyAction(state, 2, { kind: 'LOCK' });
    expect(state.lockIntents.get(2)).toBe(true);

    const next = resolveLockWindow(state, [2]);
    expect(next.players[2]?.rank).toBe(3);
    expect(LOCK_WINDOW_MS).toBe(5000);
  });

  it('不符合条件的人 LOCK 抛错；锁定窗口内其它动作抛错；非窗口阶段结算抛错', () => {
    const state = makeState({
      phase: 'LOCK_WINDOW',
      hands: [cards('♠8 ♥9'), cards('♣8 ♦9'), cards(LOW_HAND_A), cards('♠10 ♥J')],
    });

    // 座位 0 手牌只有 2 张 → 不符合条件
    expect(() => applyAction(state, 0, { kind: 'LOCK' })).toThrow(/不符合提前锁定条件/);
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♠8') })).toThrow();
    expect(() => applyAction(state, 0, { kind: 'PASS' })).toThrow();
    expect(() => resolveLockWindow(makeState({ phase: 'PLAYING' }), [])).toThrow(/锁定窗口/);
  });

  it('锁定者固定第 3 名，剩余名次跳过 3（Q-058）', () => {
    // 座位 2 已提前锁定第 3 名；座位 0、1 依次出完占据第 1、2 名；
    // 非双地结束结算时座位 3 由 assignRemainingRanks 补到第 4 名（跳过 3）。
    const state = makeState({
      hands: [cards('♠8'), cards('♦9'), [], cards('♣8')],
      ranks: [null, null, 3, null],
      outSeats: [2],
      lockedSeats: [2],
      landlordSeats: [0, 1],
      rankTaken: [false, false, false, true, false],
      nextRankSlot: 1,
      currentSeat: 0,
      isFirstPlay: false,
    });

    const afterFirst = applyAction(state, 0, { kind: 'PLAY', cards: cards('♠8') });
    expect(afterFirst.players[0]?.rank).toBe(1);
    expect(afterFirst.currentSeat).toBe(1);

    const settled = applyAction(afterFirst, 1, { kind: 'PLAY', cards: cards('♦9') });
    expect(settled.players[1]?.rank).toBe(2);
    expect(settled.players[3]?.rank).toBe(4); // 跳过被锁定占用的第 3 名
    expect(settled.rankTaken).toEqual([false, true, true, true, true]);
    expect(settled.phase).toBe('SETTLE');
    expect(settled.result?.mode).toBe('NORMAL');
  });
});

// ---------------------------------------------------------------------------
// 供牌（SUPPLY）
// ---------------------------------------------------------------------------

describe('供牌（SUPPLY）', () => {
  it('12 张供不出：REVEAL 阶段选择不明牌后停在 SUPPLY/CHECK（Q-008），再明牌则债务作废', () => {
    const state = makeSupplyImpossibleState();

    const declined = applyAction(state, 0, { kind: 'PASS' });
    expect(declined.phase).toBe('SUPPLY');
    expect(declined.supplyContext?.step).toBe('CHECK');
    expect(declined.pendingDebt).not.toBeNull();

    const revealed = applyAction(declined, 0, { kind: 'REVEAL' });
    expect(revealed.phase).toBe('LOCK_WINDOW');
    expect(revealed.revealedSeat).toBe(0);
    expect(revealed.pendingDebt).toBeNull();
  });

  it('REDEAL：保留债务/handNo、redealCount+1、重发 52 张、身份重算（Q-074/Q-076/Q-077）', () => {
    const state = makeSupplyImpossibleState();
    const before = snapshot(state);

    const next = applyAction(state, 0, { kind: 'REDEAL' });

    expect(next.redealCount).toBe(1);
    expect(next.handNo).toBe(state.handNo);
    expect(next.pendingDebt).toEqual(state.pendingDebt);
    expect(next.revealedSeat).toBeNull();
    expect(['REVEAL', 'SUPPLY']).toContain(next.phase);
    expect(next.log.some((event) => event.t === 'REDEAL')).toBe(true);
    // 重发后仍是完整一副牌（可能已自动执行供牌，所以只断言 52 张不重不漏）
    expectUnique52(next);

    const holder3 = seatOf(next, c(16, 4));
    const holderA = seatOf(next, c(14, 4));
    expect([...next.landlordSeats].sort((a, b) => a - b)).toEqual(
      [...new Set([holder3, holderA])].sort((a, b) => a - b),
    );

    // 确定性：同一状态 + 同一动作，两次结果完全一致（可复现）
    const again = applyAction(state, 0, { kind: 'REDEAL' });
    expect(snapshot(again)).toBe(snapshot(next));
    // 原状态不被修改
    expect(snapshot(state)).toBe(before);
  });

  it('达到 MAX_REDEAL 后拒绝 REDEAL，只能明牌（且明牌标记 forced，Q-074/Q-075）', () => {
    const state = makeSupplyImpossibleState({ redealCount: MAX_REDEAL });

    expect(() => applyAction(state, 0, { kind: 'REDEAL' })).toThrow(/上限/);

    const revealed = applyAction(state, 0, { kind: 'REVEAL' });
    expect(revealed.revealedSeat).toBe(0);
    expect(revealed.pendingDebt).toBeNull();
    expect(revealed.phase).toBe('LOCK_WINDOW');
    expect(
      revealed.log.some((event) => event.t === 'REVEALED' && event.seat === 0 && event.forced),
    ).toBe(true);
  });

  it('不需要重发时 REDEAL 抛错（只有 12 张供不出才能重发）', () => {
    const state = makeState({
      phase: 'REVEAL',
      hands: [cards('♠3 ♠A ♥4'), cards('♦4'), cards('♣3'), cards('♥3')],
      doubleSeat: 0,
      landlordSeats: [0],
      currentSeat: 0,
    });
    expect(state.pendingDebt).toBeNull();
    expect(() => applyAction(state, 0, { kind: 'REDEAL' })).toThrow(/不需要重新发牌/);
  });

  it('完整供牌流程：自动收/分 → 赢家还牌 → 输家轮流挑回 → 每人 13 张且债务清空', () => {
    // 用真实发牌状态（seed 2 非双地，地主方座位 0、2）伪造「上一局大赢」结算：
    // 座位 0、2 名次 1、2 → L 5:1 大赢，F 座位 1、3 各供 2 张。
    const settleState = createGame(mulberry32(2));
    settleState.phase = 'SETTLE';
    settleState.players.forEach((player, seat) => {
      player.rank = [1, 3, 2, 4][seat] ?? null;
      player.out = true;
    });
    const before = snapshot(settleState);

    const next = settleAndNextHand(settleState, mulberry32(2));

    expect(snapshot(settleState)).toBe(before);
    expect(next.handNo).toBe(2);
    expect(next.log[0]?.t).toBe('SETTLE');
    expect(next.phase).toBe('SUPPLY');
    expect(next.supplyContext?.step).toBe('RETURN_SELECT');
    expect(next.pendingDebt?.total).toBe(4);
    expect(next.pendingDebt?.losers).toEqual([1, 3]);
    expect(next.players.map((player) => player.hand.length)).toEqual([15, 11, 15, 11]);

    const debt = next.pendingDebt as Debt;
    let current = next;
    for (const seat of debt.winners) {
      const context = current.supplyContext;
      if (context === null) throw new Error('缺少供牌上下文');
      const count = context.perWinner.get(seat) ?? 0;
      current = applyAction(current, seat, {
        kind: 'RETURN_CARDS',
        cards: defaultReturnCards(current.players[seat]?.hand ?? [], count),
      });
    }
    expect(current.supplyContext?.step).toBe('RETURN_PICK');
    expect(current.supplyContext?.returnPool.length).toBe(4);

    const pickers: number[] = [];
    let guard = 0;
    while (current.supplyContext?.step === 'RETURN_PICK') {
      if (++guard > 10) throw new Error('挑回牌死循环');
      const picker = currentReturnPicker(current);
      expect(picker).not.toBeNull();
      pickers.push(picker as number);
      const card = current.supplyContext.returnPool[0] as Card;
      current = applyAction(current, picker as number, { kind: 'PICK_RETURN', card });
    }

    // 轮流挑：两家输家各挑 2 张，顺序必须是 A、B、A、B
    expect(pickers).toHaveLength(4);
    expect([...new Set(pickers)].sort((a, b) => a - b)).toEqual([...debt.losers].sort((a, b) => a - b));
    expect(pickers[0]).not.toBe(pickers[1]);
    expect(pickers[2]).toBe(pickers[0]);
    expect(pickers[3]).toBe(pickers[1]);

    expect(current.phase).toBe('LOCK_WINDOW');
    expect(current.pendingDebt).toBeNull();
    expect(current.players.map((player) => player.hand.length)).toEqual([13, 13, 13, 13]);
    const allIds = current.players.flatMap((player) => player.hand.map((card) => card.id));
    expect(new Set(allIds).size).toBe(52);
  });

  it('供牌阶段回牌张数 / 地主牌 / 错误座位都会抛错', () => {
    const state = makeSupplyImpossibleState({ phase: 'SUPPLY' });
    // 构造进入 RETURN_SELECT 的上下文：手工指定
    state.supplyContext = {
      step: 'RETURN_SELECT',
      pool: [],
      returnPool: [],
      perLoser: new Map(),
      perWinner: new Map([[1, 1]]),
      biggestCardByLoser: new Map(),
      returns: new Map(),
    };
    state.pendingDebt = {
      winners: [1],
      losers: [0],
      amountPerLoser: 1,
      total: 1,
      revealed: false,
      mode: 'NORMAL',
    };
    state.players[1] = { ...state.players[1]!, hand: cards('♠3 ♠A ♥4 ♣5') };
    // 数量不对
    expect(() => applyAction(state, 1, { kind: 'RETURN_CARDS', cards: cards('♥4 ♣5') })).toThrow(
      /需要返还 1 张/,
    );
    // 地主牌不能回
    expect(() => applyAction(state, 1, { kind: 'RETURN_CARDS', cards: cards('♠A') })).toThrow(
      /♠3 或 ♠A/,
    );
    // 不是赢家
    expect(() => applyAction(state, 2, { kind: 'RETURN_CARDS', cards: [] })).toThrow(/赢家/);
    // 步骤不对
    expect(() => applyAction(state, 1, { kind: 'PICK_RETURN', card: c(4, 1) })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 出牌流程 F-01 ~ F-09
// ---------------------------------------------------------------------------

describe('出牌流程（F-01 ~ F-09）', () => {
  it('F-01 其余在场玩家依次不要 → 最后出牌者领出下一墩', () => {
    const state = makeState({
      hands: [cards('♥6 ♥7'), cards('♠9 ♣9'), cards('♦10 ♣10'), cards('♠J ♥J')],
      topPattern: pfx('♠5'),
      topSeat: 0,
      currentSeat: 1,
      firstSeat: 0,
    });
    const before = snapshot(state);

    const afterFirst = applyAction(state, 1, { kind: 'PASS' });
    expect(afterFirst.currentSeat).toBe(2);
    expect(afterFirst.passesSinceLastPlay).toBe(1);

    const afterSecond = applyAction(afterFirst, 2, { kind: 'PASS' });
    expect(afterSecond.currentSeat).toBe(3);
    expect(afterSecond.passesSinceLastPlay).toBe(2);

    const afterThird = applyAction(afterSecond, 3, { kind: 'PASS' });
    expect(afterThird.currentSeat).toBe(0); // 最后出牌者领出
    expect(afterThird.topPattern).toBeNull();
    expect(afterThird.passesSinceLastPlay).toBe(0);
    expect(afterThird.phase).toBe('PLAYING');

    expect(snapshot(state)).toBe(before);
  });

  it('F-02 B 过牌后 C 出牌，轮回 B 时 B 可以再出（过牌不锁定）', () => {
    const state = makeState({
      hands: [cards('♥6'), cards('♥J ♣J'), cards('♥10 ♦9'), cards('♣10 ♠Q')],
      topPattern: pfx('♠5'),
      topSeat: 0,
      currentSeat: 1,
      firstSeat: 0,
    });

    const afterB1 = applyAction(state, 1, { kind: 'PASS' });
    const afterC = applyAction(afterB1, 2, { kind: 'PLAY', cards: cards('♥10') });
    expect(afterC.topSeat).toBe(2);
    expect(afterC.passesSinceLastPlay).toBe(0);
    expect(afterC.currentSeat).toBe(3);

    const afterD = applyAction(afterC, 3, { kind: 'PASS' });
    const afterA = applyAction(afterD, 0, { kind: 'PASS' });
    expect(afterA.passesSinceLastPlay).toBe(2);
    expect(afterA.currentSeat).toBe(1);

    // B 再次获得表态权，可以出更大的单张
    expect(hasPlay(legalActions(afterA, 1), '♥J')).toBe(true);
    const afterB2 = applyAction(afterA, 1, { kind: 'PLAY', cards: cards('♥J') });
    expect(afterB2.topSeat).toBe(1);
    expect(afterB2.passesSinceLastPlay).toBe(0);
  });

  it('F-03 出完最后一张：本墩立即结束、分配第 1 名、下家领出', () => {
    const state = makeState({
      hands: [cards('♠10'), cards('♣9 ♦9'), cards('♥8'), cards('♦8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });
    const before = snapshot(state);

    const next = applyAction(state, 0, { kind: 'PLAY', cards: cards('♠10') });

    expect(next.players[0]?.out).toBe(true);
    expect(next.players[0]?.hand).toEqual([]);
    expect(next.players[0]?.rank).toBe(1);
    expect(next.finishOrder).toEqual([0]);
    expect(next.topPattern).toBeNull();
    expect(next.currentSeat).toBe(1);
    expect(next.phase).toBe('PLAYING');
    expect(next.log.some((event) => event.t === 'FINISH' && event.seat === 0 && event.rank === 1)).toBe(
      true,
    );
    expect(snapshot(state)).toBe(before);
  });

  it('F-04 首发第一手 555 → 进入三条阶段', () => {
    const state = makeState({
      hands: [cards('♠5 ♥5 ♣5 ♦9 ♥10'), cards('♣6 ♦6'), cards('♣7 ♦7'), cards('♣8 ♦8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: true,
    });

    expect(hasPlay(legalActions(state, 0), '♠5 ♥5 ♣5')).toBe(true);

    const next = applyAction(state, 0, { kind: 'PLAY', cards: cards('♠5 ♥5 ♣5') });

    expect(next.threePhase).toBe(true);
    expect(next.isFirstPlay).toBe(false);
    expect(next.topPattern?.type).toBe('TRIPLE');
    expect(next.topSeat).toBe(0);
    expect(next.currentSeat).toBe(1);
  });

  it('F-05 三条阶段中三家不要 → 最后出牌者领出，仍可出更大的三条', () => {
    const state = makeState({
      hands: [cards('♠6 ♥6 ♣6 ♦9'), cards('♣7 ♦7'), cards('♣8 ♦8'), cards('♣10 ♦10')],
      topPattern: pfx('♠5 ♥5 ♣5'),
      topSeat: 0,
      currentSeat: 1,
      threePhase: true,
    });

    const after1 = applyAction(state, 1, { kind: 'PASS' });
    const after2 = applyAction(after1, 2, { kind: 'PASS' });
    const after3 = applyAction(after2, 3, { kind: 'PASS' });

    expect(after3.currentSeat).toBe(0);
    expect(after3.passesSinceLastPlay).toBe(0);
    expect(after3.threePhase).toBe(true);
    expect(after3.topPattern).not.toBeNull(); // 三条阶段保留基准牌

    const actions = legalActions(after3, 0);
    expect(hasPlay(actions, '♠6 ♥6 ♣6')).toBe(true); // 更大的三条
    expect(hasPlay(actions, '♦9')).toBe(true); // 也可以主动断掉（Q-023）

    const played = applyAction(after3, 0, { kind: 'PLAY', cards: cards('♠6 ♥6 ♣6') });
    expect(played.threePhase).toBe(true);
    expect(played.topPattern?.type).toBe('TRIPLE');
    expect(played.topSeat).toBe(0);
  });

  it('F-06 三条阶段中打出三条夹双 → 阶段结束，之后不能再出三条', () => {
    const state = makeState({
      hands: [
        cards('♦9 ♦10'),
        cards('♠6 ♥6 ♣6 ♦9 ♥9 ♠J'), // 多留一张，避免顺风把 topPattern 清掉
        cards('♠7 ♥7 ♣7 ♦10 ♣10'),
        cards('♣Q ♦Q'),
      ],
      topPattern: pfx('♠5 ♥5 ♣5'),
      topSeat: 0,
      currentSeat: 1,
      threePhase: true,
    });

    const next = applyAction(state, 1, { kind: 'PLAY', cards: cards('♠6 ♥6 ♣6 ♦9 ♥9') });

    expect(next.threePhase).toBe(false);
    expect(next.topPattern?.type).toBe('TRIPLE_PAIR');
    expect(next.currentSeat).toBe(2);
    expect(hasTripleLikePlay(next, 2)).toBe(false);
    expect(() => applyAction(next, 2, { kind: 'PLAY', cards: cards('♠7 ♥7 ♣7') })).toThrow(/三条/);
  });

  it('F-07 中局领出三条非法（非首发、非结束牌）', () => {
    const state = makeState({
      hands: [cards('♠5 ♥5 ♣5 ♦9 ♣9'), cards('♣6 ♦6'), cards('♣7 ♦7'), cards('♣8 ♦8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });

    expect(hasPlay(legalActions(state, 0), '♠5 ♥5 ♣5')).toBe(false);
    const checked = validatePlay(state, 0, cards('♠5 ♥5 ♣5'));
    expect(checked.ok).toBe(false);
    expect(checked.reason).toContain('三条');
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♠5 ♥5 ♣5') })).toThrow();

    // 防御：即使是本局第一手，也必须是首发座位本人才能出三条（Q-026）
    const notFirstSeat = makeState({
      hands: [cards('♠5 ♥5 ♣5 ♦9'), cards('♣6 ♦6'), cards('♣7 ♦7'), cards('♣8 ♦8')],
      currentSeat: 0,
      firstSeat: 1,
      isFirstPlay: true,
    });
    expect(validatePlay(notFirstSeat, 0, cards('♠5 ♥5 ♣5')).ok).toBe(false);
  });

  it('F-08 手上只剩 3 张 555，领出合法并直接走完（结束牌）', () => {
    const state = makeState({
      hands: [cards('♠5 ♥5 ♣5'), cards('♣6 ♦6'), cards('♣7 ♦7'), cards('♣8 ♦8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });

    expect(hasPlay(legalActions(state, 0), '♠5 ♥5 ♣5')).toBe(true);
    expect(validatePlay(state, 0, cards('♠5 ♥5 ♣5')).ok).toBe(true);

    const next = applyAction(state, 0, { kind: 'PLAY', cards: cards('♠5 ♥5 ♣5') });
    expect(next.players[0]?.out).toBe(true);
    expect(next.players[0]?.rank).toBe(1);
    expect(next.finishOrder).toEqual([0]);
  });

  it('F-09 手上只剩 4 张 5556，领出三条夹一合法并直接走完（结束牌）', () => {
    const state = makeState({
      hands: [cards('♠5 ♥5 ♣5 ♦6'), cards('♣6 ♦7'), cards('♣7 ♦7'), cards('♣8 ♦8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });

    expect(hasPlay(legalActions(state, 0), '♠5 ♥5 ♣5 ♦6')).toBe(true);
    expect(validatePlay(state, 0, cards('♠5 ♥5 ♣5 ♦6')).ok).toBe(true);

    const next = applyAction(state, 0, { kind: 'PLAY', cards: cards('♠5 ♥5 ♣5 ♦6') });
    expect(next.players[0]?.out).toBe(true);
    expect(next.players[0]?.rank).toBe(1);
    expect(next.finishOrder).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// 三条阶段（Q-023 / Q-024）
// ---------------------------------------------------------------------------

describe('三条阶段（Q-023 / Q-024）', () => {
  it('Q-023 领出者可以主动断掉：改打单张后阶段立即结束', () => {
    const state = makeState({
      hands: [cards('♥4 ♣4 ♦4 ♥9 ♣10'), cards('♦6 ♣6 ♥6 ♠8'), cards('♣7 ♦7'), cards('♣J ♦J')],
      topPattern: pfx('♠5 ♥5 ♣5'),
      topSeat: 0,
      currentSeat: 0, // 一墩结束，最后出牌者继续领出
      threePhase: true,
    });

    const actions = legalActions(state, 0);
    expect(hasPlay(actions, '♥9')).toBe(true); // 任意其它合法牌型可以领出
    expect(hasPlay(actions, '♥4 ♣4 ♦4')).toBe(false); // 更小的三条不行（不能降维/更小）
    expect(hasPlay(actions, '♥4 ♣4')).toBe(true);

    const next = applyAction(state, 0, { kind: 'PLAY', cards: cards('♥9') });
    expect(next.threePhase).toBe(false);
    expect(next.topPattern?.type).toBe('SINGLE');
    expect(next.isFirstPlay).toBe(false);
    expect(next.currentSeat).toBe(1);

    // 阶段结束后跟牌者不能再出三条
    expect(hasTripleLikePlay(next, 1)).toBe(false);
    expect(() => applyAction(next, 1, { kind: 'PLAY', cards: cards('♦6 ♣6 ♥6') })).toThrow(/三条/);
  });

  it('三条不能压三条夹一（不能降维），三条夹一可压三条（升维）', () => {
    const state = makeState({
      hands: [cards('♦9 ♦10'), cards('♠6 ♥6 ♣6 ♦9 ♥9'), cards('♣7 ♦7'), cards('♣J ♦J')],
      topPattern: pfx('♠5 ♥5 ♣5 ♦6'), // 三条夹一
      topSeat: 0,
      currentSeat: 1,
      threePhase: true,
    });

    expect(canFollow(pfx('♠6 ♥6 ♣6'), pfx('♠5 ♥5 ♣5 ♦6'))).toBe(false);
    expect(canFollow(pfx('♠6 ♥6 ♣6 ♦9'), pfx('♠5 ♥5 ♣5'))).toBe(true);

    const actions = legalActions(state, 1);
    expect(hasPlay(actions, '♠6 ♥6 ♣6')).toBe(false); // 降维不合法
    expect(hasPlay(actions, '♠6 ♥6 ♣6 ♦9 ♥9')).toBe(true); // 升档（三条夹双）合法
    expect(hasPlay(actions, '♠6 ♥6 ♣6 ♦9')).toBe(true); // 同为三条夹一、点数更大，合法
  });

  it('Q-024 顺风立即结束三条阶段：threePhase=false、topPattern=null，新领出者不能再出三条', () => {
    const state = makeState({
      hands: [cards('♦9 ♣10'), cards('♠6 ♥6 ♣6'), cards('♠7 ♥7 ♣7 ♦9 ♣9'), cards('♣8 ♦8')],
      topPattern: pfx('♠5 ♥5 ♣5'),
      topSeat: 0,
      currentSeat: 1,
      threePhase: true,
    });

    const next = applyAction(state, 1, { kind: 'PLAY', cards: cards('♠6 ♥6 ♣6') });

    expect(next.players[1]?.out).toBe(true);
    expect(next.players[1]?.rank).toBe(1);
    expect(next.threePhase).toBe(false);
    expect(next.topPattern).toBeNull();
    expect(next.currentSeat).toBe(2); // 顺风：下家领出
    expect(next.finishOrder).toEqual([1]);

    // 新领出者即使手里有三条也不能出（非首手、非三条阶段、非结束牌）
    expect(hasTripleLikePlay(next, 2)).toBe(false);
    expect(validatePlay(next, 2, cards('♠7 ♥7 ♣7')).ok).toBe(false);
    // 其它牌型可以正常领出
    expect(hasPlay(legalActions(next, 2), '♦9')).toBe(true);
  });

  it('canPlayTripleLike 的三种允许场合与默认拒绝', () => {
    const base = makeState({
      hands: [cards('♠5 ♥5 ♣5 ♦9'), cards('♣6'), cards('♣7'), cards('♣8')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });
    const leading = true;
    const triple = pfx('♠5 ♥5 ♣5');

    expect(canPlayTripleLike(base, 0, triple, leading)).toBe(false); // 中局领出
    expect(canPlayTripleLike({ ...base, isFirstPlay: true }, 0, triple, leading)).toBe(true); // 本局第一手
    expect(canPlayTripleLike({ ...base, threePhase: true }, 0, triple, leading)).toBe(true); // 三条阶段
    expect(
      canPlayTripleLike(
        makeState({
          hands: [cards('♠5 ♥5 ♣5'), cards('♣6'), cards('♣7'), cards('♣8')],
          isFirstPlay: false,
        }),
        0,
        triple,
        leading,
      ),
    ).toBe(true); // 结束牌（手上恰好只剩这一手）
    expect(canPlayTripleLike(base, 0, triple, false)).toBe(false); // 跟牌不算结束牌
    expect(canPlayTripleLike(base, 0, pfx('♠9'), leading)).toBe(true); // 非三条牌型不受限
  });
});

// ---------------------------------------------------------------------------
// 动作校验 / 纯函数
// ---------------------------------------------------------------------------

describe('动作校验与纯函数', () => {
  const playingState = (): GameState =>
    makeState({
      hands: [cards('♠10 ♥10 ♣9'), cards('♦9 ♣8'), cards('♥9 ♦8'), cards('♣J ♠Q')],
      currentSeat: 0,
      firstSeat: 0,
      isFirstPlay: false,
    });

  it('非法动作抛出中文原因：座位不对 / 阶段不对 / 牌不在手上 / 牌型非法 / 领出 PASS', () => {
    const state = playingState();

    expect(() => applyAction(state, 1, { kind: 'PASS' })).toThrow(/还没轮到/);
    expect(() => applyAction(state, 9, { kind: 'PASS' })).toThrow(/座位号/);
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♣5') })).toThrow(/不在手上/);
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♠10 ♣9') })).toThrow(/牌型/);
    expect(() => applyAction(state, 0, { kind: 'PASS' })).toThrow(/领出时不能/);

    const lockPhase = makeState({ phase: 'LOCK_WINDOW' });
    expect(() => applyAction(lockPhase, 0, { kind: 'PLAY', cards: cards('♠10') })).toThrow();
    const settlePhase = makeState({ phase: 'SETTLE' });
    expect(() => applyAction(settlePhase, 0, { kind: 'PASS' })).toThrow();
  });

  it('已出完 / 已锁定的人不能出牌，也无法作为 currentSeat 行动', () => {
    const state = makeState({
      hands: [cards('♠10'), cards('♦9'), cards('♥9'), cards('♣J')],
      outSeats: [0],
      currentSeat: 0,
      isFirstPlay: false,
    });
    expect(validatePlay(state, 0, cards('♠10')).ok).toBe(false);
    expect(legalActions(state, 0)).toEqual([]);
    expect(() => applyAction(state, 0, { kind: 'PLAY', cards: cards('♠10') })).toThrow(/已出完/);
  });

  it('applyAction / resolveLockWindow / settleAndNextHand 都不修改入参（纯函数）', () => {
    const playState = playingState();
    const playBefore = snapshot(playState);
    applyAction(playState, 0, { kind: 'PLAY', cards: cards('♠10') });
    expect(snapshot(playState)).toBe(playBefore);

    const passState = makeState({
      hands: [cards('♠10'), cards('♦9'), cards('♥9'), cards('♣J')],
      topPattern: pfx('♠5'),
      topSeat: 0,
      currentSeat: 1,
    });
    const passBefore = snapshot(passState);
    applyAction(passState, 1, { kind: 'PASS' });
    expect(snapshot(passState)).toBe(passBefore);

    const lockState = makeState({
      phase: 'LOCK_WINDOW',
      hands: [cards('♠8 ♥9'), cards('♣8 ♦9'), cards(LOW_HAND_A), cards('♠10 ♥J')],
    });
    const lockBefore = snapshot(lockState);
    resolveLockWindow(lockState, [2]);
    expect(snapshot(lockState)).toBe(lockBefore);
  });
});

// ---------------------------------------------------------------------------
// isGameOver / settleAndNextHand / phaseLabel
// ---------------------------------------------------------------------------

describe('结束条件、下一局与阶段文案', () => {
  it('isGameOver：非双地任一队两人出完即结束', () => {
    expect(isGameOver(makeState({ landlordSeats: [0, 1], outSeats: [0, 1] }))).toBe(true);
    expect(isGameOver(makeState({ landlordSeats: [0, 1], outSeats: [2, 3] }))).toBe(true);
    expect(isGameOver(makeState({ landlordSeats: [0, 1], outSeats: [0, 2] }))).toBe(false);
    // 提前锁定者 out 也算出完
    expect(isGameOver(makeState({ landlordSeats: [0, 1], outSeats: [0, 1, 3] }))).toBe(true);
  });

  it('isGameOver：双地看名次 ≤2 的人，锁定第 3 名不计入（Q-034 / Q-086）', () => {
    expect(isGameOver(makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [2, null, null, null] }))).toBe(
      true,
    );
    expect(isGameOver(makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [null, 1, 2, null] }))).toBe(
      true,
    );
    expect(isGameOver(makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [null, 1, 3, null] }))).toBe(
      false,
    );
    expect(isGameOver(makeState({ landlordSeats: [0], doubleSeat: 0, ranks: [null, 1, null, null] }))).toBe(
      false,
    );
  });

  it('settleAndNextHand：平局 → 下一局无债务、handNo+1、重新发牌 13 张', () => {
    const settleState = makeState({
      phase: 'SETTLE',
      handNo: 1,
      landlordSeats: [0, 1],
      ranks: [1, 4, 2, 3], // L 3+0=3，F 2+1=3 → 平局
    });
    const before = snapshot(settleState);

    const next = settleAndNextHand(settleState, mulberry32(2));

    expect(snapshot(settleState)).toBe(before);
    expect(next.handNo).toBe(2);
    expect(next.pendingDebt).toBeNull();
    expect(next.phase).toBe('LOCK_WINDOW');
    expect(next.redealCount).toBe(0);
    expect(next.log[0]?.t).toBe('SETTLE');
    expectFullDeal(next);
  });

  it('settleAndNextHand：大赢 → 下一局 pendingDebt 为「每人 2 张」，供牌自动执行', () => {
    const settleState = makeState({
      phase: 'SETTLE',
      handNo: 1,
      landlordSeats: [0, 1],
      ranks: [1, 2, 3, 4], // L 5:1 → 大赢，F 每人供 2 张
    });

    const next = settleAndNextHand(settleState, mulberry32(2));

    expect(next.handNo).toBe(2);
    expect(next.pendingDebt).toEqual({
      winners: [0, 1],
      losers: [2, 3],
      amountPerLoser: 2,
      total: 4,
      revealed: false,
      mode: 'NORMAL',
    });
    expect(next.phase).toBe('SUPPLY');
    expect(next.supplyContext?.step).toBe('RETURN_SELECT');
    expect(next.players.map((player) => player.hand.length)).toEqual([15, 15, 11, 11]);
  });

  it('完整一局：createGame → 锁定窗口 → 出牌到 SETTLE → 下一局（集成冒烟）', () => {
    const runHand = (seed: number): GameState => {
      let state = createGame(mulberry32(seed));
      if (state.phase === 'REVEAL') {
        state = applyAction(state, state.doubleSeat as number, { kind: 'PASS' });
      }
      state = autoAdvance(state);
      if (state.phase === 'LOCK_WINDOW') state = resolveLockWindow(state, []);

      let guard = 0;
      while (state.phase === 'PLAYING') {
        if (++guard > 5000) throw new Error('出牌阶段未能结束');
        const seat = state.currentSeat;
        const actions = legalActions(state, seat);
        const action =
          actions.find((item) => item.kind === 'PLAY' && item.cards.length === 1) ??
          actions.find((item) => item.kind === 'PLAY') ??
          actions.find((item) => item.kind === 'PASS');
        if (action === undefined) throw new Error(`座位 ${seat} 没有合法动作`);
        state = applyAction(state, seat, action);
      }
      return state;
    };

    const settled = runHand(1);
    expect(settled.phase).toBe('SETTLE');
    expect(settled.result).not.toBeNull();
    expect(settled.log.some((event) => event.t === 'SETTLE')).toBe(false); // SETTLE 事件由 settleAndNextHand 补

    const next = settleAndNextHand(settled, mulberry32(2));
    expect(next.handNo).toBe(2);
    expect(next.phase === 'REVEAL' || next.phase === 'SUPPLY' || next.phase === 'LOCK_WINDOW').toBe(
      true,
    );
    expect(next.log[0]?.t).toBe('SETTLE');
    const totalCards = next.players.reduce((sum, player) => sum + player.hand.length, 0);
    expect(totalCards).toBe(52);
    const allIds = next.players.flatMap((player) => player.hand.map((card) => card.id));
    expect(new Set(allIds).size).toBe(52);
    if (next.pendingDebt === null) {
      for (const player of next.players) expect(player.hand).toHaveLength(13);
    }
  });

  it('phaseLabel 覆盖全部阶段', () => {
    const labels = (['DEAL', 'REVEAL', 'SUPPLY', 'LOCK_WINDOW', 'PLAYING', 'SETTLE'] as const).map(
      (phase) => phaseLabel(phase),
    );
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('未知');
    }
    expect(phaseLabel('PLAYING')).toBe('出牌');
  });
});
