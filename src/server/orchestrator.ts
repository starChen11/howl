import type { Action } from '@shared/actions';
import type { InputChannel, OutputChannel } from '@shared/channels';
import type { GameState, SpeechDirection } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
import type { PendingDecision, ProjectedContext } from '@shared/project';

import { sheriffOrderOptions } from '@engine/phases/sheriff';

import { loadPhaseTimers, timeoutForPhase, type PhaseTimers } from './config/phase-timers';
import { degradeSentence } from './llm/degrade';
import { project } from './project';
import { phaseTimer } from './project/timer';
import type { GameRecord, GameRegistry, SessionRecord } from './store/game-registry';

/**
 * 编排层（RFC-011 §2.3 / §3）。
 *
 * 职责只有一条：**推进引擎**。它按投影里的 `pending` 决定该问谁：
 * - 玩家席位 → `InputChannel`（服务端挂起的 Promise）；
 * - AI 席位 → 注入的决策函数；
 * - 说完/投完 → `OutputChannel` 推增量。
 *
 * 引擎不知道通道的存在（ARCH-1）：编排层把输入翻译成 action，再交给 `submit`。
 */

export interface AgentDecision {
  action: Action | undefined;
  /** 想说的话（speak 类动作时由编排层写进 action）。 */
  speech?: string;
  /** 这一轮的推理；落成 `AI_THOUGHT` 事件供复盘展示（RFC-014）。 */
  thought?: { reason: string; claim?: unknown } | undefined;
  degraded?: boolean;
}

export interface OrchestratorDeps {
  registry: GameRegistry;
  session: SessionRecord;
  /** 要推进的对局；省略时取会话里最后一个（旧行为）。 */
  gameId?: string;
  input: InputChannel;
  output: OutputChannel;
  /** AI 的决策来源；测试注入脚本。`phase` 是引擎真实相位（投影把夜间折叠了）。 */
  decide: (input: {
    seat: number;
    ctx: ProjectedContext;
    phase: string;
    feedback?: string;
    instruction?: string;
    onSpeechDelta?: (text: string) => void;
  }) => Promise<AgentDecision>;
  /** 提前结束（测试用）。 */
  maxSteps?: number;
  /** 各阶段最长等待时间；不传时从环境变量读取（默认已翻倍）。 */
  phaseTimers?: PhaseTimers;
  /** 狼队讨论时长（毫秒，RUL-14）。默认 100 秒。 */
  wolfChatMs?: number;
  /** AI 脚本队友多久后自动准备（毫秒）。生产 5 秒；测试默认 0。 */
  wolfReadyMs?: number;
  /** 狼队投票时长（毫秒）。超时按弃权处理。默认 10 秒。 */
  wolfVoteMs?: number;
  /** AI 狼如何准备：脚本固定延迟自动准备；真实模型自己输出 ready。 */
  wolfAiReady?: 'auto' | 'model';
  /** AI 狼在夜间投票时每条票之间的间隔（毫秒），让待投票的狼看到实时票型。 */
  wolfVoteDelayMs?: number;
  now?: () => number;
}

export interface OrchestratorResult {
  record: GameRecord;
  steps: number;
  /** 玩家超时/弃权的轮次（AC-7 的复盘依据）。 */
  skipped: number;
}

/**
 * 编排层需要读取的对局状态切片（结构化，测试可以只造需要的字段）。
 *
 * 刻意不直接用 `GameState`：`nextActor` / `seatToSpeak` 是纯派生查询，单元测试经常
 * 只造三五个字段；绑死完整状态会逼测试伪造整局。
 */
export interface ActorState {
  phase: string;
  day?: number;
  seats: { seat: number; alive: boolean; role: string }[];
  wolfChat?: { seat: number }[];
  wolfVotes?: { seat: number; confirmed?: boolean }[];
  votes?: { seat: number }[];
  runoff?: number[];
  speech?: { startSeat: number; spoken: number[] };
  speechDirection?: SpeechDirection;
  /* ---- RFC-022 警长/警徽（都是引擎折叠出来的公开派生字段） ---- */
  sheriffSeat?: number | null;
  sheriffSignups?: { seat: number; run: boolean }[];
  sheriffCandidates?: number[];
  sheriffWithdrawals?: { seat: number; withdraw: boolean }[];
  sheriffVoters?: number[];
  sheriffVotes?: { seat: number; target: number | 'abstain' }[];
  sheriffSpeech?: { spoken: number[] };
  sheriffRunoff?: number[];
  sheriffFinalSpeechDone?: boolean;
  sheriffOrder?: { startSeat: number; direction: SpeechDirection };
}

/** 按座位升序排列（警长相关集合在状态里不一定有序）。 */
function bySeat(a: number, b: number): number {
  return a - b;
}

/**
 * 非发言阶段「该谁行动」。
 *
 * 夜间按角色依次行动；白天投票按存活顺序找第一个还没投的人；
 * RFC-022 的竞选 / 警徽相位按各自的 cursor 找人。
 * 找不到就返回 `undefined`（编排层据此停下，而不是瞎猜一个席位）。
 */
export function nextActor(state: ActorState): number | undefined {
  const alive = state.seats.filter((seat) => seat.alive);

  switch (state.phase) {
    case 'NIGHT_WOLF_CHAT': {
      const spoken = new Set((state.wolfChat ?? []).map((entry) => entry.seat));
      return alive.find((seat) => seat.role === 'wolf' && !spoken.has(seat.seat))?.seat;
    }
    case 'NIGHT_WOLVES':
    case 'NIGHT_WOLF_RUNOFF': {
      // 投票：还没投的狼依次表态。**先手每夜轮换**，否则 1 号狼永远第一个投，
      // 其他狼没有「跟票」的体验（用户反馈）。
      const voted = new Set(
        (state.wolfVotes ?? []).filter((vote) => vote.confirmed !== false).map((vote) => vote.seat),
      );
      const wolves = alive.filter((seat) => seat.role === 'wolf');
      if (wolves.length === 0) return undefined;
      const start = Math.max(0, state.day ?? 0) % wolves.length;
      const ordered = [...wolves.slice(start), ...wolves.slice(0, start)];
      return ordered.find((seat) => !voted.has(seat.seat))?.seat;
    }
    case 'NIGHT_SEER':
      return alive.find((seat) => seat.role === 'seer')?.seat;
    case 'NIGHT_WITCH':
      return alive.find((seat) => seat.role === 'witch')?.seat;
    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      return state.seats.find((seat) => seat.role === 'hunter')?.seat;
    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF': {
      const voted = new Set((state.votes ?? []).map((vote) => vote.seat));
      return alive.find((seat) => !voted.has(seat.seat))?.seat;
    }

    /* ---- RFC-022：竞选 ---- */

    case 'DAY_SHERIFF_SIGNUP': {
      const signed = new Set((state.sheriffSignups ?? []).map((entry) => entry.seat));
      return alive.find((seat) => !signed.has(seat.seat))?.seat;
    }
    case 'DAY_SHERIFF_SPEECH':
    case 'DAY_SHERIFF_PK': {
      const eligible =
        state.phase === 'DAY_SHERIFF_PK'
          ? (state.sheriffRunoff ?? [])
          : (state.sheriffCandidates ?? []);
      const spoken = new Set(state.sheriffSpeech?.spoken ?? []);
      return [...eligible].sort(bySeat).find((seat) => !spoken.has(seat));
    }
    case 'DAY_SHERIFF_WITHDRAW': {
      const decided = new Set((state.sheriffWithdrawals ?? []).map((entry) => entry.seat));
      return [...(state.sheriffCandidates ?? [])].sort(bySeat).find((seat) => !decided.has(seat));
    }
    case 'DAY_SHERIFF_VOTE':
    case 'DAY_SHERIFF_RUNOFF': {
      const cast = new Set((state.sheriffVotes ?? []).map((vote) => vote.seat));
      return [...(state.sheriffVoters ?? [])].sort(bySeat).find((seat) => !cast.has(seat));
    }

    /* ---- RFC-022：警徽与警长权力 ---- */

    case 'DAY_BADGE_TRANSFER': {
      // 只有「已经死亡的警长」能移交/撕徽；活着的人不该拿到这个决策。
      const sheriff = state.sheriffSeat ?? null;
      if (sheriff === null) return undefined;
      return state.seats.some((seat) => seat.seat === sheriff && !seat.alive) ? sheriff : undefined;
    }
    case 'DAY_SHERIFF_ORDER':
    case 'DAY_SHERIFF_FINAL_SPEECH': {
      const sheriff = state.sheriffSeat ?? null;
      if (sheriff === null) return undefined;
      if (!state.seats.some((seat) => seat.seat === sheriff && seat.alive)) return undefined;
      if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH' && state.sheriffFinalSpeechDone === true) {
        return undefined;
      }
      return sheriff;
    }

    default:
      return undefined;
  }
}

