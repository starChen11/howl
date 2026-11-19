import type { SeatId } from '@shared/domain';

import type { StreamBus } from '../stream/bus';
import type { GameRecord, GameRegistry, SessionRecord } from '../store/game-registry';
import { degradeEvents, runTurn } from './turn';
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

export interface SpeakResult {
  record: GameRecord;
  text: string;
  degraded: boolean;
  degradation: DegradationState;
  /** 需要向 UI 推「模型不稳定」。 */
  unstable: boolean;
}

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
  // 降级时先把 `DEGRADED` 标记补进去，再走同一条通道写短句。
  if (turn.degraded) {
    const events = degradeEvents({
      gameId: input.record.gameId,
      ts: now(),
      seat: input.seat,
      text: turn.text,
      seq: nextSeq,
    });
    const [degradedEvent] = events;
    const withMarker =
      degradedEvent === undefined
        ? input.record
        : await input.registry.appendEvents(input.record, [degradedEvent]);

    const submitted = await input.registry.submit(
      input.session,
      withMarker,
      { type: 'SPEECH', ts: now(), seat: input.seat, text: turn.text } as never,
      withMarker.events.length,
    );
    const record = submitted.ok ? submitted.record : withMarker;

    input.bus.publish(input.record.gameId, { type: 'degraded', id: nextSeq, seat: input.seat });
    input.bus.publish(input.record.gameId, {
      type: 'done',
      id: nextSeq + 1,
      seat: input.seat,
      text: turn.text,
    });

    return {
      record,
      text: turn.text,
      degraded: true,
      degradation: turn.degradation,
      unstable: turn.degradation.consecutive >= UNSTABLE_AFTER,
    };
  }

  const submitted = await input.registry.submit(
    input.session,
    input.record,
    { type: 'SPEECH', ts: now(), seat: input.seat, text: turn.text } as never,
    input.record.events.length,
  );
  if (!submitted.ok) throw new Error(`发言被引擎拒绝：${submitted.code}`);
  const record = submitted.record;

  // 增量：把完整发言按小块推给前端（真实流式时这些块来自模型）。
  const chunks = chunkText(turn.text);
  for (const chunk of chunks) {
    input.bus.publish(input.record.gameId, {
      type: 'delta',
      id: nextSeq,
      seat: input.seat,
      text: chunk,
    });
  }
  input.bus.publish(input.record.gameId, {
    type: 'done',
    id: nextSeq,
    seat: input.seat,
    text: turn.text,
  });

  return {
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
