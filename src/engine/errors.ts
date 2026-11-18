import type { Action } from '@shared/actions';
import type { Phase } from '@shared/domain';

/**
 * 引擎的显式错误类型。
 *
 * 全部继承 `Error` 并固定 `name`，原因见 `RULES.md` 的 `ARCH-11`：引擎遇到未裁决或未实现的
 * 分支必须**炸出来**，不能默认选一个。测试按 `name` 断言，不靠读消息文本。
 */

/** `transitions` 表声明了允许，但该 action 没有 handler——实现缺陷，不是数据问题。 */
export class UnhandledTransitionError extends Error {
  readonly phase: Phase;
  readonly actionType: Action['type'];

  constructor(phase: Phase, actionType: Action['type']) {
    super(
      `未实现的转移：${phase} 阶段收到 ${actionType}。它被 transitions 声明为允许，但没有对应 handler。`,
    );
    this.name = 'UnhandledTransitionError';
    this.phase = phase;
    this.actionType = actionType;
  }
}

/**
 * 事件消耗了随机数却没有 `rngAfter`。
 *
 * 没有它，`replay` 无法把 `state.rng` 恢复成原始值，后续所有随机结果都会漂移（DATA-3）。
 */
export class MissingRngStateError extends Error {
  readonly eventType: string;

  constructor(eventType: string) {
    super(`事件 ${eventType} 消耗了随机数却没有 rngAfter，无法精确重放。`);
    this.name = 'MissingRngStateError';
    this.eventType = eventType;
  }
}

/**
 * `applyEvent` 不认识的事件类型。
 *
 * 两个来源共用它：**运行时**出现了不在 `GameEventMap` 里的 type（数据损坏），或者
 * 类型合法但本 RFC 还没实现该事件的折叠（`SPEECH` 等归 RFC-003/004/005）。
 * 两者都必须抛错——静默忽略会让 `replay` 悄悄丢状态。
 */
export class UnknownEventError extends Error {
  readonly eventType: string;

  constructor(eventType: string) {
    super(`applyEvent 不认识事件类型 ${eventType}：它不在 GameEventMap 里，或还没有实现折叠。`);
    this.name = 'UnknownEventError';
    this.eventType = eventType;
  }
}

/** 效果没有注册 applier。RFC-002 不定义任何具体效果类型，所以默认表是空的。 */
export class UnknownEffectError extends Error {
  readonly effectType: string;
  readonly effectId: string;

  constructor(effectType: string, effectId: string) {
    super(`效果 ${effectType}（id=${effectId}）没有注册 applier：它属于哪个 RFC，就由谁注册。`);
    this.name = 'UnknownEffectError';
    this.effectType = effectType;
    this.effectId = effectId;
  }
}

/** 事件流本身不合法（例如首事件不是 `GAME_STARTED`，或 `seq` 跳号）。 */
export class InvalidEventStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventStreamError';
  }
}
