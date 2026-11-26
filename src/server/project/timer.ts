import type { GameRecord } from '../store/game-registry';
import { loadPhaseTimers, timeoutForPhase, type PhaseTimers } from '../config/phase-timers';

export interface PhaseTimer {
  phase: string;
  totalSeconds: number;
  remainingSeconds: number;
}

/**
 * 服务端权威的本阶段倒计时。
 *
 * 起点取最近一次进入当前相位的事件；第一夜没有 `PHASE_CHANGED`，退回 `GAME_STARTED`。
 * 这是「最长等待时间」：玩家/AI 提前完成时相位会先推进，客户端下一次轮询自然更新。
 */
export function phaseTimer(
  record: Pick<GameRecord, 'events'>,
  phase: string,
  timersOrEnv: PhaseTimers | NodeJS.ProcessEnv = loadPhaseTimers(),
  now = Date.now(),
): PhaseTimer | null {
  const timers =
    (timersOrEnv as PhaseTimers).wolfChatMs !== undefined
      ? (timersOrEnv as PhaseTimers)
      : loadPhaseTimers(timersOrEnv as NodeJS.ProcessEnv);
  const timeoutMs = timeoutForPhase(phase, timers);
  if (timeoutMs === null) return null;
  const total = Math.max(1, Math.round(timeoutMs / 1000));

  let startedAt: number | null = null;
  let phaseStartIndex = -1;
  record.events.forEach((event, index) => {
    if (event.type === 'PHASE_CHANGED') {
      if ((event.payload as { to?: string }).to === phase) {
        startedAt = event.ts;
        phaseStartIndex = index;
      }
    } else if (event.type === 'GAME_STARTED' && phase === 'NIGHT_WOLF_CHAT') {
      startedAt = event.ts;
      phaseStartIndex = index;
    }
  });
  if (startedAt === null) return null;

  // 白天发言是「每人 120 秒」：当前发言人的计时从上一句发言/跳过结束时重新开始，
  // 而不是从整个白天发言阶段开始时一直倒计时。
  // RFC-022 的竞选发言与 PK 发言用独立的 `SHERIFF_SPEECH*` 事件，同样按人重新计时。
  if (phase === 'DAY_SPEECH' || phase === 'DAY_PK_SPEECH') {
    for (let index = phaseStartIndex + 1; index < record.events.length; index += 1) {
      const event = record.events[index];
      if (event !== undefined && (event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED')) {
        startedAt = event.ts;
      }
    }
  }
  if (phase === 'DAY_SHERIFF_SPEECH' || phase === 'DAY_SHERIFF_PK') {
    for (let index = phaseStartIndex + 1; index < record.events.length; index += 1) {
      const event = record.events[index];
      if (
        event !== undefined &&
        (event.type === 'SHERIFF_SPEECH' || event.type === 'SHERIFF_SPEECH_SKIPPED')
      ) {
        startedAt = event.ts;
      }
    }
  }

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return {
    phase,
    totalSeconds: total,
    remainingSeconds: Math.max(0, Math.ceil(total - elapsed)),
  };
}
