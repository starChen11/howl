import type { GameState, Role, Seat, SeatId, WinMode } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';

import { dealRoles } from './deal';
import { assignPersonas } from './personas';

/**
 * 开局前构造状态（RFC-002 §2.2）。
 *
 * 它只做一件事：用 `seed` 发一次牌，得到「候选」状态，`phase: 'LOBBY'`、`seq: 0`。
 * 一旦 `START` 被处理、`GAME_STARTED` 事件产生，**事件 payload 里的 `roles` 就是唯一权威**
 * （`applyEvent` 以它为准，不再自行发牌）。所以这里的结果只是候选，不是真相。
 */

export interface CreateInitialStateInput {
  gameId: string;
  seed: number;
  mode: WinMode;
  playerSeat: SeatId;
}

/**
 * @param deck 板子配置。默认 `DECK`（9 人标准局）；可选参数是为了让「板子与座位数不一致」
 * 这条防御分支可测，也为 F45（多套板子，v1 延后）留一个免费的缝。
 */
export function createInitialState(
  input: CreateInitialStateInput,
  deck?: readonly Role[],
): GameState {
  const dealt = dealRoles(input.seed, deck);

  if (dealt.roles.length !== SEAT_IDS.length) {
    // DECK 与座位表漂移了。宁可启动即失败，也不要发一手牌。
    throw new Error(`板子规模 ${dealt.roles.length} 与座位数 ${SEAT_IDS.length} 不一致`);
  }

  // 人格在**发牌之后**独立分配：换种子会换人格，但不会影响身份（AC-3 正交性）。
  const assigned = assignPersonas(dealt.rng);
  let personaCursor = 0;

  const seats: Seat[] = SEAT_IDS.map((seat, index) => {
    const role = dealt.roles[index];
    if (role === undefined) {
      throw new Error(`座位 ${seat} 没有分到身份`);
    }

    // 玩家席位没有人格（RFC-009 §2.1：人格给 8 个 AI）。
    if (seat === input.playerSeat) {
      return { seat, role, alive: true, isPlayer: true };
    }

    const persona = assigned.personas[personaCursor];
    personaCursor += 1;
    if (persona === undefined) {
      throw new Error('人格不够分配给 AI 席位');
    }

    return { seat, role, alive: true, isPlayer: false, personaId: persona.id };
  });

  return {
    gameId: input.gameId,
    seed: input.seed,
    mode: input.mode,
    // 发牌已经消耗过随机数，状态里留下的是**发牌之后**的生成器状态；
    // `START` 处理时它会作为 GAME_STARTED 的 `rngAfter` 写进事件（RFC-002 §2.2）。
    rng: assigned.rng,
    phase: 'LOBBY',
    day: 0,
    seats,
    seq: 0,
  };
}

/**
 * 空状态：`replay` 的起点。
 *
 * `replay` **只接收事件流**，所以必须有一个「什么都不知道」的起点，由 `GAME_STARTED`
 * 把它填成真实开局。`phase: 'LOBBY'`、`seq: 0` 与 `createInitialState` 的起点一致，
 * 因此「先发牌再重放」与「直接重放」得到同一结果。
 */
export function createEmptyState(): GameState {
  return {
    gameId: '',
    seed: 0,
    mode: 'slaughter-side',
    rng: { __rng: 0 },
    phase: 'LOBBY',
    day: 0,
    seats: [],
    seq: 0,
  };
}
