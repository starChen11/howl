import { describe, expect, it } from 'vitest';

import type { GameState, SeatId } from '@shared/domain';
import type { GameEvent } from '@shared/events';
import { PAYLOAD_SCHEMAS } from '@shared/schemas';
import { formatHalfVotes } from '@shared/votes';

import { applyEvent } from '@engine/apply';
import { InvalidEventStreamError } from '@engine/errors';
import { currentSpeaker, dayAnnounceEntry, speechOrder } from '@engine/phases/day';
import {
  activeCandidatesOf,
  badgeOf,
  candidatesOf,
  nextSheriffSpeaker,
  pendingSheriffVoters,
  pendingWithdrawals,
  sheriffElectionView,
  sheriffFinalSpeechDraft,
  sheriffOrderOptions,
  sheriffResultEntry,
  sheriffSeatOf,
  sheriffSpeechDraft,
  votersOf,
  electionStepOf,
} from '@engine/phases/sheriff';
import { replay } from '@engine/replay';
import { step } from '@engine/step';

import { anyRoleSeat, run } from '../fixtures/night';
import { sheriffSignupTrace, signupSeats, skipSheriffElection } from '../fixtures/sheriff';

/**
 * RFC-022 · 完整警长竞选与警徽。
 *
 * 覆盖：首夜死亡延后、9 人竞选、退水、警下投票、平票 PK/重投、无警长边界、1.5 票、
 * 发言顺序与归票、警徽移交/撕徽、竞选期自曝、事件可重放。
 */

type ElectionAtSignup = ReturnType<typeof sheriffSignupTrace>;

/** 沿真实路径走到 `DAY_SHERIFF_SIGNUP`：夜聊 → 刀 → 查验 → 女巫不用药。 */
function atSignup(options: { seed?: number; killTarget?: SeatId } = {}): ElectionAtSignup {
  return sheriffSignupTrace(options);
}

/** 让全部候选人各跳过一次竞选发言，直到退水阶段。 */
function speakCandidates(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.phase !== 'DAY_SHERIFF_SPEECH' && current.phase !== 'DAY_SHERIFF_PK') break;
    const seat = nextSheriffSpeaker(current);
    if (seat === undefined) break;
    current = step(current, { type: 'SPEECH_SKIP', ts: 210, seat }).state;
  }
  return current;
}

/** 让全部候选人表态退水/不退水；返回值停在投票或结果之后。 */
function respondWithdrawals(state: GameState, withdrawOf: (seat: SeatId) => boolean): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.phase !== 'DAY_SHERIFF_WITHDRAW') break;
    const seat = pendingWithdrawals(current)[0];
    if (seat === undefined) break;
    current = step(current, {
      type: 'SHERIFF_WITHDRAW',
      ts: 220,
      seat,
      withdraw: withdrawOf(seat),
    }).state;
  }
  return current;
}

/** 警下投票 / 重投：按当前阶段逐个投票，直到票箱关闭。 */
function castSheriffVotes(
  state: GameState,
  targetOf: (seat: SeatId, phase: GameState['phase']) => SeatId | 'abstain',
): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.phase !== 'DAY_SHERIFF_VOTE' && current.phase !== 'DAY_SHERIFF_RUNOFF') break;
    const seat = pendingSheriffVoters(current)[0];
    if (seat === undefined) break;
    const target = targetOf(seat, current.phase);
    current = step(current, { type: 'SHERIFF_VOTE', ts: 230, seat, target }).state;
  }
  return current;
}

/** 完整竞选：指定候选人 → 全员发言 → 退水 → 警下投票。 */
function runElection(
  state: GameState,
  candidates: readonly SeatId[],
  options: {
    withdrawOf?: (seat: SeatId) => boolean;
    voteOf?: (seat: SeatId, phase: GameState['phase']) => SeatId | 'abstain';
  } = {},
): GameState {
  const signed = signupSeats(state, candidates).state;
  const spoken = speakCandidates(signed);
  const withdrawn = respondWithdrawals(spoken, options.withdrawOf ?? (() => false));
  return castSheriffVotes(
    withdrawn,
    options.voteOf ?? ((seat) => candidates.find((candidate) => candidate !== seat) ?? 'abstain'),
  );
}

/** 一个不是 hunter / seer / witch（默认）且不在禁止集合里的席位。 */
function pickSeat(
  state: GameState,
  predicate: (seat: GameState['seats'][number]) => boolean,
  excluded: readonly SeatId[] = [],
): SeatId {
  const found = state.seats.find(
    (seat) => seat.alive && !excluded.includes(seat.seat) && predicate(seat),
  );
  if (found === undefined) throw new Error('夹具找不到符合条件的席位');
  return found.seat;
}

/** 选一个村民接警徽（避免放逐警长时误触狼胜/神全灭）。 */
function villagerSeat(state: GameState, excluded: readonly SeatId[] = []): SeatId {
  return pickSeat(state, (seat) => seat.role === 'villager', excluded);
}

// ---------------------------------------------------------------------------

describe('AC-1 · 首夜结算后先竞选，死讯尚未落地', () => {
  it('进入 DAY_SHERIFF_SIGNUP 时 9 人全部存活，且没有 DAY_STARTED / PLAYER_DIED', () => {
    const at = atSignup();
    const all = [...at.events];

    expect(at.state.phase).toBe('DAY_SHERIFF_SIGNUP');
    expect(at.state.seats).toHaveLength(9);
    expect(at.state.seats.every((seat) => seat.alive)).toBe(true);
    expect(all.some((event) => event.type === 'DAY_STARTED')).toBe(false);
    expect(all.some((event) => event.type === 'PLAYER_DIED')).toBe(false);
    expect(all.some((event) => event.type === 'SHERIFF_ELECTION_STARTED')).toBe(true);
  });

  it('走完竞选后 DAY_ANNOUNCE 才公布死讯并让死者出局', () => {
    const at = atSignup();
    const skipped = skipSheriffElection(at.state);
    const events = [...at.events, ...skipped.events];

    const started = events.find((event) => event.type === 'DAY_STARTED');
    expect(started?.type).toBe('DAY_STARTED');
    if (started?.type !== 'DAY_STARTED') throw new Error('没有 DAY_STARTED');
    expect(started.payload.diedLastNight).toContain(at.killTarget);

    const died = events.find((event) => event.type === 'PLAYER_DIED');
    expect(died?.payload).toEqual(expect.objectContaining({ seat: at.killTarget }));

    expect(skipped.state.phase).toBe('DAY_SPEECH');
    expect(skipped.state.seats.find((seat) => seat.seat === at.killTarget)?.alive).toBe(false);
  });
});

