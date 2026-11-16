import { useEffect, useMemo, useState } from 'react';

import { lockEligible, validatePlay } from '@a3/core';
import type { Card } from '@a3/core';

import { ActionStrip } from './components/ActionStrip';
import { HandFan } from './components/HandFan';
import { CardRow, PokerCard } from './components/PokerCard';
import { Scene } from './components/Scene';
import { SettlePanel } from './components/PhasePanels';
import { CountdownClock, SeatWidget } from './components/SeatWidget';
import {
  cardsByIds,
  getActiveSeat,
  getMedal,
  getPickState,
  getPlannedSupply,
  getReturnState,
  getSeatLabel,
  getSeatStatuses,
  getSeatTrickAction,
  getSelfSeat,
  getSettleView,
  getSupplyGainedIds,
  getSupplyTransfers,
  getTurnLabel,
  isLandlordPublic,
  shouldTintSupply,
  sortHandDesc,
} from './game/selectors';
import { supplyDeadlocked, useHotseatStore } from './game/store';
import { useCountdown } from './game/useCountdown';
import './styles/table.css';
import './styles/flow.css';
import './styles/layout-v3.css';

/** 时长（用户确认用默认这套） */
const T = {
  deal: 1200, // 发牌动画
  supplyShow: 4000, // 供牌展示（不可跳过）
  supplyMove: 800, // 供牌飞牌动画
  reveal: 4000, // 明牌决策（与供牌倒计时同步）
  returnSelect: 20000, // 赢家回牌
  returnPick: 15000, // 每位供牌方挑回牌
  lock: 5000, // 供牌结束后的锁定窗口（等几秒自动进入游戏）
  turn: 30000, // 出牌回合（仅展示）
  autoPickStep: 350, // 双地明牌输：整批转移的每张间隔
};

const RULES: string[] = [
  '牌组档位（高的无条件压低的）：炸弹 8 ＞ 四夹一 7 ＞ 同花顺 6 ＞ 三条夹双 5 ＞ 同花 4 ＞ 顺子 3 ＞ 三条夹一 2 ＞ 三条 1。',
  '单张 / 对子 / 牌组三个大类不能互相压；炸弹不能压单张、对子。',
  '4~10 同点数视为一样大（可互相压）；J 以上同点数比花色 ♠＞♥＞♣＞♦。',
  '同花、同花顺先比花色再比最大牌；顺子先比最大牌点数，最大牌是 J/Q/K/A 时才比花色。',
  '三条 / 三条夹一 只能在本局第一手、三条阶段内、或手上只剩这几张时出。',
];

type SupplyStage = 'idle' | 'show' | 'move' | 'done';

