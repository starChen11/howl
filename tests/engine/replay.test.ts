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
    expect(replayed.seq).toBe(2);
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
