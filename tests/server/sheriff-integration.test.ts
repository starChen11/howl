import { describe, expect, it } from 'vitest';

import type { GameState, SeatId } from '@shared/domain';

import { buildApp } from '@server/app';
import { ChannelRegistry } from '@server/channels/session';
import {
  DEFAULT_PHASE_TIMERS,
  loadPhaseTimers,
  timeoutForPhase,
} from '@server/config/phase-timers';
import { nextActor, pendingForPhase, isPlayerPhase, runGame } from '@server/orchestrator';
import { project } from '@server/project';
import { phaseTimer } from '@server/project/timer';
import { buildReplaySnapshot } from '@server/replay/snapshot';
import { GameRegistry, type GameRecord, type SessionRecord } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';
import { buildTruth, canSeeTruth } from '@server/view/truth';

import { currentSpeaker } from '@engine/phases/day';
import {
  activeCandidatesOf,
  nextSheriffSpeaker,
  pendingSheriffVoters,
  pendingSignups,
  pendingWithdrawals,
  sheriffOrderOptions,
  votersOf,
} from '@engine/phases/sheriff';

/**
 * RFC-022 的服务端集成测试（§8 的 AC-1/2/3/6/7/9/12/14/15）。
 *
 * 这些用例真的走注册表（引擎 + 投影 + 复盘），不重造状态机：
 * 竞选 → 1.5 票 → 定序/归票 → 首夜死者当选 → 警徽移交。
 */

async function createGame(
  seed = 15,
  playerSeat = 1,
): Promise<{ registry: GameRegistry; session: SessionRecord; record: GameRecord }> {
  const registry = new GameRegistry(new InMemoryMetaStore());
  const session = await registry.createSession();
  const record = await registry.createGame(session, {
    mode: 'slaughter-side',
    seed,
    playerSeat: playerSeat as never,
  });
  return { registry, session, record };
}

async function act(
  registry: GameRegistry,
  session: SessionRecord,
  record: GameRecord,
  action: Record<string, unknown>,
): Promise<GameRecord> {
  const state = registry.stateOf(record);
  const result = await registry.submit(session, record, action as never, state.seq);
  if (!result.ok) throw new Error(`提交失败：${result.code}`);
  return result.record;
}

/** 把首夜走到 `DAY_SHERIFF_SIGNUP`，狼刀指定座位。 */
async function nightToElection(
  registry: GameRegistry,
  session: SessionRecord,
  initial: GameRecord,
  killTarget: SeatId,
): Promise<GameRecord> {
  let current = initial;

  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'NIGHT_WOLF_CHAT') break;
    const wolf = state.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (wolf !== undefined) {
      current = await act(registry, session, current, {
        type: 'WOLF_CHAT',
        ts: 1,
        seat: wolf,
        text: '',
      });
      continue;
    }
    const notReady = state.seats.find(
      (seat) => seat.alive && seat.role === 'wolf' && !(state.wolfReady ?? []).includes(seat.seat),
    )?.seat;
    if (notReady === undefined) break;
    current = await act(registry, session, current, {
      type: 'WOLF_READY',
      ts: 1,
      seat: notReady,
    });
  }

  current = await act(registry, session, current, {
    type: 'WOLF_KILL',
    ts: 1,
    seat: registry.stateOf(current).seats.find((seat) => seat.role === 'wolf')?.seat,
    target: killTarget,
  });
  current = await act(registry, session, current, {
    type: 'SEER_CHECK',
    ts: 1,
    seat: registry.stateOf(current).seats.find((seat) => seat.role === 'seer')?.seat,
    target: killTarget === 1 ? 2 : 1,
  });
  current = await act(registry, session, current, {
    type: 'WITCH_ACT',
    ts: 1,
    seat: registry.stateOf(current).seats.find((seat) => seat.role === 'witch')?.seat,
    potion: 'none',
  });

  expect(registry.stateOf(current).phase).toBe('DAY_SHERIFF_SIGNUP');
  return current;
}

