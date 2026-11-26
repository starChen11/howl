import { describe, expect, it } from 'vitest';

import { scriptedAgent } from '@server/ai/agent';
import { runGame } from '@server/orchestrator';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';

describe('RFC-022 / 投票并发', () => {
  it('白天放逐投票的 AI 模型调用是并发的', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 1,
      playerSeat: 1,
    });

    let activeDayVotes = 0;
    let maxActive = 0;
    await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read() {
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async (input) => {
        if (input.phase === 'DAY_VOTE') {
          activeDayVotes += 1;
          maxActive = Math.max(maxActive, activeDayVotes);
          await new Promise((resolve) => setTimeout(resolve, 30));
          activeDayVotes -= 1;
        }
        return scriptedAgent(input);
      },
      maxSteps: 500,
      wolfReadyMs: 0,
      wolfChatMs: 20,
      wolfVoteMs: 50,
      phaseTimers: {
        wolfChatMs: 20,
        wolfVoteMs: 50,
        seerMs: 50,
        witchMs: 50,
        hunterShootMs: 50,
        daySpeechMs: 50,
        pkSpeechMs: 50,
        dayVoteMs: 50,
        dayVoteRunoffMs: 50,
        sheriffSignupMs: 50,
        sheriffSpeechMs: 50,
        sheriffWithdrawMs: 50,
        sheriffVoteMs: 50,
        sheriffPkMs: 50,
        sheriffRunoffMs: 50,
        badgeTransferMs: 50,
        sheriffOrderMs: 50,
        sheriffFinalSpeechMs: 50,
      },
    });

    expect(maxActive).toBeGreaterThan(1);
  });
});

describe('RFC-022 / 狼队投票并发', () => {
  it('狼队投票的 AI 模型调用也是并发的', async () => {
    const registry = new GameRegistry(new InMemoryMetaStore());
    const session = await registry.createSession();
    const record = await registry.createGame(session, {
      mode: 'slaughter-side',
      seed: 3,
      playerSeat: 1,
    });

    let active = 0;
    let maxActive = 0;
    await runGame({
      registry,
      session,
      gameId: record.gameId,
      input: {
        async read() {
          return { kind: 'skip' };
        },
        close() {},
      },
      output: { emit() {}, async flush() {} },
      decide: async (input) => {
        if (input.phase === 'NIGHT_WOLVES') {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
        }
        return scriptedAgent(input);
      },
      maxSteps: 500,
      wolfReadyMs: 0,
      wolfChatMs: 20,
      wolfVoteMs: 50,
      phaseTimers: {
        wolfChatMs: 20,
        wolfVoteMs: 50,
        seerMs: 50,
        witchMs: 50,
        hunterShootMs: 50,
        daySpeechMs: 50,
        pkSpeechMs: 50,
        dayVoteMs: 50,
        dayVoteRunoffMs: 50,
        sheriffSignupMs: 50,
        sheriffSpeechMs: 50,
        sheriffWithdrawMs: 50,
        sheriffVoteMs: 50,
        sheriffPkMs: 50,
        sheriffRunoffMs: 50,
        badgeTransferMs: 50,
        sheriffOrderMs: 50,
        sheriffFinalSpeechMs: 50,
      },
    });

    expect(maxActive).toBeGreaterThan(1);
  });
});
