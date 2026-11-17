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
5. **猎人**：若出局方式是「被狼刀」则进入 `NIGHT_HUNTER_SHOOT`；若是「被毒杀」则**不进入**（FR-17）。
6. 全部出局结算完毕后，产出事件并进入 `DAY_ANNOUNCE`。

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
- 药水是否已用**从事件流推导**，不在 `state` 里加布尔位。
- `NIGHT_RESOLVE` 是自动推进的阶段：没有 action，进入时立即结算并离开。
- `DAY_ANNOUNCE` 阶段的处理实现在 RFC-004；本 RFC 的 `transitions.ts` 对它只登记「无允许 action」并在测试中预期抛 `UnhandledTransitionError`——这保证 RFC-003 独立可测，且不会静默放行。

## 5. 验收标准

1. 用 50 个固定种子各发一次牌，每次都恰好是 3 狼 / 1 预言家 / 1 女巫 / 1 猎人 / 3 村民
2. 同一 `seed` 两次发牌结果完全一致；`roles` 出现在 `GAME_STARTED` 事件的 payload 中
3. 50 个固定种子的样本里，玩家席位分别拿到过狼、神、民三类各至少 1 次
4. `WOLF_KILL` 提交后产出 `WOLF_KILL_CHOSEN` 事件，其 `visibleTo === 'wolves'`
5. `WOLF_KILL` 指向已出局席位时，产出 `Rejected` 事件且 `code === 'TARGET_NOT_ALIVE'`，状态除 `seq` 外不变
6. 同一轮内狼人指定狼人为目标时，产出 `Rejected` 事件且 `code === 'WOLF_KILL_WOLF'`
7. `SEER_CHECK` 后产出 `SEER_CHECKED` 事件，`visibleTo === 'seer'`，`result` 只取 `'wolf'` 或 `'not-wolf'` 且与目标真实阵营一致
8. `WITCH_ACT` 指定 `heal` 且 `target` 为女巫自己时，产出 `Rejected` 事件且 `code === 'WITCH_SELF_SAVE'`
9. 同一夜第二次提交 `WITCH_ACT`（无论哪种药）时，产出 `Rejected` 事件且 `code === 'NOT_YOUR_TURN'`（该阶段已结束）
10. 女巫用过的药在后续夜晚再次使用时，产出 `Rejected` 事件且 `code === 'POTION_ALREADY_USED'`（药水位由事件流推导）
11. `heal` 目标与狼刀目标相同时：当夜无人出局，事件流中不含任何 `PLAYER_DIED` 事件
12. `heal` 目标与狼刀目标不同时：狼刀目标出局、被救目标存活，两者各有一条 `PLAYER_DIED` 事件（仅出局者）
13. 刀杀的猎人出局后进入 `NIGHT_HUNTER_SHOOT`，提交 `HUNTER_SHOOT` 后产出带 `source: 'role'` 的效果
14. 毒杀的猎人出局后**不**进入 `NIGHT_HUNTER_SHOOT`：事件流中不含任何 `HUNTER_SHOOT` 事件
15. 夜晚结算产出的每条 `Effect` 的 `source` 均为 `'role'`；解药的 `order` 小于狼刀与毒药的 `order`，猎人开枪的 `order` 大于二者的 `order`（可据此断言 RUL-8 与 RUL-1 的时序）
16. 夜晚结束后 `phase === 'DAY_ANNOUNCE'`；此时对本 phase 提交任何 action 均抛 `UnhandledTransitionError`（RFC-004 尚未实现该阶段）

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
