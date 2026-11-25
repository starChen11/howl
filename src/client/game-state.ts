import type { SeatId, SheriffBadgeState, SpeechDirection } from '@shared/domain';
import type { SheriffElectionStep, SheriffElectionView, ProjectedContext } from '@shared/project';
import { dayLabel, phaseLabel } from '@shared/phase-labels';
import { ROLE_LABELS } from '@shared/terms';

/**
 * 从投影推导界面要显示的东西（RFC-012 §2.3 / RFC-022 §7）。
 *
 * **不另外算一份状态**：当前发言者、已发言、已出局全部来自投影与公开事件，
 * 前端只是把它们排成可读的形状。
 *
 * RFC-022 的警长信息在服务端投影接入前可能缺席。这里的 `effective*` 系列会退回公开
 * 事件（`SHERIFF_ELECTED` / `SHERIFF_ORDER_CHOSEN` …）推导，投影一就绪就自动优先用它。
 */

export interface SeatView {
  seat: number;
  alive: boolean;
  isSelf: boolean;
  hasSpoken: boolean;
  speaking: boolean;
  /** 当前警长（警徽仍在他手里）。 */
  sheriff?: boolean;
  /** 正在竞选，且该席位在警上。 */
  candidate?: boolean;
  /** 正在竞选，且该席位有警长投票权（警下）。 */
  voter?: boolean;
  /** 已退水。 */
  withdrawn?: boolean;
}

export interface BoardView {
  seats: SeatView[];
  speakingSeat: number | null;
  aliveCount: number;
  day: number;
  phase: string;
}

/** RFC-022 新增的竞选子阶段。 */
export function isSheriffElectionPhase(phase: string): boolean {
  return (
    phase === 'DAY_SHERIFF_SIGNUP' ||
    phase === 'DAY_SHERIFF_SPEECH' ||
    phase === 'DAY_SHERIFF_WITHDRAW' ||
    phase === 'DAY_SHERIFF_VOTE' ||
    phase === 'DAY_SHERIFF_PK' ||
    phase === 'DAY_SHERIFF_RUNOFF' ||
    phase === 'DAY_SHERIFF_RESULT'
  );
}

/** 与竞选走同一条「不说话」流程的阶段（定序 / 移交 / 归票不在此列）。 */
export function isSheriffRelatedPhase(phase: string): boolean {
  return (
    isSheriffElectionPhase(phase) ||
    phase === 'DAY_BADGE_TRANSFER' ||
    phase === 'DAY_SHERIFF_ORDER' ||
    phase === 'DAY_SHERIFF_FINAL_SPEECH'
  );
}

/**
 * 首夜竞选期间必须隐藏死亡（RFC-022 §13.1）。
 *
 * 服务端若在 `DAY_ANNOUNCE` 之前就把死亡投影出来，这是泄漏；界面在这里兜住。
 */
export function shouldHideDeaths(ctx: ProjectedContext): boolean {
  return ctx.day === 1 && isSheriffElectionPhase(ctx.phase);
}

/**
 * 把首夜竞选期间的死亡从视图里抹掉。
 *
 * 投影正常时本来就是 9 人全部存活，这个函数不改变任何东西；服务端提前泄漏时它让界面
 * 仍然显示「9 人都在」。**只影响显示**，真实动作仍以服务端为准。
 */
export function maskDeathsDuringElection(ctx: ProjectedContext): ProjectedContext {
  if (!shouldHideDeaths(ctx)) return ctx;

  const allSeats = [...new Set([...ctx.aliveSeats, ...ctx.deadSeats])].sort((a, b) => a - b);
  const publicEvents = ctx.publicEvents.filter(
    (event) =>
      event.type !== 'DAY_STARTED' && event.type !== 'PLAYER_DIED' && event.type !== 'HUNTER_SHOOT',
  );

  return {
    ...ctx,
    aliveSeats: allSeats,
    deadSeats: [],
    publicEvents,
    self: { ...ctx.self, alive: true },
  };
}