/** 全员表态上警/不上警，直到候选人公布。 */
async function signupAll(
  registry: GameRegistry,
  session: SessionRecord,
  initial: GameRecord,
  candidates: readonly SeatId[],
): Promise<GameRecord> {
  let current = initial;
  const wanted = new Set(candidates);
  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'DAY_SHERIFF_SIGNUP') break;
    const seat = pendingSignups(state)[0];
    if (seat === undefined) break;
    current = await act(registry, session, current, {
      type: 'SHERIFF_SIGNUP',
      ts: 1,
      seat,
      run: wanted.has(seat),
    });
  }
  return current;
}

/** 警上按座位顺序各说一句，直到进入退水阶段。 */
async function allCandidatesSpeak(
  registry: GameRegistry,
  session: SessionRecord,
  initial: GameRecord,
): Promise<GameRecord> {
  let current = initial;
  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'DAY_SHERIFF_SPEECH' && state.phase !== 'DAY_SHERIFF_PK') break;
    const seat = nextSheriffSpeaker(state);
    if (seat === undefined) break;
    current = await act(registry, session, current, {
      type: 'SPEECH',
      ts: 1,
      seat,
      text: `${seat} 号竞选发言`,
    });
  }
  return current;
}

/** 所有候选人表态退水/不退水。 */
async function allWithdraw(
  registry: GameRegistry,
  session: SessionRecord,
  initial: GameRecord,
  withdrawing: readonly SeatId[],
): Promise<GameRecord> {
  let current = initial;
  const quit = new Set(withdrawing);
  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'DAY_SHERIFF_WITHDRAW') break;
    const seat = pendingWithdrawals(state)[0];
    if (seat === undefined) break;
    current = await act(registry, session, current, {
      type: 'SHERIFF_WITHDRAW',
      ts: 1,
      seat,
      withdraw: quit.has(seat),
    });
  }
  return current;
}

/** 警下按目标投票（其余人弃权）。 */
async function castSheriffVotes(
  registry: GameRegistry,
  session: SessionRecord,
  initial: GameRecord,
  votes: Readonly<Record<number, number | 'abstain'>>,
): Promise<GameRecord> {
  let current = initial;
  for (let guard = 0; guard < 20; guard += 1) {
    const state = registry.stateOf(current);
    if (state.phase !== 'DAY_SHERIFF_VOTE' && state.phase !== 'DAY_SHERIFF_RUNOFF') break;
    const seat = pendingSheriffVoters(state)[0];
    if (seat === undefined) break;
    current = await act(registry, session, current, {
      type: 'SHERIFF_VOTE',
      ts: 1,
      seat,
      target: votes[seat] ?? 'abstain',
    });
  }
  return current;
}

