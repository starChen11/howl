import type { SeatId } from '@shared/domain';

import {
  decideDegrade,
  degradeSentence,
  recordDegradation,
  recordSuccess,
  shouldAttempt,
  type DegradationState,
} from './degrade';

/**
 * 一轮 AI 发言的编排（RFC-010 §2.3 / §2.4）。
 *
 * 三件事按顺序发生：
 * 1. 调一次；失败后**重试 1 次**（AC-8）；
 * 2. 仍然失败或超时 → 降级：短句替换正文（AC-7）；
 * 3. 无论成败，引擎都拿得到一条**可推进的 SPEECH**（NFR-10）。
 *
 * 降级短句不是「什么都不做」：必须真的产出一条 `SPEECH`，否则发言 cursor 不前进，
 * 对局会卡在同一席位（评审 C-87 指出的问题）。
 */

export interface TurnAttempt {
  text: string;
  failed: boolean;
}

export interface RunTurnInput {
  seat: SeatId;
  /** 真实调用；测试注入假实现。 */
  attempt: () => Promise<TurnAttempt>;
  startedAt: number;
  now: () => number;
  limitMs: number;
  degradation: DegradationState;
  /** 决定用哪句降级文案（通常传本局已降级次数）。 */
  sentenceIndex: number;
}

export interface RunTurnResult {
  text: string;
  degraded: boolean;
  /** 实际尝试了几次（1 或 2）。 */
  attempts: number;
  degradation: DegradationState;
  /** 是否已跨过「模型不稳定」阈值（调用方向 UI 推提示）。 */
  unstable: boolean;
}

/** 连续失败后仍要尝试真实调用（AC-12）。挂在函数上，方便断言与替换。 */
export function canAttempt(state: DegradationState): boolean {
  void state;
  return shouldAttempt();
}

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  let attempts = 0;
  let last: TurnAttempt = { text: '', failed: true };

  // AC-8：失败后重试 1 次；重试成功就不降级。
  for (let index = 0; index < 2; index += 1) {
    attempts += 1;
    last = await input.attempt();
    if (!last.failed) break;
  }

  const decision = decideDegrade({
    seat: input.seat,
    startedAt: input.startedAt,
    now: input.now(),
    limitMs: input.limitMs,
    failed: last.failed,
    sentenceIndex: input.sentenceIndex,
  });

  if (!decision.degrade) {
    return {
      text: last.text,
      degraded: false,
      attempts,
      degradation: recordSuccess(input.degradation),
      unstable: false,
    };
  }

  const degradation = recordDegradation(input.degradation);

  return {
    text: decision.sentence ?? degradeSentence(input.sentenceIndex),
    degraded: true,
    attempts,
    degradation,
    unstable: degradation.warned,
  };
}

/** 降级轮要写入引擎的事件（`DEGRADED` 在前，短句 `SPEECH` 在后）。 */
export function degradeEvents(input: {
  gameId: string;
  ts: number;
  seat: SeatId;
  text: string;
  seq: number;
}): { type: 'DEGRADED' | 'SPEECH'; payload: { seat: SeatId; text?: string } }[] {
  return [
    { type: 'DEGRADED', payload: { seat: input.seat } },
    { type: 'SPEECH', payload: { seat: input.seat, text: input.text } },
  ];
}
