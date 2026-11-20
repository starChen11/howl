# RFC-003 · 板子分配、夜晚阶段与严格规则

**Features**: F1, F3, F8
**Depends on**: RFC-002
**Rules**: ARCH-3, ARCH-5, ARCH-6, ARCH-11, DATA-2, DATA-4, RUL-3, RUL-8
**Complexity**: Medium
> 关联需求：FR-17（严格规则集）、FR-4（夜晚行动）

---

## 1. 摘要

把引擎填上第一层血肉：**发牌**、**夜晚行动队列**、**死亡结算**，以及两条与夜晚相关的裁决——女巫每夜至多一种药（RUL-3）、解药先于击杀（RUL-8）。

交付后，一局可以推进到「第一夜结算完毕、天亮广播待接」；白天阶段由 RFC-004 接手。

## 2. 技术方案

### 2.1 发牌

固定板子：3 狼人、1 预言家、1 女巫、1 猎人、3 村民，共 9 席。`createInitialState`（RFC-002 §2.2）用 `seed` 驱动 Fisher–Yates 洗牌，产物写入 `GAME_STARTED` 事件的 `roles` 字段。

**不做玩家优待**：玩家席位拿到什么就是什么（FR-2 / F17）。

### 2.2 夜晚子阶段

```
NIGHT_WOLF_CHAT → NIGHT_WOLVES → NIGHT_SEER → NIGHT_WITCH
  → NIGHT_RESOLVE → (NIGHT_HUNTER_SHOOT | DAY_ANNOUNCE)
```

`NIGHT_WOLF_CHAT` 在 RFC-005 实现；本 RFC 的阶段图包含它但**跳过**（没有 action 时直接前进）。其余各阶段：

| 阶段 | 允许的 action | 规则 |
|---|---|---|
| `NIGHT_WOLVES` | `WOLF_KILL` | 目标必须是存活且非狼的席位 |
| `NIGHT_SEER` | `SEER_CHECK` | 目标必须是存活席位 |
| `NIGHT_WITCH` | `WITCH_ACT` | `potion` 三选一；`heal` 不得指向自己（FR-17）；每种药只能用一次（RUL-3 只允许一种药/夜） |
| `NIGHT_RESOLVE` | 无（自动推进） | 见 §2.3 |
| `NIGHT_HUNTER_SHOOT` | `HUNTER_SHOOT` | 仅在刀杀的猎人在场时进入；省略 `target` 表示放弃 |

**角色已出局时跳过其阶段**：预言家已出局则不进入 `NIGHT_SEER`，其余同理。女巫两瓶药都用完仍进入 `NIGHT_WITCH`（她可以选 `none`）——这保证阶段序列稳定，便于回放。

### 2.3 死亡结算顺序

固定顺序（RUL-8 + FR-17）：

1. 读出狼人击杀目标 `killTarget`。
2. 若女巫本夜用了 `heal` 且 `healTarget === killTarget` → 该目标存活，当夜无狼刀死亡。
3. 否则 `killTarget` 出局。
4. 若女巫本夜用了 `poison`，其目标出局。

**同一席位既被刀又被毒**（第 3、4 步指向同一人）：按 **RUL-11** 只出局一次、死因记为**毒药**，因此若该席位是 hunter 则**不开枪**。顺序上它仍排在「狼刀」的位置（`diedLastNight` 依赖结算顺序，见 RFC-004）。
5. 全部出局者应用完毕后，**先调用 `checkWin`（RFC-002 §2.7）判一次胜负**（RUL-1）。若这一批死亡**同时**满足两阵营的胜利条件（例如最后一名神被刀、最后一只狼被毒），按 **RUL-12「狼刀在先」判 wolf 胜**。
   - 已分出胜负 → 对局结束，**不进入开枪阶段**。
   - 未分出胜负 → 继续下一步。
6. **猎人**：若出局方式是「被狼刀」则进入 `NIGHT_HUNTER_SHOOT`；若是「被毒杀」则**不进入**（FR-17）。
7. 开枪结算完成后**再调用一次 `checkWin`**。
8. 未结束则进入 `DAY_ANNOUNCE`。**RFC-004 起它是自动阶段**：`step` 会在同一步内产出 `DAY_STARTED` 并推进到 `DAY_SPEECH`，所以夜晚结束时观察到的相位是 `DAY_SPEECH`；本步骤的「进入」语义不变（见 §5 AC-16 的注）。

整个 §2.3 产出的是 `Effect[]`（`source: 'role'`），按 RFC-001 §2.3 的 `order` 分区落位：解药在 0–99、狼刀与毒药在 100–199、猎人开枪在 200–299——**升序应用即可满足 RUL-8「解药先于击杀」与 RUL-1「开枪先于胜负判定」**。

### 2.4 私有信息的记录方式

**这是本 RFC 最容易写错的地方。** 查验结果与药水位**不能只写进 `state`**，否则 `replay(events)` 无法重建它们（RFC-002 AC-4）。

做法：私有信息**以私有事件记录**，可见性用 RFC-001 的 `Visibility`：

| 事件 | `visibleTo` | payload |
|---|---|---|
| `SEER_CHECKED` | `seer` | `{ target: SeatId, result: 'wolf' \| 'not-wolf' }` |
| `WITCH_POTION_USED` | `witch` | `{ potion: 'heal' \| 'poison', target: SeatId }` |
| `WOLF_KILL_CHOSEN` | `wolves` | `{ target: SeatId }` |

