import { holderOf } from './cards';
import { LANDLORD_3, LANDLORD_A, type GameState, type PlayerState } from './types';

/**
 * 身份与队伍（《玩法说明》2.1~2.3）。
 * 持 ♠3 的人 + 持 ♠A 的人 = 地主方；两张在同一人手里 → 双地（地主方只有 1 人）。
 *
 * - 非双地：`landlordSeats` 为两个座位，按座位号升序；`doubleSeat = null`。
 * - 双地：`landlordSeats = [seat]`，`doubleSeat = seat`。
 * - 地主牌理论上永远在场上；若构造出缺少地主牌的状态，则返回能找到的部分座位（防御）。
 */
export function computeIdentity(
  players: readonly PlayerState[],
): { landlordSeats: number[]; doubleSeat: number | null } {
  const hands = players.map((player) => player.hand);
  const seatOf3 = holderOf(hands, LANDLORD_3);
  const seatOfA = holderOf(hands, LANDLORD_A);

  // 防御：地主牌不在任何一家手里（正常对局不会发生）
  if (seatOf3 === -1 && seatOfA === -1) return { landlordSeats: [], doubleSeat: null };
  if (seatOf3 === -1) return { landlordSeats: [seatOfA], doubleSeat: null };
  if (seatOfA === -1) return { landlordSeats: [seatOf3], doubleSeat: null };

  // 双地：两张地主牌在同一人手里
  if (seatOf3 === seatOfA) return { landlordSeats: [seatOf3], doubleSeat: seatOf3 };

  // 非双地：地主方两人，座位号升序（与 GameState.landlordSeats 的约定一致）
  const landlordSeats = seatOf3 < seatOfA ? [seatOf3, seatOfA] : [seatOfA, seatOf3];
  return { landlordSeats, doubleSeat: null };
}

/** 名次分：1→3, 2→2, 3→1, 4→0；未定名次为 0 */
export function rankScore(rank: number | null): number {
  switch (rank) {
    case 1:
      return 3;
    case 2:
      return 2;
    case 3:
      return 1;
    case 4:
      return 0;
    default:
      // null（未定名次）/ 越界值一律 0
      return 0;
  }
}

/** 该座位是否属于地主方 */
export function isLandlordSeat(landlordSeats: readonly number[], seat: number): boolean {
  return landlordSeats.includes(seat);
}

/** 仍在场的座位（!out），按座位号升序 */
export function activeSeats(state: GameState): number[] {
  return state.players
    .filter((player) => !player.out)
    .map((player) => player.seat)
    .sort((a, b) => a - b);
}

/**
 * 提前锁定资格（《玩法说明》8.1 + open-questions Q-054）：
 * 未出完 && 手牌正好 13 张 && 全部 <= 10（即没有任何 J/Q/K/A/2/3）。
 *
 * 注意判定与身份无关：地主方必持 ♠3 或 ♠A（rank > 10），天然不合格（Q-010）。
 */
export function lockEligible(state: GameState, seat: number): boolean {
  const player = state.players[seat];
  if (player === undefined) return false;
  if (player.out) return false;
  if (player.hand.length !== 13) return false;
  return player.hand.every((card) => card.rank <= 10);
}
