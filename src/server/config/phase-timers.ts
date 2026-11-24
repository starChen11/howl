/**
 * 各阶段的最长等待时间（毫秒）。
 *
 * 默认值是原先硬编码时间的 **两倍**；全部可以通过环境变量覆盖。
 * 服务端实际等待与前端倒计时都从这里取值，避免两边不一致。
 */
export interface PhaseTimers {
  wolfChatMs: number;
  wolfVoteMs: number;
  seerMs: number;
  witchMs: number;
  hunterShootMs: number;
  daySpeechMs: number;
  pkSpeechMs: number;
  dayVoteMs: number;
  dayVoteRunoffMs: number;
}

export const DEFAULT_PHASE_TIMERS: PhaseTimers = {
  wolfChatMs: 100_000,
  wolfVoteMs: 20_000,
  seerMs: 120_000,
  witchMs: 120_000,
  hunterShootMs: 120_000,
  daySpeechMs: 120_000,
  pkSpeechMs: 120_000,
  dayVoteMs: 120_000,
  dayVoteRunoffMs: 120_000,
};

function readMs(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 必须是正数毫秒，收到 ${raw}`);
  }
  return Math.round(value);
}

export function loadPhaseTimers(env: NodeJS.ProcessEnv = process.env): PhaseTimers {
  return {
    wolfChatMs: readMs(env, 'HOWL_WOLF_CHAT_MS', DEFAULT_PHASE_TIMERS.wolfChatMs),
    wolfVoteMs: readMs(env, 'HOWL_WOLF_VOTE_MS', DEFAULT_PHASE_TIMERS.wolfVoteMs),
    seerMs: readMs(env, 'HOWL_SEER_MS', DEFAULT_PHASE_TIMERS.seerMs),
    witchMs: readMs(env, 'HOWL_WITCH_MS', DEFAULT_PHASE_TIMERS.witchMs),
    hunterShootMs: readMs(env, 'HOWL_HUNTER_SHOOT_MS', DEFAULT_PHASE_TIMERS.hunterShootMs),
    daySpeechMs: readMs(env, 'HOWL_DAY_SPEECH_MS', DEFAULT_PHASE_TIMERS.daySpeechMs),
    pkSpeechMs: readMs(env, 'HOWL_PK_SPEECH_MS', DEFAULT_PHASE_TIMERS.pkSpeechMs),
    dayVoteMs: readMs(env, 'HOWL_DAY_VOTE_MS', DEFAULT_PHASE_TIMERS.dayVoteMs),
    dayVoteRunoffMs: readMs(env, 'HOWL_DAY_VOTE_RUNOFF_MS', DEFAULT_PHASE_TIMERS.dayVoteRunoffMs),
  };
}

/** 相位 → 最长等待毫秒；自动结算相位返回 null。 */
export function timeoutForPhase(phase: string, timers: PhaseTimers): number | null {
  switch (phase) {
    case 'NIGHT_WOLF_CHAT':
      return timers.wolfChatMs;
    case 'NIGHT_WOLVES':
    case 'NIGHT_WOLF_RUNOFF':
      return timers.wolfVoteMs;
    case 'NIGHT_SEER':
      return timers.seerMs;
    case 'NIGHT_WITCH':
      return timers.witchMs;
    case 'NIGHT_HUNTER_SHOOT':
    case 'DAY_HUNTER_SHOOT':
      return timers.hunterShootMs;
    case 'DAY_SPEECH':
      return timers.daySpeechMs;
    case 'DAY_PK_SPEECH':
      return timers.pkSpeechMs;
    case 'DAY_VOTE':
      return timers.dayVoteMs;
    case 'DAY_VOTE_RUNOFF':
      return timers.dayVoteRunoffMs;
    default:
      return null;
  }
}
