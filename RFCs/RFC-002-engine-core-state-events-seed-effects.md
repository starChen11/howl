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

`applyEvent` 是**派生字段的唯一写入口**（RFC-001 §2.3 的 C-18 裁决）：`GameState` 里凡是由事件折叠出来的值（发言 cursor、票箱、药水位、夜聊提交集合），只能在 `applyEvent` 里写，且必须能从事件 payload 完整重算。`replay` 因此**必须重建全部派生字段**——它是这条纪律的验收手段，不是可选项。

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

> CR-003 C1：RFC-001 的 `GameEventMap.REJECTED` 最初把 `actionType` 写成 `string`，与本节不一致。裁决采纳本节的 `Action['type']`，两边现已一致。

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
// 结算点是「一次性结算动作」，不是 Phase：`VOTE_RESOLVE` 发生在 `DAY_VOTE` 阶段内部（C-19）。

function applyEffects(state: GameState, effects: Effect[]): GameState;
```

### 2.7 胜负谓词

胜负判定需要一个**纯谓词**，但它被两个 RFC 使用：夜间死亡结算（RFC-003）与白天放逐结算（RFC-004）都要在「死亡之后、技能之前」判一次（RUL-1）。

因此本 RFC 提供谓词，**不提供判定时机与流程**：

```ts
function checkWin(state: GameState): { result: 'wolf' | 'good'; condition: string } | null;
```

它只读 `state.seats` 与 `state.mode`，不推进状态、不产生事件。谁在什么时候调用它、判完之后怎么走，由 RFC-003 与 RFC-004 决定。

`condition` 是给复盘用的可读描述（如 `'all-seers-and-witches-and-hunters-dead'`）。

**注意**：这不是把 F6 拆到本 RFC。F6（胜负判定）仍归 RFC-004；本 RFC 只提供被两个 RFC 共用的纯函数。

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
| `src/engine/win.ts` | `checkWin(state): { result: 'wolf' \| 'good'; condition: string } \| null`（纯谓词，见 §2.7） |
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
15. `checkWin` 是纯谓词：只读 `state.seats` 与 `state.mode`，不产生事件、不推进状态；屠边与屠城两个模式下用构造局面各断言一次返回值与 `condition` 文案
16. 引擎测试期间零网络调用：`fetch` 被替换为抛错桩后全部引擎测试通过

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

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。评审在**新会话**里只凭仓库文件判断，所以这里写清：改了什么、为什么、用户是否批准。分支 `rfc/001-project-scaffold-and-shared-contracts`（RFC-001 的分支尚未合并，RFC-002 在其上继续）。

### 8.1 批准记录

实现前把计划逐条列出并经用户确认：

| 项 | 结论 |
|---|---|
| 整体计划（含 Q-002-1~4、A-4~A-8 的假设） | 批准 |
| `applyEvent` / `replay` 的参数类型 | 选**收紧为 `GameEvent`** |
| AC-14 覆盖率门禁放哪 | 选**放进 `tests/meta/coverage.test.ts`** |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 | 批准 |
|---|---|---|---|
| **D-1** | `applyEvent` / `replay` 收 `GameEvent`（判别联合），不是 §2.1 写的 `EventEnvelope` | 信封的 `payload` 是 `unknown`，折叠时必然按 `type` 访问它。要么在函数顶部 `as GameEvent` 把不安全藏起来，要么让编译器收窄。选了后者 | 用户批准 |
| **D-2** | `step` **自己折叠它产出的事件**：`state' = drafts → events → applyEvent 链` | 于是 `reduce(s,a) === step(s,a).state` 由构造保证（不是两条路径恰好对齐），且「派生字段只由 `applyEvent` 写」（C-18）变成结构性事实——`step` 没有别的途径改状态 | 计划内 |
| **D-3** | handler 只产出**事件草稿**，`gameId` / `seq` / `ts` 由 `step` 统一盖章 | `seq` 严格递增（AC-6）不可能被某个 handler 写错；`ts` 也不可能出现「引擎读了时钟」（ARCH-4 / Q-002-1） | 计划内 |
| **D-4** | 效果管道注入 `appliers` 表，默认空表，未注册的 `effect.type` 抛 `UnknownEffectError` | RFC-002 不定义任何具体效果类型（那归 RFC-003/004）。空表 + 抛错 = 「没人认领的效果不会被假装结算掉」 | 计划内 |
| **D-5** | 新增 `createEngine(config)` 工厂，并导出 `DEFAULT_HANDLERS` / `DEFAULT_APPLIERS` | §3 没列这些导出，但 AC-9（假表缺 handler）与 AC-11（注入假 modifier）必须能替换依赖，不能靠改全局状态 | 计划内 |
| **D-6** | `errors.ts` 有 5 个错误类型（`UnhandledTransitionError`、`MissingRngStateError`、`UnknownEventError`、`UnknownEffectError`、`InvalidEventStreamError`） | §3 只列了 `UnhandledTransitionError`；另外四种分别对应 §2.2 的 `rngAfter` 缺失、§4 的「未知事件必须抛错」、D-4 的效果缺 applier、以及事件流完整性（seq 跳号 / gameId 混流 / payload 长度）。全部按 `name` 断言 | 计划内 |
| **D-7** | `createInitialState(input, deck = DECK)` 加了**可选**第二参 | 让「板子与座位数不一致」这条防御分支可测；顺带为 F45（多套板子，v1 延后）留一个免费的缝。主签名不变 | 计划内 |
| **D-8** | 覆盖率门禁放 `tests/meta/coverage.test.ts`（带 `--coverage` 跑一次），`pnpm test` 仍是无覆盖率的单次运行；新增 devDependency `@vitest/coverage-v8@5.1.0` | 本地每次迭代不必多跑一遍插桩；阈值写在 `vitest.config.ts`，门禁测试断言退出码 + 报告数字 + 「引擎源码无覆盖率忽略注释」（TEST-2 明令禁止） | 用户批准 |
| **D-9** | `shared/actions.ts` 加 `ACTION_TYPES`；`schemas.ts` 加 `GameStartedPayloadSchema` / `RejectedPayloadSchema` / `PAYLOAD_SCHEMAS` | `REJECTED.actionType` 是 `Action['type']`（CR-003 C1），Zod 需要一份运行时枚举；payload schema 按 C-10 由拥有该事件的 RFC 追加，`GAME_STARTED` 与 `REJECTED` 是 RFC-002 的 | 计划内 |
| **D-10** | `unit` project 加 `setupFiles: ['tests/setup/no-network.ts']`，把 `fetch` 换成抛错桩 | AC-16 / TEST-4。`meta` project 不受影响（它本来就要起真实端口） | 计划内 |
| **D-11** | `GAME_STARTED` 带 `rngAfter`（发牌后的生成器状态） | 发牌消耗了随机数（§2.2 第 2 条）；没有它，`replay` 恢复出的 `state.rng` 会退回初始种子态，之后所有随机结果都漂移 | 计划内 |
| **D-12** | `START` 的 `seed` / `mode` / `playerSeat` 与已发牌状态不一致时产出 `Rejected`（`code: 'START_STATE_MISMATCH'`），不抛错 | 抛错会把一次坏请求变成 500。这也让 §2.3 的「规则拒绝」一栏有了第一个真实实例，而不是只存在于表格里 | 计划内 |
| **D-13** | `applyEvent` 校验 `gameId`：状态已有对局时，事件必须属于同一局，否则抛 `InvalidEventStreamError` | 拼接两局的事件流是那种「能跑出结果所以没人发现」的损坏；顺手也把 `replay` 的起点（空状态 `gameId === ''`）收敛成「首个事件建立对局身份」 | 计划内 |
| **D-14** | `LOBBY` 的 `day` 是 `0`，`GAME_STARTED` 之后才是 `1`；`phase` 从 `LOBBY` 变成 `NIGHT_WOLF_CHAT` | RFC-001 的注释说 `day`「从 1 开始」，指的是对局内的天数；LOBBY 不属于任何一天。`NIGHT_WOLF_CHAT` 依 RFC-003 §2.2 的阶段图（该图以夜聊开头） | 计划内 |
| **D-15** | `nextInt(rng: RngState, max)` 而不是 §2.5 写的 `nextInt(state: GameState, max)` | 抽取只需要生成器状态，把整个 `GameState` 传进去会让这个纯函数能碰到与随机无关的字段，也让测试必须伪造一局对局。同理 `shuffle(rng, items)`、`nextRandom(rng)` 都只收 `RngState` | 评审 N4 |
| **D-16** | 额外导出（§3 未列）：`createEmptyState`、`orderEffects`、`RANDOM_CONSUMING_EVENTS`、`WinCondition`、`PAYLOAD_SCHEMAS`、`ACTION_TYPES` | `createEmptyState` 是 `replay` 的起点；`orderEffects` 被 AC-10/12 的测试直接引用；`RANDOM_CONSUMING_EVENTS` 是「哪些事件必须带 `rngAfter`」的单一声明处；`WinCondition` 是 `GAME_ENDED.condition` 的封闭枚举（RFC-014 会消费它，见 D-17） | 评审 N6 |
| **D-17** | `WinCondition` 是封闭联合（`'all-wolves-dead'` / `'all-gods-dead'` / `'all-villagers-dead'` / `'all-good-dead'`），不是任意字符串 | §2.7 的例子 `'all-seers-and-witches-and-hunters-dead'` 是**示意**，不是精确文案。封闭枚举让 RFC-014 的复盘文案可以穷举映射，也让拼写漂移变成编译错误；`condition` 仍满足 §2.7 的 `string` | 评审 N7 |

