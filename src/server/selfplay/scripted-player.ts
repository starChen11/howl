import type { Action } from '@shared/actions';
import type { SeatId } from '@shared/domain';
import type { ProjectedContext } from '@shared/project';

/**
 * 玩家席位的脚本策略（RFC-015 §2.2 / Q-015-1）。
 *
 * 它只做一件事：**从投影给出的合法目标里随机挑一个**。目的是跑通流程，不是模拟人类。
 * 关键约束：它必须只产出合法行动——如果产出了引擎拒绝的行动，那是我们的实现缺陷，
 * 要被单独归类（AC-6），而不是算成模型失败。
 */

/** 可注入的随机源：默认由种子派生，测试里给固定序列。 */
export type Rng = () => number;

/**
 * 由种子派生的确定性随机源（mulberry32）。
 *
 * `selfplay` 必须可复现：同一个 `--seed` 跑两次要得到同一批对局（DATA-5 / C-188）。
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScriptedPlayerOptions {
  rng?: Rng;
}

function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

export function scriptedPlayerAction(
  ctx: ProjectedContext,
  options: ScriptedPlayerOptions = {},
): Action | undefined {
  const rng = options.rng ?? mulberry32(ctx.self.seat);
  const seat = ctx.self.seat;
  const targets = ctx.legalTargets
    .filter((target) => typeof target === 'number')
    .map((target) => Number(target) as SeatId);

  switch (ctx.pending) {
    case 'speak':
      return { type: 'SPEECH_SKIP', ts: Date.now(), seat };

    case 'vote': {
      // 弃权是合法的（RUL-7）；重投不能弃权（引擎只给并列者，清单里没有 'abstain'）。
      const canAbstain = ctx.legalTargets.some((target) => target === 'abstain');
      if (canAbstain && rng() < 0.2) {
        return { type: 'VOTE', ts: Date.now(), seat, target: 'abstain' };
      }
      const target = pick(targets, rng);
      return target === undefined
        ? canAbstain
          ? { type: 'VOTE', ts: Date.now(), seat, target: 'abstain' }
          : undefined
        : { type: 'VOTE', ts: Date.now(), seat, target };
    }

    case 'kill': {
      const target = pick(targets, rng);
      return target === undefined ? undefined : { type: 'WOLF_KILL', ts: Date.now(), seat, target };
    }

    case 'check': {
      const target = pick(targets, rng);
      return target === undefined
        ? undefined
        : { type: 'SEER_CHECK', ts: Date.now(), seat, target };
    }

    case 'shoot': {
      const target = pick(targets, rng);
      return target === undefined
        ? { type: 'HUNTER_SHOOT', ts: Date.now(), seat }
        : { type: 'HUNTER_SHOOT', ts: Date.now(), seat, target };
    }

    case 'witch': {
      // 一半概率用药，一半不用；用药时随便挑一个目标。
      if (rng() < 0.5) return { type: 'WITCH_ACT', ts: Date.now(), seat, potion: 'none' };
      const target = pick(targets, rng);
      if (target === undefined) return { type: 'WITCH_ACT', ts: Date.now(), seat, potion: 'none' };
      return {
        type: 'WITCH_ACT',
        ts: Date.now(),
        seat,
        potion: rng() < 0.5 ? 'heal' : 'poison',
        target,
      };
    }

    default:
      // `null`（没有待决策）时，由编排层自己处理；这里不猜。
      return undefined;
  }
}

/**
 * 任意席位的合法策略（给 selfplay 的**假 AI** 用）。
 *
 * 与玩家策略同一套取舍逻辑，但会把狼刀的目标限制在队友之外——投影给的清单不替引擎
 * 做这个判断（`targets.ts` 的注释写明了），所以这里补上。
 */
export function legalActionFor(
  ctx: ProjectedContext,
  rng: Rng = mulberry32(ctx.day + ctx.self.seat),
): Action | undefined {
  const seat = ctx.self.seat;
  const teammates = new Set(ctx.knowledge.teammates);
  const targets = ctx.legalTargets
    .filter((target) => typeof target === 'number')
    .map((target) => Number(target) as SeatId)
    .filter((target) => target !== seat && !teammates.has(target));

  const pickOne = (): SeatId | undefined => {
    if (targets.length === 0) return undefined;
    return targets[Math.min(targets.length - 1, Math.floor(rng() * targets.length))];
  };

  switch (ctx.pending) {
    case 'speak':
      return { type: 'SPEECH_SKIP', ts: Date.now(), seat };
    case 'vote': {
      if (ctx.legalTargets.some((target) => target === 'abstain')) {
        return { type: 'VOTE', ts: Date.now(), seat, target: 'abstain' };
      }
      const target = pickOne();
      return target === undefined ? undefined : { type: 'VOTE', ts: Date.now(), seat, target };
    }
    case 'kill':
    case 'wolf-vote':
    case 'wolf-runoff': {
      const target = pickOne();
      if (target === undefined) return undefined;
      return ctx.pending === 'kill'
        ? { type: 'WOLF_KILL', ts: Date.now(), seat, target }
        : { type: 'WOLF_VOTE', ts: Date.now(), seat, target };
    }
    case 'check':
    case 'shoot': {
      const target = pickOne();
      if (ctx.pending === 'shoot') {
        return target === undefined
          ? { type: 'HUNTER_SHOOT', ts: Date.now(), seat }
          : { type: 'HUNTER_SHOOT', ts: Date.now(), seat, target };
      }
      return target === undefined
        ? undefined
        : { type: 'SEER_CHECK', ts: Date.now(), seat, target };
    }
    case 'witch': {
      const target = pickOne();
      if (target === undefined) return { type: 'WITCH_ACT', ts: Date.now(), seat, potion: 'none' };
      return { type: 'WITCH_ACT', ts: Date.now(), seat, potion: 'poison', target };
    }
    default:
      return undefined;
  }
}
