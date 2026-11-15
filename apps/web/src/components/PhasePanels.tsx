/**
 * M2 热座 · 阶段面板（横屏紧凑版）
 *
 * 纯展示组件：只负责「把当前阶段摆给玩家看 + 把点击回调抛给上层」。
 * 不 import store、不读写 localStorage、没有任何定时器；所有状态都从 props 来。
 *
 * 本轮改造（用户反馈「提示文字太多、页面杂乱」）：
 *   ① 文案大幅精简：每块最多 1 行说明，长段落 / 规则列表全部删掉；
 *      规则速查交给 App 里的「?」按钮，不在面板里重复。
 *   ② 横屏适配：面板改成屏幕居中的半透明深色浮层（CSS 在 panels.css），
 *      宽度 min(78vw, 860px)、最大高 84dvh、内部滚动；字号 clamp 适配 390~720px 高度。
 *   ③ 牌面统一用新组件 PokerCard.tsx 的 CardRow / PokerCard，
 *      旧的 CardView / MiniCardRow / HandView 依赖全部移除。
 *
 * 导出与 props 与原版完全一致（App 已按这些签名接线）：
 *   RevealPanel / SupplyPanel / ReturnSelectPanel / ReturnPickPanel /
 *   LockWindowPanel / SettlePanel / ActionBar / NoticeBar
 */

import type { ReactElement, ReactNode } from 'react';
import { isLandlordCard } from '@a3/core';
import type { Card } from '@a3/core';

import { CardRow, PokerCard } from './PokerCard';
import { sortHandDesc } from '../game/selectors';
import type { SeatStatus, SettleView, SupplyView } from '../game/selectors';

import '../styles/panels.css';

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

/** 面板内的一块信息区（标题 + 内容），供牌面板用 2×2 网格排 */
function Block(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="pp-block">
      <h3 className="pp-block-title">{props.title}</h3>
      {props.children}
    </section>
  );
}

/**
 * 名次列的小奖牌图标：1/2/3 金/银/铜，4 为灰色数字。
 * 只用圆形 + 数字表达，不写「第 N 名」文字。
 */
