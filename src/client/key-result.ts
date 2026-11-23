import type { ProjectedContext } from '@shared/project';
import { conditionLabel } from '@shared/phase-labels';
import { ROLE_LABELS } from '@shared/terms';

export interface KeyResult {
  seq: number;
  title: string;
  body: string;
  tone: 'info' | 'danger' | 'good';
}

/**
 * 从公开事件里挑出「需要弹窗告诉玩家」的关键结果。
 *
 * 只读 `publicEvents`：夜间死亡、查验、狼队投票都不会进公开区，不会提前泄漏。
 */
export function latestKeyResult(events: ProjectedContext['publicEvents']): KeyResult | null {
  let latest: KeyResult | null = null;

  for (const event of events) {
    const seq = event.seq;
    if (event.type === 'DAY_STARTED') {
      const died = (event.payload as { diedLastNight?: number[] }).diedLastNight ?? [];
      latest = {
        seq,
        title: '天亮了',
        body: died.length === 0 ? '昨晚是平安夜，没有人出局。' : `昨晚 ${died.join('、')} 号出局。`,
        tone: died.length === 0 ? 'info' : 'danger',
      };
    }
    if (event.type === 'PLAYER_DIED') {
      const payload = event.payload as { seat: number; cause: string };
      const verb =
        payload.cause === 'vote'
          ? '被放逐'
          : payload.cause === 'shoot'
            ? `被${ROLE_LABELS.hunter}带走`
            : '出局';
      latest = {
        seq,
        title: '有人出局',
        body: `${payload.seat} 号${verb}。`,
        tone: 'danger',
      };
    }
    if (event.type === 'SELF_EXPOSE') {
      const seat = (event.payload as { seat: number }).seat;
      latest = {
        seq,
        title: `${ROLE_LABELS.wolf}自曝`,
        body: `${seat} 号自曝是${ROLE_LABELS.wolf}，白天立即结束。`,
        tone: 'danger',
      };
    }
    if (event.type === 'GAME_ENDED') {
      const payload = event.payload as { result: 'wolf' | 'good'; condition: string };
      latest = {
        seq,
        title: '对局结束',
        body: `${payload.result === 'wolf' ? `${ROLE_LABELS.wolf}阵营` : '好人阵营'}胜利：${conditionLabel(payload.condition)}。`,
        tone: payload.result === 'wolf' ? 'danger' : 'good',
      };
    }
  }

  return latest;
}
