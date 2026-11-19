import type { StreamMessage } from '@shared/stream';

/**
 * 流式状态机（RFC-010 §2.1）。
 *
 * **不依赖 DOM**：这样它可以在 node 环境里单测，也方便 RFC-012 的界面直接复用。
 * 界面只负责把 `state.text` 与 `state.phase` 渲染出来。
 */

export type StreamPhase = 'idle' | 'thinking' | 'speaking' | 'done' | 'degraded' | 'error';

export interface StreamState {
  phase: StreamPhase;
  seat: number | null;
  /** 已收到的正文（逐字累加）。 */
  text: string;
  /** 首字到达的时间戳，用于 NFR-1 的测量口径。 */
  firstDeltaAt: number | null;
  /** 最近一条消息的 `seq`，重连时作为 `Last-Event-ID`。 */
  lastId: number | null;
  /** 当前这段发言的 id（同一段发言的多个 delta 共享它）。 */
  speechId: number | null;
  /** 是否已提示「模型不稳定」。 */
  warned: boolean;
  /** `phase` 变成 `speaking` 之前是否经历过 `thinking`。 */
  sawThinking: boolean;
}

export const initialStreamState: StreamState = {
  phase: 'idle',
  seat: null,
  text: '',
  firstDeltaAt: null,
  lastId: null,
  speechId: null,
  warned: false,
  sawThinking: false,
};

export function streamReducer(state: StreamState, message: StreamMessage, now = 0): StreamState {
  // 乱序 / 重放：`id` 变小就丢掉。**同一条发言的增量共享同一个 `id`**（它是那条事件的
  // `seq`），所以只有终结类消息才按 `<=` 判重——否则第二个 delta 会被自己挡掉。
  if (state.lastId !== null && message.id < state.lastId) return state;
  if (state.phase === 'done' && message.type === 'done') return state;

  // 新一段发言：`text` / `firstDeltaAt` 必须重置，否则第二段会把第一段的正文接上去，
  // per-speech 的首字延迟也会一直停在上一段（C-89）。
  const startsNewSpeech = message.type === 'thinking';
  const base = startsNewSpeech
    ? { ...state, text: '', firstDeltaAt: null, sawThinking: false }
    : state;

  switch (message.type) {
    case 'thinking':
      return {
        ...base,
        phase: 'thinking',
        seat: message.seat,
        lastId: message.id,
        speechId: message.id,
        sawThinking: true,
      };
    case 'delta': {
      // 没有 thinking 的流（例如缓存命中）：第一条 delta 也算新一段发言。
      const sameSpeech = state.speechId === message.id;
      return {
        ...state,
        phase: 'speaking',
        seat: message.seat,
        text: (sameSpeech ? state.text : '') + message.text,
        firstDeltaAt: sameSpeech ? (state.firstDeltaAt ?? now) : now,
        lastId: message.id,
        speechId: message.id,
      };
    }
    case 'done':
      return {
        ...state,
        phase: 'done',
        seat: message.seat,
        text: state.speechId === message.id ? message.text : message.text,
        lastId: message.id,
        speechId: message.id,
      };
    case 'degraded':
      return {
        ...state,
        phase: 'degraded',
        seat: message.seat,
        text: '',
        firstDeltaAt: null,
        lastId: message.id,
        speechId: message.id,
      };
    case 'error':
      return { ...state, phase: 'error', lastId: message.id };
  }
}

/** 连续降级的提示：第 3 次之后置位，只提示一次（AC-12 的 UI 侧）。 */
export function markUnstable(state: StreamState, consecutive: number): StreamState {
  if (consecutive < 3 || state.warned) return state;
  return { ...state, warned: true };
}

/** 重连时要带的 `Last-Event-ID`。 */
export function lastEventId(state: StreamState): number | null {
  return state.lastId;
}
