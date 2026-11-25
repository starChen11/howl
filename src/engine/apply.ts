import type { GameState, Phase, PotionUsage, Seat, SeatId } from '@shared/domain';
import { SEAT_IDS } from '@shared/domain';
import type {
  GameEvent,
  GameEventType,
  GameStartedPayload,
  VoteRevealedPayload,
} from '@shared/events';
import { tallyCountedVotes } from '@shared/votes';

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
  // 当日无死者时，发言起点要在 `DAY_STARTED` 的入口抽一次（RFC-004 §2.1）。
  'DAY_STARTED',
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
    case 'WOLF_VOTE_CAST': {
      const votes = base.wolfVotes ?? [];
      const index = votes.findIndex((vote) => vote.seat === event.payload.seat);
      const next =
        index < 0
          ? [...votes, event.payload]
          : votes.map((vote, i) => (i === index ? event.payload : vote));
      return { ...base, wolfVotes: next };
    }
    case 'WOLF_VOTE_CONFIRMED':
      return {
        ...base,
        wolfVotes: (base.wolfVotes ?? []).map((vote) =>
          vote.seat === event.payload.seat ? { ...vote, confirmed: true } : vote,
        ),
      };
    case 'WOLF_VOTE_REVEALED':
      // 唱票后清空本轮票；`tied` 非空则进入重投。
      if (event.payload.tied === undefined) {
        const next = { ...base, wolfVotes: [] };
        delete next.wolfRunoff;
        return next;
      }
      return { ...base, wolfVotes: [], wolfRunoff: event.payload.tied };
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
    case 'DAY_STARTED':
      // 消费昨夜死者（已在状态里），并把发言进度重置到本次起点。
      return applyDayStarted(base, event.payload);
    case 'SPEECH':
    case 'SPEECH_SKIPPED':
      // 归票发言复用 `SPEECH` 事件，但**不能**写进白天的 `speech.spoken`：警长在正常轮转中
      // 已经说过一次，再记一次会撞上 `appendSpoken` 的重复检查（RFC-022 §3.2）。
      if (base.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
        return { ...base, sheriffFinalSpeechDone: true };
      }
      return appendSpoken(base, event.payload.seat);
    case 'AI_THOUGHT':
      // AI 的内心独白：只以事件存在（`visibleTo: 'self:<seat>'`），不写进状态。
      // 复盘直接读事件流，因此不需要在状态里留副本（RFC-007 §2.5）。
      return base;
    case 'WOLF_READY_MARKED':
      return { ...base, wolfReady: [...(base.wolfReady ?? []), event.payload.seat] };
    case 'WOLF_CHAT_POSTED':
      return { ...base, wolfChat: [...(base.wolfChat ?? []), event.payload] };
    case 'DEGRADED':
      // 降级是**发言质量**的标记，不改变局面：被替换的短句本身会以 SPEECH 事件写入，
      // 引擎照常推进（RFC-010 §2.3 / NFR-10）。状态里只记次数，供复盘统计。
      return { ...base, degradations: [...(base.degradations ?? []), event.payload.seat] };
    case 'SELF_EXPOSE':
      // 自曝本身不改状态：它的后果是「当日终止」，由相位转移表达。
      return base;
    case 'VOTE_CAST':
      return appendVote(base, event.payload);
    case 'VOTE_REVEALED':
      return applyVoteRevealed(base, event.payload);

    /* ---- RFC-022 · 警长竞选与警徽 ---- */
    case 'SHERIFF_ELECTION_STARTED':
      return applySheriffElectionStarted(base);
    case 'SHERIFF_SIGNUP':
      return applySheriffSignup(base, event.payload);
    case 'SHERIFF_CANDIDATES':
      return applySheriffCandidates(base, event.payload.candidates);
    case 'SHERIFF_SPEECH':
    case 'SHERIFF_SPEECH_SKIPPED':
      return appendSheriffSpoken(base, event.payload.seat);
    case 'SHERIFF_WITHDRAWN':
      return applySheriffWithdrawn(base, event.payload);
    case 'SHERIFF_VOTE_CAST':
      return appendSheriffVote(base, event.payload);
    case 'SHERIFF_VOTE_REVEALED':
      return applySheriffVoteRevealed(base, event.payload);
    case 'SHERIFF_ELECTED':
      return { ...base, sheriffSeat: event.payload.seat, badge: 'held' };
    case 'SHERIFF_ELECTION_FAILED':
      return {
        ...base,
        sheriffSeat: null,
        badge: 'none',
        sheriffElectionFailure: event.payload.reason,
      };
    case 'BADGE_TRANSFERRED':
      return { ...base, sheriffSeat: event.payload.to, badge: 'held' };
    case 'BADGE_DESTROYED':
      return { ...base, sheriffSeat: null, badge: 'destroyed' };
    case 'SHERIFF_ORDER_CHOSEN':
      return {
        ...base,
        speech: { startSeat: event.payload.startSeat, spoken: [] },
        speechDirection: event.payload.direction,
        sheriffOrder: { startSeat: event.payload.startSeat, direction: event.payload.direction },
      };
    case 'GAME_ENDED':
      return { ...base, phase: 'FINISHED' };
    default:
      // 类型合法但本 RFC 还没实现折叠，或者运行时出现了不在 GameEventMap 里的 type。
      throw new UnknownEventError((event as { type: string }).type);
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

  if (payload.to === 'DAY_PK_SPEECH') {
    const tied = [...(state.runoff ?? [])]
      .filter((seat) => state.seats.some((entry) => entry.seat === seat && entry.alive))
      .sort((a, b) => a - b);
    if (tied.length > 0) {
      next.speech = { startSeat: tied[0] as never, spoken: [] };
    }
  }

  // 竞选发言有独立 cursor，不能复用白天的 `speech`（RFC-022 §13.2）。
  if (payload.to === 'DAY_SHERIFF_SPEECH' || payload.to === 'DAY_SHERIFF_PK') {
    next.sheriffSpeech = { spoken: [] };
  }

  if (payload.to === 'DAY_SHERIFF_FINAL_SPEECH') {
    next.sheriffFinalSpeechDone = false;
  }

  // 进入移交阶段时记住来源：决定移交后回白天还是入夜（事件流里可重建，不靠猜）。
  if (payload.to === 'DAY_BADGE_TRANSFER') {
    next.badgeTransferFrom = payload.from;
  }

  if (payload.to === 'NIGHT_WOLF_CHAT') {
    // 进入新的一夜：本夜暂存与「昨夜死者」都清空，`day` 递增（夜 N 开启第 N 天）。
    // 首个夜晚由 `GAME_STARTED` 直接设定，不经过这条转移，所以 `day` 仍从 1 开始。
    delete next.night;
    delete next.pendingDeaths;
    delete next.wolfChat;
    delete next.wolfReady;
    // RUL-13 的票型与重投候选：只属于这一夜，不能带到下一夜。
    delete next.wolfVotes;
    delete next.wolfRunoff;
    // 投票相关：自曝会让当日投票取消，旧票不能带到下一夜（否则下一天会拿已出局的
    // 席位当最高票，进而 PLAYER_DIED 重复）。
    delete next.votes;
    delete next.runoff;
    delete next.lynched;
    // 竞选、发言顺序与警徽移交都是「当天」的临时状态；警长本人与警徽状态跨天保留。
    delete next.sheriffSignups;
    delete next.sheriffCandidates;
    delete next.sheriffVoters;
    delete next.sheriffWithdrawals;
    delete next.sheriffWithdrawn;
    delete next.sheriffVotes;
    delete next.sheriffRunoff;
    delete next.sheriffSpeech;
    delete next.sheriffFinalSpeechDone;
    delete next.sheriffElectionFailure;
    delete next.sheriffOrder;
    delete next.speechDirection;
    delete next.lastNightDeaths;
    delete next.dayAnnounced;
    delete next.badgeTransferFrom;
    if (state.phase !== 'LOBBY') {
      next.day = state.day + 1;
    }
  }
  return next;
}