### 8.3 文件清单（FILES CHANGED）

全部在分支 `rfc/001-project-scaffold-and-shared-contracts` 上。

| 类别 | 文件 |
|---|---|
| 引擎核心 | `src/engine/errors.ts`、`rng.ts`、`init.ts`、`apply.ts`、`transitions.ts`、`effects.ts`、`win.ts`、`step.ts`、`replay.ts` |
| 共享契约（追加） | `src/shared/actions.ts`（+`ACTION_TYPES`）、`src/shared/schemas.ts`（+`GAME_STARTED` / `REJECTED` payload schema、`PAYLOAD_SCHEMAS`） |
| 引擎测试 | `tests/engine/step.test.ts`、`serialization.test.ts`、`replay.test.ts`、`determinism.test.ts`、`events.test.ts`、`reject.test.ts`、`transitions.test.ts`、`effects.test.ts`、`rng.test.ts`、`win.test.ts`、`replay-parity.test.ts`、`no-network.test.ts` |
| 测试基建 | `tests/fixtures/states.ts`、`tests/setup/no-network.ts` |
| 门禁 | `tests/meta/coverage.test.ts`、`vitest.config.ts`（`setupFiles` + `coverage`）、`package.json`（+`@vitest/coverage-v8@5.1.0`） |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

