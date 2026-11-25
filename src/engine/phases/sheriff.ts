import type { Action } from '@shared/actions';
import type {
  GameState,
  Phase,
  SeatId,
  SheriffBadgeState,
  SheriffElectionFailureReason,
  SheriffVoteRound,
  SpeechDirection,
} from '@shared/domain';
import { SPEECH_DIRECTIONS } from '@shared/domain';
import type { SheriffElectionStep, SheriffElectionView } from '@shared/project';

import { InvalidEventStreamError } from '../errors';
import { aliveSeats, isAlive } from '../queries';
import { rejectionDraft } from '../reject';
import type { ActionHandlerFor, EventDraft } from '../step';
import { enterNight } from './vote';
import { phaseChangedDraft } from './visibility';

/**
 * 完整警长竞选与警徽（RFC-022）。
 *
 * 三条主线都在这个文件里：
 * 1. **竞选**：上警 → 竞选发言 → 退水 → 警下投票 →（平票 PK → 重投）→ 结果；
 * 2. **警长权力**：1.5 票在 `phases/vote.ts`，发言顺序与归票发言在 `phases/day.ts`；
 * 3. **警徽**：死亡后移交或撕毁。
 *
 * 竞选的参与集合与「存活」刻意解耦：首夜死亡延后到 `DAY_ANNOUNCE` 才落地（RFC-022 §13.1），
 * 所以竞选期间 `state.seats` 里 9 个人都还是 `alive`。这不是复用 `aliveSeats` 的巧合，而是
 * 引擎真的还没有写下死亡——投影因此不可能提前看到死讯。
 */

/** 竞选动作可以发生的阶段。`SHERIFF_RESULT` 是自动阶段，不接收动作。 */
const ELECTION_ACTION_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'DAY_SHERIFF_SIGNUP',
  'DAY_SHERIFF_SPEECH',
  'DAY_SHERIFF_WITHDRAW',
  'DAY_SHERIFF_VOTE',
  'DAY_SHERIFF_PK',
  'DAY_SHERIFF_RUNOFF',
]);

/** 当前是否处在需要玩家行动的竞选子阶段；自曝在这段时间会中止竞选（RFC-022 §2.2）。 */
export function isElectionActionPhase(phase: Phase): boolean {
  return ELECTION_ACTION_PHASES.has(phase);
}

/** 当前警长；缺省（旧对局 / 开局前）视为没有警长。 */
export function sheriffSeatOf(state: GameState): SeatId | null {
  return state.sheriffSeat ?? null;
}

/** 警徽状态；缺省视为从未有警长。 */
export function badgeOf(state: GameState): SheriffBadgeState {
  return state.badge ?? 'none';
}

/** 本轮竞选里有资格行动的座位（竞选期间死亡尚未落地，所以就是存活席位）。 */
export function electionSeats(state: GameState): SeatId[] {
  return aliveSeats(state)
    .map((seat) => seat.seat)
    .sort((a, b) => a - b);
}

/** 上过警的席位（含后来退水的）。 */
export function candidatesOf(state: GameState): SeatId[] {
  return [...(state.sheriffCandidates ?? [])].sort((a, b) => a - b);
}

/** 仍在警上的候选人：上过警且没有退水。 */
export function activeCandidatesOf(state: GameState): SeatId[] {
  const withdrawn = new Set(state.sheriffWithdrawn ?? []);
  return candidatesOf(state).filter((seat) => !withdrawn.has(seat));
}

/** 从未上警、因而有警长投票权的席位。 */
export function votersOf(state: GameState): SeatId[] {
  return [...(state.sheriffVoters ?? [])].sort((a, b) => a - b);
}

/** 还没上警/不上警表态的席位。 */
export function pendingSignups(state: GameState): SeatId[] {
  const decided = new Set((state.sheriffSignups ?? []).map((entry) => entry.seat));
  return electionSeats(state).filter((seat) => !decided.has(seat));
}

/** 还没退水/不退水表态的候选人。 */
export function pendingWithdrawals(state: GameState): SeatId[] {
  const decided = new Set((state.sheriffWithdrawals ?? []).map((entry) => entry.seat));
  return candidatesOf(state).filter((seat) => !decided.has(seat));
}

/** 还没提交警长票的警下玩家。 */
export function pendingSheriffVoters(state: GameState): SeatId[] {
  const cast = new Set((state.sheriffVotes ?? []).map((vote) => vote.seat));
  return votersOf(state).filter((seat) => !cast.has(seat));
}

