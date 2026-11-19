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
import { isWithinLimit, remainingSeconds } from '../speech';
import { resolveSession } from '../session';
import type { GameRegistry } from '../store/game-registry';
import type { ChannelRegistry } from '../channels/session';

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
}

function validationError(message: string, issues: string[] = []): ApiError {
  return { error: 'VALIDATION_FAILED', message, issues };
}

export function registerGameRoutes(app: FastifyInstance, options: GameRoutesOptions): void {
  const { registry, production, channels } = options;

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
      const pending = (pendingParsed.data.pending ?? null) as PendingDecision;

      const state = registry.stateOf(record);
      const view: ProjectedContext = project({
        state,
        events: record.events,
        observer: record.playerSeat,
        pending,
      });

      return reply.send({ version: state.seq, view });
    },
  );

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

    // 起点来自事件流：最近一次 `DAY_STARTED` 或最近一条发言事件的 `ts`。
    const state = registry.stateOf(record);
    const startEvent = [...record.events]
      .reverse()
      .find((event) => event.type === 'DAY_STARTED' || event.type === 'SPEECH');

    return reply.send({
      phase: state.phase,
      startedAt: startEvent?.ts ?? null,
      remainingSeconds:
        startEvent === undefined
          ? remainingSeconds({ startedAt: 0, now: 0 })
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
    // AC-5 / SEC-4：前端限制之外，后端必须再校验一次。按 Unicode 字符数算。
    if (parsed.data.action.type === 'SPEECH' && !isWithinLimit(parsed.data.action.text)) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        message: '发言超过 300 字',
        issues: ['action.text'],
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
    if (
      parsed.data.action.type === 'SPEECH' &&
      !result.events.some((event) => event.type === 'REJECTED')
    ) {
      channels.submit(record.gameId, parsed.data.action.text);
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

    return reply.code(404).send({ error: 'NOT_FINISHED', message: '复盘由 RFC-014 实现' });
  });
}
