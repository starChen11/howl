import type { GameState, Phase, SeatId } from '@shared/domain';

import type { EventDraft } from '../step';
import type { ActionHandlerFor } from '../step';
import { applyEffects } from '../effects';
import { DEATH_APPLIERS, deathCauseOf, resolveHunterShot, resolveNight } from '../resolve/deaths';
import { aliveSeats, findAliveByRole, isAlive, seatAt } from '../queries';
import { rejectionDraft } from '../reject';
import { checkWin } from '../win';

/**
 * 夜晚子阶段与行动校验（RFC-003 §2.2 / §2.3）。
 *
 * 阶段图（夜聊由 RFC-005 填，本 RFC 跳过）：
 *
 * ```
 * NIGHT_WOLF_CHAT → NIGHT_WOLVES → NIGHT_SEER → NIGHT_WITCH
 *   → NIGHT_RESOLVE → (NIGHT_HUNTER_SHOOT | DAY_ANNOUNCE | FINISHED)
 * ```
 *
 * 三条贯穿全文件的规则：
 * 1. **拒绝一律走 `Rejected` 事件**，不抛业务异常（RFC-002 §2.3）；
 * 2. `code` 是机械判据：阶段对但提交者不是该阶段的行动者 → `NOT_YOUR_TURN`；
 *    目标不合法 → `TARGET_NOT_ALIVE` / `WOLF_KILL_WOLF` / `WITCH_SELF_SAVE`；
 *    药已用过 → `POTION_ALREADY_USED`。**阶段不对**由 `step` 统一判成 `PHASE_MISMATCH`；
 * 3. 相位推进一律产出 `PHASE_CHANGED`（RFC-003 D-1），包括「witch 选 none」这种无事发生的转移。
 */

/**
 * 本夜的结算参数。
 *
 * 刀口通常已经在状态里（`WOLF_KILL_CHOSEN` 折叠过），但**这一次 wolf 行动也可能直接触发结算**
 * ——当 seer 与 witch 都已出局时，这次下刀之后就是 `NIGHT_RESOLVE`，而那条 `WOLF_KILL_CHOSEN` 还只是
 * 草稿、尚未折叠。所以调用方必须把「本次刚产出的刀口」显式传进来，不能只读状态。
 */
function nightParams(
  state: GameState,
  extra: { killTarget?: SeatId; healTarget?: SeatId; poisonTarget?: SeatId } = {},
) {
  const killTarget = extra.killTarget ?? state.night?.killTarget;
  return {
    ...(killTarget === undefined ? {} : { killTarget }),
    ...(extra.healTarget === undefined ? {} : { healTarget: extra.healTarget }),
    ...(extra.poisonTarget === undefined ? {} : { poisonTarget: extra.poisonTarget }),
  };
}

/** 下一个还要走的夜晚阶段；跳过的条件是「该身份已出局」（RFC-003 §2.2）。 */
function nextAfterWolves(state: GameState): Phase {
  if (findAliveByRole(state, 'seer') !== undefined) return 'NIGHT_SEER';
  if (findAliveByRole(state, 'witch') !== undefined) return 'NIGHT_WITCH';
  return 'NIGHT_RESOLVE';
}

function nextAfterSeer(state: GameState): Phase {
  return findAliveByRole(state, 'witch') !== undefined ? 'NIGHT_WITCH' : 'NIGHT_RESOLVE';
}

/**
 * 夜晚结算 + 相位终点（RFC-003 §2.3 第 4–8 步）。
 *
 * 产出的草稿顺序就是规则顺序：
 * `PHASE_CHANGED(→NIGHT_RESOLVE)` → `PLAYER_DIED*` →（`GAME_ENDED` 或 `PHASE_CHANGED(→…)`）。
 *
 * 为什么 `PLAYER_DIED` 是 `server` 可见性：死因（刀 / 毒）在真实规则里**不公开**，天亮只公布
 * 「谁死了」。公开广播由 RFC-004 的 `DAY_STARTED.diedLastNight` 承担，那里没有 `cause`，
 * 不会泄漏。
 */
