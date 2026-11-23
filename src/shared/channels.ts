import type { SeatId } from './domain';

/**
 * 通道抽象（RFC-011 §2.3）。
 *
 * 它存在的唯一理由：**引擎不知道通道的存在**（ARCH-1）。引擎只接收 action、产出事件；
 * 至于这句话是玩家敲的、AI 生成的，还是将来语音识别出来的，与引擎无关。
 *
 * 通道住在**服务端**（ARCH-9）：浏览器只渲染投影、把输入 POST 上来，不推进状态机。
 */

/** 玩家这一轮说了什么。 */
export type PlayerInput =
  { kind: 'speak'; text: string } | { kind: 'skip' } | { kind: 'timeout'; text: string };

/** 等待输入时给通道的提示（供 UI 展示）。 */
export interface InputPrompt {
  seat: SeatId;
  /** 已过去的秒数 / 总秒数，由服务端计时。 */
  timeoutMs: number;
  kind: 'speech' | 'vote' | 'action';
}

export interface InputChannel {
  /** 等待一次玩家输入；超时返回 `{ kind: 'timeout', text }`。 */
  read(prompt: InputPrompt): Promise<PlayerInput>;
  close(): void;
}

/** AI 发言的增量。 */
export interface SpeechChunk {
  seat: SeatId;
  /** 对应事件流的 `seq`（RFC-010 的 API-2）。 */
  id: number;
  text: string;
  final: boolean;
}

export interface OutputChannel {
  /** 开始思考（模型调用还没返回）。 */
  thinking?(seat: SeatId, id: number): void;
  /** 以增量方式输出一段 AI 发言。 */
  emit(chunk: SpeechChunk): void;
  flush(): Promise<void>;
}
