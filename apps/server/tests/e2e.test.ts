/**
 * M3 端到端验收（真实 WebSocket，4 个客户端打完一局）。
 *
 * 验收点（对应 START-HERE 的 M3 标准）：
 * 1. 4 个客户端能各自创建/加入房间，满 4 人后服务端自动发牌开局；
 * 2. 能一路打到结算（服务端权威：客户端只发动作，不算牌）；
 * 3. **隐藏信息**：每个客户端收到的视图里只有自己的手牌，别人的手牌字段根本不存在；
 * 4. 断线重连：断开后其他人看到掉线；用 token 能回到原座位并拿回自己的手牌；
 * 5. 非法动作只回错误，不影响牌局。
 */

import type { AddressInfo } from 'node:net';

import { defaultReturnCards, legalActions, maxCard } from '@a3/core';
import type { Action } from '@a3/core';
import type { PlayerView, RoomInfo, ServerMessage } from '@a3/protocol';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { viewToGameState } from '../../web/src/game/online/adapter.ts';
import { TIMING } from '../src/room.ts';
import { buildServer } from '../src/server.ts';

type App = ReturnType<typeof buildServer>;

let app: App;
let url = '';

beforeAll(async () => {
  // 测试里把服务端节奏调快，避免每个等待阶段都要等 4~20 秒
  TIMING.reveal = 300;
  TIMING.supplyWait = 300;
  TIMING.returnSelect = 4000;
  TIMING.returnPick = 4000;
  TIMING.lock = 300;
  TIMING.nextHandDelay = 300;

  app = buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  url = `ws://127.0.0.1:${address.port}/ws`;
});

afterAll(async () => {
  await app.close();
});

class TestClient {
  readonly name: string;
  ws: WebSocket;
  seat = -1;
  token = '';
  room: RoomInfo | null = null;
  view: PlayerView | null = null;
  errors: string[] = [];
  private readonly views: PlayerView[] = [];
  /** 上一次决策被服务端拒绝时，下一轮强制 Pass，避免死循环重发同一个非法动作 */
  private forcePass = false;
  private seenErrors = 0;

  constructor(name: string) {
    this.name = name;
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.t === 'joined') {
        this.seat = message.seat;
        this.token = message.token;
      } else if (message.t === 'room') {
        this.room = message.info;
      } else if (message.t === 'view') {
        this.view = message.view;
        this.views.push(message.view);
      } else if (message.t === 'error') {
        this.errors.push(message.message);
      }
    });
  }

  static async open(name: string): Promise<TestClient> {
    const client = new TestClient(name);
    await new Promise<void>((resolve, reject) => {
      client.ws.once('open', () => resolve());
      client.ws.once('error', reject);
    });
    return client;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  async waitFor(predicate: () => boolean, timeoutMs = 8000, label = '条件'): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`等待超时：${label}（seat=${this.seat} view=${this.view?.phase ?? 'null'}）`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** 当前视图里，我该做什么（返回 null 表示不轮到我） */
  decide(): { action: Action; key: string } | null {
    const view = this.view;
    if (view === null) return null;
    const key = `${view.handNo}-${view.phase}-${view.supplyStep ?? '-'}-${view.currentSeat}-${view.log.length}-${view.hand.length}-${view.pickSeat ?? '-'}`;

    if (this.errors.length > this.seenErrors) {
      this.seenErrors = this.errors.length;
      this.forcePass = true;
    }
    if (view.phase === 'REVEAL' && view.doubleSeat === this.seat) {
      return { action: { kind: 'PASS' }, key };
    }
    if (view.supplyDeadlocked && view.debt !== null && view.debt.losers.includes(this.seat)) {
      return { action: { kind: 'REVEAL' }, key };
    }
    if (view.phase === 'SUPPLY' && !view.supplyPaused && view.supplyStep === 'RETURN_SELECT') {
      if (view.returnRequired !== null) {
        const game = viewToGameState(view);
        const cards = defaultReturnCards(game.players[this.seat]?.hand ?? [], view.returnRequired);
        return { action: { kind: 'RETURN_CARDS', cards }, key };
      }
      return null;
    }
    if (view.phase === 'SUPPLY' && view.supplyStep === 'RETURN_PICK' && view.pickSeat === this.seat) {
      const card = maxCard(view.returnPool);
      if (card === null) return null;
      return { action: { kind: 'PICK_RETURN', card }, key };
    }
    if (view.phase === 'LOCK_WINDOW' && view.myLockEligible && !view.myLockIntent) {
      return { action: { kind: 'LOCK' }, key };
    }
    if (view.phase === 'PLAYING' && view.currentSeat === this.seat) {
      if (this.forcePass) {
        this.forcePass = false;
        return { action: { kind: 'PASS' }, key: `${key}-pass` };
      }
      const game = viewToGameState(view);
      const actions = legalActions(game, this.seat);
      const action = actions.find((item) => item.kind === 'PLAY') ?? actions.find((item) => item.kind === 'PASS');
      return action === undefined ? null : { action, key };
    }
    return null;
  }
}

