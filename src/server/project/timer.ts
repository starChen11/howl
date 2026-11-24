import type { GameRecord } from '../store/game-registry';

/** 有倒计时的相位及其上限（秒）。自动结算相位没有倒计时。 */
const PHASE_SECONDS: Record<string, number> = {
  NIGHT_WOLF_CHAT: 50,
  NIGHT_WOLVES: 10,
  NIGHT_WOLF_RUNOFF: 10,
  NIGHT_SEER: 60,
  NIGHT_WITCH: 60,
  NIGHT_HUNTER_SHOOT: 60,
  DAY_SPEECH: 60,
  DAY_PK_SPEECH: 60,
  DAY_VOTE: 60,
  DAY_VOTE_RUNOFF: 60,
  DAY_HUNTER_SHOOT: 60,
};

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
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): PhaseTimer | null {
  const total =
    phase === 'NIGHT_WOLF_CHAT'
      ? Math.max(1, Math.round(Number(env['HOWL_WOLF_CHAT_MS'] ?? 50_000) / 1000))
      : phase === 'NIGHT_WOLVES' || phase === 'NIGHT_WOLF_RUNOFF'
        ? Math.max(1, Math.round(Number(env['HOWL_WOLF_VOTE_MS'] ?? 10_000) / 1000))
        : PHASE_SECONDS[phase];
  if (total === undefined) return null;

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