function finishNight(
  from: Phase,
  state: GameState,
  extra: { killTarget?: SeatId; healTarget?: SeatId; poisonTarget?: SeatId } = {},
): EventDraft[] {
  const resolution = resolveNight(nightParams(state, extra));

  const drafts: EventDraft[] = [
    { type: 'PHASE_CHANGED', visibleTo: 'public', payload: { from, to: 'NIGHT_RESOLVE' } },
  ];

  for (const death of resolution.deaths) {
    drafts.push({
      type: 'PLAYER_DIED',
      visibleTo: 'server',
      payload: { seat: death.seat, cause: death.cause },
    });
  }

  // 第 5 步：死亡应用完毕后立刻判胜负（RUL-1）。已分出胜负 → 对局结束，不进开枪阶段。
  const afterDeaths = applyEffects(state, resolution.effects, DEATH_APPLIERS);
  const win = checkWin(afterDeaths);
  if (win !== null) {
    drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
    return drafts;
  }

  // 第 6 步：被狼刀出局的 hunter 进入开枪阶段；被毒杀的不进（FR-17）。
  const hunterKilledByWolf = resolution.deaths.some(
    (death) => death.cause === 'wolf' && seatAt(state, death.seat).role === 'hunter',
  );

  drafts.push({
    type: 'PHASE_CHANGED',
    visibleTo: 'public',
    payload: {
      from: 'NIGHT_RESOLVE',
      to: hunterKilledByWolf ? 'NIGHT_HUNTER_SHOOT' : 'DAY_ANNOUNCE',
    },
  });

  return drafts;
}

/** 结束当前夜晚阶段：要么推进到下一个夜阶段，要么（已是最后一个）进入结算。 */
function advanceOrFinish(
  state: GameState,
  from: Phase,
  next: Phase,
  extra?: { killTarget?: SeatId },
) {
  return next === 'NIGHT_RESOLVE'
    ? finishNight(from, state, extra)
    : [
        {
          type: 'PHASE_CHANGED' as const,
          visibleTo: 'public' as const,
          payload: { from, to: next },
        },
      ];
}

/** `WOLF_KILL`（`NIGHT_WOLVES`）。 */
const wolfKill: ActionHandlerFor<'WOLF_KILL'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (!actor.alive || actor.role !== 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 wolf，不能在夜间下刀`,
        seat: action.seat,
      }),
    ];
  }
  if (!isAlive(state, action.target)) {
    return [
      rejectionDraft({
        action,
        code: 'TARGET_NOT_ALIVE',
        message: `座位 ${action.target} 已出局，不能作为刀口`,
        seat: action.seat,
      }),
    ];
  }
  if (seatAt(state, action.target).role === 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'WOLF_KILL_WOLF',
        message: `座位 ${action.target} 是狼队友，不能刀`,
        seat: action.seat,
      }),
    ];
  }

  return [
    { type: 'WOLF_KILL_CHOSEN', visibleTo: 'wolves', payload: { target: action.target } },
    ...advanceOrFinish(state, 'NIGHT_WOLVES', nextAfterWolves(state), {
      killTarget: action.target,
    }),
  ];
};

/** `SEER_CHECK`（`NIGHT_SEER`）。 */
const seerCheck: ActionHandlerFor<'SEER_CHECK'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (!actor.alive || actor.role !== 'seer') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 seer`,
        seat: action.seat,
      }),
    ];
  }
  if (!isAlive(state, action.target)) {
    return [
      rejectionDraft({
        action,
        code: 'TARGET_NOT_ALIVE',
        message: `座位 ${action.target} 已出局，不能查验`,
        seat: action.seat,
      }),
    ];
  }

  const isWolf = seatAt(state, action.target).role === 'wolf';

  return [
    {
      type: 'SEER_CHECKED',
      visibleTo: 'seer',
      payload: { target: action.target, result: isWolf ? 'wolf' : 'not-wolf' },
    },
    ...advanceOrFinish(state, 'NIGHT_SEER', nextAfterSeer(state)),
  ];
};

