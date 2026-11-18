import type { GameState, Phase, PotionUsage, Seat } from '@shared/domain';
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

  // 空状态的 gameId 是 ''（`replay` 的起点），首个事件把它填上；之后必须一直一致，
  // 否则说明把两局的事件流拼在了一起。
  if (state.gameId !== '' && state.gameId !== event.gameId) {
    throw new InvalidEventStreamError(
      `事件流混入了别的对局：状态属于 ${state.gameId}，事件属于 ${event.gameId}`,
    );
  }

  const withSeq: GameState = { ...state, seq: event.seq, gameId: event.gameId };

  // `rngAfter` 只对**声明消耗随机数**的事件生效（评审 Round 3 遗留）：否则一个非随机事件
  // 顺带带上 `rngAfter` 就会悄悄改掉生成器状态，而没有任何规则允许它这么做。
  let base: GameState = withSeq;
  if (RANDOM_CONSUMING_EVENTS.has(event.type)) {
    if (event.rngAfter === undefined) {
      throw new MissingRngStateError(event.type);
    }
    base = { ...withSeq, rng: event.rngAfter };
  }

  switch (event.type) {
    case 'GAME_STARTED':
      return applyGameStarted(base, event.payload);
    case 'REJECTED':
      // 被拒绝时状态除 seq 外不变（RFC-002 §2.3）。seq 已在上面推进过。
      return base;
    case 'PHASE_CHANGED':
      return applyPhaseChanged(base, event.payload);
    case 'WOLF_KILL_CHOSEN':
      return patchNight(base, { killTarget: event.payload.target });
    case 'WITCH_POTION_USED':
      return applyWitchPotion(base, event.payload);
    case 'SEER_CHECKED':
      // 查验结果是**seer 的私有信息**，只以事件存在（`visibleTo: 'seer'`）。
      // 不写进 state：写进去就成了第二份来源，而投影（RFC-007）读的是事件。
      return base;
    case 'PLAYER_DIED':
      return applyPlayerDied(base, event.payload.seat);
    case 'HUNTER_SHOOT':
      // 开枪的后果由 `PLAYER_DIED(cause: 'shoot')` 承载，这条事件只记录「谁对谁开了枪」。
      return base;
    case 'GAME_ENDED':
      return { ...base, phase: 'FINISHED' };
    default:
      // 类型合法但本 RFC 还没实现折叠，或者运行时出现了不在 GameEventMap 里的 type。
      throw new UnknownEventError(event.type);
  }
}

/**
 * 阶段推进（RFC-003）。
 *
 * 校验 `from === state.phase`：不一致说明事件流被拼错了——**静默接受会让重放走进一个
 * 从未存在过的阶段**，而这比抛错难查得多。
 *
 * 进入 `NIGHT_WOLF_CHAT` 意味着新的一夜开始，清空本夜暂存（C-18 的派生字段规则）。
 */
function applyPhaseChanged(state: GameState, payload: { from: Phase; to: Phase }): GameState {
  if (payload.from !== state.phase) {
    throw new InvalidEventStreamError(
      `PHASE_CHANGED 的 from 与当前阶段不一致：状态在 ${state.phase}，事件说 ${payload.from}`,
    );
  }

  const next: GameState = { ...state, phase: payload.to };
  if (payload.to === 'NIGHT_WOLF_CHAT') {
    delete next.night;
  }
  return next;
}

/** 往本夜暂存里合并字段；`night` 不存在时新建。 */
function patchNight(state: GameState, patch: NonNullable<GameState['night']>): GameState {
  return { ...state, night: { ...state.night, ...patch } };
}

/** `WITCH_POTION_USED`：本夜目标 + 整局药水位，两处都只在这里写。 */
function applyWitchPotion(
  state: GameState,
  payload: { potion: 'heal' | 'poison'; target: import('@shared/domain').SeatId },
): GameState {
  const used: PotionUsage = state.potionsUsed ?? { heal: false, poison: false };
  const potionsUsed: PotionUsage =
    payload.potion === 'heal' ? { ...used, heal: true } : { ...used, poison: true };

  const patch: NonNullable<GameState['night']> =
    payload.potion === 'heal' ? { healTarget: payload.target } : { poisonTarget: payload.target };

  return { ...patchNight(state, patch), potionsUsed };
}

/** `PLAYER_DIED`：置为出局，并把 `diedSeq` 记成这条事件的 `seq`（可见性判定需要它）。 */
function applyPlayerDied(state: GameState, seatId: import('@shared/domain').SeatId): GameState {
  const seat = state.seats.find((candidate) => candidate.seat === seatId);
  if (seat === undefined) {
    throw new InvalidEventStreamError(`PLAYER_DIED 指向不存在的座位 ${seatId}`);
  }
  if (!seat.alive) {
    throw new InvalidEventStreamError(`座位 ${seatId} 已经出局，PLAYER_DIED 重复`);
  }

  return {
    ...state,
    seats: state.seats.map((candidate) =>
      candidate.seat === seatId ? { ...candidate, alive: false, diedSeq: state.seq } : candidate,
    ),
  };
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
