import { describe, expect, it } from 'vitest';

import type { Action } from '@shared/actions';

import { step } from '@engine/step';

import { lobbyState, playerSeatOf, startedState, startActionOf } from '../fixtures/states';

/**
 * AC-8：与当前 phase 不匹配的 action 产出 `Rejected` 事件，状态除 `seq` 外不变。
 *
 * RFC-002 的阶段表只填了 `LOBBY` 与 `FINISHED`（§6 的边界），所以开局之后**任何** action
 * 都走拒绝路径——这正好让这条 AC 有一条稳定的验证通道。
 */

function rejectionOf(state: Parameters<typeof step>[0], action: Action) {
  const result = step(state, action);
  const [event] = result.events;

  if (event?.type !== 'REJECTED') {
    throw new Error(`期望 REJECTED，收到 ${String(event?.type)}`);
  }

  return { event, result };
}

describe('AC-8 · 拒绝路径', () => {
  it('LOBBY 里提交非 START 的 action 被拒，code 为 PHASE_MISMATCH', () => {
    const lobby = lobbyState();
    const { event } = rejectionOf(lobby, { type: 'VOTE', ts: 1, seat: 2, target: 'abstain' });

    expect(event.payload.code).toBe('PHASE_MISMATCH');
    expect(event.payload.actionType).toBe('VOTE');
  });

  it('开局后（NIGHT_WOLF_CHAT）所有 action 都被拒——RFC-003 才会填这张表', () => {
    const state = startedState();
    const { event } = rejectionOf(state, { type: 'SPEECH', ts: 1, seat: 2, text: '嗨' });

    expect(event.payload.code).toBe('PHASE_MISMATCH');
  });

  it('重复提交 START 被拒（已经不在 LOBBY）', () => {
    const state = startedState();
    const { event } = rejectionOf(state, startActionOf(state, 2_000));

    expect(event.payload.code).toBe('PHASE_MISMATCH');
  });

  it('被拒时状态除 seq 外完全不变', () => {
    const state = startedState();
    const { result } = rejectionOf(state, { type: 'VOTE', ts: 9, seat: 2, target: 3 });

    expect(result.state.seq).toBe(state.seq + 1);
    expect({ ...result.state, seq: state.seq }).toEqual(state);
  });

  it('拒绝事件消耗 seq 并进入事件流（复盘要能看到「有人提交了非法动作」）', () => {
    const state = startedState();
    const { event } = rejectionOf(state, { type: 'WOLF_KILL', ts: 9, seat: 1, target: 2 });

    expect(event.seq).toBe(state.seq + 1);
    expect(event.gameId).toBe(state.gameId);
  });

  it('带席位的 action 被拒时可见性是 self:<seat>，不广播给全场', () => {
    const state = startedState();
    const { event } = rejectionOf(state, { type: 'SEER_CHECK', ts: 9, seat: 4, target: 5 });

    expect(event.visibleTo).toBe('self:4');
  });

  it('START 的 seed 与已发牌状态不一致时被拒（START_STATE_MISMATCH）', () => {
    const lobby = lobbyState({ seed: 1 });
    const mismatched: Action = {
      type: 'START',
      ts: 1,
      seed: 2,
      mode: lobby.mode,
      playerSeat: playerSeatOf(lobby),
    };

    const { event } = rejectionOf(lobby, mismatched);

    expect(event.payload.code).toBe('START_STATE_MISMATCH');
    // START 没有席位，只能广播
    expect(event.visibleTo).toBe('public');
  });

  it('START 的 playerSeat 与已发牌状态不一致时同样被拒', () => {
    const lobby = lobbyState();
    const otherSeat = lobby.seats.find((seat) => !seat.isPlayer)?.seat;
    if (otherSeat === undefined) throw new Error('夹具缺少非玩家席位');

    const mismatched: Action = {
      type: 'START',
      ts: 1,
      seed: lobby.seed,
      mode: lobby.mode,
      playerSeat: otherSeat,
    };

    const { event } = rejectionOf(lobby, mismatched);

    expect(event.payload.code).toBe('START_STATE_MISMATCH');
  });

  it('被拒后状态仍是 LOBBY，可以重新提交合法的 START', () => {
    const lobby = lobbyState();
    const rejected = step(lobby, { type: 'VOTE', ts: 1, seat: 2, target: 'abstain' });

    expect(rejected.state.phase).toBe('LOBBY');

    const accepted = step(rejected.state, startActionOf(rejected.state, 2_000));
    expect(accepted.events[0]?.type).toBe('GAME_STARTED');
    expect(accepted.state.seq).toBe(2);
  });
});
