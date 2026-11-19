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
  return player !== undefined && !player.alive;
}

/** 把某个席位的动作记成一句话。 */
function actionsOf(events: readonly EventEnvelope[], seat: number): string[] {
  const actions: string[] = [];

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const actor = payload['seat'];

    if (event.type === 'WOLF_KILL_CHOSEN' && actor === seat) {
      actions.push(`袭击了 ${String(payload['target'])} 号`);
    }
    if (event.type === 'SEER_CHECKED' && actor === seat) {
      const result = payload['result'] === 'wolf' ? ROLE_LABELS.wolf : '好人';
      actions.push(`查验了 ${String(payload['target'])} 号：${result}`);
    }
    if (event.type === 'WITCH_POTION_USED' && actor === seat) {
      const potion = payload['potion'] === 'heal' ? '解药' : '毒药';
      actions.push(
        `使用了${potion}${payload['target'] === undefined ? '' : ` 对 ${String(payload['target'])} 号`}`,
      );
    }
    if (event.type === 'HUNTER_SHOOT' && actor === seat) {
      actions.push(`开枪带走了 ${String(payload['target'])} 号`);
    }
  }

  return actions;
}

export function buildTruth(state: GameState, events: readonly EventEnvelope[]): TruthView {
  const deaths = events
    .filter((event) => event.type === 'PLAYER_DIED')
    .map((event) => {
      const payload = event.payload as { seat: number; cause: string };
      return { seat: payload.seat, day: state.day, cause: payload.cause };
    });

  return {
    seats: state.seats.map((seat) => ({
      seat: seat.seat,
      role: seat.role,
      roleLabel: ROLE_LABELS[seat.role] ?? seat.role,
      alive: seat.alive,
      actions: actionsOf(events, seat.seat),
    })),
    deaths,
  };
}
