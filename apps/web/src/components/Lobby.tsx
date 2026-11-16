/**
 * 联机大厅 / 房间等待页（M3）
 * ---------------------------------------------------------------------------
 * 只有两种状态，全部由 online store 驱动（不自己发 WS、不本地算牌）：
 *
 * A. 还没进房（store.room === null）
 *    昵称输入 → 「创建房间」；邀请码输入 → 「加入房间」；右侧显示连接状态。
 *    昵称空 / 邀请码不足 4 位时按钮禁用（store 里还有一层同样的校验）。
 *
 * B. 已进房、还没开局（room !== null 且 !room.started）
 *    大号邀请码 + 复制按钮、4 个座位格（自己的座位金框 + 「我」，掉线灰掉）、
 *    「4 人齐后自动发牌开局」、退出房间。
 *
 * 布局按手机横屏 844×390 设计（尺寸用 dvh/dvw + clamp），竖屏有兜底降级。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import type { NetStatus } from '../game/online/net';
import { useOnlineStore } from '../game/online/store';
import { Scene } from './Scene';
import '../styles/online.css';

/** 连接状态 → 中文说明（idle = 还没点过「在线对战」） */
const STATUS_TEXT: Record<NetStatus, string> = {
  idle: '未连接',
  connecting: '连接中…',
  open: '已连接',
  closed: '断线重连中…',
};

/** 4 个座位号（内部 0~3，界面显示 1~4） */
const SEAT_SLOTS: readonly number[] = [0, 1, 2, 3];

export function Lobby(): ReactElement {
  // 逐个字段订阅，避免整个 store 变化都重渲染
  const status = useOnlineStore((state) => state.status);
  const name = useOnlineStore((state) => state.name);
  const roomInput = useOnlineStore((state) => state.roomInput);
  const room = useOnlineStore((state) => state.room);
  const error = useOnlineStore((state) => state.error);

  const setName = useOnlineStore((state) => state.setName);
  const setRoomInput = useOnlineStore((state) => state.setRoomInput);
  const createRoom = useOnlineStore((state) => state.createRoom);
  const joinRoom = useOnlineStore((state) => state.joinRoom);
  const leaveRoom = useOnlineStore((state) => state.leaveRoom);
  const dismissError = useOnlineStore((state) => state.dismissError);

  /** 复制邀请码后的反馈（成功 / 失败都提示在这里） */
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const copyInvite = async (code: string): Promise<void> => {
    try {
      // 非安全上下文（老浏览器 / http 局域网）没有 clipboard，直接走失败提示
      if (typeof navigator === 'undefined' || typeof navigator.clipboard === 'undefined') {
        setCopyHint('复制失败，请手动记下邀请码');
        return;
      }
      await navigator.clipboard.writeText(code);
      setCopyHint('邀请码已复制');
    } catch {
      setCopyHint('复制失败，请手动记下邀请码');
    }
  };

  const trimmedName = name.trim();
  // 邀请码 4~8 位：不足 4 位不能点「加入房间」
  const codeReady = roomInput.trim().length >= 4;

  return (
    <div className="lobby-shell">
      {/* 背景直接用游戏里的剧场底板，和热座/牌桌保持同一画面 */}
      <Scene />

      <div className="lobby">
        <header className="lobby__head">
          <h1 className="lobby__title">在线对战</h1>
          <span className={`lobby-status lobby-status--${status}`}>{STATUS_TEXT[status]}</span>
        </header>

        {room === null ? (
          /* ------------------------------------------------ A. 未进房：创建 / 加入 */
          <div className="lobby-card">
            <label className="lobby-field">
              <span className="lobby-field__label">昵称</span>
              <input
                className="lobby-input"
                value={name}
                maxLength={16}
                placeholder="起个名字，朋友能看到"
                autoComplete="nickname"
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <div className="lobby-form__row">
              {/* 左：开新桌 */}
              <section className="lobby-form__col">
                <p className="lobby-form__tip">开一桌，把邀请码发给朋友</p>
                <button
                  type="button"
                  className="online-btn online-btn--gold"
                  disabled={trimmedName === ''}
                  onClick={createRoom}
                >
                  创建房间
                </button>
              </section>

              {/* 右：用邀请码加入 */}
              <section className="lobby-form__col">
                <div className="lobby-join">
                  <input
                    className="lobby-input lobby-input--code"
                    value={roomInput}
                    maxLength={8}
                    placeholder="邀请码"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setRoomInput(event.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  />
                  <button
                    type="button"
                    className="online-btn online-btn--ghost"
                    disabled={trimmedName === '' || !codeReady}
                    onClick={joinRoom}
                  >
                    加入房间
                  </button>
                </div>
              </section>
            </div>
          </div>
        ) : (
          /* ------------------------------------------------ B. 等开局：邀请码 / 座位 */
          <div className="lobby-card lobby-card--room">
            <div className="lobby-code">
              <span className="lobby-code__label">邀请码</span>
              <span className="lobby-code__value">{room.room}</span>
              <button
                type="button"
                className="online-btn online-btn--gold lobby-code__copy"
                onClick={() => {
                  void copyInvite(room.room);
                }}
              >
                复制邀请码
              </button>
            </div>
            {copyHint !== null && <p className="lobby-code__hint">{copyHint}</p>}

            <div className="lobby-seats">
              {SEAT_SLOTS.map((seatNo) => {
                const occupied = room.seats.find((item) => item.seat === seatNo) ?? null;
                const isMe = room.mySeat === seatNo;
                const offline = occupied !== null && !occupied.connected;
                const seatClass = [
                  'lobby-seat',
                  isMe ? 'lobby-seat--me' : '',
                  offline ? 'lobby-seat--offline' : '',
                ]
                  .filter((part) => part !== '')
                  .join(' ');

                return (
                  <div key={seatNo} className={seatClass}>
                    <span className="lobby-seat__no">{seatNo + 1} 号位</span>
                    {occupied === null ? (
                      <span className="lobby-seat__empty">等待玩家…</span>
                    ) : (
                      <>
                        <span className="lobby-seat__name" title={occupied.name}>
                          {occupied.name}
                        </span>
                        {offline && <span className="lobby-seat__offline">掉线</span>}
                      </>
                    )}
                    {isMe && <span className="lobby-seat__tag">我</span>}
                  </div>
                );
              })}
            </div>

            <p className="lobby-room__hint">
              {room.started ? '对局已经开始' : '4 人齐后自动发牌开局'}
            </p>

            <div className="lobby-room__foot">
              <span className="lobby-room__pos">
                {room.mySeat === null ? '观战中' : `我在 ${room.mySeat + 1} 号位`}
              </span>
              <button
                type="button"
                className="online-btn online-btn--ghost"
                onClick={() => {
                  setCopyHint(null);
                  leaveRoom();
                }}
              >
                退出房间
              </button>
            </div>
          </div>
        )}

        {/* 服务端错误（建房 / 加入失败等）：点 × 关掉 */}
        {error !== null && (
          <div className="lobby-error" role="alert">
            <span className="lobby-error__text">{error}</span>
            <button
              type="button"
              className="lobby-error__close"
              aria-label="关闭错误提示"
              onClick={dismissError}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Lobby;
