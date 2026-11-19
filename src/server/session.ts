import type { FastifyReply, FastifyRequest } from 'fastify';

import { SESSION_TTL_MS, type GameRegistry, type SessionRecord } from './store/game-registry';

/**
 * 会话解析（RFC-008 §2.6）。
 *
 * 会话 id 是**唯一凭据**：没有账号系统，所以它必须随机且不可猜（`crypto.randomUUID`，
 * 36 字符）。cookie 的属性同样重要——`HttpOnly` 防止脚本读走，`SameSite=Lax` 防跨站。
 */

export const SESSION_COOKIE = 'session';

/** 会话 id 的最小长度。`randomUUID()` 是 36，留出余量。 */
export const MIN_SESSION_ID_LENGTH = 32;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_SESSION_ID_LENGTH;
}

export interface SessionContext {
  session: SessionRecord;
  created: boolean;
}

/** cookie 属性：`Secure` 只在生产加，否则本地 http 会丢 cookie。 */
export function sessionCookieOptions(production: boolean): {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: production,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** 从请求头里取 cookie（不依赖插件装饰器，插件在本文件外注册）。 */
export function readSessionCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

/**
 * 取当前会话；没有就新建（`GET /api/session` 的副作用，避免首访 401）。
 *
 * 新建的会话要在响应里下发 cookie —— 否则下一次请求又是一个新会话，对局就丢了。
 */
export async function resolveSession(
  registry: GameRegistry,
  request: FastifyRequest,
  reply: FastifyReply,
  production: boolean,
): Promise<SessionContext> {
  const raw = readSessionCookie(request);

  if (isSessionId(raw)) {
    const existing = await registry.getSession(raw);
    if (existing !== undefined) return { session: existing, created: false };
  }

  const session = await registry.createSession();
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=${session.id}; ${serializeCookie(sessionCookieOptions(production))}`,
  );
  return { session, created: true };
}

function serializeCookie(options: ReturnType<typeof sessionCookieOptions>): string {
  return [
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    'HttpOnly',
    `SameSite=Lax`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
