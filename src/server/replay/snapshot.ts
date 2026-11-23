import type { GameState } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
import type { Claim } from '@shared/events';
import { causeLabel, conditionLabel, phaseLabel } from '@shared/phase-labels';
import { ROLE_LABELS } from '@shared/terms';
import { personaOf } from '@engine/personas';
import type { ReplaySnapshot, TimelineEntry, ThoughtEntry } from '@shared/replay';
import { usageOf } from '../llm/usage';

/**
 * 复盘快照（RFC-014 §2.1）。
 *
 * 三件事只有这里做对，复盘才有意义：
 * 1. **纯派生**：只读已记录的事件与状态，**不重新调用模型**——否则同一局的复盘每次都不一样；
 * 2. **不持有状态引用**：只存值拷贝，状态释放后仍可读（NFR-17 / DATA-6）；
 * 3. **推理只取结构化 `reason`**：`reasoning_content` 是诊断信息，不进复盘（AI-5）。
 */

export function buildReplaySnapshot(
  state: GameState,
  events: readonly EventEnvelope[],
  input: { gameId: string; seed: number; finishedAt: number; now?: () => number },
): ReplaySnapshot {
  const timeline = buildTimeline(state, events);
  const ended = events.find((event) => event.type === 'GAME_ENDED');
  const endedPayload = ended?.payload as { result: 'wolf' | 'good'; condition: string } | undefined;

  return {
    gameId: input.gameId,
    seed: input.seed,
    finishedAt: input.finishedAt,
    result: endedPayload?.result ?? 'good',
    winCondition: conditionLabel(endedPayload?.condition ?? ''),
    timeline,
    seats: state.seats.map((seat) => ({
      seat: seat.seat,
      role: seat.role,
      roleLabel: ROLE_LABELS[seat.role] ?? seat.role,
      personaId: seat.personaId ?? null,
      personaLabel: seat.personaId === undefined ? null : personaOf(seat.personaId).label,
      alive: seat.alive,
    })),
    thoughts: buildThoughts(events),
    degraded: events.filter((event) => event.type === 'DEGRADED').map((event) => event.seq),
    usage: usageOf(input.gameId),
  };
}

/** 时间线：按 seq 升序，每条一句话说清「谁做了什么」。 */
export function buildTimeline(state: GameState, events: readonly EventEnvelope[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let day = 0;
  let phase = '';

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'GAME_STARTED':
        entries.push({ seq: event.seq, day: 0, phase: '开局', text: '身份分配完成' });
        break;
      case 'PHASE_CHANGED': {
        phase = String(payload['to']);
        const to = phase as string;
        if (to === 'NIGHT_WOLF_CHAT') day = Math.max(day + 1, 1);
        // 第一夜在第一个 DAY_STARTED 之前：夜 N 属于第 N 天（与真相视图一致）。
        if (day === 0 && to.startsWith('NIGHT')) day = 1;
        entries.push({ seq: event.seq, day, phase, text: `进入${phaseLabel(to)}` });
        break;
      }
      case 'DAY_STARTED': {
        day = Number(payload['day']);
        const died = payload['diedLastNight'] as number[];
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            died.length === 0 ? `第 ${day} 天，平安夜` : `第 ${day} 天，${died.join('、')} 号出局`,
        });
        break;
      }
      case 'WOLF_VOTE_CAST': {
        if (day === 0) day = 1;
        const target = payload['target'];
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            target === 'abstain'
              ? `${String(payload['seat'])} 号弃权（狼队）`
              : `${String(payload['seat'])} 号投 ${String(target)} 号（狼队）`,
        });
        break;
      }
      case 'WOLF_VOTE_REVEALED': {
        const votes = payload['votes'] as { seat: number; target: number | 'abstain' }[];
        const tally = votes
          .map((vote) => `${vote.seat}→${vote.target === 'abstain' ? '弃权' : vote.target}`)
          .join('、');
        const tied = payload['tied'] as number[] | undefined;
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            tied === undefined
              ? `狼队票型：${tally}`
              : `狼队票型：${tally}；平票（${tied.join('、')}）→ 重投`,
        });
        break;
      }
      case 'WOLF_CHAT_POSTED':
        // 夜聊发生在第一个 PHASE_CHANGED 之前时也要记成第 1 天
        if (day === 0) day = 1;
        entries.push({ seq: event.seq, day, phase, text: `${String(payload['seat'])} 号夜聊` });
        break;
      case 'WOLF_KILL_CHOSEN':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `狼队袭击 ${String(payload['target'])} 号`,
        });
        break;
      case 'SEER_CHECKED':
        if (day === 0) day = 1;
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `查验 ${String(payload['target'])} 号：${payload['result'] === 'wolf' ? ROLE_LABELS.wolf : '好人'}`,
        });
        break;
      case 'WITCH_POTION_USED':
        if (day === 0) day = 1;
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${payload['potion'] === 'heal' ? '解药' : '毒药'} → ${String(payload['target'])} 号`,
        });
        break;
      case 'PLAYER_DIED':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号出局（${causeLabel(String(payload['cause']))}）`,
        });
        break;
      case 'HUNTER_SHOOT':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            payload['target'] === null
              ? ROLE_LABELS.hunter + '没有开枪'
              : `${ROLE_LABELS.hunter}带走 ${String(payload['target'])} 号`,
        });
        break;
      case 'SPEECH':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号发言：${String(payload['text'])}`,
        });
        break;
      case 'SPEECH_SKIPPED':
        entries.push({ seq: event.seq, day, phase, text: `${String(payload['seat'])} 号弃权发言` });
        break;
      case 'VOTE_REVEALED': {
        const votes = payload['votes'] as { seat: number; target: number | 'abstain' }[];
        const parts = votes.map((vote) =>
          vote.target === 'abstain' ? `${vote.seat} 号弃权` : `${vote.seat} 号投 ${vote.target} 号`,
        );
        entries.push({ seq: event.seq, day, phase, text: parts.join('，') });
        break;
      }
      case 'SELF_EXPOSE':
        entries.push({ seq: event.seq, day, phase, text: `${String(payload['seat'])} 号自曝` });
        break;
      case 'DEGRADED':
        entries.push({ seq: event.seq, day, phase, text: `${String(payload['seat'])} 号发言降级` });
        break;
      case 'GAME_ENDED':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `对局结束：${conditionLabel(String(payload['condition']))}`,
        });
        break;
      default:
        break;
    }
  }

  // 快照里不含状态引用；`state` 只用于「没有事件时」的兜底（正常对局不会走到）。
  void state;
  return entries;
}

/** 推理：只认 `AI_THOUGHT.payload.reason`（AI-5）。 */
export function buildThoughts(events: readonly EventEnvelope[]): ThoughtEntry[] {
  return events
    .filter((event) => event.type === 'AI_THOUGHT')
    .map((event) => {
      const payload = event.payload as {
        reason: string;
        claim?: Claim;
        decisionSeq: number;
        seat: number;
      };
      const thought: ThoughtEntry = {
        seq: event.seq,
        seat: payload.seat,
        kind: 'speech',
        reason: payload.reason,
        chose: '',
      };
      if (payload.claim !== undefined) thought.claim = payload.claim;
      return thought;
    })
    .sort((a, b) => a.seq - b.seq || a.seat - b.seat);
}