§3 交付物表列了 3 个测试文件（`replay` / `effects` / `determinism`），`TEST-STRATEGY.md` 计划了更细的 10 个。实际按 TEST-STRATEGY 的划分落地（12 个），差异见 §8.6。

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `tests/engine/step.test.ts` · 10 种 action 的样本逐一断言 `reduce` 与 `step().state` 深度相等；含已开局后的拒绝路径 | PASS |
| 2 | 同上 · 同一 `(state, action)` 两次调用结果相等；`Object.freeze` 后调用不抛；不修改 action | PASS |
| 3 | `tests/engine/serialization.test.ts` · JSON 往返深度相等且能继续推进；递归断言每个值是原始值 / 普通数组 / 纯对象（原型为 `Object.prototype`），并用 `Date`/`Map`/`Set` 反例证明断言不是空转 | PASS |
| 4 | `tests/engine/replay.test.ts` · 只传事件流重建；`rng` 是发牌后的状态而非初始种子态；seq 跳号 / 首事件不对 / 缺 `rngAfter` / 未知类型 / gameId 混流各有否定用例。**事件权威**：用合成 `GAME_STARTED`（互换两个异身份席位）证明重建采用 `payload.roles` 而不是按 `seed` 重新发牌——评审 P4 把 `applyGameStarted` 改成重新发牌，此用例变红 | PASS |
| 5 | `tests/engine/determinism.test.ts` · 同 seed + 同 action 序列两次运行事件流逐条相等；不同 seed 发牌不同；同 seed 重放一致 | PASS |
| 6 | `tests/engine/events.test.ts` · `seq` 从 1 起严格递增无跳号无重复；`type` 落在 `GAME_EVENT_TYPES` 内；每条事件带 `gameId` 与数字 `ts` | PASS |
| 7 | 同上 · 首事件为 `GAME_STARTED`，payload 含 `seed`/`mode`/`playerSeat`/`roles`（另有 `personas`），可见性为 `server`，带 `rngAfter` | PASS |
| 8 | `tests/engine/reject.test.ts` · LOBBY 提交非 START、开局后提交任意 action、重复 START 都被拒且 `code === 'PHASE_MISMATCH'`；状态除 `seq` 外完全不变；带席位的拒绝事件可见性为 `self:<seat>` | PASS |
| 9 | `tests/engine/transitions.test.ts` · 表覆盖 14 个 phase；表里每个允许对都有 handler；假表缺 handler → 抛 `UnhandledTransitionError`；缺阶段 → 构造引擎即抛错 | PASS |
| 10 | `tests/engine/effects.test.ts` · 顺序为 `order` 升序 + 同级 `id` 字典序；应用顺序与规范化一致且不改入参；两次应用结果相等；未注册 applier 抛 `UnknownEffectError` | PASS |
| 11 | 同上 · 注册到 `VOTE_RESOLVE` 的假 modifier 注入效果后最终状态改变；modifier 只在它关心的结算点注入；多 modifier 依次折叠 | PASS |
| 12 | 同上 · 不注册 modifier 时结果 = 输入的顺序规范化；已排好序的输入深度相等 | PASS |
| 13 | `tests/engine/rng.test.ts` + `tests/helpers/source-scan.ts` · **递归**扫描 `src/engine` 全部 `.ts`（含子目录）；反空转断言列出九个交付文件；扫描器的递归能力由 `source-scan.test.ts` 用临时目录证明。评审 P13（在 `src/engine/nested/` 放 `Math.random()`）现在变红 | PASS |
| 14 | `tests/meta/coverage.test.ts` · `--coverage` 退出码 0；报告数字行 98.01% / 分支 94.04%（阈值 90 / 85）；引擎源码无 `c8 ignore` / `v8 ignore` / `istanbul ignore` | PASS |
| 15 | `tests/engine/win.test.ts` · 屠边三种条件各一例、屠城两种；「神全灭但民还活着」在屠城下**不**判狼胜；RUL-5 只数存活；调用前后状态深度相等 | PASS |
| 16 | `tests/engine/no-network.test.ts` · `fetch` 已被替换为抛错桩（并断言它不是原生实现） | PASS |
| **N 项** | `mode` 不一致拒绝（N8 / P19）、post-START 的 `phase === 'NIGHT_WOLF_CHAT'` 与 `day === 1`（N5 / P22）、`ACTION_TYPES` 双向等值（N2）、两个 payload schema 的 `safeParse`（N3）、真分段重放（N1）、整体推进比较（N10）、modifier 经 `step` 的入口到达 handler（N9）、一个 action 产出 3 条事件时 seq 连续（N11）、忽略注释扫描改为递归（N12） | PASS |
| **C-18** | `tests/engine/replay-parity.test.ts` · 跑一段序列 → `replay` → 用重放状态继续 `step`，事件与终态都与实时一致；判断胜负面一致；分段重放与一次重放一致。测试比较的是**整个 state**，RFC-003 起加了派生字段会自动被覆盖 | PASS |