describe('AC-2 / AC-3 · 上警、警上发言、退水与警下投票权', () => {
  it('9 人各表态一次；候选人按座位顺序发言；只有从未上警的人能投票', () => {
    const at = atSignup();
    const candidates = [at.state.seats[1]?.seat, at.state.seats[4]?.seat, at.state.seats[6]?.seat]
      .filter((seat): seat is SeatId => seat !== undefined)
      .sort((a, b) => a - b);

    const signed = signupSeats(at.state, candidates).state;

    expect(signed.phase).toBe('DAY_SHERIFF_SPEECH');
    expect(candidatesOf(signed)).toEqual(candidates);
    expect(signed.sheriffSignups).toHaveLength(9);
    // 警下 = 没上警的 6 人；上警者（哪怕后来退水）没有警长投票权。
    expect(votersOf(signed)).toEqual(
      at.state.seats
        .map((seat) => seat.seat)
        .filter((seat) => !candidates.includes(seat))
        .sort((a, b) => a - b),
    );
    expect(sheriffElectionView(signed, candidates[0]).isCandidate).toBe(true);
    expect(sheriffElectionView(signed, candidates[0]).isVoter).toBe(false);

    const order = speechOrder(signed);
    expect(order).toEqual(candidates);

    const spoken = speakCandidates(signed);
    expect(spoken.phase).toBe('DAY_SHERIFF_WITHDRAW');
    // 竞选发言使用独立 cursor / 独立事件，不污染白天的 speech（RFC-022 §13.2）。
    expect(spoken.speech).toBeUndefined();
    expect(spoken.sheriffSpeech?.spoken).toEqual(candidates);

    const withdrawn = respondWithdrawals(spoken, (seat) => seat === candidates[1]);
    expect(withdrawn.phase).toBe('DAY_SHERIFF_VOTE');
    expect(activeCandidatesOf(withdrawn)).toEqual(
      [candidates[0] as SeatId, candidates[2] as SeatId].sort((a, b) => a - b),
    );

    // 退水者仍是「上过警」：不能投警长票。
    const rejected = step(withdrawn, {
      type: 'SHERIFF_VOTE',
      ts: 240,
      seat: candidates[1] as SeatId,
      target: candidates[0] as SeatId,
    });
    expect(rejected.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_A_VOTER' }));
  });

  it('警上非候选人不能插话，也不能提交退水', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[3]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const outsider = at.state.seats.find((seat) => !candidates.includes(seat.seat));
    if (outsider === undefined) throw new Error('没有警下玩家');

    const speech = step(signed, {
      type: 'SPEECH',
      ts: 250,
      seat: outsider.seat,
      text: '我插一句',
    });
    expect(speech.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });
});

describe('AC-4 · 平票 PK、重投与二次平票无警长', () => {
  it('首轮平票 → 并列者 PK → 重投再次平票 → 无警长', () => {
    const at = atSignup();
    const candidates = at.state.seats.slice(0, 3).map((seat) => seat.seat);
    const voters = at.state.seats
      .map((seat) => seat.seat)
      .filter((seat) => !candidates.includes(seat));
    // 3 名候选人 → 6 名警下投票人；首轮 2:2:2 平票。
    expect(voters).toHaveLength(6);

    const firstVote = new Map<SeatId, SeatId>();
    voters.forEach((seat, index) => {
      firstVote.set(seat, candidates[index % 3] as SeatId);
    });

    const voted = runElection(at.state, candidates, {
      voteOf: (seat) => firstVote.get(seat) ?? 'abstain',
    });

    expect(voted.phase).toBe('DAY_SHERIFF_PK');
    expect(voted.sheriffRunoff).toEqual([...candidates].sort((a, b) => a - b));

    const pk = speakCandidates(voted);
    expect(pk.phase).toBe('DAY_SHERIFF_RUNOFF');

    // 6 人重投，只能投并列者且不能弃权；再次 2:2:2 → 无警长。
    const runoff = castSheriffVotes(pk, (seat) => firstVote.get(seat) as SeatId);

    expect(sheriffSeatOf(runoff)).toBeNull();
    expect(badgeOf(runoff)).toBe('none');
    expect(runoff.sheriffElectionFailure).toBe('double-tie');
    expect(runoff.phase).toBe('DAY_SPEECH');
  });

  it('重投唯一最高票当选，且重投不能弃权、不能投非并列者', () => {
    const at = atSignup();
    const candidates = at.state.seats.slice(0, 3).map((seat) => seat.seat);
    const voters = at.state.seats
      .map((seat) => seat.seat)
      .filter((seat) => !candidates.includes(seat));
    expect(voters).toHaveLength(6);

    const firstVote = new Map<SeatId, SeatId>();
    voters.forEach((seat, index) => {
      firstVote.set(seat, candidates[index % 3] as SeatId);
    });

    const voted = runElection(at.state, candidates, {
      voteOf: (seat) => firstVote.get(seat) ?? 'abstain',
    });
    expect(voted.phase).toBe('DAY_SHERIFF_PK');

    const pk = speakCandidates(voted);
    expect(pk.phase).toBe('DAY_SHERIFF_RUNOFF');

    const abstainAttempt = step(pk, {
      type: 'SHERIFF_VOTE',
      ts: 260,
      seat: voters[0] as SeatId,
      target: 'abstain',
    });
    expect(abstainAttempt.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'INVALID_RUNOFF_TARGET' }),
    );

    const outsiderTarget = step(pk, {
      type: 'SHERIFF_VOTE',
      ts: 261,
      seat: voters[0] as SeatId,
      target: at.killTarget,
    });
    expect(outsiderTarget.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'INVALID_RUNOFF_TARGET' }),
    );

    // 重投：A 3 票、B 2 票、C 1 票 → A 当选。
    const runoff = castSheriffVotes(pk, (seat) => {
      const index = voters.indexOf(seat);
      if (index < 3) return candidates[0] as SeatId;
      if (index < 5) return candidates[1] as SeatId;
      return candidates[2] as SeatId;
    });
    expect(sheriffSeatOf(runoff)).toBe(candidates[0]);
    expect(badgeOf(runoff)).toBe('held');
  });
});

describe('AC-5 · 无警长的三种边界', () => {
  it('无人上警 → 本局无警长', () => {
    const at = atSignup();
    const skipped = skipSheriffElection(at.state);
    expect(skipped.state.sheriffElectionFailure).toBe('no-candidates');
    expect(sheriffSeatOf(skipped.state)).toBeNull();
    expect(badgeOf(skipped.state)).toBe('none');
    expect(skipped.state.phase).toBe('DAY_SPEECH');
  });

  it('全员上警且无人退水 → 没有警下投票人 → 无警长', () => {
    const at = atSignup();
    const all = at.state.seats.map((seat) => seat.seat);
    const signed = signupSeats(at.state, all).state;
    expect(votersOf(signed)).toEqual([]);

    const spoken = speakCandidates(signed);
    const withdrawn = respondWithdrawals(spoken, () => false);

    expect(withdrawn.sheriffElectionFailure).toBe('no-voters');
    expect(sheriffSeatOf(withdrawn)).toBeNull();
    expect(withdrawn.phase).toBe('DAY_SPEECH');
  });

  it('警下全员弃权 → 无有效票 → 无警长', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const voted = runElection(at.state, candidates, { voteOf: () => 'abstain' });
    expect(voted.sheriffElectionFailure).toBe('no-valid-votes');
    expect(sheriffSeatOf(voted)).toBeNull();
    expect(voted.phase).toBe('DAY_SPEECH');
  });

  it('上警者全部退水 → 无警长', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const spoken = speakCandidates(signed);
    const withdrawn = respondWithdrawals(spoken, () => true);
    expect(withdrawn.sheriffElectionFailure).toBe('all-withdrawn');
    expect(sheriffSeatOf(withdrawn)).toBeNull();
  });

  it('退水后只剩一名候选人 → 直接当选，不投票', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const expectedWinner = candidates[0] as SeatId;
    const signed = signupSeats(at.state, candidates).state;
    const spoken = speakCandidates(signed);
    const elected = respondWithdrawals(spoken, (seat) => seat !== expectedWinner);

    expect(sheriffSeatOf(elected)).toBe(expectedWinner);
    expect(badgeOf(elected)).toBe('held');
    // 结果自动阶段之后直接进入天亮流程；有警长 → 警长先选顺序。
    expect(elected.phase).toBe('DAY_SHERIFF_ORDER');
  });
});

