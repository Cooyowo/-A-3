import type { ReactElement } from 'react';

import { RANK_LABEL, SUIT_SYMBOL, cardToText } from '@a3/core';
import type { Card } from '@a3/core';

// 牌面视觉样式（HandView / SeatPanel / TableCenter 复用这一份，不重复 import）
import '../styles/cards.css';

/** 三档尺寸：小 44 / 中 56 / 大 72px（手机上 cards.css 会整体再收一档） */
export type CardSize = 'sm' | 'md' | 'lg';

export interface CardViewProps {
  card: Card;
  /** 默认 'md' */
  size?: CardSize;
  /** 选中态：金色描边 + 上移 */
  selected?: boolean;
  /** 变暗：仍在展示但弱化（例如不可用的牌） */
  dimmed?: boolean;
  /** 半透明 + 不可点 */
  disabled?: boolean;
  /** 传了才会渲染成 <button>，否则是纯展示的 role="img" */
  onClick?: () => void;
}

export interface CardBackProps {
  /** 默认 'md' */
  size?: CardSize;
  /** 一叠几张，> 1 时叠一层牌背并显示数字角标 */
  count?: number;
}

export interface MiniCardRowProps {
  cards: Card[];
  /** 默认 'sm' */
  size?: CardSize;
  /** 没有牌时显示的文字，默认「无」 */
  emptyText?: string;
}

/** 拼接 className，自动丢掉 false / '' 项 */
function cx(...names: (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

/** ♥♦ 是红色，♣♠ 是深色（花色编码：♦1 ♣2 ♥3 ♠4） */
function suitColorClass(card: Card): string {
  return card.suit === 1 || card.suit === 3 ? 'card--red' : 'card--black';
}

/**
 * 牌面的「内容层」：左上角 + 右下角各一组「点数 / 花色」，中间一个半透明花色水印。
 * 纯 CSS 绘制，不依赖图片；文字用 Unicode 花色符号（♦♣♥♠）渲染。
 */
function CardFace({ card }: { card: Card }): ReactElement {
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_SYMBOL[card.suit];
  return (
    <>
      <span className="card__corner card__corner--tl" aria-hidden="true">
        <span className="card__rank">{rank}</span>
        <span className="card__suit">{suit}</span>
      </span>
      <span className="card__pip" aria-hidden="true">
        {suit}
      </span>
      <span className="card__corner card__corner--br" aria-hidden="true">
        <span className="card__rank">{rank}</span>
        <span className="card__suit">{suit}</span>
      </span>
    </>
  );
}

/**
 * 单张牌。
 * - 传 onClick → 渲染 <button type="button">，供手牌 / 回牌池点选，带 aria-label（如「♠J」）与 aria-pressed；
 * - 不传 onClick → 渲染纯展示 <div role="img">，避免屏幕阅读器把它当按钮。
 * 尺寸通过 --card-w 驱动（cards.css），三档自动等比缩放，无内联样式。
 */
export function CardView({
  card,
  size = 'md',
  selected = false,
  dimmed = false,
  disabled = false,
  onClick,
}: CardViewProps): ReactElement {
  const label = cardToText(card);
  const className = cx(
    'card',
    `card--${size}`,
    suitColorClass(card),
    selected && 'card--selected',
    dimmed && 'card--dimmed',
    disabled && 'card--disabled',
    onClick !== undefined && 'card--interactive',
  );

  if (onClick === undefined) {
    return (
      <div className={className} role="img" aria-label={label} data-size={size} data-card-id={card.id}>
        <CardFace card={card} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      data-size={size}
      data-card-id={card.id}
    >
      <CardFace card={card} />
    </button>
  );
}

/**
 * 牌背（纯装饰）：深色斜纹渐变 + 中央「葵」字。
 * count > 1 时往右下错开一层做出「一叠牌」的厚度，并显示数量角标。
 */
export function CardBack({ size = 'md', count }: CardBackProps): ReactElement {
  const stacked = count !== undefined && count > 1;
  const label = count !== undefined && count > 0 ? `牌背 ×${count}` : '牌背';
  return (
    <span
      className={cx('card-back', `card--${size}`, stacked && 'card-back--stack')}
      role="img"
      aria-label={label}
      data-size={size}
    >
      <span className="card-back__face" aria-hidden="true" />
      <span className="card-back__mark" aria-hidden="true">
        葵
      </span>
      {stacked ? (
        <span className="card-back__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 一排小牌：供牌池 / 回牌池 / 最近一手 / 公开牌。
 * 用 flex-wrap 自动换行（而不是横向滚动），小屏放大牌量也不会撑破容器；
 * 空数组时渲染 emptyText（默认「无」），避免出现高度塌陷的空白块。
 */
export function MiniCardRow({ cards, size = 'sm', emptyText = '无' }: MiniCardRowProps): ReactElement {
  if (cards.length === 0) {
    return <span className="mini-row__empty">{emptyText}</span>;
  }
  return (
    <div className="mini-row" data-size={size}>
      {cards.map((card) => (
        <CardView key={card.id} card={card} size={size} />
      ))}
    </div>
  );
}