/** 公开事件里是否已经出现过竞选。旧对局没有，界面应显示「尚未产生」而不是「无警长」。 */
function hasElectionEvents(ctx: ProjectedContext): boolean {
  return ctx.publicEvents.some(
    (event) =>
      event.type === 'SHERIFF_ELECTION_STARTED' ||
      event.type === 'SHERIFF_ELECTED' ||
      event.type === 'SHERIFF_ELECTION_FAILED' ||
      event.type === 'BADGE_TRANSFERRED' ||
      event.type === 'BADGE_DESTROYED',
  );
}

/** 当前警长；`undefined` 表示事件流里还没有任何警长信息。 */
export function effectiveSheriffSeat(ctx: ProjectedContext): number | null | undefined {
  if (ctx.sheriffSeat !== undefined) return ctx.sheriffSeat;
  if (!hasElectionEvents(ctx)) return undefined;

  let sheriff: number | null = null;
  for (const event of ctx.publicEvents) {
    if (event.type === 'SHERIFF_ELECTED') {
      sheriff = (event.payload as { seat: number }).seat;
    } else if (event.type === 'SHERIFF_ELECTION_FAILED') {
      sheriff = null;
    } else if (event.type === 'BADGE_TRANSFERRED') {
      sheriff = (event.payload as { to: number }).to;
    } else if (event.type === 'BADGE_DESTROYED') {
      sheriff = null;
    }
  }
  return sheriff;
}

/** 警徽状态；`undefined` 表示旧投影没有这个字段。 */
export function effectiveBadge(ctx: ProjectedContext): SheriffBadgeState | undefined {
  if (ctx.badge !== undefined) return ctx.badge;

  let badge: SheriffBadgeState | undefined;
  for (const event of ctx.publicEvents) {
    if (event.type === 'SHERIFF_ELECTION_STARTED') badge = 'none';
    else if (event.type === 'SHERIFF_ELECTED') badge = 'held';
    else if (event.type === 'SHERIFF_ELECTION_FAILED') badge = 'none';
    else if (event.type === 'BADGE_TRANSFERRED') badge = 'held';
    else if (event.type === 'BADGE_DESTROYED') badge = 'destroyed';
  }
  return badge;
}