describe('AC-12 · 首夜死者可以上警、发言与投票', () => {
  it('首夜死者可上警并当选；死讯公布后才触发警徽移交', () => {
    const at = atSignup();
    // 让首夜死者成为唯一候选人：竞选期间他仍然 alive，因此可以上警/发言。
    const deadCandidate = at.killTarget;
    const signed = signupSeats(at.state, [deadCandidate]).state;
    expect(signed.phase).toBe('DAY_SHERIFF_SPEECH');
    expect(signed.seats.find((seat) => seat.seat === deadCandidate)?.alive).toBe(true);

    const spoken = speakCandidates(signed);
    const withdrawn = respondWithdrawals(spoken, () => false);
    expect(sheriffSeatOf(withdrawn)).toBe(deadCandidate);

    // DAY_ANNOUNCE 落地首夜死亡 → 警长死亡 → 移交阶段。
    expect(withdrawn.phase).toBe('DAY_BADGE_TRANSFER');
    expect(withdrawn.seats.find((seat) => seat.seat === deadCandidate)?.alive).toBe(false);
    expect(withdrawn.sheriffSeat).toBe(deadCandidate);
  });

  it('首夜死者作为警下玩家投票，票计入唱票', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined && seat !== at.killTarget,
    );
    const signed = signupSeats(at.state, candidates).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, () => false);

    expect(pendingSheriffVoters(voting)).toContain(at.killTarget);

    // 7 名警下玩家：死者 + 2 人投 A、3 人投 B、1 人弃权 → 3:3 平票。
    const others = votersOf(voting).filter((seat) => seat !== at.killTarget);
    const voteOf = (seat: SeatId): SeatId | 'abstain' => {
      if (seat === at.killTarget) return candidates[0] as SeatId;
      const index = others.indexOf(seat);
      if (index < 2) return candidates[0] as SeatId;
      if (index < 5) return candidates[1] as SeatId;
      return 'abstain';
    };

    const voted = castSheriffVotes(voting, voteOf);
    const revealed = voted.phase === 'DAY_SHERIFF_PK' ? voted : null;
    expect(revealed).not.toBeNull();
    expect(sheriffSeatOf(voted)).toBeNull();
  });
});

describe('AC-6 · 警长 1.5 票与折算票型', () => {
  it('原始票数打平时，警长的 1.5 票让目标唯一最高', () => {
    const at = atSignup();
    const sheriff = villagerSeat(at.state, [at.killTarget]);
    const rival = pickSeat(at.state, (seat) => seat.seat !== sheriff);
    const signed = signupSeats(at.state, [sheriff, rival]).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, (seat) => seat === rival);
    const elected = castSheriffVotes(voting, (seat) =>
      seat === sheriff ? (sheriff as SeatId) : (sheriff as SeatId),
    );
    expect(sheriffSeatOf(elected)).toBe(sheriff);
    expect(elected.phase).toBe('DAY_SHERIFF_ORDER');

    // 警长选顺序 → 白天发言（警长在正常轮转中照常发言）→ 归票 → 投票。
    const option = sheriffOrderOptions(elected)[0];
    if (option === undefined) throw new Error('没有可选发言顺序');
    const speaking = step(elected, {
      type: 'SHERIFF_ORDER',
      ts: 270,
      seat: sheriff,
      startSeat: option.startSeat,
      direction: option.direction,
    }).state;
    expect(speaking.phase).toBe('DAY_SPEECH');

    let day = speaking;
    for (let guard = 0; guard < 20 && day.phase === 'DAY_SPEECH'; guard += 1) {
      const seat = currentSpeaker(day);
      if (seat === undefined) break;
      day = step(day, { type: 'SPEECH_SKIP', ts: 280, seat }).state;
    }
    expect(day.phase).toBe('DAY_SHERIFF_FINAL_SPEECH');
    expect(currentSpeaker(day)).toBe(sheriff);
    day = step(day, { type: 'SPEECH_SKIP', ts: 281, seat: sheriff }).state;
    expect(day.phase).toBe('DAY_VOTE');

    const alive = day.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    const targetA = pickSeat(day, (seat) => seat.role === 'wolf');
    const targetB = pickSeat(day, (seat) => seat.role === 'villager' && seat.seat !== sheriff, [
      targetA,
    ]);
    const normalA = alive.find((seat) => seat !== sheriff && seat !== targetA && seat !== targetB);
    if (normalA === undefined) throw new Error('缺少普通投票者');

    // 8 名存活者：警长 + 1 普通投 A（2.5 票）；2 普通投 B（2 票）；其余弃权。
    // 原始票 2:2 打平，折算后半票 5:4 → A 唯一最高。
    const voteOf = (seat: SeatId): SeatId | 'abstain' => {
      if (seat === sheriff || seat === normalA) return targetA;
      if (seat === targetB) return 'abstain';
      const others = alive.filter(
        (candidate) => candidate !== sheriff && candidate !== normalA && candidate !== targetB,
      );
      return others.indexOf(seat) < 2 ? targetB : 'abstain';
    };

    let voted = day;
    const events: GameEvent[] = [];
    for (const seat of alive) {
      const result = step(voted, { type: 'VOTE', ts: 290, seat, target: voteOf(seat) });
      voted = result.state;
      events.push(...result.events);
    }

    const revealed = events.find((event) => event.type === 'VOTE_REVEALED');
    expect(revealed?.type).toBe('VOTE_REVEALED');
    if (revealed?.type !== 'VOTE_REVEALED') throw new Error('没有 VOTE_REVEALED');

    expect(revealed.payload.sheriffSeat).toBe(sheriff);
    const counted = revealed.payload.countedVotes ?? [];
    expect(counted.find((vote) => vote.seat === sheriff)?.halfVotes).toBe(3);
    expect(
      counted.filter((vote) => vote.seat !== sheriff).every((vote) => vote.halfVotes === 2),
    ).toBe(true);

    // 票型公布里能读出「3 号 2.5 票」。
    const halfOfA = counted
      .filter((vote) => vote.target === targetA)
      .reduce((sum, vote) => sum + vote.halfVotes, 0);
    expect(halfOfA).toBe(5);
    expect(formatHalfVotes(halfOfA)).toBe('2.5');

    // 放逐后自动推进到下一夜，`state.lynched` 会被清空；以公开的 PLAYER_DIED 为准确认结果。
    const death = events.find((event) => event.type === 'PLAYER_DIED');
    expect(death?.payload).toEqual(expect.objectContaining({ seat: targetA, cause: 'lynch' }));
  });
});

