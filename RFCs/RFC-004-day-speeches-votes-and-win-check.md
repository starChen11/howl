# RFC-004 · 白天发言、投票与胜负判定

**Features**: F4, F5, F6
**Depends on**: RFC-003
**Rules**: ARCH-5, ARCH-6, ARCH-11, DATA-2, DATA-4, RUL-1, RUL-2, RUL-9, RUL-10
**Complexity**: Medium
> 关联需求：FR-5、FR-6、FR-7

---

## 1. 摘要

补齐一局剩下的三个环节：**白天轮流发言**、**放逐投票（含平票重投与猎人开枪）**、**胜负判定**。交付后，引擎可以在没有 AI、没有界面的情况下**完整跑完一局**——项目的第一个真里程碑。

## 2. 技术方案

### 2.1 白天的开始

夜晚结算完成后进入 `DAY_ANNOUNCE`，它做三件事并立即产出 `DAY_STARTED` 事件：

```ts
type DayStartedPayload = {
  day: number;
  diedLastNight: SeatId[];       // 按死亡结算顺序
  speechStartSeat: SeatId;       // 发言起点，见下
};
```

**发言起点的确定性**（这是冷读抓到的坑）：`speechStart` 若临时抽随机数，就破坏了「纯函数」与「可重放」。做法是**在进入 `DAY_ANNOUNCE` 时抽一次**，结果写进 `DAY_STARTED.payload.speechStartSeat`；之后所有阶段只读该字段。

规则：若 `diedLastNight` 非空，取其中**结算顺序第一位**的下一位存活席位；若为空，用 `state.rng` 在存活席位中抽一个（抽取结果写入 payload）。

「下一位」若恰好是死者，继续顺时针跳过，直到遇到存活席位。

### 2.2 白天发言

- 阶段 `DAY_SPEECH`，cursor 记录下一位该发言的席位。
- 允许 action：`SPEECH`（带 `text`）、`SPEECH_SKIP`。
- 全部存活者说完（或跳过）→ 进入 `DAY_VOTE`。
- 发言顺序为单一顺时针循环，不重复、不跳过存活席位。

### 2.3 投票

- 阶段 `DAY_VOTE`，所有存活玩家提交 `VOTE`。
- **每张票以私有事件记录**：`VOTE_CAST`（`visibleTo: 'self:<seat>'`，payload `{ target }`）。这样既保住投票保密，又能被 `replay` 重建。
- 全部提交后进入 `DAY_VOTE_RESOLVE`，产出一条公开的 `VOTE_REVEALED` 事件（payload 为完整票型），随后：

| 结果 | 处理 |
|---|---|
| 唯一最高票 | 该玩家进入 `DAY_LYNCH` |
| 并列最高票 | 进入 `DAY_VOTE_RUNOFF`，选项集 = 并列者 + `'abstain'`（RUL-2） |
| 全员弃权（有效票为 0） | 无人出局，直接进入下一夜（计一次 stalemate） |
| 重投仍并列 | 无人出局，直接进入下一夜（RUL-9，计一次 stalemate） |

### 2.4 放逐与开枪

`DAY_LYNCH`：被放逐者出局，产出 `PLAYER_DIED`（`cause: 'lynch'`）。

若出局者是猎人 → 进入 `DAY_HUNTER_SHOOT`，允许 `HUNTER_SHOOT`（可放弃）。**开枪结算完成后才进行胜负判定**（RUL-1）。

### 2.5 胜负判定

判定点在**每个结算点完成、所有技能效果应用完毕后**，执行一次，进入 `WIN_CHECK`：

| 模式 | 狼人胜 | 好人胜 |
|---|---|---|
| `slaughter-side`（默认） | 神全部出局，或民全部出局 | 狼人**全部**出局（死因任意） |
| `slaughter-all` | 好人全部出局 | 狼人全部出局 |

判定后进入 `FINISHED`，记录 `result: 'wolf' | 'good' | 'draw'`。`FINISHED` 后任何 action 产出 `Rejected`（`code: 'PHASE_MISMATCH'`）。

### 2.6 平局兜底

连续 **3** 个白天「本夜无死亡 且 当日无人出局」→ `result: 'draw'`，进入 `FINISHED`（RUL-10）。计数 `state.stalemateDays`：满足条件时 +1，否则清零；只在白天结束时更新。

### 2.7 同时达成（本 RFC 新增裁决）

存在两阵营同时满足条件的局面，最典型的是「猎人开枪带走最后一只狼，而猎人自己就是最后一个神」。RULES §6 未覆盖此情形。

本 RFC 的裁决：**同时达成 → `result: 'draw'`（同归于尽）**，并在复盘标注「同归于尽」。

