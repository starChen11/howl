import { describe, expect, it } from 'vitest';

import { GameRegistry } from '@server/store/game-registry';
import { InMemoryMetaStore } from '@server/store/meta-store';
import { StreamBus } from '@server/stream/bus';
import { speak } from '@server/llm/speak';
import { currentSpeaker } from '@engine/phases/day';
import type { StreamMessage } from '@shared/stream';

/**
 * RFC-010 §5 AC-7 / 9 / 10 / 11 / 12 的生产侧接线（C-87）。
 *
 * 这里验证的是「一句话从生成到落盘的完整链路」：thinking → delta → 事件流 → done。
 * `bus`、`registry`、`runTurn` 三者以前各测各的，没有任何东西把它们串起来。
 */

async function setup() {
  const registry = new GameRegistry(new InMemoryMetaStore());
  const session = await registry.createSession();
  const record = await registry.createGame(session, { mode: 'slaughter-side', seed: 15 });
  const bus = new StreamBus();
  const seen: StreamMessage[] = [];
  bus.subscribe(record.gameId, (message) => seen.push(message));

  // 发言只能发生在白天：先把这一夜走完。
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
  for (const type of ['WOLF_KILL', 'SEER_CHECK', 'WITCH_ACT'] as const) {
    const state = stateOf();
    if (
      state.phase !== 'NIGHT_WOLVES' &&
      state.phase !== 'NIGHT_SEER' &&
      state.phase !== 'NIGHT_WITCH'
    )
      break;
    const actor =
      type === 'WOLF_KILL'
        ? state.seats.find((s) => s.alive && s.role === 'wolf')?.seat
        : type === 'SEER_CHECK'
          ? state.seats.find((s) => s.alive && s.role === 'seer')?.seat
          : state.seats.find((s) => s.alive && s.role === 'witch')?.seat;
    if (actor === undefined) break;
    const action =
      type === 'WITCH_ACT'
        ? { type, ts: 1, seat: actor, potion: 'none' }
        : {
            type,
            ts: 1,
            seat: actor,
            target: state.seats.find((s) => s.alive && s.seat !== actor)?.seat,
          };
    const result = await registry.submit(session, current, action as never, state.seq);
    if (!result.ok) break;
    current = result.record;
  }

  const speaker = currentSpeaker(registry.stateOf(current));
  if (speaker === undefined) throw new Error('没有当前发言者');
  return { registry, session, record: current, bus, seen, speaker };
}

describe('AC-10 / 11 · 正常发言：thinking → delta → 落盘 SPEECH → done', () => {
  it('事件流里多出一条 SPEECH，总线上有增量与 done', async () => {
    const { registry, session, record, bus, seen, speaker } = await setup();

    const result = await speak({
      registry,
      bus,
      session,
      record,
      seat: speaker,
      attempt: async () => ({ text: '我觉得 2 号像狼', failed: false }),
      limitMs: 5_000,
    });

    expect(result.degraded).toBe(false);
    expect(seen[0]?.type).toBe('thinking');
    expect(seen.some((message) => message.type === 'delta')).toBe(true);
    expect(seen[seen.length - 1]?.type).toBe('done');
    expect(result.record.events.filter((event) => event.type === 'SPEECH')).toHaveLength(1);
  });
});

describe('AC-7 / 9 · 降级：DEGRADED + 短句落盘，bus 推 degraded', () => {
  it('两次失败 → 短句 ≤ 10 字、事件流里有 DEGRADED 与 SPEECH', async () => {
    const { registry, session, record, bus, seen, speaker } = await setup();

    const result = await speak({
      registry,
      bus,
      session,
      record,
      seat: speaker,
      attempt: async () => ({ text: '', failed: true }),
      limitMs: 5_000,
    });

    expect(result.degraded).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(10);
    expect(seen.some((message) => message.type === 'degraded')).toBe(true);
    expect(result.record.events.some((event) => event.type === 'DEGRADED')).toBe(true);

    // 短句真的写进了事件流 → 发言 cursor 会前进，对局不会卡住
    const speech = result.record.events.find((event) => event.type === 'SPEECH');
    expect((speech?.payload as { text?: string } | undefined)?.text).toBe(result.text);
  });
});

describe('AC-12 · 连续 3 次降级后仍尝试真实调用', () => {
  it('第 4 次仍然调用 attempt（不是全跳过）', async () => {
    const { registry, session, record, bus, speaker } = await setup();
    let calls = 0;
    let current = record;
    let degradation;

    for (let index = 0; index < 4; index += 1) {
      const result = await speak({
        registry,
        bus,
        session,
        record: current,
        seat: speaker,
        attempt: async () => {
          calls += 1;
          return { text: '', failed: true };
        },
        limitMs: 5_000,
        ...(degradation === undefined ? {} : { degradation }),
      });
      current = result.record;
      degradation = result.degradation;
    }

    expect(calls).toBe(8); // 每轮重试一次
    expect(degradation?.total).toBe(4);
  });
});

describe('C-97 · 发言必须走引擎，不能绕过相位推进', () => {
  it('8 个席位都说完后，相位从 DAY_SPEECH 前进（不会卡住）', async () => {
    const { registry, session, record, bus } = await setup();
    let current = record;
    let guard = 0;

    while (registry.stateOf(current).phase === 'DAY_SPEECH' && guard < 12) {
      guard += 1;
      const speaker = currentSpeaker(registry.stateOf(current));
      if (speaker === undefined) break;
      const result = await speak({
        registry,
        bus,
        session,
        record: current,
        seat: speaker,
        attempt: async () => ({ text: '我过了。', failed: false }),
        limitMs: 5_000,
      });
      current = result.record;
    }

    expect(registry.stateOf(current).phase).not.toBe('DAY_SPEECH');
  });
});
