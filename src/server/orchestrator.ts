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

/** 投影里「该谁行动」的席位。 */
export function seatToAct(ctx: ProjectedContext): number | undefined {
  if (ctx.pending === 'speak') {
    // 投影已经把「轮到谁」写进 legalTargets 之外的公开事件里；用 speech 游标判断。
    const spoken = ctx.publicEvents
      .filter((event) => event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED')
      .map((event) => (event.payload as { seat?: number }).seat)
      .filter((seat): seat is number => typeof seat === 'number');
    const alive = ctx.aliveSeats;
    return alive.find((seat) => !spoken.includes(seat));
  }

  return undefined;
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
    const state = registry.stateOf(record);
    if (state.phase === 'FINISHED') break;

    const ctx = project({
      state,
      events: record.events,
      observer: record.playerSeat as number as never,
      pending: null as PendingDecision | null,
    });

    const seat = seatToAct(ctx);
    if (seat === undefined) {
      // 不是发言轮：交给 AI（或玩家）按当前阶段行动，这里用 decide 统一处理。
      const decision = await decide({ seat: record.playerSeat, ctx });
      if (decision.action === undefined) break;
      const result = await registry.submit(session, record, decision.action, state.seq);
      if (!result.ok) break;
      record = result.record;
      steps += 1;
      continue;
    }

    const action =
      seat === record.playerSeat ? await playerAction(seat, deps) : await decide({ seat, ctx });
    if (action.action === undefined) break;

    const result = await registry.submit(session, record, action.action, state.seq);
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
