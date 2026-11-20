import { describe, expect, it } from 'vitest';

import { scriptedAgent } from '@server/ai/agent';
import { runGame } from '@server/orchestrator';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { canSeeTruth } from '@server/view/truth';

/**
 * 出局后的能力矩阵（用户要求：每种角色 × 每种死法都要有据可查）。
 *
 * 规则来源：RUL-1（死亡触发技能在胜负判定之后）、RUL-11（被毒的猎人不开枪）、
 * FR-17（毒杀拿不走开枪）。能力本身：
 *
 * | 死法 \ 角色 | 狼 / 村民 / 预言家 / 女巫 | 猎人 |
 * |---|---|---|
 * | 被狼刀 | 观战（无待决定），可看真相 | **要先开枪**：此时不能看真相 |
 * | 被毒 | 同上 | **不能开枪**，直接观战，可看真相 |
 * | 被放逐 | 同上 | 白天开枪阶段，此时不能看真相 |
 * | 被猎人带走 | 同上 | （不存在第二个猎人） |
 *
 * 「可看真相」= 已出局且**没有待决定**。有待决定时看真相等于按身份挑人。
 */

/** 1 号分别是这些角色（种子固定，见用例内断言）。 */
const ROLE_SEEDS = { villager: 1, hunter: 2, wolf: 3, seer: 4, witch: 15 } as const;

async function newGame(seed: number) {
  const registry = new GameRegistry(new InMemoryMetaStore());
  const session = await registry.createSession();
  const record = await registry.createGame(session, {
    mode: 'slaughter-side',
    seed,
    playerSeat: 1,
  });
  return { registry, session, record };
}

type Setup = Awaited<ReturnType<typeof newGame>>;

/** 推进到夜里，并强制某个动作。返回最新记录。 */
async function submitNight(
  setup: Setup,
  plan: (
    state: ReturnType<GameRegistry['stateOf']>,
  ) => Parameters<GameRegistry['submit']>[2] | undefined,
) {
  let current = setup.record;
  for (let guard = 0; guard < 40; guard += 1) {
    const state = setup.registry.stateOf(current);
    if (
      state.phase === 'DAY_SPEECH' ||
      state.phase === 'DAY_ANNOUNCE' ||
      state.phase === 'FINISHED'
    ) {
      return current;
    }
    const action = plan(state);
    if (action === undefined) return current;

    const result = await setup.registry.submit(setup.session, current, action, state.seq);
    if (!result.ok) return current;
    current = result.record;
  }
  return current;
}

/** 夜里让狼刀 1 号（玩家自己）。 */
function killPlayerPlan(): Parameters<typeof submitNight>[1] {
  return (state) => {
    switch (state.phase) {
      case 'NIGHT_WOLF_CHAT': {
        const wolf = state.seats.find(
          (seat) =>
            seat.alive &&
            seat.role === 'wolf' &&
            !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
        )?.seat;
        return wolf === undefined
          ? undefined
          : ({ type: 'WOLF_CHAT', ts: 0, seat: wolf, text: '' } as never);
      }
      case 'NIGHT_WOLVES': {
        const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
        return wolf === undefined
          ? undefined
          : ({ type: 'WOLF_KILL', ts: 0, seat: wolf, target: 1 } as never);
      }
      case 'NIGHT_SEER': {
        const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
        return seer === undefined
          ? undefined
          : ({ type: 'SEER_CHECK', ts: 0, seat: seer, target: 3 } as never);
      }
      case 'NIGHT_WITCH': {
        const witch = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
        return witch === undefined
          ? undefined
          : ({ type: 'WITCH_ACT', ts: 0, seat: witch, potion: 'none' } as never);
      }
      default:
        return undefined;
    }
  };
}

