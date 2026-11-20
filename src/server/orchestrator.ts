import type { Action } from '@shared/actions';
import type { InputChannel, OutputChannel } from '@shared/channels';
import type { EventEnvelope } from '@shared/events';
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
  /** 这一轮的推理；落成 `AI_THOUGHT` 事件供复盘展示（RFC-014）。 */
  thought?: { reason: string; claim?: unknown } | undefined;
}

export interface OrchestratorDeps {
  registry: GameRegistry;
  session: SessionRecord;
  /** 要推进的对局；省略时取会话里最后一个（旧行为）。 */
  gameId?: string;
  input: InputChannel;
  output: OutputChannel;
  /** AI 的决策来源；测试注入脚本。`phase` 是引擎真实相位（投影把夜间折叠了）。 */
  decide: (input: { seat: number; ctx: ProjectedContext; phase: string }) => Promise<AgentDecision>;
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
  wolfVotes?: { seat: number }[];
  votes?: { seat: number }[];
}): number | undefined {
  const alive = state.seats.filter((seat) => seat.alive);

  switch (state.phase) {
    case 'NIGHT_WOLF_CHAT': {
      const spoken = new Set((state.wolfChat ?? []).map((entry) => entry.seat));
      return alive.find((seat) => seat.role === 'wolf' && !spoken.has(seat.seat))?.seat;
    }
    case 'NIGHT_WOLVES':
    case 'NIGHT_WOLF_RUNOFF': {
      // 投票：还没投的狼依次表态
      const voted = new Set((state.wolfVotes ?? []).map((vote) => vote.seat));
      return alive.find((seat) => seat.role === 'wolf' && !voted.has(seat.seat))?.seat;
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
      return 'speak';
    case 'DAY_VOTE':
    case 'DAY_VOTE_RUNOFF':
      return 'vote';
    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      return 'shoot';
    default:
      return null;
  }
}

/**
 * 玩家亲自行动的相位（RFC-012 AC-11）。
 *
 * 发言与两种投票都要等玩家；夜间动作仍由注入的 `decide` 代劳（目标选择属 RFC-013）。
 */
export function isPlayerPhase(phase: string): boolean {
  return (
    phase === 'DAY_SPEECH' ||
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
    phase === 'DAY_HUNTER_SHOOT'
  );
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
  const targetId = deps.gameId ?? session.gameIds[session.gameIds.length - 1] ?? '';
  const initial = await registry.getGame(targetId);
  if (initial === undefined) throw new Error('没有可推进的对局');
  let record: GameRecord = initial;

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
        pending: pendingForPhase(state.phase),
      });

    const seat = seatToSpeak(state) ?? nextActor(state);
    if (seat === undefined) break;

    // 玩家触发点：白天发言（AC-11）与白天投票（AC-11 的「发言 → 投票」）。
    // 夜间的目标选择仍是另一套输入，先用注入的 `decide` 代劳。
    const playerPhase = isPlayerPhase(state.phase);
    const action =
      seat === record.playerSeat && playerPhase
        ? await playerAction(seat, state.phase, deps, ctxFor(seat))
        : await decide({ seat, ctx: ctxFor(seat), phase: state.phase });
    if (action.action === undefined) {
      // 有行动者却没有动作：开枪阶段可以由我们替它放弃（规则允许）；
      // 其他相位说明 AI 没给出动作，不能静默停在这里。
      if (state.phase === 'NIGHT_HUNTER_SHOOT' || state.phase === 'DAY_HUNTER_SHOOT') {
        const decline = await registry.submit(
          session,
          (await registry.getGame(record.gameId)) ?? record,
          { type: 'HUNTER_SHOOT', ts: Date.now(), seat: seat as never },
          registry.stateOf((await registry.getGame(record.gameId)) ?? record).seq,
        );
        if (!decline.ok) break;
        record = decline.record;
        steps += 1;
        continue;
      }
      break;
    }

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
      throw new Error(`动作被拒绝：${payload.code ?? 'REJECTED'}（${payload.message ?? ''}）`);
    }

    record = result.record;

    // 推理落盘（RFC-014 AC-3）：只写结构化 `reason`，供复盘逐条比对。
    if (action.thought !== undefined) {
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

/** 玩家轮：问输入通道，把结果翻译成 action（AC-6 / AC-7）。 */
async function playerAction(
  seat: number,
  phase: string,
  deps: OrchestratorDeps,
  ctx: ProjectedContext,
): Promise<AgentDecision> {
  const now = deps.now ?? Date.now;
  const input = await deps.input.read({
    seat: seat as never,
    timeoutMs: 60_000,
    kind:
      phase === 'DAY_VOTE' || phase === 'DAY_VOTE_RUNOFF'
        ? 'vote'
        : phase.startsWith('NIGHT')
          ? 'action'
          : 'speech',
  });

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
