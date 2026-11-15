/**
 * M2 热座 · 阶段面板
 *
 * 纯展示组件：只负责「把当前阶段摆给玩家看 + 把点击回调抛给上层」。
 * 不 import store、不读写 localStorage、没有任何定时器；所有状态都从 props 来。
 *
 * 交付的面板：
 *   RevealPanel       双地明牌决策（发完牌、供牌之前）
 *   SupplyPanel       供牌信息（输家交牌 / 供牌池 / 赢家回牌进度 / 回牌池）
 *   ReturnSelectPanel 赢家选回牌（要选够 required 张）
 *   ReturnPickPanel   输家从回牌池挑一张
 *   LockWindowPanel   提前锁定第三名（热座里手动「开始出牌」代替固定 5 秒）
 *   SettlePanel       结算（名次、两队分、下一局供牌与首发预告）
 *   ActionBar         底部操作条（按钮 ≥ 44px，可换行）
 *   NoticeBar         顶部提示条（错误红 / 成功绿 / 普通灰）
 */

import type { ReactElement, ReactNode } from 'react';
import { isLandlordCard } from '@a3/core';
import type { Card } from '@a3/core';

import { CardView, MiniCardRow } from './CardView';
import { HandView } from './HandView';
import { sortHandDesc } from '../game/selectors';
import type { SeatStatus, SettleView, SupplyView } from '../game/selectors';

import '../styles/panels.css';

// ---------------------------------------------------------------------------
// 内部小工具：把对 CardView.tsx / HandView.tsx 的依赖集中在这几个薄封装里，
// 万一视觉组件的 props 调整，只改这里，不用动每个面板。
// ---------------------------------------------------------------------------

/** 一行小牌；空数组时显示「无」（MiniCardRow 自带 emptyText，这里统一传一次） */
function SmallCards(props: { cards: Card[] }): ReactElement {
  return <MiniCardRow cards={props.cards} size="sm" emptyText="无" />;
}

/**
 * 牌池里可点的一张牌（点哪张就挑哪张）。
 * 注意：点击语义交给 CardView 自己的 onClick（它内部渲染 <button type="button">），
 * 这里绝对不能再用 <button> 包一层，否则会嵌套按钮。
 */
function PickCard(props: {
  card: Card;
  onPick: (card: Card) => void;
}): ReactElement {
  return <CardView card={props.card} size="sm" onClick={() => props.onPick(props.card)} />;
}