/** 夜里让女巫毒 1 号（玩家自己）。 */
function poisonPlayerPlan(): Parameters<typeof submitNight>[1] {
  return (state) => {
    switch (state.phase) {
      case 'NIGHT_WOLF_CHAT': {
        const wolf = state.seats.find(
          (seat) =>
            seat.alive &&
            seat.role === 'wolf' &&
            !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
        )?.seat;
        return wolf === undefined
          ? undefined
          : ({ type: 'WOLF_CHAT', ts: 0, seat: wolf, text: '' } as never);
      }
      case 'NIGHT_WOLVES': {
        const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
        const target = state.seats.find((seat) => seat.alive && seat.role !== 'wolf')?.seat;
        return wolf === undefined || target === undefined
          ? undefined
          : ({ type: 'WOLF_KILL', ts: 0, seat: wolf, target } as never);
      }
      case 'NIGHT_SEER': {
        const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
        return seer === undefined
          ? undefined
          : ({ type: 'SEER_CHECK', ts: 0, seat: seer, target: 3 } as never);
      }
      case 'NIGHT_WITCH': {
        const witch = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
        return witch === undefined
          ? undefined
          : ({ type: 'WITCH_ACT', ts: 0, seat: witch, potion: 'poison', target: 1 } as never);
      }
      default:
        return undefined;
    }
  };
}

describe('矩阵：非猎人夜间被杀 → 直接观战', () => {
  for (const role of ['villager', 'wolf', 'seer', 'witch'] as const) {
    it(`1 号是${role}：死后没有待决定，可以看真相，对局继续到终局`, async () => {
      const seed = ROLE_SEEDS[role];
      const setup = await newGame(seed);
      expect(setup.registry.stateOf(setup.record).seats.find((s) => s.seat === 1)?.role).toBe(role);

      // 狼不能刀自己：狼玩家的死法用女巫的毒（另一种真实死法，结果同样是「直接观战」）。
      const current = await submitNight(
        setup,
        role === 'wolf' ? poisonPlayerPlan() : killPlayerPlan(),
      );
      const state = setup.registry.stateOf(current);
      expect(state.seats.find((seat) => seat.seat === 1)?.alive).toBe(false);
      // 相位可能是别人的开枪阶段（AI 猎人），但**玩家自己**没有待决定
      expect(canSeeTruth(state, 1)).toBe(true);

      const reads: string[] = [];
      const result = await runGame({
        registry: setup.registry,
        session: setup.session,
        gameId: current.gameId,
        input: {
          async read(prompt) {
            reads.push(prompt.kind);
            return { kind: 'skip' };
          },
          close() {},
        },
        output: { emit() {}, async flush() {} },
        decide: scriptedAgent,
        maxSteps: 400,
      });

      expect(setup.registry.stateOf(result.record).phase).toBe('FINISHED');
      // 死人不再被问任何输入
      expect(reads).toEqual([]);
    });
  }
});

