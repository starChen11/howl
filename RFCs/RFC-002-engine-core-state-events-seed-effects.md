# RFC-002 · 引擎内核：状态机、事件流、种子与效果管道

**Features**: F2, F7, F44, F38
**Depends on**: RFC-001
**Rules**: ARCH-3, ARCH-4, ARCH-5, ARCH-6, ARCH-11, DATA-1, DATA-2, DATA-3, DATA-4, DATA-5, TEST-2, TEST-3, TEST-4
**Complexity**: High
> 关联需求：NFR-2、NFR-5、NFR-18

---

## 1. 摘要

交付引擎的**内核**：把 `(state, action)` 变成 `(state', events)` 的纯函数、可折叠回状态的事件流、可注入的随机源、以及把结算表达为效果列表的管道。

具体角色与阶段在 RFC-003 / RFC-004 落地；本 RFC 只提供它们必须遵守的骨架。共享类型全部来自 RFC-001 的 `src/shared/`，本 RFC **不重复定义**。

## 2. 技术方案

### 2.1 三个纯函数

```ts
/** 折叠单个事件；replay 的基元 */
function applyEvent(state: GameState, event: EventEnvelope): GameState;

/** 处理一个 action，返回新状态与新事件 */
function step(state: GameState, action: Action): { state: GameState; events: EventEnvelope[] };

/** 兼容 RULES ARCH-4 的字面签名：只返回状态 */
function reduce(state: GameState, action: Action): GameState;

/** 从事件流重建状态 */
function replay(events: EventEnvelope[]): GameState;
```

`reduce(s, a) === step(s, a).state`，测试必须断言这一点。`ARCH-4` 写的是 `reduce(state, action) => state`，本 RFC 用 `step` 承担事件产出、用 `reduce` 保持该签名成立——**这不是偏离，是让两个要求同时为真**。

### 2.2 事件溯源

`replay` **不重新调用 LLM，也不重新生成随机数**。两条规则保证这一点：

1. 所有随机**结果**（发牌、发言起点）作为事件，记录在产生它的事件 payload 里。
2. 任何消耗随机数的事件**必须**在信封上带 `rngAfter`（RFC-001 §2.3）；`applyEvent` 直接把它写回 `state.rng`，从而让重放后的生成器状态与原始一致。

若某事件消耗了随机数却没有 `rngAfter`，`applyEvent` 抛 `MissingRngStateError`。

事件流的第一个事件必须是 `GAME_STARTED`，`visibleTo: 'server'`（payload 含全员身份，任何席位都不可见），其 payload 携带重建初始状态所需的全部输入：

```ts
type GameStartedPayload = {
  seed: number;
  mode: WinMode;
  playerSeat: SeatId;
  roles: Role[];        // 按座位 1..9 排列：唯一权威的发牌结果
  personas: (string | null)[];  // 每席人格 id（AI 席非空）；v1 由 RFC-009 填充
};
```

**权威性**：`createInitialState` 用 seed 发牌只是「产生候选」，一旦 `GAME_STARTED` 事件存在，**事件里的 `roles` 是唯一权威**；`applyEvent` 以它为准，不再自行发牌。这样即便发牌算法将来改动，旧对局仍可重放。

因此 `replay(events)` **只接收事件流**，不需要外部初始状态。`createInitialState` 只用于「开局前构造状态」这一件事：

```ts
function createInitialState(input: {
  gameId: string; seed: number; mode: WinMode; playerSeat: SeatId;
}): GameState;   // 用 seed 发牌，phase='LOBBY'，seq=0
```

### 2.3 拒绝与抛错的分工

这是最容易含糊的一段，本 RFC 定死：

| 情形 | 判据 | 结果 |
|---|---|---|
| phase 不匹配 | `action.type` 不在 `transitions[state.phase]` 允许集合内 | `Rejected` 事件，`code: 'PHASE_MISMATCH'` |
| 规则拒绝 | phase 匹配，但违反 **RULES.md §6 的 RUL 或已实现 FR 中的明确规则**（如 FR-17 的「女巫不可自救」） | `Rejected` 事件，`code` 为具体原因 |
| 未实现 | `action.type` **在**允许集合内，但该 phase 没有对应 handler | 抛 `UnhandledTransitionError` |