/** `WITCH_ACT`（`NIGHT_WITCH`）。 */
const witchAct: ActionHandlerFor<'WITCH_ACT'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (!actor.alive || actor.role !== 'witch') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 witch`,
        seat: action.seat,
      }),
    ];
  }

  const used = state.potionsUsed ?? { heal: false, poison: false };

  if (action.potion === 'none') {
    return finishNight('NIGHT_WITCH', state);
  }

  if (action.potion === 'heal') {
    if (action.target === action.seat) {
      return [
        rejectionDraft({
          action,
          code: 'WITCH_SELF_SAVE',
          message: 'witch 不能对自己使用解药（FR-17）',
          seat: action.seat,
        }),
      ];
    }
    if (used.heal) {
      return [
        rejectionDraft({
          action,
          code: 'POTION_ALREADY_USED',
          message: '解药已经用过了（整局限一次）',
          seat: action.seat,
        }),
      ];
    }
    if (!isAlive(state, action.target)) {
      return [
        rejectionDraft({
          action,
          code: 'TARGET_NOT_ALIVE',
          message: `座位 ${action.target} 已出局，不能用解药`,
          seat: action.seat,
        }),
      ];
    }

    return [
      {
        type: 'WITCH_POTION_USED',
        visibleTo: 'witch',
        payload: { potion: 'heal', target: action.target },
      },
      ...finishNight('NIGHT_WITCH', state, { healTarget: action.target }),
    ];
  }

  if (used.poison) {
    return [
      rejectionDraft({
        action,
        code: 'POTION_ALREADY_USED',
        message: '毒药已经用过了（整局限一次）',
        seat: action.seat,
      }),
    ];
  }
  if (!isAlive(state, action.target)) {
    return [
      rejectionDraft({
        action,
        code: 'TARGET_NOT_ALIVE',
        message: `座位 ${action.target} 已出局，不能毒`,
        seat: action.seat,
      }),
    ];
  }

  return [
    {
      type: 'WITCH_POTION_USED',
      visibleTo: 'witch',
      payload: { potion: 'poison', target: action.target },
    },
    ...finishNight('NIGHT_WITCH', state, { poisonTarget: action.target }),
  ];
};

/** `HUNTER_SHOOT`（`NIGHT_HUNTER_SHOOT`）。 */
const hunterShoot: ActionHandlerFor<'HUNTER_SHOOT'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (actor.role !== 'hunter' || actor.alive) {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是刚出局的 hunter`,
        seat: action.seat,
      }),
    ];
  }

  if (action.target !== undefined && !isAlive(state, action.target)) {
    return [
      rejectionDraft({
        action,
        code: 'TARGET_NOT_ALIVE',
        message: `座位 ${action.target} 已出局，不能开枪带走`,
        seat: action.seat,
      }),
    ];
  }

  const shot = resolveHunterShot(action.target);
  const drafts: EventDraft[] = [
    {
      type: 'HUNTER_SHOOT',
      visibleTo: 'public',
      payload: { seat: action.seat, target: action.target ?? null },
    },
  ];

  for (const death of shot.deaths) {
    drafts.push({
      type: 'PLAYER_DIED',
      visibleTo: 'server',
      payload: { seat: death.seat, cause: death.cause },
    });
  }

  // 第 7 步：开枪结算完成后再判一次（RUL-1）。死因必须是 'shoot'——顺手用它把效果的
  // `cause` 与事件里的 `cause` 绑在一起，避免两处写死两个字符串。
  for (const effect of shot.effects) {
    deathCauseOf(effect);
  }

  const afterShot = applyEffects(state, shot.effects, DEATH_APPLIERS);
  const win = checkWin(afterShot);
  if (win !== null) {
    drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
    return drafts;
  }

  drafts.push({
    type: 'PHASE_CHANGED',
    visibleTo: 'public',
    payload: { from: 'NIGHT_HUNTER_SHOOT', to: 'DAY_ANNOUNCE' },
  });
  return drafts;
};

/** RFC-003 交付的夜晚 handler 表。`step` 把它并进默认表。 */
export const NIGHT_HANDLERS = {
  WOLF_KILL: wolfKill,
  SEER_CHECK: seerCheck,
  WITCH_ACT: witchAct,
  HUNTER_SHOOT: hunterShoot,
} as const;

/** 派生查询：当前该谁行动（RFC-011 的玩家视角会用到；本 RFC 只在测试里用）。 */
export function nightActorOf(state: GameState): SeatId | undefined {
  switch (state.phase) {
    case 'NIGHT_WOLVES':
      return aliveSeats(state).find((seat) => seat.role === 'wolf')?.seat;
    case 'NIGHT_SEER':
      return findAliveByRole(state, 'seer')?.seat;
    case 'NIGHT_WITCH':
      return findAliveByRole(state, 'witch')?.seat;
    default:
      return undefined;
  }
}