describe('RFC-022 · 完整竞选与 1.5 票', () => {
  it('上警 → 按座位发言 → 退水 → 警下投票 → 警长定序 → 归票 → 1.5 票', async () => {
    const { registry, session, record } = await createGame(15, 1);
    const roles = registry.stateOf(record).seats;
    const candidates: SeatId[] = [2, 3, 4];
    // 首夜刀一个不在候选里的村民，避免干扰竞选/当选。
    const victim = roles.find(
      (seat) => seat.role === 'villager' && !candidates.includes(seat.seat),
    )?.seat;
    if (victim === undefined) throw new Error('没有可刀的村民');

    let current = await nightToElection(registry, session, record, victim);

    // 首夜死者参与竞选：竞选期间引擎仍然 9 人存活（RFC-022 §2.1 / §13.1）。
    expect(registry.stateOf(current).seats.filter((seat) => seat.alive)).toHaveLength(9);
    const before = project({
      state: registry.stateOf(current),
      events: current.events,
      observer: 1,
      pending: null,
    });
    expect(before.aliveSeats).toHaveLength(9);
    expect(before.deadSeats).toEqual([]);
    expect(before.sheriffSeat).toBeNull();
    expect(before.badge).toBe('none');

    current = await signupAll(registry, session, current, candidates);
    let state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SHERIFF_SPEECH');
    expect(state.sheriffCandidates).toEqual(candidates);
    expect(votersOf(state)).toEqual([1, 5, 6, 7, 8, 9]);

    // 警上按座位顺序发言。
    const spoken: SeatId[] = [];
    for (let guard = 0; guard < 5; guard += 1) {
      const beforeState = registry.stateOf(current);
      if (beforeState.phase !== 'DAY_SHERIFF_SPEECH') break;
      const speaker = nextSheriffSpeaker(beforeState);
      if (speaker === undefined) break;
      spoken.push(speaker);
      current = await act(registry, session, current, {
        type: 'SPEECH',
        ts: 1,
        seat: speaker,
        text: `${speaker} 号竞选发言`,
      });
    }
    expect(spoken).toEqual([2, 3, 4]);

    // 4 号退水；退水者不在警下投票人里。
    current = await allWithdraw(registry, session, current, [4]);
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SHERIFF_VOTE');
    expect(state.sheriffWithdrawn).toEqual([4]);
    expect(votersOf(state)).toEqual([1, 5, 6, 7, 8, 9]);
    expect(activeCandidatesOf(state)).toEqual([2, 3]);

    // 投影给出合法警长投票目标（候选 + 弃权），不包含已退水的 4 号。
    const voteCtx = project({
      state,
      events: current.events,
      observer: 1,
      pending: 'sheriff-vote',
    });
    expect(voteCtx.pending).toBe('sheriff-vote');
    expect(voteCtx.legalTargets).toEqual([2, 3, 'abstain']);
    expect(voteCtx.sheriff?.phase).toBe('vote');
    expect(voteCtx.sheriff?.isVoter).toBe(true);

    // 4 票投 2 号、2 票投 3 号 → 2 号当选。
    current = await castSheriffVotes(registry, session, current, {
      1: 2,
      5: 2,
      6: 2,
      7: 2,
      8: 3,
      9: 3,
    });
    state = registry.stateOf(current);
    expect(current.events.some((event) => event.type === 'SHERIFF_ELECTED')).toBe(true);
    expect(state.sheriffSeat).toBe(2);
    expect(state.badge).toBe('held');

    // 结果 → 公布首夜死讯 → 警长存活 → 定序。
    expect(state.phase).toBe('DAY_SHERIFF_ORDER');
    expect(state.seats.find((seat) => seat.seat === victim)?.alive).toBe(false);
    expect(state.lastNightDeaths).toEqual([victim]);
    const options = sheriffOrderOptions(state);
    expect(options.length).toBeGreaterThan(0);
    const option = options[0];
    if (option === undefined) throw new Error('没有可选发言顺序');
    current = await act(registry, session, current, {
      type: 'SHERIFF_ORDER',
      ts: 1,
      seat: 2,
      startSeat: option.startSeat,
      direction: option.direction,
    });
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SPEECH');
    expect(state.speech?.startSeat).toBe(option.startSeat);
    expect(state.speechDirection).toBe(option.direction);
    expect(current.events.some((event) => event.type === 'SHERIFF_ORDER_CHOSEN')).toBe(true);

    // 正常轮转：警长也照常发言。
    let spokeSheriff = false;
    for (let guard = 0; guard < 12; guard += 1) {
      const speechState = registry.stateOf(current);
      if (speechState.phase !== 'DAY_SPEECH') break;
      const speaker = currentSpeaker(speechState);
      if (speaker === undefined) break;
      if (speaker === 2) {
        spokeSheriff = true;
        current = await act(registry, session, current, {
          type: 'SPEECH',
          ts: 1,
          seat: speaker,
          text: '警长正常轮转发言',
        });
      } else {
        current = await act(registry, session, current, {
          type: 'SPEECH_SKIP',
          ts: 1,
          seat: speaker,
        });
      }
    }
    expect(spokeSheriff).toBe(true);
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SHERIFF_FINAL_SPEECH');

    // 归票发言：只有警长，且说完就投票。
    expect(nextSheriffSpeaker(state)).toBeUndefined();
    current = await act(registry, session, current, {
      type: 'SPEECH',
      ts: 1,
      seat: 2,
      text: '警长归票',
    });
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_VOTE');
    expect(state.sheriffFinalSpeechDone).toBe(true);

    // 1.5 票：让「原始票 4:4」的对局由警长的 1.5 票决定胜负。
    const alive = state.seats
      .filter((seat) => seat.alive && seat.seat !== 2)
      .map((seat) => seat.seat);
    const targetA = alive[0] ?? 3;
    const targetB = alive[1] ?? 4;
    let otherIndex = 0;
    for (let guard = 0; guard < 12; guard += 1) {
      const voteState = registry.stateOf(current);
      if (voteState.phase !== 'DAY_VOTE') break;
      const voter = voteState.seats.find(
        (seat) => seat.alive && !(voteState.votes ?? []).some((vote) => vote.seat === seat.seat),
      )?.seat;
      if (voter === undefined) break;
      const target = voter === 2 ? targetB : otherIndex % 2 === 0 ? targetA : targetB;
      if (voter !== 2) otherIndex += 1;
      current = await act(registry, session, current, {
        type: 'VOTE',
        ts: 1,
        seat: voter,
        target,
      });
    }

    const revealed = current.events.find((event) => event.type === 'VOTE_REVEALED');
    expect(revealed).toBeDefined();
    const payload = revealed?.payload as {
      votes: { seat: number; target: number | 'abstain' }[];
      countedVotes?: { seat: number; target: number | 'abstain'; halfVotes: number }[];
      sheriffSeat?: number | null;
    };
    expect(payload.sheriffSeat).toBe(2);
    expect(payload.countedVotes?.find((vote) => vote.seat === 2)?.halfVotes).toBe(3);
    expect(payload.countedVotes?.find((vote) => vote.seat !== 2)?.halfVotes).toBe(2);

    // 原始票 4:4，折算后半票 8:9 → 警长那一侧赢（RFC-022 §3.1）。
    const rawA = payload.votes.filter((vote) => vote.target === targetA).length;
    const rawB = payload.votes.filter((vote) => vote.target === targetB).length;
    const halfA =
      payload.countedVotes
        ?.filter((vote) => vote.target === targetA)
        .reduce((sum, vote) => sum + vote.halfVotes, 0) ?? 0;
    const halfB =
      payload.countedVotes
        ?.filter((vote) => vote.target === targetB)
        .reduce((sum, vote) => sum + vote.halfVotes, 0) ?? 0;
    expect(rawA).toBe(4);
    expect(rawB).toBe(4);
    expect(halfB).toBe(9);
    expect(halfA).toBe(8);
  });

  it('重投再次平票 → 本局无警长', async () => {
    const { registry, session, record } = await createGame(15, 1);
    const victim = registry
      .stateOf(record)
      .seats.find((seat) => seat.role === 'villager' && seat.seat >= 5)?.seat;
    if (victim === undefined) throw new Error('没有可刀的村民');

    let current = await nightToElection(registry, session, record, victim);
    current = await signupAll(registry, session, current, [2, 3, 4]);
    current = await allCandidatesSpeak(registry, session, current);
    current = await allWithdraw(registry, session, current, [4]);

    // 首轮 3:3 平票 → PK。
    current = await castSheriffVotes(registry, session, current, {
      1: 2,
      5: 2,
      6: 2,
      7: 3,
      8: 3,
      9: 3,
    });
    expect(registry.stateOf(current).phase).toBe('DAY_SHERIFF_PK');
    expect(registry.stateOf(current).sheriffRunoff).toEqual([2, 3]);

    current = await allCandidatesSpeak(registry, session, current);
    expect(registry.stateOf(current).phase).toBe('DAY_SHERIFF_RUNOFF');

    // 重投再次 3:3 → 无警长；随后公布死讯，进入白天（没有警长则直接发言）。
    current = await castSheriffVotes(registry, session, current, {
      1: 2,
      5: 2,
      6: 2,
      7: 3,
      8: 3,
      9: 3,
    });
    const state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SPEECH');
    expect(state.sheriffSeat).toBeNull();
    expect(state.badge).toBe('none');
    expect(state.sheriffElectionFailure).toBe('double-tie');
    expect(current.events.some((event) => event.type === 'SHERIFF_ELECTION_FAILED')).toBe(true);
  });
});

