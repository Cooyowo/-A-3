import type { ReactElement } from 'react';

import type { Card } from '@a3/core';

import { MiniCardRow } from './CardView';

export interface TableCenterProps {
  /** 阶段文字，例如「第 3 局 · 出牌」 */
  phaseText: string;
  /** 轮到谁，例如「2 号位 领出」 */
  turnHint: string;
  /** 最近一手牌；还没人出牌时为 null */
  lastPlay: { label: string; cards: Card[] } | null;
  /** 小字提示：「需要压过：顺子」或「自由领出」 */
  topHint: string;
  /** 是否三条阶段，显示一个「三条阶段」徽标 */
  threePhase: boolean;
  /** 明牌公开的两张 / 锁定公开的 13 张；没有就不渲染公开牌区 */
  publicCards: Card[];
}

/**
 * 牌桌中央区域：圆角 + 内阴影，模拟桌面凹陷感。
 *
 * 从上到下四层信息（没有的层不渲染，避免空占位）：
 *  1. 阶段 + 轮到谁；
 *  2. 最近一手（出牌人 + MiniCardRow，牌宽随视口 clamp 缩放）；
 *  3. 压牌提示 + 三条阶段徽标；
 *  4. 公开牌区（明牌 2 张 / 锁定 13 张）。
 *
 * 全部用 flex + clamp() 排版，手机竖屏优先，桌面自动放大。
 */
export function TableCenter({
  phaseText,
  turnHint,
  lastPlay,
  topHint,
  threePhase,
  publicCards,
}: TableCenterProps): ReactElement {
  return (
    <section className="table-center" aria-label="牌桌中央">
      {/* 第 1 层：阶段 + 轮到谁 */}
      <header className="table-center__top">
        <span className="table-center__phase">{phaseText}</span>
        <span className="table-center__turn">{turnHint}</span>
      </header>

      {/* 第 2 层：最近一手；每人还没出牌时给一句占位提示 */}
      <div className="table-center__play">
        {lastPlay === null ? (
          <p className="table-center__empty">还没有人出牌</p>
        ) : (
          <>
            <span className="table-center__play-label">{lastPlay.label}</span>
            <MiniCardRow cards={lastPlay.cards} size="md" emptyText="过牌" />
          </>
        )}
      </div>

      {/* 第 3 层：压牌提示 + 三条阶段徽标 */}
      <div className="table-center__hints">
        <span className="table-center__top-hint">{topHint}</span>
        {threePhase ? <span className="table-center__three">三条阶段</span> : null}
      </div>

      {/* 第 4 层：公开牌，没有就不渲染整块 */}
      {publicCards.length > 0 ? (
        <div className="table-center__public">
          <span className="table-center__public-label">公开牌</span>
          <MiniCardRow cards={publicCards} size="sm" emptyText="无" />
        </div>
      ) : null}
    </section>
  );
}
