import { z } from 'zod';

import { SEAT_IDS, WIN_MODES } from './domain';
import { ActionSchema } from './schemas';

/**
 * HTTP 接口的请求与响应类型（RFC-008 §2.2）。
 *
 * 两端共用同一份（API-1）：服务端用它校验入参，客户端用它推导类型。**不要**在客户端
 * 另写一份结构，那会在改字段时悄悄错开。
 */

export const seatIdNum = z.number().int().min(1).max(9);

/** `POST /api/games` */
export const CreateGameBodySchema = z.object({
  mode: z.enum(WIN_MODES),
  playerSeat: z.literal(SEAT_IDS).optional(),
  seed: z.number().int().optional(),
});
export type CreateGameBody = z.infer<typeof CreateGameBodySchema>;

export interface CreateGameResponse {
  gameId: string;
  seed: number;
  playerSeat: number;
  version: number;
}

export interface GameSummary {
  gameId: string;
  status: 'active' | 'finished';
  createdAt: number;
  finishedAt?: number;
}

export interface SessionResponse {
  sessionId: string;
  /** 一对多的落点（ARCH-10）：同一会话可以有很多局。 */
  games: GameSummary[];
}

/** `GET /api/games/:id?pending=...` 的查询参数。 */
export const PendingQuerySchema = z.object({
  pending: z.enum(['speak', 'kill', 'check', 'witch', 'vote', 'shoot', 'chat']).optional(),
});

/** `POST /api/games/:id/actions` */
export const SubmitActionBodySchema = z.object({
  action: ActionSchema,
  expectedVersion: z.number().int().min(0),
});
export type SubmitActionBody = z.infer<typeof SubmitActionBodySchema>;

/** 错误码：调用方据此区分「重试」与「版本冲突」。 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'GAME_NOT_FOUND'
  | 'GAME_EXPIRED'
  | 'ALREADY_APPLIED'
  | 'VERSION_MISMATCH'
  | 'NOT_FINISHED'
  | 'NOT_IMPLEMENTED';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  /** 冲突时返回服务端当前版本，调用方据此重放。 */
  version?: number;
  /** 校验失败时的结构化错误列表。 */
  issues?: string[];
}
