import type { SeatId } from '@shared/domain';

import type { StreamBus } from '../stream/bus';
import type { GameRecord, GameRegistry, SessionRecord } from '../store/game-registry';
import { runTurn } from './turn';
import { initialDegradation, UNSTABLE_AFTER, type DegradationState } from './degrade';

/**
 * 让某个 AI 席位说完一句话（RFC-010 §2.3 / §2.4）。
 *
 * 这是**生产侧的接缝**：`runTurn` 的重试与降级、`degradeEvents` 的事件、`StreamBus`
 * 的增量推送，都在这里串起来。RFC-011 的 `SseOutputChannel` 负责在每个 AI 回合调用它。
 *
 * `delta` 不写进对局事件流（§4），只走总线；`done` 时把完整发言写成 `SPEECH` 事件。
 */

export interface SpeakInput {
  registry: GameRegistry;
  bus: StreamBus;
  session: SessionRecord;
  record: GameRecord;
  seat: SeatId;
  /** 真实调用；返回完整发言或失败。 */
  attempt: () => Promise<{ text: string; failed: boolean }>;
  limitMs: number;
  now?: () => number;
  degradation?: DegradationState;
}

export type SpeakResult =
  | {
      ok: true;
      record: GameRecord;
      text: string;
      degraded: boolean;
      degradation: DegradationState;
      /** 需要向 UI 推「模型不稳定」。 */
      unstable: boolean;
    }
  | { ok: false; code: string; record: GameRecord };

export async function speak(input: SpeakInput): Promise<SpeakResult> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const degradation = input.degradation ?? initialDegradation();
  const nextSeq = input.record.events.length + 1;

  // 先推 `thinking`：这就是「可见进度」，满足首字延迟的另一半（§2.1）。
  input.bus.publish(input.record.gameId, { type: 'thinking', id: nextSeq, seat: input.seat });

  const turn = await runTurn({
    seat: input.seat,
    attempt: input.attempt,
    startedAt,
    now,
    limitMs: input.limitMs,
    degradation,
    sentenceIndex: degradation.total,
  });

  // **发言必须走引擎**：`SPEECH` 会推进发言 cursor、说满一圈后切到投票。
  // 用 `appendEvents` 直接写事件会绕开这些，最后卡在 DAY_SPEECH（C-97）。
  const submitted = await input.registry.submit(
    input.session,
    input.record,
    { type: 'SPEECH', ts: now(), seat: input.seat, text: turn.text } as never,
    input.record.events.length,
  );

  if (!submitted.ok) {
    // 引擎拒绝（不在白天 / 不是当前发言者）时**不能**当成功：既不写事件，
    // 也不向总线发 `done`——那会让客户端显示一句从未发生过的话（C-97）。
    return { ok: false, code: submitted.code, record: input.record };
  }

  // `submit` 的 `ok` 只表示「版本对得上」；**引擎的拒绝会以 `REJECTED` 事件出现**。
  // 把它当成功会让客户端显示一句从未发生过的话（C-97）。
  const rejected = submitted.events.find((event) => event.type === 'REJECTED');
  if (rejected !== undefined) {
    return {
      ok: false,
      code: (rejected.payload as { code?: string }).code ?? 'REJECTED',
      record: submitted.record,
    };
  }

  let record = submitted.record;

  if (turn.degraded) {
    // 降级标记补在短句之后：`DEGRADED` 不改变局面，只供复盘统计。
    record = await input.registry.appendEvents(record, [
      {
        gameId: record.gameId,
        seq: record.events.length + 1,
        ts: now(),
        type: 'DEGRADED',
        visibleTo: 'public',
        payload: { seat: input.seat },
      },
    ]);

    input.bus.publish(record.gameId, { type: 'degraded', id: nextSeq, seat: input.seat });
    input.bus.publish(record.gameId, {
      type: 'done',
      id: nextSeq,
      seat: input.seat,
      text: turn.text,
    });

    return {
      ok: true,
      record,
      text: turn.text,
      degraded: true,
      degradation: turn.degradation,
      unstable: turn.degradation.consecutive >= UNSTABLE_AFTER,
    };
  }

  for (const chunk of chunkText(turn.text)) {
    input.bus.publish(record.gameId, {
      type: 'delta',
      id: nextSeq,
      seat: input.seat,
      text: chunk,
    });
  }
  input.bus.publish(record.gameId, {
    type: 'done',
    id: nextSeq,
    seat: input.seat,
    text: turn.text,
  });

  return {
    ok: true,
    record,
    text: turn.text,
    degraded: false,
    degradation: turn.degradation,
    unstable: false,
  };
}

/** 把文本切成小块（真实流式时由模型分片决定）。 */
export function chunkText(text: string, size = 4): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size)
    chunks.push(text.slice(index, index + size));
  return chunks;
}
