import type { Action } from '@shared/actions';
import type { InputChannel, OutputChannel } from '@shared/channels';
import type { PendingDecision, ProjectedContext } from '@shared/project';

import { project } from './project';
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
}

export interface OrchestratorDeps {
  registry: GameRegistry;
  session: SessionRecord;
  input: InputChannel;
  output: OutputChannel;
  /** AI 的决策来源；测试注入脚本。 */
  decide: (input: { seat: number; ctx: ProjectedContext }) => Promise<AgentDecision>;
  /** 提前结束（测试用）。 */
  maxSteps?: number;
  now?: () => number;
}

export interface OrchestratorResult {
  record: GameRecord;
  steps: number;
  /** 玩家超时/弃权的轮次（AC-7 的复盘依据）。 */
  skipped: number;
}

/**
 * 非发言阶段「该谁行动」。
 *
 * 夜间按角色依次行动；白天投票按存活顺序找第一个还没投的人。
 * 找不到就返回 `undefined`（编排层据此停下，而不是瞎猜一个席位）。
 */
export function nextActor(state: {
  phase: string;
  seats: { seat: number; alive: boolean; role: string }[];
  wolfChat?: { seat: number }[];
  votes?: { seat: number }[];
}): number | undefined {
  const alive = state.seats.filter((seat) => seat.alive);

  switch (state.phase) {
    case 'NIGHT_WOLF_CHAT': {
      const spoken = new Set((state.wolfChat ?? []).map((entry) => entry.seat));
      return alive.find((seat) => seat.role === 'wolf' && !spoken.has(seat.seat))?.seat;
    }
    case 'NIGHT_WOLVES':
      return alive.find((seat) => seat.role === 'wolf')?.seat;
    case 'NIGHT_SEER':
      return alive.find((seat) => seat.role === 'seer')?.seat;
    case 'NIGHT_WITCH':
      return alive.find((seat) => seat.role === 'witch')?.seat;
    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF': {
      const voted = new Set((state.votes ?? []).map((vote) => vote.seat));
      return alive.find((seat) => !voted.has(seat.seat))?.seat;
    }
    default:
      return undefined;
  }
}

/** 从状态推出「现在该谁说话」；不是发言阶段返回 `undefined`。 */
export function seatToSpeak(state: {
  phase: string;
  speech?: { startSeat: number; spoken: number[] };
  seats: { seat: number; alive: boolean }[];
}): number | undefined {
  if (state.phase !== 'DAY_SPEECH' || state.speech === undefined) return undefined;

  const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
  const spoken = new Set(state.speech.spoken);
  // 从起点开始按存活顺序找第一个还没说的人（发言顺序由引擎的 startSeat 决定）。
  const ordered = [
    ...alive.slice(alive.indexOf(state.speech.startSeat)),
    ...alive.slice(0, alive.indexOf(state.speech.startSeat)),
  ];
  return ordered.find((seat) => !spoken.has(seat));
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

export async function runGame(deps: OrchestratorDeps): Promise<OrchestratorResult> {
  const { registry, session, input, decide } = deps;
  const maxSteps = deps.maxSteps ?? 500;
  let record = (await registry.getGame(session.gameIds[session.gameIds.length - 1] ?? '')) as
    GameRecord | undefined;
  if (record === undefined) throw new Error('没有可推进的对局');

  let steps = 0;
  let skipped = 0;

  while (steps < maxSteps) {
    // 每轮都从存储重读：路由可能刚写入了玩家的发言，用读前的旧记录提交会把它覆盖掉
    // （评审 C-113 的双写丢更新）。
    const fresh = await registry.getGame(record.gameId);
    if (fresh !== undefined) record = fresh;
    const state = registry.stateOf(record);
    if (state.phase === 'FINISHED') break;

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
        pending: state.phase === 'DAY_SPEECH' ? ('speak' as PendingDecision) : null,
      });

    const seat = seatToSpeak(state) ?? nextActor(state);
    if (seat === undefined) break;

    // 白天的发言才问玩家；夜间的目标选择是另一套输入（RFC-012 的界面），
    // 这一层先用注入的 `decide` 代劳，避免把「选目标」伪装成「说话」。
    const action =
      seat === record.playerSeat && state.phase === 'DAY_SPEECH'
        ? await playerAction(seat, deps)
        : await decide({ seat, ctx: ctxFor(seat) });
    if (action.action === undefined) break;

    // **提交前再读一次**：等玩家输入的那段时间里，路由可能已经写入了别的动作
    // （比如玩家自己 POST 上来的发言）。用等待前的 `record` 提交会把它覆盖掉（B-R6-1）。
    const latest = (await registry.getGame(record.gameId)) ?? record;
    // 等待期间玩家可能已经通过路由提交了这条发言。重读之后如果「该谁行动」变了，
    // 就不要再提交一次——否则会多出一条 `REJECTED / NOT_YOUR_TURN`（B-R7-1）。
    const latestState = registry.stateOf(latest);
    const stillTheirTurn = isStillTheirTurn(state.phase, latestState, seat);
    if (!stillTheirTurn) {
      steps += 1;
      continue;
    }

    const result = await registry.submit(
      session,
      latest,
      action.action,
      registry.stateOf(latest).seq,
    );
    if (!result.ok) break;
    record = result.record;
    steps += 1;
    if (action.action.type === 'SPEECH_SKIP') skipped += 1;
  }

  input.close();
  await deps.output.flush();

  return { record, steps, skipped };
}

/** 玩家轮：问输入通道，把结果翻译成 action（AC-6 / AC-7）。 */
async function playerAction(seat: number, deps: OrchestratorDeps): Promise<AgentDecision> {
  const now = deps.now ?? Date.now;
  const input = await deps.input.read({
    seat: seat as never,
    timeoutMs: 60_000,
    kind: 'speech',
  });

  if (input.kind === 'skip') {
    return { action: { type: 'SPEECH_SKIP', ts: now(), seat: seat as never } };
  }

  return {
    action: { type: 'SPEECH', ts: now(), seat: seat as never, text: input.text },
    speech: input.text,
  };
}
