import { describe, expect, it } from 'vitest';

import type { GameEvent } from '@shared/events';

import { MissingRngStateError, UnknownEventError } from '@engine/errors';
import { initialStateFromSeed } from '@engine/rng';
import { replay } from '@engine/replay';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-4：`replay(events)` **只接收事件流**就能重建状态。
 *
 * 这条 AC 的意义是「事件是唯一权威」：只要事件流在，就算发牌算法将来改了，旧对局仍能
 * 完整重建。所以测试里刻意不把初始状态传给 `replay`。
 */

function eventsOfStart(seed = 777): GameEvent[] {
  const lobby = lobbyState({ seed });
  return step(lobby, startActionOf(lobby)).events;
}

describe('AC-4 · replay 只靠事件流重建状态', () => {
  it('重放结果与产生它的事件源状态深度相等', () => {
    const lobby = lobbyState({ seed: 777 });
    const result = step(lobby, startActionOf(lobby));

    expect(replay(result.events)).toEqual(result.state);
  });

  it('重放出来的状态带着发牌后的生成器状态（不是初始种子态）', () => {
    const lobby = lobbyState({ seed: 777 });
    const result = step(lobby, startActionOf(lobby));
    const replayed = replay(result.events);

    expect(replayed.rng).toEqual(result.state.rng);
    // LOBBY 状态里的已经是「发牌之后」的生成器状态，所以真正的对照是初始种子态。
    expect(replayed.rng).not.toEqual(initialStateFromSeed(lobby.seed));
  });

  it('可以重放一条含拒绝事件的事件流，且 seq 与终态一致', () => {
    const lobby = lobbyState();
    const started = step(lobby, startActionOf(lobby));
    const rejected = step(started.state, { type: 'VOTE', ts: 2_000, seat: 2, target: 'abstain' });

    const stream = [...started.events, ...rejected.events];
    const replayed = replay(stream);

    expect(replayed).toEqual(rejected.state);
    // GAME_STARTED + PHASE_CHANGED（RFC-003 起 START 推两相位）+ REJECTED
    expect(replayed.seq).toBe(3);
  });

  it('空事件流抛 InvalidEventStreamError', () => {
    expect(() => replay([])).toThrow(/事件流为空/);
  });

  it('首事件不是 GAME_STARTED 时抛错', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent === undefined) throw new Error('缺少 GAME_STARTED');

    const bogus: GameEvent = {
      ...startedEvent,
      seq: 1,
      type: 'REJECTED',
      payload: { actionType: 'START', code: 'PHASE_MISMATCH', message: 'x' },
    };

    expect(() => replay([bogus])).toThrow(/首个事件必须是 GAME_STARTED/);
  });

  it('seq 跳号时抛错（事件流被截断或拼错，宁可失败也不要折叠出假状态）', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent === undefined) throw new Error('缺少 GAME_STARTED');

    const gap: GameEvent = { ...startedEvent, seq: 3 };

    expect(() => replay([gap])).toThrow(/seq 必须严格递增/);
  });

  it('消耗随机数的事件缺 rngAfter 时抛 MissingRngStateError', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent === undefined) throw new Error('缺少 GAME_STARTED');

    // 显式重建一个不带 rngAfter 的信封：它就是「消耗了随机数却忘了记录」的坏事件。
    const broken: GameEvent = {
      gameId: startedEvent.gameId,
      seq: startedEvent.seq,
      ts: startedEvent.ts,
      type: 'GAME_STARTED',
      visibleTo: startedEvent.visibleTo,
      payload: startedEvent.payload,
    } as GameEvent;

    expect(() => replay([broken])).toThrow(MissingRngStateError);
  });

  it('状态属于另一局时抛错（不许把两局事件流拼在一起）', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent === undefined) throw new Error('缺少 GAME_STARTED');

    // 第一个事件建立 gameId；第二个事件的 gameId 不同 → 说明拼接了两局。
    const foreign: GameEvent = {
      gameId: 'another-game',
      seq: 2,
      ts: 0,
      type: 'REJECTED',
      visibleTo: 'public',
      payload: { actionType: 'START', code: 'PHASE_MISMATCH', message: 'x' },
    };

    expect(() => replay([startedEvent, foreign])).toThrow(/混入了别的对局/);
  });

  it('GAME_STARTED 的 roles 数量不对时抛错（数据损坏，不能折叠出半个棋盘）', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent?.type !== 'GAME_STARTED') throw new Error('缺少 GAME_STARTED');

    const broken: GameEvent = {
      ...startedEvent,
      payload: { ...startedEvent.payload, roles: startedEvent.payload.roles.slice(0, 8) },
    };

    expect(() => replay([broken])).toThrow(/roles 必须是 9 项/);
  });

  it('GAME_STARTED 的 personas 数量不对时抛错', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent?.type !== 'GAME_STARTED') throw new Error('缺少 GAME_STARTED');

    const broken: GameEvent = {
      ...startedEvent,
      payload: { ...startedEvent.payload, personas: [] },
    };

    expect(() => replay([broken])).toThrow(/personas 必须是 9 项/);
  });

  /**
   * 评审 B2 / P4：正常事件流里，「用 payload.roles」和「按 payload.seed 重新发牌」结果
   * 完全相同，所以一条会破坏旧对局重放的实现也能全绿。要锁住「事件是唯一权威」，
   * 必须造一个**与重新发牌结果不同**的合成事件。
   */
  it('采用 payload.roles 的发牌结果，而不是按 seed 重新发牌', () => {
    const lobby = lobbyState({ seed: 777 });
    const [original] = step(lobby, startActionOf(lobby)).events;
    if (original?.type !== 'GAME_STARTED') throw new Error('缺少 GAME_STARTED');

    // 互换两个**身份不同**的席位：如果实现改成按 seed 重新发牌，这个结果就对不上。
    const roles = [...original.payload.roles];
    const firstWolf = roles.findIndex((role) => role === 'wolf');
    const firstGood = roles.findIndex((role) => role !== 'wolf');
    if (firstWolf < 0 || firstGood < 0) throw new Error('夹具里缺少狼或好人');
    const wolfRole = roles[firstWolf];
    const goodRole = roles[firstGood];
    if (wolfRole === undefined || goodRole === undefined) throw new Error('夹具身份缺失');
    roles[firstWolf] = goodRole;
    roles[firstGood] = wolfRole;

    const synthetic: GameEvent = { ...original, payload: { ...original.payload, roles } };
    const replayed = replay([synthetic]);

    expect(replayed.seats.map((seat) => seat.role)).toEqual(roles);
    expect(replayed.seats.map((seat) => seat.role)).not.toEqual(original.payload.roles);
    // 对照：同一 seed 重新发牌得到的是原结果，不是合成结果
    expect(lobby.seats.map((seat) => seat.role)).toEqual(original.payload.roles);
  });

  it('seed / mode / playerSeat / personas 也从 payload 重建', () => {
    const lobby = lobbyState({ seed: 777 });
    const [original] = step(lobby, startActionOf(lobby)).events;
    if (original?.type !== 'GAME_STARTED') throw new Error('缺少 GAME_STARTED');

    const personas = ['p-alpha', 'p-beta', null, null, null, null, null, null, null];
    const synthetic: GameEvent = {
      ...original,
      payload: { ...original.payload, personas, seed: 424_242, mode: 'slaughter-all' },
    };

    const replayed = replay([synthetic]);

    expect(replayed.seed).toBe(424_242);
    expect(replayed.mode).toBe('slaughter-all');
    expect(replayed.seats.map((seat) => seat.personaId)).toEqual([
      'p-alpha',
      'p-beta',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('playerSeat 从 payload 决定哪个席位是玩家（唯一一个）', () => {
    const lobby = lobbyState({ seed: 777, playerSeat: 3 });
    const [original] = step(lobby, startActionOf(lobby)).events;
    if (original?.type !== 'GAME_STARTED') throw new Error('缺少 GAME_STARTED');

    const synthetic: GameEvent = { ...original, payload: { ...original.payload, playerSeat: 5 } };
    const replayed = replay([synthetic]);

    const playerSeats = replayed.seats.filter((seat) => seat.isPlayer).map((seat) => seat.seat);

    expect(playerSeats).toEqual([5]);
    // 反方向也要断言：原来的玩家席位不再是玩家，且全场只有一个玩家。
    expect(replayed.seats[2]?.isPlayer).toBe(false);
    expect(playerSeats).toHaveLength(1);
  });

  it('非随机事件即使带了 rngAfter 也不改生成器状态（评审 Round 3 遗留）', () => {
    const started = step(lobbyState({ seed: 777 }), startActionOf(lobbyState({ seed: 777 })));
    const first = started.events[0];
    if (first === undefined) throw new Error('缺少 GAME_STARTED');

    // REJECTED 不在 RANDOM_CONSUMING_EVENTS 里——它没有消费随机数，就不能动 rng。
    const withStrayRng: GameEvent = {
      gameId: first.gameId,
      seq: 2,
      ts: 0,
      type: 'REJECTED',
      visibleTo: 'public',
      rngAfter: { __rng: 1 },
      payload: { actionType: 'START', code: 'PHASE_MISMATCH', message: 'x' },
    };

    const replayed = replay([first, withStrayRng]);

    expect(replayed.rng).toEqual(started.state.rng);
    expect(replayed.rng).not.toEqual({ __rng: 1 });
  });

  it('未实现折叠的事件类型抛 UnknownEventError（不静默忽略）', () => {
    const [startedEvent] = eventsOfStart();
    if (startedEvent === undefined) throw new Error('缺少 GAME_STARTED');

    const speech: GameEvent = {
      gameId: startedEvent.gameId,
      seq: 2,
      ts: 0,
      type: 'SPEECH',
      visibleTo: 'public',
      payload: { seat: 2, text: '嗨' },
    };

    expect(() => replay([startedEvent, speech])).toThrow(UnknownEventError);
  });
});
