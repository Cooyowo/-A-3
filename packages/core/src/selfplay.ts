/**
 * 自对弈驱动器（无 IO 的纯逻辑）。
 *
 * 用途：
 * 1. `npm.cmd test` 里的 1000 局回归（不变量断言）；
 * 2. `tools/selfplay` CLI 手动跑；
 * 3. M3 服务端压测/冒烟可复用。
 *
 * 设计约定：
 * - 随机源由调用方注入，同 seed 完全可复现；
 * - 每一步都带死锁保护（步数上限），超限抛错并指出卡在哪个阶段；
 * - 只使用 public API（index.ts 导出的函数），不改引擎内部状态。
 */

import type { Card, Rng } from './cards';
import { holderOf } from './cards';
import {
  applyAction,
  autoAdvance,
  createGame,
  currentReturnPicker,
  resolveLockWindow,
  settleAndNextHand,
} from './state';
import { legalActions } from './legality';
import { activeSeats, lockEligible } from './teams';
import { checkSupplyPossible, defaultReturnCards } from './settle';
import { LANDLORD_3, LANDLORD_A, MAX_REDEAL } from './types';
import type { Action, GameState } from './types';

/** 一局最多允许的状态转移次数（正常一局几百步，超过说明死锁） */
const MAX_STEPS_PER_HAND = 20_000;

export interface SelfplaySummary {
  hands: number;
  /** 双地局数 */
  doubles: number;
  /** 明牌局数 */
  reveals: number;
  /** 平局局数 */
  draws: number;
  /** 总状态转移次数 */
  steps: number;
}

/** 断言：4 家各 13 张、52 张牌不重不漏（发牌完成后） */
export function assertDealInvariants(state: GameState): void {
  const seen = new Set<number>();
  let total = 0;
  for (const player of state.players) {
    if (player.hand.length !== 13) {
      throw new Error(`发牌后座位 ${player.seat} 手牌 ${player.hand.length} 张，应为 13 张`);
    }
    for (const card of player.hand) {
      if (seen.has(card.id)) throw new Error(`牌 id ${card.id} 重复出现`);
      seen.add(card.id);
      total++;
    }
  }
  if (total !== 52 || seen.size !== 52) {
    throw new Error(`牌数守恒被破坏：共 ${total} 张/唯一 ${seen.size} 张，应为 52`);
  }
}

/** 断言：全场 52 张牌不重不漏（手牌 + 供牌池 + 回牌池 + 已提交的回牌；供牌中途也可能成立） */
export function assertTotalCards(state: GameState): void {
  const ids = new Set<number>();
  let total = 0;
  const push = (cards: readonly Card[] | undefined): void => {
    for (const card of cards ?? []) {
      if (ids.has(card.id)) throw new Error(`牌 id ${card.id} 重复出现（handNo=${state.handNo}）`);
      ids.add(card.id);
      total++;
    }
  };

  for (const player of state.players) push(player.hand);
  const context = state.supplyContext;
  if (context !== null) {
    push(context.pool);
    push(context.returnPool);
    for (const cards of context.returns.values()) push(cards);
  }

  if (total !== 52 || ids.size !== 52) {
    throw new Error(`牌数守恒被破坏：共 ${total} 张/唯一 ${ids.size} 张，应为 52（handNo=${state.handNo}）`);
  }
}

function captureLandlordHolders(state: GameState): {
  holder3: number;
  holderA: number;
  redealCount: number;
} {
  const hands = state.players.map((player) => player.hand);
  return {
    holder3: holderOf(hands, LANDLORD_3),
    holderA: holderOf(hands, LANDLORD_A),
    redealCount: state.redealCount,
  };
}
export function assertSupplyInvariants(state: GameState): void {
  const seen = new Set<number>();
  for (const player of state.players) {
    if (player.hand.length !== 13) {
      throw new Error(
        `供牌后座位 ${player.seat} 手牌 ${player.hand.length} 张，应为 13 张（handNo=${state.handNo}）`,
      );
    }
    for (const card of player.hand) {
      if (seen.has(card.id)) throw new Error(`供牌后牌 ${card.id} 重复出现`);
      seen.add(card.id);
    }
  }
  if (seen.size !== 52) throw new Error(`供牌后共 ${seen.size} 张牌，应为 52`);
}

