import type { GameState, Phase, SeatId } from '@shared/domain';

import type { ActionHandlerFor, EventDraft, HandlerContext } from '../step';
import { applyEffects } from '../effects';
import { phaseChangedDraft } from './visibility';
import { resolveHunterShot, resolveNight } from '../resolve/deaths';
import { aliveSeats, findAliveByRole, isAlive, seatAt } from '../queries';
import { rejectionDraft } from '../reject';
import { enterNight } from './vote';
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

/** 本夜的结算参数：三个目标都已在 `state.night` 里（自动阶段开始时已折叠）。 */
function nightParams(state: GameState) {
  const { killTarget, healTarget, poisonTarget } = state.night ?? {};
  return {
    ...(killTarget === undefined ? {} : { killTarget }),
    ...(healTarget === undefined ? {} : { healTarget }),
    ...(poisonTarget === undefined ? {} : { poisonTarget }),
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
/**
 * `NIGHT_RESOLVE` 的自动推进（RFC-004 的 B 方案）。
 *
 * 它**只在状态里读**本夜的目标：刀口来自 `WOLF_KILL_CHOSEN`、解药/毒药来自 `WITCH_POTION_USED`，
 * 此时都已经折叠进 `state.night`。RFC-003 时代需要把「本次 action 刚选的目标」作为参数传进来，
 * 因为那条事件还只是草稿；自动阶段把这一步省掉了。
 *
 * 产出顺序就是规则顺序（RFC-003 §2.3 第 4–8 步）：
 * `PLAYER_DIED*` →（`GAME_ENDED` 或 `PHASE_CHANGED(→…)`）。
 */
export function resolveNightEntry(state: GameState, context: HandlerContext): EventDraft[] {
  const resolution = resolveNight(nightParams(state));
  const drafts: EventDraft[] = [];

  for (const death of resolution.deaths) {
    drafts.push({
      type: 'PLAYER_DIED',
      visibleTo: 'server',
      payload: { seat: death.seat, cause: death.cause },
    });
  }

  // 第 5 步：死亡应用完毕后立刻判胜负（RUL-1）。已分出胜负 → 对局结束，不进开枪阶段。
  const afterDeaths = applyEffects(state, resolution.effects, context.appliers);
  const win = checkWin(afterDeaths);
  if (win !== null) {
    drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
    return drafts;
  }

  // 第 6 步：被刀出局的 hunter 进入开枪阶段；被毒杀的不进（FR-17）。
  const hunterKilledByWolf = resolution.deaths.some(
    (death) => death.cause === 'wolf' && seatAt(state, death.seat).role === 'hunter',
  );

  drafts.push(
    phaseChangedDraft('NIGHT_RESOLVE', hunterKilledByWolf ? 'NIGHT_HUNTER_SHOOT' : 'DAY_ANNOUNCE'),
  );

  return drafts;
}

/** 推进到下一个夜晚阶段（或者进入自动结算阶段 `NIGHT_RESOLVE`）。 */
function advanceOrFinish(from: Phase, next: Phase): EventDraft[] {
  return [phaseChangedDraft(from, next)];
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
    ...advanceOrFinish('NIGHT_WOLVES', nextAfterWolves(state)),
  ];
};

/** 狼队投票的唱票结果（RUL-13）。 */
function tallyWolfVotes(
  state: GameState,
  cast: { seat: SeatId; target: SeatId | 'abstain' },
): { winner?: SeatId; tied?: SeatId[]; allAbstain?: boolean } {
  const wolves = aliveSeats(state).filter((seat) => seat.role === 'wolf');
  const votes = [...(state.wolfVotes ?? []), cast];
  if (votes.length < wolves.length) return {};

  const counts = new Map<SeatId, number>();
  for (const vote of votes) {
    if (vote.target === 'abstain') continue;
    counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
  }

  if (counts.size === 0) return { allAbstain: true };

  const max = Math.max(...counts.values());
  const tied = [...counts.entries()]
    .filter(([, count]) => count === max)
    .map(([seat]) => seat)
    .sort((a, b) => a - b);

  const only = tied[0];
  if (tied.length === 1 && only !== undefined) return { winner: only };

  // 僵局兜底：重投仍未收缩（每人各投一票）时，取并列者里席位最小的那个。
  // 没有这条，三狼各执一词会永远投下去（RUL-13 的兜底条款）。
  const candidates = state.wolfRunoff;
  if (
    state.phase === 'NIGHT_WOLF_RUNOFF' &&
    candidates !== undefined &&
    tied.length === candidates.length
  ) {
    const first = tied[0];
    if (first !== undefined) return { winner: first };
  }

  return { tied };
}

/** `WOLF_VOTE`（`NIGHT_WOLVES` / `NIGHT_WOLF_RUNOFF`）：狼队投票决定今晚刀谁。 */
const wolfVote: ActionHandlerFor<'WOLF_VOTE'> = (state, action) => {
  const actor = seatAt(state, action.seat);
  if (!actor.alive || actor.role !== 'wolf') {
    return [
      rejectionDraft({
        action,
        code: 'NOT_YOUR_TURN',
        message: `座位 ${action.seat} 不是存活的 wolf，不能参与狼队投票`,
        seat: action.seat,
      }),
    ];
  }

  if ((state.wolfVotes ?? []).some((vote) => vote.seat === action.seat)) {
    return [
      rejectionDraft({
        action,
        code: 'WOLF_VOTE_DUPLICATE',
        message: `座位 ${action.seat} 本轮已经投过票`,
        seat: action.seat,
      }),
    ];
  }

  if (action.target === 'abstain') {
    if (state.phase === 'NIGHT_WOLF_RUNOFF') {
      return [
        rejectionDraft({
          action,
          code: 'INVALID_RUNOFF_TARGET',
          message: '重投不能弃权，只能投并列者',
          seat: action.seat,
        }),
      ];
    }
    const castAbstain = { seat: action.seat, target: 'abstain' as const };
    const outcome = tallyWolfVotes(state, castAbstain);
    const drafts: EventDraft[] = [
      { type: 'WOLF_VOTE_CAST', visibleTo: 'wolves', payload: castAbstain },
    ];
    if (outcome.winner !== undefined) {
      drafts.push(
        {
          type: 'WOLF_VOTE_REVEALED',
          visibleTo: 'wolves',
          payload: { votes: [...(state.wolfVotes ?? []), castAbstain] },
        },
        { type: 'WOLF_KILL_CHOSEN', visibleTo: 'wolves', payload: { target: outcome.winner } },
        phaseChangedDraft(state.phase, nextAfterWolves(state)),
      );
      return drafts;
    }
    if (outcome.tied === undefined && outcome.winner === undefined && outcome.allAbstain === true) {
      // 全员弃权：这一夜没有刀口，直接进入下一相位。
      drafts.push(
        {
          type: 'WOLF_VOTE_REVEALED',
          visibleTo: 'wolves',
          payload: { votes: [...(state.wolfVotes ?? []), castAbstain] },
        },
        phaseChangedDraft(state.phase, nextAfterWolves(state)),
      );
      return drafts;
    }
    if (outcome.tied !== undefined) {
      drafts.push(
        {
          type: 'WOLF_VOTE_REVEALED',
          visibleTo: 'wolves',
          payload: {
            votes: [...(state.wolfVotes ?? []), castAbstain],
            tied: outcome.tied,
          },
        },
        phaseChangedDraft(state.phase, 'NIGHT_WOLF_RUNOFF'),
      );
    }
    return drafts;
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

  if (
    state.phase === 'NIGHT_WOLF_RUNOFF' &&
    state.wolfRunoff !== undefined &&
    !state.wolfRunoff.includes(action.target)
  ) {
    return [
      rejectionDraft({
        action,
        code: 'INVALID_RUNOFF_TARGET',
        message: `重投只能投并列者（${state.wolfRunoff.join(', ')}），收到 ${String(action.target)}`,
        seat: action.seat,
      }),
    ];
  }

  const cast = { seat: action.seat, target: action.target as SeatId | 'abstain' };
  const outcome = tallyWolfVotes(state, cast);
  const drafts: EventDraft[] = [{ type: 'WOLF_VOTE_CAST', visibleTo: 'wolves', payload: cast }];

  if (outcome.tied !== undefined && outcome.winner === undefined) {
    drafts.push(
      {
        type: 'WOLF_VOTE_REVEALED',
        visibleTo: 'wolves',
        payload: {
          votes: [...(state.wolfVotes ?? []), cast],
          tied: outcome.tied,
        },
      },
      phaseChangedDraft(state.phase, 'NIGHT_WOLF_RUNOFF'),
    );
    return drafts;
  }

  const winner = outcome.winner;
  if (winner === undefined) return drafts;

  drafts.push(
    {
      type: 'WOLF_VOTE_REVEALED',
      visibleTo: 'wolves',
      payload: { votes: [...(state.wolfVotes ?? []), cast] },
    },
    { type: 'WOLF_KILL_CHOSEN', visibleTo: 'wolves', payload: { target: winner } },
    phaseChangedDraft(state.phase, nextAfterWolves(state)),
  );
  return drafts;
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
    ...advanceOrFinish('NIGHT_SEER', nextAfterSeer(state)),
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
    return advanceOrFinish('NIGHT_WITCH', 'NIGHT_RESOLVE');
  }

  if (action.potion === 'heal') {
    // 顺序有意义：「药已经没了」比「你不能对自己用」更根本——前者的返回在两种错误同时
    // 成立时更可操作（评审 N10）。
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
      ...advanceOrFinish('NIGHT_WITCH', 'NIGHT_RESOLVE'),
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
    ...advanceOrFinish('NIGHT_WITCH', 'NIGHT_RESOLVE'),
  ];
};

/** `HUNTER_SHOOT`（`NIGHT_HUNTER_SHOOT`）。 */
const hunterShoot: ActionHandlerFor<'HUNTER_SHOOT'> = (state, action, context) => {
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
      // 夜里开枪的死因不公开（天亮一并公布，见 RFC-003 §9.1）；白天开枪是公开动作，
      // 连带死亡也公开（RFC-004 §2.4 / C-29 的 N9 提醒）。
      visibleTo: state.phase === 'DAY_HUNTER_SHOOT' ? 'public' : 'server',
      payload: { seat: death.seat, cause: death.cause },
    });
  }

  // 第 7 步：开枪结算完成后再判一次（RUL-1）。
  const afterShot = applyEffects(state, shot.effects, context.appliers);
  const win = checkWin(afterShot);
  if (win !== null) {
    drafts.push({ type: 'GAME_ENDED', visibleTo: 'public', payload: win });
    return drafts;
  }

  // 收尾取决于**开枪发生在哪个阶段**（RFC-004 §2.4 引入白天开枪）：
  // 夜间开枪 → 天亮；白天开枪（放逐后）→ 入夜。
  if (state.phase === 'DAY_HUNTER_SHOOT') {
    drafts.push(...enterNight('DAY_HUNTER_SHOOT'));
    return drafts;
  }

  drafts.push(phaseChangedDraft('NIGHT_HUNTER_SHOOT', 'DAY_ANNOUNCE'));
  return drafts;
};

/** RFC-003 交付的夜晚 handler 表。`step` 把它并进默认表。 */
export const NIGHT_HANDLERS = {
  WOLF_KILL: wolfKill,
  WOLF_VOTE: wolfVote,
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
