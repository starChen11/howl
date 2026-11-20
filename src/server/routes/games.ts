import type { FastifyInstance } from 'fastify';

import {
  CreateGameBodySchema,
  PendingQuerySchema,
  SubmitActionBodySchema,
  type ApiError,
  type CreateGameResponse,
  type SessionResponse,
} from '@shared/api';
import type { ProjectedContext } from '@shared/project';
import type { PendingDecision } from '@shared/project';

import { project } from '../project';
import { replay } from '@engine/replay';
import { buildTruth, canSeeTruth } from '../view/truth';
import { TruthViewSchema } from '@shared/truth';
import { ReplaySnapshotSchema } from '@shared/replay-schema';
import { nextActor, pendingForPhase, seatToSpeak } from '../orchestrator';
import { isWithinLimit, remainingSeconds } from '../speech';
import { resolveSession } from '../session';
import type { GameRegistry } from '../store/game-registry';
import type { ChannelRegistry } from '../channels/session';
import type { GameLoop } from '../game-loop';

/**
 * 对局与会话的路由（RFC-008 §2.2）。
 *
 * 两条贯穿全文件的规则：
 * 1. 入参一律先过 Zod，失败返回 `400 VALIDATION_FAILED` 与结构化错误码，**不抛 500**；
 * 2. 不属于当前会话的 `gameId` 与不存在的 `gameId` 返回**同一个** 404（不泄露存在性）。
 */

export interface GameRoutesOptions {
  registry: GameRegistry;
  production: boolean;
  channels: ChannelRegistry;
  /** 整局入口；没有注入时 `POST /play` 返回 501。 */
  loop: GameLoop | null;
}

function validationError(message: string, issues: string[] = []): ApiError {
  return { error: 'VALIDATION_FAILED', message, issues };
}