async function setupRoom(): Promise<TestClient[]> {
  const host = await TestClient.open('甲');
  host.send({ t: 'create', name: '甲' });
  await host.waitFor(() => host.room !== null, 5000, '创建房间');
  const code = host.room?.room ?? '';
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const others: TestClient[] = [];
  for (const name of ['乙', '丙', '丁']) {
    const client = await TestClient.open(name);
    client.send({ t: 'join', room: code, name });
    others.push(client);
    await client.waitFor(() => client.room !== null, 5000, `加入房间 ${name}`);
  }

  const clients = [host, ...others];
  for (const client of clients) {
    await client.waitFor(() => client.view !== null, 8000, `收到视图 ${client.name}`);
  }
  return clients;
}

describe('M3 端到端：4 人联机打完一局', () => {
  it('建房间 → 加入 → 服务端发牌 → 打到结算，且全程不泄露别人的手牌', async () => {
    const clients = await setupRoom();

    // 1) 满 4 人自动开局：每人 13 张、座位唯一
    expect(new Set(clients.map((client) => client.seat)).size).toBe(4);
    for (const client of clients) {
      expect(client.view?.hand).toHaveLength(13);
      expect(client.view?.players).toHaveLength(4);
    }

    // 2) 隐藏信息：开局视图里没有别人的手牌字段，也搜不到别人的牌 id
    const handsBySeat = new Map<number, number[]>();
    for (const client of clients) {
      handsBySeat.set(client.seat, (client.view?.hand ?? []).map((card) => card.id));
    }
    expect([...handsBySeat.values()].flat()).toHaveLength(52);
    for (const client of clients) {
      const view = client.view as PlayerView;
      expect(view.publicCards).toHaveLength(0);
      for (const player of view.players) {
        expect(Object.hasOwn(player, 'hand')).toBe(false);
      }
      const json = JSON.stringify(view);
      for (const [seat, ids] of handsBySeat) {
        if (seat === client.seat) continue;
        for (const id of ids) {
          expect(new RegExp(`"id":${id}[,}]`).test(json), `座位 ${seat} 的牌 ${id} 泄露给了 ${client.seat}`).toBe(false);
        }
      }
    }

    // 3) 打到结算：每轮让「该我动的客户端」按服务端视图做合法动作
    const lastSent = new Map<string, string>();
    const deadline = Date.now() + 90_000;
    let steps = 0;
    while (Date.now() < deadline) {
      const settled = clients.every((client) => client.view?.phase === 'SETTLE');
      if (settled) break;
      for (const client of clients) {
        const decision = client.decide();
        if (decision === null) continue;
        const signature = `${client.seat}:${decision.key}:${decision.action.kind}`;
        if (lastSent.get(String(client.seat)) === signature) continue;
        lastSent.set(String(client.seat), signature);
        client.send({ t: 'action', action: decision.action });
        steps += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(steps).toBeGreaterThan(10);
    for (const client of clients) {
      expect(client.view?.phase, `${client.name} 没有到结算`).toBe('SETTLE');
      expect(client.view?.result).not.toBeNull();
      expect(client.errors, `${client.name} 收到错误：${client.errors.join(' / ')}`).toEqual([]);
    }

    // 4) 结算视图同样不含别人手牌
    for (const client of clients) {
      const view = client.view as PlayerView;
      for (const player of view.players) {
        expect(Object.hasOwn(player, 'hand')).toBe(false);
      }
      expect(view.hand.length).toBeLessThanOrEqual(25);
    }

    for (const client of clients) client.ws.close();
  }, 120_000);

  it('断线 30 秒内可以用 token 回到原座位并拿回自己的手牌', async () => {
    const clients = await setupRoom();
    const target = clients[1] as TestClient;
    const seat = target.seat;
    const handIds = (target.view?.hand ?? []).map((card) => card.id);
    const token = target.token;

    target.ws.close();
    // 其他人应看到该座位掉线
    const observer = clients[0] as TestClient;
    await observer.waitFor(
      () => observer.view?.players.some((player) => player.seat === seat && !player.connected) === true,
      5000,
      '看到掉线',
    );

    const resumed = new TestClient(`乙(重连)`);
    await new Promise<void>((resolve, reject) => {
      resumed.ws.once('open', () => resolve());
      resumed.ws.once('error', reject);
    });
    resumed.send({ t: 'resume', token });
    await resumed.waitFor(() => resumed.view !== null, 8000, '重连后收到视图');

    expect(resumed.seat).toBe(seat);
    expect(resumed.view?.hand.map((card) => card.id)).toEqual(handIds);

    resumed.ws.close();
    for (const client of clients) {
      if (client !== target) client.ws.close();
    }
  }, 30_000);

  it('非法动作只返回错误，不影响牌局与其他玩家', async () => {
    const clients = await setupRoom();
    const attacker = clients[0] as TestClient;
    const before = JSON.stringify(attacker.view);

    attacker.errors.length = 0;
    attacker.send({ t: 'action', action: { kind: 'PLAY', cards: [] } });
    await attacker.waitFor(() => attacker.errors.length > 0, 4000, '收到错误消息');
    expect(attacker.errors[0]).toBeTruthy();
    expect(JSON.stringify(attacker.view)).toBe(before);

    for (const client of clients) client.ws.close();
  }, 30_000);
});