/**
 * 相位 → 投影的 `pending`。
 *
 * 投影要靠它算 `legalTargets`；不传的话 `legalTargets` 是空的，AI 会以为无路可走。
 */
export function pendingForPhase(phase: string): PendingDecision | null {
  switch (phase) {
    case 'NIGHT_WOLF_CHAT':
      return 'chat';
    case 'NIGHT_WOLVES':
      return 'wolf-vote';
    case 'NIGHT_WOLF_RUNOFF':
      return 'wolf-runoff';
    case 'NIGHT_SEER':
      return 'check';
    case 'NIGHT_WITCH':
      return 'witch';
    case 'DAY_SPEECH':
    case 'DAY_PK_SPEECH':
      return 'speak';
    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF':
      return 'vote';
    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      return 'shoot';

    /* ---- RFC-022 ---- */
    case 'DAY_SHERIFF_SIGNUP':
      return 'sheriff-signup';
    case 'DAY_SHERIFF_SPEECH':
      return 'sheriff-speech';
    case 'DAY_SHERIFF_WITHDRAW':
      return 'sheriff-withdraw';
    case 'DAY_SHERIFF_VOTE':
      return 'sheriff-vote';
    case 'DAY_SHERIFF_PK':
      return 'sheriff-pk';
    case 'DAY_SHERIFF_RUNOFF':
      return 'sheriff-runoff';
    case 'DAY_BADGE_TRANSFER':
      return 'badge-transfer';
    case 'DAY_SHERIFF_ORDER':
      return 'sheriff-order';
    case 'DAY_SHERIFF_FINAL_SPEECH':
      return 'sheriff-final-speech';

    default:
      return null;
  }
}

/** 需要「说一句话」的相位。AI 的流式输出与降级都按这一集合判断。 */
const SPEECH_PHASES: ReadonlySet<string> = new Set<string>([
  'DAY_SPEECH',
  'DAY_PK_SPEECH',
  'DAY_SHERIFF_SPEECH',
  'DAY_SHERIFF_PK',
  'DAY_SHERIFF_FINAL_SPEECH',
]);

/** 该相位是否靠「发言」推进（含竞选发言与警长归票发言）。 */
export function isSpeechPhase(phase: string): boolean {
  return SPEECH_PHASES.has(phase);
}

/**
 * 玩家亲自行动的相位（RFC-012 AC-11 / RFC-022 §5）。
 *
 * 发言、各种投票、竞选表态、警徽移交与发言顺序都要等玩家；
 * 夜间动作仍由注入的 `decide` 代劳（目标选择属 RFC-013）。
 */
export function isPlayerPhase(phase: string): boolean {
  return (
    phase === 'DAY_SPEECH' ||
    phase === 'DAY_PK_SPEECH' ||
    phase === 'DAY_VOTE' ||
    phase === 'DAY_VOTE_RUNOFF' ||
    // 夜间行动也属于玩家：狼要讨论与刀人、神职要查验与用药。
    // 之前这些全由 `decide` 代劳，玩家当狼时会「一觉醒来天亮了」。
    phase === 'NIGHT_WOLF_CHAT' ||
    phase === 'NIGHT_WOLVES' ||
    phase === 'NIGHT_WOLF_RUNOFF' ||
    phase === 'NIGHT_SEER' ||
    phase === 'NIGHT_WITCH' ||
    // 出局后的开枪决定仍然属于玩家——哪怕他已经死了。
    phase === 'NIGHT_HUNTER_SHOOT' ||
    phase === 'DAY_HUNTER_SHOOT' ||
    // RFC-022：竞选、警徽、定序、归票。
    phase === 'DAY_SHERIFF_SIGNUP' ||
    phase === 'DAY_SHERIFF_SPEECH' ||
    phase === 'DAY_SHERIFF_WITHDRAW' ||
    phase === 'DAY_SHERIFF_VOTE' ||
    phase === 'DAY_SHERIFF_PK' ||
    phase === 'DAY_SHERIFF_RUNOFF' ||
    phase === 'DAY_BADGE_TRANSFER' ||
    phase === 'DAY_SHERIFF_ORDER' ||
    phase === 'DAY_SHERIFF_FINAL_SPEECH'
  );
}