/** 当前竞选子阶段对应的公开 enum；不在竞选返回 `null`。 */
export function electionStepOf(phase: Phase): SheriffElectionStep {
  switch (phase) {
    case 'DAY_SHERIFF_SIGNUP':
      return 'signup';
    case 'DAY_SHERIFF_SPEECH':
      return 'speech';
    case 'DAY_SHERIFF_WITHDRAW':
      return 'withdraw';
    case 'DAY_SHERIFF_VOTE':
      return 'vote';
    case 'DAY_SHERIFF_PK':
      return 'pk';
    case 'DAY_SHERIFF_RUNOFF':
      return 'runoff';
    case 'DAY_SHERIFF_RESULT':
      return 'result';
    default:
      return null;
  }
}

/**
 * 竞选的公开视图（RFC-022 §13.6）。
 *
 * 警长票箱 `sheriffVotes` **不在**这里：唱票前它是暗投，只能通过 `self:<seat>` 可见性分发。
 */
export function sheriffElectionView(state: GameState, observer?: SeatId): SheriffElectionView {
  const candidates = candidatesOf(state);
  const voters = votersOf(state);

  return {
    phase: electionStepOf(state.phase),
    candidates,
    voters,
    withdrawn: [...(state.sheriffWithdrawn ?? [])].sort((a, b) => a - b),
    signups: [...(state.sheriffSignups ?? [])],
    runoff: [...(state.sheriffRunoff ?? [])].sort((a, b) => a - b),
    isCandidate: observer !== undefined && candidates.includes(observer),
    isVoter: observer !== undefined && voters.includes(observer),
  };
}

/** 警长可选的一个发言顺序：起始席位 + 方向。 */
export interface SheriffOrderOption {
  startSeat: SeatId;
  direction: SpeechDirection;
}

/**
 * 沿某个方向找 `from` 之后的第一位存活席位。
 *
 * `from` 可能是死者（单死时以死者为基准），也可能就是警长本人；后一种情况要跳过自己，
 * 因为规则是「警长左侧/右侧的第一位存活玩家」。
 */
function firstAliveInDirection(
  state: GameState,
  from: SeatId,
  direction: SpeechDirection,
  excludeFrom: boolean,
): SeatId | undefined {
  const alive = aliveSeats(state)
    .map((seat) => seat.seat)
    .sort((a, b) => a - b);
  if (alive.length === 0) return undefined;

  const ordered = direction === 'clockwise' ? alive : [...alive].reverse();
  const index = ordered.indexOf(from);
  const start =
    index !== -1
      ? index + 1
      : direction === 'clockwise'
        ? ordered.findIndex((seat) => seat > from)
        : ordered.findIndex((seat) => seat < from);
  const begin = start === -1 ? 0 : start;

  for (let offset = 0; offset < ordered.length; offset += 1) {
    const seat = ordered[(begin + offset) % ordered.length];
    if (seat === undefined) continue;
    if (excludeFrom && seat === from) continue;
    return seat;
  }

  // 只剩自己一个存活者：仍让他从自己开始，避免把一个残局卡成死锁。
  return excludeFrom && alive.includes(from) ? from : undefined;
}

/**
 * 警长今天可选的发言起点（RFC-022 §3.2）。
 *
 * | 昨夜死亡 | 基准 |
 * |---|---|
 * | 恰好 1 人 | 死者（死左 / 死右） |
 * | 平安夜或 ≥2 人 | 警长（警左 / 警右） |
 */
export function sheriffOrderOptions(state: GameState): SheriffOrderOption[] {
  const sheriff = sheriffSeatOf(state);
  if (sheriff === null) return [];

  const deaths = state.lastNightDeaths ?? [];
  const base = deaths.length === 1 ? deaths[0] : sheriff;
  if (base === undefined) return [];

  const options: SheriffOrderOption[] = [];
  for (const direction of SPEECH_DIRECTIONS) {
    const startSeat = firstAliveInDirection(state, base, direction, base === sheriff);
    if (startSeat === undefined) continue;
    options.push({ startSeat, direction });
  }
  return options;
}

/** 竞选中当前该发言的席位；不在竞选发言阶段返回 `undefined`。 */
export function nextSheriffSpeaker(state: GameState): SeatId | undefined {
  const eligible =
    state.phase === 'DAY_SHERIFF_PK'
      ? (state.sheriffRunoff ?? [])
      : (state.sheriffCandidates ?? []);
  const spoken = new Set(state.sheriffSpeech?.spoken ?? []);
  return [...eligible].sort((a, b) => a - b).find((seat) => !spoken.has(seat));
}