`state` 中不另存一份 `secrets`——私有信息由事件流推导（RFC-007 的 `project` 读这些事件）。这样「状态」与「事件流」不会打架。

### 2.5 晚上「女巫知不知道刀口」

女巫行动时**能看到**本夜的 `killTarget`——这是狼人杀的标准规则（她要决定救不救）。因此 `WOLF_KILL_CHOSEN` 事件虽标 `visibleTo: 'wolves'`，但女巫在决策上下文中需要它。

处理：`project()`（RFC-007）在女巫的 `NIGHT_WITCH` 阶段额外注入本夜刀口。**这不是可见性例外**：该信息在真实规则中本就该告知女巫。RFC-007 必须实现这条。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/deal.ts` | 板子定义与洗牌（供 `init.ts` 调用） |
| `src/engine/phases/night.ts` | 夜晚子阶段与行动校验 |
| `src/engine/resolve/deaths.ts` | 死亡结算顺序与效果产出 |
| `src/engine/queries.ts` | `countAliveByFaction()` 等只读查询 |
| `tests/engine/deal.test.ts` | 发牌 |
| `tests/engine/night.test.ts` | 夜晚行动 |
| `tests/engine/death-resolve.test.ts` | 死亡结算顺序 |

## 4. 实现要点

- **拒绝一律走 `Rejected` 事件**（RFC-002 §2.3），不抛业务异常。`code` 取值：`PHASE_MISMATCH`、`TARGET_NOT_ALIVE`、`WOLF_KILL_WOLF`、`WITCH_SELF_SAVE`、`POTION_ALREADY_USED`、`NOT_YOUR_TURN`。
- 药水是否已用**从事件流推导**：可以以派生字段的形式存在 `state` 里，但**不得另存不可重建的副本**，且只能由 `applyEvent` 写（RFC-001 §2.3 的 C-18 规则）。
- `NIGHT_RESOLVE` 是自动推进的阶段：没有 action，进入时立即结算并离开。
- `DAY_ANNOUNCE` 阶段的处理实现在 RFC-004；本 RFC 的 `transitions.ts` 对它只登记「无允许 action」，于是任何 action 都是 `Rejected`（`code: 'PHASE_MISMATCH'`）——**不是** `UnhandledTransitionError`（后者只用于「在允许集内却没有 handler」，见 §8.3 的 AC-16 修正）。

## 5. 验收标准

1. 用 50 个固定种子各发一次牌，每次都恰好是 3 狼 / 1 预言家 / 1 女巫 / 1 猎人 / 3 村民
2. 同一 `seed` 两次发牌结果完全一致；`roles` 出现在 `GAME_STARTED` 事件的 payload 中
3. 50 个固定种子的样本里，玩家席位分别拿到过狼、神、民三类各至少 1 次
4. `WOLF_KILL` 提交后产出 `WOLF_KILL_CHOSEN` 事件，其 `visibleTo === 'wolves'`
5. `WOLF_KILL` 指向已出局席位时产出 `Rejected`（`code === 'TARGET_NOT_ALIVE'`）；同一轮内狼人指定狼人为目标时产出 `Rejected`（`code === 'WOLF_KILL_WOLF'`）；两种情况状态除 `seq` 外不变
6. `SEER_CHECK` 后产出 `SEER_CHECKED` 事件，`visibleTo === 'seer'`，`result` 只取 `'wolf'` 或 `'not-wolf'` 且与目标真实阵营一致
7. `WITCH_ACT` 指定 `heal` 且 `target` 为女巫自己时，产出 `Rejected` 事件且 `code === 'WITCH_SELF_SAVE'`
8. 同一夜第二次提交 `WITCH_ACT`（无论哪种药）时，产出 `Rejected` 事件且 `code === 'NOT_YOUR_TURN'`（该阶段已结束）——**已由 §8.3 修正为 `PHASE_MISMATCH`**，见该节的理由
9. 女巫用过的药在后续夜晚再次使用时，产出 `Rejected` 事件且 `code === 'POTION_ALREADY_USED'`（药水位由事件流推导）
10. `heal` 目标与狼刀目标相同时：当夜无人出局，事件流中不含任何 `PLAYER_DIED` 事件
11. `heal` 目标与狼刀目标不同时：狼刀目标出局、被救目标存活，两者各有一条 `PLAYER_DIED` 事件（仅出局者）
12. 刀杀的猎人在「未分出胜负」时进入 `NIGHT_HUNTER_SHOOT`，提交 `HUNTER_SHOOT` 后产出带 `source: 'role'` 的效果，并触发第二次 `checkWin`
13. 毒杀的猎人出局后**不**进入 `NIGHT_HUNTER_SHOOT`：事件流中不含任何 `HUNTER_SHOOT` 事件
14. **胜负先于开枪**：构造「被刀的猎人正是最后一个神（屠边）」的局面，断言对局在第一次 `checkWin` 处结束为狼胜，且事件流中**不含** `NIGHT_HUNTER_SHOOT` 阶段与 `HUNTER_SHOOT` 事件
15. 夜晚结算产出的每条 `Effect` 的 `source` 均为 `'role'`；解药的 `order` 小于狼刀与毒药的 `order`，猎人开枪的 `order` 大于二者的 `order`（可据此断言 RUL-8 的时序）
16. 未分出胜负时，夜晚结束后进入白天。**（本 AC 已由 RFC-004 取代两次）**：第一次改成 `Rejected`（`PHASE_MISMATCH`，见 §8.3）；第二次因为 RFC-004 的「自动阶段」机制（`DAY_ANNOUNCE` 不停留），夜晚现在停在 `phase === 'DAY_SPEECH'`，对该阶段的非法 action 仍产出 `Rejected` 且状态除 `seq` 外不变

## 6. 边界与测试

- **不做**：白天、投票、胜负判定、狼人夜聊（`NIGHT_WOLF_CHAT` 只占位跳过，实现在 RFC-005）。
- **不做**：猎人被放逐时的开枪——那是 `DAY_HUNTER_SHOOT`，属 RFC-004。
- **测试**：表驱动，固定种子 + 构造状态。统计类断言只用固定种子集合，不用卡方检验（避免随机失败违反 TEST-1）。
- **实现者选择**：洗牌的中间数组形态、错误文案、查询函数的拆分粒度。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-003-1 | 女巫能否对已出局玩家使用解药 | **(assumption)** 不能，`TARGET_NOT_ALIVE` |
| Q-003-2 | 预言家能否查已出局玩家 | **(assumption)** 不能，同上 |
| Q-003-3 | 预言家能否选择不查验 | **(assumption)** 不能；每夜必须查一人（FR-4「查验一人」） |
| Q-003-4 | 女巫能否毒自己 | **(assumption)** 可以——RUL-3 与 FR-17 只禁止「解药自救」，未禁止毒自己 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。评审在**新会话**里只凭仓库文件判断。分支 `rfc/001-project-scaffold-and-shared-contracts`（RFC-001/002 的代码也在其上，尚未合并回 `main`）。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 整体计划（含 Q-003-1~4、RUL-3/5/8 按 RULES §6） | 批准 |
| 相位推进机制（D-1） | 选**新增 `PHASE_CHANGED` 事件** |
| AC-16 与 RFC-002 §2.3 的冲突 | 选**改成 REJECTED，修正 AC-16** |

**C-21（modifier 注册表进 `GAME_STARTED`）不阻塞本 RFC**：RFC-003 不注册任何 modifier，`step` 的 `modifiers` 入参原样传给 handler，留给遗物系统。

### 8.2 偏离与实现决定

| # | 决定 | 为什么 | 批准 |
|---|---|---|---|
| **D-1** | `GameEventMap` 新增 `PHASE_CHANGED { from, to }`（**夜间 `server` / 白天 `public`**，见 §9 的 C-23） | 相位推进需要一个事件来承载：`NIGHT_WITCH` 收到 `potion: 'none'` 时**什么也没发生**，没有别的事件能表示「这一阶段结束了」。没有它只能靠隐式推导，而「无事发生」的转移无处安放。RFC-001 §2.3 明文允许后续 RFC 增加成员 | 用户批准 |
| **D-2** | `NIGHT_RESOLVE` 是**瞬态**：最后一个夜间 action 的 handler 一次产出 `PHASE_CHANGED(→RESOLVE)` + 死亡事件 + `PHASE_CHANGED(→终点)` 或 `GAME_ENDED` | 无 action 的阶段无法被 `step` 驱动；把它做成瞬态既保留了阶段图的可观测性，又不需要额外的「推进」action | 计划内 |
| **D-3** | `PLAYER_DIED` 的可见性是 **`server`** | 死因（刀 / 毒）在真实规则里**不公开**，天亮只公布「谁死了」。若 `PLAYER_DIED` 走 `public`，`cause` 会随公开事件泄漏给玩家。公开广播由 RFC-004 的 `DAY_STARTED.diedLastNight` 承担，那里没有 `cause` | 计划内的安全决定，见下 |
| **D-4** | `GameState` 新增两个派生字段：`night?: { killTarget?, healTarget?, poisonTarget? }`、`potionsUsed?: { heal, poison }` | C-18 的规则：派生字段合法，但只能由 `applyEvent` 写、必须可完整重建。药水位整局累计（RUL-3 / FR-17），`night` 每次进入新的一夜清空 | 计划内 |
| **D-5** | `NOT_YOUR_TURN` 的机械含义是「**阶段对，但提交者不是该阶段的行动者**」；**阶段不对**一律由 `step` 判成 `PHASE_MISMATCH` | 见 §8.3 的 AC-8 修正：AC 原文把「同一夜第二次用药」写成 `NOT_YOUR_TURN`，但那时阶段已经不是 `NIGHT_WITCH`，按 RFC-002 §2.3 的判据是 `PHASE_MISMATCH` | 用户批准（AC 修正） |
| **D-6** | 第一只提交 `WOLF_KILL` 的存活狼决定刀口，随后阶段立刻推进 | RFC-003 没有定义多狼共识（夜聊在 RFC-005）。先到先得，**不做多数表决**；若要表决，属 RFC-005 的变更 | 计划内 |
| **D-7** | `DECK` 与发牌从 `init.ts` 移到新的 `deal.ts`；`createInitialState` 增加可选 `deck` 参数 | §3 已把 `deal.ts` 列为交付物；`deck` 参数让「板子规模与座位数不一致」这条防御分支可测，也为 F45 留缝 | 计划内 |
| **D-8** | 新增 `src/engine/reject.ts`（拒绝草稿构造）与 `src/engine/queries.ts`（只读查询） | §3 列了 `queries.ts`；`reject.ts` 是 §3 之外的拆分——`step` 与四个夜间 handler 都要产出 `REJECTED`，各写一份迟早出现两种 `code` 拼写 | 计划内 |
| **D-9** | 测试文件按 `TEST-STRATEGY` 拆成 6 个（`deal` / `night` / `seer` / `witch` / `death-resolve` / `queries`），不是 §3 的 3 个 | 计划与 RFC 的差异，按更细的计划走 | 计划内 |

### 8.3 验收标准的修正（三处）

实现时发现三条 AC 与 RFC-002 §2.3 的机械判据矛盾。**按判据实现，修改 AC 措辞**，并在此记录——不静默按其中一方裁决。

| AC | 原文 | 问题 | 改为 |
|---|---|---|---|
| **AC-8** | 「同一夜第二次提交 `WITCH_ACT` → `NOT_YOUR_TURN`（该阶段已结束）」 | 那时阶段已不是 `NIGHT_WITCH`，按判据是 `PHASE_MISMATCH`。要让它是 `NOT_YOUR_TURN`，就得给「阶段已结束」开特例，而这会破坏「判据是机械的」 | 第二次用药 → `PHASE_MISMATCH`；`NOT_YOUR_TURN` 保留给「阶段对但行动者不对」（如非狼提交 `WOLF_KILL`） |
| **AC-16** | 「对本 phase 提交任何 action 均抛 `UnhandledTransitionError`」 | 抛错的条件是「action **在**允许集合内却没有 handler」。`DAY_ANNOUNCE` 的允许集为空，所以任何 action 都是 `PHASE_MISMATCH`；要让它抛错就得给空阶段声明允许 action，而那会破坏 RFC-002 AC-9（每个允许对必须有 handler） | `DAY_ANNOUNCE` 的允许集为空，任何 action → `Rejected`（`PHASE_MISMATCH`） |
| **AC-14** | 「刀杀的猎人正是最后一个神 → 对局在第一次 `checkWin` 处结束」 | 判据正确，但**没有任何 AC 要求 `phase === 'FINISHED'`**。实现里 `GAME_ENDED` 会把相位设成 `FINISHED`，这是新增行为 | 已在测试中断言「同一步内结束、无开枪阶段、无 `HUNTER_SHOOT` 事件」 |

### 8.4 补充决定

- **`SEER_CHECKED` 不写进 `state`**：查验结果是私有信息，只以事件存在。写进状态就成了第二份来源，而投影（RFC-007）读事件。
- **`applyPhaseChanged` 校验 `from === state.phase`**：不一致说明事件流被拼错了；静默接受会让重放走进一个从未存在过的阶段。
- **解药通过「不产生击杀效果」抵消狼刀**，而不是「先杀后救」。后者会产生「死了又活」的中间态，与 RUL-8 的语义不符。
- **`finishNight` 的刀口可以由调用方覆盖**：狼刀可能直接触发结算（seer 与 witch 都已出局），而那条 `WOLF_KILL_CHOSEN` 此刻还是草稿、尚未折叠。这个坑在 AC-14 的测试里被抓到过一次。
- **`PLAYER_DIED` 重复或指向不存在的座位 → 抛 `InvalidEventStreamError`**：数据损坏要炸出来。

### 8.5 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 引擎新增 | `src/engine/deal.ts`、`src/engine/queries.ts`、`src/engine/reject.ts`、`src/engine/phases/night.ts`、`src/engine/resolve/deaths.ts` |
| 引擎修改 | `src/engine/init.ts`（改用 `deal.ts`）、`src/engine/apply.ts`（6 个事件的折叠）、`src/engine/step.ts`（并入夜间 handler、START 之后推进相位）、`src/engine/transitions.ts`（填五个夜晚阶段） |
| 共享修改 | `src/shared/events.ts`（+`PHASE_CHANGED`、运行时清单）、`src/shared/domain.ts`（+`NightContext` / `PotionUsage` 与两个派生字段） |
| 测试新增 | `tests/engine/deal.test.ts`、`night.test.ts`、`seer.test.ts`、`witch.test.ts`、`death-resolve.test.ts`、`queries.test.ts`；夹具 `tests/fixtures/night.ts` |
| 测试修改 | `tests/engine/{reject,replay,events,transitions}.test.ts`（RFC-002 时代的边界断言，随阶段表扩张更新） |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.6 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `deal.test.ts` · 50 个固定种子各发一次，计数恒为 3/1/1/1/3 | PASS |
| 2 | `deal.test.ts`（同 seed 两次发牌一致、座位角色由发牌决定）+ `events.test.ts`（`GAME_STARTED.payload.roles` 与发牌结果一致、与 `state` 一致） | PASS |
| 3 | 同上 · 50 个种子里玩家席位拿到过狼 / 神 / 民三类 | PASS |
| 4 | `night.test.ts` · `WOLF_KILL_CHOSEN` 的 `visibleTo === 'wolves'`，且状态里记下刀口 | PASS |
| 5 | 同上 · `TARGET_NOT_ALIVE` / `WOLF_KILL_WOLF`，状态除 `seq` 外不变 | PASS |
| 6 | `seer.test.ts` · 三种目标各查一次，`visibleTo === 'seer'`，`result` 与真实阵营一致 | PASS |
| 7 | `witch.test.ts` · 自救 → `WITCH_SELF_SAVE`；毒自己合法（Q-003-4） | PASS |
| 8 | 同上 · 第二次用药 → `PHASE_MISMATCH`（**AC 已修正**）；非女巫 → `NOT_YOUR_TURN` | PASS |
| 9 | 同上 · 次夜复用已用药 → `POTION_ALREADY_USED`（构造的第二夜状态） | PASS |
| 10 | 同上 · 解药命中刀口：无 `PLAYER_DIED`，刀口存活 | PASS |
| 11 | 同上 · 解药未命中：只有刀口出局；毒药另加一条且两人都死 | PASS |
| 12 | `death-resolve.test.ts` · 被刀出局的 hunter 进入 `NIGHT_HUNTER_SHOOT`；开枪效果 `source: 'role'`、`order` 在 200 区；带走最后一狼 → 第二次判定好人胜 | PASS |
| 13 | 同上 · 被毒杀的 hunter 不进开枪阶段，事件流无 `HUNTER_SHOOT` | PASS |
| 14 | 同上 · 「被刀的 hunter 是最后一个神」→ 同一 action 内 `GAME_ENDED(all-gods-dead)`、相位 `FINISHED`、无开枪阶段（**AC 已补断言**） | PASS |
| 15 | 同上 · 解药 `order` < 击杀 `order` < 开枪 `order`；夜晚效果 `source` 全为 `role`；解药命中时不产生击杀效果；效果应用后的存活集与 `PLAYER_DIED` 事件集一致 | PASS |
| 16 | `night.test.ts` · 夜晚结束进 `DAY_ANNOUNCE`；对该阶段提交任何 action 都是 `Rejected`（**AC 已修正**） | PASS |

### 8.7 验证输出（实跑，非转述）

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → "All matched files use Prettier code style!"   exit 0
$ pnpm build        → dist/client/index.html + dist/server/index.js  exit 0
$ pnpm test         → Test Files 35 passed (35) · Tests 270 passed (270)  exit 0
$ pnpm test:e2e     → "skipped：tests/e2e/ 下没有用例"                exit 0
$ pnpm selfplay     → "pnpm selfplay 未实现（RFC-015）"               exit 1

$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 97.24 | % Branch 94.36 | % Funcs 100 | % Lines 97.05
  deal.ts 100/100 · queries.ts 100/100 · resolve/deaths.ts 100/100
  phases/night.ts 97.64/94.73 · apply.ts 90.56/88.63
```

