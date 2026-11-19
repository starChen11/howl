import type { ProjectedContext } from '@shared/project';

/**
 * 从投影推导界面要显示的东西（RFC-012 §2.3）。
 *
 * **不另外算一份状态**：当前发言者、已发言、已出局全部来自投影与公开事件，
 * 前端只是把它们排成可读的形状。
 */

export interface SeatView {
  seat: number;
  alive: boolean;
  isSelf: boolean;
  hasSpoken: boolean;
  speaking: boolean;
}

export interface BoardView {
  seats: SeatView[];
  speakingSeat: number | null;
  aliveCount: number;
  day: number;
  phase: string;
}

/** 公开事件里「谁说过话」。 */
export function spokenSeats(ctx: ProjectedContext): number[] {
  // **只算最近一天**：跨天累加会让第二天开局时所有人都显示「已发言」（C-121）。
  const events = ctx.publicEvents;
  let lastDayStart = -1;
  events.forEach((event, index) => {
    if (event.type === 'DAY_STARTED') lastDayStart = index;
  });

  return events
    .slice(lastDayStart + 1)
    .filter((event) => event.type === 'SPEECH' || event.type === 'SPEECH_SKIPPED')
    .map((event) => (event.payload as { seat?: number }).seat)
    .filter((seat): seat is number => typeof seat === 'number');
}

/**
 * 当前发言者：活着且还没说过话的第一个席位。
 *
 * 与引擎的发言顺序一致（引擎按存活顺序推进），所以刷新后不会错位。
 */
export function speakingSeat(ctx: ProjectedContext): number | null {
  if (ctx.phase !== 'DAY_SPEECH') return null;

  const spoken = new Set(spokenSeats(ctx));
  // 发言从当天公告的 `speechStartSeat` 开始绕圈——不从那里起算，界面会和引擎错位。
  const started = [...ctx.publicEvents].reverse().find((event) => event.type === 'DAY_STARTED');
  const startSeat =
    started === undefined
      ? ctx.aliveSeats[0]
      : (started.payload as { speechStartSeat?: number }).speechStartSeat;

  const alive = ctx.aliveSeats;
  const index = startSeat === undefined ? 0 : alive.indexOf(startSeat as never);
  const ordered = [...alive.slice(Math.max(0, index)), ...alive.slice(0, Math.max(0, index))];

  return ordered.find((seat) => !spoken.has(seat)) ?? null;
}

export function buildBoard(ctx: ProjectedContext): BoardView {
  const spoken = new Set(spokenSeats(ctx));
  const speaking = speakingSeat(ctx);

  return {
    seats: ctx.aliveSeats
      .concat(ctx.deadSeats)
      .sort((a, b) => a - b)
      .map((seat) => ({
        seat,
        alive: ctx.aliveSeats.includes(seat),
        isSelf: seat === ctx.self.seat,
        hasSpoken: spoken.has(seat),
        speaking: seat === speaking,
      })),
    speakingSeat: speaking,
    aliveCount: ctx.aliveSeats.length,
    day: ctx.day,
    phase: ctx.phase,
  };
}

/** 倒计时文案（AC-14：文字表达，不只靠颜色）。 */
export function countdownText(remaining: number): string {
  if (remaining <= 0) return '时间到';
  if (remaining <= 10) return `最后 ${remaining} 秒`;
  return `还剩 ${remaining} 秒`;
}

/** 屏幕阅读器用的整局描述（AC-15）。 */
/** 阶段的中文名（RUNOFF 之类不能把原始枚举念给用户听）。 */
export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'DAY_SPEECH':
      return '轮流发言';
    case 'DAY_VOTE':
      return '投票';
    case 'DAY_VOTE_RUNOFF':
      return '平票重投';
    case 'DAY_ANNOUNCE':
      return '公布昨夜结果';
    case 'NIGHT':
      return '夜晚';
    default:
      return phase;
  }
}

/** 屏幕阅读器的整局描述（不含倒计时，避免每秒播报）。 */
export function boardAnnouncement(ctx: ProjectedContext): string {
  const speaking = speakingSeat(ctx);
  return `你是 ${ctx.self.seat} 号，第 ${ctx.day} 天，${phaseLabel(ctx.phase)}${
    speaking === null ? '' : `，轮到 ${speaking} 号发言`
  }。`;
}