**判据是机械的**：看 `transitions` 表 + 看有没有 handler，不靠主观判断「这条规则算不算已裁决」。

第三种是**实现缺陷或未裁决规则**，必须炸出来（ARCH-11）。第二、三种的边界由一张「每个 phase 允许哪些 action」的表显式声明，并有测试断言允许集合里的每一对都有处理实现。

`Rejected` 事件：

```ts
type RejectedPayload = {
  actionType: Action['type'];
  code: string;          // 'PHASE_MISMATCH' | 'WITCH_SELF_SAVE' | ...
  message: string;       // 面向开发者的中文描述，不面向玩家
};
```

`Rejected` **消耗 `seq`**、进入事件流（复盘要能看到「有人提交了非法动作」），可见性为 `self:<提交者席位>`；无法确定席位（如 `START`）时用 `'public'`。被拒绝时**状态除 `seq` 外不变**。

### 2.4 效果管道

每个结算点**先产出效果列表，再统一应用**（ARCH-5）：

- 应用顺序：`order` 升序，同级按 `id` 字典序（RFC-001 §2.3 定义了 `order` 的分区）。
- 扩展插入点：`applyModifiers(point, state, effects, modifiers) => Effect[]`，`step(state, action, modifiers?)` 是它的入口。`modifiers` 是本次结算传入的扩展来源函数集合；v1 不注册任何 modifier。
- **modifier 必须是状态决定的纯函数**：注册表随 run 配置写入 `GAME_STARTED`。这样 `replay` 能重建同一组 modifier，否则「有 modifier 时事件流可重放」不成立。
- **效果不写入事件流**：它是结算中间产物，其结果以事件记录。

```ts
type Modifier = (point: ResolutionPoint, state: GameState, effects: Effect[]) => Effect[];
type ResolutionPoint = 'NIGHT_RESOLVE' | 'VOTE_RESOLVE' | 'DEATH_RESOLVE' | 'WIN_CHECK';

function applyEffects(state: GameState, effects: Effect[]): GameState;
```

### 2.5 随机

- 算法：`mulberry32`（或等价的、状态可序列化为一个 32 位整数的生成器）。
- 引擎内部用 `nextInt(state, max) => { state: GameState; value: number }`，**不暴露裸 `Math.random()`**。
- 每次抽取都推进 `state.rng`；抽取结果必须出现在产生它的事件 payload 里，这样 `applyEvent` 无需 rng。

### 2.6 不可变与可序列化

