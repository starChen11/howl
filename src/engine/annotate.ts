import type { GameState, SeatId } from '@shared/domain';
import type { Claim, EventEnvelope } from '@shared/events';

/**
 * 高级打法的事件标注（RFC-009 §2.3）。
 *
 * **只读结构化字段，不做自然语言匹配**：把同一段发言换个措辞，判定结果必须不变。
 * 这是「它真的在骗我」从观感变成事实的唯一方式，也是换模型后判定不失效的原因。
 *
 * 标注是**派生产物**：不产生新事件，复盘（RFC-014）读取它。
 */

export type AdvancedPlayKind = 'fake-seer-claim' | 'wolf-accuses-wolf' | 'self-expose';

export interface AdvancedPlayMark {
  kind: AdvancedPlayKind;
  /** 产生这条打法的席位。 */
  seat: SeatId;
  /** 对应事件的 `seq`，供复盘定位。 */
  seq: number;
}

/**
 * 从 `AI_THOUGHT` 事件里取 `claim`；没有就是没有，不做文本推断。
 */
function claimOf(event: EventEnvelope): Claim | undefined {
  if (event.type !== 'AI_THOUGHT') return undefined;
  return (event.payload as { claim?: Claim }).claim;
}

/**
 * 判定一次「声称」是否构成悍跳：
 * 发言者**是 wolf**、声称自己是 **seer**、且给出**至少一条查验**。
 */
export function isFakeSeerClaim(input: { speakerRole: string; claim: Claim | undefined }): boolean {
  const { speakerRole, claim } = input;
  if (speakerRole !== 'wolf') return false;
  if (claim?.role !== 'seer') return false;
  return (claim.checks?.length ?? 0) >= 1;
}

/** 判定「狼指认同伴是狼」。 */
export function isWolfAccusesWolf(input: {
  speakerRole: string;
  claim: Claim | undefined;
  roleOf: (seat: SeatId) => string;
}): boolean {
  const { speakerRole, claim, roleOf } = input;
  if (speakerRole !== 'wolf') return false;

  return (claim?.accuses ?? []).some(
    (accusation) => accusation.as === 'wolf' && roleOf(accusation.target) === 'wolf',
  );
}

export interface AnnotateInput {
  events: readonly EventEnvelope[];
  /** 对局结束时的状态：用来查「当时的真实身份」。 */
  state: GameState;
  /**
   * 某条事件是谁产生的。
   *
   * **不从 `visibleTo` 反解席位**：那是拿可见性字段当数据用（CR-003 C2），
   * 一旦可见性规则变化（RFC-005 就改过），席位解析会静默错位。调用方本来就知道
   * 这条决策属于谁，直接传进来。
   */
  speakerOf: (event: EventEnvelope) => SeatId | undefined;
}

/** 标注一整局：把每条 `AI_THOUGHT` 与 `SELF_EXPOSE` 过一遍。 */
export function annotate(input: AnnotateInput): AdvancedPlayMark[] {
  const { events, state, speakerOf } = input;
  const marks: AdvancedPlayMark[] = [];

  const roleOf = (seat: SeatId): string => {
    const found = state.seats.find((candidate) => candidate.seat === seat);
    return found?.role ?? 'unknown';
  };

  for (const event of events) {
    if (event.type === 'SELF_EXPOSE') {
      const seat = (event.payload as { seat: SeatId }).seat;
      marks.push({ kind: 'self-expose', seat, seq: event.seq });
      continue;
    }

    const claim = claimOf(event);
    if (claim === undefined) continue;

    const speaker = speakerOf(event);
    if (speaker === undefined) continue;
    const speakerRole = roleOf(speaker);

    if (isFakeSeerClaim({ speakerRole, claim })) {
      marks.push({ kind: 'fake-seer-claim', seat: speaker, seq: event.seq });
    }
    if (isWolfAccusesWolf({ speakerRole, claim, roleOf })) {
      marks.push({ kind: 'wolf-accuses-wolf', seat: speaker, seq: event.seq });
    }
  }

  return marks;
}

/** 标注是否「只读结构化字段」：把文本内容抹掉，结果必须不变。 */
export function annotateWithoutText(input: AnnotateInput): AdvancedPlayMark[] {
  const stripped = input.events.map((event) => {
    if (event.type !== 'SPEECH' && event.type !== 'WOLF_CHAT_POSTED') return event;
    const payload = event.payload as Record<string, unknown>;
    return { ...event, payload: { ...payload, text: '' } } as EventEnvelope;
  });

  return annotate({ ...input, events: stripped });
}
