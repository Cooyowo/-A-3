import { useMemo } from 'react';

import { legalActions, validatePlay } from '@a3/core';
import type { PatternType } from '@a3/core';

import { HandView } from './components/HandView';
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
import { SeatPanel } from './components/SeatPanel';
import { TableCenter } from './components/TableCenter';
import {
  cardsByIds,
  getActiveSeat,
  getLastPlayText,
  getPhaseName,
  getSeatLabel,
  getSeatStatuses,
  getSettleView,
  getSupplyView,
  getTurnHint,
  IDENTITY_TEXT,
  publicCardList,
  sortHandDesc,
} from './game/selectors';
import { supplyDeadlocked, useHotseatStore } from './game/store';

const PATTERN_TEXT: Readonly<Record<PatternType, string>> = {
  SINGLE: '单张',
  PAIR: '对子',
  TRIPLE: '三条',
  TRIPLE_ONE: '三条夹一',
  STRAIGHT: '顺子',
  FLUSH: '同花',
  TRIPLE_PAIR: '三条夹双',
  STRAIGHT_FLUSH: '同花顺',
  FOUR_ONE: '四夹一',
  BOMB: '炸弹',
};

export default function App() {
  const game = useHotseatStore((state) => state.game);
  const seed = useHotseatStore((state) => state.seed);
  const selectedIds = useHotseatStore((state) => state.selectedCardIds);
  const notice = useHotseatStore((state) => state.notice);
  const noticeTone = useHotseatStore((state) => state.noticeTone);

  const newGame = useHotseatStore((state) => state.newGame);
  const toggleCard = useHotseatStore((state) => state.toggleCard);
  const clearSelection = useHotseatStore((state) => state.clearSelection);
  const playSelected = useHotseatStore((state) => state.playSelected);
  const pass = useHotseatStore((state) => state.pass);
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

  const activeSeat = getActiveSeat(game);
  const statuses = getSeatStatuses(game);
  const supplyView = getSupplyView(game);
  const settleView = getSettleView(game);
  const lastPlay = getLastPlayText(game);
  const deadlocked = supplyDeadlocked(game);

  const activeHand = useMemo(
    () => (activeSeat === null ? [] : sortHandDesc(game.players[activeSeat]?.hand ?? [])),
    [game, activeSeat],
  );

  const playCheck = useMemo(() => {
    if (game.phase !== 'PLAYING' || activeSeat === null) return { ok: false, reason: '' };
    if (selectedIds.length === 0) return { ok: false, reason: '点选要出的牌' };
    const cards = cardsByIds(game, selectedIds);
    return validatePlay(game, activeSeat, cards);
  }, [game, activeSeat, selectedIds]);

  const canPass = useMemo(() => {
    if (game.phase !== 'PLAYING' || activeSeat === null) return false;
    return legalActions(game, activeSeat).some((action) => action.kind === 'PASS');
  }, [game, activeSeat]);

  const topHint = game.topPattern === null ? '自由领出' : `需要压过：${PATTERN_TEXT[game.topPattern.type]}`;
  const supplyStepText = getTurnHint(game);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="brand">葵A葵3</span>
          <span className="meta">
            第 {game.handNo} 局 · {getPhaseName(game)}
          </span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost" onClick={() => newGame()}>
            新开一局
          </button>
        </div>
      </header>

      <NoticeBar notice={notice} tone={noticeTone} onDismiss={dismissNotice} />

      <section className="seats" aria-label="四家状态">
        {statuses.map((status) => (
          <SeatPanel
            key={status.seat}
            label={status.label}
            identityText={IDENTITY_TEXT[status.identity]}
            handCount={status.handCount}
            isActive={status.isActive}
            locked={status.locked}
            out={status.out}
            rank={status.rank}
            position="top"
            showBack={status.handCount > 0 && status.seat !== activeSeat}
          />
        ))}
      </section>

      <TableCenter
        phaseText={`第 ${game.handNo} 局 · ${getPhaseName(game)}`}
        turnHint={getTurnHint(game)}
        lastPlay={lastPlay === null ? null : { label: lastPlay.label, cards: lastPlay.cards }}
        topHint={topHint}
        threePhase={game.threePhase}
        publicCards={publicCardList(game)}
      />

      <main className="stage">
        {game.phase === 'REVEAL' && activeSeat !== null && (
          <RevealPanel
            seatLabel={getSeatLabel(activeSeat)}
            hand={activeHand}
            onReveal={reveal}
            onSkip={skipReveal}
          />
        )}

        {game.phase === 'SUPPLY' && (
          <>
            {supplyView !== null && <SupplyPanel view={supplyView} stepText={supplyStepText} />}

            {deadlocked && activeSeat !== null && (
              <div className="deadlock">
                <p className="deadlock-title">
                  {getSeatLabel(activeSeat)} 上一局明牌输了，本局要交 12 张；但本局又是双地，♠3/♠A 不能交，
                  最多只能交 11 张。
                </p>
                <p className="deadlock-hint">请二选一：明牌（债务作废，由你首发）或重新发牌（债务保留）。</p>
                <ActionBar
                  actions={[
                    { label: '明牌（债务作废）', onClick: reveal, tone: 'primary' },
                    { label: '重新发牌（债务保留）', onClick: redeal, tone: 'ghost' },
                  ]}
                />
              </div>
            )}

            {!deadlocked && game.supplyContext?.step === 'RETURN_SELECT' && activeSeat !== null && (
              <ReturnSelectPanel
                seatLabel={getSeatLabel(activeSeat)}
                hand={activeHand}
                selectedIds={selectedIds}
                required={game.supplyContext.perWinner.get(activeSeat) ?? 0}
                onToggle={(card) => toggleCard(card.id)}
                onSubmit={submitReturnSelected}
                onAuto={autoReturn}
              />
            )}

            {!deadlocked && game.supplyContext?.step === 'RETURN_PICK' && activeSeat !== null && (
              <ReturnPickPanel
                seatLabel={getSeatLabel(activeSeat)}
                returnPool={game.supplyContext.returnPool}
                onPick={(card) => pickReturn(card.id)}
              />
            )}
          </>
        )}

        {game.phase === 'LOCK_WINDOW' && (
          <LockWindowPanel
            statuses={statuses}
            onToggle={(seat, on) => setLockIntent(seat, on)}
            onFinish={finishLockWindow}
          />
        )}

        {game.phase === 'PLAYING' && activeSeat !== null && (
          <>
            <section className="my-hand" aria-label="我的手牌">
              <div className="hand-head">
                <span className="hand-owner">{getSeatLabel(activeSeat)}</span>
                <span className="hand-tip">点选要出的牌（{activeHand.length} 张）</span>
              </div>
              <HandView
                cards={activeHand}
                selectedIds={selectedIds}
                selectable
                onToggle={(card) => toggleCard(card.id)}
                size="md"
              />
            </section>
            <ActionBar
              hint={playCheck.ok ? topHint : playCheck.reason}
              actions={[
                { label: '出牌', onClick: playSelected, disabled: !playCheck.ok, tone: 'primary' },
                { label: '不要', onClick: pass, disabled: !canPass, tone: 'ghost' },
                { label: '清空选牌', onClick: clearSelection, disabled: selectedIds.length === 0, tone: 'ghost' },
              ]}
            />
          </>
        )}

        {game.phase === 'SETTLE' && settleView !== null && (
          <SettlePanel handNo={game.handNo} view={settleView} onNextHand={nextHand} />
        )}
      </main>

      <footer className="foot">
        <details className="rules">
          <summary>规则速查</summary>
          <ul>
            <li>牌组档位（高的无条件压低的）：炸弹 8 ＞ 四夹一 7 ＞ 同花顺 6 ＞ 三条夹双 5 ＞ 同花 4 ＞ 顺子 3 ＞ 三条夹一 2 ＞ 三条 1。</li>
            <li>单张/对子/牌组三个大类不能互相压；炸弹不能压单张、对子。</li>
            <li>4~10 同点数视为一样大（可以互相压）；J 以上同点数比花色 ♠＞♥＞♣＞♦。</li>
            <li>同花、同花顺：先比花色，再比最大牌。顺子：先比最大牌点数，最大牌是 J/Q/K/A 时再比花色。</li>
            <li>三条/三条夹一 只能在本局第一手、三条阶段内、或手上只剩这几张时出。</li>
          </ul>
        </details>
        <p className="seed">随机种子 {seed}（同一副牌问题可用它复现）</p>
      </footer>
    </div>
  );
}