/** 从状态推出「现在该谁说话」；不是发言阶段返回 `undefined`。 */
export function seatToSpeak(state: ActorState): number | undefined {
  // 竞选发言 / PK 发言 / 警长归票各有自己的 cursor，不复用白天的 `speech`（RFC-022 §13.2）。
  if (state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK') {
    const eligible =
      state.phase === 'DAY_SHERIFF_PK'
        ? (state.sheriffRunoff ?? [])
        : (state.sheriffCandidates ?? []);
    const spoken = new Set(state.sheriffSpeech?.spoken ?? []);
    return [...eligible].sort(bySeat).find((seat) => !spoken.has(seat));
  }
  if (state.phase === 'DAY_SHERIFF_FINAL_SPEECH') {
    const sheriff = state.sheriffSeat ?? null;
    if (sheriff === null || state.sheriffFinalSpeechDone === true) return undefined;
    return state.seats.some((seat) => seat.seat === sheriff && seat.alive) ? sheriff : undefined;
  }

  if (
    (state.phase !== 'DAY_SPEECH' && state.phase !== 'DAY_PK_SPEECH') ||
    state.speech === undefined
  ) {
    return undefined;
  }

  const alive = state.seats
    .filter((seat) => seat.alive)
    .filter((seat) => state.phase !== 'DAY_PK_SPEECH' || (state.runoff ?? []).includes(seat.seat))
    .map((seat) => seat.seat);
  const spoken = new Set(state.speech.spoken);
  // 从起点开始按存活顺序找第一个还没说的人（发言顺序由引擎的 startSeat 决定）。
  const pivot = alive.indexOf(state.speech.startSeat);
  const rotated = pivot === -1 ? alive : [...alive.slice(pivot), ...alive.slice(0, pivot)];
  // 警长可以选逆时针（RFC-022 §3.2）；顺序必须与引擎 `speechOrder` 完全一致，
  // 否则编排层会把「当前该 4 号」错算成 7 号，提交后被引擎拒绝。
  if (state.phase === 'DAY_SPEECH' && state.speechDirection === 'counterclockwise') {
    const first = rotated[0];
    return first === undefined
      ? undefined
      : [first, ...rotated.slice(1).reverse()].find((seat) => !spoken.has(seat));
  }
  return rotated.find((seat) => !spoken.has(seat));
}

/**
 * 新相位的「合法默认动作」（RFC-022 §13.5）。
 *
 * AI 没给出动作、或玩家超时/跳过时用它收尾，避免整局停在某个新相位上。
 * 返回 `undefined` 表示这个相位没有默认动作（编排层按旧逻辑停下）。
 */
export function defaultActionFor(
  state: ActorState,
  seat: number,
  ts = Date.now(),
): Action | undefined {
  switch (state.phase) {
    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      return { type: 'HUNTER_SHOOT', ts, seat: seat as never };
    case 'DAY_SHERIFF_SIGNUP':
      return { type: 'SHERIFF_SIGNUP', ts, seat: seat as never, run: false };
    case 'DAY_SHERIFF_SPEECH':
    case 'DAY_SHERIFF_PK':
    case 'DAY_SHERIFF_FINAL_SPEECH':
      return { type: 'SPEECH_SKIP', ts, seat: seat as never };
    case 'DAY_SHERIFF_WITHDRAW':
      return { type: 'SHERIFF_WITHDRAW', ts, seat: seat as never, withdraw: false };
    case 'DAY_SHERIFF_VOTE':
      return { type: 'SHERIFF_VOTE', ts, seat: seat as never, target: 'abstain' };
    case 'DAY_SHERIFF_RUNOFF': {
      const tied = [...(state.sheriffRunoff ?? [])].sort(bySeat);
      const first = tied[0];
      return first === undefined
        ? undefined
        : { type: 'SHERIFF_VOTE', ts, seat: seat as never, target: first as never };
    }
    case 'DAY_BADGE_TRANSFER':
      return { type: 'BADGE_TRANSFER', ts, seat: seat as never, target: 'tear' };
    case 'DAY_SHERIFF_ORDER': {
      // 没有可选顺序时由调用方停下，不猜一个非法起点。
      const option = sheriffOrderOptions(state as unknown as GameState)[0];
      return option === undefined
        ? undefined
        : {
            type: 'SHERIFF_ORDER',
            ts,
            seat: seat as never,
            startSeat: option.startSeat as never,
            direction: option.direction,
          };
    }
    default:
      return undefined;
  }
}

/**
 * 重读之后还要不要提交（B-R8-1）。
 *
 * **相位也要没变**：最后一位说完后相位会切到 `DAY_VOTE`，而投票的第一个行动者
 * 可能还是同一席位——只看「谁该行动」会重复提交一次。
 */
export function isStillTheirTurn(
  previousPhase: string,
  latest: Parameters<typeof seatToSpeak>[0] & Parameters<typeof nextActor>[0],
  seat: number,
): boolean {
  if (latest.phase !== previousPhase) return false;
  return (seatToSpeak(latest) ?? nextActor(latest)) === seat;
}

const BATCH_VOTE_PHASES = new Set([
  'DAY_VOTE',
  'DAY_VOTE_RUNOFF',
  'DAY_SHERIFF_VOTE',
  'DAY_SHERIFF_RUNOFF',
]);

/** 同时投票的 AI 席位：投票是暗投，彼此看不到，可以并发调用模型。 */
function batchVotersOf(state: GameState, playerSeat: number): number[] {
  if (state.phase === 'DAY_SHERIFF_VOTE' || state.phase === 'DAY_SHERIFF_RUNOFF') {
    return (state.sheriffVoters ?? []).filter(
      (seat) =>
        seat !== playerSeat && state.seats.some((entry) => entry.seat === seat && entry.alive),
    );
  }
  return state.seats
    .filter((seat) => seat.alive && seat.seat !== playerSeat)
    .map((seat) => seat.seat);
}

async function prefetchVotes(
  deps: OrchestratorDeps,
  record: GameRecord,
  state: GameState,
): Promise<Record<number, AgentDecision>> {
  const seats = batchVotersOf(state, record.playerSeat);
  const pairs = await Promise.all(
    seats.map(async (seat) => {
      try {
        const decision = await deps.decide({
          seat,
          ctx: project({
            state,
            events: record.events,
            observer: seat as never,
            pending: pendingForPhase(state.phase),
          }),
          phase: state.phase,
        });
        return [seat, decision] as const;
      } catch {
        return [seat, { action: undefined }] as const;
      }
    }),
  );
  const batch: Record<number, AgentDecision> = {};
  for (const [seat, decision] of pairs) batch[seat] = decision;
  return batch;
}

