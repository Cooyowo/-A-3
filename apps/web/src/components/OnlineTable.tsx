import { useEffect, useMemo, useState } from 'react';

import { validatePlay } from '@a3/core';
import type { Card } from '@a3/core';

import { ActionStrip } from './ActionStrip';
import { HandFan } from './HandFan';
import { CardRow } from './PokerCard';
import { Scene } from './Scene';
import { SettlePanel } from './PhasePanels';
import { SeatWidget } from './SeatWidget';
import { plannedSupplyFromSelf } from '../game/online/adapter';
import { useOnlineStore } from '../game/online/store';
import {
  getActiveSeat,
  getMedal,
  getSeatLabel,
  getSeatStatuses,
  getSeatTrickAction,
  getSettleView,
  getTurnLabel,
  isLandlordPublic,
  sortHandDesc,
} from '../game/selectors';
import './../styles/online-table.css';

/**
 * M3 联机牌桌。
 *
 * 与热座版本的区别：这里没有本地引擎——所有状态都来自服务端 view（已在 store 里适配成
 * GameState），玩家的动作只通过 `sendAction` 上报，服务端判定后把新 view 推下来。
 * 倒计时用服务端下发的 `deadline`（epoch ms）换算，避免两端时钟不一致。
 */

/** 根据服务端 deadline 算剩余秒数（每 250ms 刷新一次） */
function useRemainingSeconds(deadline: number | null): number | null {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function OnlineTable() {
  const view = useOnlineStore((state) => state.view);
  const game = useOnlineStore((state) => state.game);
  const seat = useOnlineStore((state) => state.seat);
  const selectedIds = useOnlineStore((state) => state.selectedIds);
  const pickedReturnId = useOnlineStore((state) => state.pickedReturnId);

  const toggleCard = useOnlineStore((state) => state.toggleCard);
  const clearSelection = useOnlineStore((state) => state.clearSelection);
  const playSelected = useOnlineStore((state) => state.playSelected);
  const pass = useOnlineStore((state) => state.pass);
  const reveal = useOnlineStore((state) => state.reveal);
  const skipReveal = useOnlineStore((state) => state.skipReveal);
  const redeal = useOnlineStore((state) => state.redeal);
  const toggleLock = useOnlineStore((state) => state.toggleLock);
  const submitReturn = useOnlineStore((state) => state.submitReturn);
  const autoReturn = useOnlineStore((state) => state.autoReturn);
  const pickReturn = useOnlineStore((state) => state.pickReturn);
  const confirmPickReturn = useOnlineStore((state) => state.confirmPickReturn);
  const leaveRoom = useOnlineStore((state) => state.leaveRoom);

  const deadline = view?.deadline ?? null;
  const remaining = useRemainingSeconds(deadline);

  const activeSeat = game === null ? null : getActiveSeat(game);
  const selfSeat = seat ?? view?.seat ?? 0;
  const nextSeat = (selfSeat + 1) % 4;
  const oppositeSeat = (selfSeat + 2) % 4;
  const prevSeat = (selfSeat + 3) % 4;

  const selfHand = useMemo(
    () => sortHandDesc(game?.players[selfSeat]?.hand ?? []),
    [game, selfSeat],
  );
  const isSelfTurn = game !== null && game.phase === 'PLAYING' && game.currentSeat === selfSeat;
  const statuses = game === null ? [] : getSeatStatuses(game);
  const selfAction = game === null ? null : getSeatTrickAction(game, selfSeat);

  const playCheck = useMemo(() => {
    if (game === null || !isSelfTurn) return { ok: false, reason: '' };
    if (selectedIds.length === 0) return { ok: false, reason: '点选要出的牌' };
    const cards = (game.players[selfSeat]?.hand ?? []).filter((card) => selectedIds.includes(card.id));
    return validatePlay(game, selfSeat, cards);
  }, [game, isSelfTurn, selectedIds, selfSeat]);

  if (view === null || game === null) {
    return (
      <div className="tbl-shell">
        <Scene />
        <div className="online-wait">正在同步牌局…</div>
      </div>
    );
  }

  const myDebt = view.debt;
  const amLoser = myDebt !== null && myDebt.losers.includes(selfSeat);
  const plannedSupply = plannedSupplyFromSelf(view);
  const tint = view.phase !== 'PLAYING';
  const gainedIds = tint ? view.supplyGainedIds : [];
  const returningMe = view.returnRequired !== null;
  const isPicking = view.pickSeat === selfSeat;

  const renderOpponent = (opponentSeat: number, slot: 'top' | 'top-left' | 'top-right') => {
    const status = statuses.find((item) => item.seat === opponentSeat);
    const action = getSeatTrickAction(game, opponentSeat);
    const name = view.players.find((player) => player.seat === opponentSeat)?.name ?? getSeatLabel(opponentSeat);
    const isActive = activeSeat === opponentSeat;
    const countdown = isActive && remaining !== null && remaining <= 10 ? remaining : null;
    return (
      <div className={`slot slot--${slot}`} key={opponentSeat}>
        <SeatWidget
          slot={slot}
          name={name}
          cardCount={status?.handCount ?? 0}
          isActive={isActive}
          isLandlord={isLandlordPublic(game, opponentSeat)}
          medal={getMedal(game, opponentSeat)}
          out={status?.out ?? false}
          playedCards={action?.kind === 'PLAY' ? action.cards : null}
          passed={action?.kind === 'PASS'}
          countdownSeconds={countdown}
        />
      </div>
    );
  };

  const stageText = ((): string => {
    switch (view.phase) {
      case 'REVEAL':
        return '明牌决策';
      case 'SUPPLY':
        if (view.supplyPaused) return '供牌';
        if (view.supplyStep === 'RETURN_SELECT') return '回牌';
        if (view.supplyStep === 'RETURN_PICK') return '挑选回牌';
        return '供牌';
      case 'LOCK_WINDOW':
        return '锁定窗口';
      case 'SETTLE':
        return '游戏结算';
      default:
        return '';
    }
  })();

  const settleView = view.phase === 'SETTLE' ? getSettleView(game) : null;

  return (
    <div className="tbl-shell">
      <div className="tbl">
        <Scene />
        <div className="felt">
          {renderOpponent(prevSeat, 'top-left')}
          {renderOpponent(oppositeSeat, 'top')}
          {renderOpponent(nextSeat, 'top-right')}

          <div className="center">
            {stageText !== '' && <p className="stage-banner">{stageText}</p>}
            {view.phase === 'PLAYING' && <p className="center__turn">{getTurnLabel(game)}</p>}

            {view.phase === 'PLAYING' && (
              <div className="center__zone">
                {selfAction?.kind === 'PLAY' && <CardRow cards={selfAction.cards} size="played" />}
                {selfAction?.kind === 'PASS' && <span className="center__pass">不出</span>}
              </div>
            )}

            {/* 明牌决策 */}
            {view.phase === 'REVEAL' && view.doubleSeat !== null && (
              <div className="center-card">
                <p className="center-card__title">
                  {view.doubleSeat === selfSeat ? '你是双地（1 打 3）' : `${getSeatLabel(view.doubleSeat)} 是双地`}
                </p>
                <p className="center-card__line">明牌：不供牌、由你首发、本局翻倍（6→12），不可反悔</p>
                {remaining !== null && <div className="center-card__timer">{remaining}s</div>}
                {view.doubleSeat === selfSeat && (
                  <div className="center-card__actions">
                    <button type="button" className="btn-primary" onClick={reveal}>
                      明牌
                    </button>
                    <button type="button" className="btn-ghost" onClick={skipReveal}>
                      不明牌
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 12 张供不出 */}
            {view.supplyDeadlocked && (
              <div className="center-card">
                <p className="center-card__title">供不出 12 张</p>
                <p className="center-card__line">♠3/♠A 不能交，最多 11 张：明牌（债务作废）或重新发牌（债务保留）</p>
                {amLoser ? (
                  <div className="center-card__actions">
                    <button type="button" className="btn-primary" onClick={reveal}>
                      明牌
                    </button>
                    <button type="button" className="btn-ghost" onClick={redeal}>
                      重新发牌
                    </button>
                  </div>
                ) : (
                  <p className="center-card__line">等待对方选择…</p>
                )}
              </div>
            )}

            {/* 供牌等待：显示要交的牌与倒计时 */}
            {view.phase === 'SUPPLY' && view.supplyPaused && (
              <div className="center-card">
                <p className="center-card__title">供牌准备</p>
                <p className="center-card__line">
                  {amLoser ? '你即将交出标色的牌' : '等待输家交牌…'}
                  {myDebt !== null ? `（${myDebt.losers.length} 人向 ${myDebt.winners.length} 人供 ${myDebt.total} 张）` : ''}
                </p>
                {remaining !== null && <div className="center-card__timer">{remaining}s</div>}
              </div>
            )}

            {/* 赢家回牌 */}
            {view.phase === 'SUPPLY' && !view.supplyPaused && view.supplyStep === 'RETURN_SELECT' && (
              <div className="center-card">
                <p className="center-card__title">{returningMe ? '请选择要返还的牌' : '等待赢家回牌…'}</p>
                {returningMe && <p className="center-card__line">需返还 {view.returnRequired} 张 · ♠3/♠A 不能选</p>}
                {remaining !== null && <div className="center-card__timer">{remaining}s</div>}
              </div>
            )}

            {/* 挑回牌：桌面中间摆回牌 */}
            {view.phase === 'SUPPLY' && view.supplyStep === 'RETURN_PICK' && (
              <div className="pick-zone">
                <p className="center-card__title">
                  {view.pickAutoMode
                    ? '双地明牌输了：回牌将整批回到供牌方'
                    : isPicking
                      ? '点一张牌高亮，再点「选这张」'
                      : `等待 ${getSeatLabel(view.pickSeat ?? 0)} 挑回牌…`}
                </p>
                <CardRow
                  cards={view.returnPool}
                  size="played"
                  selectedIds={pickedReturnId === null ? [] : [pickedReturnId]}
                  onCardClick={(card) => pickReturn(card.id)}
                />
                {isPicking && !view.pickAutoMode && (
                  <button type="button" className="btn-primary pick-confirm" onClick={confirmPickReturn}>
                    选这张
                  </button>
                )}
                {remaining !== null && <p className="pick-zone__hint">{remaining}s</p>}
              </div>
            )}

            {/* 锁定窗口 */}
            {view.phase === 'LOCK_WINDOW' && (
              <div className="center-card">
                <p className="center-card__title">提前锁定</p>
                <p className="center-card__line">
                  {view.myLockEligible ? '你的手牌全是 4~10，可锁定第三名' : '等待其他玩家表态…'}
                </p>
                {view.myLockEligible && (
                  <div className="center-card__actions">
                    <button type="button" className="btn-primary" onClick={toggleLock}>
                      {view.myLockIntent ? '取消锁定' : '锁定第三名'}
                    </button>
                  </div>
                )}
                {remaining !== null && <div className="center-card__timer">{remaining}s</div>}
              </div>
            )}
          </div>

          {/* 自己（左下角） */}
          <div className="self-info" data-active={isSelfTurn}>
            <div className="self-avatar">{selfSeat + 1}</div>
            <div className="self-meta">
              <span className="self-name">
                {view.players.find((player) => player.seat === selfSeat)?.name ?? getSeatLabel(selfSeat)}
              </span>
              <span className="self-count">{selfHand.length} 张</span>
              {isLandlordPublic(game, selfSeat) && <span className="self-landlord">地主</span>}
            </div>
          </div>

          {/* 右上角：房间号 + 退出 */}
          <div className="online-topbar">
            <span className="online-topbar__code">房间 {view.room}</span>
            <span className="online-topbar__hand">第 {view.handNo} 局</span>
            <button type="button" className="debug__btn" onClick={leaveRoom}>
              退出房间
            </button>
          </div>

          {/* 出牌阶段：手牌 + 操作条 */}
          {view.phase === 'PLAYING' && (
            <>
              <div className="strip-wrap">
                {isSelfTurn ? (
                  <ActionStrip
                    remainingSeconds={remaining}
                    timerActive={remaining !== null && remaining > 0}
                    onPass={pass}
                    onHint={() => undefined}
                    onPlay={playSelected}
                    onClear={clearSelection}
                    passDisabled={game.isFirstPlay}
                    hintDisabled
                    playDisabled={!playCheck.ok}
                    clearDisabled={selectedIds.length === 0}
                  />
                ) : (
                  <div className="strip-wrap strip-wrap--readonly">等待其他玩家出牌</div>
                )}
              </div>
              <HandFan
                cards={selfHand}
                selectedIds={isSelfTurn ? selectedIds : []}
                onToggle={(card: Card) => {
                  if (isSelfTurn) toggleCard(card.id);
                }}
                disabled={!isSelfTurn}
              />
            </>
          )}

          {/* 回牌阶段：赢家选要返还的牌 */}
          {view.phase === 'SUPPLY' && !view.supplyPaused && view.supplyStep === 'RETURN_SELECT' && (
            <>
              {returningMe && (
                <div className="strip-wrap">
                  <div className="return-actions">
                    <span className="return-actions__count">
                      已选 {selectedIds.length} / {view.returnRequired}
                    </span>
                    {remaining !== null && <span className="return-actions__timer">{remaining}s</span>}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={selectedIds.length !== (view.returnRequired ?? 0)}
                      onClick={submitReturn}
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
                cards={selfHand}
                selectedIds={selectedIds}
                tintedIds={gainedIds}
                onToggle={(card) => {
                  if (!returningMe) return;
                  if (card.rank === 16 && card.suit === 4) return;
                  if (card.rank === 14 && card.suit === 4) return;
                  toggleCard(card.id);
                }}
                disabled={!returningMe}
              />
            </>
          )}

          {/* 供牌/锁定等阶段也把自己的牌显示出来 */}
          {view.phase !== 'PLAYING' && !(view.phase === 'SUPPLY' && view.supplyStep === 'RETURN_SELECT' && !view.supplyPaused) && (
            <HandFan
              cards={selfHand}
              selectedIds={[]}
              tintedIds={[...gainedIds, ...plannedSupply.map((card) => card.id)]}
              onToggle={() => undefined}
              disabled
            />
          )}

          {settleView !== null && (
            <div className="overlay">
              <div className="online-settle">
                <SettlePanel handNo={view.handNo} view={settleView} onNextHand={() => undefined} />
                <p className="online-settle__hint">
                  {remaining !== null ? `${remaining} 秒后自动进入下一局` : '服务端会自动进入下一局'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnlineTable;