### 8.8 已知缺口（交给后续 RFC）

| 缺口 | 说明 | 归属 |
|---|---|---|
| `NIGHT_WOLF_CHAT` 只占位跳过 | 阶段图里有它、允许集为空，`START` 直接推进到 `NIGHT_WOLVES` | RFC-005 |
| 白天阶段 | `DAY_ANNOUNCE` 及之后全部未实现（允许集为空 → 拒绝） | RFC-004 |
| 多狼共识 | 第一只提交的狼决定刀口，不做表决（D-6） | 若需要，走 RFC-005 的变更 |
| 女巫「看到刀口」 | `WOLF_KILL_CHOSEN` 的 `visibleTo` 是 `wolves`，女巫要靠投影额外注入（§2.5）。**本 RFC 未实现投影**，所以这条只停留在状态里有 `night.killTarget` | RFC-007 |
| `PHASE_CHANGED` 的事件量 | 每夜约 4–6 条相位事件，事件流比原来长。RFC-008 的存储策略会看到这个量级 | RFC-008 参考 |

---

## 9. Round 1 评审回应（Changes requested → 本轮修复）

评审结论 **Changes requested / High**。16 条 AC 按字面全过，但三个阻塞项**都不在 AC 覆盖面里**——这是本轮最值得记的一点：AC 矩阵通过 ≠ 这份交付物可用。

