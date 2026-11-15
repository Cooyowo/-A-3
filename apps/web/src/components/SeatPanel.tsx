import type { ReactElement } from 'react';

import type { Card } from '@a3/core';

import { CardBack, MiniCardRow } from './CardView';

export interface SeatPanelProps {
  /** 座位名，例如「1 号位」 */
  label: string;
  /** 身份文字，例如「地主方」/「非地主方」/「双地（1 打 3）」/「身份未公开」 */
  identityText: string;
  /** 剩余手牌张数 */
  handCount: number;
  /** 是否轮到这个座位行动（整块金色高亮 + 呼吸） */
  isActive: boolean;
  /** 是否已经提前锁定第 3 名 */
  locked: boolean;
  /** 是否已经出完牌 */
  out: boolean;
  /** 名次 1..4；未确定时为 null */
  rank: number | null;
  /** 座位在牌桌上的方位，用于差异化排版（父组件负责真正摆位） */
  position: 'top' | 'left' | 'right' | 'bottom';
  /** 是否显示牌背小堆；自己那一侧传 false（默认 true） */
  showBack?: boolean;
  /** 明牌 / 锁定公开的牌，用 MiniCardRow 小牌展示 */
  revealedCards?: Card[];
}

/**
 * 一个座位的信息面板：座位名 + 身份 + 剩余张数 + 状态徽章 + 牌背堆 / 公开明牌。
 *
 * 状态优先级（避免同一信息重复出现）：
 * - out   → 「已走完」
 * - locked → 「已锁定第 3 名」（锁定本身就意味着第 3 名，所以不再重复显示「第 3 名」）
 * - rank !== null 且未 locked → 「第 N 名」
 *
 * 面板本身是纯展示，点击行为（比如点座位切视角）由父组件用外层元素包裹。
 */
export function SeatPanel({
  label,
  identityText,
  handCount,
  isActive,
  locked,
  out,
  rank,
  position,
  showBack = true,
  revealedCards,
}: SeatPanelProps): ReactElement {
  const revealed = revealedCards ?? [];
  const badges: ReactElement[] = [];

  if (out) {
    badges.push(
      <span className="seat__badge seat__badge--out" key="out">
        已走完
      </span>,
    );
  }
  if (locked) {
    badges.push(
      <span className="seat__badge seat__badge--locked" key="locked">
        已锁定第 3 名
      </span>,
    );
  }
  if (rank !== null && !locked) {
    badges.push(
      <span className="seat__badge seat__badge--rank" key="rank">
        第 {rank} 名
      </span>,
    );
  }

  const hasFoot = (showBack && handCount > 0) || revealed.length > 0;

  return (
    <section
      className={[
        'seat',
        isActive ? 'seat--active' : '',
        out ? 'seat--out' : '',
        locked ? 'seat--locked' : '',
      ]
        .filter((name) => name.length > 0)
        .join(' ')}
      data-position={position}
      data-active={isActive ? 'true' : 'false'}
      aria-label={`${label}，${identityText}，剩 ${handCount} 张`}
    >
      <header className="seat__head">
        <span className="seat__label">{label}</span>
        {isActive ? <span className="seat__turn">行动中</span> : null}
      </header>

      <p className="seat__identity">{identityText}</p>

      <p className="seat__count">
        剩 <strong>{handCount}</strong> 张
      </p>

      {badges.length > 0 ? <div className="seat__badges">{badges}</div> : null}

      {hasFoot ? (
        <div className="seat__foot">
          {showBack && handCount > 0 ? <CardBack size="sm" count={handCount} /> : null}
          {revealed.length > 0 ? (
            <div className="seat__revealed">
              <MiniCardRow cards={revealed} size="sm" emptyText="无" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