export async function runGame(deps: OrchestratorDeps): Promise<OrchestratorResult> {
  const { registry, session, input, decide } = deps;
  const maxSteps = deps.maxSteps ?? 500;
  const targetId = deps.gameId ?? session.gameIds[session.gameIds.length - 1] ?? '';
  const initial = await registry.getGame(targetId);
  if (initial === undefined) throw new Error('没有可推进的对局');
  let record: GameRecord = initial;

  let steps = 0;
  let skipped = 0;
  let voteBatch: Record<number, AgentDecision> | null = null;
  let voteBatchKey = '';

  while (steps < maxSteps) {
    // 每轮都从存储重读：路由可能刚写入了玩家的发言，用读前的旧记录提交会把它覆盖掉
    // （评审 C-113 的双写丢更新）。
    const fresh = await registry.getGame(record.gameId);
    if (fresh !== undefined) record = fresh;
    let state = registry.stateOf(record);
    if (state.phase === 'FINISHED') break;

    // 放逐/警长投票是同时暗投：所有 AI 席位并发调用模型，只把提交串行化。
    // 否则 8 个席位串行等待，总耗时是单次调用之和，倒计时会先归零。
    if (BATCH_VOTE_PHASES.has(state.phase)) {
      const key = `${state.phase}|${state.day}`;
      if (voteBatchKey !== key) {
        voteBatch = await prefetchVotes(deps, record, state);
        voteBatchKey = key;
        // 并发调用期间玩家可能已经投票并推进了相位；重读后再继续。
        const latest = await registry.getGame(record.gameId);
        if (latest !== undefined) record = latest;
        state = registry.stateOf(record);
        if (state.phase === 'FINISHED' || !BATCH_VOTE_PHASES.has(state.phase)) continue;
      }
    }

    /**
     * **每个席位看自己的投影**（SEC-5）。
     *
     * 把玩家的投影递给 AI，等于让 AI 看到玩家的角色与私有知识——这正是
     * 「AI 不作弊」要防的事。投影的 `observer` 必须是这条决策的席位。
     */
    const currentRecord = record;
    const ctxFor = (observer: number) =>
      project({
        state,
        events: currentRecord.events,
        observer: observer as never,
        pending: pendingForPhase(state.phase),
      });

    // 狼队讨论是**限时聊天室**（RUL-14）：不走「一人一句」的行动者循环，
    // 而是让 AI 队友发言/准备、等玩家自由聊天或时间到，再把相位推进到投票。
    if (state.phase === 'NIGHT_WOLF_CHAT') {
      record = await driveWolfChat(deps, record);
      steps += 1;
      continue;
    }

    const seat = seatToSpeak(state) ?? nextActor(state);
    if (seat === undefined) break;

    // 玩家触发点：白天发言（AC-11）与白天投票（AC-11 的「发言 → 投票」）。
    // 夜间的目标选择仍是另一套输入，先用注入的 `decide` 代劳。
    // 自由投票下，AI 的票之间留间隔，让玩家能看到票型逐条出现（RUL-15）。
    // 只有「玩家是狼且还没确认」时才放慢 AI 的票，让玩家看清票型跟票；
    // 玩家已确认（或玩家不是狼）就没必要再等，直接推进到夜晚结算。
    const playerIsWolf =
      state.seats.find((entry) => entry.seat === record.playerSeat)?.role === 'wolf' &&
      state.seats.find((entry) => entry.seat === record.playerSeat)?.alive === true;
    const playerConfirmed = (state.wolfVotes ?? []).some(
      (vote) => vote.seat === record.playerSeat && vote.confirmed !== false,
    );
    if (
      (state.phase === 'NIGHT_WOLVES' || state.phase === 'NIGHT_WOLF_RUNOFF') &&
      seat !== record.playerSeat &&
      playerIsWolf &&
      !playerConfirmed &&
      (deps.wolfVoteDelayMs ?? 0) > 0 &&
      (state.wolfVotes ?? []).some((vote) => vote.seat !== seat)
    ) {
      // 分段等待：玩家在这 1.2 秒内确认的话，立刻结束等待，不再等满。
      const until = Date.now() + (deps.wolfVoteDelayMs ?? 0);
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const latest = await registry.getGame(record.gameId);
        if (latest === undefined) break;
        const latestState = registry.stateOf(latest);
        if (latestState.phase !== state.phase) break;
        const confirmed = (latestState.wolfVotes ?? []).some(
          (vote) => vote.seat === record.playerSeat && vote.confirmed !== false,
        );
        if (confirmed) break;
      }
    }

    const playerPhase = isPlayerPhase(state.phase);
    const isAi = seat !== record.playerSeat;
    const speechPhase = isSpeechPhase(state.phase);
    if (isAi && speechPhase) {
      deps.output.thinking?.(seat as never, (record.events?.length ?? 0) + 1);
    }
    let degraded = false;
    let action: AgentDecision;
    if (!isAi && playerPhase) {
      action = await playerAction(seat, state.phase, deps, ctxFor(seat), record.gameId);
    } else {
      try {
        const cached = voteBatch?.[seat];
        if (cached !== undefined) delete voteBatch?.[seat];
        action =
          cached ??
          (await decide({
            seat,
            ctx: ctxFor(seat),
            phase: state.phase,
            ...(speechPhase
              ? {
                  onSpeechDelta: (text: string) =>
                    deps.output.emit({
                      seat: seat as never,
                      id: (record.events?.length ?? 0) + 1,
                      text,
                      final: false,
                    }),
                }
              : {}),
          }));
      } catch {
        if (speechPhase) {
          degraded = true;
          action = {
            action: {
              type: 'SPEECH',
              ts: Date.now(),
              seat: seat as never,
              text: degradeSentence(Date.now() % 4),
            },
          };
        } else {
          action = { action: undefined };
        }
      }
    }
    // RFC-022 §13.5：AI 没给动作时用合法默认动作收尾（上警=不上、退水=不退、
    // 警下投票=弃权、重投=第一个并列者、定序=第一个合法选项、归票=跳过、移交=撕徽）。
    // 玩家超时/跳过已经在 `playerAction` 里翻译成同一个默认动作。
    if (action.action === undefined) {
      const fallback = defaultActionFor(state, seat);
      if (fallback !== undefined) action = { action: fallback };
    }
    if (action.action === undefined) {
      // 玩家已被路由抢先确认/投票：重读后继续，不要停在旧回合上。
      if (state.phase === 'NIGHT_WOLVES' || state.phase === 'NIGHT_WOLF_RUNOFF') {
        steps += 1;
        continue;
      }
      // 有行动者却没有动作：说明 AI 没给出动作，不能静默停在这里。
      break;
    }

    // **提交前再读一次**：等玩家输入的那段时间里，路由可能已经写入了别的动作
    // （比如玩家自己 POST 上来的发言）。用等待前的 `record` 提交会把它覆盖掉（B-R6-1）。
    const latest = (await registry.getGame(record.gameId)) ?? record;
    // 等待期间玩家可能已经通过路由提交了这条发言。重读之后如果「该谁行动」变了，
    // 就不要再提交一次——否则会多出一条 `REJECTED / NOT_YOUR_TURN`（B-R7-1）。
    const latestState = registry.stateOf(latest);
    const stillTheirTurn = isStillTheirTurn(state.phase, latestState, seat);
    // 除了「该谁行动」之外，再显式检查「这个人是不是已经行动过了」：
    // 路由会先把玩家的票/发言写进事件流，再唤醒这里；只比 nextActor 在某些
    // 并发时序下仍可能拿到旧回合，导致重复提交一条 ALREADY_VOTED 把对局停住。
    const alreadyActed =
      ((state.phase === 'DAY_VOTE' || state.phase === 'DAY_VOTE_RUNOFF') &&
        (latestState.votes ?? []).some((vote) => vote.seat === seat)) ||
      ((state.phase === 'DAY_SPEECH' ||
        state.phase === 'DAY_PK_SPEECH' ||
        state.phase === 'DAY_SHERIFF_SPEECH' ||
        state.phase === 'DAY_SHERIFF_PK') &&
        (state.phase === 'DAY_SHERIFF_SPEECH' || state.phase === 'DAY_SHERIFF_PK'
          ? (latestState.sheriffSpeech?.spoken ?? []).includes(seat as never)
          : (latestState.speech?.spoken ?? []).includes(seat as never))) ||
      (state.phase === 'DAY_SHERIFF_FINAL_SPEECH' && latestState.sheriffFinalSpeechDone === true) ||
      (state.phase === 'DAY_SHERIFF_SIGNUP' &&
        (latestState.sheriffSignups ?? []).some((entry) => entry.seat === seat)) ||
      (state.phase === 'DAY_SHERIFF_WITHDRAW' &&
        (latestState.sheriffWithdrawals ?? []).some((entry) => entry.seat === seat)) ||
      ((state.phase === 'DAY_SHERIFF_VOTE' || state.phase === 'DAY_SHERIFF_RUNOFF') &&
        (latestState.sheriffVotes ?? []).some((vote) => vote.seat === seat)) ||
      (state.phase === 'NIGHT_WOLVES' &&
        (latestState.wolfVotes ?? []).some(
          (vote) => vote.seat === seat && vote.confirmed !== false,
        ));
    if (!stillTheirTurn || alreadyActed) {
      steps += 1;
      continue;
    }

    const result = await registry.submit(
      session,
      latest,
      action.action,
      registry.stateOf(latest).seq,
    );
    if (!result.ok) {
      // 版本冲突 = 别人（玩家路由请求或上一轮循环）刚提交过：重读即可，
      // 不能当成致命错误把整局停在这里。
      if (result.code === 'ALREADY_APPLIED') {
        steps += 1;
        continue;
      }
      break;
    }

    // 引擎拒绝了 AI/玩家的动作：不能当作成功继续，否则同一个非法动作会被反复提交
    // （真实对局里表现为「卡在某个相位」且日志刷屏）。直接抛出，让调用方看见。
    const rejected = result.events.find((event) => event.type === 'REJECTED');
    if (rejected !== undefined) {
      const payload = rejected.payload as { code?: string; message?: string };
      const detail = `${payload.code ?? 'REJECTED'}：${payload.message ?? ''}`;
      // AI 的动作被引擎拒绝：把原因回喂一次，让它换一个合法动作，而不是整局停住。
      if (seat !== record.playerSeat) {
        const retryState = registry.stateOf(result.record);
        const retryCtx = project({
          state: retryState,
          events: result.record.events ?? [],
          observer: seat as never,
          pending: pendingForPhase(state.phase),
        });
        const retry = await decide({
          seat,
          ctx: retryCtx,
          phase: state.phase,
          feedback: detail,
        });
        if (retry.action !== undefined) {
          const retryResult = await registry.submit(
            session,
            result.record,
            retry.action,
            retryState.seq,
          );
          const retryRejected =
            retryResult.ok && retryResult.events.some((event) => event.type === 'REJECTED');
          if (retryResult.ok && !retryRejected) {
            record = retryResult.record;
            steps += 1;
            continue;
          }
        }
      }
      // 玩家重复投票/发言是并发时序的正常结果，不是致命错误；重读后继续，
      // 让其余 AI 把这一轮走完。
      if (
        seat === record.playerSeat &&
        [
          'ALREADY_VOTED',
          'ALREADY_SPOKEN',
          'ALREADY_SIGNED_UP',
          'ALREADY_WITHDREW',
          'NOT_YOUR_TURN',
          'ALREADY_READY',
        ].includes(payload.code ?? '')
      ) {
        record = result.record;
        steps += 1;
        continue;
      }
      throw new Error(`动作被拒绝：${detail}`);
    }

    record = result.record;
    if (isAi && speechPhase && action.action?.type === 'SPEECH') {
      // 竞选发言的事件是 `SHERIFF_SPEECH`（RFC-022 §13.2），白天/归票仍是 `SPEECH`。
      const speechEvent = result.events.find(
        (event) => event.type === 'SPEECH' || event.type === 'SHERIFF_SPEECH',
      );
      if (speechEvent !== undefined) {
        deps.output.emit({
          seat: seat as never,
          id: speechEvent.seq,
          text: action.action.text,
          final: true,
        });
      }
    }
    if (degraded || action.degraded === true) {
      record = await registry.appendEvents(record, [
        {
          gameId: record.gameId,
          seq: record.events.length + 1,
          ts: Date.now(),
          type: 'DEGRADED',
          visibleTo: 'public',
          payload: { seat },
        },
      ]);
    }

    // 推理落盘（RFC-014 AC-3）：只写结构化 `reason`，供复盘逐条比对。
    if (action.thought !== undefined) {
      const decided = action.action;
      const rawTarget = 'target' in decided ? decided.target : undefined;
      // `AI_THOUGHT.target` 只接座位或弃权；`tear` 之类的选择走 `detail`（RFC-022 复盘）。
      const thoughtTarget =
        typeof rawTarget === 'number'
          ? rawTarget
          : rawTarget === 'abstain'
            ? 'abstain'
            : decided.type === 'SHERIFF_ORDER'
              ? decided.startSeat
              : undefined;
      const detail =
        decided.type === 'SHERIFF_SIGNUP'
          ? decided.run
            ? '上警'
            : '不上警'
          : decided.type === 'SHERIFF_WITHDRAW'
            ? decided.withdraw
              ? '退水'
              : '留在警上'
            : decided.type === 'BADGE_TRANSFER' && decided.target === 'tear'
              ? '撕毁警徽'
              : decided.type === 'SHERIFF_ORDER'
                ? `方向：${decided.direction}`
                : undefined;
      record = await registry.appendEvents(record, [
        {
          gameId: record.gameId,
          seq: record.events.length + 1,
          ts: Date.now(),
          type: 'AI_THOUGHT',
          visibleTo: `self:${seat}`,
          payload: {
            reason: action.thought.reason,
            decisionSeq: result.version,
            seat,
            phase: state.phase,
            decisionAction: decided.type,
            ...(thoughtTarget === undefined ? {} : { target: thoughtTarget }),
            ...(detail === undefined ? {} : { detail }),
            ...(action.thought.claim === undefined ? {} : { claim: action.thought.claim }),
          },
        } as EventEnvelope,
      ]);
    }

    steps += 1;
    if (action.action.type === 'SPEECH_SKIP') skipped += 1;
  }

  input.close();
  await deps.output.flush();

  return { record, steps, skipped };
}