### 9.1 三个阻塞项

| 项 | 问题 | 处理 | 复验 |
|---|---|---|---|
| **B1 / C-24** 合法输入崩溃 | 女巫毒「狼刀目标」时，`resolveNight` 产出两条 `Death` → 两条 `PLAYER_DIED` → `applyPlayerDied` 把第二次出局当数据损坏抛 `InvalidEventStreamError`。**一个正常操作把引擎打崩** | ①按座位归并死亡（必须）；②**毒药优先**，且**已落榜为 `RULES.md` 的 RUL-11**（`CHANGE-REQUEST-005`）——RFC 的实现说明不是规则依据 | `resolveNight({killTarget:7, poisonTarget:7})` 只产出 `[{seat:7, cause:'poison'}]` 与一条 kill 效果；目标是 hunter 时不进 `NIGHT_HUNTER_SHOOT`；多死时顺序是结算顺序（狼刀先、毒药后） |
| **B2 / C-23** 夜间相位公开泄漏 | `PHASE_CHANGED` 全是 `public`：跳过 `NIGHT_SEER`/`NIGHT_WITCH` 等于告诉全场「seer / witch 已出局」；`→NIGHT_HUNTER_SHOOT` 泄漏 hunter 死于狼刀而非毒杀。RFC-007 的 `publicEvents` 会把它原样放进每个 AI 的上下文（FR-9） | **夜间相位一律 `server`**，白天相位仍 `public`。规则收敛在 `src/engine/phases/visibility.ts` 的 `phaseVisibility(to)`：`to.startsWith('NIGHT_') ? 'server' : 'public'`。**所有相位草稿都必须经 `phaseChangedDraft()` 产出**——Round 2 抓到 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 这一条漏改、仍硬编码 `public`。玩家端仍能看到「天黑/天亮」——**但 `state.phase` 本身会把夜间子阶段漏出去**（`NIGHT_SEER`/`NIGHT_WITCH`/`NIGHT_HUNTER_SHOOT` 都在名字里），所以投影（RFC-007）不能直接透出原始 `phase`，要折叠成「夜晚 / 白天」两态；这是 C-28，留给 RFC-007。天亮广播由 RFC-004 的 `DAY_STARTED` 承担 | `tests/engine/night-visibility.test.ts`：一整夜的公开事件只允许「天亮的相位推进」与 `GAME_ENDED`；死 seer / 死 witch 两条跳过路径的相位事件都是 `server` |
| **B3** payload schema 缺失 | RFC-003 接管的 6 个事件没有 Zod schema，违反 RFC-001 §2.3 的「每个 payload」 | 在 `src/shared/schemas.ts` 补 `WOLF_KILL_CHOSEN` / `SEER_CHECKED` / `WITCH_POTION_USED` / `PLAYER_DIED` / `HUNTER_SHOOT` / `PHASE_CHANGED` 六个 schema，并登记进 `PAYLOAD_SCHEMAS`。**`GAME_ENDED` 的归属**：它第一次由 RFC-003 产出（夜间即可终局），schema 定义在这里，RFC-004 复用 | `tests/shared/schemas.test.ts`：每个 schema 一对正反例 |

