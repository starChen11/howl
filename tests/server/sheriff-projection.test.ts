import { describe, expect, it } from 'vitest';

import { project } from '@server/project';
import { buildTruth } from '@server/view/truth';

import {
  runSheriff,
  sheriffSignupTrace,
  signupSeats,
  skipSheriffElection,
} from '../fixtures/sheriff';

/**
 * RFC-022 AC-1 的**跨层**验收：首夜死讯公布前，投影与真相视图都不能看到死亡。
 *
 * 引擎的做法是让死亡事件真的还没发生（`NIGHT_RESOLVE` 只暂存，`DAY_ANNOUNCE` 才落地），
 * 所以这里不需要给投影加任何特判。测试直接复用服务端现有的 `project` / `buildTruth`，
 * 证明它们吃到的新事件流不会提前泄露。
 */

describe('RFC-022 AC-1 · 竞选期间投影不含首夜死亡', () => {
  it('project：9 人全部在 aliveSeats，公开事件里没有 DAY_STARTED / PLAYER_DIED', () => {
    const trace = sheriffSignupTrace();
    const view = project({
      state: trace.state,
      events: trace.events,
      observer: 1,
      pending: null,
    });

    expect(view.aliveSeats).toHaveLength(9);
    expect(view.aliveSeats).toContain(trace.killTarget);
    expect(view.deadSeats).toEqual([]);
    expect(view.publicEvents.some((event) => event.type === 'DAY_STARTED')).toBe(false);
    expect(view.publicEvents.some((event) => event.type === 'PLAYER_DIED')).toBe(false);
    expect(view.phase).toBe('DAY_SHERIFF_SIGNUP');
  });

  it('truth：真相视图里的首夜死者仍然 alive，死亡列表为空', () => {
    const trace = sheriffSignupTrace();
    const truth = buildTruth(trace.state, trace.events);

    expect(truth.deaths).toEqual([]);
    expect(truth.seats.find((seat) => seat.seat === trace.killTarget)?.alive).toBe(true);
  });

  it('死讯公布后两者同时更新：投影把死者移出 aliveSeats，真相记录死亡', () => {
    const trace = sheriffSignupTrace();
    const skipped = skipSheriffElection(trace.state);
    const events = [...trace.events, ...skipped.events];

    const view = project({
      state: skipped.state,
      events,
      observer: 1,
      pending: null,
    });
    expect(view.aliveSeats).toHaveLength(8);
    expect(view.aliveSeats).not.toContain(trace.killTarget);
    expect(view.deadSeats).toContain(trace.killTarget);

    const truth = buildTruth(skipped.state, events);
    // 首夜属于第 1 天：`DAY_STARTED` 先于延后的 `PLAYER_DIED` 折叠，truth 才能读对天数。
    expect(truth.deaths).toEqual(
      expect.arrayContaining([expect.objectContaining({ seat: trace.killTarget, day: 1 })]),
    );
    expect(truth.seats.find((seat) => seat.seat === trace.killTarget)?.alive).toBe(false);
  });
});

