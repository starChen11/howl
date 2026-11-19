import { randomInt, randomUUID } from 'node:crypto';

import type { Action } from '@shared/actions';
import type { WinMode, SeatId } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
import type { CreateGameBody, GameSummary } from '@shared/api';

import { createInitialState } from '@engine/init';
import { replay } from '@engine/replay';
import { createEngine } from '@engine/step';
import { DEFAULT_APPLIERS, DEFAULT_HANDLERS } from '@engine/step';
import { DEFAULT_TRANSITIONS } from '@engine/transitions';

import type { MetaStore } from './meta-store';

/**
 * 基于 `MetaStore` 的门面（RFC-008 §2.4）：**不自建存储**。
 *
 * 事件流是唯一权威（ARCH-9）：`GameState` 一律由 `replay(events)` 得到，不另存一份
 * 可变状态与它对账——两份状态迟早不一致，而且没人知道哪份是对的。
 */

export interface GameRecord {
  gameId: string;
  seed: number;
  mode: WinMode;
  playerSeat: SeatId;
  status: 'active' | 'finished';
  events: EventEnvelope[];
  createdAt: number;
  finishedAt?: number;
  /** 终局快照由 RFC-014 填充；本 RFC 只留字段。 */
  snapshot?: unknown;
  /** 已应用过的动作，用于区分「重试」与「旧版本冲突」（§2.3）。 */
  applied: { version: number; type: string; seat: number }[];
}

export interface SessionRecord {
  id: string;
  createdAt: number;
  gameIds: string[];
}

/** 完整事件流保留的局数（Q-008-1 的假设）。 */
export const KEEP_FULL_EVENTS = 3;
/** 单会话对局上限（Q-008-3 的假设）。 */
export const MAX_GAMES_PER_SESSION = 20;
/** 会话存活时间：7 天（Q-008-2 的假设）。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 引擎实例与配置：构造一次即可，它本身是无状态的纯函数集合。 */
const engine = createEngine({
  transitions: DEFAULT_TRANSITIONS,
  handlers: DEFAULT_HANDLERS,
  appliers: DEFAULT_APPLIERS,
});

const sessionKey = (id: string): string => `session:${id}`;
const gameKey = (id: string): string => `game:${id}`;

export class GameRegistry {
  private readonly store: MetaStore;

  constructor(store: MetaStore) {
    this.store = store;
  }

  async createSession(): Promise<SessionRecord> {
    const session: SessionRecord = { id: randomUUID(), createdAt: Date.now(), gameIds: [] };
    await this.store.set(sessionKey(session.id), session);
    return session;
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    return this.store.get<SessionRecord>(sessionKey(id));
  }

  async listGames(session: SessionRecord): Promise<GameSummary[]> {
    const summaries: GameSummary[] = [];
    for (const gameId of session.gameIds) {
      const record = await this.store.get<GameRecord>(gameKey(gameId));
      if (record === undefined) continue;
      summaries.push({
        gameId: record.gameId,
        status: record.status,
        createdAt: record.createdAt,
        ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      });
    }
    return summaries;
  }

  async createGame(session: SessionRecord, body: CreateGameBody): Promise<GameRecord> {
    const seed = body.seed ?? randomInt(1, 2 ** 31 - 1);
    const playerSeat = (body.playerSeat ?? 1) as SeatId;

    const initial = createInitialState({ gameId: randomUUID(), seed, mode: body.mode, playerSeat });
    const start = engine.step(initial, {
      type: 'START',
      ts: Date.now(),
      seed,
      mode: body.mode,
      playerSeat,
    } as Action);

    const record: GameRecord = {
      gameId: initial.gameId,
      seed,
      mode: body.mode,
      playerSeat,
      status: start.state.phase === 'FINISHED' ? 'finished' : 'active',
      events: start.events,
      createdAt: Date.now(),
      applied: [],
    };

    await this.store.set(gameKey(record.gameId), record);

    // 会话里记录该局；超过上限时最旧的先释放（Q-008-3）。
    session.gameIds.push(record.gameId);
    if (session.gameIds.length > MAX_GAMES_PER_SESSION) {
      const evicted = session.gameIds.shift();
      if (evicted !== undefined) await this.release(evicted);
    }
    await this.store.set(sessionKey(session.id), session);

    return record;
  }

  async getGame(gameId: string): Promise<GameRecord | undefined> {
    return this.store.get<GameRecord>(gameKey(gameId));
  }

  /** 由事件流重建状态。**不缓存**可变状态（§4）。 */
  stateOf(record: GameRecord) {
    return replay(record.events as never);
  }

  /**
   * 提交一个动作。
   *
   * 版本语义（§2.3）：
   * - 等于当前版本 → 执行；
   * - 小于当前版本 → 若该版本上的**同一 action** 已应用过，返回 `ALREADY_APPLIED`；
   *   否则 `VERSION_MISMATCH`；
   * - 大于当前版本 → `VERSION_MISMATCH`。
   */
  async submit(
    record: GameRecord,
    action: Action,
    expectedVersion: number,
  ): Promise<
    | { ok: true; record: GameRecord; events: EventEnvelope[]; version: number }
    | { ok: false; code: 'ALREADY_APPLIED' | 'VERSION_MISMATCH'; version: number }
  > {
    const state = this.stateOf(record);
    const currentVersion = state.seq;

    if (expectedVersion !== currentVersion) {
      const sameAction = record.applied.some(
        (entry) =>
          entry.version === expectedVersion &&
          entry.type === action.type &&
          entry.seat === ('seat' in action ? action.seat : -1),
      );
      return {
        ok: false,
        code: sameAction ? 'ALREADY_APPLIED' : 'VERSION_MISMATCH',
        version: currentVersion,
      };
    }

    const result = engine.step(state, action);

    const updated: GameRecord = {
      ...record,
      events: [...record.events, ...result.events],
      applied: [
        ...record.applied,
        { version: expectedVersion, type: action.type, seat: 'seat' in action ? action.seat : -1 },
      ],
    };

    if (result.state.phase === 'FINISHED') {
      updated.status = 'finished';
      updated.finishedAt = Date.now();
    }

    await this.store.set(gameKey(record.gameId), updated);
    if (updated.status === 'finished') await this.enforceRetention();

    return { ok: true, record: updated, events: result.events, version: result.state.seq };
  }

  /** 释放：只保留最近 `KEEP_FULL_EVENTS` 局的完整事件流（§2.5）。 */
  async release(gameId: string): Promise<void> {
    const record = await this.store.get<GameRecord>(gameKey(gameId));
    if (record === undefined) return;
    await this.store.set(gameKey(gameId), { ...record, events: [] });
  }

  async enforceRetention(): Promise<void> {
    const keys = await this.store.keys('game:');
    const finished: GameRecord[] = [];

    for (const key of keys) {
      const record = await this.store.get<GameRecord>(key);
      if (record !== undefined && record.status === 'finished' && record.events.length > 0) {
        finished.push(record);
      }
    }

    finished.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    for (const stale of finished.slice(KEEP_FULL_EVENTS)) {
      await this.release(stale.gameId);
    }
  }
}
