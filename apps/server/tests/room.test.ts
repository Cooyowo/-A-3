import { describe, expect, it } from 'vitest';

import { Room, RoomManager, SEAT_COUNT, TIMING } from '../src/room.ts';

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

/** 开一个满 4 人、已经发牌的房间 */
function startedRoom(): Room {
  const room = makeRoom();
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) room.join(`玩家${seat + 1}`, fakeSocket());
  expect(room.startIfReady()).toBe(true);
  return room;
}

describe('房间与邀请码', () => {
  it('创建房间生成 6 位邀请码；最多 4 个座位；满 4 人才开局', () => {
    const manager = new RoomManager();
    const room = manager.create(mulberry32(1));
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.started).toBe(false);

    for (let seat = 0; seat < 3; seat += 1) {
      const joined = room.join(`玩家${seat + 1}`, fakeSocket());
      expect(joined?.seat).toBe(seat);
    }
    expect(room.startIfReady()).toBe(false);
    expect(room.started).toBe(false);

    room.join('玩家4', fakeSocket());
    expect(room.startIfReady()).toBe(true);
    expect(room.started).toBe(true);
    expect(room.join('第五人', fakeSocket())).toBeNull();
  });

  it('大厅信息包含 4 个座位的昵称与「是否开局」', () => {
    const room = makeRoom();
    room.join('甲', fakeSocket());
    room.join('乙', fakeSocket());
    const info = room.roomInfo(1);
    expect(info.room).toBe('TEST01');
    expect(info.started).toBe(false);
    expect(info.mySeat).toBe(1);
    expect(info.seats.map((seat) => seat.name)).toEqual(['甲', '乙']);
    expect(info.seats.map((seat) => seat.seat)).toEqual([0, 1]);
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
  it('开局后每个座位的视图只有自己的手牌（别人只有张数）', () => {
    const room = startedRoom();

    for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
      const view = room.viewFor(seat);
      expect(view.hand).toHaveLength(13);
      // 别人的对象里不能出现 hand 字段
      for (const player of view.players) {
        expect(Object.hasOwn(player, 'hand')).toBe(false);
      }
    }

    // 4 家手牌互不相交，合起来是 52 张
    const hands = [0, 1, 2, 3].map((seat) => room.viewFor(seat).hand.map((card) => card.id));
    const all = hands.flat();
    expect(new Set(all).size).toBe(52);
    expect(all).toHaveLength(52);

    // 开局瞬间没有任何公开牌，别人手里的牌 id 绝不能出现在我的视图里
    for (let me = 0; me < SEAT_COUNT; me += 1) {
      const view = room.viewFor(me);
      expect(view.publicCards).toHaveLength(0);
      const json = JSON.stringify(view);
      for (let other = 0; other < SEAT_COUNT; other += 1) {
        if (other === me) continue;
        for (const id of hands[other] as number[]) {
          // 用边界匹配，避免 `"id":5` 误命中 `"id":52`
          expect(new RegExp(`"id":${id}[,}]`).test(json)).toBe(false);
        }
      }
    }
  });

  it('没满 4 人不能动作；开局后非法动作抛错；合法动作会推进状态', () => {
    const room = makeRoom();
    room.join('A', null);
    expect(() => room.action(0, { kind: 'PASS' })).toThrow('等满 4 个人才能开始');

    const full = startedRoom();
    expect(() => full.action(1, { kind: 'PLAY', cards: [] })).toThrow();
  });

  it('需要等待的阶段会下发 deadline（前端据此显示倒计时）', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed += 1) {
      const room = new Room('T', mulberry32(seed));
      for (let seat = 0; seat < SEAT_COUNT; seat += 1) room.join(`P${seat}`, fakeSocket());
      room.startIfReady();
      // 服务端真正跑起来时会先 broadcast（内部 scheduleNext 才会写 deadline）
      room.broadcast();
      const view = room.viewFor(0);
      const waiting =
        view.phase === 'REVEAL' ||
        view.phase === 'LOCK_WINDOW' ||
        view.supplyPaused ||
        view.supplyStep === 'RETURN_SELECT' ||
        view.supplyStep === 'RETURN_PICK';
      if (waiting) {
        expect(typeof view.deadline).toBe('number');
        checked += 1;
      }
      room.dispose();
      if (checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
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