describe('AC-7 · 警长决定发言起点与方向，并在最后归票', () => {
  it('单死时以死者为基准；方向写入事件；警长正常轮转发言后额外归票一次', () => {
    const at = atSignup();
    const sheriff = villagerSeat(at.state, [at.killTarget]);
    const rival = pickSeat(at.state, (seat) => seat.seat !== sheriff);

    const signed = signupSeats(at.state, [sheriff, rival]).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, (seat) => seat === rival);
    const elected = castSheriffVotes(voting, () => sheriff);
    expect(sheriffSeatOf(elected)).toBe(sheriff);

    const options = sheriffOrderOptions(elected);
    expect(options).toHaveLength(2);
    // 恰好一名死者：两个起点都必须是死者左右第一位存活玩家。
    const alive = elected.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort((a, b) => a - b);
    const clockwise = alive.find((seat) => seat > at.killTarget) ?? alive[0];
    const counter = [...alive].reverse().find((seat) => seat < at.killTarget) ?? alive.at(-1);
    expect(options.map((option) => option.startSeat).sort((a, b) => a - b)).toEqual(
      [clockwise, counter]
        .filter((seat): seat is SeatId => seat !== undefined)
        .sort((a, b) => a - b),
    );

    const chosen = options.find((option) => option.direction === 'counterclockwise') ?? options[0];
    if (chosen === undefined) throw new Error('没有可选顺序');
    const orderResult = step(elected, {
      type: 'SHERIFF_ORDER',
      ts: 300,
      seat: sheriff,
      startSeat: chosen.startSeat,
      direction: chosen.direction,
    });
    const speaking = orderResult.state;

    const chosenEvent = orderResult.events.find((event) => event.type === 'SHERIFF_ORDER_CHOSEN');
    expect(chosenEvent?.payload).toEqual({
      startSeat: chosen.startSeat,
      direction: chosen.direction,
    });
    expect(speaking.phase).toBe('DAY_SPEECH');
    expect(speaking.speechDirection).toBe(chosen.direction);
    expect(speaking.speech?.startSeat).toBe(chosen.startSeat);
    const order = speechOrder(speaking);
    expect(order[0]).toBe(chosen.startSeat);
    expect(order).toContain(sheriff);

    // 非法起点被拒：找一个不在两个合法选项里的存活席位。
    const invalidSeat = alive.find((seat) => !options.some((option) => option.startSeat === seat));
    if (invalidSeat === undefined) throw new Error('所有存活席位都是合法起点');
    const invalid = step(speaking, {
      type: 'SHERIFF_ORDER',
      ts: 301,
      seat: sheriff,
      startSeat: invalidSeat,
      direction: chosen.direction,
    });
    expect(invalid.events[0]?.type).toBe('REJECTED');

    let day = speaking;
    for (let guard = 0; guard < 20 && day.phase === 'DAY_SPEECH'; guard += 1) {
      const seat = currentSpeaker(day);
      if (seat === undefined) break;
      day = step(day, { type: 'SPEECH_SKIP', ts: 310, seat }).state;
    }
    expect(day.phase).toBe('DAY_SHERIFF_FINAL_SPEECH');

    // 归票发言只允许警长；别人提交被拒。
    const others = day.seats.find((seat) => seat.alive && seat.seat !== sheriff);
    if (others === undefined) throw new Error('没有其他存活者');
    const rejected = step(day, { type: 'SPEECH_SKIP', ts: 311, seat: others.seat });
    expect(rejected.events[0]?.type).toBe('REJECTED');

    const final = step(day, {
      type: 'SPEECH',
      ts: 312,
      seat: sheriff,
      text: '归票：我建议出 3 号。',
    }).state;
    expect(final.phase).toBe('DAY_VOTE');
    expect(final.sheriffFinalSpeechDone).toBe(true);
  });

  it('无警长时回退旧规则：DAY_ANNOUNCE 的默认起点、无归票发言', () => {
    const at = atSignup();
    const skipped = skipSheriffElection(at.state);
    expect(sheriffSeatOf(skipped.state)).toBeNull();
    expect(skipped.state.phase).toBe('DAY_SPEECH');

    const order = speechOrder(skipped.state);
    expect(order[0]).toBe(skipped.state.speech?.startSeat);

    let day = skipped.state;
    for (let guard = 0; guard < 20 && day.phase === 'DAY_SPEECH'; guard += 1) {
      const seat = currentSpeaker(day);
      if (seat === undefined) break;
      day = step(day, { type: 'SPEECH_SKIP', ts: 320, seat }).state;
    }
    expect(day.phase).toBe('DAY_VOTE');
  });
});

describe('AC-9 / AC-11 · 警长死亡后的移交与撕徽', () => {
  it('首夜警长死亡：公布死讯后移交，只能给存活他人', () => {
    const at = atSignup();
    const deadSheriff = at.killTarget;
    const signed = signupSeats(at.state, [deadSheriff]).state;
    const spoken = speakCandidates(signed);
    const transferPhase = respondWithdrawals(spoken, () => false);
    expect(transferPhase.phase).toBe('DAY_BADGE_TRANSFER');

    const successor = transferPhase.seats.find((seat) => seat.alive && seat.seat !== deadSheriff);
    if (successor === undefined) throw new Error('没有存活接任者');

    const transferred = step(transferPhase, {
      type: 'BADGE_TRANSFER',
      ts: 330,
      seat: deadSheriff,
      target: successor.seat,
    }).state;

    expect(sheriffSeatOf(transferred)).toBe(successor.seat);
    expect(badgeOf(transferred)).toBe('held');
    // 天亮流程：移交完成后由新警长选发言顺序。
    expect(transferred.phase).toBe('DAY_SHERIFF_ORDER');
  });

  it('撕徽后本局无警长，直接进入发言', () => {
    const at = atSignup();
    const deadSheriff = at.killTarget;
    const signed = signupSeats(at.state, [deadSheriff]).state;
    const spoken = speakCandidates(signed);
    const transferPhase = respondWithdrawals(spoken, () => false);

    const torn = step(transferPhase, {
      type: 'BADGE_TRANSFER',
      ts: 331,
      seat: deadSheriff,
      target: 'tear',
    }).state;

    expect(sheriffSeatOf(torn)).toBeNull();
    expect(badgeOf(torn)).toBe('destroyed');
    expect(torn.phase).toBe('DAY_SPEECH');
  });

  it('移交目标必须存活且不是自己；非法目标被拒', () => {
    const at = atSignup();
    const deadSheriff = at.killTarget;
    const signed = signupSeats(at.state, [deadSheriff]).state;
    const spoken = speakCandidates(signed);
    const transferPhase = respondWithdrawals(spoken, () => false);

    const otherDead = transferPhase.seats.find((seat) => seat.alive && seat.seat !== deadSheriff);
    if (otherDead === undefined) throw new Error('没有其他存活者');
    const withOtherDead: GameState = {
      ...transferPhase,
      seats: transferPhase.seats.map((seat) =>
        seat.seat === otherDead.seat ? { ...seat, alive: false } : seat,
      ),
    };
    const rejected = step(withOtherDead, {
      type: 'BADGE_TRANSFER',
      ts: 332,
      seat: deadSheriff,
      target: otherDead.seat,
    });
    expect(rejected.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'TARGET_NOT_ALIVE' }),
    );
  });
});

describe('AC-13 · 竞选期狼人自曝：吞警徽、公布死讯、入夜', () => {
  it('狼人在上警阶段自曝 → 无警长，仍公布首夜死讯，然后入夜', () => {
    const at = atSignup();
    const wolf = anyRoleSeat(at.state, 'wolf');

    const acted = run(at.state, { type: 'SELF_EXPOSE', ts: 340, seat: wolf });
    const events = [...at.events, ...acted.events];

    expect(sheriffSeatOf(acted.state)).toBeNull();
    expect(badgeOf(acted.state)).toBe('none');
    // 失败原因在进入夜晚时被清理；事件流里必须留下「竞选因自曝中止」。
    const failed = events.find((event) => event.type === 'SHERIFF_ELECTION_FAILED');
    expect(failed?.payload).toEqual({ reason: 'self-exposed' });
    expect(events.some((event) => event.type === 'DAY_STARTED')).toBe(true);
    expect(acted.state.seats.find((seat) => seat.seat === at.killTarget)?.alive).toBe(false);
    expect(acted.state.phase).toBe('NIGHT_WOLF_CHAT');
    expect(acted.state.day).toBe(2);
  });

  it('自曝中止竞选后，首夜猎人被刀仍在死讯公布后开枪，然后入夜', () => {
    const hunter = anyRoleSeat(atSignup().state, 'hunter');
    const at = atSignup({ killTarget: hunter });
    const wolf = anyRoleSeat(at.state, 'wolf');

    const acted = run(at.state, { type: 'SELF_EXPOSE', ts: 341, seat: wolf });
    expect(sheriffSeatOf(acted.state)).toBeNull();
    expect(acted.state.phase).toBe('NIGHT_HUNTER_SHOOT');
    expect(acted.state.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);

    const target = acted.state.seats.find(
      (seat) => seat.alive && seat.role !== 'hunter' && seat.seat !== wolf,
    )?.seat;
    if (target === undefined) throw new Error('没有可开枪目标');
    const shot = step(acted.state, {
      type: 'HUNTER_SHOOT',
      ts: 342,
      seat: hunter,
      target,
    }).state;

    expect(shot.phase).toBe('NIGHT_WOLF_CHAT');
    expect(shot.day).toBe(2);
  });
});