function electionStepOfPhase(phase: string): SheriffElectionStep {
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

function allKnownSeats(ctx: ProjectedContext): number[] {
  return [...new Set([...ctx.aliveSeats, ...ctx.deadSeats])].sort((a, b) => a - b);
}

/** 从公开事件还原竞选公开视图（服务端 `sheriff` 字段缺席时的兜底）。 */
export function electionFromEvents(ctx: ProjectedContext): SheriffElectionView {
  let signups: { seat: number; run: boolean }[] = [];
  let candidates: number[] = [];
  let withdrawn: number[] = [];
  let runoff: number[] = [];
  let candidatesPublished = false;

  for (const event of ctx.publicEvents) {
    switch (event.type) {
      case 'SHERIFF_ELECTION_STARTED':
        signups = [];
        candidates = [];
        withdrawn = [];
        runoff = [];
        candidatesPublished = false;
        break;
      case 'SHERIFF_SIGNUP': {
        const payload = event.payload as { seat: number; run: boolean };
        signups = [...signups, payload];
        break;
      }
      case 'SHERIFF_CANDIDATES': {
        candidates = [...(event.payload as { candidates: number[] }).candidates].sort(
          (a, b) => a - b,
        );
        candidatesPublished = true;
        break;
      }
      case 'SHERIFF_WITHDRAWN': {
        const payload = event.payload as { seat: number; withdraw: boolean };
        if (payload.withdraw) {
          withdrawn = [...new Set([...withdrawn, payload.seat])].sort((a, b) => a - b);
        }
        break;
      }
      case 'SHERIFF_VOTE_REVEALED': {
        const payload = event.payload as { tied?: number[] };
        runoff = payload.tied === undefined ? [] : [...payload.tied].sort((a, b) => a - b);
        break;
      }
      case 'SHERIFF_ELECTION_FAILED':
        runoff = [];
        break;
      default:
        break;
    }
  }

  // 候选人名单还没公布时，用已表态的「上警」列表给界面一个可读的中间态。
  const candidateList =
    candidatesPublished || candidates.length > 0
      ? candidates
      : signups
          .filter((entry) => entry.run)
          .map((entry) => entry.seat)
          .sort((a, b) => a - b);

  const voterList = candidatesPublished
    ? allKnownSeats(ctx).filter((seat) => !candidates.includes(seat))
    : signups
        .filter((entry) => !entry.run)
        .map((entry) => entry.seat)
        .sort((a, b) => a - b);

  return {
    phase: electionStepOfPhase(ctx.phase),
    candidates: candidateList as SeatId[],
    voters: voterList as SeatId[],
    withdrawn: withdrawn as SeatId[],
    signups: [...signups] as { seat: SeatId; run: boolean }[],
    runoff: runoff as SeatId[],
    isCandidate: candidateList.includes(ctx.self.seat),
    isVoter: voterList.includes(ctx.self.seat),
  };
}

/**
 * 当前竞选的公开视图。
 *
 * 服务端投影有 `sheriff` 时原样使用（它是唯一的权威）；没有时退回事件推导，
 * 保证服务端投影接入前界面也能完整跑通。
 */
export function sheriffElectionOf(ctx: ProjectedContext): SheriffElectionView {
  return ctx.sheriff ?? electionFromEvents(ctx);
}

/** 公开事件里自己最后一次退水表态。`undefined` 表示还没表态。 */
export function ownWithdrawalDecision(ctx: ProjectedContext): boolean | undefined {
  let decision: boolean | undefined;
  for (const event of ctx.publicEvents) {
    if (event.type !== 'SHERIFF_WITHDRAWN') continue;
    const payload = event.payload as { seat: number; withdraw: boolean };
    if (payload.seat === ctx.self.seat) decision = payload.withdraw;
  }
  return decision;
}

/** 自己这一轮是否已经投过警长票（`SHERIFF_VOTE_CAST` 只对自己可见）。 */
export function hasCastSheriffVote(ctx: ProjectedContext): boolean {
  return ctx.privateEvents.some((event) => {
    if (event.type !== 'SHERIFF_VOTE_CAST') return false;
    return (event.payload as { seat: number }).seat === ctx.self.seat;
  });
}

/** 是否正轮到自己做警长专属决定（用于锁定真相视图，避免挑人时偷看身份）。 */
export function hasPendingSheriffChoice(ctx: ProjectedContext): boolean {
  const sheriff = effectiveSheriffSeat(ctx);
  if (sheriff === undefined || sheriff === null || sheriff !== ctx.self.seat) return false;
  if (ctx.phase === 'DAY_BADGE_TRANSFER') return !ctx.self.alive;
  if (ctx.phase === 'DAY_SHERIFF_ORDER') return ctx.self.alive;
  return false;
}

/** 警长可选的一个发言顺序：起点 + 方向（RFC-022 §3.2）。 */
export interface SheriffOrderOption {
  startSeat: number;
  direction: SpeechDirection;
}

function firstAliveInDirection(
  alive: readonly number[],
  from: number,
  direction: SpeechDirection,
  excludeFrom: boolean,
): number | undefined {
  if (alive.length === 0) return undefined;

  const ordered = direction === 'clockwise' ? [...alive] : [...alive].reverse();
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

  return excludeFrom && alive.includes(from) ? from : undefined;
}

/**
 * 警长今天可选的发言起点与方向。
 *
 * 与引擎同一套规则：恰好 1 人死亡用死者做基准，否则用警长；方向写进动作，不靠位置猜。
 */
export function sheriffOrderOptions(ctx: ProjectedContext): SheriffOrderOption[] {
  // 服务端投影已给出权威选项（起点 + 方向）时直接采用，避免客户端重启一套规则。
  if (ctx.sheriffOrderOptions !== undefined) {
    return ctx.sheriffOrderOptions.map((option) => ({
      startSeat: option.startSeat,
      direction: option.direction,
    }));
  }

  const sheriff = effectiveSheriffSeat(ctx);
  if (typeof sheriff !== 'number') return [];

  const started = [...ctx.publicEvents].reverse().find((event) => event.type === 'DAY_STARTED');
  const deaths = (
    (started?.payload as { diedLastNight?: number[] } | undefined)?.diedLastNight ?? []
  )
    .slice()
    .sort((a, b) => a - b);
  const base = deaths.length === 1 ? deaths[0] : sheriff;
  if (base === undefined) return [];

  const alive = [...ctx.aliveSeats].sort((a, b) => a - b);
  return (['clockwise', 'counterclockwise'] as const)
    .map((direction) => ({
      direction,
      startSeat: firstAliveInDirection(alive, base, direction, base === sheriff),
    }))
    .filter((option): option is SheriffOrderOption => option.startSeat !== undefined);
}

export function directionLabel(direction: SpeechDirection): string {
  return direction === 'clockwise' ? '顺时针' : '逆时针';
}

/** 竞选失败原因的中文名（RFC-022 §2.2）。 */
export function sheriffFailureReasonLabel(reason: string): string {
  switch (reason) {
    case 'no-candidates':
      return '无人上警';
    case 'all-withdrawn':
      return '全部退水';
    case 'no-voters':
      return '没有警下投票人';
    case 'no-valid-votes':
      return '没有有效票';
    case 'double-tie':
      return '重投再次平票';
    case 'self-exposed':
      return `${ROLE_LABELS.wolf}自曝中止竞选`;
    default:
      return reason;
  }
}

/** 公开事件里「谁说过话」。 */
export function spokenSeats(ctx: ProjectedContext): number[] {
  // **只算最近一天**：跨天累加会让第二天开局时所有人都显示「已发言」（C-121）。
  // **不包含 `SHERIFF_SPEECH`**：竞选发言有独立 cursor（RFC-022 §13.2），算进来会污染
  // 第一天的正常发言进度。
  const events = ctx.publicEvents;
  let lastDayStart = -1;
  events.forEach((event, index) => {
    if (event.type === 'DAY_STARTED') lastDayStart = index;
  });

  return events
    .slice(lastDayStart + 1)
    .filter((event) => event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED')
    .map((event) => (event.payload as { seat?: number }).seat)
    .filter((seat): seat is number => typeof seat === 'number');
}

/** 竞选发言的最新一轮起点（首次竞选 / PK 会各自重置 cursor）。 */
function sheriffSpeechStartIndex(ctx: ProjectedContext): number {
  let start = 0;
  ctx.publicEvents.forEach((event, index) => {
    if (event.type === 'SHERIFF_CANDIDATES') start = index + 1;
    if (event.type === 'PHASE_CHANGED') {
      const to = (event.payload as { to?: string }).to;
      if (to === 'DAY_SHERIFF_SPEECH' || to === 'DAY_SHERIFF_PK') start = index + 1;
    }
    if (event.type === 'SHERIFF_VOTE_REVEALED') {
      const tied = (event.payload as { tied?: number[] }).tied;
      if (tied !== undefined && tied.length > 0) start = index + 1;
    }
  });
  return start;
}

/** 本轮竞选已经发过言（或跳过）的席位。 */
export function sheriffSpokenSeats(ctx: ProjectedContext): number[] {
  return ctx.publicEvents
    .slice(sheriffSpeechStartIndex(ctx))
    .filter((event) => event.type === 'SHERIFF_SPEECH' || event.type === 'SHERIFF_SPEECH_SKIPPED')
    .map((event) => (event.payload as { seat?: number }).seat)
    .filter((seat): seat is number => typeof seat === 'number');
}

/** 竞选 / PK 阶段当前该发言的席位。 */
function sheriffSpeakingSeat(ctx: ProjectedContext): number | null {
  const election = sheriffElectionOf(ctx);
  const eligible = (ctx.phase === 'DAY_SHERIFF_PK' ? election.runoff : election.candidates)
    .slice()
    .sort((a, b) => a - b);
  if (eligible.length === 0) return null;

  const spoken = new Set(sheriffSpokenSeats(ctx));
  return eligible.find((seat) => !spoken.has(seat)) ?? null;
}

/** 白天 PK 的并列者：优先读折算票（1.5 票会影响平票判定）。 */
function dayPkTiedSeats(ctx: ProjectedContext): number[] {
  let tied: number[] = [];

  for (const event of ctx.publicEvents) {
    if (event.type !== 'VOTE_REVEALED') continue;
    const payload = event.payload as {
      votes?: { target: number | 'abstain' }[];
      countedVotes?: { target: number | 'abstain'; halfVotes: number }[];
    };

    const tally = new Map<number, number>();
    if (payload.countedVotes !== undefined) {
      for (const vote of payload.countedVotes) {
        if (vote.target === 'abstain') continue;
        tally.set(vote.target, (tally.get(vote.target) ?? 0) + vote.halfVotes);
      }
    } else {
      for (const vote of payload.votes ?? []) {
        if (vote.target === 'abstain') continue;
        tally.set(vote.target, (tally.get(vote.target) ?? 0) + 1);
      }
    }

    if (tally.size === 0) {
      tied = [];
      continue;
    }
    const top = Math.max(...tally.values());
    tied = [...tally.entries()]
      .filter(([, count]) => count === top)
      .map(([seat]) => seat)
      .sort((a, b) => a - b);
  }

  return tied;
}

/** 当天发言顺序：警长定序优先，否则用 `DAY_STARTED.speechStartSeat`。 */
function daySpeechOrder(ctx: ProjectedContext): number[] {
  const events = ctx.publicEvents;
  let dayStartIndex = -1;
  events.forEach((event, index) => {
    if (event.type === 'DAY_STARTED') dayStartIndex = index;
  });

  const started = dayStartIndex === -1 ? undefined : events[dayStartIndex];
  const startSeat =
    started === undefined
      ? ctx.aliveSeats[0]
      : (started.payload as { speechStartSeat?: number }).speechStartSeat;

  if (dayStartIndex !== -1) {
    for (const event of events.slice(dayStartIndex + 1)) {
      if (event.type !== 'SHERIFF_ORDER_CHOSEN') continue;
      const payload = event.payload as { startSeat: number; direction: SpeechDirection };
      // 警长定序是当天发言顺序的权威（RFC-022 §13.3）。
      return rotateAlive(ctx.aliveSeats, payload.startSeat, payload.direction);
    }
  }

  if (startSeat === undefined) return [];
  // 没有警长定序时沿用 RFC-004 的顺时针轮转。
  return rotateAlive(ctx.aliveSeats, startSeat, 'clockwise');
}

function rotateAlive(
  aliveSeats: readonly number[],
  startSeat: number,
  direction: SpeechDirection,
): number[] {
  const alive = [...aliveSeats].sort((a, b) => a - b);
  const pivot = alive.indexOf(startSeat);
  const rotated = pivot === -1 ? alive : [...alive.slice(pivot), ...alive.slice(0, pivot)];
  if (direction === 'counterclockwise' && rotated.length > 0) {
    return [rotated[0] as number, ...rotated.slice(1).reverse()];
  }
  return rotated;
}

/**
 * 当前发言者。
 *
 * 与引擎的发言顺序一致，所以刷新后不会错位。RFC-022 的两个新增点：
 * - 竞选 / PK 发言有独立 cursor，不写进白天的 `spoken`；
 * - `DAY_SPEECH` 必须服从 `SHERIFF_ORDER_CHOSEN` 的起点与方向。
 */
export function speakingSeat(ctx: ProjectedContext): number | null {
  if (ctx.phase === 'DAY_SHERIFF_SPEECH' || ctx.phase === 'DAY_SHERIFF_PK') {
    return sheriffSpeakingSeat(ctx);
  }

  if (ctx.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    const sheriff = effectiveSheriffSeat(ctx);
    const alive: readonly number[] = ctx.aliveSeats;
    return typeof sheriff === 'number' && alive.includes(sheriff) ? sheriff : null;
  }

  if (ctx.phase === 'DAY_PK_SPEECH') {
    const tied = dayPkTiedSeats(ctx);
    if (tied.length === 0) return null;

    // 从最近一次唱票开始只数 PK 发言。
    let revealedAt = -1;
    ctx.publicEvents.forEach((event, index) => {
      if (event.type === 'VOTE_REVEALED') revealedAt = index;
    });
    const spoken = new Set(
      ctx.publicEvents
        .slice(revealedAt + 1)
        .filter((event) => event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED')
        .map((event) => (event.payload as { seat: number }).seat),
    );
    return tied.find((seat) => !spoken.has(seat)) ?? null;
  }

  if (ctx.phase !== 'DAY_SPEECH') return null;

  const spoken = new Set(spokenSeats(ctx));
  return daySpeechOrder(ctx).find((seat) => !spoken.has(seat)) ?? null;
}

export function buildBoard(ctx: ProjectedContext): BoardView {
  // 首夜竞选期间绝不能因为投影提前泄漏而显示死亡（RFC-022 §13.1）。
  const safe = maskDeathsDuringElection(ctx);
  const election = sheriffElectionOf(safe);
  const electionActive = election.phase !== null;
  const sheriff = effectiveSheriffSeat(safe);
  const spoken = new Set(electionActive ? sheriffSpokenSeats(safe) : spokenSeats(safe));
  const speaking = speakingSeat(safe);
  const withdrawn = new Set<number>(election.withdrawn);
  const alive: readonly number[] = safe.aliveSeats;
  const candidates: readonly number[] = election.candidates;
  const voters: readonly number[] = election.voters;

  return {
    seats: allKnownSeats(safe).map((seat) => ({
      seat,
      alive: alive.includes(seat),
      isSelf: seat === safe.self.seat,
      hasSpoken: spoken.has(seat),
      speaking: seat === speaking,
      sheriff: sheriff === seat,
      candidate: electionActive && candidates.includes(seat),
      voter: electionActive && voters.includes(seat),
      withdrawn: electionActive && withdrawn.has(seat),
    })),
    speakingSeat: speaking,
    aliveCount: safe.aliveSeats.length,
    day: safe.day,
    phase: safe.phase,
  };
}

/** 倒计时文案（AC-14：文字表达，不只靠颜色）。 */
export function clockText(remaining: number): string {
  const safe = Math.max(0, remaining);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function countdownText(remaining: number): string {
  if (remaining <= 0) return '时间到';
  if (remaining <= 10) return `最后 ${remaining} 秒`;
  return `还剩 ${remaining} 秒`;
}

/** 屏幕阅读器的整局描述（不含倒计时，避免每秒播报）。 */
export function boardAnnouncement(ctx: ProjectedContext): string {
  const safe = maskDeathsDuringElection(ctx);
  const speaking = speakingSeat(safe);
  const sheriff = effectiveSheriffSeat(safe);
  const sheriffText = typeof sheriff === 'number' ? `，警长 ${sheriff} 号` : '';
  return `你是 ${safe.self.seat} 号，${dayLabel(safe.day, safe.phase)}，${phaseLabel(safe.phase)}${sheriffText}${
    speaking === null ? '' : `，轮到 ${speaking} 号发言`
  }。`;
}
