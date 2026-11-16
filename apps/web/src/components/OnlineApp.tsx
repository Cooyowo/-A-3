/**
 * 联机模式总入口（M3）
 * ---------------------------------------------------------------------------
 * 只做两件事：
 * 1) 路由：screen === 'room'（或房间还没开局）→ <Lobby />；否则 → <OnlineTable />；
 * 2) 顶部提示：断线（status === 'closed'）橙色横幅、服务端错误红色横幅（可关闭）。
 *
 * 不在这里做任何业务动作（建房 / 加入 / 发牌都在 store 与牌桌组件里）。
 */

import type { ReactElement } from 'react';

import { useOnlineStore } from '../game/online/store';
import { Lobby } from './Lobby';
import { OnlineTable } from './OnlineTable';

export function OnlineApp(): ReactElement {
  const screen = useOnlineStore((state) => state.screen);
  const room = useOnlineStore((state) => state.room);
  const status = useOnlineStore((state) => state.status);
  const error = useOnlineStore((state) => state.error);
  const dismissError = useOnlineStore((state) => state.dismissError);

  // 在房间里但还没开局（4 人未齐）时，牌桌还没东西可打 → 留在大厅等待页
  const showLobby = screen === 'room' || (room !== null && !room.started);

  return (
    <div className="online-app">
      {/* 顶部固定状态条：不占位、浮在页面最上层（大厅 / 牌桌都适用） */}
      <div className="online-bars">
        {status === 'closed' && (
          <div className="online-bar online-bar--warn" role="status">
            与服务器断开，正在重连…
          </div>
        )}
        {error !== null && (
          <div className="online-bar online-bar--error" role="alert">
            <span className="online-bar__text">{error}</span>
            <button
              type="button"
              className="online-bar__close"
              aria-label="关闭错误提示"
              onClick={dismissError}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {showLobby ? <Lobby /> : <OnlineTable />}
    </div>
  );
}

export default OnlineApp;
