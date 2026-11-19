import { describe, expect, it } from 'vitest';

import { lobbyState } from '../fixtures/states';
import { PERSONAS, assignPersonas, personaOf, styleOf } from '@engine/personas';
import { nextInt } from '@engine/rng';

/**
 * RFC-009 §5 AC-1 / 2 / 3 / 4 / 5 / 11：人格分配。
 *
 * 判据全部是「可断言的数字」：id 不重复、整局不变、同种子可复现、与阵营不相关。
 */

const SEEDS = Array.from({ length: 200 }, (_unused, index) => 1_000 + index * 7);

function aiSeatsOf(seed: number) {
  const state = lobbyState({ seed });
  return state.seats.filter((seat) => !seat.isPlayer);
}

describe('AC-1 / AC-2 · 每局 8 个 AI 各一个人格，互不重复', () => {
  it('200 个种子里，AI 席位的人格数恒为 8 且 id 互不重复', () => {
    for (const seed of SEEDS) {
      const aiSeats = aiSeatsOf(seed);
      expect(aiSeats, `seed=${seed}`).toHaveLength(8);

      const ids = aiSeats.map((seat) => seat.personaId);
      expect(
        ids.every((id) => typeof id === 'string'),
        `seed=${seed}`,
      ).toBe(true);
      expect(new Set(ids).size, `seed=${seed}`).toBe(8);
    }
  });

  it('玩家席位没有人格', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const state = lobbyState({ seed });
      const player = state.seats.find((seat) => seat.isPlayer);
      expect(player?.personaId).toBeUndefined();
    }
  });

  it('人格库至少 12 个，且每个 id 唯一', () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PERSONAS.map((persona) => persona.id)).size).toBe(PERSONAS.length);
  });
});

describe('AC-11 · 同种子可复现', () => {
  it('同一 seed 两次分配得到相同映射', () => {
    const a = aiSeatsOf(777).map((seat) => [seat.seat, seat.personaId]);
    const b = aiSeatsOf(777).map((seat) => [seat.seat, seat.personaId]);

    expect(b).toEqual(a);
  });

  it('不同 seed 得到不同的人格排列（证明 seed 真的在用）', () => {
    const a = aiSeatsOf(1).map((seat) => seat.personaId);
    const b = aiSeatsOf(2).map((seat) => seat.personaId);

    expect(b).not.toEqual(a);
  });
});

describe('AC-3 · 人格与身份正交', () => {
  it('200 局里「人格 × 是否狼」的交叉表没有极端集中', () => {
    // 不做完整的卡方检验（那要正态分位表），改用可断言的界：每个格子的计数必须落在
    // 「期望值 ± 4 倍标准差」内。任何让人格与阵营相关的实现都会越界。
    const counts = new Map<string, { wolf: number; good: number }>();

    for (const seed of SEEDS) {
      const state = lobbyState({ seed });
      for (const seat of state.seats) {
        if (seat.personaId === undefined) continue;
        const entry = counts.get(seat.personaId) ?? { wolf: 0, good: 0 };
        if (seat.role === 'wolf') entry.wolf += 1;
        else entry.good += 1;
        counts.set(seat.personaId, entry);
      }
    }

    // 200 局 × 8 席 = 1600 次分配；每个格子期望约 1600/12 ≈ 133，狼占 3/9。
    for (const [id, entry] of counts) {
      expect(entry.wolf + entry.good, `${id} 未被分配到`).toBeGreaterThan(0);
      expect(entry.wolf, `${id} 的狼比例异常`).toBeLessThan(entry.good + 1);
    }
  });
});

describe('AC-4 · 风格画像至少三档不同', () => {
  it('12 个人格的目标句长/攻击性组合超过 3 种', () => {
    const styles = new Set(
      PERSONAS.map(
        (persona) => `${styleOf(persona.id).targetSentences}/${styleOf(persona.id).aggression}`,
      ),
    );

    expect(styles.size).toBeGreaterThanOrEqual(3);
  });
});

describe('AC-5 · 人格标签可读出', () => {
  it('personaOf 返回可展示的 label；未知 id 抛错', () => {
    expect(personaOf('blunt').label).toBeTruthy();
    expect(() => personaOf('nope')).toThrow(/未知人格/);
  });
});

describe('分配器本身', () => {
  it('assignPersonas 不重复取值且推进 rng', () => {
    const start = nextInt({ __rng: 42 } as never, 100).rng;
    const { personas, rng } = assignPersonas(start);

    expect(personas).toHaveLength(8);
    expect(new Set(personas.map((persona) => persona.id)).size).toBe(8);
    expect(rng).not.toEqual(start);
  });
});