### 8.5 验证输出（实跑，非转述）

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → "All matched files use Prettier code style!"   exit 0
$ pnpm build        → dist/client/index.html + dist/server/index.js  exit 0
$ pnpm test         → Test Files 29 passed (29) · Tests 206 passed (206)  exit 0
$ pnpm test:e2e     → "skipped：tests/e2e/ 下没有用例"                exit 0
$ pnpm selfplay     → "pnpm selfplay 未实现（RFC-015）"               exit 1

$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 98.13 | % Branch 95.23 | % Funcs 100 | % Lines 98.01
  apply.ts 96/91.30 · effects.ts 100/88.88 · errors.ts 100/100 · init.ts 90.9/80
  replay.ts 100/100 · rng.ts 96.15/90 · step.ts 100/100 · transitions.ts 100/100 · win.ts 100/100
```

`init.ts` 的分支覆盖 80% 是已知的：`role === undefined` 那条在「板子长度已校验」之后不可达，是 `noUncheckedIndexedAccess` 逼出来的防御分支。聚合分支 94.04% 达标，未用忽略注释遮掩（TEST-2 明令禁止，且门禁测试会扫）。

### 8.6 已知缺口（交给后续 RFC，不隐藏）

| 缺口 | 说明 | 归属 |
|---|---|---|
| 12 个阶段的 `transitions` 与 handler | 本 RFC 只填 `LOBBY` / `FINISHED`（§6 的边界）。其余阶段现在是空数组 → 任何 action 都被拒 | RFC-003 / RFC-004 / RFC-005 |
| 15 个事件的 `applyEvent` 折叠 | 除 `GAME_STARTED` / `REJECTED` 外全部抛 `UnknownEventError`（不静默忽略） | 拥有该事件的 RFC |
| 效果 applier 表是空的 | RFC-002 不定义任何 `Effect.type`；默认表为空，遇到效果即抛错 | RFC-003 / RFC-004 |
| `isVisibleTo` 行为矩阵 | 按 RFC-001 §6 与 Round 4 的结论，留在 RFC-005 第一个提交 | RFC-005 |
| 从 JSON 恢复时的事件校验 | `replay` 收的是**已定型**的 `GameEvent`（D-1）。会话存储从磁盘/数据库拿到的仍是 `unknown`，需要 envelope + payload 的 Zod 校验 | RFC-008 |
| 多套板子（F45） | `createInitialState` 的 `deck` 参数是缝，不做功能 | 延后（`RFCS.md` §5.1） |
| 覆盖率只覆盖 `src/engine/` | `shared` / `server` / `client` 的覆盖率门禁不在 TEST-2 范围内 | 按 RULES 现状；如需扩展改 TEST-2 |
| `RANDOM_CONSUMING_EVENTS` 是手工维护的集合 | 新增消耗随机数的事件时若忘了加进去，`applyEvent` 就不会要求 `rngAfter`，重放会静默漂移。**纪律**：RFC-003/004 每次新增这类事件，同时更新该集合与一条「缺 `rngAfter` 抛 `MissingRngStateError`」的用例 | RFC-003 / RFC-004 |
| 没有做深冻结（N14） | `Object.freeze` 只冻结一层，嵌套对象仍可被改。当前 `step` 不写嵌套对象，且纯函数性已有两条测试（冻结不抛 + 两次调用相等）；深冻结收益边际 | 按需 |
