/**
 * M2 横屏手牌区 v2：HandFan
 *
 * 布局约定（用户要求）：
 * - 横排、水平居中、固定在页面底部，牌底端距页面底端 = 100dvh / 14；
 * - 牌高 = 100dvh * 2/7，牌宽 = 牌高 * 0.71，尺寸全部在 poker.css 里推导；
 * - ≤ 13 张：单排叠放（相邻牌负 margin-left），13 张时总宽正好压到 88vw；
 * - 14~25 张（供牌后 14/15 张、双地明牌赢家 13+12=25 张）：自动分两排，
 *   上排少、下排多，两排各自居中、各自按本排张数叠放（每排总宽 ≤ 88vw），
 *   两排上下重叠 0.38 牌高 → 两排总高 = 1.62 牌高 ≤ 1.9 牌高（不压到操作条）；
 * - 供来的牌用 tintedIds 标出（暖金底 + 金描边），正式开始后父组件传空数组即复原；
 * - 操作条在手牌上方，由 App 的 .strip-wrap 定位（table.css）；HandFan 只负责牌。
 *
 * 叠放公式（写在 poker.css 第 5 节，这里只给每排提供张数间隔 --hand-gaps）：
 *   step       = min(0.94 × 牌宽, (88vw - 牌宽) / (本排张数 - 1))
 *   marginLeft = step - 牌宽          （负值 = 向左叠到前一张牌上）
 * 例：844×390 屏（牌宽 79.1px）
 *   13 张一排 → step = (742.7 - 79.1) / 12 = 55.3px
 *   25 张两排 → 上排 12 张 step = 60.3px；下排 13 张 step = 55.3px
 * 公式留在 CSS 里（而不是用 JS 读 window.innerWidth 算 px），
 * 这样旋转屏幕 / 改窗口大小时会跟着 vw/dvh 自动重算，不需要 resize 监听。
 */

import type { CSSProperties, ReactElement } from 'react';

import type { Card } from '@a3/core';

import { PokerCard } from './PokerCard';

// 手牌样式在 poker.css（PokerCard.tsx 里也 import，重复 import 由构建工具去重）
import '../styles/poker.css';

export interface HandFanProps {
  /** 父组件已按从大到小排好，本组件原样按顺序渲染 */
  cards: Card[];
  /** 选中牌的 id 集合 */
  selectedIds: readonly number[];
  /** 供来的牌 id 集合（命中即渲染成暖金高亮；不传或空数组 = 全部普通牌） */
  tintedIds?: readonly number[];
  /** 点击一张牌时回调（父组件负责 toggle） */
  onToggle: (card: Card) => void;
  /** 禁用时不响应点击（牌仍展示） */
  disabled?: boolean;
}

/** 每一排的牌数分配结果：上排 top，下排 bottom（单排时 top = 0） */
interface RowPlan {
  topCount: number;
  bottomCount: number;
}

/**
 * 把总张数拆成两排：上排少、下排多（下排更靠近玩家拇指，也更宽）。
 * - 单排（≤ 13 张）：全部放「下排」，上排 0 张；
 * - 两排（14~25 张）：下排 = ceil(n/2)，上排 = ceil(n/2) - 1，多出来的 1~2 张给下排。
 *   例：14 → 6 + 8，15 → 7 + 8，25 → 12 + 13。
 */
function planRows(total: number): RowPlan {
  // 用户 2026-11-16 决定：手牌永远单排（两排会挡住桌面中间的文字/按钮）。
  // 张数多（供牌后 14/15/25 张）时靠叠放公式自动压紧，每张仍露出左上角点数+花色。
  void total;
  return { topCount: 0, bottomCount: 0 };
}

export function HandFan({
  cards,
  selectedIds,
  tintedIds,
  onToggle,
  disabled = false,
}: HandFanProps): ReactElement {
  // 空手牌（已经出完）：渲染一个 display:none 的空壳，保持返回类型稳定、也不挡点击
  if (cards.length === 0) {
    return <div className="hand-fan hand-fan--empty" aria-hidden="true" />;
  }

  const selected = new Set<number>(selectedIds);
  const tinted = new Set<number>(tintedIds ?? []);
  const { topCount } = planRows(cards.length);
  const twoRows = topCount > 0;
  // 父组件已从大到小排序：上排先出（先拿到大牌），下排接在后面
  const topCards = twoRows ? cards.slice(0, topCount) : [];
  const bottomCards = cards.slice(topCount);

  /**
   * 渲染一排牌。
   * 只在行容器上写一个 `--hand-gaps`（= 本排张数 - 1，最小 1）供 CSS 公式除，
   * 不直接算 px —— 避免「除以 var() 表达式」在部分浏览器上不生效的问题，
   * 同时让叠放宽度随视口变化自动重算。两排各自按本排张数叠放。
   */
  const renderRow = (rowCards: readonly Card[], key: string): ReactElement => {
    const rowStyle = { '--hand-gaps': Math.max(1, rowCards.length - 1) } as CSSProperties;
    return (
      <div className="hand-fan__row" key={key} data-count={rowCards.length} style={rowStyle}>
        {rowCards.map((card) => (
          <PokerCard
            key={card.id}
            card={card}
            size="hand"
            selected={selected.has(card.id)}
            tinted={tinted.has(card.id)}
            disabled={disabled}
            onClick={() => onToggle(card)}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      className={twoRows ? 'hand-fan hand-fan--2rows' : 'hand-fan'}
      data-rows={twoRows ? '2' : '1'}
      role="group"
      aria-label={`手牌 ${cards.length} 张`}
    >
      {twoRows ? renderRow(topCards, 'top') : null}
      {renderRow(bottomCards, 'bottom')}
    </div>
  );
}
