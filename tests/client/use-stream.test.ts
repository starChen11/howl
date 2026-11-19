import { describe, expect, it } from 'vitest';

import { initialStreamState, markUnstable, streamReducer } from '@client/use-stream';

/**
 * RFC-010 §5 AC-1 / 2 / 4 / 5（客户端侧）：纯状态机。
 *
 * 不依赖 DOM：`useStream` 的实现是 reducer，界面只负责渲染它的字段。
 */

describe('AC-4 · thinking 与 speaking 可区分', () => {
  it('thinking 之后 phase=thinking，首个 delta 之后变成 speaking', () => {
    let state = streamReducer(initialStreamState, { type: 'thinking', id: 1, seat: 3 });
    expect(state.phase).toBe('thinking');
    expect(state.sawThinking).toBe(true);

    state = streamReducer(state, { type: 'delta', id: 1, seat: 3, text: '我' }, 1_800);
    expect(state.phase).toBe('speaking');
    expect(state.text).toBe('我');
    expect(state.firstDeltaAt).toBe(1_800);
  });
});

describe('AC-2 · 逐字累加，done 之前已有中间态', () => {
  it('两个 delta 之后 text 是中间态，done 才补全', () => {
    let state = streamReducer(initialStreamState, {
      type: 'delta',
      id: 1,
      seat: 3,
      text: '我觉得',
    });
    expect(state.text).toBe('我觉得');

    state = streamReducer(state, { type: 'delta', id: 1, seat: 3, text: ' 2 号像' });
    expect(state.text).toBe('我觉得 2 号像');
    expect(state.phase).toBe('speaking');

    state = streamReducer(state, { type: 'done', id: 2, seat: 3, text: '我觉得 2 号像狼' });
    expect(state.phase).toBe('done');
    expect(state.text).toBe('我觉得 2 号像狼');
  });
});

describe('AC-5 · 重连不重复渲染', () => {
  it('id 不大于已知 id 的消息被丢弃', () => {
    const state = streamReducer(initialStreamState, { type: 'done', id: 5, seat: 1, text: 'a' });
    const replay = streamReducer(state, { type: 'done', id: 5, seat: 1, text: 'b' });

    expect(replay.text).toBe('a');
    expect(replay.lastId).toBe(5);
  });
});

describe('降级与错误', () => {
  it('degraded 把 phase 置为 degraded；error 置为 error', () => {
    const degraded = streamReducer(initialStreamState, { type: 'degraded', id: 1, seat: 2 });
    expect(degraded.phase).toBe('degraded');

    const errored = streamReducer(degraded, { type: 'error', id: 2, message: '超时' });
    expect(errored.phase).toBe('error');
  });

  it('markUnstable 在第 3 次后置位，且只置一次', () => {
    const once = markUnstable(initialStreamState, 3);
    expect(once.warned).toBe(true);
    expect(markUnstable(initialStreamState, 2).warned).toBe(false);
  });
});