describe('RFC-022 · 首夜死者参与竞选与警徽移交', () => {
  it('首夜死者上警、当选，死讯公布后移交警徽；竞选期间投影/真相不泄露', async () => {
    const { registry, session, record } = await createGame(15, 1);
    const seats = registry.stateOf(record).seats;
    const villagers = seats.filter((seat) => seat.role === 'villager').map((seat) => seat.seat);
    const deadCandidate = villagers[0];
    const heir = villagers[1];
    if (deadCandidate === undefined || heir === undefined) throw new Error('村民不足');

    let current = await nightToElection(registry, session, record, deadCandidate);

    // 死讯公布前：引擎 9 人都活着，投影不含死者，真相也不含死亡。
    let state = registry.stateOf(current);
    expect(state.seats.find((seat) => seat.seat === deadCandidate)?.alive).toBe(true);
    const observer = state.seats.find((seat) => seat.alive && seat.seat !== deadCandidate)?.seat;
    if (observer === undefined) throw new Error('没有观察者');
    const hidden = project({
      state,
      events: current.events,
      observer,
      pending: 'sheriff-signup',
    });
    expect(hidden.aliveSeats).toContain(deadCandidate);
    expect(hidden.deadSeats).toEqual([]);
    expect(buildTruth(state, current.events).deaths).toEqual([]);

    current = await signupAll(registry, session, current, [deadCandidate, heir]);
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SHERIFF_SPEECH');
    // 首夜死者照常出现在竞选发言顺序里。
    expect(nextSheriffSpeaker(state)).toBe(Math.min(deadCandidate, heir));

    current = await allCandidatesSpeak(registry, session, current);
    current = await allWithdraw(registry, session, current, []);
    expect(registry.stateOf(current).phase).toBe('DAY_SHERIFF_VOTE');

    // 所有警下都投首夜死者 → 他当选（此时服务端知道他会死，但投影还不知道）。
    const votes: Record<number, number> = {};
    for (const seat of votersOf(registry.stateOf(current))) votes[seat] = deadCandidate;
    current = await castSheriffVotes(registry, session, current, votes);

    // 当选 → 公布死讯（死亡此刻落地）→ 死亡的警长进入移交。
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_BADGE_TRANSFER');
    expect(state.sheriffSeat).toBe(deadCandidate);
    expect(state.seats.find((seat) => seat.seat === deadCandidate)?.alive).toBe(false);
    expect(state.lastNightDeaths).toEqual([deadCandidate]);

    const revealed = project({
      state,
      events: current.events,
      observer,
      pending: 'badge-transfer',
    });
    expect(revealed.deadSeats).toContain(deadCandidate);
    expect(revealed.sheriffSeat).toBe(deadCandidate);
    expect(revealed.legalTargets).toContain(heir);
    expect(revealed.legalTargets).not.toContain(deadCandidate);
    // 死亡玩家的真相视图解锁；活着的观察者仍被锁。
    expect(canSeeTruth(state, observer)).toBe(false);
    if (observer !== deadCandidate) {
      expect(canSeeTruth(state, deadCandidate)).toBe(true);
    }
    const truth = buildTruth(state, current.events);
    expect(truth.deaths).toEqual([expect.objectContaining({ seat: deadCandidate, day: 1 })]);
    expect(truth.sheriff?.elected).toBe(deadCandidate);

    // 移交给存活玩家：接任者立刻成为警长，并进入定序。
    current = await act(registry, session, current, {
      type: 'BADGE_TRANSFER',
      ts: 1,
      seat: deadCandidate,
      target: heir,
    });
    state = registry.stateOf(current);
    expect(state.phase).toBe('DAY_SHERIFF_ORDER');
    expect(state.sheriffSeat).toBe(heir);
    expect(state.badge).toBe('held');
    expect(current.events.some((event) => event.type === 'BADGE_TRANSFERRED')).toBe(true);

    const truthAfter = buildTruth(state, current.events);
    expect(truthAfter.sheriff?.transfers).toEqual([{ from: deadCandidate, to: heir }]);
    expect(truthAfter.sheriff?.elected).toBe(heir);
    // 真相视图把「当选 / 移交」记到对应席位。
    expect(
      truthAfter.seats.find((seat) => seat.seat === deadCandidate)?.actions.join(''),
    ).toContain('警徽');
    expect(truthAfter.seats.find((seat) => seat.seat === heir)?.actions.join('')).toContain(
      '接任警长',
    );

    // 复盘时间线包含竞选、当选、死讯与移交（AC-15：不丢数据）。
    const snapshot = buildReplaySnapshot(state, current.events, {
      gameId: current.gameId,
      seed: state.seed,
      finishedAt: 0,
    });
    const text = snapshot.timeline.map((entry) => entry.text).join('\n');
    expect(text).toContain('警长竞选开始');
    expect(text).toContain('当选警长');
    expect(text).toContain('把警徽移交给');
    // `GAME_STARTED` 是开局（第 0 天），其余竞选/死亡/移交条目都必须落在第 1 天。
    expect(
      snapshot.timeline
        .filter((entry) => entry.text !== '身份分配完成')
        .every((entry) => entry.day >= 1),
    ).toBe(true);
  });
});

