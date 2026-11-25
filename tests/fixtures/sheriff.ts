import type { GameState, SeatId } from '@shared/domain';
import type { GameEvent } from '@shared/events';

import { pendingSignups } from '@engine/phases/sheriff';
import { step } from '@engine/step';

import { nightTrace, roleSeat } from './night';

/**
 * RFC-022 的测试夹具。
 *
 * 竞选是**首日必经**的流程：任何沿真实路径走到白天的测试都必须先把它走完。这里提供
 * 「全员不上警」的默认路径，让 RFC-004 时代的测试保持原本的语义（本局无警长、回退旧顺序）。
 */

export interface SheriffRun {
  state: GameState;
  events: GameEvent[];
}

export function runSheriff(state: GameState, action: Parameters<typeof step>[1]): SheriffRun {
  const result = step(state, action);
  return { state: result.state, events: result.events };
}

/** 让所有还没表态的席位选择「不上警」，把竞选推进到 `DAY_SHERIFF_RESULT` 之后。 */
export function skipSheriffElection(state: GameState): SheriffRun {
  let current = state;
  const events: GameEvent[] = [];

  for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_SIGNUP'; guard += 1) {
    const seat = pendingSignups(current)[0];
    if (seat === undefined) break;
    const result = step(current, { type: 'SHERIFF_SIGNUP', ts: 100, seat, run: false });
    current = result.state;
    events.push(...result.events);
  }

  return { state: current, events };
}

/** 让指定席位（其余人不上警）上警。返回公告与竞选开始后的状态。 */
export function signupSeats(state: GameState, candidates: readonly SeatId[]): SheriffRun {
  let current = state;
  const events: GameEvent[] = [];
  const wanted = new Set(candidates);

  for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_SIGNUP'; guard += 1) {
    const seat = pendingSignups(current)[0];
    if (seat === undefined) break;
    const result = step(current, {
      type: 'SHERIFF_SIGNUP',
      ts: 100,
      seat,
      run: wanted.has(seat),
    });
    current = result.state;
    events.push(...result.events);
  }

  return { state: current, events };
}

export interface SheriffSignupTrace {
  state: GameState;
  events: GameEvent[];
  killTarget: SeatId;
}

/**
 * 从 `LOBBY` 沿真实路径走到 `DAY_SHERIFF_SIGNUP`，并返回完整事件流。
 *
 * 用于两类断言：
 * - 引擎：竞选期间死亡尚未落地；
 * - 投影 / 真相视图：首夜死讯不能在竞选期间泄露（RFC-022 AC-1）。
 */
export function sheriffSignupTrace(
  options: { seed?: number; killTarget?: SeatId } = {},
): SheriffSignupTrace {
  const trace = nightTrace(options.seed ?? 20_261_117);
  let current = trace.state;
  const events = [...trace.events];

  const wolf = roleSeat(current, 'wolf');
  const killTarget =
    options.killTarget ??
    current.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
  if (killTarget === undefined) throw new Error('没有可刀目标');

  const killed = step(current, { type: 'WOLF_KILL', ts: 200, seat: wolf, target: killTarget });
  current = killed.state;
  events.push(...killed.events);

  const seer = roleSeat(current, 'seer');
  const checkTarget = current.seats.find((seat) => seat.alive && seat.role !== 'seer')?.seat;
  if (checkTarget === undefined) throw new Error('没有可查目标');
  const checked = step(current, {
    type: 'SEER_CHECK',
    ts: 201,
    seat: seer,
    target: checkTarget,
  });
  current = checked.state;
  events.push(...checked.events);

  const witch = roleSeat(current, 'witch');
  const acted = step(current, { type: 'WITCH_ACT', ts: 202, seat: witch, potion: 'none' });
  current = acted.state;
  events.push(...acted.events);

  if (current.phase !== 'DAY_SHERIFF_SIGNUP') {
    throw new Error(`首夜结算后应进入竞选，实际是 ${current.phase}`);
  }

  return { state: current, killTarget, events };
}
