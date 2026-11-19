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
import { resolveSession } from '../session';
import type { GameRegistry } from '../store/game-registry';

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
}

function validationError(message: string, issues: string[] = []): ApiError {
  return { error: 'VALIDATION_FAILED', message, issues };
}

export function registerGameRoutes(app: FastifyInstance, options: GameRoutesOptions): void {
  const { registry, production } = options;

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

    const result = await registry.submit(
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

    return reply.send({ version: result.version, events: result.events });
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/replay', async (request, reply) => {
    const { session } = await resolveSession(registry, request, reply, production);
    const record = await registry.getGame(request.params.id);
    if (record === undefined || !session.gameIds.includes(record.gameId)) {
      return reply.code(404).send({ error: 'GAME_NOT_FOUND', message: '对局不存在' });
    }

    return reply.code(404).send({ error: 'NOT_FINISHED', message: '复盘由 RFC-014 实现' });
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/stream', async (_request, reply) =>
    reply.code(501).send({ error: 'NOT_IMPLEMENTED', message: '流式由 RFC-010 实现' }),
  );
}