### 9.2 非阻塞项

| # | 处理 |
|---|---|
| **N1** | `replay-parity.test.ts` 的序列改成**真实的一整夜**（开局 → 狼刀 → 查验 → 女巫解药），并加一条断言：`night` 与 `potionsUsed` 在 `replay` 后仍在。原来那条序列没有任何夜间 action 成功执行，两个派生字段根本没被覆盖 |
| **N2** | AC-5 的 `WOLF_KILL_WOLF` 补「除 `seq` 外状态不变」断言 |
| **N3** | AC-9 的药水位测试改成从开局重跑、收集完整事件流再 `replay`——原来标题写 replay，正文却没调用它 |
| **N4** | §5 的 AC-8 / AC-16 正文加「已由 §8.3 修正」的指针 |
| **N5** | 删掉 `hunterShoot` 里 `deathCauseOf` 的空循环；`resolveHunterShot` 里效果 payload 与 `Death` 共用同一个 `cause` 常量 |
| **N6** | 统一 appliers：handler 改用 `context.appliers`（原来绕过注入直接引用 `DEATH_APPLIERS` 常量），`DEFAULT_APPLIERS` 接上 `DEATH_APPLIERS`。现在注入自定义表能真正替换掉默认行为 |
| **N7** | 补三条负向用例：`PHASE_CHANGED` 的 `from` 与当前阶段不一致、`PLAYER_DIED` 重复出局（真正的数据损坏） |
| **N8** | README / TEST-STRATEGY / 本节证据同步——**Round 2 抓到这里其实没做**：README 的用例数与覆盖率仍是旧值，与同文件另一处自相矛盾。Round 2 修复时一并改掉 |
| **N9** | 记入 §9.4：`PLAYER_DIED(cause: 'lynch')` 在 RFC-004 里应当是 `public`（放逐结果要进事件面板），**不要**照搬夜间 `server` |
| **N10** | `POTION_ALREADY_USED` 的检查提到 `WITCH_SELF_SAVE` 之前：药已经没了比「你不能对自己用」更根本，两种错误同时成立时前者更可操作。补用例 |
| **C-25** | 非阻塞，属 `FEATURES` 与 RFC 的功能映射问题，不在本 RFC 代码范围；留给 `/manage-changes` |