- 状态更新用浅拷贝 + 替换，不引入 Immer 等库（ARCH-2 只约束 shared，但引擎也不该有运行时依赖）。
- `GameState` 必须能 `JSON.stringify → parse` 往返且深度相等；不得含 `Date` / `Map` / `Set` / 函数 / 类实例。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/init.ts` | `createInitialState`、按 seed 发牌 |
| `src/engine/step.ts` | `step` / `reduce` |
| `src/engine/apply.ts` | `applyEvent` |
| `src/engine/replay.ts` | `replay(events)` |
| `src/engine/effects.ts` | `applyEffects`、`applyModifiers`、`Modifier` |
| `src/engine/rng.ts` | PRNG 与 `nextInt` |
| `src/engine/transitions.ts` | 每个 phase 的允许 action 集合 |
| `src/engine/errors.ts` | `UnhandledTransitionError` |
| `tests/engine/replay.test.ts` | 事件溯源与确定性 |
| `tests/engine/effects.test.ts` | 效果顺序与插入点 |
| `tests/engine/determinism.test.ts` | 种子与随机 |

## 4. 实现要点

- `transitions.ts` 是**唯一**决定「某 phase 允许哪些 action」的地方；`step` 只查表，不在各 handler 里散落判断。
- `applyEvent` 必须对未知事件类型抛错——静默忽略会让 `replay` 悄悄丢状态。
- 覆盖率门禁只针对 `src/engine/`（TEST-2），在 Vitest 配置里用 `coverage.include` 限定。
- 引擎测试运行前把全局 `fetch` 换成抛错桩，断言零调用（TEST-4）。

## 5. 验收标准

1. `reduce(s, a)` 与 `step(s, a).state` 深度相等：对一组覆盖各 action 类型的样本逐一断言
2. `step` 是纯函数：同一 `(state, action)` 两次调用返回深度相等的结果；`Object.freeze` 冻结 `state` 后调用不抛错
3. `GameState` 经 `JSON.stringify → parse` 往返后深度相等；用递归断言证明其中每个值要么是原始值、要么是 `Array` / 纯对象（原型链为 `Object.prototype`）
4. `replay(events)` 只接收事件流即可重建状态：以 `GAME_STARTED` 开头的事件流重放结果与产生它的最终状态深度相等
5. 同一 `seed` + 同一 action 序列（含相同 `ts`）两次运行，产出的事件流逐条深度相等
6. 事件 `seq` 从 1 开始严格递增、无跳号、无重复；`type` 的运行时取值落在事件类型联合内
7. 首个事件必为 `GAME_STARTED`，且其 payload 含 `seed` / `mode` / `playerSeat` / `roles` 四个字段
8. 提交一个与当前 phase 不匹配的 action 时，产出 `Rejected` 事件（`code === 'PHASE_MISMATCH'`），且除 `seq` 外状态不变
9. 存在测试：遍历 `transitions.ts` 声明的每个 `(phase, action)` 允许对，断言都有处理实现；遇到未实现的允许对时抛 `UnhandledTransitionError`
10. 效果应用顺序为 `order` 升序、同级按 `id` 字典序；同一组效果两次应用结果深度相等
11. 存在测试：注册一个假 modifier 到 `VOTE_RESOLVE`，断言它注入的效果改变了最终状态（证明插入点可用）
12. 不注册任何 modifier 时，`applyModifiers` 返回与输入深度相等（仅顺序规范化）的效果列表
13. 扫描 `src/engine/` 全部 `.ts`，断言不出现 `Math.random(`
14. `src/engine/` 行覆盖率 ≥ 90%、分支覆盖率 ≥ 85%
15. 引擎测试期间零网络调用：`fetch` 被替换为抛错桩后全部引擎测试通过

## 6. 边界与测试

- **不做**：角色、昼夜阶段分支、胜负判定——RFC-003 / RFC-004。本 RFC 的 `transitions.ts` 只覆盖 `LOBBY` 与 `FINISHED` 两个 phase；其余阶段由后续 RFC 追加到同一张表，测试自动覆盖。
- **验收边界**：本 RFC 只验 `START`（`LOBBY`）与 `FINISHED` 后的拒绝路径，其余 action 类型的端到端行为属 RFC-003/004。F2 的终局、F38 的可复现 run、F44 的完整重放分别在 RFC-004 / RFC-015 / RFC-014 收口——本 RFC 只提供机制。
- **不做**：`isVisibleTo` 的行为验收（RFC-005）、`project`（RFC-007）。
- **实现者选择**：PRNG 具体算法、`Effect.id` 的字符串格式、`applyEffects` 内部写法、测试文件组织。
- **`TEST-2` 的覆盖率工具**：使用 RULES §2 登记的 `@vitest/coverage-v8`，配置写在 `vitest.config.ts`。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-002-1 | 事件时间戳来源 | **(assumption)** 由 `action.ts` 传入；`applyEvent` 只用事件自带的 `ts` |
| Q-002-2 | modifier 的注册粒度 | **(assumption)** 每次结算传入，便于测试与将来按 run 配置 |
| Q-002-3 | `Rejected` 事件是否计入复盘时间线 | **(assumption)** 计入；它是「有人试图做非法动作」的客观事实 |
| Q-002-4 | 本 RFC 是否需要 `WIN_CHECK` 结算点 | **(assumption)** 需要占位，具体判定在 RFC-004 填充 |