export function registerGameRoutes(app: FastifyInstance, options: GameRoutesOptions): void {
  const { registry, production, channels, loop } = options;

  app.post('/api/games', async (request, reply) => {
    const parsed = CreateGameBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
      return reply.code(400).send(validationError('请求体不合法', issues));
    }

    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.createGame(session, parsed.data);

    const response: CreateGameResponse = {
      gameId: record.gameId,
      seed: record.seed,
      playerSeat: record.playerSeat,
      version: registry.stateOf(record).seq,
    };
    return reply.code(201).send(response);
  });

  app.get('/api/session', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const response: SessionResponse = {
      sessionId: session.id,
      games: await registry.listGames(session),
    };
    return reply.send(response);
  });

  app.get<{ Params: { id: string }; Querystring: { pending?: string } }>(
    '/api/games/:id',
    async (request, reply) => {
      const { session } = await resolveSession(registry, request, reply, production);
      const record = await registry.getGame(request.params.id);

      // 不存在与「不属于本会话」返回同一个响应：否则枚举 id 就能探出别人的对局。
      if (record === undefined || !session.gameIds.includes(record.gameId)) {
        return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
      }

      if (record.events.length === 0) {
        return reply.code(410).send({ error: 'GAME_EXPIRED', message: '对局已释放' });
      }

      const pendingParsed = PendingQuerySchema.safeParse(request.query);
      if (!pendingParsed.success) {
        return reply.code(400).send(validationError('查询参数不合法'));
      }
      const state = registry.stateOf(record);
      // 没显式指定时按阶段给默认值：投影要靠它算 `legalTargets`，
      // 否则前端的投票/查验按钮会没有目标（RFC-012 C-127）。
      // 默认 `pending` **只给当前行动者**：夜间给所有人投影一个具体动作，
      // 等于告诉旁观者「某个神职还活着并且正在行动」（C-133，RFC-007 C-28）。
      // 发言阶段的行动者由发言顺序决定（`nextActor` 只覆盖按角色/投票的相位）。
      const playerIsWolf =
        state.seats.find((seat) => seat.isPlayer)?.role === 'wolf' &&
        state.seats.find((seat) => seat.isPlayer)?.alive === true;
      const actor =
        state.phase === 'NIGHT_WOLF_CHAT' && playerIsWolf
          ? record.playerSeat
          : (seatToSpeak(state) ?? nextActor(state));
      const defaultPending = actor === record.playerSeat ? pendingForPhase(state.phase) : null;
      const pending = (pendingParsed.data.pending ?? defaultPending) as PendingDecision | null;
      const view: ProjectedContext = project({
        state,
        events: record.events,
        observer: record.playerSeat,
        pending,
      });

      return reply.send({ version: state.seq, view });
    },
  );

  // 整局入口（RFC-012 AC-15）：启动后由服务端推进，客户端只渲染。
  app.post<{ Params: { id: string } }>('/api/games/:id/play', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }
    if (loop === null) {
      return reply.code(501).send({ error: 'NOT_IMPLEMENTED', message: '整局入口未启用' });
    }

    const started = loop.start(session, record.gameId);
    return reply.code(started ? 202 : 200).send({ started });
  });

  // 复盘视角（RFC-014 §2.4）：把事件截断到 seq 后重新投影，不猜。
  app.get<{ Params: { id: string; seat: string }; Querystring: { seq?: string } }>(
    '/api/games/:id/replay/seat/:seat',
    async (request, reply) => {
      const { session } = await resolveSession(registry, request, reply, production);
      const record = await registry.getGame(request.params.id);
      if (record === undefined || !session.gameIds.includes(record.gameId)) {
        return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
      }
      if (record.status !== 'finished') {
        return reply.code(404).send({ error: 'NOT_FINISHED', message: '对局还没有结束' });
      }
      if (record.events.length === 0) {
        return reply.code(410).send({ error: 'GAME_EXPIRED', message: '对局已释放' });
      }

      const seat = Number(request.params.seat);
      const seq = Number(request.query.seq ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isInteger(seat) || seat < 1 || seat > 9 || Number.isNaN(seq)) {
        return reply.code(400).send({ error: 'VALIDATION_FAILED', message: '参数不合法' });
      }

      const truncated = record.events.filter((event) => event.seq <= seq);
      const state = replay(truncated as never);
      const view = project({
        state,
        events: truncated,
        observer: seat as never,
        pending: null,
      });

      return reply.send({ seat, seq, view });
    },
  );

  // 真相视图（RFC-013 / SEC-6）：只有**已出局**的玩家能拿到。
  app.get<{ Params: { id: string } }>('/api/games/:id/truth', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }

    const state = registry.stateOf(record);
    if (!canSeeTruth(state, record.playerSeat)) {
      return reply.code(403).send({
        error: 'TRUTH_LOCKED',
        message: '对局进行中不能查看真相',
      });
    }

    // 响应也过同一份契约：字段一改，服务端先炸，而不是让客户端悄悄错位。
    return reply.send(TruthViewSchema.parse(buildTruth(state, record.events)));
  });

  // 草稿同步：客户端每敲几个字就 POST 一次，超时由服务端用它提交（AC-6）。
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    '/api/games/:id/input',
    async (request, reply) => {
      const { session } = await resolveSession(registry, request, reply, production);
      const record = await registry.getGame(request.params.id);
      if (record === undefined || !session.gameIds.includes(record.gameId)) {
        return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
      }

      const text = typeof request.body?.text === 'string' ? request.body.text : '';
      // 草稿也是玩家输入，同样要过 300 字上限（SEC-4）；否则超时提交会绕过 AC-5。
      if (!isWithinLimit(text)) {
        return reply.code(400).send({
          error: 'VALIDATION_FAILED',
          message: '发言超过 300 字',
          issues: ['text'],
        });
      }

      channels.setDraft(record.gameId, text);
      return reply.send({ ok: true });
    },
  );

  // 倒计时以服务端为准：刷新页面后剩余时间不回满（AC-13）。
  app.get<{ Params: { id: string } }>('/api/games/:id/timer', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }

    if (record.events.length === 0) {
      return reply.code(410).send({ error: 'GAME_EXPIRED', message: '对局已释放' });
    }

    // 起点来自事件流：最近一次 `DAY_STARTED`，或最近一条**开始新一轮**的发言事件
    // （`SPEECH` / `SPEECH_SKIPPED` 都算——跳过也是说完了，下一位的 60 秒重新计时）。
    // 不 replay：timer 只需要事件流里的时间戳，而 replay 会因为「事件不全」抛错
    // （比如已释放、或只保留部分事件的局）。
    const startEvent = [...record.events]
      .reverse()
      .find(
        (event) =>
          event.type === 'DAY_STARTED' ||
          event.type === 'SPEECH' ||
          event.type === 'SPEECH_SKIPPED',
      );

    const lastPhase = [...record.events]
      .reverse()
      .find((event) => event.type === 'PHASE_CHANGED' || event.type === 'GAME_ENDED');

    return reply.send({
      phase:
        lastPhase === undefined
          ? 'UNKNOWN'
          : lastPhase.type === 'PHASE_CHANGED'
            ? (lastPhase.payload as { to: string }).to
            : 'FINISHED',
      startedAt: startEvent?.ts ?? null,
      remainingSeconds:
        startEvent === undefined
          ? 0
          : remainingSeconds({ startedAt: startEvent.ts, now: Date.now() }),
    });
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/actions', async (request, reply) => {
    const parsed = SubmitActionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
      return reply.code(400).send(validationError('请求体不合法', issues));
    }

    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }
    if (record.events.length === 0) {
      return reply.code(410).send({ error: 'GAME_EXPIRED', message: '对局已释放' });
    }

    // B2：玩家只能提交**自己席位**的动作。不校验的话，玩家可以代 wolf 下刀、代 seer
    // 查验——顺带还能读到对方的私有事件（响应里那条 SEER_CHECKED）。
    // RFC-011 §2.2：空输入等于弃权。引擎会老老实实写一条空 `SPEECH`，
    // 但那不是「说了句空话」，所以这里直接拒绝，让客户端改发 `SPEECH_SKIP`。
    if (parsed.data.action.type === 'SPEECH' && parsed.data.action.text.trim().length === 0) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        message: '空输入应提交 SPEECH_SKIP（弃权）',
        issues: ['action.text'],
      });
    }

    // AC-5 / SEC-4：前端限制之外，后端必须再校验一次。按 Unicode 字符数算。
    if (parsed.data.action.type === 'SPEECH' && !isWithinLimit(parsed.data.action.text)) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        message: '发言超过 300 字',
        issues: ['action.text'],
      });
    }

    // RUL-13 之后刀口只能由狼队投票产生：旧客户端/脚本如果直接提交 WOLF_KILL，
    // 等于用一个请求替全队做决定，必须拒绝（引擎仍接受它只是为了旧回放能重放）。
    if (parsed.data.action.type === 'WOLF_KILL') {
      return reply.code(400).send({
        error: 'LEGACY_ACTION_DISABLED',
        message: '狼刀已改为狼队投票，请提交 WOLF_VOTE',
      });
    }

    const seatOfAction = 'seat' in parsed.data.action ? parsed.data.action.seat : undefined;
    if (seatOfAction !== undefined && seatOfAction !== record.playerSeat) {
      return reply.code(403).send({
        error: 'NOT_YOUR_SEAT',
        message: `只能操作自己的席位（${record.playerSeat} 号）`,
      });
    }

    const result = await registry.submit(
      session,
      record,
      parsed.data.action as never,
      parsed.data.expectedVersion,
    );
    if (!result.ok) {
      return reply.code(409).send({
        error: result.code,
        message: result.code === 'ALREADY_APPLIED' ? '该动作已经应用过' : '版本不匹配',
        version: result.version,
      });
    }

    // 引擎**接受**之后才把这句话交给挂起的输入通道：先通知再提交的话，
    // 被引擎拒绝（夜间提交发言）也会让编排层以为玩家说过话（C-107）。
    const accepted = !result.events.some((event) => event.type === 'REJECTED');
    if (accepted && parsed.data.action.type === 'SPEECH') {
      channels.submit(record.gameId, parsed.data.action.text);
    }
    // 弃权也要兑现挂起的输入，否则编排层会一直等到 60 秒超时（C-115）。
    if (accepted && parsed.data.action.type === 'SPEECH_SKIP') {
      channels.submit(record.gameId, '');
    }
    // 投票同理：把目标席位交给挂起的投票轮（RFC-012 AC-11 的「发言 → 投票」）。
    if (accepted && parsed.data.action.type === 'VOTE') {
      const target = parsed.data.action.target;
      channels.submit(record.gameId, target === 'abstain' ? '' : String(target));
    }
    if (accepted && parsed.data.action.type === 'WOLF_CHAT' && parsed.data.action.text.trim() === '') {
      return reply.code(400).send({
        error: 'EMPTY_WOLF_CHAT',
        message: '狼队聊天不能是空消息；要结束讨论请点「准备完成」',
      });
    }

    // 夜间动作同理：把目标/文本交给挂起的输入，避免 60 秒后提交迟到动作。
    // 自曝会让白天立即结束：挂起的发言等待要被兑现，否则编排层会等 60 秒超时。
    if (accepted && parsed.data.action.type === 'SELF_EXPOSE') {
      channels.submit(record.gameId, '');
    }
    if (accepted && parsed.data.action.type === 'WOLF_CHAT') {
      channels.submit(record.gameId, parsed.data.action.text);
    }
    // 准备完成：让编排层从「等玩家发言」中醒来（它会在重读后看到已经准备）。
    if (accepted && parsed.data.action.type === 'WOLF_READY') {
      channels.submit(record.gameId, '');
    }
    if (
      accepted &&
      (parsed.data.action.type === 'WOLF_VOTE' || parsed.data.action.type === 'SEER_CHECK')
    ) {
      channels.submit(record.gameId, String(parsed.data.action.target));
    }
    if (accepted && parsed.data.action.type === 'WITCH_ACT') {
      channels.submit(
        record.gameId,
        parsed.data.action.potion === 'none'
          ? 'none'
          : `${parsed.data.action.potion}:${String(parsed.data.action.target ?? '')}`,
      );
    }
    // 开枪也要兑现挂起的输入：否则编排层等 60 秒后提交一个「不开枪」，
    // 此时相位已经推进，那个迟到动作会被拒，runGame 随即 break、对局冻住。
    if (accepted && parsed.data.action.type === 'HUNTER_SHOOT') {
      const target = parsed.data.action.target;
      channels.submit(record.gameId, target === undefined ? '' : String(target));
    }

    // B1：只回该席位可见的事件。`step` 的原始事件里含 `server` 可见的死亡与夜间相位。
    return reply.send({
      version: result.version,
      events: registry.visibleEventsOf(result.record, record.playerSeat),
    });
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/replay', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }
    if (record.status !== 'finished') {
      return reply.code(404).send({ error: 'NOT_FINISHED', message: '对局还没有结束' });
    }

    // 快照在终局时生成并落盘；即便事件流被释放，它仍然在（AC-13）。
    return reply.send(ReplaySnapshotSchema.parse(record.snapshot));
  });
}
