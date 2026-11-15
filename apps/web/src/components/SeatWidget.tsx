/**
 * M2 横屏斗地主风 · 座位小部件
 *
 * 纯展示组件：圆头像 + 剩余张数迷你牌 + 出牌 / 不出 / 倒计时。
 * 不 import store、没有任何定时器；倒计时数值与是否进行中都由父组件传入，
 * 圆环的「转圈」动画完全交给 CSS（seat.css）。
 *
 * 内部排版（从上到下，越靠下越靠近牌桌中心）：
 *   ① 头像：右上角「地主」金色徽标（仅公开地主时）、右下角金/银/铜奖牌
 *   ② 一行小字：座位名 + 小牌背（数字角标 = 剩余张数）
 *   ③ 中心区：本次打出的牌 /「不出」/ 倒计时圆环（三者互斥，优先级同左）
 *
 * 绝对定位由 App 负责（放哪个角由 slot 决定）；本组件只保证内部排版，
 * 并按 slot 对「中心区」做一点朝向偏移（左上向右下探、右上向左下探）。
 */

import type { ReactElement } from 'react';
import type { Card } from '@a3/core';

import { CardBack, CardRow } from './PokerCard';

import '../styles/seat.css';

/** 座位在牌桌上的方位（只影响组件内部朝向，真正定位由 App 的绝对定位容器负责） */
export type SeatSlot = 'top' | 'top-left' | 'top-right';

export interface SeatWidgetProps {
  /** 座位所在方位 */
  slot: SeatSlot;
  /** 座位名，例如「1 号位」 */
  name: string;
  /** 剩余手牌张数 */
  cardCount: number;
  /** 是否轮到他行动（头像金圈 + 呼吸） */
  isActive: boolean;
  /** 是否已公开的地主：true 才显示金色「地主」徽标，非地主 / 未公开不显示任何身份文字 */
  isLandlord: boolean;
  /** 打完的名次：1/2/3 → 金/银/铜牌；null 不显示 */
  medal: 1 | 2 | 3 | null;
  /** 已出完牌：头像压暗，但奖牌保持清晰 */
  out: boolean;
  /** 本次打出的牌（持久显示）；null 或空数组不显示 */
  playedCards: Card[] | null;
  /** 本次选择了「不出」 */
  passed: boolean;
  /** 倒计时剩余秒数；null 不显示倒计时 */
  countdownSeconds: number | null;
  /** 倒计时是否进行中（驱动圆环动画） */
  countdownActive: boolean;
}

/** 奖牌配色：金 / 银 / 铜各一套丝带、牌面、描边与数字颜色 */
const MEDAL_TONES: Readonly<
  Record<1 | 2 | 3, { ribbon: string; face: string; edge: string; ink: string }>
> = {
  1: { ribbon: '#b23a2e', face: '#f0c860', edge: '#9a6b1c', ink: '#4a2c00' },
  2: { ribbon: '#2f6f9e', face: '#dbe2ea', edge: '#8b98a5', ink: '#2c3540' },
  3: { ribbon: '#7a4a2b', face: '#d98b4a', edge: '#8f5426', ink: '#3a1c08' },
};

/** 拼接 className，自动丢掉 false 项 */
function cx(...names: (string | false)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

/**
 * 名次奖牌（纯内联 SVG，24×24 视窗）：
 * 两条丝带 + 一枚圆形奖牌 + 名次数字。只表达「第几名」，不出现文字。
 * 无障碍名称交给外层 SeatWidget 的 aria-label，这里对读屏器隐藏。
 */
function MedalIcon({ rank }: { rank: 1 | 2 | 3 }): ReactElement {
  const tone = MEDAL_TONES[rank];
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6.2 1.8h3.2l2.6 6.2-3.4 1.3z" fill={tone.ribbon} />
      <path d="M17.8 1.8h-3.2l-2.6 6.2 3.4 1.3z" fill={tone.ribbon} opacity="0.82" />
      <circle cx="12" cy="14.6" r="7.6" fill={tone.face} stroke={tone.edge} strokeWidth="1.6" />
      <circle
        cx="12"
        cy="14.6"
        r="5.1"
        fill="none"
        stroke={tone.edge}
        strokeWidth="0.7"
        opacity="0.55"
      />
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

/** 倒计时：圆形进度环 + 秒数；active 时圆环旋转（CSS 动画，无 JS 定时器） */
function CountdownRing({ seconds, active }: { seconds: number; active: boolean }): ReactElement {
  return (
    <span
      className={cx('seat__timer', active && 'seat__timer--active')}
      role="timer"
      aria-label={`倒计时 ${seconds} 秒`}
    >
      <span className="seat__timer-ring" aria-hidden="true" />
      <span className="seat__timer-value" aria-hidden="true">
        {seconds}
      </span>
    </span>
  );
}

/**
 * 座位小部件。
 *
 * 中心区三选一（与需求约定的优先级一致）：
 *   playedCards 非空 → 用 CardRow 持久显示他打出的牌；
 *   否则 passed → 同一位置显示「不出」；
 *   否则有 countdownSeconds → 同一位置显示倒计时。
 */
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
    countdownActive,
  } = props;

  // 头像里的「首字」：'1 号位' → '1'，空名字兜底 '?'
  const initial = name.trim().charAt(0) || '?';

  let center: ReactElement | null = null;
  if (playedCards !== null && playedCards.length > 0) {
    center = (
      <div className="seat__play">
        <CardRow cards={playedCards} size="played" />
      </div>
    );
  } else if (passed) {
    center = <span className="seat__passed">不出</span>;
  } else if (countdownSeconds !== null) {
    center = <CountdownRing seconds={countdownSeconds} active={countdownActive} />;
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
        {/* 剩余张数：一张迷你牌背 + 金色数字角标；数值与根节点 aria-label 重复，对读屏器隐藏 */}
        <span className="seat__count" aria-hidden="true">
          <span className="seat__count-card">
            <CardBack size="mini" />
          </span>
          <span className="seat__count-badge">{cardCount}</span>
        </span>
      </div>

      {center !== null ? <div className="seat__center">{center}</div> : null}
    </section>
  );
}