### 9.3 文件清单（本轮新增 / 修改）

| 类别 | 文件 |
|---|---|
| 引擎新增 | `src/engine/phases/visibility.ts`（`phaseVisibility` / `phaseChangedDraft`） |
| 引擎修改 | `src/engine/resolve/deaths.ts`（按座位归并 + 毒药优先 + N5）、`src/engine/phases/night.ts`（相位草稿走统一可见性、appliers 来自 context、用药优先级）、`src/engine/step.ts`（START 的相位可见性、`DEFAULT_APPLIERS`） |
| 共享修改 | `src/shared/schemas.ts`（+7 个 payload schema 与 `PAYLOAD_SCHEMAS` 登记） |
| 测试新增 | `tests/engine/night-visibility.test.ts`（C-23）、`tests/shared/schemas.test.ts`（B3） |
| 测试修改 | `tests/engine/{death-resolve,night,witch,replay,replay-parity}.test.ts`（B1 / C-24 / N1 / N2 / N3 / N7 / N10） |

### 9.4 给 RFC-004 的提醒

- **`PLAYER_DIED(cause: 'lynch')` 应当是 `public`**：放逐结果全桌可见，且 RFC-013 的事件面板要展示它。夜间之所以是 `server`，是因为**夜间死亡**的死因不公开且天亮前不该有人知道；白天放逐不适用这条。
- **`DAY_STARTED` 是天亮的唯一公开广播**，payload 只有天数与死者、没有死因。
- `PHASE_CHANGED` 的可见性规则已由 `phaseVisibility()` 统一，白天阶段直接复用；不要为白天另写一套。