/** 面板内的一块信息区（带小标题，空内容由调用方自己写「无」） */
function Block(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="pp-block">
      <h3 className="pp-block-title">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** 名次文字：1..4 → 第 N 名，未定 → 未定 */
function rankText(rank: number | null): string {
  return rank === null ? '未定' : `第 ${rank} 名`;
}

// ---------------------------------------------------------------------------
// 1. 明牌决策
// ---------------------------------------------------------------------------

/**
 * 双地明牌决策（发完牌、供牌之前）。
 * 只有同时拿到 ♠3 和 ♠A 的人会看到这个面板，所以两段后果直接摊开讲清楚。
 */
export function RevealPanel(props: {
  seatLabel: string;
  hand: Card[];
  onReveal: () => void;
  onSkip: () => void;
}): ReactElement {
  // 只把两张地主牌亮给「自己」看，其它手牌这里不展开（明牌也只公开这两张）
  const pair = props.hand.filter(isLandlordCard);

  return (
    <section className="pp-panel pp-reveal" aria-label="明牌决策">
      <header className="pp-head">
        <p className="pp-kicker">明牌决策 · 发完牌、供牌之前</p>
        <h2 className="pp-title">{props.seatLabel} · 双地（1 打 3）</h2>
      </header>

      {/* 手机矮屏时正文可内部滚动，两个按钮始终留在面板底部 */}
      <div className="pp-scroll">
        <p className="pp-lead">
          你同时拿到了 <strong>♠3</strong> 和 <strong>♠A</strong> —— 本局你是双地，
          一个人打另外三家（1 打 3），他们三个都是非地主方。
        </p>

        <div className="pp-pair">
          <SmallCards cards={pair} />
          <span className="pp-pair-note">这两张就是你的双地身份牌</span>
        </div>

        <div className="pp-choice">
          <section className="pp-choice-card pp-choice-card--reveal">
            <h3 className="pp-choice-title">明牌</h3>
            <ul className="pp-list">
              <li>向所有人公开 ♠3 和 ♠A（只亮这两张，别的牌不亮）</li>
              <li>本局供牌、回牌全部作废（上一局的供牌债务不用还了）</li>
              <li>本局由你首发（♦4 的首发权作废）</li>
              <li>本局输赢的供牌张数翻倍（6 → 12 张）</li>
            </ul>
          </section>

          <section className="pp-choice-card">
            <h3 className="pp-choice-title">不明牌</h3>
            <ul className="pp-list">
              <li>身份不公开，正常按供牌 / 回牌流程走</li>
              <li>首发按「上交的牌最大」或 ♦4 的持有者确定</li>
              <li>本局输赢按正常张数供牌（不翻倍）</li>
            </ul>
          </section>
        </div>

        <p className="pp-warn">明牌后不可反悔，想清楚再点。</p>
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
 * 供牌信息面板。四块：
 *   ① 各输家交出的牌（perLoser）  ② 供牌池（pool）
 *   ③ 赢家回牌进度（requiredByWinner） ④ 已交回牌（returns）+ 回牌池（returnPool）
 * 牌都是公开信息，热座里可以放心摊开给所有人看。
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
        <Block title="① 各输家交出的牌">
          {view.perLoser.length === 0 ? (
            <p className="pp-empty">无</p>
          ) : (
            <ul className="pp-rows">
              {view.perLoser.map((item) => (
                <li className="pp-row" key={item.seat}>
                  <span className="pp-row-label">{item.label}</span>
                  <SmallCards cards={item.cards} />
                </li>
              ))}
            </ul>
          )}
          <p className="pp-note">输家自动交出自己手里最大的牌，♠3 和 ♠A 永远不能供。</p>
        </Block>

        <Block title="② 供牌池">
          <SmallCards cards={view.pool} />
          <p className="pp-note">赢家按「得分高者优先、同分名次靠前优先」轮流拿走池里最大的牌。</p>
        </Block>

        <Block title="③ 赢家回牌进度">
          {view.requiredByWinner.length === 0 ? (
            <p className="pp-empty">无</p>
          ) : (
            <ul className="pp-rows">
              {view.requiredByWinner.map((item) => (
                <li className="pp-row" key={item.seat}>
                  <span className="pp-row-label">{item.label}</span>
                  <span className="pp-row-value">
                    需返还 {item.count} 张
                    <span className={item.done ? 'pp-tag pp-tag--ok' : 'pp-tag'}>{item.done ? '已交' : '待交'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.pickOrder.length > 0 && (
            <p className="pp-note">
              挑牌顺序（上交最大牌从大到小）：{view.pickOrder.map((item) => item.label).join(' → ')}
            </p>
          )}
        </Block>

        <Block title="④ 已交回牌 / 回牌池">
          {view.returns.length === 0 ? (
            <p className="pp-empty">已交回牌：无</p>
          ) : (
            <ul className="pp-rows">
              {view.returns.map((item) => (
                <li className="pp-row" key={item.seat}>
                  <span className="pp-row-label">{item.label}</span>
                  <SmallCards cards={item.cards} />
                </li>
              ))}
            </ul>
          )}
          <div className="pp-subblock">
            <span className="pp-subblock-title">回牌池</span>
            <SmallCards cards={view.returnPool} />
          </div>
          <p className="pp-note">回牌池由输家按顺序挑走，交几张就收回几张，所有人最终都是 13 张。</p>
        </Block>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. 赢家选回牌
// ---------------------------------------------------------------------------

/**
 * 赢家选回牌：必须选够 required 张，且不能选 ♠3 / ♠A。
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
  const enough = selectedCount === props.required;

  return (
    <section className="pp-panel pp-return-select" aria-label="选择回牌">
      <header className="pp-head">
        <p className="pp-kicker">回牌 · 赢家返还</p>
        <h2 className="pp-title">{props.seatLabel} 请选择要返还的牌</h2>
      </header>

      <p className="pp-lead">
        你收到几张就返还几张：<strong>需要返还 {props.required} 张</strong>。♠3 和 ♠A 不能作为回牌。
      </p>

      <p className="pp-counter" aria-live="polite">
        已选 <strong>{selectedCount}</strong> / {props.required} 张
      </p>

      {selectedCount > props.required && (
        <p className="pp-warn">选多了：请取消多选的 {selectedCount - props.required} 张。</p>
      )}

      <div className="pp-hand-wrap">
        {/* HandView 不会排序，父组件负责按牌面从大到小传进去 */}
        <HandView
          cards={sortHandDesc(props.hand)}
          selectedIds={props.selectedIds}
          onToggle={props.onToggle}
          selectable
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
          自动选最小的 {props.required} 张
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
        <h2 className="pp-title">{props.seatLabel} 请从回牌池挑一张</h2>
      </header>

      <p className="pp-lead">
        按上交最大牌的顺序，轮到 <strong>{props.seatLabel}</strong> 挑牌；点哪张就收回哪张。
      </p>

      {props.returnPool.length === 0 ? (
        <p className="pp-empty">回牌池已空</p>
      ) : (
        <ul className="pp-pick-grid">
          {props.returnPool.map((card) => (
            <li className="pp-pick-item" key={card.id}>
              <PickCard card={card} onPick={props.onPick} />
            </li>
          ))}
        </ul>
      )}
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
        <p className="pp-kicker">提前锁定 · 供牌/回牌之后</p>
        <h2 className="pp-title">锁定第三名窗口</h2>
      </header>

      {/* 正文可内部滚动，保证「开始出牌」按钮在矮屏上也点得到 */}
      <div className="pp-scroll">
        <p className="pp-lead">
          发完牌并执行完供牌 / 回牌后，手牌 13 张<strong>全是 4~10</strong>（没有 J、Q、K、A、2、3）的人，
          可以申请提前锁定第三名。
        </p>

        <ul className="pp-list pp-rules">
          <li>只有 1 人锁定才成功：公开他的全部 13 张牌，他直接成为第 3 名并退出本局。</li>
          <li>2 人及以上锁定 → 全部失败，谁都锁不了，本局正常开打。</li>
          <li>锁定者的牌公开但不参与出牌；不满足条件的人看不到锁定开关。</li>
        </ul>

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
                  <span className="pp-switch-text">锁定第三名</span>
                </button>
              ) : (
                <span className="pp-seat-hint">不满足条件</span>
              )}
            </li>
          ))}
        </ul>

        <p className="pp-warn">
          线上版本固定等满 5 秒；本机热座没有倒计时——请每个人各自表态后，再点「开始出牌」。
        </p>
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
 * 结算面板：大字胜负 + 四座位名次表 + 两队总分 + 下一局供牌/首发预告。
 * 内容可能比屏幕高，所以正文区域限定 max-height 内部滚动，按钮始终留在底部。
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
              <th scope="col">名次分</th>
              <th scope="col">锁定</th>
              <th scope="col">剩余</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seat}>
                <td>{rankText(row.rank)}</td>
                <td>{row.label}</td>
                <td>{row.isLandlord ? '地主方' : '非地主方'}</td>
                <td className="pp-num">{row.score} 分</td>
                <td>{row.locked ? '已锁定' : '—'}</td>
                <td className="pp-num">{row.handCount} 张</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pp-next">
          <p className="pp-next-title">下一局预告</p>
          <blockquote className="pp-quote">{view.nextDebtText}</blockquote>
          <blockquote className="pp-quote">{view.nextFirstText}</blockquote>
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
 * 底部操作条：hint 显示在按钮上方的小字，按钮横向排列并允许换行（375px 下能放下 2~3 个）。
 * 用 position: sticky 贴在视口底部，避免像 fixed 那样盖住面板内容。
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
