/**
 * M2 横屏出牌操作条：ActionStrip
 *
 * 纯展示：不 import store、不读写 localStorage、没有任何 JS 定时器
 * （倒计时的数字由父组件传入，脉冲/旋转只是 CSS 动画）。
 *
 * 从左到右严格 5 个元素：不出、提示、剩余时间、出牌、清空。
 * 尺寸：按钮高 = 100dvh * 0.09，字号 clamp(12px, 1.6dvh, 18px)，
 * 手机横屏（高 390~430px）也能一行放下 5 个元素。
 * 位置：App 把它包在 .strip-wrap 里固定到手牌上方（table.css 管「摆在哪」），
 * 本组件只渲染这一行，不自己定位。
 */

import type { ReactElement } from 'react';

// 操作条样式在 poker.css（PokerCard.tsx 里也 import，重复 import 由构建工具去重）
import '../styles/poker.css';

export interface ActionStripProps {
  /** 剩余秒数；null 时只显示计时图标、不显示数字 */
  remainingSeconds: number | null;
  /** 是否在倒计时（图标有轻微脉冲动画） */
  timerActive: boolean;
  onPass(): void;
  onHint(): void;
  onPlay(): void;
  onClear(): void;
  passDisabled?: boolean;
  hintDisabled?: boolean;
  playDisabled?: boolean;
  clearDisabled?: boolean;
}

/**
 * 出牌操作条。
 * 计时器不是按钮（不可点），用 role="img" + aria-label 把「剩余 N 秒」念给屏幕阅读器；
 * 数字本身对读屏隐藏，避免和 aria-label 重复。
 */
export function ActionStrip({
  remainingSeconds,
  timerActive,
  onPass,
  onHint,
  onPlay,
  onClear,
  passDisabled = false,
  hintDisabled = false,
  playDisabled = false,
  clearDisabled = false,
}: ActionStripProps): ReactElement {
  const timerLabel = remainingSeconds === null ? '剩余时间' : `剩余 ${remainingSeconds} 秒`;

  return (
    <div className="action-strip" role="toolbar" aria-label="出牌操作">
      <button type="button" className="as__btn as__btn--ghost" onClick={onPass} disabled={passDisabled}>
        不出
      </button>
      <button type="button" className="as__btn as__btn--ghost" onClick={onHint} disabled={hintDisabled}>
        提示
      </button>

      <span
        className={timerActive ? 'as__timer as__timer--active' : 'as__timer'}
        role="img"
        aria-label={timerLabel}
      >
        <span className="as__ring" aria-hidden="true" />
        {remainingSeconds === null ? null : (
          <span className="as__seconds" aria-hidden="true">
            {remainingSeconds}
          </span>
        )}
      </span>

      <button type="button" className="as__btn as__btn--gold" onClick={onPlay} disabled={playDisabled}>
        出牌
      </button>
      <button type="button" className="as__btn as__btn--ghost" onClick={onClear} disabled={clearDisabled}>
        清空
      </button>
    </div>
  );
}
