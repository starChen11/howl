import type { GameState, Seat } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';
import type { GameEvent, GameEventType, GameStartedPayload } from '@shared/events';

import { InvalidEventStreamError, MissingRngStateError, UnknownEventError } from './errors';

/**
 * 折叠单个事件（`replay` 的基元）。
 *
 * **它是 `GameState` 里所有派生字段的唯一写入口**（RFC-001 §2.3 的 C-18 裁决）。RFC-002
 * 阶段派生字段还是空的（`cursor` / 票箱 / 药水位归 RFC-003~005），但这条纪律从现在就生效，
 * 所以 `step` 不自己算状态，而是把事件交给它折叠。
 *
 * 三条通用规则在这里一次做完，各事件的分支只管自己的业务：
 * 1. `seq` 必须严格 +1——跳号说明事件流被截断或拼错了，宁可抛错也不要折叠出一个假状态；
 * 2. 消耗随机数的事件必须带 `rngAfter`，否则 `replay` 无法恢复生成器（DATA-3）；
 * 3. 带 `rngAfter` 的事件**直接覆盖** `state.rng`（RFC-002 §2.2 第 2 条）。
 */

/** 哪些事件消耗了随机数。RFC-003/004 新增同类事件时扩充这个集合。 */
export const RANDOM_CONSUMING_EVENTS: ReadonlySet<GameEventType> = new Set<GameEventType>([
  'GAME_STARTED',
]);

export function applyEvent(state: GameState, event: GameEvent): GameState {
  if (event.seq !== state.seq + 1) {
    throw new InvalidEventStreamError(
      `事件 seq 必须严格递增：状态在 ${state.seq}，收到 ${event.seq}（事件类型 ${event.type}）`,
    );
  }

  if (RANDOM_CONSUMING_EVENTS.has(event.type) && event.rngAfter === undefined) {
    throw new MissingRngStateError(event.type);
  }

  // 空状态的 gameId 是 ''（`replay` 的起点），首个事件把它填上；之后必须一直一致，
  // 否则说明把两局的事件流拼在了一起。
  if (state.gameId !== '' && state.gameId !== event.gameId) {
    throw new InvalidEventStreamError(
      `事件流混入了别的对局：状态属于 ${state.gameId}，事件属于 ${event.gameId}`,
    );
  }

  const withSeq: GameState = { ...state, seq: event.seq, gameId: event.gameId };
  const base: GameState =
    event.rngAfter === undefined ? withSeq : { ...withSeq, rng: event.rngAfter };

  switch (event.type) {
    case 'GAME_STARTED':
      return applyGameStarted(base, event.payload);
    case 'REJECTED':
      // 被拒绝时状态除 seq 外不变（RFC-002 §2.3）。seq 已在上面推进过。
      return base;
    default:
      // 类型合法但本 RFC 还没实现折叠，或者运行时出现了不在 GameEventMap 里的 type。
      throw new UnknownEventError(event.type);
  }
}

/**
 * `GAME_STARTED`：把空状态（或 LOBBY 候选状态）填成真实开局。
 *
 * **发牌结果的唯一权威是事件 payload，不是 `createInitialState` 的洗牌结果**（RFC-002 §2.2）。
 * 这样即便将来换发牌算法，旧对局仍能重放。
 */
function applyGameStarted(state: GameState, payload: GameStartedPayload): GameState {
  if (payload.roles.length !== SEAT_IDS.length) {
    throw new InvalidEventStreamError(
      `GAME_STARTED 的 roles 必须是 ${SEAT_IDS.length} 项，收到 ${payload.roles.length}`,
    );
  }
  if (payload.personas.length !== SEAT_IDS.length) {
    throw new InvalidEventStreamError(
      `GAME_STARTED 的 personas 必须是 ${SEAT_IDS.length} 项，收到 ${payload.personas.length}`,
    );
  }

  const seats: Seat[] = SEAT_IDS.map((seat, index) => {
    const role = payload.roles[index];
    if (role === undefined) {
      throw new InvalidEventStreamError(`GAME_STARTED 没有给座位 ${seat} 发身份`);
    }
    const personaId = payload.personas[index];
    const base: Seat = { seat, role, alive: true, isPlayer: seat === payload.playerSeat };
    return typeof personaId === 'string' ? { ...base, personaId } : base;
  });

  return {
    ...state,
    seed: payload.seed,
    mode: payload.mode,
    seats,
    // 发牌后立即进入第一夜（RFC-003 §2.2 的阶段图以 NIGHT_WOLF_CHAT 开头）。
    phase: 'NIGHT_WOLF_CHAT',
    day: 1,
  };
}
