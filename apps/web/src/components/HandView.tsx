import type { ReactElement } from 'react';

import type { Card } from '@a3/core';

import { CardView } from './CardView';
import type { CardSize } from './CardView';

export interface HandViewProps {
  /** 已经排好序的牌（父组件负责排序，本组件原样按顺序渲染） */
  cards: Card[];
  /** 选中牌的 id 集合 */
  selectedIds?: readonly number[];
  /** 是否允许点选；false / 不传时牌不可点 */
  selectable?: boolean;
  /** 点击一张牌时回调（父组件负责 toggle） */
  onToggle?: (card: Card) => void;
  /** 默认 'md'；手机上会被 cards.css 自动收窄一档 */
  size?: CardSize;
  /** 空手牌提示，默认「没有手牌」 */
  emptyText?: string;
}

/**
 * 手牌横向排。
 *
 * 布局取舍（手机竖屏 375px 优先）：
 * - 牌叠放用「相邻兄弟负 margin-left」而不是绝对定位，首张牌左边缘不会被裁切，
 *   末张牌右侧也参与父容器宽度计算；
 * - 牌多（>= 7 张）时叠放约 55%，13 张 × 约 22px 步进 ≈ 一屏宽，一眼看全；
 *   md 档在 ≤430px 时从 56px 自动降到 44px；
 * - 外层 .hand__track 允许横向滚动兜底（超大字号 / 超窄屏时仍不撑破页面）；
 *   track 只设 overflow-x，上下用 padding 兜住「选中上移 + 阴影」，不会被裁切。
 */
export function HandView({
  cards,
  selectedIds,
  selectable = false,
  onToggle,
  size = 'md',
  emptyText = '没有手牌',
}: HandViewProps): ReactElement {
  // 空手牌：用一个轻量提示占位，父组件不必自己判断
  if (cards.length === 0) {
    return <p className="hand__empty">{emptyText}</p>;
  }

  const selected = new Set<number>(selectedIds ?? []);
  // 牌数达到 7 张就进入「密集叠放」，避免 13 张手牌撑出屏幕
  const dense = cards.length >= 7;
  const interactive = selectable && onToggle !== undefined;

  return (
    <div className={dense ? 'hand hand--dense' : 'hand'} data-size={size}>
      <ul className="hand__track" aria-label="手牌">
        {cards.map((card) => (
          <li className="hand__item" key={card.id}>
            <CardView
              card={card}
              size={size}
              selected={selected.has(card.id)}
              onClick={interactive ? () => onToggle(card) : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