### 9.5 本轮验证输出

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → exit 0
$ pnpm build        → exit 0
$ pnpm test         → Test Files 37 passed (37) · Tests 295 passed (295)  exit 0
$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 97.59 | % Branch 95.79 | % Funcs 100 | % Lines 97.42
```

---

## 10. Round 2 评审回应（Changes requested → 本轮修复）

Round 2 的结论是 **Changes requested / High**，抓到的是**「修了一半就以为修完了」**。

### 10.1 三个阻塞项

| 项 | 问题 | 处理 | 反向验证 |
|---|---|---|---|
| **B-R2-1** hunter 路径仍泄漏 | Round 1 我把 `finishNight` 的相位草稿换成了 `phaseChangedDraft`，却漏了紧邻的 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 那条，它仍是硬编码 `public`——**泄漏点原封不动**。而当时新写的测试只断言 `phaseVisibility()` 的规则，改对改错都不会红 | 那条也改走 `phaseChangedDraft`；新增**真实路径**测试：狼刀 hunter → 查验 → 女巫 `none` → 断言进入开枪的那条 `PHASE_CHANGED` 是 `server`；`leaksOf` 白名单补上合法的 `HUNTER_SHOOT`（开枪本来就是公开动作） | 把那条改回 `public` → 真实路径测试立刻变红（本轮实跑） |
| **B-R2-2** 裁决没落榜 | C-24 的「毒药优先」只写在本文档 §9，`RULES.md` §6 没有对应裁决。**RFC 的实现说明不是规则依据**——下一个人读 RULES 找不到，就会在 RFC-004/005 重新撞一次 | 走 `/manage-changes`：`changes/CHANGE-REQUEST-005.md` 把裁决落榜为 **RUL-11**（同一席位只出局一次、死因记毒药、hunter 不开枪）。同步 RULES §4 计数（75 → 76）、§6 引导句、OQ-R5 与 `AGENTS.md` 的规则范围引用 | — |
| **C-26** 死亡顺序被排序打乱 | Round 1 去重时顺手写了 `.sort((a, b) => a.seat - b.seat)`，于是 `resolveNight({killTarget:9, poisonTarget:3})` 返回 `[3, 9]`——而 RFC-003 §2.3 的步骤是「先狼刀、后毒药」，RFC-004 的 `diedLastNight` 与发言起点都依赖这个顺序 | 删掉排序。归并用的 `Map` 保留首次插入位置，所以顺序天然是结算顺序；同一座位既被刀又被毒时仍排在狼刀的位置（死因已改记为毒药） | 新增用例：`resolveNight({killTarget:9, poisonTarget:3})` 必须返回 `[9, 3]` |

### 10.2 测试与死代码

| # | 处理 |
|---|---|
| **PAYLOAD_SCHEMAS 完整性** | 补齐两条断言：键集合与 9 个已登记事件一一对应（删一条会红）、每一项都是可 `safeParse` 的 schema。另加**真实事件集成校验**：跑一整夜，把产出的每条事件按 `event.type` 取对应 schema 校验 payload——原来只测 schema 本体，删掉登记项照样全绿 |
| **N7 名不副实** | 原来的「不存在座位」测试实际验的是重复出局，已改名；另补一条真正覆盖 `src/engine/apply.ts` 座位查找分支的用例（直接对空状态 `applyEvent`） |
| **死代码** | `deathCauseOf` 在 N5 之后只剩测试调用、`NIGHT_PHASE_EVENTS` 从未被使用，两者都删掉（连带删掉 `deathCauseOf` 的测试） |
| **文档同步** | README 的用例数与覆盖率、TEST-STRATEGY 的版本引用、本文档 §9 的 N8 不实声明，全部改正 |

### 10.3 本轮验证输出

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → exit 0
$ pnpm build        → exit 0
$ pnpm test         → Test Files 37 passed (37) · Tests 295 passed (295)  exit 0
$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 98.15 | % Branch 96.63 | % Funcs 100 | % Lines 98.02
```

### 10.4 教训（写给下一个人）

Round 1 我修了「夜间相位可见性」，但只改了**我先想到的那一处**，没做全局搜索；新测试又只断言了 helper 的规则，于是「修了一半」被两层掩盖：代码漏一处、测试也不覆盖那一处。

**以后的纪律**：换一条语义（例如「所有相位草稿走同一个函数」）之后，先 `grep` 该语义的所有产出点，再写一条走**真实路径**的测试，最后用反向探针确认它会红。

---

## 11. Round 3 评审回应（Changes requested → 本轮修复）

Round 3 的结论是 **Changes requested / High**，只有一个阻塞项，但它是**规则层的缺口**，不是代码 bug。

### 11.1 唯一阻塞：C-27 · 同时满足两阵营胜利条件

**场景**（完全合法）：场上只剩 1 名神、若干村民、1 只狼。那一夜 wolf 刀最后一名神，witch 毒最后一只狼。同一批死亡后：

- wolf 侧胜利条件成立（屠边达成）；
- 好人侧胜利条件成立（wolf 全部出局）。

`checkWin` 当时**先判「wolf 是否全灭」**，于是静默判好人胜。

