/**
 * M2 · 座位小部件（2026-11-16 重排版）
 *
 * 纯展示组件：圆头像 + 剩余张数迷你牌 + 出牌 / 不出 / 闹钟倒计时。
 * 不 import store、没有定时器；倒计时数值由父组件传入。
 *
 * 排版规则（用户 2026-11-16 明确）：
 * - 出牌 /「不出」永远放在**靠牌桌中心的一侧**：
 *     左边玩家 → 头像右边；右边玩家 → 头像左边；上方玩家 → 头像下边；
 * - 闹钟倒计时放在**不与出牌重叠**的位置：
 *     左边玩家 → 头像右上；右边玩家 → 头像左上；上方玩家 → 头像右边；
 * - 「不出」与出牌同一个位置；三者（出牌 / 不出 / 闹钟）互不遮挡。
 *
 * 绝对定位由 App 负责（放哪个角由 slot 决定）。
 */

import type { ReactElement } from 'react';
import type { Card } from '@a3/core';

import { CardBack, CardRow } from './PokerCard';

import '../styles/seat.css';

/** 座位在牌桌上的方位（只影响组件内部朝向，真正定位由 App 的绝对定位容器负责） */
export type SeatSlot = 'top' | 'top-left' | 'top-right';

export interface SeatWidgetProps {
  slot: SeatSlot;
  name: string;
  cardCount: number;
  isActive: boolean;
  isLandlord: boolean;
  medal: 1 | 2 | 3 | null;
  out: boolean;
  /** 本次打出的牌（持久显示）；null 或空数组不显示 */
  playedCards: Card[] | null;
  /** 本次选择了「不出」 */
  passed: boolean;
  /** 倒计时剩余秒数；null 不显示闹钟 */
  countdownSeconds: number | null;
  /** 倒计时总时长，用于环形进度（默认 30 秒） */
  countdownTotal?: number;
}

/** 奖牌配色：金 / 银 / 铜各一套丝带、牌面、描边与数字颜色 */
const MEDAL_TONES: Readonly<
  Record<1 | 2 | 3, { ribbon: string; face: string; edge: string; ink: string }>
> = {
  1: { ribbon: '#b23a2e', face: '#f0c860', edge: '#9a6b1c', ink: '#4a2c00' },
  2: { ribbon: '#2f6f9e', face: '#dbe2ea', edge: '#8b98a5', ink: '#2c3540' },
  3: { ribbon: '#7a4a2b', face: '#d98b4a', edge: '#8f5426', ink: '#3a1c08' },
};

function cx(...names: (string | false)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

function MedalIcon({ rank }: { rank: 1 | 2 | 3 }): ReactElement {
  const tone = MEDAL_TONES[rank];
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6.2 1.8h3.2l2.6 6.2-3.4 1.3z" fill={tone.ribbon} />
      <path d="M17.8 1.8h-3.2l-2.6 6.2 3.4 1.3z" fill={tone.ribbon} opacity="0.82" />
      <circle cx="12" cy="14.6" r="7.6" fill={tone.face} stroke={tone.edge} strokeWidth="1.6" />
      <circle cx="12" cy="14.6" r="5.1" fill="none" stroke={tone.edge} strokeWidth="0.7" opacity="0.55" />
      <text
        x="12"
        y="17.9"
        textAnchor="middle"
        fontSize="8.4"
        fontWeight="800"
        fill={tone.ink}
        fontFamily="inherit"
      >
        {rank}
      </text>
    </svg>
  );
}

const RING_R = 15.5;
const RING_C = 2 * Math.PI * RING_R;

/**
 * 闹钟倒计时：外圈是随时间消退的环形进度条，正中间是剩余秒数。
 * 纯展示：进度由 remaining / total 算出来，没有动画定时器（每秒重新渲染即可）。
 */
export function CountdownClock({
  remaining,
  total,
  size = 'md',
}: {
  remaining: number;
  total: number;
  size?: 'sm' | 'md' | 'lg';
}): ReactElement {
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const offset = RING_C * (1 - ratio);
  return (
    <span className={cx('clock', `clock--${size}`)} role="timer" aria-label={`剩余 ${remaining} 秒`}>
      <svg viewBox="0 0 36 36" className="clock__svg" focusable="false" aria-hidden="true">
        <circle cx="18" cy="18" r={RING_R} className="clock__track" />
        <circle
          cx="18"
          cy="18"
          r={RING_R}
          className="clock__ring"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
          transform="rotate(-90 18 18)"
        />
        {/* 小闹钟的两个「铃铛」耳朵，让它一眼能认成闹钟 */}
        <circle cx="11.5" cy="3.6" r="2.2" className="clock__bell" />
        <circle cx="24.5" cy="3.6" r="2.2" className="clock__bell" />
      </svg>
      <span className="clock__value" aria-hidden="true">
        {remaining}
      </span>
    </span>
  );
}

export function SeatWidget(props: SeatWidgetProps): ReactElement {
  const {
    slot,
    name,
    cardCount,
    isActive,
    isLandlord,
    medal,
    out,
    playedCards,
    passed,
    countdownSeconds,
    countdownTotal = 30,
  } = props;

  const initial = name.trim().charAt(0) || '?';

  // 出牌 / 不出：放在靠近牌桌中心的一侧（具体位置由 seat.css 按 slot 决定）
  let center: ReactElement | null = null;
  if (playedCards !== null && playedCards.length > 0) {
    center = (
      <div className="seat__play">
        <CardRow cards={playedCards} size="played" />
      </div>
    );
  } else if (passed) {
    center = <span className="seat__passed">不出</span>;
  }

  const ariaParts: string[] = [`${name}，剩 ${cardCount} 张`];
  if (isLandlord) ariaParts.push('地主');
  if (medal !== null) ariaParts.push(`第 ${medal} 名`);
  if (out) ariaParts.push('已出完');

  return (
    <section
      className={cx(
        'seat',
        `seat--${slot}`,
        isActive && 'seat--active',
        isLandlord && 'seat--landlord',
        out && 'seat--out',
      )}
      data-slot={slot}
      data-active={isActive ? 'true' : 'false'}
      aria-label={ariaParts.join('，')}
    >
      <div className="seat__avatar-wrap">
        <span className="seat__avatar" aria-hidden="true">
          {initial}
        </span>
        {isLandlord ? (
          <span className="seat__landlord" aria-hidden="true">
            地主
          </span>
        ) : null}
        {medal !== null ? (
          <span className="seat__medal" aria-hidden="true">
            <MedalIcon rank={medal} />
          </span>
        ) : null}
      </div>

      <div className="seat__info">
        <span className="seat__name">{name}</span>
        <span className="seat__count" aria-hidden="true">
          <span className="seat__count-card">
            <CardBack size="mini" />
          </span>
          <span className="seat__count-badge">{cardCount}</span>
        </span>
      </div>

      {center !== null ? <div className="seat__center">{center}</div> : null}

      {countdownSeconds !== null ? (
        <div className="seat__clock">
          <CountdownClock remaining={countdownSeconds} total={countdownTotal} size="md" />
        </div>
      ) : null}
    </section>
  );
}
