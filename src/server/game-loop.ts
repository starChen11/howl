import type { InputChannel, OutputChannel } from '@shared/channels';

import type { Decider } from './ai/agent';
import { loadPhaseTimers } from './config/phase-timers';
import { runGame } from './orchestrator';
import type { GameRegistry, SessionRecord } from './store/game-registry';
import type { ChannelRegistry } from './channels/session';

/**
 * 整局入口（RFC-012 §5 AC-15 / AC-16）。
 *
 * 一局从开局推进到 `FINISHED`：
 * - AI 席位 → 注入的 `Decider`（生产是模型，端到端是脚本替身）；
 * - 玩家席位 → `ChannelRegistry` 里挂起的输入通道（`POST /actions` 兑现）；
 * - 发言增量 → `SseOutputChannel` 推到 RFC-010 的流。
 *
 * **不双写**：玩家发言只经一条路径写入（`orchestrator` 每轮重读，见 RFC-011 C-113）。
 */

export interface GameLoopOptions {
  registry: GameRegistry;
  channels: ChannelRegistry;
  /** 按对局构造 decider（模型需要 gameId 与 seq）。 */
  makeDecider: (gameId: string) => Decider;
  /** 测试可注入更短的步数上限。 */
  maxSteps?: number;
}

export class GameLoop {
  private readonly running = new Set<string>();
  private readonly options: GameLoopOptions;

  constructor(options: GameLoopOptions) {
    this.options = options;
  }

  isRunning(gameId: string): boolean {
    return this.running.has(gameId);
  }

  /**
   * 启动一局。已经在跑就返回 `false`（幂等，避免双击开两局）。
   */
  start(session: SessionRecord, gameId: string): boolean {
    if (this.running.has(gameId)) return false;
    this.running.add(gameId);

    void this.run(session, gameId).finally(() => this.running.delete(gameId));
    return true;
  }

  private async run(session: SessionRecord, gameId: string): Promise<void> {
    const { registry, channels } = this.options;
    const decide = this.options.makeDecider(gameId);
    const channel = channels.forGame(gameId);
    const output: OutputChannel = channel.output;
    const input: InputChannel = channel.input;

    try {
      const phaseTimers = loadPhaseTimers();
      await runGame({
        registry,
        session,
        gameId,
        input,
        output,
        decide,
        // RUL-14 的时限：生产读环境变量（e2e 用极短时限），引擎本身不读时钟。
        wolfChatMs: phaseTimers.wolfChatMs,
        wolfReadyMs: Number(process.env['HOWL_WOLF_READY_MS'] ?? 0),
        wolfVoteMs: phaseTimers.wolfVoteMs,
        phaseTimers,
        wolfVoteDelayMs: Number(process.env['HOWL_WOLF_VOTE_DELAY_MS'] ?? 0),
        wolfAiReady: process.env['HOWL_WOLF_AI_READY'] === 'model' ? 'model' : 'auto',
        ...(this.options.maxSteps === undefined ? {} : { maxSteps: this.options.maxSteps }),
      });
    } catch (error) {
      // 循环失败不能让进程静默——至少留下一条可查的日志（生产入口开了 logger）。
      console.error('[game-loop] 推进失败', gameId, error);
    } finally {
      channels.forGame(gameId).input.close();
    }
  }
}