/** 记一笔「这个席位说过/跳过了」。 */
function appendSpoken(state: GameState, seatId: SeatId): GameState {
  const speech = state.speech;
  if (speech === undefined) {
    throw new InvalidEventStreamError(`SPEECH 之前没有 DAY_STARTED，无法记录席位 ${seatId}`);
  }
  if (speech.spoken.includes(seatId)) {
    throw new InvalidEventStreamError(`席位 ${seatId} 已经发过言，SPEECH 重复`);
  }
  return { ...state, speech: { ...speech, spoken: [...speech.spoken, seatId] } };
}

/**
 * 记一张票。
 *
 * 票箱是**派生数据**（C-18）：它只由 `VOTE_CAST` 折叠而来，`replay` 能完整重建。
 * 结算后由 `VOTE_REVEALED` 清空，供重投使用。
 */
function appendVote(
  state: GameState,
  vote: { seat: SeatId; target: SeatId | 'abstain' },
): GameState {
  if ((state.votes ?? []).some((existing) => existing.seat === vote.seat)) {
    throw new InvalidEventStreamError(`座位 ${vote.seat} 投了两次票`);
  }
  return { ...state, votes: [...(state.votes ?? []), vote] };
}

/** 记一笔**竞选**发言（与白天的 `speech` cursor 完全独立）。 */
function appendSheriffSpoken(state: GameState, seatId: SeatId): GameState {
  const speech = state.sheriffSpeech;
  if (speech === undefined) {
    throw new InvalidEventStreamError(`SHERIFF_SPEECH 之前没有开始竞选，无法记录席位 ${seatId}`);
  }
  if (speech.spoken.includes(seatId)) {
    throw new InvalidEventStreamError(`席位 ${seatId} 已经在竞选中发过言`);
  }
  return { ...state, sheriffSpeech: { ...speech, spoken: [...speech.spoken, seatId] } };
}