/**
 * 玩家输入里表示「上警 / 退水」的词。
 *
 * 通道只传文本，所以这里定义唯一的文本协议：路由把按钮点击翻译成这些词，
 * 未来 UI 换文案时两条路径仍然一致。
 */
const RUN_WORDS: ReadonlySet<string> = new Set([
  'run',
  'yes',
  'y',
  '1',
  'true',
  '上警',
  '竞选',
  '参与',
]);
const WITHDRAW_WORDS: ReadonlySet<string> = new Set([
  'withdraw',
  'quit',
  'yes',
  'y',
  '1',
  'true',
  '退水',
  '退出',
]);

/** 玩家轮：问输入通道，把结果翻译成 action（AC-6 / AC-7）。 */
async function playerAction(
  seat: number,
  phase: string,
  deps: OrchestratorDeps,
  ctx: ProjectedContext,
  gameId: string,
): Promise<AgentDecision> {
  const now = deps.now ?? Date.now;
  // 玩家可能在「不是自己行动」的瞬间通过路由确认/投票；如果此时编排层正阻塞在
  // 等输入上，会一直等到超时。这里同时轮询「是否已经轮不到我 / 相位是否已变」。
  let settled = false;
  const stale = (async (): Promise<{ kind: 'stale'; text: '' }> => {
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (settled) break;
      const latest = await deps.registry.getGame(gameId);
      if (latest === undefined) return { kind: 'stale', text: '' };
      const latestState = deps.registry.stateOf(latest);
      const actor = seatToSpeak(latestState) ?? nextActor(latestState);
      if (latestState.phase !== phase || actor !== seat) return { kind: 'stale', text: '' };
    }
    return { kind: 'stale', text: '' };
  })();

  // 同步投票（放逐/警长）是全体共用一次截止时间；发言阶段则由 phaseTimer 按当前
  // 发言人重置。玩家轮到自己时，只能使用阶段/发言人剩余的时间，不能重新拿满。
  const timerRecord = await deps.registry.getGame(gameId);
  const liveTimer =
    timerRecord === undefined
      ? null
      : phaseTimer(timerRecord, phase, deps.phaseTimers ?? loadPhaseTimers());
  const timeoutMs =
    liveTimer === null
      ? (timeoutForPhase(phase, deps.phaseTimers ?? loadPhaseTimers()) ?? 120_000)
      : Math.max(0, liveTimer.remainingSeconds * 1000);

  const input = await Promise.race([
    deps.input.read({
      seat: seat as never,
      timeoutMs,
      kind:
        phase === 'DAY_VOTE' ||
        phase === 'DAY_VOTE_RUNOFF' ||
        phase === 'DAY_SHERIFF_VOTE' ||
        phase === 'DAY_SHERIFF_RUNOFF' ||
        phase === 'DAY_BADGE_TRANSFER'
          ? 'vote'
          : phase.startsWith('NIGHT') ||
              phase === 'DAY_SHERIFF_SIGNUP' ||
              phase === 'DAY_SHERIFF_WITHDRAW' ||
              phase === 'DAY_SHERIFF_ORDER'
            ? 'action'
            : 'speech',
    }),
    stale,
  ]);
  settled = true;
  if (input.kind === 'stale') return { action: undefined };

  /** 夜间目标：取玩家给的座位；没有/不合法就退化到投影里的第一个合法目标。 */
  const nightTarget = (): number | undefined => {
    const parsed = input.kind === 'skip' ? Number.NaN : Number.parseInt(input.text, 10);
    if (!Number.isNaN(parsed)) return parsed;
    return ctx.legalTargets
      .filter(
        (target) =>
          typeof target === 'number' &&
          target !== seat &&
          !ctx.knowledge.teammates.includes(target as never),
      )
      .map((target) => Number(target))[0];
  };

  if (phase === 'NIGHT_WOLF_CHAT') {
    // 讨论可以说，也可以不说；空消息同样算「发过言」，相位会继续推进。
    return {
      action: {
        type: 'WOLF_CHAT',
        ts: now(),
        seat: seat as never,
        text: input.kind === 'skip' ? '' : input.text,
      },
    };
  }

  if (phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF' || phase === 'NIGHT_SEER') {
    // 狼队投票 10 秒超时：普通轮按弃权；重投不能弃权，自动投第一个并列者。
    if (
      (phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF') &&
      (input.kind === 'timeout' || input.kind === 'skip')
    ) {
      // 只看「本夜」的票：上一夜的 WOLF_VOTE_CAST 还在 privateEvents 里。
      let nightStart = 0;
      ctx.privateEvents.forEach((event, index) => {
        if (event.type === 'WOLF_VOTE_REVEALED' || event.type === 'WOLF_KILL_CHOSEN') {
          nightStart = index + 1;
        }
      });
      const own = ctx.privateEvents
        .slice(nightStart)
        .find(
          (event) =>
            event.type === 'WOLF_VOTE_CAST' && (event.payload as { seat: number }).seat === seat,
        );
      if (own !== undefined) {
        return { action: { type: 'WOLF_VOTE_CONFIRM', ts: now(), seat: seat as never } };
      }
      const fallback =
        phase === 'NIGHT_WOLF_RUNOFF'
          ? (ctx.legalTargets.find((target) => typeof target === 'number') ?? 'abstain')
          : 'abstain';
      return {
        action: {
          type: 'WOLF_VOTE',
          ts: now(),
          seat: seat as never,
          target: fallback as never,
          confirmed: true,
        },
      };
    }
    if (
      (phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF') &&
      input.kind === 'speak' &&
      Number.isInteger(Number(input.text.trim()))
    ) {
      return {
        action: {
          type: 'WOLF_VOTE',
          ts: now(),
          seat: seat as never,
          target: Number(input.text.trim()) as never,
          confirmed: true,
        },
      };
    }
    const target = nightTarget();
    if (target === undefined) return { action: undefined };

    if (phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF') {
      return {
        action: { type: 'WOLF_VOTE', ts: now(), seat: seat as never, target: target as never },
      };
    }
    return {
      action: { type: 'SEER_CHECK', ts: now(), seat: seat as never, target: target as never },
    };
  }

  if (phase === 'NIGHT_WITCH') {
    // 文本格式：`none` / `heal:<seat>` / `poison:<seat>`；跳过等于不用药。
    if (input.kind === 'skip') {
      return { action: { type: 'WITCH_ACT', ts: now(), seat: seat as never, potion: 'none' } };
    }
    const [potion, rawTarget] = input.text.split(':');
    if (potion !== 'heal' && potion !== 'poison') {
      return { action: { type: 'WITCH_ACT', ts: now(), seat: seat as never, potion: 'none' } };
    }
    const target = Number.parseInt(rawTarget ?? '', 10);
    return {
      action: Number.isNaN(target)
        ? { type: 'WITCH_ACT', ts: now(), seat: seat as never, potion: 'none' }
        : {
            type: 'WITCH_ACT',
            ts: now(),
            seat: seat as never,
            potion,
            target: target as never,
          },
    };
  }

  if (phase === 'NIGHT_HUNTER_SHOOT' || phase === 'DAY_HUNTER_SHOOT') {
    const parsed = input.kind === 'skip' ? Number.NaN : Number.parseInt(input.text, 10);
    return {
      action: Number.isNaN(parsed)
        ? { type: 'HUNTER_SHOOT', ts: now(), seat: seat as never }
        : { type: 'HUNTER_SHOOT', ts: now(), seat: seat as never, target: parsed as never },
    };
  }

  /* ---- RFC-022：竞选 / 警徽 ---- */

  if (phase === 'DAY_SHERIFF_SIGNUP') {
    // 文本协议：`run` / `yes` / `1` / `上警` / `竞选` 表示上警；其余（含超时、跳过）默认不上警。
    const run =
      input.kind !== 'skip' &&
      input.kind !== 'timeout' &&
      RUN_WORDS.has(input.text.trim().toLowerCase());
    return { action: { type: 'SHERIFF_SIGNUP', ts: now(), seat: seat as never, run } };
  }

  if (phase === 'DAY_SHERIFF_WITHDRAW') {
    // 默认不退水（RFC-022 §13.5）；只有明确说「退水」才退。
    const withdraw =
      input.kind !== 'skip' &&
      input.kind !== 'timeout' &&
      WITHDRAW_WORDS.has(input.text.trim().toLowerCase());
    return { action: { type: 'SHERIFF_WITHDRAW', ts: now(), seat: seat as never, withdraw } };
  }

  if (phase === 'DAY_SHERIFF_VOTE' || phase === 'DAY_SHERIFF_RUNOFF') {
    const parsed = input.kind === 'skip' ? Number.NaN : Number.parseInt(input.text, 10);
    const legal = ctx.legalTargets.filter((target) => typeof target === 'number').map(Number);

    if (phase === 'DAY_SHERIFF_RUNOFF') {
      // 重投不能弃权：跳过/非法输入 → 第一个并列者（RFC-022 §13.5）。
      const target = legal.includes(parsed) ? parsed : legal[0];
      if (target === undefined) return { action: undefined };
      return {
        action: { type: 'SHERIFF_VOTE', ts: now(), seat: seat as never, target: target as never },
      };
    }

    // 首轮可以弃权；非候选目标按弃权处理，避免把必被拒绝的动作交给引擎。
    const target = legal.includes(parsed) ? parsed : 'abstain';
    return {
      action: {
        type: 'SHERIFF_VOTE',
        ts: now(),
        seat: seat as never,
        target: target as never,
      },
    };
  }

  if (phase === 'DAY_BADGE_TRANSFER') {
    const text = input.kind === 'skip' ? 'tear' : input.text.trim().toLowerCase();
    if (text === '' || text === 'tear' || text === '撕徽' || text === '撕警徽') {
      return { action: { type: 'BADGE_TRANSFER', ts: now(), seat: seat as never, target: 'tear' } };
    }
    const parsed = Number.parseInt(text, 10);
    const legal = ctx.legalTargets.filter((target) => typeof target === 'number').map(Number);
    return {
      action: {
        type: 'BADGE_TRANSFER',
        ts: now(),
        seat: seat as never,
        // 默认撕徽：非法目标不交给引擎（超时语义 → 撕徽，RFC-022 §13.5）。
        target: (legal.includes(parsed) ? parsed : 'tear') as never,
      },
    };
  }

  if (phase === 'DAY_SHERIFF_ORDER') {
    const raw = input.kind === 'skip' ? '' : input.text;
    const [rawStart, rawDirection] = raw.split(':');
    const start = Number.parseInt(rawStart ?? '', 10);
    const direction =
      rawDirection?.trim() === 'counterclockwise' || rawDirection?.trim() === '逆时针'
        ? 'counterclockwise'
        : rawDirection?.trim() === 'clockwise' || rawDirection?.trim() === '顺时针'
          ? 'clockwise'
          : undefined;
    const options = ctx.sheriffOrderOptions ?? [];
    const matched =
      options.find(
        (option) =>
          option.startSeat === start && (direction === undefined || option.direction === direction),
      ) ?? options.find((option) => option.startSeat === start);
    // 没有合法输入时沿用无警长默认（引擎算出的第一个合法选项，RFC-022 §13.5）。
    const chosen = matched ?? options[0];
    if (chosen === undefined) return { action: undefined };
    return {
      action: {
        type: 'SHERIFF_ORDER',
        ts: now(),
        seat: seat as never,
        startSeat: chosen.startSeat as never,
        direction: chosen.direction,
      },
    };
  }

  if (phase === 'DAY_VOTE' || phase === 'DAY_VOTE_RUNOFF') {
    // 投票轮把「目标席位」放在同一个 `text` 字段里；空 → 弃权。
    const parsed = input.kind === 'skip' ? Number.NaN : Number.parseInt(input.text, 10);

    // RUL-2：重投不能弃权，只能投并列者。玩家跳过时替他选一个并列者，
    // 否则会提交 abstain 被引擎拒绝（以前表现为整局中断）。
    if (phase === 'DAY_VOTE_RUNOFF' && Number.isNaN(parsed)) {
      const tied = ctx.legalTargets
        .filter((candidate) => typeof candidate === 'number')
        .map((candidate) => Number(candidate));
      if (tied.length > 0) {
        return {
          action: { type: 'VOTE', ts: now(), seat: seat as never, target: tied[0] as never },
        };
      }
    }

    return {
      action: {
        type: 'VOTE',
        ts: now(),
        seat: seat as never,
        target: (Number.isNaN(parsed) ? 'abstain' : parsed) as never,
      },
    };
  }

  if (input.kind === 'skip') {
    return { action: { type: 'SPEECH_SKIP', ts: now(), seat: seat as never } };
  }

  return {
    action: { type: 'SPEECH', ts: now(), seat: seat as never, text: input.text },
    speech: input.text,
  };
}

/**
 * 狼队讨论（RUL-14）：限时聊天室。
 *
 * - AI 队友开局各说一句；`wolfReadyMs` 之后自动准备（生产 5 秒，测试可为 0）。
 * - 玩家通过路由自由发言；每收到一条新消息，AI 队友会基于更新后的上下文回一句。
 * - 讨论到时（默认 50 秒）或玩家说「准备完成」后，未准备者由服务端代为准备。
 *
 * 计时只在这里发生，引擎保持纯函数（ARCH-4）。
 */
async function driveWolfChat(deps: OrchestratorDeps, initial: GameRecord): Promise<GameRecord> {
  const { registry, session } = deps;
  const chatMs = deps.wolfChatMs ?? 50_000;
  const readyMs = deps.wolfReadyMs ?? 0;
  const aiReady = deps.wolfAiReady ?? 'auto';
  let readyNudged = false;
  const startedAt = (deps.now ?? Date.now)();
  let record = initial;

  const playerSeat = registry.stateOf(record).seats.find((seat) => seat.isPlayer)?.seat;
  const playerIsWolf =
    playerSeat !== undefined &&
    registry
      .stateOf(record)
      .seats.some((seat) => seat.seat === playerSeat && seat.alive && seat.role === 'wolf');
  const aiWolves = () =>
    registry
      .stateOf(record)
      .seats.filter((seat) => seat.alive && seat.role === 'wolf' && !seat.isPlayer)
      .map((seat) => seat.seat);

  const submit = async (seat: number, action: Action): Promise<void> => {
    record = (await registry.getGame(record.gameId)) ?? record;
    const state = registry.stateOf(record);
    if (state.phase !== 'NIGHT_WOLF_CHAT') return;
    const result = await registry.submit(session, record, action as never, state.seq);
    if (result.ok) record = result.record;
  };

  const chatFromAi = async (seat: number): Promise<void> => {
    // 每次都用**最新**聊天室记录重新投影：否则模型看到的是讨论开始前的快照。
    const current = registry.stateOf(record);
    const decision = await deps.decide({
      seat,
      ctx: project({
        state: current,
        events: record.events ?? [],
        observer: seat as never,
        pending: 'chat',
      }),
      phase: 'NIGHT_WOLF_CHAT',
    });
    if (decision.action?.type === 'WOLF_CHAT') await submit(seat, decision.action);
    if (decision.action?.type === 'WOLF_READY') await submit(seat, decision.action);
  };

  const markReady = async (seat: number): Promise<void> => {
    await submit(seat, { type: 'WOLF_READY', ts: (deps.now ?? Date.now)(), seat: seat as never });
  };

  // 开场：每名 AI 狼说一句
  for (const seat of aiWolves()) await chatFromAi(seat);

  // AI 准备计时（生产 5 秒；测试 0 立即）
  const readyTimer =
    aiReady === 'model' || readyMs <= 0
      ? null
      : setTimeout(() => {
          void (async () => {
            for (const seat of aiWolves()) await markReady(seat);
          })();
        }, readyMs);

  if (aiReady === 'auto' && readyMs <= 0) {
    for (const seat of aiWolves()) await markReady(seat);
  }

  // 真实模型：每当有狼发言就重新思考；同一结论不重复刷屏（每个 AI 最多 3 条）。
  const lastSpeech: Record<number, string> = {};
  for (const entry of registry.stateOf(record).wolfChat ?? []) {
    lastSpeech[entry.seat] = entry.text;
  }
  const aiMessages: Record<number, number> = {};
  let lastChatSeq = Math.max(0, ...(record.events ?? []).map((event) => event.seq));

  const reconsider = async (seat: number, author: number): Promise<void> => {
    if (author === seat) return;
    if ((aiMessages[seat] ?? 0) >= 3 && author !== playerSeat) return;
    const current = registry.stateOf(record);
    const decision = await deps.decide({
      seat,
      ctx: project({
        state: current,
        events: record.events ?? [],
        observer: seat as never,
        pending: 'chat',
      }),
      phase: 'NIGHT_WOLF_CHAT',
    });
    if (decision.action?.type === 'WOLF_READY') {
      await submit(seat, decision.action);
      return;
    }
    if (decision.action?.type !== 'WOLF_CHAT') return;
    const text = decision.action.text.trim();
    if (text === '' || text === lastSpeech[seat]) return;
    lastSpeech[seat] = text;
    aiMessages[seat] = (aiMessages[seat] ?? 0) + 1;
    await submit(seat, decision.action);
  };

  try {
    for (;;) {
      record = (await registry.getGame(record.gameId)) ?? record;
      const state = registry.stateOf(record);
      if (state.phase !== 'NIGHT_WOLF_CHAT') break;

      for (const event of record.events ?? []) {
        if (event.seq <= lastChatSeq) continue;
        if (event.type !== 'WOLF_CHAT_POSTED') continue;
        lastChatSeq = event.seq;
        const author = (event.payload as { seat: number }).seat;
        for (const seat of aiWolves()) await reconsider(seat, author);
        record = (await registry.getGame(record.gameId)) ?? record;
        if (registry.stateOf(record).phase !== 'NIGHT_WOLF_CHAT') break;
      }
      if (registry.stateOf(record).phase !== 'NIGHT_WOLF_CHAT') break;
      if (lastChatSeq === 0) {
        lastChatSeq = Math.max(0, ...(record.events ?? []).map((event) => event.seq));
      }

      const elapsed = (deps.now ?? Date.now)() - startedAt;
      if (!playerIsWolf) {
        // 玩家不是狼：狼队讨论是 AI 之间的事，不让玩家干等；
        // AI 之间的互相回应由上面的 chat 扫描处理。
        if (elapsed >= chatMs) {
          for (const seat of registry
            .stateOf(record)
            .seats.filter((entry) => entry.alive && entry.role === 'wolf')
            .map((entry) => entry.seat)) {
            await markReady(seat);
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // 真实模型的明确准备点：讨论过半时问一次「还有新意见吗？没有就 ready」。
      if (aiReady === 'model' && !readyNudged && elapsed >= Math.min(8_000, chatMs / 2)) {
        readyNudged = true;
        for (const seat of aiWolves()) {
          const current = registry.stateOf(record);
          if ((current.wolfReady ?? []).includes(seat as never)) continue;
          const decision = await deps.decide({
            seat,
            ctx: project({
              state: current,
              events: record.events ?? [],
              observer: seat as never,
              pending: 'chat',
            }),
            phase: 'NIGHT_WOLF_CHAT',
            instruction:
              '讨论时间已过半。现在明确表态：如果还有新的意见，输出 action=chat 并在 speech 里说明；否则输出 action=ready 表示准备完成。',
          });
          if (decision.action?.type === 'WOLF_CHAT') await submit(seat, decision.action);
          await markReady(seat);
        }
        record = (await registry.getGame(record.gameId)) ?? record;
        if (registry.stateOf(record).phase !== 'NIGHT_WOLF_CHAT') break;
      }

      if (elapsed >= chatMs) {
        // 讨论超时：未准备者视为准备完成（用户裁定）。
        for (const seat of registry
          .stateOf(record)
          .seats.filter((entry) => entry.alive && entry.role === 'wolf')
          .map((entry) => entry.seat)) {
          await markReady(seat);
        }
        break;
      }

      const chatsBefore = (record.events ?? []).filter(
        (event) =>
          event.type === 'WOLF_CHAT_POSTED' &&
          (event.payload as { seat: number }).seat === playerSeat,
      ).length;

      const input = await deps.input.read({
        seat: playerSeat as never,
        timeoutMs: 200,
        kind: 'action',
      });

      record = (await registry.getGame(record.gameId)) ?? record;
      if (registry.stateOf(record).phase !== 'NIGHT_WOLF_CHAT') break;

      if (input.kind === 'timeout') continue;
      if (input.kind === 'skip') {
        if (playerSeat !== undefined) await markReady(playerSeat);
        continue;
      }

      // 玩家发了一条消息：如果路由还没写进事件流（测试通道），这里补写；
      // 路由已写的话不能重复写第二条。
      const alreadyWritten =
        (record.events ?? []).filter(
          (event) =>
            event.type === 'WOLF_CHAT_POSTED' &&
            (event.payload as { seat: number }).seat === playerSeat,
        ).length > chatsBefore;

      if (playerSeat !== undefined && !alreadyWritten) {
        await submit(playerSeat, {
          type: 'WOLF_CHAT',
          ts: (deps.now ?? Date.now)(),
          seat: playerSeat as never,
          text: input.text,
        });
      }
    }
  } finally {
    if (readyTimer !== null) clearTimeout(readyTimer);
  }

  return record;
}
