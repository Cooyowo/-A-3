import { describe, expect, it } from 'vitest';

import { Room, RoomManager, TIMING } from '../src/room.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeSocket(): { messages: string[]; send: (data: string) => void; close: () => void } {
  const messages: string[] = [];
  return { messages, send: (data: string) => messages.push(data), close: () => undefined };
}

function makeRoom(): Room {
  return new Room('TEST01', mulberry32(20261116));
}

describe('房间与邀请码', () => {
  it('创建房间生成 6 位邀请码；最多 4 个座位', () => {
    const manager = new RoomManager();
    const room = manager.create(mulberry32(1));
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);

    for (let seat = 0; seat < 4; seat += 1) {
      const joined = room.join(`玩家${seat + 1}`, fakeSocket());
      expect(joined?.seat).toBe(seat);
    }
    expect(room.playerCount).toBe(4);
    expect(room.join('第五人', fakeSocket())).toBeNull();
  });

  it('token 可以在断线后重连回原座位', () => {
    const room = makeRoom();
    const first = room.join('A', fakeSocket());
    const second = room.join('B', fakeSocket());
    if (first === null || second === null) throw new Error('join 失败');

    room.markDisconnected(second.seat);
    expect(room.isConnected(second.seat)).toBe(false);

    const resumed = room.join('', fakeSocket(), second.token);
    expect(resumed?.resumed).toBe(true);
    expect(resumed?.seat).toBe(second.seat);
    expect(room.isConnected(second.seat)).toBe(true);
  });
});

describe('服务端权威与隐藏信息', () => {
  it('每个座位的视图只有自己的手牌，别人的只有张数', () => {
    const room = makeRoom();
    for (let seat = 0; seat < 4; seat += 1) room.join(`玩家${seat + 1}`, fakeSocket());

    for (const seat of [0, 1, 2, 3]) {
      const view = room.viewFor(seat);
      expect(view.hand).toHaveLength(13);
      expect(Object.hasOwn(view, 'players')).toBe(true);
      for (const player of view.players) {
        expect(Object.hasOwn(player, 'hand')).toBe(false);
      }
      // 自己手里不能出现别人手牌（简单校验：4 家手牌 id 集合在服务端互不相交）
    }
    const hands = [0, 1, 2, 3].map((seat) => room.viewFor(seat).hand.map((card) => card.id));
    const all = hands.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('没满 4 人不能动作；动作必须合法', () => {
    const room = makeRoom();
    room.join('A', null);
    expect(() => room.action(0, { kind: 'PASS' })).toThrow('等满 4 个人才能开始');

    for (let seat = 0; seat < 4; seat += 1) room.join(`玩家${seat + 1}`, null);
    expect(() => room.action(1, { kind: 'PLAY', cards: [] })).toThrow();
  });
});

describe('时间参数', () => {
  it('关键节奏有默认值（明牌 4s、供牌等待 4s、回牌 20s、挑牌 15s、锁定 5s）', () => {
    expect(TIMING.reveal).toBe(4000);
    expect(TIMING.supplyWait).toBe(4000);
    expect(TIMING.returnSelect).toBe(20000);
    expect(TIMING.returnPick).toBe(15000);
    expect(TIMING.lock).toBe(5000);
  });
});
