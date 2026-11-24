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
  for (const event of record.events) {
    if (event.type === 'PHASE_CHANGED') {
      if ((event.payload as { to?: string }).to === phase) startedAt = event.ts;
    } else if (event.type === 'GAME_STARTED' && phase === 'NIGHT_WOLF_CHAT') {
      startedAt = event.ts;
    }
  }
  if (startedAt === null) return null;

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return {
    phase,
    totalSeconds: total,
    remainingSeconds: Math.max(0, Math.ceil(total - elapsed)),
  };
}
