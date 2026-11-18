import type { Action } from '@shared/actions';
import type { GameState, RngState } from '@shared/domain';
import type { GameEvent, GameEventMap, GameEventType, Visibility } from '@shared/events';

import { applyEvent } from './apply';
import type { EffectApplierMap } from './effects';
import type { Modifier } from './effects';
import { UnhandledTransitionError } from './errors';
import { AUTO_PHASE_ENTRIES, AUTO_PHASE_LIMIT } from './phases/auto-table';
import { DAY_HANDLERS } from './phases/day';
import { NIGHT_HANDLERS } from './phases/night';
import { phaseChangedDraft } from './phases/visibility';
import { DEATH_APPLIERS } from './resolve/deaths';
import { rejectionDraft, seatOf } from './reject';
import { assertCompleteTransitionTable, DEFAULT_TRANSITIONS } from './transitions';
import type { TransitionTable } from './transitions';

/**
 * 状态机内核（RFC-002 §2.1 / §2.3 / §2.4）。
 *
 * 两个设计要点：
 *
 * **1. `step` 自己折叠它产出的事件**：`state' = drafts → events → applyEvent 链`。
 * 于是 `reduce(s,a) === step(s,a).state` **由构造保证**，而不是靠两条代码路径恰好对齐；
 * 同时 `applyEvent` 是派生字段唯一写入口这条纪律（C-18）变成结构性事实——`step` 没有
 * 别的途径改状态。
 *
 * **2. handler 只产出「事件草稿」**，`gameId` / `seq` / `ts` 由 `step` 统一盖章。
 * `seq` 的严格递增因此不可能被某个 handler 写错（AC-6），`ts` 也不可能出现「引擎自己
 * 读了时钟」（ARCH-4 / Q-002-1）。
 */

/** 事件草稿：handler 描述「发生了什么」，信封字段由 `step` 补。 */
export type EventDraft = {
  [K in GameEventType]: {
    type: K;
    payload: GameEventMap[K];
    visibleTo: Visibility;
    /** 该事件若消耗了随机数，必须带抽取后的状态（RFC-002 §2.2）。 */
    rngAfter?: RngState;
  };
}[GameEventType];

export interface HandlerContext {
  readonly modifiers: readonly Modifier[];
  readonly appliers: EffectApplierMap;
}

/** 每个 action 类型的 handler 只看得到自己那个类型——表以 `action.type` 为键。 */
export type ActionHandlerFor<K extends Action['type']> = (
  state: GameState,
  action: Extract<Action, { type: K }>,
  context: HandlerContext,
) => EventDraft[];

export type HandlerTable = { [K in Action['type']]?: ActionHandlerFor<K> };