/** 当前该做归票发言的警长；不在归票阶段或已经说过则为 `undefined`。 */
export function nextSheriffFinalSpeaker(state: GameState): SeatId | undefined {
  const sheriff = sheriffSeatOf(state);
  if (sheriff === null || state.sheriffFinalSpeechDone === true) return undefined;
  return isAlive(state, sheriff) ? sheriff : undefined;
}

function sheriffRejection(
  action: Extract<Action, { seat: SeatId }>,
  code: string,
  message: string,
) {
  return rejectionDraft({ action, code, message, seat: action.seat });
}

/** 竞选失败 + 进入结果自动阶段。 */
function failElection(from: Phase, reason: SheriffElectionFailureReason): EventDraft[] {
  return [
    { type: 'SHERIFF_ELECTION_FAILED', visibleTo: 'public', payload: { reason } },
    phaseChangedDraft(from, 'DAY_SHERIFF_RESULT'),
  ];
}

/** `SHERIFF_SIGNUP`（`DAY_SHERIFF_SIGNUP`）：9 人各一次，全部表态后公布候选人。 */
const sheriffSignup: ActionHandlerFor<'SHERIFF_SIGNUP'> = (state, action) => {
  if (!isAlive(state, action.seat)) {
    return [sheriffRejection(action, 'NOT_ALIVE', `座位 ${action.seat} 已出局，不能上警`)];
  }
  if ((state.sheriffSignups ?? []).some((entry) => entry.seat === action.seat)) {
    return [sheriffRejection(action, 'ALREADY_SIGNED_UP', `座位 ${action.seat} 已经表过态`)];
  }

  const signups = [...(state.sheriffSignups ?? []), { seat: action.seat, run: action.run }];
  const drafts: EventDraft[] = [
    {
      type: 'SHERIFF_SIGNUP',
      visibleTo: 'public',
      payload: { seat: action.seat, run: action.run },
    },
  ];

  const everyone = electionSeats(state);
  if (!everyone.every((seat) => signups.some((entry) => entry.seat === seat))) {
    return drafts;
  }

  const candidates = signups
    .filter((entry) => entry.run)
    .map((entry) => entry.seat)
    .sort((a, b) => a - b);

  drafts.push({
    type: 'SHERIFF_CANDIDATES',
    visibleTo: 'public',
    payload: { candidates },
  });

  if (candidates.length === 0) {
    drafts.push(...failElection('DAY_SHERIFF_SIGNUP', 'no-candidates'));
    return drafts;
  }

  drafts.push(phaseChangedDraft('DAY_SHERIFF_SIGNUP', 'DAY_SHERIFF_SPEECH'));
  return drafts;
};

/** `SHERIFF_WITHDRAW`（`DAY_SHERIFF_WITHDRAW`）：每个候选人表态一次。 */
const sheriffWithdraw: ActionHandlerFor<'SHERIFF_WITHDRAW'> = (state, action) => {
  if (!isAlive(state, action.seat)) {
    return [sheriffRejection(action, 'NOT_ALIVE', `座位 ${action.seat} 已出局，不能退水`)];
  }
  if (!candidatesOf(state).includes(action.seat)) {
    return [sheriffRejection(action, 'NOT_CANDIDATE', `座位 ${action.seat} 没有上警，不能退水`)];
  }
  if ((state.sheriffWithdrawals ?? []).some((entry) => entry.seat === action.seat)) {
    return [sheriffRejection(action, 'ALREADY_WITHDREW', `座位 ${action.seat} 已经表过退水态度`)];
  }

  const withdrawals = [
    ...(state.sheriffWithdrawals ?? []),
    { seat: action.seat, withdraw: action.withdraw },
  ];
  const drafts: EventDraft[] = [
    {
      type: 'SHERIFF_WITHDRAWN',
      visibleTo: 'public',
      payload: { seat: action.seat, withdraw: action.withdraw },
    },
  ];

  const candidates = candidatesOf(state);
  if (!candidates.every((seat) => withdrawals.some((entry) => entry.seat === seat))) {
    return drafts;
  }

  const remaining = candidates.filter((seat) => {
    const decided = withdrawals.find((entry) => entry.seat === seat);
    return decided === undefined || !decided.withdraw;
  });

  if (remaining.length === 0) {
    drafts.push(...failElection('DAY_SHERIFF_WITHDRAW', 'all-withdrawn'));
    return drafts;
  }

  if (remaining.length === 1) {
    const seat = remaining[0];
    if (seat === undefined) throw new InvalidEventStreamError('只剩一名候选人却没有座位');
    drafts.push(
      { type: 'SHERIFF_ELECTED', visibleTo: 'public', payload: { seat } },
      phaseChangedDraft('DAY_SHERIFF_WITHDRAW', 'DAY_SHERIFF_RESULT'),
    );
    return drafts;
  }

  // 上警者全部留警上时没有警下投票人 → 无警长（RFC-022 §2.2）。
  if (votersOf(state).length === 0) {
    drafts.push(...failElection('DAY_SHERIFF_WITHDRAW', 'no-voters'));
    return drafts;
  }

  drafts.push(phaseChangedDraft('DAY_SHERIFF_WITHDRAW', 'DAY_SHERIFF_VOTE'));
  return drafts;
};

