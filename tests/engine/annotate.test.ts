import { describe, expect, it } from 'vitest';

import type { SeatId } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';

import {
  annotate,
  annotateWithoutText,
  isFakeSeerClaim,
  isWolfAccusesWolf,
} from '@engine/annotate';

import { FIXTURE_ROLES, stateWithRoles } from '../fixtures/states';

/**
 * RFC-009 §5 AC-6 / 7 / 8 / 9：高级打法的判定。
 *
 * 三条判据都只读结构化字段；`speech` 换成任何措辞（含不含「预言家」字样）结果不变。
 */

const state = stateWithRoles(FIXTURE_ROLES, 'slaughter-side');
const roleOf = (seat: SeatId): string =>
  state.seats.find((candidate) => candidate.seat === seat)?.role ?? 'unknown';

function thought(seq: number, seat: SeatId, payload: Record<string, unknown>): EventEnvelope {
  return {
    gameId: state.gameId,
    seq,
    ts: 0,
    type: 'AI_THOUGHT',
    visibleTo: `self:${seat}`,
    payload,
  } as unknown as EventEnvelope;
}

const speakerOf = (event: EventEnvelope): SeatId | undefined => {
  const match = /^self:(\d)$/.exec(String((event as { visibleTo?: string }).visibleTo));
  return match === null ? undefined : (Number(match[1]) as SeatId);
};

describe('AC-6 · 悍跳判定', () => {
  const wolfClaimingSeer = {
    role: 'seer' as const,
    checks: [{ target: 4 as SeatId, result: 'not-wolf' as const }],
  };

  it('狼 + 声称预言家 + 至少一条查验 → 真', () => {
    expect(isFakeSeerClaim({ speakerRole: 'wolf', claim: wolfClaimingSeer })).toBe(true);
  });

  it('狼声称预言家但没有查验 → 假', () => {
    expect(isFakeSeerClaim({ speakerRole: 'wolf', claim: { role: 'seer' } })).toBe(false);
  });

  it('好人声称预言家 → 假（那是真预言家或民跳，不算悍跳）', () => {
    expect(isFakeSeerClaim({ speakerRole: 'seer', claim: wolfClaimingSeer })).toBe(false);
  });
});

describe('AC-7 · 狼查杀狼判定', () => {
  it('狼指认同伴是狼 → 真', () => {
    // FIXTURE_ROLES：1/2/3 是 wolf
    expect(
      isWolfAccusesWolf({
        speakerRole: 'wolf',
        claim: { accuses: [{ target: 2 as SeatId, as: 'wolf' }] },
        roleOf,
      }),
    ).toBe(true);
  });

  it('狼指认好人是狼 → 假', () => {
    expect(
      isWolfAccusesWolf({
        speakerRole: 'wolf',
        claim: { accuses: [{ target: 4 as SeatId, as: 'wolf' }] },
        roleOf,
      }),
    ).toBe(false);
  });

  it('好人指认同伴是狼 → 假（不是「狼查杀狼」）', () => {
    expect(
      isWolfAccusesWolf({
        speakerRole: 'seer',
        claim: { accuses: [{ target: 2 as SeatId, as: 'wolf' }] },
        roleOf,
      }),
    ).toBe(false);
  });
});

describe('AC-8 · 换措辞不影响判定', () => {
  it('把 speech 抹掉后标注结果不变', () => {
    const events: EventEnvelope[] = [
      thought(2, 1 as SeatId, {
        reason: '我要跳预言家',
        claim: { role: 'seer', checks: [{ target: 4, result: 'not-wolf' }] },
        decisionSeq: 1,
      }),
      thought(3, 2 as SeatId, {
        reason: '我指认同伴',
        claim: { accuses: [{ target: 3, as: 'wolf' }] },
        decisionSeq: 2,
      }),
      {
        gameId: state.gameId,
        seq: 4,
        ts: 0,
        type: 'SPEECH',
        visibleTo: 'public',
        payload: { seat: 1, text: '我是预言家，昨晚验了 4 号好人' },
      } as unknown as EventEnvelope,
    ];

    const withText = annotate({ events, state, speakerOf });
    const withoutText = annotateWithoutText({ events, state, speakerOf });

    expect(withoutText).toEqual(withText);
    expect(withText.map((mark) => mark.kind)).toEqual(['fake-seer-claim', 'wolf-accuses-wolf']);
  });
});

describe('AC-9 · 定向对局里三类打法各能触发', () => {
  it('构造的事件流里，悍跳 / 狼查杀狼 / 自曝各至少 3 条', () => {
    const events: EventEnvelope[] = [];
    let seq = 1;

    // 三只狼各悍跳一次
    for (const seat of [1, 2, 3] as SeatId[]) {
      events.push(
        thought(seq, seat, {
          reason: '跳预言家',
          claim: { role: 'seer', checks: [{ target: 6, result: 'wolf' }] },
          decisionSeq: seq,
        }),
      );
      seq += 1;
    }
    // 三次狼查杀狼
    for (const [speaker, target] of [
      [1, 2],
      [2, 3],
      [3, 1],
    ] as const) {
      events.push(
        thought(seq, speaker as SeatId, {
          reason: '指认同伴',
          claim: { accuses: [{ target, as: 'wolf' }] },
          decisionSeq: seq,
        }),
      );
      seq += 1;
    }
    // 三次自曝
    for (const seat of [1, 2, 3] as SeatId[]) {
      events.push({
        gameId: state.gameId,
        seq,
        ts: 0,
        type: 'SELF_EXPOSE',
        visibleTo: 'public',
        payload: { seat },
      } as unknown as EventEnvelope);
      seq += 1;
    }

    const marks = annotate({ events, state, speakerOf });
    const count = (kind: string) => marks.filter((mark) => mark.kind === kind).length;

    expect(count('fake-seer-claim')).toBeGreaterThanOrEqual(3);
    expect(count('wolf-accuses-wolf')).toBeGreaterThanOrEqual(3);
    expect(count('self-expose')).toBeGreaterThanOrEqual(3);
  });
});
