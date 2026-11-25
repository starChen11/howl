import type { Action } from '@shared/actions';
import type { Phase, SeatId } from '@shared/domain';

import type { Decision } from './schema';

/**
 * 决策 → 引擎动作（RFC-006 §2.3）。
 *
 * **纯函数**：不读时钟、不读状态以外的输入。`ts` 由调用方在执行前填。
 *
 * 不合法的组合返回 `{ reject }` 而不是抛错：调用方据此产出 `Rejected` 事件，对局继续
 * （这是「AI 说了一句废话」而不是「服务端崩了」）。
 */

export interface DecisionContext {
  seat: SeatId;
  phase: Phase;
  day: number;
  legalTargets: (SeatId | 'abstain')[];
}

/** AI 单轮发言上限，与 PRD FR-30 / RFC-006 §2.2 的 300 字一致。 */
export const SPEECH_LIMIT = 300;

export type DecisionResult = { action: Action } | { reject: string };

const REQUIRED_TARGET: ReadonlySet<Decision['action']> = new Set([
  'kill',
  'check',
  'heal',
  'poison',
  'vote',
]);

/** 决策需要的阶段。用它把「动作与阶段不匹配」挡在引擎之外。 */
function phaseAllows(action: Decision['action'], ctx: DecisionContext): boolean {
  switch (action) {
    case 'ready':
      return ctx.phase === 'NIGHT_WOLF_CHAT';
    case 'kill':
      // 狼队投票有普通轮与重投两个相位（RUL-13）
      return ctx.phase === 'NIGHT_WOLVES' || ctx.phase === 'NIGHT_WOLF_RUNOFF';
    case 'check':
      return ctx.phase === 'NIGHT_SEER';
    case 'heal':
    case 'poison':
    case 'none':
      return ctx.phase === 'NIGHT_WITCH';
    case 'vote':
    case 'abstain':
      return ctx.phase === 'DAY_VOTE' || ctx.phase === 'DAY_VOTE_RUNOFF';
    case 'speak':
    case 'skip':
      return ctx.phase === 'DAY_SPEECH' || ctx.phase === 'DAY_PK_SPEECH';
    case 'shoot':
      return ctx.phase === 'NIGHT_HUNTER_SHOOT' || ctx.phase === 'DAY_HUNTER_SHOOT';
    case 'expose':
      return (
        ctx.phase === 'DAY_SPEECH' || ctx.phase === 'DAY_PK_SPEECH' || ctx.phase === 'DAY_VOTE'
      );
    case 'chat':
      return ctx.phase === 'NIGHT_WOLF_CHAT';
    default:
      return false;
  }
}

export function toAction(decision: Decision, ctx: DecisionContext, ts: number): DecisionResult {
  if (!phaseAllows(decision.action, ctx)) {
    return { reject: `阶段 ${ctx.phase} 不接受动作 ${decision.action}` };
  }

  if (decision.action === 'shoot') {
    // 开枪者可以选择不开枪（目标缺省）；有目标时必须合法。
    if (decision.target === undefined) {
      return { action: { type: 'HUNTER_SHOOT', ts, seat: ctx.seat } };
    }
    if (!ctx.legalTargets.includes(decision.target as SeatId)) {
      return { reject: `目标 ${decision.target} 不在本阶段的合法清单里` };
    }
    return {
      action: { type: 'HUNTER_SHOOT', ts, seat: ctx.seat, target: decision.target as SeatId },
    };
  }

  if (REQUIRED_TARGET.has(decision.action)) {
    const target = decision.target;
    if (target === undefined) {
      return { reject: `动作 ${decision.action} 缺少 target` };
    }
    if (!ctx.legalTargets.includes(target as SeatId)) {
      return { reject: `目标 ${target} 不在本阶段的合法清单里` };
    }
    return { action: buildWithTarget(decision.action, target as SeatId, ctx, ts) };
  }

  switch (decision.action) {
    case 'abstain':
      // RUL-2：重投阶段不能弃权。引擎会拒绝，但在这里挡掉，AI 才能知道自己「说了个
      // 不允许的动作」，而不是收到一条笼统的 Rejected。
      if (ctx.phase === 'DAY_VOTE_RUNOFF') {
        return { reject: '重投阶段不能弃权（RUL-2）' };
      }
      return { action: { type: 'VOTE', ts, seat: ctx.seat, target: 'abstain' } };
    case 'none':
      return { action: { type: 'WITCH_ACT', ts, seat: ctx.seat, potion: 'none' } };
    case 'speak': {
      const text = decision.speech;
      // 空发言等于没说话，拒绝；**超长则截断**（RFC §2.2）——因为啰嗦不该让整条决策作废。
      if (text === undefined || text.length === 0) {
        return { reject: 'speak 缺少非空 speech' };
      }
      return { action: { type: 'SPEECH', ts, seat: ctx.seat, text: text.slice(0, SPEECH_LIMIT) } };
    }
    case 'skip':
      return { action: { type: 'SPEECH_SKIP', ts, seat: ctx.seat } };
    case 'ready':
      return { action: { type: 'WOLF_READY', ts, seat: ctx.seat } };
    case 'expose':
      return { action: { type: 'SELF_EXPOSE', ts, seat: ctx.seat } };
    case 'chat':
      return { action: { type: 'WOLF_CHAT', ts, seat: ctx.seat, text: decision.speech ?? '' } };
    default:
      return { reject: `不支持的动作 ${String(decision.action)}` };
  }
}

function buildWithTarget(
  action: Decision['action'],
  target: SeatId,
  ctx: DecisionContext,
  ts: number,
): Action {
  switch (action) {
    case 'kill':
      // RUL-13：夜间下刀已经改成狼队投票。模型仍然输出 `kill`（提示词的最小改动），
      // 这里按相位翻译成「投给某席位」而不是直接下刀。
      return ctx.phase === 'NIGHT_WOLVES' || ctx.phase === 'NIGHT_WOLF_RUNOFF'
        ? { type: 'WOLF_VOTE', ts, seat: ctx.seat, target }
        : { type: 'WOLF_KILL', ts, seat: ctx.seat, target };
    case 'check':
      return { type: 'SEER_CHECK', ts, seat: ctx.seat, target };
    case 'heal':
      return { type: 'WITCH_ACT', ts, seat: ctx.seat, potion: 'heal', target };
    case 'poison':
      return { type: 'WITCH_ACT', ts, seat: ctx.seat, potion: 'poison', target };
    case 'vote':
      return { type: 'VOTE', ts, seat: ctx.seat, target };
    case 'shoot':
      return { type: 'HUNTER_SHOOT', ts, seat: ctx.seat, target };
    default:
      throw new Error(`动作 ${action} 不该带 target`);
  }
}