/** 警长票的结算结果。 */
function sheriffVoteOutcome(
  votes: readonly {
    seat: SeatId;
    target: SeatId | 'abstain';
  }[],
): { tied: SeatId[]; winner?: SeatId } {
  const counts = new Map<SeatId, number>();
  for (const vote of votes) {
    if (vote.target === 'abstain') continue;
    counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
  }

  if (counts.size === 0) return { tied: [] };

  const top = Math.max(...counts.values());
  const tied = [...counts.entries()]
    .filter(([, count]) => count === top)
    .map(([seat]) => seat)
    .sort((a, b) => a - b);

  const only = tied[0];
  if (tied.length === 1 && only !== undefined) return { tied, winner: only };

  // 二次平票由调用方判成「无警长」；这里只如实返回并列者。
  return { tied };
}

/** `SHERIFF_VOTE`（`DAY_SHERIFF_VOTE` / `DAY_SHERIFF_RUNOFF`）：警下暗投。 */
const sheriffVote: ActionHandlerFor<'SHERIFF_VOTE'> = (state, action) => {
  const voters = votersOf(state);
  if (!voters.includes(action.seat)) {
    return [
      sheriffRejection(
        action,
        'NOT_A_VOTER',
        `座位 ${action.seat} 上过警（或不在警下），没有警长投票权`,
      ),
    ];
  }
  if (!isAlive(state, action.seat)) {
    return [sheriffRejection(action, 'NOT_ALIVE', `座位 ${action.seat} 已出局，不能投票`)];
  }
  if ((state.sheriffVotes ?? []).some((vote) => vote.seat === action.seat)) {
    return [sheriffRejection(action, 'ALREADY_VOTED', `座位 ${action.seat} 本轮已经投过票`)];
  }

  const runoff = state.phase === 'DAY_SHERIFF_RUNOFF';
  if (runoff) {
    const tied = state.sheriffRunoff ?? [];
    if (action.target === 'abstain' || !tied.includes(action.target)) {
      return [
        sheriffRejection(
          action,
          'INVALID_RUNOFF_TARGET',
          `重投只能投并列者（${tied.join(', ')}），不能弃权，收到 ${String(action.target)}`,
        ),
      ];
    }
  } else if (action.target !== 'abstain' && !activeCandidatesOf(state).includes(action.target)) {
    return [
      sheriffRejection(
        action,
        'INVALID_SHERIFF_TARGET',
        `座位 ${String(action.target)} 不在警上，不能投`,
      ),
    ];
  }

  const votes = [...(state.sheriffVotes ?? []), { seat: action.seat, target: action.target }];
  const cast: EventDraft = {
    type: 'SHERIFF_VOTE_CAST',
    visibleTo: `self:${action.seat}`,
    payload: { seat: action.seat, target: action.target },
  };

  const remaining = voters.filter((seat) => !votes.some((vote) => vote.seat === seat));
  if (remaining.length > 0) return [cast];

  const round: SheriffVoteRound = runoff ? 'runoff' : 'initial';
  const outcome = sheriffVoteOutcome(votes);
  const revealed: EventDraft = {
    type: 'SHERIFF_VOTE_REVEALED',
    visibleTo: 'public',
    payload: {
      votes: [...votes],
      round,
      ...(outcome.tied.length > 1 ? { tied: outcome.tied } : {}),
    },
  };
  const drafts: EventDraft[] = [cast, revealed];

  if (outcome.winner !== undefined) {
    drafts.push(
      { type: 'SHERIFF_ELECTED', visibleTo: 'public', payload: { seat: outcome.winner } },
      phaseChangedDraft(state.phase, 'DAY_SHERIFF_RESULT'),
    );
    return drafts;
  }

  if (outcome.tied.length === 0) {
    drafts.push(...failElection(state.phase, 'no-valid-votes'));
    return drafts;
  }

  if (round === 'initial') {
    drafts.push(phaseChangedDraft(state.phase, 'DAY_SHERIFF_PK'));
    return drafts;
  }

  // 二次平票 → 本局无警长（RFC-022 §2.2）。
  drafts.push(...failElection(state.phase, 'double-tie'));
  return drafts;
};