describe('RFC-022 · 投影暴露警长/竞选/合法目标', () => {
  /** 从竞选开始推进到警下投票（两名候选人，无人退水）。 */
  function toSheriffVote() {
    const trace = sheriffSignupTrace();
    const signed = signupSeats(trace.state, [2, 3]);
    let current = signed.state;
    const events = [...trace.events, ...signed.events];

    for (let guard = 0; guard < 5; guard += 1) {
      const state = current;
      if (state.phase !== 'DAY_SHERIFF_SPEECH') break;
      const eligible = [...(state.sheriffCandidates ?? [])].sort((a, b) => a - b);
      const spoken = new Set(state.sheriffSpeech?.spoken ?? []);
      const seat = eligible.find((candidate) => !spoken.has(candidate));
      if (seat === undefined) break;
      const result = runSheriff(current, { type: 'SPEECH_SKIP', ts: 100, seat });
      current = result.state;
      events.push(...result.events);
    }
    for (let guard = 0; guard < 5; guard += 1) {
      if (current.phase !== 'DAY_SHERIFF_WITHDRAW') break;
      const decided = new Set((current.sheriffWithdrawals ?? []).map((entry) => entry.seat));
      const seat = [...(current.sheriffCandidates ?? [])].find(
        (candidate) => !decided.has(candidate),
      );
      if (seat === undefined) break;
      const result = runSheriff(current, {
        type: 'SHERIFF_WITHDRAW',
        ts: 100,
        seat,
        withdraw: false,
      });
      current = result.state;
      events.push(...result.events);
    }
    return { state: current, events };
  }

  it('竞选公开视图：候选人、警下、观察者身份；警长票箱不在视图里', () => {
    const { state, events } = toSheriffVote();
    expect(state.phase).toBe('DAY_SHERIFF_VOTE');

    const voter = project({ state, events, observer: 1, pending: 'sheriff-vote' });
    expect(voter.sheriffSeat).toBeNull();
    expect(voter.badge).toBe('none');
    expect(voter.sheriff?.phase).toBe('vote');
    expect(voter.sheriff?.candidates).toEqual([2, 3]);
    expect(voter.sheriff?.voters).toEqual([1, 4, 5, 6, 7, 8, 9]);
    expect(voter.sheriff?.isCandidate).toBe(false);
    expect(voter.sheriff?.isVoter).toBe(true);
    // 暗投：公开视图不携带票箱。
    expect(JSON.stringify(voter.sheriff)).not.toContain('sheriffVotes');

    const candidate = project({ state, events, observer: 2, pending: 'sheriff-vote' });
    expect(candidate.sheriff?.isCandidate).toBe(true);
    expect(candidate.sheriff?.isVoter).toBe(false);
  });

  it('sheriff-vote 的合法目标 = 仍在警上的候选 + 弃权；重投只有并列者', () => {
    const { state, events } = toSheriffVote();
    const ctx = project({ state, events, observer: 1, pending: 'sheriff-vote' });
    expect(ctx.legalTargets).toEqual([2, 3, 'abstain']);

    const runoff = {
      ...state,
      phase: 'DAY_SHERIFF_RUNOFF' as const,
      sheriffRunoff: [2, 3],
    } as never;
    const runoffCtx = project({ state: runoff, events, observer: 1, pending: 'sheriff-runoff' });
    expect(runoffCtx.legalTargets).toEqual([2, 3]);
  });

  it('警徽移交目标只用引擎真值：排除自己与已出局者', () => {
    const { state, events } = toSheriffVote();
    const dead = {
      ...state,
      phase: 'DAY_BADGE_TRANSFER' as const,
      sheriffSeat: 2,
      seats: state.seats.map((seat) => (seat.seat === 2 ? { ...seat, alive: false } : seat)),
    } as never;
    const ctx = project({ state: dead, events, observer: 4, pending: 'badge-transfer' });
    expect(ctx.sheriffSeat).toBe(2);
    expect(ctx.legalTargets).not.toContain(2);
    expect(ctx.legalTargets).not.toContain(4);
    expect(ctx.legalTargets).toContain(1);
  });

  it('警长定序暴露方向选项与合法起点', () => {
    const { state, events } = toSheriffVote();
    const orderState = {
      ...state,
      phase: 'DAY_SHERIFF_ORDER' as const,
      sheriffSeat: 2,
      lastNightDeaths: [5],
    } as never;
    const ctx = project({ state: orderState, events, observer: 2, pending: 'sheriff-order' });
    expect(ctx.sheriffOrderOptions?.length).toBe(2);
    expect(ctx.legalTargets).toEqual(
      ctx.sheriffOrderOptions?.map((option) => option.startSeat) ?? [],
    );
  });
});
