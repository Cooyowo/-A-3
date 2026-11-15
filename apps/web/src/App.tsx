import { useMemo, useState } from 'react';

import { validatePlay } from '@a3/core';
import type { Card } from '@a3/core';

import { ActionStrip } from './components/ActionStrip';
import { HandFan } from './components/HandFan';
import { CardRow } from './components/PokerCard';
import {
  ActionBar,
  LockWindowPanel,
  NoticeBar,
  ReturnPickPanel,
  ReturnSelectPanel,
  RevealPanel,
  SettlePanel,
  SupplyPanel,
} from './components/PhasePanels';
import { SeatWidget } from './components/SeatWidget';
import {
  cardsByIds,
  getActiveSeat,
  getMedal,
  getSeatLabel,
  getSeatStatuses,
  getSeatTrickAction,
  getSelfSeat,
  getSettleView,
  getSupplyView,
  getTurnLabel,
  isLandlordPublic,
  sortHandDesc,
} from './game/selectors';
import { supplyDeadlocked, useHotseatStore } from './game/store';
import { useCountdown } from './game/useCountdown';
import './styles/table.css';

/** 单回合显示倒计时（秒）；到 0 只停在 0，不自动代打（M2 无托管，M3 交给服务端） */
const TURN_SECONDS = 30;
/** 倒计时数字只在剩余 ≤ 10 秒时显示（其余时间只显示圆环图标） */
const COUNTDOWN_NUMBER_BELOW = 10;

const RULES: string[] = [
  '牌组档位（高的无条件压低的）：炸弹 8 ＞ 四夹一 7 ＞ 同花顺 6 ＞ 三条夹双 5 ＞ 同花 4 ＞ 顺子 3 ＞ 三条夹一 2 ＞ 三条 1。',
  '单张 / 对子 / 牌组三个大类不能互相压；炸弹不能压单张、对子。',
  '4~10 同点数视为一样大（可互相压）；J 以上同点数比花色 ♠＞♥＞♣＞♦。',
  '同花、同花顺先比花色再比最大牌；顺子先比最大牌点数，最大牌是 J/Q/K/A 时才比花色。',
  '三条 / 三条夹一 只能在本局第一手、三条阶段内、或手上只剩这几张时出。',
];