/** `DAY_SHERIFF_RESULT` 的自动推进：结果已经在 `SHERIFF_ELECTED` / `FAILED` 里折叠好。 */
export function sheriffResultEntry(state: GameState): EventDraft[] {
  if (sheriffSeatOf(state) === null && state.sheriffElectionFailure === undefined) {
    throw new InvalidEventStreamError('DAY_SHERIFF_RESULT 阶段既没有当选者，也没有失败原因');
  }
  return [phaseChangedDraft('DAY_SHERIFF_RESULT', 'DAY_ANNOUNCE')];
}

/** `BADGE_TRANSFER`（`DAY_BADGE_TRANSFER`）：死亡警长移交或撕徽。 */
const badgeTransfer: ActionHandlerFor<'BADGE_TRANSFER'> = (state, action) => {
  const sheriff = sheriffSeatOf(state);
  if (sheriff === null) {
    return [sheriffRejection(action, 'NOT_SHERIFF', '本局没有警长，不能移交警徽')];
  }
  if (sheriff !== action.seat) {
    return [sheriffRejection(action, 'NOT_YOUR_TURN', `当前警长是 ${sheriff} 号`)];
  }
  if (isAlive(state, action.seat)) {
    return [sheriffRejection(action, 'SHERIFF_ALIVE', '警长还活着，不能移交警徽')];
  }

  const from = state.badgeTransferFrom;
  if (from === undefined) {
    throw new InvalidEventStreamError('DAY_BADGE_TRANSFER 缺少来源阶段，无法决定后续去向');
  }

  const drafts: EventDraft[] = [];
  let tear = false;

  if (action.target === 'tear') {
    tear = true;
    drafts.push({
      type: 'BADGE_DESTROYED',
      visibleTo: 'public',
      payload: { seat: action.seat },
    });
  } else {
    if (action.target === action.seat) {
      return [sheriffRejection(action, 'INVALID_BADGE_TARGET', '不能把警徽移交给自己')];
    }
    if (!isAlive(state, action.target)) {
      return [
        sheriffRejection(action, 'TARGET_NOT_ALIVE', `座位 ${action.target} 已出局，不能接任警长`),
      ];
    }
    drafts.push({
      type: 'BADGE_TRANSFERRED',
      visibleTo: 'public',
      payload: { from: action.seat, to: action.target },
    });
  }

  if (from === 'DAY_LYNCH' || from === 'DAY_HUNTER_SHOOT') {
    drafts.push(...enterNight('DAY_BADGE_TRANSFER'));
    return drafts;
  }

  if (from !== 'DAY_ANNOUNCE' && from !== 'NIGHT_HUNTER_SHOOT') {
    throw new InvalidEventStreamError(`DAY_BADGE_TRANSFER 的来源阶段不合法：${from}`);
  }

  drafts.push(phaseChangedDraft('DAY_BADGE_TRANSFER', tear ? 'DAY_SPEECH' : 'DAY_SHERIFF_ORDER'));
  return drafts;
};

/** `SHERIFF_ORDER`（`DAY_SHERIFF_ORDER`）：警长选择今天的发言起点与方向。 */
const sheriffOrder: ActionHandlerFor<'SHERIFF_ORDER'> = (state, action) => {
  const sheriff = sheriffSeatOf(state);
  if (sheriff === null) {
    return [sheriffRejection(action, 'NOT_SHERIFF', '本局没有警长，不能选择发言顺序')];
  }
  if (sheriff !== action.seat) {
    return [sheriffRejection(action, 'NOT_YOUR_TURN', `当前警长是 ${sheriff} 号`)];
  }
  if (!isAlive(state, action.seat)) {
    return [sheriffRejection(action, 'NOT_ALIVE', '已出局的警长不能选择发言顺序')];
  }

  const options = sheriffOrderOptions(state);
  const matched = options.some(
    (option) => option.startSeat === action.startSeat && option.direction === action.direction,
  );
  if (!matched) {
    const allowed = options
      .map((option) => `${option.startSeat} 号/${option.direction}`)
      .join('、');
    return [
      sheriffRejection(
        action,
        'INVALID_SHERIFF_ORDER',
        `发言起点必须是昨夜死者/警长的左右第一位存活玩家：${allowed}`,
      ),
    ];
  }

  return [
    {
      type: 'SHERIFF_ORDER_CHOSEN',
      visibleTo: 'public',
      payload: { startSeat: action.startSeat, direction: action.direction },
    },
    phaseChangedDraft('DAY_SHERIFF_ORDER', 'DAY_SPEECH'),
  ];
};

