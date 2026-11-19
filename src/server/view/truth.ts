import type { GameState } from '@shared/domain';
import { ROLE_LABELS } from '@shared/terms';

/**
 * 真相视图的数据（RFC-013 §2.3 / SEC-6）。
 *
 * **只对已出局的玩家开放**：活着的玩家请求真相数据必须被拒绝——否则「AI 不作弊」
 * 这条卖点就没了。前端不负责隐藏，服务端负责拒绝。
 */

export interface TruthSeat {
  seat: number;
  role: string;
  roleLabel: string;
  alive: boolean;
  /** 该席位这一局的夜间/白天动作摘要（只写公开可核对的类型）。 */
  actions: string[];
}

export interface TruthView {
  seats: TruthSeat[];
  /** 已出局的席位：谁在哪一夜死的、死因。 */
  deaths: { seat: number; day: number; cause: string }[];
}

/** 活着的玩家没有真相可看。 */
export function canSeeTruth(state: GameState, playerSeat: number): boolean {
  const player = state.seats.find((seat) => seat.seat === playerSeat);
  return player !== undefined && !player.alive;
}

export function buildTruth(state: GameState): TruthView {
  // `pendingDeaths` 只是「还没公布的死者席位」；死因在 PLAYER_DIED 事件里。
  const deaths = (state.pendingDeaths ?? []).map((seat) => ({
    seat,
    day: state.day,
    cause: 'unknown',
  }));

  return {
    seats: state.seats.map((seat) => ({
      seat: seat.seat,
      role: seat.role,
      roleLabel: ROLE_LABELS[seat.role] ?? seat.role,
      alive: seat.alive,
      actions: [],
    })),
    deaths,
  };
}