export default function App() {
  const game = useHotseatStore((state) => state.game);
  const seed = useHotseatStore((state) => state.seed);
  const selectedIds = useHotseatStore((state) => state.selectedCardIds);
  const notice = useHotseatStore((state) => state.notice);
  const noticeTone = useHotseatStore((state) => state.noticeTone);
  const viewSeat = useHotseatStore((state) => state.viewSeat);
  const highlightedReturnId = useHotseatStore((state) => state.highlightedReturnId);

  const newGame = useHotseatStore((state) => state.newGame);
  const toggleCard = useHotseatStore((state) => state.toggleCard);
  const clearSelection = useHotseatStore((state) => state.clearSelection);
  const playSelected = useHotseatStore((state) => state.playSelected);
  const pass = useHotseatStore((state) => state.pass);
  const hint = useHotseatStore((state) => state.hint);
  const reveal = useHotseatStore((state) => state.reveal);
  const skipReveal = useHotseatStore((state) => state.skipReveal);
  const redeal = useHotseatStore((state) => state.redeal);
  const setLockIntent = useHotseatStore((state) => state.setLockIntent);
  const finishLockWindow = useHotseatStore((state) => state.finishLockWindow);
  const submitReturnSelected = useHotseatStore((state) => state.submitReturnSelected);
  const autoReturn = useHotseatStore((state) => state.autoReturn);
  const highlightReturn = useHotseatStore((state) => state.highlightReturn);
  const confirmPickReturn = useHotseatStore((state) => state.confirmPickReturn);
  const autoPickReturn = useHotseatStore((state) => state.autoPickReturn);
  const nextHand = useHotseatStore((state) => state.nextHand);
  const dismissNotice = useHotseatStore((state) => state.dismissNotice);
  const cycleViewSeat = useHotseatStore((state) => state.cycleViewSeat);

  const [entered, setEntered] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [supplyStage, setSupplyStage] = useState<SupplyStage>('idle');
  const [startBanner, setStartBanner] = useState(false);

  // ---------------------------------------------------------------- 派生数据
  const activeSeat = getActiveSeat(game);
  const selfSeat = getSelfSeat(game, viewSeat);
  const statuses = getSeatStatuses(game);
  const settleView = getSettleView(game);
  const deadlocked = supplyDeadlocked(game);
  const returnState = getReturnState(game);
  const pickState = getPickState(game);
  const tintSupply = shouldTintSupply(game);
  const gainedIds = getSupplyGainedIds(game);

  const nextSeat = (selfSeat + 1) % 4;
  const oppositeSeat = (selfSeat + 2) % 4;
  const prevSeat = (selfSeat + 3) % 4;

  const isSelfTurn = activeSeat === selfSeat && game.phase === 'PLAYING';
  const selfHand = useMemo(() => sortHandDesc(game.players[selfSeat]?.hand ?? []), [game, selfSeat]);
  const effectiveSelected = isSelfTurn ? selectedIds : [];

  const turnKey = `${game.handNo}-${game.trickNo}-${activeSeat ?? 'x'}-${game.log.length}`;
  // 倒计时显示用「秒」，而 T 里的时长是给 setTimeout 的毫秒
  const turnRemaining = useCountdown(turnKey, Math.round(T.turn / 1000));

  // 回牌是同步的：每个赢家各自回牌；倒计时共用一条（从拿到供牌开始算 20 秒）
  const pendingReturnSeats = returnState === null ? [] : returnState.seats.filter((row) => !row.done);
  const returnDisplaySeat =
    viewSeat ?? pendingReturnSeats[0]?.seat ?? returnState?.seats[0]?.seat ?? null;
  const returnDisplayRow =
    returnState === null || returnDisplaySeat === null
      ? null
      : returnState.seats.find((row) => row.seat === returnDisplaySeat) ?? null;
  const returnIsActor = returnDisplayRow !== null && !returnDisplayRow.done;
  const returnKey = `${game.handNo}-return`;
  const returnRemaining = useCountdown(returnKey, Math.round(T.returnSelect / 1000));
  const pickKey = `${game.handNo}-pick-${pickState?.picker ?? 'x'}-${pickState?.pool.length ?? 0}`;
  const pickRemaining = useCountdown(pickKey, Math.round(T.returnPick / 1000));
  const revealKey = `${game.handNo}-reveal`;
  const revealRemaining = useCountdown(revealKey, Math.round(T.reveal / 1000));
  const lockKey = `${game.handNo}-lock`;
  const lockRemaining = useCountdown(lockKey, Math.round(T.lock / 1000));
  const selfLockEligible = game.phase === 'LOCK_WINDOW' && lockEligible(game, selfSeat);
  const selfLockIntent = game.lockIntents.get(selfSeat) === true;

  const playCheck = useMemo(() => {
    if (!isSelfTurn || activeSeat === null) return { ok: false, reason: '' };
    if (selectedIds.length === 0) return { ok: false, reason: '点选要出的牌' };
    return validatePlay(game, activeSeat, cardsByIds(game, selectedIds));
  }, [game, activeSeat, selectedIds, isSelfTurn]);

  const selfAction = isSelfTurn ? null : getSeatTrickAction(game, selfSeat);
  const selfStatus = statuses.find((status) => status.seat === selfSeat);

  // ---------------------------------------------------------------- 逐阶段流程
  // 发牌动画
  useEffect(() => {
    if (!entered) return;
    setDealing(true);
    const timer = setTimeout(() => setDealing(false), T.deal);
    return () => clearTimeout(timer);
  }, [entered, game.handNo]);

  // 供牌展示 → 飞牌 → 完成
  useEffect(() => {
    const enteringReturnSelect = game.phase === 'SUPPLY' && game.supplyContext?.step === 'RETURN_SELECT';
    const hasTransfers = getSupplyTransfers(game).length > 0;
    if (!enteringReturnSelect || !hasTransfers) {
      setSupplyStage('done');
      return;
    }
    setSupplyStage('show');
    const showTimer = setTimeout(() => setSupplyStage('move'), T.supplyShow);
    const moveTimer = setTimeout(() => setSupplyStage('done'), T.supplyShow + T.supplyMove);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(moveTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.handNo, game.phase, game.supplyContext?.step]);

  // 供牌结束后：不再主动弹锁定窗口，给几秒倒计时，符合条件的人可在这段时间点手牌上方的「提前锁定」
  useEffect(() => {
    if (!entered || game.phase !== 'LOCK_WINDOW') return;
    const timer = setTimeout(() => finishLockWindow(), T.lock);
    return () => clearTimeout(timer);
  }, [entered, game.phase, game.handNo, finishLockWindow]);

  // 明牌决策倒计时：超时视为不明牌（Q-001）
  useEffect(() => {
    if (!entered || dealing) return;
    if (game.phase !== 'REVEAL') return;
    const timer = setTimeout(() => skipReveal(), T.reveal);
    return () => clearTimeout(timer);
  }, [entered, dealing, game.phase, game.handNo, skipReveal]);

  // 回牌倒计时：到点后自动给每个还没交牌的赢家交「最小」的牌（Q-041）；多赢家时依次快速补完
  useEffect(() => {
    if (!entered) return;
    if (game.phase !== 'SUPPLY' || game.supplyContext?.step !== 'RETURN_SELECT') return;
    if (supplyStage !== 'done') return;
    const pending = returnState?.seats.filter((row) => !row.done).length ?? 0;
    if (pending === 0) return;
    const total = returnState?.seats.length ?? 1;
    const delay = pending === total ? T.returnSelect : 400;
    const timer = setTimeout(() => autoReturn(), delay);
    return () => clearTimeout(timer);
  }, [entered, game.phase, game.supplyContext?.step, supplyStage, game.handNo, pendingReturnSeats.length, autoReturn, returnState?.seats.length]);

  // 挑回牌倒计时：超时默认拿最大的回牌（用户确认口径）
  // 双地明牌输（12 张、1 个输家）时：先给 15 秒，然后每 350ms 自动拿走一张，整批转回供牌方
  useEffect(() => {
    if (!entered || pickState === null) return;
    const delay = pickState.autoMode
      ? pickState.pool.length >= 12
        ? T.returnPick
        : T.autoPickStep
      : T.returnPick;
    const timer = setTimeout(() => autoPickReturn(), delay);
    return () => clearTimeout(timer);
  }, [entered, pickState?.picker, pickState?.pool.length, pickState?.autoMode, game.handNo, autoPickReturn]);

  // 进入出牌阶段时给一个「开始游戏」的短提示
  useEffect(() => {
    if (game.phase !== 'PLAYING') return;
    setStartBanner(true);
    const timer = setTimeout(() => setStartBanner(false), 1600);
    return () => clearTimeout(timer);
  }, [game.phase, game.handNo]);

  // 供牌池 / 回牌池变化时清掉点选
  useEffect(() => {
    if (game.phase !== 'SUPPLY') clearSelection();
  }, [game.phase, clearSelection]);

  // ---------------------------------------------------------------- 渲染小工具
  const plannedSupply = getPlannedSupply(game);
  const transfers = getSupplyTransfers(game);

  const renderOpponent = (seat: number, slot: 'top' | 'top-left' | 'top-right') => {
    const status = statuses.find((item) => item.seat === seat);
    const isActive = activeSeat === seat;
    // 用户 2026-11-16：轮到某人行动时，他之前打出的牌/「不出」先隐去，等他打出新的牌再显示
    const action = isActive ? null : getSeatTrickAction(game, seat);
    // 别人也能看到行动者的闹钟倒计时（自己那侧用按钮条里的倒计时）
    const clockSeconds = isActive && seat !== selfSeat ? turnRemaining : null;
    const supplyFromLoser =
      plannedSupply?.losers.find((row) => row.seat === seat)?.cards ??
      (supplyStage === 'show' ? transfers.filter((row) => row.from === seat).map((row) => row.card) : []);
    return (
      <div className={`slot slot--${slot}`} key={seat}>
        <SeatWidget
          slot={slot}
          name={getSeatLabel(seat)}
          cardCount={status?.handCount ?? 0}
          isActive={isActive}
          isLandlord={isLandlordPublic(game, seat)}
          medal={getMedal(game, seat)}
          out={status?.out ?? false}
          playedCards={action?.kind === 'PLAY' ? action.cards : null}
          passed={action?.kind === 'PASS'}
          countdownSeconds={clockSeconds}
          countdownTotal={Math.round(T.turn / 1000)}
        />
        {supplyFromLoser.length > 0 && (
          <div className={`supply-out supply-out--${slot}`}>
            <CardRow cards={supplyFromLoser} size="played" tintedIds={supplyFromLoser.map((card) => card.id)} />
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------- 欢迎页
  if (!entered) {
    return (
      <div className="tbl-shell">
        <Scene />
        <div className="rotate-hint">
          <div className="rotate-icon" aria-hidden="true">
            ↻
          </div>
          <p>请把手机横过来使用</p>
        </div>
        <div className="welcome">
          <h1>葵A葵3</h1>
          <p className="welcome__sub">四人扑克 · 家乡玩法 · 横屏</p>
          <button type="button" className="welcome__enter" onClick={() => setEntered(true)}>
            进入游戏
          </button>
          <p className="welcome__tip">建议横屏使用 · 当前为本机热座测试版</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tbl-shell">
      <div className="rotate-hint">
        <div className="rotate-icon" aria-hidden="true">
          ↻
        </div>
        <p>请把手机横过来使用</p>
      </div>

      <div className="tbl">
        <Scene />
        <div className="felt">
          {renderOpponent(prevSeat, 'top-left')}
          {renderOpponent(oppositeSeat, 'top')}
          {renderOpponent(nextSeat, 'top-right')}

          {/* 中央：阶段提示 / 轮到谁 */}
          <div className="center">
            {game.phase === 'PLAYING' && <p className="center__turn">{getTurnLabel(game)}</p>}
            {startBanner && <p className="stage-banner">开始游戏</p>}
            {dealing && <p className="stage-banner">发牌</p>}

            {/* 中央出牌区：自己打出的牌 / 不出 */}
            {game.phase === 'PLAYING' && (
              <div className="center__zone">
                {selfAction?.kind === 'PLAY' && <CardRow cards={selfAction.cards} size="played" />}
                {selfAction?.kind === 'PASS' && <span className="center__pass">不出</span>}
              </div>
            )}

            {/* 明牌决策（双地） */}
            {game.phase === 'REVEAL' && game.doubleSeat !== null && (
              <div className="center-card">
                <p className="center-card__title">双地：是否明牌</p>
                <div className="center-card__timer">{revealRemaining}</div>
                <div className="center-card__actions">
                  <button type="button" className="btn-primary" onClick={reveal}>
                    明牌
                  </button>
                  <button type="button" className="btn-ghost" onClick={skipReveal}>
                    不明牌
                  </button>
                </div>
              </div>
            )}

            {/* 12 张供不出：二选一 */}
            {deadlocked && (
              <div className="center-card">
                <p className="center-card__title">供不出 12 张</p>
                <div className="center-card__actions">
                  <button type="button" className="btn-primary" onClick={reveal}>
                    明牌
                  </button>
                  <button type="button" className="btn-ghost" onClick={redeal}>
                    重新发牌
                  </button>
                </div>
              </div>
            )}

            {/* 回牌：所有人只看到桌面中间的大闹钟（自己那侧另外有按钮条） */}
            {returnState !== null && supplyStage === 'done' && pendingReturnSeats.length > 0 && (
              <div className="center-clock">
                <CountdownClock remaining={returnRemaining} total={Math.round(T.returnSelect / 1000)} size="lg" />
              </div>
            )}

            {/* 供牌结束 → 只显示倒计时；平局后的那一局加上「本局平平无奇」 */}
            {game.phase === 'LOCK_WINDOW' && (
              <div className="center-card">
                {game.result?.draw === true && <p className="draw-flavor">本局平平无奇</p>}
                <div className="center-card__timer">{lockRemaining}</div>
              </div>
            )}

            {/* 挑回牌：回牌摆在桌面中间（透明、单排、可重叠） */}
            {pickState !== null && (
              <div className="pick-zone">
                <div className="pick-row">
                  {pickState.pool.map((card) => (
                    <PokerCard
                      key={card.id}
                      card={card}
                      size="played"
                      selected={highlightedReturnId === card.id}
                      onClick={() => highlightReturn(card.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 自己（左下角） */}
          <div className="self-info" data-active={isSelfTurn}>
            <div className="self-avatar">{selfSeat + 1}</div>
            <div className="self-meta">
              <span className="self-name">{getSeatLabel(selfSeat)}</span>
              <span className="self-count">{selfStatus?.handCount ?? 0} 张</span>
              {isLandlordPublic(game, selfSeat) && <span className="self-landlord">地主</span>}
              {getMedal(game, selfSeat) !== null && (
                <span className={`self-medal self-medal--${getMedal(game, selfSeat)}`}>
                  {getMedal(game, selfSeat)}
                </span>
              )}
            </div>
          </div>

          {/* 测试工具条 */}
          <div className="debug">
            <button type="button" className="debug__btn" onClick={cycleViewSeat}>
              切换视角：{viewSeat === null ? '自动' : `${viewSeat + 1} 号位`}
            </button>
            <button type="button" className="debug__btn" onClick={() => newGame()}>
              新开一局
            </button>
            <button type="button" className="debug__btn debug__btn--icon" onClick={() => setHelpOpen(true)} aria-label="规则速查">
              ?
            </button>
            <span className="debug__seed">种子 {seed}</span>
          </div>

          {notice !== null && (
            <button type="button" className={`notice notice--${noticeTone}`} onClick={dismissNotice}>
              {notice}
            </button>
          )}

          {/* 出牌阶段：手牌 + 操作条 */}
          {game.phase === 'PLAYING' && (
            <>
              <div className="strip-wrap">
                {isSelfTurn ? (
                  <ActionStrip
                    remainingSeconds={turnRemaining}
                    timerActive={turnRemaining > 0}
                    onPass={pass}
                    onHint={hint}
                    onPlay={playSelected}
                    onClear={clearSelection}
                    passDisabled={game.isFirstPlay}
                    hintDisabled={false}
                    playDisabled={!playCheck.ok}
                    clearDisabled={selectedIds.length === 0}
                  />
                ) : (
                  <div className="strip-wrap strip-wrap--readonly">
                    {viewSeat !== null && viewSeat !== activeSeat ? '只读视角（不是该玩家回合）' : '等待其他玩家出牌'}
                  </div>
                )}
              </div>
              <HandFan
                cards={selfHand}
                selectedIds={effectiveSelected as number[]}
                onToggle={(card: Card) => {
                  if (isSelfTurn) toggleCard(card.id);
                }}
              />
            </>
          )}

          {/* 回牌阶段：所有赢家同步回牌，切视角就能操作对应赢家；牌不加灰 */}
          {returnState !== null && game.phase === 'SUPPLY' && returnDisplaySeat !== null && (() => {
            const displayHand = sortHandDesc(game.players[returnDisplaySeat]?.hand ?? []);
            return (
              <>
                {returnIsActor && returnDisplayRow !== null && (
                  <div className="strip-wrap">
                    <div className="return-actions">
                      <span className="return-actions__count">
                        已选 {selectedIds.length} / {returnDisplayRow.required}
                      </span>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={selectedIds.length !== returnDisplayRow.required}
                        onClick={submitReturnSelected}
                      >
                        回牌
                      </button>
                      <button type="button" className="btn-ghost" onClick={autoReturn}>
                        自动选最小
                      </button>
                    </div>
                  </div>
                )}
                <HandFan
                  cards={displayHand}
                  selectedIds={returnIsActor ? selectedIds : []}
                  tintedIds={gainedIds}
                  onToggle={(card) => {
                    if (!returnIsActor) return;
                    if (card.rank === 16 && card.suit === 4) {
                      useHotseatStore.setState({ notice: '不能回 ♠3', noticeTone: 'error' });
                      return;
                    }
                    if (card.rank === 14 && card.suit === 4) {
                      useHotseatStore.setState({ notice: '不能回 ♠A', noticeTone: 'error' });
                      return;
                    }
                    toggleCard(card.id);
                  }}
                />
              </>
            );
          })()}

          {/* 其他阶段：也把自己的牌显示出来（供牌/挑选时看得到） */}
          {game.phase !== 'PLAYING' && returnState === null && (
            <HandFan
              cards={selfHand}
              selectedIds={[]}
              tintedIds={tintSupply ? gainedIds : []}
              onToggle={() => undefined}
            />
          )}

          {/* 供牌结束后：不弹窗；符合条件的人在手牌上方看到「提前锁定」，其余人看中间倒计时 */}
          {game.phase === 'LOCK_WINDOW' && selfLockEligible && (
            <div className="strip-wrap">
              <div className="return-actions">
                <button
                  type="button"
                  className={selfLockIntent ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setLockIntent(selfSeat, !selfLockIntent)}
                >
                  {selfLockIntent ? '已锁定（点此取消）' : '提前锁定'}
                </button>
              </div>
            </div>
          )}

          {/* 挑回牌：中间点牌高亮 → 手牌上方「选这张」（按钮风格与出牌一致） */}
          {pickState !== null && !pickState.autoMode && (
            <div className="strip-wrap">
              <div className="pick-bar">
                <CountdownClock remaining={pickRemaining} total={Math.round(T.returnPick / 1000)} size="sm" />
                <button
                  type="button"
                  className="as__btn as__btn--gold"
                  disabled={highlightedReturnId === null}
                  onClick={confirmPickReturn}
                >
                  选这张
                </button>
              </div>
            </div>
          )}

          {game.phase === 'SETTLE' && settleView !== null && (
            <div className="overlay">
              <SettlePanel handNo={game.handNo} view={settleView} onNextHand={nextHand} />
            </div>
          )}

          {/* 发牌动画层 */}
          {dealing && (
            <div className="deal-layer" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className={`deal-layer__stack deal-layer__stack--${index}`}>
                  {[0, 1, 2].map((card) => (
                    <span key={card} className="deal-layer__card" style={{ animationDelay: `${index * 90 + card * 60}ms` }} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {helpOpen && (
            <div className="overlay" onClick={() => setHelpOpen(false)}>
              <div className="help" onClick={(event) => event.stopPropagation()}>
                <h2>规则速查</h2>
                <ul>
                  {RULES.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <button type="button" className="debug__btn" onClick={() => setHelpOpen(false)}>
                  知道了
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
