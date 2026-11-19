import type { Claim } from './events';

/**
 * 复盘快照的共享契约（RFC-014 §2.1）。
 *
 * 服务端生成、客户端渲染；同一个类型，避免两边字段错位。
 */

export interface TimelineEntry {
  seq: number;
  day: number;
  phase: string;
  text: string;
}

export interface ReplaySeat {
  seat: number;
  role: string;
  roleLabel: string;
  personaId: string | null;
  personaLabel: string | null;
  alive: boolean;
}

export interface ThoughtEntry {
  seq: number;
  seat: number;
  kind: 'speech' | 'vote' | 'night-action';
  reason: string;
  claim?: Claim | undefined;
  chose: string;
}

export interface ReplaySnapshot {
  gameId: string;
  seed: number;
  finishedAt: number;
  result: 'wolf' | 'good';
  winCondition: string;
  timeline: TimelineEntry[];
  seats: ReplaySeat[];
  thoughts: ThoughtEntry[];
  degraded: number[];
  usage?: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
}