/** 断言：名次唯一，且都在 1..4 */
export function assertRankInvariants(state: GameState): void {
  const ranks = state.players
    .map((player) => player.rank)
    .filter((rank): rank is number => rank !== null);
  if (new Set(ranks).size !== ranks.length) {
    throw new Error(`名次重复：${JSON.stringify(ranks)}`);
  }
  for (const rank of ranks) {
    if (rank < 1 || rank > 4) throw new Error(`名次越界：${rank}`);
  }
  if (state.landlordSeats.length === 2 && ranks.length !== 4) {
    // 非双地必须补满 4 个名次（含提前锁定者）
    throw new Error(`非双地结算后名次数应为 4，实际 ${ranks.length}`);
  }
}

/** 断言：比分符合结算表（《玩法说明》6.2 / 6.3） */
export function assertScoreInvariants(state: GameState): void {
  const result = state.result;
  if (result === null) return;

  if (result.mode === 'NORMAL') {
    if (result.lScore + result.fScore !== 6) {
      throw new Error(`非双地两队总分应为 6，实际 ${result.lScore}:${result.fScore}`);
    }
    if (![0, 2, 4].includes(result.scoreDiff)) {
      throw new Error(`非双地分差只能是 0/2/4，实际 ${result.scoreDiff}`);
    }
    if (result.draw !== (result.scoreDiff === 0)) {
      throw new Error('平局标记与分差不一致');
    }
  } else {
    const key = `${result.lScore}:${result.fScore}`;
    if (!['2:0', '2:1', '0:2'].includes(key)) {
      throw new Error(`双地比分只能是 2:0 / 2:1 / 0:2，实际 ${key}`);
    }
    if (result.draw) throw new Error('双地不应有平局');
  }
}

/** 从候选动作里等概率随机挑一个 */
function pickRandom<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('没有可选的合法动作');
  return items[Math.floor(rng() * items.length)] as T;
}