export interface EngineConfig {
  readonly transitions: TransitionTable;
  readonly handlers: HandlerTable;
  readonly appliers: EffectApplierMap;
  /** 默认不注册任何 modifier：v1 没有遗物系统（F45 延后）。 */
  readonly modifiers?: readonly Modifier[];
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export interface Engine {
  step(state: GameState, action: Action, modifiers?: readonly Modifier[]): StepResult;
  reduce(state: GameState, action: Action): GameState;
}

/**
 * `START`：把 LOBBY 的候选状态变成一局真正的对局。
 *
 * 发牌结果取自 `state.seats`（`createInitialState` 洗出来的候选），`seed` / `mode` /
 * `playerSeat` 取自 action。两者必须一致——否则说明调用方用了 A 种子的牌、却声称是 B 种子
 * 的对局，重放时没人能说清该信谁。不一致时拒绝，不抛错（抛错会让一次坏请求变成 500）。
 */
const startHandler: ActionHandlerFor<'START'> = (state, action) => {
  const playerSeatInState = state.seats.find((seat) => seat.isPlayer)?.seat;

  if (action.seed !== state.seed || action.mode !== state.mode) {
    return [
      {
        type: 'REJECTED',
        visibleTo: 'public',
        payload: {
          actionType: action.type,
          code: 'START_STATE_MISMATCH',
          message: `START 的 seed/mode 与已发牌的状态不一致（state: ${state.seed}/${state.mode}）`,
        },
      },
    ];
  }

  if (playerSeatInState !== action.playerSeat) {
    return [
      {
        type: 'REJECTED',
        visibleTo: 'public',
        payload: {
          actionType: action.type,
          code: 'START_STATE_MISMATCH',
          message: `START 的 playerSeat 与已发牌的状态不一致（state: ${String(playerSeatInState)}）`,
        },
      },
    ];
  }

  return [
    {
      type: 'GAME_STARTED',
      // 全员身份都在 payload 里，任何席位都不可见（RFC-001 §2.3 的 'server'）。
      visibleTo: 'server',
      // 发牌消耗过随机数，把抽取后的状态带进事件，replay 才能恢复生成器。
      rngAfter: state.rng,
      payload: {
        seed: action.seed,
        mode: action.mode,
        playerSeat: action.playerSeat,
        roles: state.seats.map((seat) => seat.role),
        // 人格由 RFC-009 分配；此阶段一律 null，填假值会污染重放。
        personas: state.seats.map((seat) => seat.personaId ?? null),
      },
    },
    // 发牌后进入 NIGHT_WOLF_CHAT（RFC-003 §2.2 的阶段图从这里开始）。夜聊由 RFC-005 实现，
    // 本 RFC 直接推进到第一个「有人要行动」的阶段——每个相位推进都是一条事件，所以
    // replay 能把这段路径原样重建出来。可见性由 `phaseChangedDraft` 统一决定：夜间是
    // `server`，否则相位序列会把「谁已出局」漏给全场（C-23）。
    phaseChangedDraft('NIGHT_WOLF_CHAT', 'NIGHT_WOLVES'),
  ];
};

export const DEFAULT_HANDLERS: HandlerTable = {
  START: startHandler,
  ...NIGHT_HANDLERS,
  ...DAY_HANDLERS,
};

/**
 * 默认的效果 applier 表。
 *
 * RFC-002 时它是空的（那时没有任何具体效果类型）。RFC-003 引入 `heal` / `kill` 两种，
 * 于是默认表接上 `DEATH_APPLIERS`——**handler 用的是 `context.appliers`**，所以注入自定义
 * 表能替换掉它，而不是像最初那样绕过注入直接引用常量（评审 N6）。
 *
 * 未注册的效果仍然抛 `UnknownEffectError`：空表意味着「没人认领」，不是「静默跳过」。
 */
export const DEFAULT_APPLIERS: EffectApplierMap = DEATH_APPLIERS;

/**
 * 给草稿盖上信封字段。
 *
 * 这里有一次 `as GameEvent`：草稿的 `type` 与 `payload` 在**每个成员**上都是配对的，
 * 但 TypeScript 无法表达「映射类型的相关联合」在运行时配对之后的赋值，只能在此处桥一次。
 * 运行时数据由 `EventDraft` 的构造保证正确，这与「把类型不安全藏起来」不是一回事。
 */
function stampEvents(state: GameState, drafts: readonly EventDraft[], ts: number): GameEvent[] {
  return drafts.map((draft, index) => {
    const envelope = {
      gameId: state.gameId,
      seq: state.seq + index + 1,
      ts,
      type: draft.type,
      visibleTo: draft.visibleTo,
      payload: draft.payload,
    };
    const withRng =
      draft.rngAfter === undefined ? envelope : { ...envelope, rngAfter: draft.rngAfter };
    return withRng as GameEvent;
  });
}

function foldEvents(state: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce<GameState>((current, event) => applyEvent(current, event), state);
}

/**
 * 查表调用 handler。
 *
 * 表以 `action.type` 为键、值是该 action 的专用 handler，所以「键 ↔ 参数」的配对是安全的；
 * TypeScript 无法把同一个 `K` 同时约束键与参数，故用一次局部断言。
 */
function invokeHandler(
  handlers: HandlerTable,
  state: GameState,
  action: Action,
  context: HandlerContext,
): EventDraft[] {
  const handler = handlers[action.type] as ActionHandlerFor<Action['type']> | undefined;
  if (handler === undefined) {
    throw new UnhandledTransitionError(state.phase, action.type);
  }
  return (handler as (s: GameState, a: Action, c: HandlerContext) => EventDraft[])(
    state,
    action,
    context,
  );
}

export function createEngine(config: EngineConfig): Engine {
  assertCompleteTransitionTable(config.transitions);

  const defaults = config.modifiers ?? [];

  function step(
    state: GameState,
    action: Action,
    modifiers: readonly Modifier[] = defaults,
  ): StepResult {
    const allowed = config.transitions[state.phase];

    if (!allowed.includes(action.type)) {
      const seat = seatOf(action);
      const draft = rejectionDraft({
        action,
        code: 'PHASE_MISMATCH',
        message: `阶段 ${state.phase} 不接受 ${action.type}`,
        ...(seat === undefined ? {} : { seat }),
      });
      const events = stampEvents(state, [draft], action.ts);
      return { state: foldEvents(state, events), events };
    }

    const context: HandlerContext = { modifiers, appliers: config.appliers };
    const drafts = invokeHandler(config.handlers, state, action, context);
    const events = stampEvents(state, drafts, action.ts);
    let next = foldEvents(state, events);

    // 自动阶段（RFC-004 的 B 方案）：没有 action 可提交的阶段，由这里接着推进，
    // 直到停在一个等待输入的位置。上限防止 entry 之间互相跳转时死循环。
    for (let guard = 0; guard < AUTO_PHASE_LIMIT; guard += 1) {
      const entry = AUTO_PHASE_ENTRIES[next.phase];
      if (entry === undefined) break;

      const autoDrafts = entry(next, context);
      const autoEvents = stampEvents(next, autoDrafts, action.ts);
      events.push(...autoEvents);
      next = foldEvents(next, autoEvents);
    }

    return { state: next, events };
  }

  function reduce(state: GameState, action: Action): GameState {
    return step(state, action).state;
  }

  return { step, reduce };
}

const defaultEngine = createEngine({
  transitions: DEFAULT_TRANSITIONS,
  handlers: DEFAULT_HANDLERS,
  appliers: DEFAULT_APPLIERS,
});

export const step = defaultEngine.step;
export const reduce = defaultEngine.reduce;
