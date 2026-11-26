/** 赛后拷问/甩锅（RFC-023）的跨层类型。 */

export type PostmortemRequest =
  | {
      kind: 'questions';
      seat: number;
      /** 本轮之前的问答摘要，供模型选择要拷问的人。 */
      history: { seat: number; target: number; question: string; answer: string }[];
    }
  | {
      kind: 'answer';
      seat: number;
      target: number;
      question: string;
      history: { seat: number; target: number; question: string; answer: string }[];
    }
  | {
      kind: 'vote';
      seat: number;
      history: { seat: number; target: number; question: string; answer: string }[];
      candidates: number[];
    }
  | { kind: 'speech'; seat: number; reason: string };

export type PostmortemResponse =
  | { kind: 'questions'; questions: { target: number; question: string }[] }
  | { kind: 'answer'; text: string }
  | { kind: 'vote'; target: number }
  | { kind: 'speech'; text: string };
