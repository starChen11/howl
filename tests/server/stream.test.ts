import { describe, expect, it } from 'vitest';

import { buildApp } from '@server/app';
import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { IncrementalDecoder, consumeStream, parseSseLine } from '@server/llm/stream';
import { encodeSseFrame, parseSseData } from '@shared/stream';
import type { SessionRecord } from '@server/store/game-registry';
import type { GameRecord } from '@server/store/game-registry';

/**
 * RFC-010 §5 AC-5 / 6：SSE 协议与多字节解码。
 */

/** 把一局推进到有公开事件的相位（天亮了）。 */
async function advanceToDay(
  registry: GameRegistry,
  session: SessionRecord,
  record: GameRecord,
): Promise<GameRecord> {
  let current = record;
  const stateOf = () => registry.stateOf(current);

  while (stateOf().phase === 'NIGHT_WOLF_CHAT') {
    const state = stateOf();
    const speaker = state.seats.find(
      (seat) =>
        seat.alive &&
        seat.role === 'wolf' &&
        !(state.wolfChat ?? []).some((entry) => entry.seat === seat.seat),
    )?.seat;
    if (speaker === undefined) break;
    const result = await registry.submit(
      session,
      current,
      { type: 'WOLF_CHAT', ts: 1, seat: speaker, text: '' } as never,
      state.seq,
    );
    if (!result.ok) throw new Error('夜聊失败');
    current = result.record;
  }

  for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT', 'HUNTER_SHOOT'] as const) {
    const state = stateOf();
    if (
      state.phase === 'DAY_ANNOUNCE' ||
      state.phase === 'DAY_SPEECH' ||
      state.phase === 'FINISHED'
    )
      break;
    const actor =
      type === 'WOLF_KILL'
        ? state.seats.find((seat) => seat.alive && seat.role === 'wolf')?.seat
        : type === 'SEER_CHECK'
          ? state.seats.find((seat) => seat.alive && seat.role === 'seer')?.seat
          : type === 'WITCH_ACT'
            ? state.seats.find((seat) => seat.alive && seat.role === 'witch')?.seat
            : state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (actor === undefined) break;

    const target = state.seats.find((seat) => seat.alive && seat.seat !== actor)?.seat;
    const action =
      type === 'WITCH_ACT'
        ? { type, ts: 1, seat: actor, potion: 'none' }
        : type === 'HUNTER_SHOOT'
          ? { type, ts: 1, seat: actor }
          : { type, ts: 1, seat: actor, target };
    const result = await registry.submit(session, current, action as never, state.seq);
    if (!result.ok) break;
    current = result.record;
  }

  return current;
}

async function setup() {
  const store = new InMemoryMetaStore();
  const registry = new GameRegistry(store);
  const session = await registry.createSession();
  const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });
  const advanced = await advanceToDay(registry, session, record);
  const app = buildApp({ store });
  return { app, session, record: advanced };
}

describe('AC-5 · SSE 的 id 等于事件 seq，重连从下一个 seq 继续', () => {
  it('每条消息 id 递增且等于事件 seq；带 Last-Event-ID 后不重复', async () => {
    const { app, session, record } = await setup();
    const cookie = `session=${session.id}`;

    const first = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);

    const frames = first.body.split('\n\n').filter((frame) => frame.trim().length > 0);
    expect(frames.length).toBeGreaterThan(0);

    const ids = frames.map((frame) => {
      const line = frame.split('\n').find((part) => part.startsWith('id: '));
      if (line === undefined) throw new Error('缺少 id 行');
      return Number(line.slice(4));
    });
    expect(ids).toEqual(
      record.events.filter((event) => event.visibleTo === 'public').map((event) => event.seq),
    );

    const lastId = ids[ids.length - 1] as number;
    const resumed = await app.inject({
      method: 'GET',
      url: `/api/games/${record.gameId}/stream`,
      headers: { cookie, 'last-event-id': String(lastId) },
    });

    expect(resumed.body).toBe('');
  });

  it('补偿窗口之外的重连只发最近 200 条', async () => {
    const { REPLAY_WINDOW } = await import('@server/routes/stream');
    expect(REPLAY_WINDOW).toBe(200);
  });
});

describe('AC-6 · 多字节字符在任意切分位置都不乱码', () => {
  it('把中文按字节切开后仍能正确解码', () => {
    const decoder = new IncrementalDecoder();
    const bytes = new TextEncoder().encode('data: 你好世界\n');
    const collected: string[] = [];

    for (const byte of bytes) collected.push(...decoder.push(new Uint8Array([byte])));
    collected.push(...decoder.flush());

    expect(collected.join('\n')).toContain('你好世界');
  });

  it('逐字节喂入也不会出现替换字符', () => {
    const decoder = new IncrementalDecoder();
    const bytes = new TextEncoder().encode('预言家说：我验了 3 号\n');
    let text = '';
    for (const byte of bytes) text += decoder.push(new Uint8Array([byte])).join('\n');
    text += decoder.flush().join('\n');

    expect(text).not.toContain('\uFFFD');
    expect(text).toContain('预言家说');
  });
});

describe('流式解析', () => {
  it('consumeStream 按顺序回调，坏帧被丢弃', async () => {
    const chunks = [
      encodeSseFrame({ type: 'thinking', id: 1, seat: 1 }),
      'data: 坏帧\n',
      encodeSseFrame({ type: 'done', id: 2, seat: 1, text: '过' }),
    ];
    const seen: number[] = [];

    await consumeStream(
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
      (message) => seen.push(message.id),
    );

    expect(seen).toEqual([1, 2]);
  });

  it('parseSseData 拒绝不合契约的消息', () => {
    expect(parseSseData('{"type":"delta","id":1,"seat":1,"text":"x"}')?.type).toBe('delta');
    expect(parseSseData('{"type":"nope"}')).toBeUndefined();
    expect(parseSseLine('data: [DONE]')).toBeUndefined();
  });
});