**为什么这是阻塞**：`RULES.md` §6 没有这条裁决，`RFCS.md` 的 C-6 只论证过「猎人开枪」那一种同时达成（且结论是它不可能发生），**没有覆盖「同一批死亡」**。按 `ARCH-11`，未裁决的分支必须抛错，不许默认选一个 —— 而它默认选了。

**处理**：
1. 走 `/manage-changes`（[`changes/CHANGE-REQUEST-006.md`](../changes/CHANGE-REQUEST-006.md)）→ **RUL-12「狼刀在先」**：夜间同时满足时**判 wolf 胜**。依据是真实规则（[百度百科·女巫](https://baike.baidu.com/item/%E5%A5%B3%E5%B7%AB/20587689)、[知乎·结算问题](https://zhuanlan.zhihu.com/p/625739586)），不是实现便利。
2. `checkWin` 的判定次序反过来：**先算 wolf 侧条件**，再算「wolf 是否灭绝」。
3. `RUL-1` 与判定时机**不变**：仍是一批死亡后判一次。RUL-12 **不是**「技能顺序在先」。

**我在这一步差点搞错**：初稿的 CR 推荐「好人胜」，理由写得挺顺（狼全灭即失败、界面好解释）——那是从直觉推的。你要求先查真实规则，查完发现**推荐反了**，真实规则判 wolf 胜。教训记进 §11.4。

**验证**：`win.test.ts` 直接构造三种同时达成（屠边的神/民、屠城）断言 wolf 胜；`death-resolve.test.ts` 走**真实夜间路径**（残局 + `WOLF_KILL` + `WITCH_ACT(poison)`）断言 `GAME_ENDED { result: 'wolf' }`。反向探针：把次序改回「先判 wolf 全灭」→ 4 条用例变红。

### 11.2 顺带核对的一条真实规则（用户提问引出）

你问「女巫被刀之后、且她是最后一神，能不能开毒」。查证结论：**能**。

- [狼人杀规则站](https://langrensha.net/strategy/2023041701.html)：女巫被 wolf 刀了还能用毒，因为**她的死亡是在白天宣布的，夜间仍可行动**。
- [另一篇](https://www.langrensha.net/strategy/2022060801.html)：**白天出局**（被放逐 / 被 hunter 带走）才不能用毒。

本 RFC 的实现正好如此：死亡在 `NIGHT_RESOLVE` 才应用，witch 在 `NIGHT_WITCH` 行动时仍存活；她在更早的夜晚或白天出局后，`findAliveByRole` 会跳过 `NIGHT_WITCH` 阶段。**无需改动**，但这条行为从此有出处，不是「碰巧如此」。

### 11.3 非阻塞项

| # | 处理 |
|---|---|
| **C-28**（阻塞 RFC-007） | 不在本 RFC 的代码范围。已修正 §9.1 里「玩家端从 `state.phase` 看到天黑」的说法——`phase` 的取值本身会漏出夜间子阶段，所以投影必须把它折叠成两态。留给 RFC-007，`TEST-STRATEGY` 有对应计划行 |
| **B3 真实事件覆盖** | `events.test.ts` 新增「枪夜」与「终局夜」两段：`HUNTER_SHOOT` / `PLAYER_DIED(cause=shoot)` / `GAME_ENDED` 的 payload 现在由**真实事件**驱动校验，不再只有手写 fixture |
| **AC-6 / AC-15 断言补强** | AC-6 增「查好人得 `not-wolf`」+ 断言状态里没有承载查验结果的字段；AC-15 增「毒药夜 / 开枪夜的效果集、死亡集与 `PLAYER_DIED` 事件集三者一致」 |
| **测试名与注释** | `night-visibility.test.ts` 的「公开事件数为 0」改名（实际是泄漏检查）；`replay.test.ts` 的 `NIGHT_VOTES`（不是 14 个阶段之一）改为 `NIGHT_WITCH`；`RULES.md` 版本头补「最后更新」 |
| **C-25** | F1 / F3 / F8 的功能映射仍待 `/manage-changes`；非阻塞 |

### 11.4 教训

C-27 让我发现自己的一个坏习惯：**遇到规则问题先想「怎么实现最省事」，再给它编一个说得通的理由**。CR-006 初稿推荐「好人胜」就是产物——理由三条都很顺，但没有一条来自真实规则。

以后遇到规则缺口的顺序应当是：**先查真实规则 → 再问用户 → 最后才考虑实现成本**。查证发现业界已有定论时，实现成本不再是理由。

### 11.5 本轮验证输出

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → exit 0
$ pnpm build        → exit 0
$ pnpm test         → Test Files 37 passed (37) · Tests 307 passed (307)  exit 0
$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 98.14 | % Branch 96.66 | % Funcs 100 | % Lines 98.00
```

### 8.9 Spec changed（CHANGE-REQUEST-011 / RFC-017）

**狼队击杀改为狼队投票**（RUL-13）：`NIGHT_WOLVES` 现在接受 `WOLF_VOTE`（每名存活狼一票），
新增 `WOLF_VOTE_CAST` / `WOLF_VOTE_REVEALED` 事件与 `NIGHT_WOLF_RUNOFF` 相位；`WOLF_KILL`
保持兼容但不再是产品流程。相关契约（动作表、相位表、事件流）由 RFC-017 重新定义。