function RankMedal({ rank }: { rank: number }): ReactElement {
  const level = rank >= 1 && rank <= 4 ? rank : 4;
  return (
    <span
      className={`pp-rank-medal pp-rank-medal--${level}`}
      role="img"
      aria-label={`第 ${rank} 名`}
    >
      {rank}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1. 明牌决策
// ---------------------------------------------------------------------------

/**
 * 双地明牌决策（发完牌、供牌之前）。
 * 只亮「双地身份牌」两张 + 一行后果说明 + 两个按钮。
 */
export function RevealPanel(props: {
  seatLabel: string;
  hand: Card[];
  onReveal: () => void;
  onSkip: () => void;
}): ReactElement {
  // 明牌只公开 ♠3 / ♠A 这两张，其它手牌在这里不展开
  const pair = props.hand.filter(isLandlordCard);

  return (
    <section className="pp-panel pp-reveal" aria-label="明牌决策">
      <header className="pp-head">
        <p className="pp-kicker">明牌决策</p>
        <h2 className="pp-title">{props.seatLabel} · 双地（1 打 3）</h2>
      </header>

      <div className="pp-reveal-body">
        <div className="pp-pair" aria-label="双地身份牌 ♠3 和 ♠A">
          {pair.map((card) => (
            <PokerCard key={card.id} card={card} size="played" />
          ))}
        </div>

        {/* 一行说清明牌的全部后果：不供牌、你首发、翻倍、不可反悔 */}
        <p className="pp-lead">
          明牌 → 不供牌、你首发、本局翻倍（6→12），<strong>不可反悔</strong>
        </p>
      </div>

      <div className="pp-actions">
        <button type="button" className="pp-btn pp-btn-primary" onClick={props.onReveal}>
          明牌（不可反悔）
        </button>
        <button type="button" className="pp-btn pp-btn-ghost" onClick={props.onSkip}>
          不明牌
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. 供牌信息
// ---------------------------------------------------------------------------

/**
 * 供牌信息面板（牌都是公开信息，热座里可以摊开给所有人看）。
 * 四块 2×2 网格：输家交牌 / 供牌池 / 回牌进度 / 回牌池，每块只留一行规则。
 */
export function SupplyPanel(props: { view: SupplyView; stepText: string }): ReactElement {
  const { view } = props;

  return (
    <section className="pp-panel pp-supply" aria-label="供牌信息">
      <header className="pp-head">
        <p className="pp-kicker">供牌 / 回牌</p>
        <h2 className="pp-title">{props.stepText}</h2>
      </header>

      <div className="pp-scroll">
        <div className="pp-grid">
          <Block title="输家交牌">
            {view.perLoser.length === 0 ? (
              <p className="pp-empty">无</p>
            ) : (
              <ul className="pp-rows">
                {view.perLoser.map((item) => (
                  <li className="pp-row" key={item.seat}>
                    <span className="pp-row-label">{item.label}</span>
                    <CardRow cards={item.cards} size="mini" emptyText="无" />
                  </li>
                ))}
              </ul>
            )}
            <p className="pp-note">自动交最大牌，♠3 / ♠A 不供</p>
          </Block>

          <Block title="供牌池">
            <CardRow cards={view.pool} size="mini" emptyText="无" />
            <p className="pp-note">赢家得分高者优先，轮流拿最大牌</p>
          </Block>

          <Block title="回牌进度">
            {view.requiredByWinner.length === 0 ? (
              <p className="pp-empty">无</p>
            ) : (
              <ul className="pp-rows">
                {view.requiredByWinner.map((item) => (
                  <li className="pp-row" key={item.seat}>
                    <span className="pp-row-label">{item.label}</span>
                    <span className="pp-row-value">
                      需 {item.count} 张
                      <span className={item.done ? 'pp-tag pp-tag--ok' : 'pp-tag'}>
                        {item.done ? '已交' : '待交'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.pickOrder.length > 0 && (
              <p className="pp-note">
                挑牌顺序 {view.pickOrder.map((item) => item.label).join(' → ')}
              </p>
            )}
          </Block>

          <Block title="回牌池">
            {view.returns.length > 0 && (
              <ul className="pp-rows">
                {view.returns.map((item) => (
                  <li className="pp-row" key={item.seat}>
                    <span className="pp-row-label">{item.label}</span>
                    <CardRow cards={item.cards} size="mini" emptyText="无" />
                  </li>
                ))}
              </ul>
            )}
            <CardRow cards={view.returnPool} size="mini" emptyText="回牌池：无" />
            <p className="pp-note">输家按上交最大牌顺序轮流挑，交几张收几张</p>
          </Block>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. 赢家选回牌
// ---------------------------------------------------------------------------

/**
 * 赢家选回牌：必须选够 required 张，且不能选 ♠3 / ♠A。
 * 手牌用 CardRow 逐张点击切换选中（selectedIds 命中即高亮），
 * 选不够时「确认回牌」禁用（真正的合法性校验在 store / core，这里只做提示）。
 */
export function ReturnSelectPanel(props: {
  seatLabel: string;
  hand: Card[];
  selectedIds: readonly number[];
  required: number;
  onToggle: (card: Card) => void;
  onSubmit: () => void;
  onAuto: () => void;
}): ReactElement {
  // 只数「手牌里真的有的牌」，避免上层残留的选中项把计数弄错
  const selectedCount = props.hand.filter((card) => props.selectedIds.includes(card.id)).length;
  const enough = props.required > 0 && selectedCount === props.required;

  return (
    <section className="pp-panel pp-return-select" aria-label="选择回牌">
      <header className="pp-head">
        <p className="pp-kicker">回牌 · 赢家返还</p>
        <h2 className="pp-title">{props.seatLabel} 选回牌</h2>
      </header>

      <div className="pp-scroll">
        <p className="pp-lead">
          需返还 <strong>{props.required}</strong> 张，♠3 / ♠A 不能选
        </p>

        <p className="pp-counter" aria-live="polite">
          已选 <strong>{selectedCount}</strong> / {props.required}
        </p>

        {selectedCount > props.required && (
          <p className="pp-warn">多选了 {selectedCount - props.required} 张</p>
        )}

        {/* CardRow 自带 flex-wrap；父组件保证 hand 已按牌面从大到小排序 */}
        <CardRow
          cards={sortHandDesc(props.hand)}
          size="played"
          selectedIds={props.selectedIds}
          onCardClick={props.onToggle}
        />
      </div>

      <div className="pp-actions">
        <button
          type="button"
          className="pp-btn pp-btn-primary"
          disabled={!enough}
          onClick={props.onSubmit}
        >
          确认回牌
        </button>
        <button type="button" className="pp-btn pp-btn-ghost" onClick={props.onAuto}>
          自动选最小 {props.required} 张
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. 输家挑回牌
// ---------------------------------------------------------------------------

/**
 * 输家从回牌池挑一张：按「上交最大牌」从大到小的顺序轮流挑，点哪张直接挑走。
 */
export function ReturnPickPanel(props: {
  seatLabel: string;
  returnPool: Card[];
  onPick: (card: Card) => void;
}): ReactElement {
  return (
    <section className="pp-panel pp-return-pick" aria-label="从回牌池挑牌">
      <header className="pp-head">
        <p className="pp-kicker">回牌 · 输家挑牌</p>
        <h2 className="pp-title">{props.seatLabel} 挑一张</h2>
      </header>

      <div className="pp-scroll">
        <div className="pp-pick-body">
          <p className="pp-lead">按上交最大牌顺序轮流挑，点哪张就收回哪张</p>
          <CardRow
            cards={props.returnPool}
            size="played"
            emptyText="回牌池已空"
            onCardClick={props.onPick}
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. 提前锁定窗口
// ---------------------------------------------------------------------------

/**
 * 锁定窗口：手牌 13 张全是 4~10 的人可以秘密申请锁定第三名。
 * 线上固定等满 5 秒；本机热座没有计时器，改为所有人表态后手动点「开始出牌」。
 */
export function LockWindowPanel(props: {
  statuses: SeatStatus[];
  onToggle: (seat: number, on: boolean) => void;
  onFinish: () => void;
}): ReactElement {
  return (
    <section className="pp-panel pp-lock" aria-label="提前锁定窗口">
      <header className="pp-head">
        <p className="pp-kicker">提前锁定</p>
        <h2 className="pp-title">锁定第三名</h2>
      </header>

      <p className="pp-lead">
        手牌全是 4~10 → 可锁第 3 名；<strong>只有 1 人锁定才成功</strong>
      </p>

      <div className="pp-scroll">
        <ul className="pp-seats">
          {props.statuses.map((status) => (
            <li className="pp-seat-row" key={status.seat}>
              <span className="pp-seat-name">
                {status.label}
                {status.isActive && <span className="pp-tag pp-tag--ok">当前</span>}
              </span>

              {status.isLockEligible ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={status.lockIntent}
                  className="pp-switch"
                  onClick={() => props.onToggle(status.seat, !status.lockIntent)}
                >
                  <span className="pp-switch-track" aria-hidden="true">
                    <span className="pp-switch-dot" />
                  </span>
                  <span className="pp-switch-text">锁定</span>
                </button>
              ) : (
                <span className="pp-seat-hint">不满足条件</span>
              )}
            </li>
          ))}
        </ul>

        <p className="pp-note">本机热座：各自表态后点「开始出牌」（线上固定等 5 秒）</p>
      </div>

      <div className="pp-actions">
        <button type="button" className="pp-btn pp-btn-primary" onClick={props.onFinish}>
          开始出牌
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. 结算
// ---------------------------------------------------------------------------

/**
 * 结算面板：大字胜负 + 四座位名次表（名次列用奖牌图标）+ 两队总分 +
 * 下一局供牌 / 首发两行预告。内容可能比屏幕高，正文内部滚动，按钮固定底部。
 */
export function SettlePanel(props: {
  handNo: number;
  view: SettleView;
  onNextHand: () => void;
}): ReactElement {
  const { view } = props;
  const isDouble = view.result.mode === 'DOUBLE';
  // 按名次排序；还没定名次的排在最后
  const rows = [...view.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  return (
    <section className="pp-panel pp-settle" aria-label="本局结算">
      <header className="pp-head">
        <p className="pp-kicker">
          第 {props.handNo} 局 · 结算
          {isDouble && <span className="pp-tag pp-tag--double">双地 · 1 打 3</span>}
        </p>
        <p className="pp-outcome">{view.outcomeText}</p>
      </header>

      <div className="pp-scroll">
        <div className="pp-scoreboard" aria-label="两队总分">
          <div className="pp-score-team">
            <span className="pp-score-name">地主方</span>
            <span className="pp-score-value">{view.landlordScore}</span>
          </div>
          <span className="pp-score-sep">:</span>
          <div className="pp-score-team">
            <span className="pp-score-value">{view.farmerScore}</span>
            <span className="pp-score-name">非地主方</span>
          </div>
        </div>

        <table className="pp-ranks">
          <thead>
            <tr>
              <th scope="col">名次</th>
              <th scope="col">座位</th>
              <th scope="col">队伍</th>
              <th scope="col">分</th>
              <th scope="col">剩</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seat}>
                <td>
                  {row.rank === null ? (
                    <span className="pp-rank-none">—</span>
                  ) : (
                    <RankMedal rank={row.rank} />
                  )}
                </td>
                <td>
                  {row.label}
                  {row.locked && <span className="pp-tag pp-tag--ok">锁</span>}
                </td>
                <td>{row.isLandlord ? '地主方' : '非地主方'}</td>
                <td className="pp-num">{row.score}</td>
                <td className="pp-num">{row.handCount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pp-next">
          <p className="pp-next-line">
            <span className="pp-next-label">供牌</span>
            {view.nextDebtText}
          </p>
          <p className="pp-next-line">
            <span className="pp-next-label">首发</span>
            {view.nextFirstText}
          </p>
        </div>
      </div>

      <div className="pp-actions">
        <button type="button" className="pp-btn pp-btn-primary" onClick={props.onNextHand}>
          下一局
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7. 底部操作条
// ---------------------------------------------------------------------------

/**
 * 底部操作条：横屏 HUD，fixed 贴屏幕底部居中；hint 是按钮上方的小字。
 * 容器 pointer-events: none，只有按钮行接收点击，不挡牌桌其它区域。
 */
export function ActionBar(props: {
  hint?: string;
  actions: { label: string; onClick: () => void; disabled?: boolean; tone?: 'primary' | 'ghost' | 'danger' }[];
}): ReactElement {
  return (
    <div className="pp-actionbar" role="toolbar" aria-label="操作">
      {props.hint !== undefined && props.hint !== '' && <p className="pp-actionbar-hint">{props.hint}</p>}
      <div className="pp-actionbar-row">
        {props.actions.map((action, index) => (
          <button
            key={`${action.label}-${index}`}
            type="button"
            className={`pp-btn pp-btn-${action.tone ?? 'ghost'}`}
            disabled={action.disabled === true}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. 顶部提示条
// ---------------------------------------------------------------------------

/**
 * 顶部提示条：notice 为 null 时不渲染；错误红、成功绿、普通灰。
 */
export function NoticeBar(props: {
  notice: string | null;
  tone: 'info' | 'error' | 'success';
  onDismiss: () => void;
}): ReactElement | null {
  if (props.notice === null) return null;

  return (
    <div
      className={`pp-notice pp-notice--${props.tone}`}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="pp-notice-text">{props.notice}</span>
      <button type="button" className="pp-notice-close" onClick={props.onDismiss} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}
