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

      /* ---- RFC-022 · 警长竞选 / 警徽（全部写入复盘，不丢数据） ---- */
      case 'SHERIFF_ELECTION_STARTED':
        entries.push({ seq: event.seq, day, phase, text: '警长竞选开始' });
        break;
      case 'SHERIFF_SIGNUP':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号${payload['run'] === true ? '上警' : '选择不上警'}`,
        });
        break;
      case 'SHERIFF_CANDIDATES': {
        const candidates = payload['candidates'] as number[];
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            candidates.length === 0
              ? '没有人上警，本局无警长'
              : `警上候选人：${candidates.join('、')} 号`,
        });
        break;
      }
      case 'SHERIFF_SPEECH':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号竞选发言：${String(payload['text'])}`,
        });
        break;
      case 'SHERIFF_SPEECH_SKIPPED':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号跳过竞选发言`,
        });
        break;
      case 'SHERIFF_WITHDRAWN':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号${payload['withdraw'] === true ? '退水' : '留在警上'}`,
        });
        break;
      case 'SHERIFF_VOTE_CAST':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text:
            payload['target'] === 'abstain'
              ? `${String(payload['seat'])} 号在警长投票中弃权`
              : `${String(payload['seat'])} 号投 ${String(payload['target'])} 号（警长票）`,
        });
        break;
      case 'SHERIFF_VOTE_REVEALED': {
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
              ? `警长票型：${tally}`
              : `警长票型：${tally}；平票（${tied.join('、')}）`,
        });
        break;
      }
      case 'SHERIFF_ELECTED':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号当选警长（放逐票 1.5 票）`,
        });
        break;
      case 'SHERIFF_ELECTION_FAILED': {
        const reason = String(payload['reason']);
        const label =
          reason === 'self-exposed'
            ? '竞选期间自曝，警徽被吞'
            : reason === 'double-tie'
              ? '重投再次平票'
              : reason === 'no-valid-votes'
                ? '没有有效票'
                : reason === 'all-withdrawn'
                  ? '候选人全部退水'
                  : reason === 'no-voters'
                    ? '没有警下投票人'
                    : '无人上警';
        entries.push({ seq: event.seq, day, phase, text: `警长竞选失败：${label}，本局无警长` });
        break;
      }
      case 'BADGE_TRANSFERRED': {
        const { from, to } = payload as { from: number; to: number };
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${from} 号把警徽移交给 ${to} 号`,
        });
        break;
      }
      case 'BADGE_DESTROYED':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `${String(payload['seat'])} 号撕毁警徽`,
        });
        break;
      case 'SHERIFF_ORDER_CHOSEN':
        entries.push({
          seq: event.seq,
          day,
          phase,
          text: `警长选择从 ${String(payload['startSeat'])} 号开始，${
            payload['direction'] === 'clockwise' ? '顺时针' : '逆时针'
          }发言`,
        });
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
        phase?: string;
        decisionAction?: string;
        target?: number | 'abstain';
        detail?: string;
      };
      const phase = payload.phase ?? '';
      const votePhases = new Set([
        'DAY_VOTE',
        'DAY_VOTE_RUNOFF',
        'DAY_SHERIFF_VOTE',
        'DAY_SHERIFF_RUNOFF',
        'DAY_BADGE_TRANSFER',
      ]);
      const kind: ThoughtEntry['kind'] = phase.startsWith('NIGHT')
        ? 'night-action'
        : votePhases.has(phase)
          ? 'vote'
          : 'speech';
      let chose = '';
      if (payload.decisionAction === 'SHERIFF_ORDER' && payload.target !== undefined) {
        chose = `从 ${payload.target} 号开始${payload.detail === undefined ? '' : `（${payload.detail}）`}`;
      } else if (payload.decisionAction === 'BADGE_TRANSFER') {
        chose =
          payload.target === undefined ? (payload.detail ?? '') : `移交给 ${payload.target} 号`;
      } else if (payload.target !== undefined) {
        chose =
          payload.target === 'abstain'
            ? '弃权'
            : payload.decisionAction === 'SHERIFF_VOTE' || payload.decisionAction === 'VOTE'
              ? `投 ${payload.target} 号`
              : `选择 ${payload.target} 号`;
      } else if (payload.detail !== undefined) {
        chose = payload.detail;
      }
      const thought: ThoughtEntry = {
        seq: event.seq,
        seat: payload.seat,
        kind,
        reason: payload.reason,
        chose,
      };
      if (payload.claim !== undefined) thought.claim = payload.claim;
      return thought;
    })
    .sort((a, b) => a.seq - b.seq || a.seat - b.seat);
}
