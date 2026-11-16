/**
 * M2 横屏出牌操作条 v3：ActionStrip
 *
 * 2026-11-16 用户定：
 * - 顺序改为【倒计时、不出、提示、出牌、清空】；
 * - 手里没有能压过的牌时，不显示「出牌」与「清空」，只留【倒计时、不出、提示】；
 * - 所有按钮尺寸统一（含挑回牌的「选这张」也复用这里的高度变量）。
 *
 * 纯展示：不 import store、没有定时器；倒计时数字由父组件传入。
 */

import type { ReactElement } from 'react';

import '../styles/poker.css';

export interface ActionStripProps {
  remainingSeconds: number | null;
  timerActive: boolean;
  onPass(): void;
  onHint(): void;
  onPlay(): void;
  onClear(): void;
  passDisabled?: boolean;
  hintDisabled?: boolean;
  playDisabled?: boolean;
  clearDisabled?: boolean;
  /** 手里有没有任何能出的牌：false 时隐藏「出牌」和「清空」 */
  hasPlayablePlay?: boolean;
}

function cx(...names: (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

const LOW_TIME_SECONDS = 5;

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
  hasPlayablePlay = true,
}: ActionStripProps): ReactElement {
  const timerLabel = remainingSeconds === null ? '剩余时间' : `剩余 ${remainingSeconds} 秒`;
  const lowTime = remainingSeconds !== null && remainingSeconds <= LOW_TIME_SECONDS;

  return (
    <div className="action-strip" role="toolbar" aria-label="出牌操作">
      <span
        className={cx('as__timer', timerActive && 'as__timer--active', lowTime && 'as__timer--low')}
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

      <button type="button" className="as__btn as__btn--ghost" onClick={onPass} disabled={passDisabled}>
        不出
      </button>
      <button type="button" className="as__btn as__btn--ghost" onClick={onHint} disabled={hintDisabled}>
        提示
      </button>

      {hasPlayablePlay ? (
        <>
          <button type="button" className="as__btn as__btn--gold" onClick={onPlay} disabled={playDisabled}>
            出牌
          </button>
          <button type="button" className="as__btn as__btn--ghost" onClick={onClear} disabled={clearDisabled}>
            清空
          </button>
        </>
      ) : null}
    </div>
  );
}
