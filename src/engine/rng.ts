import type { RngState } from '@shared/domain';

/**
 * 可注入的伪随机源。
 *
 * 算法是 **mulberry32**：32 位状态、无依赖、状态就是一个整数，因此
 * `RngState` 能随 `GameState` 一起 JSON 往返（NFR-18 / F38）。
 *
 * 两条纪律：
 * - 引擎里不得出现全局随机数调用（`DATA-5`，由 `tests/engine/rng.test.ts` 扫描断言——
 *   扫描是文本级的，所以本文件连「那个名字加括号」的写法都不能出现）；
 * - **每次抽取都必须推进** `rng`，抽取结果写进产生它的事件 payload，这样 `replay` 不必重新抽。
 */

/** 把种子变成初始生成器状态。种子只在这一处进入引擎。 */
export function initialStateFromSeed(seed: number): RngState {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`种子必须是整数，收到 ${String(seed)}`);
  }
  // 截断到 32 位无符号：负种子也接受，同样的输入得到同样的状态。
  return { __rng: seed >>> 0 };
}

/**
 * 抽一个 `[0, 1)` 的浮点数，并返回推进后的状态。
 *
 * 与参考实现 mulberry32 位级一致；签名为「状态进、状态出」而不是闭包，是为了让状态
 * 可序列化、可回放。
 */
export function nextRandom(rng: RngState): { rng: RngState; value: number } {
  const advanced = (rng.__rng + 0x6d2b79f5) | 0;
  let t = Math.imul(advanced ^ (advanced >>> 15), 1 | advanced);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

  return { rng: { __rng: advanced >>> 0 }, value };
}

/**
 * 抽一个 `[0, maxExclusive)` 的整数。
 *
 * 用 `floor(value * max)`：在 9 个座位的量级上，模偏差远小于可观察范围，且实现简单、
 * 结果可复现。若将来需要严格无偏，换法是拒绝采样——那时必须重跑所有确定性测试，
 * 因为事件流会变。
 */
export function nextInt(rng: RngState, maxExclusive: number): { rng: RngState; value: number } {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`上界必须是正整数，收到 ${String(maxExclusive)}`);
  }

  const drawn = nextRandom(rng);
  return { rng: drawn.rng, value: Math.floor(drawn.value * maxExclusive) };
}

/**
 * Fisher–Yates 洗牌，返回新数组（不改入参）与推进后的状态。
 *
 * 发牌用它（RFC-003 §2.1 指定了这个算法）。同一 seed 必然得到同一排列。
 */
export function shuffle<T>(rng: RngState, items: readonly T[]): { rng: RngState; items: T[] } {
  const result = [...items];
  let current = rng;

  for (let i = result.length - 1; i > 0; i -= 1) {
    const drawn = nextInt(current, i + 1);
    current = drawn.rng;

    const swapIndex = drawn.value;
    const a = result[i];
    const b = result[swapIndex];
    if (a === undefined || b === undefined) {
      // 索引由 nextInt 的上界保证在范围内；越界只可能是上界算错。
      throw new RangeError(`洗牌索引越界：${String(swapIndex)} / ${String(i)}`);
    }
    result[i] = b;
    result[swapIndex] = a;
  }

  return { rng: current, items: result };
}