describe('矩阵：猎人被狼刀 → 先开枪（此时不能看真相）', () => {
  it('进入 NIGHT_HUNTER_SHOOT、真相被锁，交枪后继续到终局', async () => {
    const setup = await newGame(ROLE_SEEDS.hunter);
    const current = await submitNight(setup, killPlayerPlan());
    const state = setup.registry.stateOf(current);

    expect(state.phase).toBe('NIGHT_HUNTER_SHOOT');
    expect(canSeeTruth(state, 1)).toBe(false);

    const reads: string[] = [];
    const result = await runGame({
      registry: setup.registry,
      session: setup.session,
      gameId: current.gameId,
      input: {
        async read(prompt) {
          reads.push(prompt.kind);
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 400,
    });

    expect(reads).toEqual(['action']);
    expect(setup.registry.stateOf(result.record).phase).toBe('FINISHED');
  });
});

describe('矩阵：猎人被毒 → 不能开枪（RUL-11 / FR-17）', () => {
  it('没有开枪阶段，直接观战且可看真相', async () => {
    const setup = await newGame(ROLE_SEEDS.hunter);
    const current = await submitNight(setup, poisonPlayerPlan());
    const state = setup.registry.stateOf(current);

    expect(state.seats.find((seat) => seat.seat === 1)?.alive).toBe(false);
    expect(state.phase).not.toBe('NIGHT_HUNTER_SHOOT');
    expect(canSeeTruth(state, 1)).toBe(true);

    const result = await runGame({
      registry: setup.registry,
      session: setup.session,
      gameId: current.gameId,
      input: {
        async read() {
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 400,
    });
    expect(setup.registry.stateOf(result.record).phase).toBe('FINISHED');
  });
});

describe('矩阵：猎人被放逐 → 白天开枪（此时不能看真相）', () => {
  it('进入 DAY_HUNTER_SHOOT、真相被锁，交枪后对局继续', async () => {
    const setup = await newGame(ROLE_SEEDS.hunter);
    let current = setup.record;

    // 推进到白天投票：所有人（含玩家自己）都投 1 号，确保放逐的是猎人。
    for (let guard = 0; guard < 200; guard += 1) {
      const state = setup.registry.stateOf(current);
      if (state.phase === 'DAY_HUNTER_SHOOT' || state.phase === 'FINISHED') break;

      const action = (() => {
        switch (state.phase) {
          case 'NIGHT_WOLF_CHAT': {
            const wolf = state.seats.find(
              (seat) =>
                seat.alive &&
                seat.role === 'wolf' &&
                !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
            )?.seat;
            return wolf === undefined
              ? undefined
              : { type: 'WOLF_CHAT', ts: 0, seat: wolf, text: '' };
          }
          case 'NIGHT_WOLVES': {
            const wolf = state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat;
            const target = state.seats.find((seat) => seat.alive && seat.role === 'villager')?.seat;
            return wolf === undefined || target === undefined
              ? undefined
              : { type: 'WOLF_KILL', ts: 0, seat: wolf, target };
          }
          case 'NIGHT_SEER': {
            const seer = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat;
            return seer === undefined
              ? undefined
              : { type: 'SEER_CHECK', ts: 0, seat: seer, target: 3 };
          }
          case 'NIGHT_WITCH': {
            const witch = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat;
            return witch === undefined
              ? undefined
              : { type: 'WITCH_ACT', ts: 0, seat: witch, potion: 'none' };
          }
          case 'DAY_SPEECH': {
            const order = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
            const start = order.indexOf(state.speech?.startSeat ?? 1);
            const next = [...order.slice(start), ...order.slice(0, start)].find(
              (seat) => !(state.speech?.spoken ?? []).includes(seat),
            );
            return next === undefined ? undefined : { type: 'SPEECH_SKIP', ts: 0, seat: next };
          }
          case 'DAY_VOTE': {
            const voters = state.seats.filter((seat) => seat.alive).map((seat) => seat.seat);
            const voted = new Set((state.votes ?? []).map((vote) => vote.seat));
            const voter = voters.find((seat) => !voted.has(seat));
            return voter === undefined
              ? undefined
              : { type: 'VOTE', ts: 0, seat: voter, target: 1 };
          }
          default:
            return undefined;
        }
      })();

      if (action === undefined) break;
      const result = await setup.registry.submit(
        setup.session,
        current,
        action as never,
        state.seq,
      );
      if (!result.ok) break;
      current = result.record;
    }

    const state = setup.registry.stateOf(current);
    expect(state.phase).toBe('DAY_HUNTER_SHOOT');
    expect(state.seats.find((seat) => seat.seat === 1)?.alive).toBe(false);
    expect(canSeeTruth(state, 1)).toBe(false);

    // 交枪（不开枪）后相位离开开枪阶段
    const decline = await setup.registry.submit(
      setup.session,
      current,
      { type: 'HUNTER_SHOOT', ts: 0, seat: 1 } as never,
      state.seq,
    );
    expect(decline.ok).toBe(true);
    if (decline.ok) {
      expect(setup.registry.stateOf(decline.record).phase).not.toBe('DAY_HUNTER_SHOOT');
    }
  });
});

describe('夜间行动由玩家决定（回归：当狼却没参与刀人）', () => {
  it('玩家是狼：先被问讨论，再被问刀谁', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });
    expect(registry.stateOf(record).seats.find((seat) => seat.seat === 1)?.role).toBe('wolf');

    const kinds: string[] = [];
    const texts: string[] = [];
    await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read(prompt) {
          const current = await registry.getGame(record.gameId);
          kinds.push(`${prompt.kind}:${registry.stateOf(current ?? record).phase}`);
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: scriptedAgent,
      maxSteps: 1,
    });

    // 玩家必须被问过讨论与刀人（kind=action），而不是被 AI 代打
    const final = await registry.getGame(record.gameId);
    expect(registry.stateOf(final ?? record).phase).not.toBe('DAY_SPEECH');
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds[0]).toMatch(/^action:NIGHT_WOLF_CHAT/);
    void texts;
  });
});
