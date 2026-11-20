import type { GameState } from '@shared/domain';
import type { EventEnvelope } from '@shared/events';
import { ROLE_LABELS } from '@shared/terms';
import type { TruthView } from '@shared/truth';

/**
 * 真相视图的数据（RFC-013 §2.3 / SEC-6）。
 *
 * **只对已出局的玩家开放**：活着的玩家请求必须被拒绝。前端不负责隐藏，服务端负责拒绝。
 *
 * 数据来自事件流（动作、死因）与状态（角色、存活）。它不写任何东西、也不缓存。
 */

export function canSeeTruth(state: GameState, playerSeat: number): boolean {
  const player = state.seats.find((seat) => seat.seat === playerSeat);
  if (player === undefined || player.alive) return false;

  // 出局不等于「没事可做」：如果是他还要决定开枪，此时让他看真相就能直接按身份
  // 挑人——那等于允许作弊。等这个决定交出去之后才开放（用户实测发现的漏洞）。
  if (state.phase === 'NIGHT_HUNTER_SHOOT' || state.phase === 'DAY_HUNTER_SHOOT') {
    const hunter = state.seats.find((seat) => seat.role === 'hunter')?.seat;
    if (hunter === playerSeat) return false;
  }

  return true;
}

/**
 * 把动作事件归到「谁做的」。
 *
 * 这些事件的 payload **不带 `seat`**（它们的受众由 `visibleTo` 表达）：
 * - 狼刀：所有狼共同决定 → 记在每个狼头上；
 * - 查验：只有 seer 可见；
 * - 用药：只有 witch 可见；
 * - 开枪：`HUNTER_SHOOT` 自带 `seat`。
 */
function actionsBySeat(state: GameState, events: readonly EventEnvelope[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const push = (seat: number, text: string): void => {
    const list = result.get(seat) ?? [];
    list.push(text);
    result.set(seat, list);
  };

  const wolves = state.seats.filter((seat) => seat.role === 'wolf').map((seat) => seat.seat);

  // 每个席位「出局事件」的 seq：之后再发生的动作与他无关（C-154）。
  const deathSeq = new Map<number, number>();
  for (const event of events) {
    if (event.type !== 'PLAYER_DIED') continue;
    const seat = (event.payload as { seat: number }).seat;
    if (!deathSeq.has(seat)) deathSeq.set(seat, event.seq);
  }
  const aliveAt = (seat: number, seq: number): boolean => {
    const died = deathSeq.get(seat);
    return died === undefined || seq < died;
  };
  const seer = state.seats.find((seat) => seat.role === 'seer')?.seat;
  const witch = state.seats.find((seat) => seat.role === 'witch')?.seat;

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    if (event.type === 'WOLF_KILL_CHOSEN') {
      for (const wolf of wolves) {
        if (aliveAt(wolf, event.seq)) push(wolf, `袭击了 ${String(payload['target'])} 号`);
      }
    }
    if (event.type === 'SEER_CHECKED' && seer !== undefined && aliveAt(seer, event.seq)) {
      const resultLabel = payload['result'] === 'wolf' ? ROLE_LABELS.wolf : '好人';
      push(seer, `查验了 ${String(payload['target'])} 号：${resultLabel}`);
    }
    if (event.type === 'WITCH_POTION_USED' && witch !== undefined && aliveAt(witch, event.seq)) {
      const potion = payload['potion'] === 'heal' ? '解药' : '毒药';
      push(witch, `使用${potion}（目标 ${String(payload['target'])} 号）`);
    }
    if (event.type === 'HUNTER_SHOOT' && typeof payload['seat'] === 'number') {
      push(
        payload['seat'] as number,
        payload['target'] === null ? '没有开枪' : `开枪带走 ${String(payload['target'])} 号`,
      );
    }
  }

  return result;
}

export function buildTruth(state: GameState, events: readonly EventEnvelope[]): TruthView {
  // 死亡发生在哪一天。
  //
  // **夜 N 属于第 N 天**：第一夜在第一个 `DAY_STARTED` 之前，所以不能只看
  // 「此前最后一个 DAY_STARTED」——那会把第一夜算成第 0 天（C-155）。
  let dayCount = 0;
  let inNight = false;
  const deaths: { seat: number; day: number; cause: string }[] = [];

  for (const event of events) {
    if (event.type === 'DAY_STARTED') {
      dayCount = (event.payload as { day: number }).day;
      inNight = false;
      continue;
    }
    if (event.type === 'PHASE_CHANGED') {
      const to = (event.payload as { to: string }).to;
      if (to.startsWith('NIGHT')) inNight = true;
      continue;
    }
    if (event.type !== 'PLAYER_DIED') continue;

    const payload = event.payload as { seat: number; cause: string };
    const day = inNight ? Math.max(dayCount, 0) + 1 : dayCount;
    deaths.push({ seat: payload.seat, day, cause: payload.cause });
  }

  const actions = actionsBySeat(state, events);

  return {
    seats: state.seats.map((seat) => ({
      seat: seat.seat,
      role: seat.role,
      roleLabel: ROLE_LABELS[seat.role] ?? seat.role,
      alive: seat.alive,
      actions: actions.get(seat.seat) ?? [],
    })),
    deaths,
  };
}
