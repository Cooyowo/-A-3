import { containsCards } from './cards';
import type { Card } from './cards';
import { canFollow } from './compare';
import { identifyPattern } from './patterns';
import type { Action, GameState, Pattern } from './types';

/** 三条 / 三条夹一（受使用限制的两个牌型） */
function isTripleLike(pattern: Pattern): boolean {
  return pattern.type === 'TRIPLE' || pattern.type === 'TRIPLE_ONE';
}

/**
 * 当前是否处于「领出」。
 *
 * 常规情况：`topPattern === null` 即自由领出。
 * 三条阶段特殊：一墩结束时 `topPattern` 被保留为「基准牌」（Q-023），
 * 此时由最后出牌者（`topSeat`）继续领出——虽然 `topPattern` 不为 null，
 * 但 `currentSeat === topSeat` 说明本轮没人再表态，属于领出。
 */
function isLeading(state: GameState): boolean {
  if (state.topPattern === null) return true;
  return state.threePhase && state.topSeat !== null && state.currentSeat === state.topSeat;
}

/**
 * 三条 / 三条夹一 能否出现（《玩法说明》3.5 + 5.7 + open-questions Q-023 / Q-024 / Q-026）。
 *
 * 只有三种场合可以出：
 * 1. 本局第一手，且由首发座位打出（state.isFirstPlay && isLeading && seat === state.firstSeat）；
 * 2. 三条阶段内（state.threePhase 为 true）；
 * 3. 结束牌：领出时手上恰好只剩这一手牌（isLeading && hand.length === pattern.cards.length）。
 *
 * 注意：这里只判断「类型能不能出现」，压牌大小由 canFollow 判断。
 * 顺风会结束三条阶段（Q-024），所以顺风后 threePhase 为 false，新领出者不能再出三条。
 */
export function canPlayTripleLike(
  state: GameState,
  seat: number,
  pattern: Pattern,
  isLeading: boolean,
): boolean {
  if (!isTripleLike(pattern)) return true;

  // 1) 本局第一手，且必须是首发座位本人（Q-026）
  if (state.isFirstPlay && isLeading && seat === state.firstSeat) return true;

  // 2) 三条阶段内（跟牌 / 领出均可）
  if (state.threePhase) return true;

  // 3) 结束牌：领出时手上恰好只剩这一手（《玩法说明》3.5 第 3 条 / Q-027 / Q-028 / Q-083）
  const player = state.players[seat];
  if (isLeading && player !== undefined && player.hand.length === pattern.cards.length) {
    return true;
  }

  return false;
}

/** 枚举手牌里所有 1~5 张组合交给回调（按张数递增顺序，天然去重） */
function forEachCombo(hand: readonly Card[], callback: (cards: Card[]) => void): void {
  const chosen: Card[] = [];
  const walk = (start: number): void => {
    if (chosen.length > 0) callback([...chosen]);
    if (chosen.length >= 5) return;
    for (let i = start; i < hand.length; i += 1) {
      chosen.push(hand[i] as Card);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
}

/**
 * 合法动作枚举（《开发文档》第 6 节）。
 *
 * 规则：
 * - `state.phase !== 'PLAYING'` 或 `seat !== state.currentSeat` → 返回 []。
 * - 领出（isLeading = topPattern === null）：
 *   枚举手牌里所有 1~5 张、能 identifyPattern 的组合；
 *   过滤掉不该出现的三条/三条夹一（canPlayTripleLike）；
 *   若仍处于三条阶段（threePhase），三条/三条夹一还必须能压过 topPattern 基准；
 *   其它牌型随时可领出。
 * - 跟牌：枚举所有能识别的组合，必须 canFollow(pattern, topPattern)；
 *   三条/三条夹一还要 canPlayTripleLike；此外追加 `{ kind: 'PASS' }`。
 * - 枚举量上限约 C(13,1..5) = 2379 组合，可接受。
 */
export function legalActions(state: GameState, seat: number): Action[] {
  if (state.phase !== 'PLAYING') return [];
  if (seat !== state.currentSeat) return [];

  const player = state.players[seat];
  // 已出完 / 已提前锁定的人没有任何动作（Q-030）
  if (player === undefined || player.out || player.hand.length === 0) return [];

  const leading = isLeading(state);
  const top = state.topPattern;
  const actions: Action[] = [];

  forEachCombo(player.hand, (cards) => {
    const pattern = identifyPattern(cards);
    if (pattern === null) return;

    const tripleLike = isTripleLike(pattern);
    let ok: boolean;

    if (leading) {
      if (tripleLike) {
        // Q-023：三条阶段内领出的三条/三条夹一必须压过基准牌；其它情况由 canPlayTripleLike 决定
        ok = canPlayTripleLike(state, seat, pattern, true);
        if (ok && state.threePhase && top !== null) ok = canFollow(pattern, top);
      } else {
        // Q-023：领出者可以改打任意其它合法牌型，并立即结束三条阶段
        ok = true;
      }
    } else {
      // 跟牌：必须压过当前牌；三条/三条夹一还要满足出现场合
      ok =
        top !== null &&
        canFollow(pattern, top) &&
        (!tripleLike || canPlayTripleLike(state, seat, pattern, false));
    }

    if (ok) actions.push({ kind: 'PLAY', cards });
  });

  // 领出时不能 PASS（Q-022）
  if (!leading) actions.push({ kind: 'PASS' });

  return actions;
}

/**
 * 校验一手具体牌是否可出（服务端动作校验用）。
 * ok=false 时 reason 给出中文原因，便于 UI 提示与测试断言。
 */
export function validatePlay(
  state: GameState,
  seat: number,
  cards: readonly Card[],
): { ok: boolean; reason: string } {
  if (state.phase !== 'PLAYING') return { ok: false, reason: '当前阶段不能出牌' };

  const player = state.players[seat];
  if (player === undefined) return { ok: false, reason: '座位号非法' };
  if (seat !== state.currentSeat) return { ok: false, reason: '还没轮到你出牌' };
  if (player.out) return { ok: false, reason: '该玩家已出完或已提前锁定，不能出牌' };

  if (cards.length === 0) return { ok: false, reason: '必须至少出一张牌' };
  if (cards.length > 5) return { ok: false, reason: '一手牌最多 5 张' };

  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    return { ok: false, reason: '出牌中存在重复的牌' };
  }
  if (!containsCards(player.hand, cards)) {
    return { ok: false, reason: '出牌的牌不在手上' };
  }

  const pattern = identifyPattern(cards);
  if (pattern === null) return { ok: false, reason: '无法识别的牌型' };

  const leading = isLeading(state);
  if (!canPlayTripleLike(state, seat, pattern, leading)) {
    return {
      ok: false,
      reason: '三条/三条夹一此时不能出（只能在本局第一手、三条阶段内或作为结束牌）',
    };
  }

  const top = state.topPattern;
  if (leading) {
    // 三条阶段内领出三条/三条夹一并不能降维、不能更小（Q-023）
    if (state.threePhase && top !== null && isTripleLike(pattern) && !canFollow(pattern, top)) {
      return { ok: false, reason: '三条阶段内领出三条/三条夹一必须压过当前基准牌' };
    }
  } else {
    if (top === null) return { ok: false, reason: '没有需要压过的牌' };
    if (!canFollow(pattern, top)) {
      return { ok: false, reason: '必须打出同大类且能压过当前牌的牌型' };
    }
  }

  return { ok: true, reason: '' };
}
