import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';
import type { GameState } from '@shared/domain';

import { currentSpeaker } from '@engine/phases/day';
import { replay } from '@engine/replay';
import { step } from '@engine/step';

import { lobbyState, startActionOf } from '../fixtures/states';

/**
 * AC-15 / AC-16：整局跑通与终局后的提交。
 *
 * 这一条最容易写成「凑巧能过」——所以断言三件事：**真的到了 `FINISHED`**、**终局结果
 * 合法**、**`replay` 重建出同一终局**。只断言「没报错」的用例证明不了任何东西。
 */

/** 每一步都挑一个合法动作：夜里按角色、白天按当前发言人、投票挑下一个存活者。 */
function nextAction(state: GameState, ts: number): Action | undefined {
  const alive = state.seats.filter((seat) => seat.alive);
  const roleOf = (role: string) => alive.find((seat) => seat.role === role)?.seat;

  switch (state.phase) {
    case 'LOBBY':
      return startActionOf(state, ts);

    case 'NIGHT_WOLF_CHAT': {
      const speaker = state.seats.find(
        (seat) =>
          seat.alive &&
          seat.role === 'wolf' &&
          !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
      )?.seat;
      return speaker === undefined ? undefined : { type: 'WOLF_CHAT', ts, seat: speaker, text: '' };
    }

    case 'NIGHT_WOLVES': {
      const wolf = roleOf('wolf');
      const victim = alive.find((seat) => seat.role !== 'wolf')?.seat;
      return wolf === undefined || victim === undefined
        ? undefined
        : { type: 'WOLF_KILL', ts, seat: wolf, target: victim };
    }

    case 'NIGHT_SEER': {
      const seer = roleOf('seer');
      const target = alive.find((seat) => seat.role !== 'seer')?.seat;
      return seer === undefined || target === undefined
        ? undefined
        : { type: 'SEER_CHECK', ts, seat: seer, target };
    }

    case 'NIGHT_WITCH': {
      const witch = roleOf('witch');
      return witch === undefined
        ? undefined
        : { type: 'WITCH_ACT', ts, seat: witch, potion: 'none' };
    }

    case 'NIGHT_HUNTER_SHOOT': {
      const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
      return hunter === undefined ? undefined : { type: 'HUNTER_SHOOT', ts, seat: hunter };
    }

    case 'DAY_SPEECH': {
      // 必须问引擎「现在轮到谁」，不能用座位顺序自己挑——挑错就会被拒。
      const speaker = currentSpeaker(state);
      return speaker === undefined ? undefined : { type: 'SPEECH_SKIP', ts, seat: speaker };
    }

    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF': {
      const voter = state.seats.find(
        (seat) => seat.alive && !(state.votes ?? []).some((vote) => vote.seat === seat.seat),
      )?.seat;
      // 重投时只能投并列者；首轮挑一个不是自己的存活者。
      const target =
        state.phase === 'DAY_VOTE_RUNOFF'
          ? state.runoff?.[0]
          : (alive.find((seat) => seat.seat !== voter)?.seat ?? 'abstain');
      return voter === undefined || target === undefined
        ? undefined
        : { type: 'VOTE', ts, seat: voter, target };
    }

    case 'DAY_HUNTER_SHOOT': {
      const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
      return hunter === undefined ? undefined : { type: 'HUNTER_SHOOT', ts, seat: hunter };
    }

    default:
      return undefined;
  }
}

describe('AC-16 · 固定种子的整局脚本能跑到 FINISHED', () => {
  it('不用 AI、不用随机，逐步推进到终局，且 replay 得同一终局', () => {
    const lobby = lobbyState({ seed: 4_242_424 });
    const events: ReturnType<typeof step>['events'] = [];
    let state: GameState = lobby;
    let ts = 1_000;

    for (let guard = 0; guard < 400; guard += 1) {
      if (state.phase === 'FINISHED') break;

      const action = nextAction(state, ts);
      expect(action, `阶段 ${state.phase} 没有可用的下一步`).toBeDefined();

      const result = step(state, action as Action);
      state = result.state;
      events.push(...result.events);
      ts += 1;
      // 脚本挑的每一步都必须是**合法**的：出现 Rejected 说明脚本自身错了，
      // 而不是「引擎接受了但没进展」——两者要分开，否则循环会在原地空转 400 次。
      expect(result.events[0]?.type, `阶段 ${state.phase} 的脚本动作被拒`).not.toBe('REJECTED');
    }

    expect(state.phase).toBe('FINISHED');

    const ended = events.find((event) => event.type === 'GAME_ENDED');
    expect(ended?.type).toBe('GAME_ENDED');
    if (ended?.type !== 'GAME_ENDED') throw new Error('没有 GAME_ENDED');
    expect(['wolf', 'good']).toContain(ended.payload.result);

    expect(replay(events)).toEqual(state);
  });

  it('AC-15 · FINISHED 之后提交任何 action 都是 Rejected，且状态除 seq 外不变', () => {
    const lobby = lobbyState({ seed: 4_242_424 });
    let state: GameState = lobby;
    let ts = 1_000;

    for (let guard = 0; guard < 400 && state.phase !== 'FINISHED'; guard += 1) {
      const action = nextAction(state, ts);
      if (action === undefined) break;
      state = step(state, action).state;
      ts += 1;
    }
    expect(state.phase).toBe('FINISHED');

    const { events, state: after } = step(state, {
      type: 'VOTE',
      ts,
      seat: 1,
      target: 'abstain',
    });

    expect(events[0]?.type).toBe('REJECTED');
    expect(events[0]?.payload).toEqual(expect.objectContaining({ code: 'PHASE_MISMATCH' }));
    expect({ ...after, seq: state.seq }).toEqual(state);
  });
});
