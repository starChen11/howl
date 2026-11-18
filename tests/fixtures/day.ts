import type { GameState, SeatId } from '@shared/domain';

import { currentSpeaker } from '@engine/phases/day';
import { step } from '@engine/step';

import { nightStart, roleSeat, run } from './night';

/**
 * 白天测试夹具：从开局沿**真实路径**走到 `DAY_SPEECH`。
 *
 * 手改状态会让测试拿到状态机永远不会产生的组合；这里每一步都是合法 action。
 */

export interface DayRun {
  state: GameState;
  killTarget: SeatId | null;
}

/** 走完第一夜，停在 `DAY_SPEECH`。`heal: true` 时当夜无人出局。 */
export function reachDay(seed = 20_261_117, options: { heal?: boolean } = {}): DayRun {
  const atWolves = nightStart(seed);
  const wolf = roleSeat(atWolves, 'wolf');
  const killTarget =
    atWolves.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat ??
    atWolves.seats.find((seat) => seat.alive && seat.role !== 'wolf')?.seat;
  if (killTarget === undefined) throw new Error('没有可刀目标');

  const afterKill = run(atWolves, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: killTarget });

  const seer = roleSeat(afterKill.state, 'seer');
  const checkTarget = afterKill.state.seats.find(
    (seat) => seat.alive && seat.role !== 'seer',
  )?.seat;
  if (checkTarget === undefined) throw new Error('没有可查目标');
  const afterCheck = run(afterKill.state, {
    type: 'SEER_CHECK',
    ts: 2,
    seat: seer,
    target: checkTarget,
  });

  const witch = roleSeat(afterCheck.state, 'witch');
  const afterWitch = step(afterCheck.state, {
    type: 'WITCH_ACT',
    ts: 3,
    seat: witch,
    potion: options.heal === true ? 'heal' : 'none',
    ...(options.heal === true ? { target: killTarget } : {}),
  } as never);

  return {
    state: afterWitch.state,
    killTarget: options.heal === true ? null : killTarget,
  };
}

/** 让全部存活席位按当前发言顺序各说一句（或跳过）。返回最终状态。 */
export function speakAll(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.phase !== 'DAY_SPEECH') break;
    const next = currentSpeaker(current);
    if (next === undefined) break;

    current = step(current, { type: 'SPEECH', ts: 10, seat: next, text: `${next} 号发言` }).state;
  }
  return current;
}

/** 全员投票：`targetOf` 决定每个人投给谁。 */
export function voteAll(
  state: GameState,
  targetOf: (seat: SeatId) => SeatId | 'abstain',
): GameState {
  let current = state;
  const alive = current.seats.filter((seat) => seat.alive).map((seat) => seat.seat);

  for (const seat of alive) {
    if (current.phase !== 'DAY_VOTE' && current.phase !== 'DAY_VOTE_RUNOFF') break;
    current = step(current, { type: 'VOTE', ts: 20, seat, target: targetOf(seat) }).state;
  }
  return current;
}

/**
 * 构造一个「一夜死两人」的白天状态：wolf 刀一个、witch 毒另一个。
 *
 * 用来验证 C-31——公告与发言起点都不能依赖结算顺序（狼刀先、毒药后）。
 */
export function twoDeaths(): {
  diedLastNight: number[];
  speechStartSeat: number;
  killTarget: number;
  poisonTarget: number;
} {
  const atWolves = nightStart();
  // wolf 刀一个村民、witch 毒一只 wolf：两种死因都被用到，而且 seer / witch 都还活着，
  // 夜间流程能正常走完（杀掉 seer 或 witch 会让后续阶段没人行动）。
  const killTarget = atWolves.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
  const poisonTarget = atWolves.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
  if (killTarget === undefined || poisonTarget === undefined) {
    throw new Error('夹具缺村民或 wolf');
  }

  const wolf = roleSeat(atWolves, 'wolf');
  const afterKill = run(atWolves, { type: 'WOLF_KILL', ts: 1, seat: wolf, target: killTarget });

  const seer = roleSeat(afterKill.state, 'seer');
  const checkTarget = afterKill.state.seats.find(
    (seat) => seat.alive && seat.role !== 'seer',
  )?.seat;
  if (checkTarget === undefined) throw new Error('没有可查目标');
  const afterCheck = run(afterKill.state, {
    type: 'SEER_CHECK',
    ts: 2,
    seat: seer,
    target: checkTarget,
  });

  const witch = roleSeat(afterCheck.state, 'witch');
  const afterWitch = run(afterCheck.state, {
    type: 'WITCH_ACT',
    ts: 3,
    seat: witch,
    potion: 'poison',
    target: poisonTarget,
  });

  const started = afterWitch.events.find((event) => event.type === 'DAY_STARTED');
  if (started?.type !== 'DAY_STARTED') throw new Error('没有 DAY_STARTED');

  return {
    diedLastNight: [...started.payload.diedLastNight],
    speechStartSeat: started.payload.speechStartSeat,
    killTarget,
    poisonTarget,
  };
}