理由：RUL-1 只规定「技能结算先于胜负判定」，没有规定谁优先；给任一方优先都会在「最后一换一」时显得任意。平局是对称的，且与 RUL-10 已有的 `draw` 概念一致。

**这条裁决必须回写 `RULES.md` §6**（走 `/manage-changes`），已记入 `RFCS.md` 的 Open conflicts。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/phases/day.ts` | `DAY_ANNOUNCE` / `DAY_SPEECH` 与 cursor |
| `src/engine/phases/vote.ts` | 投票、结算、重投 |
| `src/engine/phases/lynch.ts` | 放逐与猎人开枪 |
| `src/engine/win.ts` | 双模式判定、同时达成、平局兜底 |
| `tests/engine/day.test.ts` | 发言顺序 |
| `tests/engine/vote.test.ts` | 投票与平票 |
| `tests/engine/win.test.ts` | 胜负与平局 |
| `tests/engine/full-game.test.ts` | 无 AI 全流程 |

## 4. 实现要点

- `speechStart` 的随机抽取只发生在 `DAY_ANNOUNCE` 入口，结果进事件 payload；`speechStart(state)` 是读字段的纯函数。
- 票箱从 `VOTE_CAST` 事件推导，不在 `state` 里另存一份可变 Map（ARCH-3 禁止 `Map`）。
- `stalemateDays` 的更新集中在 `WIN_CHECK` 一处，避免多处 +1 导致误判。
- `FINISHED` 后所有 action 走 `Rejected`（`PHASE_MISMATCH`），不是抛错——这是合法但无效的提交。

## 5. 验收标准

1. 发言顺序是单一顺时针循环：每轮恰好遍历所有存活席位一次，无重复、无遗漏
2. 首日有死者时，`DAY_STARTED.speechStartSeat` 等于「结算顺序第一位死者的下一位存活席位」
3. 当日无死者时，`speechStartSeat` 由 `state.rng` 决定，并记录在 `DAY_STARTED` payload 中；同 `seed` 两次运行该字段相同
4. 起点席位恰好是死者时，起点继续顺时针推进到下一个存活席位
5. 已出局玩家不出现在发言队列中
6. 每张票以 `VOTE_CAST` 事件记录，其 `visibleTo === 'self:<投票者>'`；投票阶段结束前，任意观察者的投影中不含他人票型
7. 投票结算后产出一条 `VOTE_REVEALED` 公开事件，含全部投票者与其选择（弃权者标注为 `abstain`）
8. 唯一最高票者出局，产出 `PLAYER_DIED` 且 `cause === 'lynch'`
9. 出现并列最高票时进入重投，选项集恰为「并列者 + abstain」；重投仍并列时当日无人出局，`phase` 推进到下一夜
11. 全员弃权（有效票 0）时当日无人出局，`phase` 推进到下一夜
12. 屠边模式：神全灭 → 狼胜；民全灭 → 狼胜；狼全灭 → 好人胜（三种局面各一条用例，狼的死因分别为夜间被杀、被毒、被放逐）
13. 屠城模式：好人全灭 → 狼胜；狼全灭 → 好人胜
14. 技能先于判定：构造「猎人被放逐并开枪带走最后一狼，且猎人就是最后一个神」，断言 `result === 'draw'`（§2.7）
15. 胜负只判定一次：进入 `FINISHED` 后再提交 action 产出 `Rejected`（`code === 'PHASE_MISMATCH'`），除 `seq` 外状态不变
16. 连续 3 个白天「本夜无死亡且当日无人出局」时 `result === 'draw'` 并进入 `FINISHED`；中间任一天打破条件则 `stalemateDays` 归零
17. 用预置的无 AI 脚本（固定种子，逐步指定各席位动作）能把一整局跑到 `FINISHED`，且事件流 `replay` 出同一终局

## 6. 边界与测试

- **不做**：狼人自曝（RFC-005）、AI 决策（RFC-006 起）、界面（RFC-011 起）。
- **复用的既有能力**：夜晚与死亡结算来自 RFC-003；效果管道与重放来自 RFC-002。
- **测试**：胜负用参数化小局面；平票用构造票型；全流程用固定种子 + 预置动作序列（不用随机），保证可复现。
- **实现者选择**：票箱的数据结构形态、事件命名细节、参数化用例的排布。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-004-1 | 重投时非并列者能否投票 | **(assumption)** 能；选项集只限制被投目标，不限制投票人 |
| Q-004-2 | 平局是否计入任何一方胜场 | **(assumption)** 不计；复盘显示为平局 |
| Q-004-3 | 猎人被自曝夜里的刀杀死能否开枪 | **(assumption)** 能；只有「被毒杀」与「被放逐时放弃」两种例外 |
| Q-004-4 | §2.7 的「同时达成判平局」是否被接受 | **(pending)** 需用户确认并回写 RULES.md §6 |