/** 把一局从当前阶段打到 SETTLE（含 SUPPLY / LOCK_WINDOW / PLAYING 的所有决策） */
export function runHand(state: GameState, rng: Rng): { state: GameState; steps: number } {
  let current = state;
  let steps = 0;

  // 地主牌（♠3 / ♠A）绝不能转手：供牌/回牌前后必须还是同一个座位持有。
  // 注意 REDEAL 会重新发牌，身份合法改变，所以每次重发后要重新取快照。
  let snapshot = captureLandlordHolders(current);

  while (current.phase !== 'SETTLE') {
    if (++steps > MAX_STEPS_PER_HAND) {
      throw new Error(`疑似死锁：handNo=${current.handNo} phase=${current.phase} 超过 ${MAX_STEPS_PER_HAND} 步`);
    }

    const before = current.phase;
    current = autoAdvance(current);

    // REDEAL 后重新发牌 → 重新捕获地主牌持有者
    if (current.redealCount !== snapshot.redealCount) {
      snapshot = captureLandlordHolders(current);
    }

    // 供牌结束、即将进入锁定窗口：此时 4 家必然各 13 张（明牌局不开供牌也是 13 张）
    if (current.phase === 'LOCK_WINDOW') {
      assertSupplyInvariants(current);
      // 只有真的执行了供牌（未明牌）的局，才需要校验地主牌没有转手
      if (current.revealedSeat === null) {
        const hands = current.players.map((player) => player.hand);
        if (holderOf(hands, LANDLORD_3) !== snapshot.holder3) {
          throw new Error(
            `♠3 在供牌环节被转手：原座位 ${snapshot.holder3}，现座位 ${holderOf(hands, LANDLORD_3)}`,
          );
        }
        if (holderOf(hands, LANDLORD_A) !== snapshot.holderA) {
          throw new Error(
            `♠A 在供牌环节被转手：原座位 ${snapshot.holderA}，现座位 ${holderOf(hands, LANDLORD_A)}`,
          );
        }
      }
    }

    if (current.phase !== before) continue;

    switch (current.phase) {
      case 'REVEAL': {
        const seat = current.doubleSeat;
        if (seat === null) throw new Error('REVEAL 阶段却没有双地玩家');
        const debt = current.pendingDebt;
        const deadlocked = debt !== null && !checkSupplyPossible(current, debt);
        if (deadlocked && current.redealCount < MAX_REDEAL) {
          current = applyAction(current, seat, { kind: 'REDEAL' }, rng);
        } else if (deadlocked) {
          current = applyAction(current, seat, { kind: 'REVEAL' });
        } else {
          const action: Action = rng() < 0.35 ? { kind: 'REVEAL' } : { kind: 'PASS' };
          current = applyAction(current, seat, action);
        }
        break;
      }

      case 'SUPPLY': {
        const debt = current.pendingDebt;
        const context = current.supplyContext;
        if (debt === null || context === null) throw new Error('SUPPLY 阶段缺少债务或上下文');

        if (context.step === 'CHECK' && !checkSupplyPossible(current, debt)) {
          const seat = debt.losers[0] as number;
          const action: Action =
            current.redealCount < MAX_REDEAL
              ? pickRandom([{ kind: 'REDEAL' }, { kind: 'REVEAL' }] as Action[], rng)
              : { kind: 'REVEAL' };
          current = applyAction(current, seat, action, rng);
        } else if (context.step === 'RETURN_SELECT') {
          const winner = debt.winners.find((seat) => !context.returns.has(seat));
          if (winner === undefined) throw new Error('RETURN_SELECT 阶段找不到还没交回牌的赢家');
          const count = context.perWinner.get(winner) ?? 0;
          const hand = current.players[winner]?.hand ?? [];
          const returnCards = defaultReturnCards(hand, count);
          current = applyAction(current, winner, { kind: 'RETURN_CARDS', cards: returnCards });
        } else if (context.step === 'RETURN_PICK') {
          // 输家按「上交最大牌」从大到小轮流挑，引擎里有严格轮次校验，
          // 必须用 currentReturnPicker 取当前该挑的人（不能按手牌数猜）
          const picker = currentReturnPicker(current);
          if (picker === null) throw new Error('RETURN_PICK 阶段找不到需要挑牌的输家');
          const card = context.returnPool[0];
          if (card === undefined) throw new Error('RETURN_PICK 阶段回牌池为空');
          current = applyAction(current, picker, { kind: 'PICK_RETURN', card });
        } else {
          throw new Error(`SUPPLY 卡在无法自动推进的步骤：${context.step}`);
        }
        break;
      }

      case 'LOCK_WINDOW': {
        const intents = activeSeats(current).filter((seat) => lockEligible(current, seat) && rng() < 0.3);
        current = resolveLockWindow(current, intents);
        break;
      }

      case 'PLAYING': {
        const actions = legalActions(current, current.currentSeat);
        current = applyAction(current, current.currentSeat, pickRandom(actions, rng));
        break;
      }

      case 'DEAL':
        throw new Error('DEAL 阶段不应停留（应在 createGame/发牌后立即推进）');

      default:
        throw new Error(`未知阶段：${String(current.phase)}`);
    }
  }

  assertRankInvariants(current);
  assertScoreInvariants(current);
  return { state: current, steps };
}

/**
 * 跑 `hands` 局，返回汇总统计。
 * 每局都会断言：发牌守恒、供牌后 13 张、名次唯一、比分符合结算表。
 */
export function runGame(rng: Rng, hands: number): SelfplaySummary {
  const summary: SelfplaySummary = { hands: 0, doubles: 0, reveals: 0, draws: 0, steps: 0 };
  let state = createGame(rng);

  for (let hand = 0; hand < hands; hand++) {
    // 第 1 局没有待执行债务，手牌一定是 4×13；后续各局可能在供牌中途停住（临时 15/11 张），
    // 「各 13 张」的断言统一放在进入 PLAYING 之前的 LOCK_WINDOW 阶段做。
    if (hand === 0) {
      assertDealInvariants(state);
    }
    if (state.doubleSeat !== null) summary.doubles++;
    if (state.revealedSeat !== null) summary.reveals++;

    const outcome = runHand(state, rng);
    summary.steps += outcome.steps;
    summary.hands++;

    if (outcome.state.result?.draw === true) summary.draws++;

    // 明牌局不应有供牌债务（Q-005 / 规则 2.5）
    if (outcome.state.revealedSeat !== null && outcome.state.pendingDebt !== null) {
      throw new Error('明牌局结束后仍存在待执行的供牌债务');
    }

    if (hand < hands - 1) {
      state = settleAndNextHand(outcome.state, rng);
      state = autoAdvance(state);
    }
  }

  return summary;
}