/**
 * 票型公布：清空票箱、决定去向。
 *
 * `runoff` / `lynched` 都是**派生字段**——从公布的票型算出来，不另存一份判断结果。
 *
 * 平票判定按**折算半票**（RFC-022 §3.1）。`countedVotes` 是事件里的权威折算票；旧对局的
 * 事件流没有它，回退到原始票等权计票——两种算法的平票结果在等权时相同。
 */
function applyVoteRevealed(state: GameState, payload: VoteRevealedPayload): GameState {
  const next: GameState = { ...state };
  delete next.votes;

  const tally =
    payload.countedVotes === undefined
      ? (() => {
          const counts = new Map<SeatId, number>();
          for (const vote of payload.votes) {
            if (vote.target === 'abstain') continue;
            counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
          }
          return [...counts.entries()]
            .map(([target, count]) => ({ target, votes: count, halfVotes: count }))
            .sort((a, b) =>
              a.halfVotes === b.halfVotes ? a.target - b.target : b.halfVotes - a.halfVotes,
            );
        })()
      : tallyCountedVotes(payload.countedVotes);

  const top = tally[0];
  if (top === undefined) {
    delete next.runoff;
    delete next.lynched;
    return next;
  }

  const tied = tally
    .filter((entry) => entry.halfVotes === top.halfVotes)
    .map((entry) => entry.target)
    .sort((a, b) => a - b);

  if (tied.length === 1) {
    next.lynched = top.target;
    delete next.runoff;
  } else {
    next.runoff = tied;
    delete next.lynched;
  }
  return next;
}

/** `DAY_STARTED`：消费昨夜死者、重置白天发言 cursor、记录公开死讯与方向默认值。 */
function applyDayStarted(
  state: GameState,
  payload: { day: number; diedLastNight: SeatId[]; speechStartSeat: SeatId },
): GameState {
  const next: GameState = {
    ...withoutPendingDeaths(state),
    speech: { startSeat: payload.speechStartSeat, spoken: [] },
    lastNightDeaths: [...payload.diedLastNight].sort((a, b) => a - b),
    dayAnnounced: true,
  };
  // 每天的方向从顺时针重新开始；警长若选了顺序，`SHERIFF_ORDER_CHOSEN` 会再覆盖。
  delete next.speechDirection;
  delete next.sheriffOrder;
  delete next.sheriffFinalSpeechDone;
  return next;
}

/** 清掉 `pendingDeaths`（`DAY_STARTED` 折叠后用）。 */
function withoutPendingDeaths(state: GameState): GameState {
  const next: GameState = { ...state };
  delete next.pendingDeaths;
  return next;
}

/** 往本夜暂存里合并字段；`night` 不存在时新建。 */
function patchNight(state: GameState, patch: NonNullable<GameState['night']>): GameState {
  return { ...state, night: { ...state.night, ...patch } };
}

/* ---------------------------------------------------------------------------
 * RFC-022 · 竞选与警徽的状态折叠
 * ------------------------------------------------------------------------- */

