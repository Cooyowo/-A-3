/**
 * M2 横屏牌面组件：PokerCard / CardBack / CardRow
 *
 * 纯展示组件：不 import store、不读写 localStorage、没有任何定时器，
 * 所有状态都从 props 来（点击只把回调抛给上层）。
 *
 * 尺寸（页面按横屏设计，100dvh = 屏幕高度，全部在 poker.css 里推导）：
 *   手牌 .pk--hand   : 牌高 = 100dvh * 2/7       ≈ 屏幕高 28.6%（用户要求的「大牌」）
 *   打出 .pk--played : 牌高 = 手牌高 * 0.58      （「展示牌一半多一点」）
 *   小牌 .pk--mini   : 牌高 = 100dvh * 0.09      （座位旁 / 面板里的小牌）
 *   牌宽一律 = 牌高 * 0.71（标准扑克 2.5:3.5 ≈ 1:0.714）
 * 三档都提供 --pk-h / --pk-w 两个自定义属性，外部可在祖先上覆盖
 * --hand-card-h / --played-card-h / --mini-card-h，或直接给牌元素写 inline 的 --pk-h。
 *
 * 牌面纯 CSS 绘制（无图片）：白/米白底 + 圆角 + 细深色描边 + 内高光；
 * 中央「大点数 + 大花色」竖排（两者高度之和 ≈ 牌高 50%），左上角另有小角标
 * （手牌叠放时只露出左侧一条，全靠它认牌）；♥♦ 红、♠♣ 近黑。
 */

import type { CSSProperties, ReactElement } from 'react';

import { RANK_LABEL, SUIT_SYMBOL, cardToText } from '@a3/core';
import type { Card } from '@a3/core';

// 牌面 / 牌背 / 小牌行 / 手牌 / 操作条的样式都在这份文件里（其余组件复用同一份）
import '../styles/poker.css';

/** 三档尺寸：手牌 → 打出的牌（约 58%）→ 面板小牌 */
export type PokerCardSize = 'hand' | 'played' | 'mini';

export interface PokerCardProps {
  card: Card;
  /** 默认 'mini'；手牌传 'hand'，桌面中央打出的牌传 'played' */
  size?: PokerCardSize;
  /** 选中：上浮 + 金色描边/光晕 */
  selected?: boolean;
  /** 变暗：还在展示但弱化（例如提示里不是主牌、不可用的牌） */
  dimmed?: boolean;
  /** 禁用：更淡且不可点 */
  disabled?: boolean;
  /** 传了才渲染 <button type="button">，否则渲染 role="img" 的纯展示牌 */
  onClick?: () => void;
  className?: string;
  /** 布局用内联样式（HandFan 用它写叠放负 margin） */
  style?: CSSProperties;
}

export interface CardBackProps {
  /** 默认 'mini' */
  size?: PokerCardSize;
  /** 一叠几张；> 1 时往右下错开一层做厚度感，并在右下角显示张数 */
  count?: number;
  className?: string;
}

export interface CardRowProps {
  /** 一行小牌；空数组时渲染 emptyText（默认「—」） */
  cards: readonly Card[];
  /** 默认 'mini' */
  size?: PokerCardSize;
  /** 没有牌时显示的文字，默认「—」 */
  emptyText?: string;
  className?: string;
  /** 需要点选时传（例如回牌池挑牌）；不传则全部是纯展示牌 */
  onCardClick?: (card: Card) => void;
  /** 选中牌的 id 集合（配合 onCardClick 做点选高亮） */
  selectedIds?: readonly number[];
}

/** 拼接 className，自动丢掉 false / undefined / 空串 */
function cx(...names: (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

/** 花色着色：♦(1) ♥(3) 红，♣(2) ♠(4) 近黑 */
function suitTone(card: Card): string {
  return card.suit === 1 || card.suit === 3 ? 'pk--red' : 'pk--black';
}

/**
 * 牌面内容层：
 * - 左上角小角标（点数在上、花色在下），手牌叠放时靠它辨认；
 * - 中央大点数 + 大花色竖排（两者高度之和 ≈ 牌高 50%）。
 * 全部 aria-hidden：整张牌的可读名称由外层 aria-label 统一提供。
 */
function CardFace({ card }: { card: Card }): ReactElement {
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_SYMBOL[card.suit];
  return (
    <>
      <span className="pk__corner" aria-hidden="true">
        <span className="pk__corner-rank">{rank}</span>
        <span className="pk__corner-suit">{suit}</span>
      </span>
      <span className="pk__center" aria-hidden="true">
        <span className="pk__rank">{rank}</span>
        <span className="pk__suit">{suit}</span>
      </span>
    </>
  );
}

/**
 * 单张牌。
 * - 传 onClick → <button type="button">（手牌 / 回牌池点选），带 aria-label（如「♠J」）与 aria-pressed；
 * - 不传 onClick → <div role="img">，避免屏幕阅读器把纯展示牌读成按钮。
 */
export function PokerCard({
  card,
  size = 'mini',
  selected = false,
  dimmed = false,
  disabled = false,
  onClick,
  className,
  style,
}: PokerCardProps): ReactElement {
  const label = cardToText(card);
  const classes = cx(
    'pk',
    `pk--${size}`,
    suitTone(card),
    selected && 'pk--selected',
    dimmed && 'pk--dimmed',
    disabled && 'pk--disabled',
    onClick !== undefined && 'pk--interactive',
    className,
  );
  const common = {
    className: classes,
    style,
    'data-size': size,
    'data-card-id': card.id,
  } as const;

  if (onClick === undefined) {
    return (
      <div {...common} role="img" aria-label={label}>
        <CardFace card={card} />
      </div>
    );
  }

  return (
    <button
      {...common}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <CardFace card={card} />
    </button>
  );
}

/**
 * 牌背（纯装饰）：深蓝牌背 + 金色斜纹 + 中央「葵」。
 * count > 1 时往右下错开叠一层做出厚度感，右下角金色小药丸显示张数。
 */
export function CardBack({ size = 'mini', count, className }: CardBackProps): ReactElement {
  const stacked = count !== undefined && count > 1;
  const label = count !== undefined && count > 0 ? `牌背 ${count} 张` : '牌背';
  return (
    <span className={cx('pk-back', `pk--${size}`, stacked && 'pk-back--stack', className)} role="img" aria-label={label}>
      <span className="pk-back__face" aria-hidden="true" />
      <span className="pk-back__mark" aria-hidden="true">
        葵
      </span>
      {stacked ? (
        <span className="pk-back__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 一行小牌（可换行）：最近一手 / 供牌池 / 回牌池 / 结算面板都用它。
 * 用 flex-wrap 自动换行（不是横向滚动），小屏放 13 张也不会撑破容器；
 * 空数组时渲染 emptyText（默认「—」），避免出现高度塌陷的空白块。
 */
export function CardRow({
  cards,
  size = 'mini',
  emptyText = '—',
  className,
  onCardClick,
  selectedIds,
}: CardRowProps): ReactElement {
  if (cards.length === 0) {
    return <span className={cx('pk-row__empty', className)}>{emptyText}</span>;
  }

  const selected = selectedIds === undefined ? null : new Set<number>(selectedIds);

  return (
    <div className={cx('pk-row', className)} data-size={size}>
      {cards.map((card) => (
        <PokerCard
          key={card.id}
          card={card}
          size={size}
          selected={selected?.has(card.id) ?? false}
          onClick={onCardClick === undefined ? undefined : () => onCardClick(card)}
        />
      ))}
    </div>
  );
}
