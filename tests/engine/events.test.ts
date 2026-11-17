import { describe, expect, it } from 'vitest';

import type { GameEvent } from '@shared/events';
import { GAME_EVENT_TYPES } from '@shared/events';
import { GameStartedPayloadSchema, RejectedPayloadSchema } from '@shared/schemas';

import { replay } from '@engine/replay';
import { step } from '@engine/step';

import { lobbyState, startActionOf, playerSeatOf } from '../fixtures/states';

/**
 * AC-6 / AC-7：事件流的信封契约（DATA-1 / DATA-2）。
 *
 * `seq` 由 `step` 统一盖章，所以这里测的是「盖章那条路只有一条」——handler 拿不到 seq，
 * 也就写不出跳号或重复。
 */

describe('AC-6 · seq 与事件类型', () => {
  it('seq 从 1 开始严格递增、无跳号、无重复', () => {
    const lobby = lobbyState();
    const started = step(lobby, startActionOf(lobby));

    expect(started.events).toHaveLength(1);
    expect(started.events[0]?.seq).toBe(1);
    expect(started.state.seq).toBe(1);

    const rejected = step(started.state, { type: 'VOTE', ts: 2_000, seat: 2, target: 'abstain' });
    expect(rejected.events[0]?.seq).toBe(2);
    expect(rejected.state.seq).toBe(2);

    const another = step(rejected.state, { type: 'SPEECH_SKIP', ts: 3_000, seat: 4 });
    expect(another.events[0]?.seq).toBe(3);
  });

  it('每条事件的 type 都落在运行时事件类型集合内', () => {
    const lobby = lobbyState();
    const started = step(lobby, startActionOf(lobby));
    const rejected = step(started.state, { type: 'SELF_EXPOSE', ts: 2, seat: 1 });

    for (const event of [...started.events, ...rejected.events]) {
      expect(GAME_EVENT_TYPES).toContain(event.type);
    }
  });

  it('每条事件都带 gameId 与数字 ts', () => {
    const lobby = lobbyState();
    const result = step(lobby, startActionOf(lobby, 12_345));

    for (const event of result.events) {
      expect(event.gameId).toBe(lobby.gameId);
      expect(typeof event.ts).toBe('number');
      expect(Number.isFinite(event.ts)).toBe(true);
    }
  });

  it('REJECTED 的 payload schema 能校验真实载荷（N3）', () => {
    const lobby = lobbyState();
    const rejected = step(lobby, { type: 'VOTE', ts: 1, seat: 2, target: 'abstain' });

    expect(RejectedPayloadSchema.safeParse(rejected.events[0]?.payload).success).toBe(true);
    expect(
      RejectedPayloadSchema.safeParse({ actionType: 'NOT_AN_ACTION', code: 'X', message: 'y' })
        .success,
    ).toBe(false);
  });

  it('ts 来自 action，不由引擎读时钟（ARCH-4 / Q-002-1）', () => {
    const lobby = lobbyState();
    const result = step(lobby, startActionOf(lobby, 987_654));

    expect(result.events[0]?.ts).toBe(987_654);
  });
});

describe('post-START 的相位与天数（评审 N5 / P22）', () => {
  it('开局后进入第一夜的 NIGHT_WOLF_CHAT，day === 1', () => {
    // P22：把 GAME_STARTED 之后的 phase 改成 DAY_ANNOUNCE，全套 12 个引擎测试仍然全绿。
    const lobby = lobbyState();
    const started = step(lobby, startActionOf(lobby)).state;

    expect(started.phase).toBe('NIGHT_WOLF_CHAT');
    expect(started.day).toBe(1);
  });

  it('LOBBY 里 day 是 0（不属于任何一天）', () => {
    expect(lobbyState().day).toBe(0);
    expect(lobbyState().phase).toBe('LOBBY');
  });

  it('replay 也重建出同样的相位与天数', () => {
    const lobby = lobbyState();
    const result = step(lobby, startActionOf(lobby));

    expect(replay(result.events).phase).toBe('NIGHT_WOLF_CHAT');
    expect(replay(result.events).day).toBe(1);
  });
});

describe('AC-7 · 首事件与 GAME_STARTED 的 payload', () => {
  const lobby = lobbyState();
  const started = step(lobby, startActionOf(lobby));
  const first: GameEvent | undefined = started.events[0];

  it('首个事件是 GAME_STARTED', () => {
    expect(first?.type).toBe('GAME_STARTED');
  });

  it('payload 含 seed / mode / playerSeat / roles', () => {
    if (first?.type !== 'GAME_STARTED') throw new Error('首个事件不是 GAME_STARTED');

    expect(first.payload.seed).toBe(lobby.seed);
    expect(first.payload.mode).toBe(lobby.mode);
    expect(first.payload.playerSeat).toBe(playerSeatOf(lobby));
    expect(first.payload.roles).toHaveLength(9);
  });

  it('payload 的 roles 就是发牌结果，且与 state 一致（事件是权威）', () => {
    if (first?.type !== 'GAME_STARTED') throw new Error('首个事件不是 GAME_STARTED');

    expect(first.payload.roles).toEqual(lobby.seats.map((seat) => seat.role));
    expect(started.state.seats.map((seat) => seat.role)).toEqual(first.payload.roles);
  });

  it('payload schema 能校验真实 payload，并拒绝坏数据（N3）', () => {
    if (first?.type !== 'GAME_STARTED') throw new Error('首个事件不是 GAME_STARTED');

    expect(GameStartedPayloadSchema.safeParse(first.payload).success).toBe(true);
    expect(GameStartedPayloadSchema.safeParse({ ...first.payload, roles: ['wolf'] }).success).toBe(
      false,
    );
    expect(GameStartedPayloadSchema.safeParse({ ...first.payload, playerSeat: 10 }).success).toBe(
      false,
    );
  });

  it('可见性是 server：任何席位都不该看到全员身份', () => {
    expect(first?.visibleTo).toBe('server');
  });

  it('带 rngAfter（发牌消耗过随机数，否则无法精确重放）', () => {
    expect(first?.rngAfter).toBeDefined();
  });
});