describe('RFC-022 · AI 降级覆盖竞选发言', () => {
  it('模型在竞选发言阶段抛错 → 降级为 SHERIFF_SPEECH + DEGRADED', async () => {
    const { registry, session, record } = await createGame(15, 1);
    const victim = registry
      .stateOf(record)
      .seats.find((seat) => seat.role === 'villager' && seat.seat >= 5)?.seat;
    if (victim === undefined) throw new Error('没有可刀的村民');

    let current = await nightToElection(registry, session, record, victim);
    current = await signupAll(registry, session, current, [2, 3]);
    expect(registry.stateOf(current).phase).toBe('DAY_SHERIFF_SPEECH');

    const result = await runGame({
      registry,
      session,
      gameId: current.gameId,
      input: {
        async read() {
          return { kind: 'timeout', text: '' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async () => {
        throw new Error('模型失败');
      },
      maxSteps: 4,
    });

    expect(result.record.events.some((event) => event.type === 'DEGRADED')).toBe(true);
    expect(result.record.events.some((event) => event.type === 'SHERIFF_SPEECH')).toBe(true);
  });
});

describe('RFC-022 · 服务端路由与倒计时', () => {
  it('pending=sheriff-vote 可查询；SHERIFF_SIGNUP 提交后唤醒挂起通道', async () => {
    const store = new InMemoryMetaStore();
    const bus = new StreamBus();
    const channels = new ChannelRegistry(bus);
    const app = buildApp({ store, bus, channels });
    const registry = new GameRegistry(store);
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 15,
      playerSeat: 1,
    });
    const state0 = registry.stateOf(record);
    const victim = state0.seats.find((seat) => seat.role === 'villager')?.seat;
    if (victim === undefined) throw new Error('没有可刀的村民');
    const current = await nightToElection(registry, session, record, victim);
    const playerSeat = current.playerSeat;

    const view = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}?pending=sheriff-signup`,
      headers: { cookie: `session=${session.id}` },
    });
    expect(view.statusCode).toBe(200);
    const body = view.json<{
      view: {
        pending: string;
        sheriffSeat: number | null;
        badge: string;
        sheriff?: { phase: string | null };
      };
      timer: { totalSeconds: number } | null;
    }>();
    expect(body.view.pending).toBe('sheriff-signup');
    expect(body.view.sheriffSeat).toBeNull();
    expect(body.view.badge).toBe('none');
    expect(body.view.sheriff?.phase).toBe('signup');
    // RFC-022 §5：新相位默认 120 秒倒计时。
    expect(body.timer?.totalSeconds).toBe(120);

    // 非法 pending 返回 400；合法的新 pending 值不会被拒。
    const bad = await app.inject({
      method: 'GET',
      url: `/api/games/${current.gameId}?pending=not-a-decision`,
      headers: { cookie: `session=${session.id}` },
    });
    expect(bad.statusCode).toBe(400);

    const pendingInput = channels
      .forGame(current.gameId)
      .input.read({ seat: playerSeat as never, timeoutMs: 2_000, kind: 'action' });
    const submit = await app.inject({
      method: 'POST',
      url: `/api/games/${current.gameId}/actions`,
      headers: { cookie: `session=${session.id}` },
      payload: {
        action: { type: 'SHERIFF_SIGNUP', ts: 1, seat: playerSeat, run: true },
        expectedVersion: current.events.length,
      },
    });
    expect(submit.statusCode).toBe(200);
    expect(await pendingInput).toEqual({ kind: 'speak', text: 'run' });

    // 路由响应只含该席位可见的事件（没有夜间 server 事件）。
    const response = submit.json<{ events: { type: string }[] }>();
    expect(response.events.some((event) => event.type === 'SHERIFF_SIGNUP')).toBe(true);
  });

  it('全部新相位都注册了默认 120 秒倒计时', () => {
    const timers = loadPhaseTimers({});
    for (const phase of [
      'DAY_SHERIFF_SIGNUP',
      'DAY_SHERIFF_SPEECH',
      'DAY_SHERIFF_WITHDRAW',
      'DAY_SHERIFF_VOTE',
      'DAY_SHERIFF_PK',
      'DAY_SHERIFF_RUNOFF',
      'DAY_BADGE_TRANSFER',
      'DAY_SHERIFF_ORDER',
      'DAY_SHERIFF_FINAL_SPEECH',
    ]) {
      expect(timeoutForPhase(phase, timers), phase).toBe(120_000);
    }
    expect(DEFAULT_PHASE_TIMERS.sheriffSignupMs).toBe(120_000);
    expect(pendingForPhase('DAY_SHERIFF_SIGNUP')).toBe('sheriff-signup');
    expect(pendingForPhase('DAY_SHERIFF_FINAL_SPEECH')).toBe('sheriff-final-speech');
    expect(isPlayerPhase('DAY_BADGE_TRANSFER')).toBe(true);
  });

  it('phaseTimer 给竞选发言按人重新计时', () => {
    const now = 1_700_000_000_000;
    const record = {
      events: [
        {
          type: 'PHASE_CHANGED',
          ts: now - 60_000,
          payload: { from: 'X', to: 'DAY_SHERIFF_SPEECH' },
        },
        {
          type: 'SHERIFF_SPEECH',
          ts: now - 5_000,
          payload: { seat: 2, text: '竞选发言' },
        },
      ],
    } as never;
    const timer = phaseTimer(record, 'DAY_SHERIFF_SPEECH', {}, now);
    expect(timer?.totalSeconds).toBe(120);
    expect(timer?.remainingSeconds).toBe(115);
  });

  it('nextActor / seatToSpeak 覆盖竞选、PK、退水、投票、定序与移交', () => {
    const base = {
      seats: [
        { seat: 1, alive: true, role: 'villager' },
        { seat: 2, alive: true, role: 'wolf' },
        { seat: 3, alive: false, role: 'villager' },
      ],
      sheriffSeat: 3,
      sheriffCandidates: [2],
      sheriffVoters: [1],
      sheriffSignups: [{ seat: 1, run: false }],
      sheriffWithdrawals: [],
      sheriffVotes: [],
      sheriffSpeech: { spoken: [] },
      sheriffRunoff: [2],
      sheriffFinalSpeechDone: false,
    } as unknown as GameState;

    expect(nextActor({ ...base, phase: 'DAY_SHERIFF_SIGNUP' } as never)).toBe(2);
    expect(nextActor({ ...base, phase: 'DAY_SHERIFF_WITHDRAW' } as never)).toBe(2);
    expect(nextActor({ ...base, phase: 'DAY_SHERIFF_VOTE' } as never)).toBe(1);
    expect(nextActor({ ...base, phase: 'DAY_BADGE_TRANSFER' } as never)).toBe(3);
    expect(nextActor({ ...base, phase: 'DAY_SHERIFF_FINAL_SPEECH' } as never)).toBeUndefined();
    expect(nextActor({ ...base, phase: 'DAY_SHERIFF_ORDER' } as never)).toBeUndefined();
  });
});
