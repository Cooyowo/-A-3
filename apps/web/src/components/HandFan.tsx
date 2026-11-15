/**
 * M2 横屏手牌区：HandFan
 *
 * 布局约定（用户要求）：
 * - 横排、水平居中、固定在页面底部，牌底端距页面底端 = 100dvh / 14；
 * - 牌高 = 100dvh * 2/7，牌宽 = 牌高 * 0.71，尺寸全部在 poker.css 里推导；
 * - 叠放用「相邻牌负 margin-left」：13 张时总宽正好压到 88vw，
 *   每张露出左侧一条（含左上角标：点数 + 花色），张数 ≤ 5 时几乎不重叠；
 * - 操作条在手牌上方，由 App 的 .strip-wrap 定位（table.css）；手牌 z-index 在它
 *   下面，选中牌上浮时只从按钮后面探出一点，不会挡住「出牌」等按钮。
 *
 * 叠放公式（写在 poker.css 第 5 节，这里只提供张数间隔）：
 *   step       = min(0.94 * 牌宽, (88vw - 牌宽) / (张数 - 1))
 *   marginLeft = step - 牌宽          （负值 = 向左叠到前一张牌上）
 * 例：844×390 屏，牌宽 79.1px、13 张 → step = (742.7 - 79.1) / 12 = 55.3px；
 *     1280×720 屏，牌宽 146.1px、13 张 → step = (1126.4 - 146.1) / 12 = 81.7px。
 * 公式留在 CSS 里（而不是每次用 JS 读 window.innerWidth 算 px），
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
  /** 点击一张牌时回调（父组件负责 toggle） */
  onToggle: (card: Card) => void;
  /** 禁用时不响应点击（牌仍展示） */
  disabled?: boolean;
}

/**
 * 底部手牌扇形排。
 *
 * 说明：这里只在容器上写一个 `--hand-gaps`（= 张数 - 1，最小 1）供 CSS 公式除，
 * 不直接算 px —— 避免「除以 var() 表达式」在部分浏览器上不生效的问题，
 * 同时让叠放宽度随视口变化自动重算。
 */
export function HandFan({ cards, selectedIds, onToggle, disabled = false }: HandFanProps): ReactElement {
  // 空手牌（已经出完）：渲染一个 display:none 的空壳，保持返回类型稳定、也不挡点击
  if (cards.length === 0) {
    return <div className="hand-fan hand-fan--empty" aria-hidden="true" />;
  }

  const selected = new Set<number>(selectedIds);
  // 相邻牌的间隔数：张数 - 1；只有 1 张时不会用到（没有兄弟牌），但仍给 1 避免除零
  const gaps = Math.max(1, cards.length - 1);
  const fanStyle = { '--hand-gaps': gaps } as CSSProperties;

  return (
    <div className="hand-fan" style={fanStyle} role="group" aria-label={`手牌 ${cards.length} 张`}>
      {cards.map((card) => (
        <PokerCard
          key={card.id}
          card={card}
          size="hand"
          selected={selected.has(card.id)}
          disabled={disabled}
          onClick={() => onToggle(card)}
        />
      ))}
    </div>
  );
}