/** `SHERIFF_ELECTION_STARTED`：清空本轮竞选的临时状态，把警徽标成「还没有警长」。 */
function applySheriffElectionStarted(state: GameState): GameState {
  const next: GameState = {
    ...state,
    sheriffSeat: null,
    badge: 'none',
    sheriffSignups: [],
    sheriffCandidates: [],
    sheriffVoters: [],
    sheriffWithdrawals: [],
    sheriffWithdrawn: [],
    sheriffVotes: [],
    sheriffSpeech: { spoken: [] },
  };
  delete next.sheriffRunoff;
  delete next.sheriffElectionFailure;
  delete next.sheriffFinalSpeechDone;
  delete next.sheriffOrder;
  delete next.speechDirection;
  return next;
}

/** `SHERIFF_SIGNUP`：记录上警表态；重复表态说明事件流被拼错了。 */
function applySheriffSignup(state: GameState, payload: { seat: SeatId; run: boolean }): GameState {
  if ((state.sheriffSignups ?? []).some((entry) => entry.seat === payload.seat)) {
    throw new InvalidEventStreamError(`座位 ${payload.seat} 重复提交了上警表态`);
  }
  return { ...state, sheriffSignups: [...(state.sheriffSignups ?? []), payload] };
}

/** `SHERIFF_CANDIDATES`：候选人名单确定，警下投票人 = 其余全部席位。 */
function applySheriffCandidates(state: GameState, candidates: readonly SeatId[]): GameState {
  const sorted = [...candidates].sort((a, b) => a - b);
  const candidateSet = new Set(sorted);
  const voters = state.seats
    .filter((seat) => seat.alive && !candidateSet.has(seat.seat))
    .map((seat) => seat.seat)
    .sort((a, b) => a - b);

  return { ...state, sheriffCandidates: sorted, sheriffVoters: voters };
}

/** `SHERIFF_WITHDRAWN`：记录退水表态；只有 `withdraw: true` 才真的退出警上。 */
function applySheriffWithdrawn(
  state: GameState,
  payload: { seat: SeatId; withdraw: boolean },
): GameState {
  if ((state.sheriffWithdrawals ?? []).some((entry) => entry.seat === payload.seat)) {
    throw new InvalidEventStreamError(`座位 ${payload.seat} 重复提交了退水表态`);
  }
  if (!(state.sheriffCandidates ?? []).includes(payload.seat)) {
    throw new InvalidEventStreamError(`座位 ${payload.seat} 没有上警，却提交了退水表态`);
  }

  const next: GameState = {
    ...state,
    sheriffWithdrawals: [...(state.sheriffWithdrawals ?? []), payload],
  };
  if (payload.withdraw) {
    next.sheriffWithdrawn = [...(state.sheriffWithdrawn ?? []), payload.seat].sort((a, b) => a - b);
  }
  return next;
}

/** 记一张警长票（暗投）。 */
function appendSheriffVote(
  state: GameState,
  vote: { seat: SeatId; target: SeatId | 'abstain' },
): GameState {
  if ((state.sheriffVotes ?? []).some((existing) => existing.seat === vote.seat)) {
    throw new InvalidEventStreamError(`座位 ${vote.seat} 投了两次警长票`);
  }
  return { ...state, sheriffVotes: [...(state.sheriffVotes ?? []), vote] };
}

/** `SHERIFF_VOTE_REVEALED`：清空票箱；平票时记录 PK/重投的候选集。 */
function applySheriffVoteRevealed(state: GameState, payload: { tied?: SeatId[] }): GameState {
  const next: GameState = { ...state, sheriffVotes: [] };
  if (payload.tied !== undefined && payload.tied.length > 0) {
    next.sheriffRunoff = [...payload.tied].sort((a, b) => a - b);
  } else {
    delete next.sheriffRunoff;
  }
  return next;
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

  const next: GameState = {
    ...state,
    seats: state.seats.map((candidate) =>
      candidate.seat === seatId ? { ...candidate, alive: false, diedSeq: state.seq } : candidate,
    ),
  };

  // 昨夜死者按**结算顺序**累积（内部顺序；公开的 `DAY_STARTED.diedLastNight` 会重新按座位排序，C-31）。
  // 死讯已经公布之后发生的死亡（首夜延后落地的死亡、白天放逐/开枪）不再进入 `pendingDeaths`：
  // 它们不属于下一夜的死讯，而且 `DAY_STARTED` 已经消费过本轮死讯。
  if (state.dayAnnounced !== true) {
    next.pendingDeaths = [...(state.pendingDeaths ?? []), seatId];
  }
  return next;
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
    // RFC-022：警长竞选发生在第一天，开局时明确「还没有警长」。
    sheriffSeat: null,
    badge: 'none',
  };
}