/** 竞选发言 / PK 发言的公共校验与推进。 */
function sheriffSpeechDraft(
  state: GameState,
  action: Extract<Action, { type: 'SPEECH' | 'SPEECH_SKIP' }>,
): EventDraft[] {
  const expected = nextSheriffSpeaker(state);
  if (!isAlive(state, action.seat) || action.seat !== expected) {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message:
          expected === undefined
            ? `本轮警上发言已经结束，${action.seat} 不能再发言`
            : `还没轮到席位 ${action.seat}，当前该 ${expected} 发言`,
        seat: action.seat,
      }),
    ];
  }

  const eligible =
    state.phase === 'DAY_SHERIFF_PK'
      ? (state.sheriffRunoff ?? [])
      : (state.sheriffCandidates ?? []);
  const spoken = [...(state.sheriffSpeech?.spoken ?? []), action.seat];
  const remaining = [...eligible].sort((a, b) => a - b).filter((seat) => !spoken.includes(seat));

  const event: EventDraft =
    action.type === 'SPEECH'
      ? {
          type: 'SHERIFF_SPEECH',
          visibleTo: 'public',
          payload: { seat: action.seat, text: action.text },
        }
      : {
          type: 'SHERIFF_SPEECH_SKIPPED',
          visibleTo: 'public',
          payload: { seat: action.seat },
        };

  if (remaining.length > 0) return [event];

  return [
    event,
    phaseChangedDraft(
      state.phase,
      state.phase === 'DAY_SHERIFF_PK' ? 'DAY_SHERIFF_RUNOFF' : 'DAY_SHERIFF_WITHDRAW',
    ),
  ];
}

/** `DAY_SHERIFF_FINAL_SPEECH`：警长在正常轮转之后再做的额外归票发言。 */
export function sheriffFinalSpeechDraft(
  state: GameState,
  action: Extract<Action, { type: 'SPEECH' | 'SPEECH_SKIP' }>,
): EventDraft[] {
  const sheriff = sheriffSeatOf(state);
  if (sheriff === null || !isAlive(state, sheriff)) {
    return [
      rejectionDraft({
        action,
        code: 'NOT_SHERIFF',
        message: '本局没有存活警长，不能做归票发言',
        seat: action.seat,
      }),
    ];
  }
  if (action.seat !== sheriff) {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `只有警长 ${sheriff} 号能做归票发言`,
        seat: action.seat,
      }),
    ];
  }
  if (state.sheriffFinalSpeechDone === true) {
    return [
      rejectionDraft({
        action,
        code: 'ALREADY_SPOKEN',
        message: '警长本日已经做过归票发言',
        seat: action.seat,
      }),
    ];
  }

  const event: EventDraft =
    action.type === 'SPEECH'
      ? { type: 'SPEECH', visibleTo: 'public', payload: { seat: action.seat, text: action.text } }
      : { type: 'SPEECH_SKIPPED', visibleTo: 'public', payload: { seat: action.seat } };

  return [event, phaseChangedDraft('DAY_SHERIFF_FINAL_SPEECH', 'DAY_VOTE')];
}

/** RFC-022 交付的警长 handler 表。 */
export const SHERIFF_HANDLERS = {
  SHERIFF_SIGNUP: sheriffSignup,
  SHERIFF_WITHDRAW: sheriffWithdraw,
  SHERIFF_VOTE: sheriffVote,
  BADGE_TRANSFER: badgeTransfer,
  SHERIFF_ORDER: sheriffOrder,
} as const;

// 让「竞选发言」可以被 `phases/day.ts` 的 `SPEECH` handler 复用，同时避免它 import 整个文件
// 的其余实现。导出的是同一条实现，不存在两份推进逻辑。
export { sheriffSpeechDraft };