describe('AC-15 · 竞选、票权与移交全部进入事件流且可重放', () => {
  it('跑完一场有警长、有 PK、有移交的流程后 replay 得到同一状态', () => {
    const at = atSignup();
    const sheriff = villagerSeat(at.state, [at.killTarget]);
    const rival = pickSeat(at.state, (seat) => seat.seat !== sheriff);
    const voters = at.state.seats
      .map((seat) => seat.seat)
      .filter((seat) => seat !== sheriff && seat !== rival);

    const allEvents: GameEvent[] = [...at.events];
    let current = at.state;
    const push = (state: GameState, events: readonly GameEvent[]) => {
      current = state;
      allEvents.push(...events);
    };

    // 上警：sheriff 与 rival。
    const signed = signupSeats(current, [sheriff, rival]);
    push(signed.state, signed.events);

    let cursor = current;
    for (let guard = 0; guard < 20 && cursor.phase === 'DAY_SHERIFF_SPEECH'; guard += 1) {
      const seat = nextSheriffSpeaker(cursor);
      if (seat === undefined) break;
      const result = step(cursor, { type: 'SPEECH_SKIP', ts: 400, seat });
      push(result.state, result.events);
      cursor = result.state;
    }

    // 首轮 3:3 平票（7 名警下玩家，1 人弃权）。
    const firstTargets = new Map<SeatId, SeatId | 'abstain'>();
    voters.forEach((seat, index) => {
      if (index < 3) firstTargets.set(seat, sheriff);
      else if (index < 6) firstTargets.set(seat, rival);
      else firstTargets.set(seat, 'abstain');
    });

    for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_WITHDRAW'; guard += 1) {
      const seat = pendingWithdrawals(current)[0];
      if (seat === undefined) break;
      const result = step(current, {
        type: 'SHERIFF_WITHDRAW',
        ts: 401,
        seat,
        withdraw: false,
      });
      push(result.state, result.events);
    }

    for (
      let guard = 0;
      guard < 20 &&
      (current.phase === 'DAY_SHERIFF_VOTE' || current.phase === 'DAY_SHERIFF_RUNOFF');
      guard += 1
    ) {
      const seat = pendingSheriffVoters(current)[0];
      if (seat === undefined) break;
      const target = firstTargets.get(seat) ?? 'abstain';
      const result = step(current, { type: 'SHERIFF_VOTE', ts: 402, seat, target });
      push(result.state, result.events);
    }

    // 首轮平票 → PK 发言 → 重投。这里重投让 sheriff 当选。
    for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_PK'; guard += 1) {
      const seat = nextSheriffSpeaker(current);
      if (seat === undefined) break;
      const result = step(current, { type: 'SPEECH_SKIP', ts: 403, seat });
      push(result.state, result.events);
    }

    for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_RUNOFF'; guard += 1) {
      const seat = pendingSheriffVoters(current)[0];
      if (seat === undefined) break;
      const result = step(current, { type: 'SHERIFF_VOTE', ts: 404, seat, target: sheriff });
      push(result.state, result.events);
    }

    expect(sheriffSeatOf(current)).toBe(sheriff);
    expect(current.phase).toBe('DAY_SHERIFF_ORDER');

    const option = sheriffOrderOptions(current)[0];
    if (option === undefined) throw new Error('没有可选顺序');
    const ordered = step(current, {
      type: 'SHERIFF_ORDER',
      ts: 405,
      seat: sheriff,
      startSeat: option.startSeat,
      direction: option.direction,
    });
    push(ordered.state, ordered.events);

    for (let guard = 0; guard < 20 && current.phase === 'DAY_SPEECH'; guard += 1) {
      const seat = currentSpeaker(current);
      if (seat === undefined) break;
      const result = step(current, { type: 'SPEECH_SKIP', ts: 406, seat });
      push(result.state, result.events);
    }

    for (let guard = 0; guard < 20 && current.phase === 'DAY_SHERIFF_FINAL_SPEECH'; guard += 1) {
      const seat = currentSpeaker(current);
      if (seat === undefined) break;
      const result = step(current, { type: 'SPEECH_SKIP', ts: 407, seat });
      push(result.state, result.events);
    }

    expect(current.phase).toBe('DAY_VOTE');
    expect(allEvents.some((event) => event.type === 'SHERIFF_ELECTED')).toBe(true);
    expect(allEvents.some((event) => event.type === 'SHERIFF_ORDER_CHOSEN')).toBe(true);
    expect(allEvents.some((event) => event.type === 'SHERIFF_VOTE_REVEALED')).toBe(true);
    expect(replay(allEvents)).toEqual(current);

    // 每个有 schema 的新事件都能通过 Zod 校验。
    for (const event of allEvents) {
      const schema = PAYLOAD_SCHEMAS[event.type as keyof typeof PAYLOAD_SCHEMAS];
      if (schema === undefined) continue;
      const parsed = schema.safeParse(event.payload);
      expect(
        parsed.success,
        `${event.type} 的 payload 未通过 schema：${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    }
  });
});

describe('AC-10 · 白天放逐警长：先结算死亡，再移交，然后入夜', () => {
  /** 走到一个有警长的 `DAY_VOTE`；警长选的是一名不会因放逐直接结束对局的村民。 */
  function sheriffDay(): { state: GameState; sheriff: SeatId } {
    const at = atSignup();
    const sheriff = villagerSeat(at.state, [at.killTarget]);
    const rival = pickSeat(at.state, (seat) => seat.seat !== sheriff);

    const signed = signupSeats(at.state, [sheriff, rival]).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, (seat) => seat === rival);
    const elected = castSheriffVotes(voting, () => sheriff);
    expect(sheriffSeatOf(elected)).toBe(sheriff);

    const option = sheriffOrderOptions(elected)[0];
    if (option === undefined) throw new Error('没有可选顺序');
    let current = step(elected, {
      type: 'SHERIFF_ORDER',
      ts: 500,
      seat: sheriff,
      startSeat: option.startSeat,
      direction: option.direction,
    }).state;

    for (let guard = 0; guard < 20 && current.phase === 'DAY_SPEECH'; guard += 1) {
      const seat = currentSpeaker(current);
      if (seat === undefined) break;
      current = step(current, { type: 'SPEECH_SKIP', ts: 501, seat }).state;
    }
    if (current.phase !== 'DAY_SHERIFF_FINAL_SPEECH') throw new Error('没有进入归票发言');
    current = step(current, { type: 'SPEECH_SKIP', ts: 502, seat: sheriff }).state;
    expect(current.phase).toBe('DAY_VOTE');
    return { state: current, sheriff };
  }

  it('放逐警长 → DAY_BADGE_TRANSFER；移交/撕徽后才入夜', () => {
    const { state, sheriff } = sheriffDay();
    const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);

    let current = state;
    for (const seat of alive) {
      current = step(current, { type: 'VOTE', ts: 510, seat, target: sheriff }).state;
    }

    expect(current.phase).toBe('DAY_BADGE_TRANSFER');
    expect(current.sheriffSeat).toBe(sheriff);
    expect(current.seats.find((seat) => seat.seat === sheriff)?.alive).toBe(false);
    expect(current.badge).toBe('held');

    const successor = current.seats.find((seat) => seat.alive && seat.seat !== sheriff);
    if (successor === undefined) throw new Error('没有接任者');
    const transferred = step(current, {
      type: 'BADGE_TRANSFER',
      ts: 511,
      seat: sheriff,
      target: successor.seat,
    }).state;

    expect(sheriffSeatOf(transferred)).toBe(successor.seat);
    expect(transferred.phase).toBe('NIGHT_WOLF_CHAT');
    expect(transferred.day).toBe(state.day + 1);
  });

  it('放逐后撕徽 → 本局不再有警长，随即入夜', () => {
    const { state, sheriff } = sheriffDay();
    const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);

    let current = state;
    for (const seat of alive) {
      current = step(current, { type: 'VOTE', ts: 520, seat, target: sheriff }).state;
    }
    expect(current.phase).toBe('DAY_BADGE_TRANSFER');

    const torn = step(current, {
      type: 'BADGE_TRANSFER',
      ts: 521,
      seat: sheriff,
      target: 'tear',
    }).state;

    expect(sheriffSeatOf(torn)).toBeNull();
    expect(badgeOf(torn)).toBe('destroyed');
    expect(torn.phase).toBe('NIGHT_WOLF_CHAT');
  });

  it('猎人被放逐后开枪带走警长 → 先结算枪，再移交/撕徽', () => {
    const { state, sheriff } = sheriffDay();
    const hunter = state.seats.find((seat) => seat.alive && seat.role === 'hunter')?.seat;
    if (hunter === undefined) throw new Error('没有存活猎人');

    const alive = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
    let current = state;
    for (const seat of alive) {
      current = step(current, { type: 'VOTE', ts: 550, seat, target: hunter }).state;
    }
    expect(current.phase).toBe('DAY_HUNTER_SHOOT');

    const shot = step(current, {
      type: 'HUNTER_SHOOT',
      ts: 551,
      seat: hunter,
      target: sheriff,
    }).state;

    expect(shot.phase).toBe('DAY_BADGE_TRANSFER');
    expect(shot.sheriffSeat).toBe(sheriff);
    expect(shot.seats.find((seat) => seat.seat === sheriff)?.alive).toBe(false);

    const successor = shot.seats.find((seat) => seat.alive && seat.seat !== sheriff);
    if (successor === undefined) throw new Error('没有接任者');
    const transferred = step(shot, {
      type: 'BADGE_TRANSFER',
      ts: 552,
      seat: sheriff,
      target: successor.seat,
    }).state;

    expect(sheriffSeatOf(transferred)).toBe(successor.seat);
    expect(transferred.phase).toBe('NIGHT_WOLF_CHAT');
  });
});

describe('AC-9 · 首夜猎人当选警长：公布死讯 → 开枪 → 移交', () => {
  it('猎人先开枪，再处理警徽移交', () => {
    const hunter = anyRoleSeat(atSignup().state, 'hunter');
    const at = atSignup({ killTarget: hunter });

    const signed = signupSeats(at.state, [hunter]).state;
    const spoken = speakCandidates(signed);
    const shootPhase = respondWithdrawals(spoken, () => false);

    expect(sheriffSeatOf(shootPhase)).toBe(hunter);
    expect(shootPhase.phase).toBe('NIGHT_HUNTER_SHOOT');
    expect(shootPhase.seats.find((seat) => seat.seat === hunter)?.alive).toBe(false);

    const target = shootPhase.seats.find((seat) => seat.alive && seat.seat !== hunter)?.seat;
    if (target === undefined) throw new Error('没有可开枪目标');
    const shot = step(shootPhase, { type: 'HUNTER_SHOOT', ts: 530, seat: hunter, target }).state;

    expect(shot.phase).toBe('DAY_BADGE_TRANSFER');
    expect(shot.sheriffSeat).toBe(hunter);
    expect(shot.seats.find((seat) => seat.seat === target)?.alive).toBe(false);

    const successor = shot.seats.find((seat) => seat.alive && seat.seat !== hunter);
    if (successor === undefined) throw new Error('没有接任者');
    const transferred = step(shot, {
      type: 'BADGE_TRANSFER',
      ts: 531,
      seat: hunter,
      target: successor.seat,
    }).state;
    expect(sheriffSeatOf(transferred)).toBe(successor.seat);
    expect(transferred.phase).toBe('DAY_SHERIFF_ORDER');
  });
});

describe('AC-3 · 警长票是暗投：唱票前只有投票者本人看得到', () => {
  it('SHERIFF_VOTE_CAST 是 self:<seat>，唱票才是 public', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, () => false);
    const voter = pendingSheriffVoters(voting)[0];
    if (voter === undefined) throw new Error('没有警下投票人');

    const first = step(voting, {
      type: 'SHERIFF_VOTE',
      ts: 540,
      seat: voter,
      target: candidates[0] as SeatId,
    });
    const cast = first.events.find((event) => event.type === 'SHERIFF_VOTE_CAST');
    expect(cast?.visibleTo).toBe(`self:${voter}`);
    expect(first.events.some((event) => event.type === 'SHERIFF_VOTE_REVEALED')).toBe(false);

    let current = first.state;
    let lastEvents: ReturnType<typeof step>['events'] = [];
    for (const seat of pendingSheriffVoters(current)) {
      const result = step(current, {
        type: 'SHERIFF_VOTE',
        ts: 541,
        seat,
        target: candidates[0] as SeatId,
      });
      current = result.state;
      lastEvents = result.events;
    }
    const revealed = lastEvents.find((event) => event.type === 'SHERIFF_VOTE_REVEALED');
    expect(revealed?.visibleTo).toBe('public');
  });
});

describe('AC-7 · 发言顺序基准（纯函数）', () => {
  function withSheriff(): { state: GameState; sheriff: SeatId } {
    const at = atSignup();
    const sheriff = villagerSeat(at.state, [at.killTarget]);
    const rival = pickSeat(at.state, (seat) => seat.seat !== sheriff);
    const signed = signupSeats(at.state, [sheriff, rival]).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, (seat) => seat === rival);
    const elected = castSheriffVotes(voting, () => sheriff);
    return { state: elected, sheriff };
  }

  it('平安夜 / 多人死亡：以警长为基准取左右第一位存活玩家', () => {
    const { state, sheriff } = withSheriff();

    for (const deaths of [[], [state.seats[0]?.seat, state.seats[1]?.seat]]) {
      const options = sheriffOrderOptions({
        ...state,
        lastNightDeaths: deaths.filter((seat): seat is SeatId => seat !== undefined),
      });
      expect(options).toHaveLength(2);
      // 两个起点都不能是警长本人。
      expect(options.every((option) => option.startSeat !== sheriff)).toBe(true);
    }
  });

  it('恰好一名死者：以死者为基准，起点可以是警长本人（如果他就坐在死者旁边）', () => {
    const { state, sheriff } = withSheriff();
    const dead = state.seats.find((seat) => seat.alive && seat.seat !== sheriff)?.seat;
    if (dead === undefined) throw new Error('没有可作死者的座位');

    const options = sheriffOrderOptions({ ...state, lastNightDeaths: [dead] });
    expect(options).toHaveLength(2);
    const alive = state.seats
      .filter((seat) => seat.alive)
      .map((seat) => seat.seat)
      .sort((a, b) => a - b);
    const clockwise = alive.find((seat) => seat > dead) ?? alive[0];
    const counter = [...alive].reverse().find((seat) => seat < dead) ?? alive.at(-1);
    expect(options.map((option) => option.startSeat).sort((a, b) => a - b)).toEqual(
      [clockwise, counter]
        .filter((seat): seat is SeatId => seat !== undefined)
        .sort((a, b) => a - b),
    );
  });
});

describe('RFC-022 · 非法动作与事件流完整性', () => {
  it('上警：已出局与重复表态被拒', () => {
    const at = atSignup();
    const dead = at.killTarget;
    const deadState: GameState = {
      ...at.state,
      seats: at.state.seats.map((seat) => (seat.seat === dead ? { ...seat, alive: false } : seat)),
    };
    const deadResult = step(deadState, {
      type: 'SHERIFF_SIGNUP',
      ts: 600,
      seat: dead,
      run: true,
    });
    expect(deadResult.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_ALIVE' }));

    const first = step(at.state, { type: 'SHERIFF_SIGNUP', ts: 601, seat: 1, run: false });
    const again = step(first.state, { type: 'SHERIFF_SIGNUP', ts: 602, seat: 1, run: true });
    expect(again.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'ALREADY_SIGNED_UP' }),
    );
  });

  it('退水：非候选人、重复表态、已出局被拒', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const withdrawals = speakCandidates(signed);
    const outsider = at.state.seats.find((seat) => !candidates.includes(seat.seat))?.seat;
    if (outsider === undefined) throw new Error('没有非候选人');

    const nonCandidate = step(withdrawals, {
      type: 'SHERIFF_WITHDRAW',
      ts: 610,
      seat: outsider,
      withdraw: true,
    });
    expect(nonCandidate.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'NOT_CANDIDATE' }),
    );

    const first = step(withdrawals, {
      type: 'SHERIFF_WITHDRAW',
      ts: 611,
      seat: candidates[0] as SeatId,
      withdraw: false,
    });
    const again = step(first.state, {
      type: 'SHERIFF_WITHDRAW',
      ts: 612,
      seat: candidates[0] as SeatId,
      withdraw: true,
    });
    expect(again.events[0]?.payload).toEqual(expect.objectContaining({ code: 'ALREADY_WITHDREW' }));

    const deadState: GameState = {
      ...withdrawals,
      seats: withdrawals.seats.map((seat) =>
        seat.seat === candidates[1] ? { ...seat, alive: false } : seat,
      ),
    };
    const dead = step(deadState, {
      type: 'SHERIFF_WITHDRAW',
      ts: 613,
      seat: candidates[1] as SeatId,
      withdraw: false,
    });
    expect(dead.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_ALIVE' }));
  });

  it('警长票：重复投票被拒', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const spoken = speakCandidates(signed);
    const voting = respondWithdrawals(spoken, () => false);
    const voter = pendingSheriffVoters(voting)[0];
    if (voter === undefined) throw new Error('没有投票人');

    const first = step(voting, {
      type: 'SHERIFF_VOTE',
      ts: 620,
      seat: voter,
      target: candidates[0] as SeatId,
    });
    const again = step(first.state, {
      type: 'SHERIFF_VOTE',
      ts: 621,
      seat: voter,
      target: candidates[1] as SeatId,
    });
    expect(again.events[0]?.payload).toEqual(expect.objectContaining({ code: 'ALREADY_VOTED' }));
  });

  it('警徽移交：无警长、非当前警长、活警长、缺少/非法来源都被拦下', () => {
    const at = atSignup();

    const noSheriff: GameState = {
      ...at.state,
      phase: 'DAY_BADGE_TRANSFER',
      sheriffSeat: null,
      badge: 'none',
      badgeTransferFrom: 'DAY_ANNOUNCE',
    };
    const rejected = step(noSheriff, {
      type: 'BADGE_TRANSFER',
      ts: 630,
      seat: 1,
      target: 'tear',
    });
    expect(rejected.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_SHERIFF' }));

    const dead = at.killTarget;
    const deadSeatState: GameState = {
      ...at.state,
      phase: 'DAY_BADGE_TRANSFER',
      sheriffSeat: dead,
      badge: 'held',
      seats: at.state.seats.map((seat) => (seat.seat === dead ? { ...seat, alive: false } : seat)),
    };

    const wrongSeat = step(deadSeatState, {
      type: 'BADGE_TRANSFER',
      ts: 631,
      seat: 1,
      target: 'tear',
    });
    expect(wrongSeat.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'NOT_YOUR_TURN' }),
    );

    expect(() =>
      step(deadSeatState, {
        type: 'BADGE_TRANSFER',
        ts: 632,
        seat: dead,
        target: 'tear',
      }),
    ).toThrow(InvalidEventStreamError);

    expect(() =>
      step(
        { ...deadSeatState, badgeTransferFrom: 'DAY_VOTE' },
        { type: 'BADGE_TRANSFER', ts: 633, seat: dead, target: 'tear' },
      ),
    ).toThrow(InvalidEventStreamError);

    const aliveSheriff: GameState = {
      ...at.state,
      phase: 'DAY_BADGE_TRANSFER',
      sheriffSeat: 1,
      badge: 'held',
      badgeTransferFrom: 'DAY_ANNOUNCE',
    };
    const alive = step(aliveSheriff, {
      type: 'BADGE_TRANSFER',
      ts: 634,
      seat: 1,
      target: 'tear',
    });
    expect(alive.events[0]?.payload).toEqual(expect.objectContaining({ code: 'SHERIFF_ALIVE' }));
  });

  it('选顺序：无警长、非当前警长、已出局警长都被拒', () => {
    const at = atSignup();
    const noSheriff: GameState = {
      ...at.state,
      phase: 'DAY_SHERIFF_ORDER',
      sheriffSeat: null,
    };
    const none = step(noSheriff, {
      type: 'SHERIFF_ORDER',
      ts: 640,
      seat: 1,
      startSeat: 2,
      direction: 'clockwise',
    });
    expect(none.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_SHERIFF' }));
    expect(sheriffOrderOptions(noSheriff)).toEqual([]);

    const withSheriff: GameState = {
      ...at.state,
      phase: 'DAY_SHERIFF_ORDER',
      sheriffSeat: 1,
      badge: 'held',
    };
    const wrong = step(withSheriff, {
      type: 'SHERIFF_ORDER',
      ts: 641,
      seat: 2,
      startSeat: 2,
      direction: 'clockwise',
    });
    expect(wrong.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));

    const deadSheriff: GameState = {
      ...withSheriff,
      seats: withSheriff.seats.map((seat) => (seat.seat === 1 ? { ...seat, alive: false } : seat)),
    };
    const dead = step(deadSheriff, {
      type: 'SHERIFF_ORDER',
      ts: 642,
      seat: 1,
      startSeat: 2,
      direction: 'clockwise',
    });
    expect(dead.events[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_ALIVE' }));
  });

  it('警徽移交：不能把警徽移交给自己', () => {
    const at = atSignup();
    const dead = at.killTarget;
    const state: GameState = {
      ...at.state,
      phase: 'DAY_BADGE_TRANSFER',
      sheriffSeat: dead,
      badge: 'held',
      badgeTransferFrom: 'DAY_ANNOUNCE',
      seats: at.state.seats.map((seat) => (seat.seat === dead ? { ...seat, alive: false } : seat)),
    };
    const self = step(state, {
      type: 'BADGE_TRANSFER',
      ts: 645,
      seat: dead,
      target: dead,
    });
    expect(self.events[0]?.payload).toEqual(
      expect.objectContaining({ code: 'INVALID_BADGE_TARGET' }),
    );
  });

  it('归票阶段的发言序列：没有存活警长时为空', () => {
    const at = atSignup();
    expect(
      speechOrder({ ...at.state, phase: 'DAY_SHERIFF_FINAL_SPEECH', sheriffSeat: null }),
    ).toEqual([]);

    const deadSheriff: GameState = {
      ...at.state,
      phase: 'DAY_SHERIFF_FINAL_SPEECH',
      sheriffSeat: at.killTarget,
      seats: at.state.seats.map((seat) =>
        seat.seat === at.killTarget ? { ...seat, alive: false } : seat,
      ),
    };
    expect(speechOrder(deadSheriff)).toEqual([]);
  });

  it('旧事件流的首夜死亡已落地时，DAY_ANNOUNCE 不会重复产出 PLAYER_DIED', () => {
    const at = atSignup();
    const dead = at.killTarget;
    const oldStyle: GameState = {
      ...at.state,
      phase: 'DAY_ANNOUNCE',
      dayAnnounced: false,
      pendingDeaths: [dead],
      night: { killTarget: dead },
      seats: at.state.seats.map((seat) => (seat.seat === dead ? { ...seat, alive: false } : seat)),
    };

    const drafts = dayAnnounceEntry(oldStyle);
    expect(drafts.some((draft) => draft.type === 'PLAYER_DIED')).toBe(false);
    expect(drafts.some((draft) => draft.type === 'DAY_STARTED')).toBe(true);
    const phaseChange = drafts.find((draft) => draft.type === 'PHASE_CHANGED');
    expect(phaseChange?.payload).toEqual({ from: 'DAY_ANNOUNCE', to: 'DAY_SPEECH' });
  });

  it('新的一天会重置警长选定的方向（DAY_STARTED 是权威默认值）', () => {
    const at = atSignup();
    const withDirection: GameState = {
      ...at.state,
      phase: 'DAY_SPEECH',
      speechDirection: 'counterclockwise',
      sheriffOrder: { startSeat: 1, direction: 'counterclockwise' },
      speech: { startSeat: 1, spoken: [] },
    };
    const next = applyEvent(withDirection, {
      gameId: withDirection.gameId,
      seq: withDirection.seq + 1,
      ts: 0,
      type: 'DAY_STARTED',
      visibleTo: 'public',
      rngAfter: withDirection.rng,
      payload: { day: withDirection.day, diedLastNight: [], speechStartSeat: 2 },
    });

    expect(next.speechDirection).toBeUndefined();
    expect(next.sheriffOrder).toBeUndefined();
    expect(next.speech?.startSeat).toBe(2);
    expect(next.dayAnnounced).toBe(true);
  });

  it('旧事件流没有 countedVotes 时，VOTE_REVEALED 仍按原始票等权重建平票', () => {
    const at = atSignup();
    const base: GameState = { ...at.state, votes: [], seq: 950 };
    const revealed = applyEvent(base, {
      gameId: base.gameId,
      seq: 951,
      ts: 0,
      type: 'VOTE_REVEALED',
      visibleTo: 'public',
      payload: {
        votes: [
          { seat: 1, target: 4 },
          { seat: 2, target: 4 },
          { seat: 3, target: 5 },
          { seat: 6, target: 5 },
        ],
      },
    });

    expect(revealed.runoff).toEqual([4, 5]);
    expect(revealed.lynched).toBeUndefined();
  });

  it('旧事件流里退水者不在候选人名单时，折叠直接抛错', () => {
    const at = atSignup();
    const base: GameState = { ...at.state, seq: 960, sheriffCandidates: [2] };
    expect(() =>
      applyEvent(base, {
        gameId: base.gameId,
        seq: 961,
        ts: 0,
        type: 'SHERIFF_WITHDRAWN',
        visibleTo: 'public',
        payload: { seat: 3, withdraw: true },
      }),
    ).toThrow(InvalidEventStreamError);
  });

  it('归票发言：无警长、非警长、重复归票被拒', () => {
    const at = atSignup();
    const base: GameState = {
      ...at.state,
      phase: 'DAY_SHERIFF_FINAL_SPEECH',
      sheriffSeat: 1,
      badge: 'held',
      sheriffFinalSpeechDone: false,
    };

    const noSheriff = sheriffFinalSpeechDraft(
      { ...base, sheriffSeat: null },
      { type: 'SPEECH_SKIP', ts: 650, seat: 1 },
    );
    expect(noSheriff[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_SHERIFF' }));

    const wrongSeat = sheriffFinalSpeechDraft(base, {
      type: 'SPEECH_SKIP',
      ts: 651,
      seat: 2,
    });
    expect(wrongSeat[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));

    const done = sheriffFinalSpeechDraft(
      { ...base, sheriffFinalSpeechDone: true },
      { type: 'SPEECH_SKIP', ts: 652, seat: 1 },
    );
    expect(done[0]?.payload).toEqual(expect.objectContaining({ code: 'ALREADY_SPOKEN' }));
  });

  it('竞选发言：所有人都说完后仍提交会得到 NOT_YOUR_TURN', () => {
    const at = atSignup();
    const candidates = [at.state.seats[0]?.seat, at.state.seats[1]?.seat].filter(
      (seat): seat is SeatId => seat !== undefined,
    );
    const signed = signupSeats(at.state, candidates).state;
    const exhausted: GameState = {
      ...signed,
      sheriffSpeech: { spoken: [...candidates] },
    };
    const rejected = sheriffSpeechDraft(exhausted, {
      type: 'SPEECH_SKIP',
      ts: 660,
      seat: candidates[0] as SeatId,
    });
    expect(rejected[0]?.payload).toEqual(expect.objectContaining({ code: 'NOT_YOUR_TURN' }));
  });

  it('结果自动阶段缺少当选者/失败原因时抛错', () => {
    const at = atSignup();
    const broken: GameState = {
      ...at.state,
      phase: 'DAY_SHERIFF_RESULT',
      sheriffSeat: null,
    };
    delete broken.sheriffElectionFailure;
    expect(() => sheriffResultEntry(broken)).toThrow(InvalidEventStreamError);
    expect(electionStepOf('DAY_SHERIFF_RESULT')).toBe('result');
    expect(electionStepOf('DAY_SPEECH')).toBeNull();
  });

  it('重复的竞选事件在折叠时抛错（事件流被拼坏不能静默）', () => {
    const at = atSignup();
    const base: GameState = { ...at.state, seq: 900 };

    const signupEvent = {
      gameId: base.gameId,
      seq: 901,
      ts: 0,
      type: 'SHERIFF_SIGNUP',
      visibleTo: 'public',
      payload: { seat: 1, run: false },
    } as const;
    expect(() =>
      applyEvent({ ...base, sheriffSignups: [{ seat: 1, run: false }] }, signupEvent),
    ).toThrow(InvalidEventStreamError);

    const withdrawEvent = {
      gameId: base.gameId,
      seq: 901,
      ts: 0,
      type: 'SHERIFF_WITHDRAWN',
      visibleTo: 'public',
      payload: { seat: 1, withdraw: true },
    } as const;
    expect(() =>
      applyEvent(
        {
          ...base,
          sheriffCandidates: [1],
          sheriffWithdrawals: [{ seat: 1, withdraw: false }],
        },
        withdrawEvent,
      ),
    ).toThrow(InvalidEventStreamError);

    const voteEvent = {
      gameId: base.gameId,
      seq: 901,
      ts: 0,
      type: 'SHERIFF_VOTE_CAST',
      visibleTo: 'self:1',
      payload: { seat: 1, target: 'abstain' },
    } as const;
    expect(() =>
      applyEvent({ ...base, sheriffVotes: [{ seat: 1, target: 'abstain' }] }, voteEvent),
    ).toThrow(InvalidEventStreamError);
  });
});