export default function App() {
  const game = useHotseatStore((state) => state.game);
  const seed = useHotseatStore((state) => state.seed);
  const selectedIds = useHotseatStore((state) => state.selectedCardIds);
  const notice = useHotseatStore((state) => state.notice);
  const noticeTone = useHotseatStore((state) => state.noticeTone);
  const viewSeat = useHotseatStore((state) => state.viewSeat);

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
  const pickReturn = useHotseatStore((state) => state.pickReturn);
  const nextHand = useHotseatStore((state) => state.nextHand);
  const dismissNotice = useHotseatStore((state) => state.dismissNotice);
  const cycleViewSeat = useHotseatStore((state) => state.cycleViewSeat);

  const [helpOpen, setHelpOpen] = useState(false);

  const activeSeat = getActiveSeat(game);
  const selfSeat = getSelfSeat(game, viewSeat);
  const statuses = getSeatStatuses(game);
  const supplyView = getSupplyView(game);
  const settleView = getSettleView(game);
  const deadlocked = supplyDeadlocked(game);

  // 自己 → 下家(+1) → 对家(+2) → 上家(+3)：逆时针，下家在右上、对家在顶、上家在左上
  const nextSeat = (selfSeat + 1) % 4;
  const oppositeSeat = (selfSeat + 2) % 4;
  const prevSeat = (selfSeat + 3) % 4;

  const isSelfTurn = activeSeat === selfSeat && game.phase === 'PLAYING';
  const selfHand = useMemo(
    () => sortHandDesc(game.players[selfSeat]?.hand ?? []),
    [game, selfSeat],
  );
  const effectiveSelected = isSelfTurn ? selectedIds : [];

  const turnKey = `${game.handNo}-${game.trickNo}-${activeSeat ?? 'x'}-${game.log.length}`;
  const remaining = useCountdown(turnKey, TURN_SECONDS);

  const playCheck = useMemo(() => {
    if (!isSelfTurn || activeSeat === null) return { ok: false, reason: '' };
    if (selectedIds.length === 0) return { ok: false, reason: '点选要出的牌' };
    return validatePlay(game, activeSeat, cardsByIds(game, selectedIds));
  }, [game, activeSeat, selectedIds, isSelfTurn]);

  const selfAction = getSeatTrickAction(game, selfSeat);
  const selfStatus = statuses.find((status) => status.seat === selfSeat);

  const renderOpponent = (seat: number, slot: 'top' | 'top-left' | 'top-right') => {
    const status = statuses.find((item) => item.seat === seat);
    const action = getSeatTrickAction(game, seat);
    const isActive = activeSeat === seat;
    const countdown = isActive && remaining <= COUNTDOWN_NUMBER_BELOW ? remaining : null;
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
          countdownSeconds={countdown}
          countdownActive={isActive && remaining > 0}
        />
      </div>
    );
  };

  const overlay = (() => {
    if (game.phase === 'PLAYING') return null;

    if (game.phase === 'REVEAL') {
      const seat = game.doubleSeat;
      if (seat === null) return null;
      return (
        <RevealPanel
          seatLabel={getSeatLabel(seat)}
          hand={sortHandDesc(game.players[seat]?.hand ?? [])}
          onReveal={reveal}
          onSkip={skipReveal}
        />
      );
    }

    if (game.phase === 'SUPPLY' && supplyView !== null) {
      const actor = activeSeat;
      return (
        <div className="overlay__stack">
          <SupplyPanel view={supplyView} stepText={getTurnLabel(game)} />
          {deadlocked && actor !== null && (
            <>
              <p className="overlay__line">
                {getSeatLabel(actor)} 上一局明牌输了要交 12 张，本局又是双地（♠3/♠A 不能交），最多只能交 11 张。
              </p>
              <ActionBar
                actions={[
                  { label: '明牌（债务作废）', onClick: reveal, tone: 'primary' },
                  { label: '重新发牌（债务保留）', onClick: redeal, tone: 'ghost' },
                ]}
              />
            </>
          )}
          {!deadlocked && game.supplyContext?.step === 'RETURN_SELECT' && actor !== null && (
            <ReturnSelectPanel
              seatLabel={getSeatLabel(actor)}
              hand={sortHandDesc(game.players[actor]?.hand ?? [])}
              selectedIds={selectedIds}
              required={game.supplyContext.perWinner.get(actor) ?? 0}
              onToggle={(card) => toggleCard(card.id)}
              onSubmit={submitReturnSelected}
              onAuto={autoReturn}
            />
          )}
          {!deadlocked && game.supplyContext?.step === 'RETURN_PICK' && actor !== null && (
            <ReturnPickPanel
              seatLabel={getSeatLabel(actor)}
              returnPool={game.supplyContext.returnPool}
              onPick={(card) => pickReturn(card.id)}
            />
          )}
        </div>
      );
    }

    if (game.phase === 'LOCK_WINDOW') {
      return (
        <LockWindowPanel
          statuses={statuses}
          onToggle={(seat, on) => setLockIntent(seat, on)}
          onFinish={finishLockWindow}
        />
      );
    }

    if (game.phase === 'SETTLE' && settleView !== null) {
      return <SettlePanel handNo={game.handNo} view={settleView} onNextHand={nextHand} />;
    }

    return null;
  })();

  return (
    <div className="tbl-shell">
      {/* 竖屏直接拒绝：提示横屏 */}
      <div className="rotate-hint">
        <div className="rotate-icon" aria-hidden="true">
          ↻
        </div>
        <p>请把手机横过来使用</p>
      </div>

      <div className="tbl">
        <div className="felt">
          {renderOpponent(prevSeat, 'top-left')}
          {renderOpponent(oppositeSeat, 'top')}
          {renderOpponent(nextSeat, 'top-right')}

          <div className="center">
            <p className="center__turn">{getTurnLabel(game)}</p>
            <div className="center__zone">
              {selfAction?.kind === 'PLAY' && <CardRow cards={selfAction.cards} size="played" />}
              {selfAction?.kind === 'PASS' && <span className="center__pass">不出</span>}
            </div>
          </div>

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

          <NoticeBar notice={notice} tone={noticeTone} onDismiss={dismissNotice} />

          {game.phase === 'PLAYING' && (
            <>
              <div className="strip-wrap">
                {isSelfTurn ? (
                  <ActionStrip
                    remainingSeconds={remaining}
                    timerActive={remaining > 0}
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
                disabled={!isSelfTurn}
              />
            </>
          )}

          {overlay !== null && <div className="overlay">{overlay}</div>}

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
