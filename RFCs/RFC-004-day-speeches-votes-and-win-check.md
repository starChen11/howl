# RFC-004 · 白天发言、投票与胜负判定

**Features**: F4, F5, F6
**Depends on**: RFC-003
**Rules**: ARCH-5, ARCH-6, ARCH-11, DATA-2, DATA-4, RUL-1, RUL-2, RUL-9, RUL-10, RUL-12
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
  diedLastNight: SeatId[];       // **按座位升序**——公开的死讯不得携带死因顺序（C-31）
  speechStartSeat: SeatId;       // 发言起点，见下
};
```

**发言起点的确定性**（这是冷读抓到的坑）：`speechStart` 若临时抽随机数，就破坏了「纯函数」与「可重放」。做法是**在进入 `DAY_ANNOUNCE` 时抽一次**，结果写进 `DAY_STARTED.payload.speechStartSeat`；之后所有阶段只读该字段。

规则：若 `diedLastNight` 非空，取其中**座位最小的死者**的下一位存活席位；若为空，用 `state.rng` 在存活席位中抽一个（抽取结果写入 payload）。

**为什么不能按结算顺序**（C-31）：结算顺序固定是「狼刀先、毒药后」，而这条 payload 是公开的——顺序一公开，全场就能读出「第一位死者是被刀的、第二位是被毒的」，女巫用没用毒、解药还在不在，全都推得出来（`FR-9`）。真实牌桌按号码报死者，正是为了让人分不清死因；发言起点同理，不能挂在结算顺序上。

「下一位」若恰好是死者，继续顺时针跳过，直到遇到存活席位。

### 2.2 白天发言

- 阶段 `DAY_SPEECH`，cursor 记录下一位该发言的席位。
- 允许 action：`SPEECH`（带 `text`）、`SPEECH_SKIP`。
- 全部存活者说完（或跳过）→ 进入 `DAY_VOTE`。
- 发言顺序为单一顺时针循环，不重复、不跳过存活席位。

### 2.3 投票

- 阶段 `DAY_VOTE`，所有存活玩家提交 `VOTE`。
- **每张票以私有事件记录**：`VOTE_CAST`（`visibleTo: 'self:<seat>'`，payload `{ seat, target }`）。这样既保住投票保密，又能被 `replay` 重建。payload **必须显式带 `seat`**：`replay` 重建票型时没有观察者，从 `visibleTo` 字符串反解投票者等于拿可见性字段当数据用（CR-003 C2）；也与同节的 `VOTE_REVEALED.votes[]` 保持同一形状。
- 全部提交后在 `DAY_VOTE` 阶段内触发结算点 **`VOTE_RESOLVE`**（RFC-002 §2.4 的 `ResolutionPoint`，**不是** `Phase`——`Phase` 保持 RFC-001 AC-5 的 14 个），产出一条公开的 `VOTE_REVEALED` 事件（payload 为完整票型），随后：

| 结果 | 处理 |
|---|---|
| 唯一最高票 | 该玩家进入 `DAY_LYNCH` |
| 并列最高票 | 进入 `DAY_VOTE_RUNOFF`，选项集**仅为并列者本身**，不能弃权、不能投他人（RUL-2） |
| 全员弃权（有效票为 0） | 无人出局，直接进入下一夜 |
| 重投仍并列 | 无人出局，直接进入下一夜（RUL-9） |

### 2.4 放逐与开枪

`DAY_LYNCH`：被放逐者出局，产出 `PLAYER_DIED`（`cause: 'lynch'`）。

**先判胜负，再决定是否有开枪机会**（RUL-1）：

1. 应用放逐造成的死亡。
2. **第一次胜负判定**。若已分出胜负（例如他是最后一个神，屠边条件达成）→ 对局立即结束，**不进入开枪阶段**。
3. 未分出胜负且出局者是猎人 → 进入 `DAY_HUNTER_SHOOT`，允许 `HUNTER_SHOOT`（可放弃）。
4. 开枪结算完成后 → **第二次胜负判定**。

### 2.5 胜负判定

判定点是**两处**（RUL-1）：① 死亡结算完成后、死亡触发技能之前；② 死亡触发技能结算完成后。两处都进入 `WIN_CHECK`：

| 模式 | 狼人胜 | 好人胜 |
|---|---|---|
| `slaughter-side`（默认） | 神全部出局，或民全部出局 | 狼人**全部**出局（死因任意） |
| `slaughter-all` | 好人全部出局 | 狼人全部出局 |

判定后进入 `FINISHED`，记录 `result: 'wolf' | 'good'`（**无平局**）。`FINISHED` 后任何 action 产出 `Rejected`（`code: 'PHASE_MISMATCH'`）。

### 2.6 没有平局；同一批死亡可能同时达成，按 RUL-12 判 wolf 胜

按 RUL-1，狼胜条件成立的**瞬间**对局就结束，猎人没有开枪机会——这消除了**死亡触发技能**带来的同时达成。但**同一批夜间死亡**仍可能同时满足两阵营条件（最后一名神被刀 + 最后一只狼被毒），此时按 **RUL-12「狼刀在先」判 wolf 胜**（`CHANGE-REQUEST-006`）。

**本 RFC 的判定路径上不存在同时达成**：白天放逐不会清空好人侧，所以复用 `checkWin` 时结果唯一。RUL-12 只决定同时成立时判谁，**不改变判定时机**。原「同归于尽 → 平局」分支与「连续 N 天无进展 → 平局」兜底**均已移除**（RUL-10 已标 `[REMOVED]`）。

**终止性论证**（替代人为平局上限）：女巫解药全局限一次；用尽后每夜必有狼刀死亡。死亡单调累积，必然在某天达成某个屠边/屠城条件。因此对局必然终止，不需要人为上限。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/phases/day.ts` | `DAY_ANNOUNCE` / `DAY_SPEECH` 与 cursor |
| `src/engine/phases/vote.ts` | 投票、结算、重投 |
| `src/engine/phases/lynch.ts` | 放逐与猎人开枪 |
| `src/engine/win.ts` | 双模式判定（复用 RFC-002 的 `checkWin`）+ 两次判定的时机编排 |
| `tests/engine/day.test.ts` | 发言顺序 |
| `tests/engine/vote.test.ts` | 投票与平票 |
| `tests/engine/win.test.ts` | 胜负判定与两次判定的时序 |
| `tests/engine/full-game.test.ts` | 无 AI 全流程 |

## 4. 实现要点

- `speechStart` 的随机抽取只发生在 `DAY_ANNOUNCE` 入口，结果进事件 payload；`speechStart(state)` 是读字段的纯函数。
- 票箱从 `VOTE_CAST` 事件推导：可以作为派生字段存在 `state` 里，但**不得另存不可重建的副本**，且只能由 `applyEvent` 写（RFC-001 §2.3 的 C-18 规则）。`ARCH-3` 禁止的是 `Map`，普通数组不在此列。
- `FINISHED` 后所有 action 走 `Rejected`（`PHASE_MISMATCH`），不是抛错——这是合法但无效的提交。

## 5. 验收标准

1. 发言顺序是单一顺时针循环：每轮恰好遍历所有存活席位一次，无重复、无遗漏
2. 首日有死者时，`DAY_STARTED.speechStartSeat` 等于「**座位最小的死者**的下一位存活席位」
3. 当日无死者时，`speechStartSeat` 由 `state.rng` 决定并记录在 `DAY_STARTED` payload 中；同 `seed` 两次运行该字段相同
4. 起点席位恰好是死者时，起点继续顺时针推进到下一个存活席位；已出局玩家不出现在发言队列中
4b. **公开的 `DAY_STARTED` 不得泄漏死因**：两名死者时，`diedLastNight` 按座位升序，与「谁被刀、谁被毒」无关；两种死因顺序得到同一个 payload 顺序
5. 每张票以 `VOTE_CAST` 事件记录，`visibleTo === 'self:<投票者>'`；投票结算前任意观察者的投影中不含他人票型
6. 投票结算后产出一条 `VOTE_REVEALED` 公开事件，含全部投票者与其选择（首轮弃权者标注为 `abstain`）
7. 唯一最高票者出局，产出 `PLAYER_DIED` 且 `cause === 'lynch'`
8. 出现并列最高票时进入重投，重投的选项集**恰为并列者本身**：提交 `abstain` 或指向非并列者的票均产出 `Rejected`（`code === 'INVALID_RUNOFF_TARGET'`）
9. 重投仍并列时当日无人出局，`phase` 推进到下一夜；全员弃权（有效票 0）时同样当日无人出局并推进到下一夜
10. 屠边模式：神全灭 → 狼胜；民全灭 → 狼胜；狼全灭 → 好人胜（三种局面各一条用例，狼的死因分别为夜间被杀、被毒、被放逐）
11. 屠城模式：好人全灭 → 狼胜；狼全灭 → 好人胜
12. **胜负先于技能**：构造「猎人被刀且他正是最后一个神」的局面，断言对局在第一次胜负判定处结束为狼胜，事件流中**不含任何 `HUNTER_SHOOT` 事件**（RUL-1）
13. **技能后二次判定**：构造「猎人被刀、狼还剩 1 只、好人另有存活」，猎人开枪带走最后一狼后断言结果为好人胜（RUL-1 的第二次判定）
14. 不存在平局：对上述全部胜负用例断言 `result ∈ {'wolf','good'}`，且事件流中不出现 `'draw'`；`GameState` 中不存在 `stalemateDays` 字段
15. 进入 `FINISHED` 后再提交 action 产出 `Rejected`（`code === 'PHASE_MISMATCH'`），除 `seq` 外状态不变
16. 用预置的无 AI 脚本（固定种子，逐步指定各席位动作）能把一整局跑到 `FINISHED`，且事件流 `replay` 出同一终局

## 6. 边界与测试

- **不做**：狼人自曝（RFC-005）、AI 决策（RFC-006 起）、界面（RFC-011 起）。
- **复用的既有能力**：夜晚与死亡结算来自 RFC-003；效果管道与重放来自 RFC-002。
- **测试**：胜负用参数化小局面；平票用构造票型；全流程用固定种子 + 预置动作序列（不用随机），保证可复现。
- **实现者选择**：票箱的数据结构形态、事件命名细节、参数化用例的排布。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-004-1 | 重投时非并列者能否投票 | **(assumption)** 能；选项集只限制被投目标，不限制投票人 |
| Q-004-3 | 猎人被自曝夜里的刀杀死能否开枪 | **(assumption)** 能；只有「被毒杀」与「被放逐时放弃」两种例外 |
| Q-004-4 | ~~同时达成判平局~~ | **已关闭（结论不变：不判平局）**：夜间同批死亡同时达成时按 **RUL-12** 判 wolf 胜（`CHANGE-REQUEST-006`）；`draw` 分支与 RUL-10 均已移除（`CHANGE-REQUEST-002`） |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。分支 `main`（RFC-001/002/003 已合入）。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| `DAY_ANNOUNCE` 怎么驱动 | 选 **B 方案**：把「自动阶段」做成 `step` 的一等能力（用户裁决：选更对的方案） |
| AC-5 的「投影」 | 按 `isVisibleTo` 解释（投影归 RFC-007，本 RFC 不实现） |
| Q-004-1 | 保持假设：重投时**非并列者可以投票**（选项集只限制被投目标） |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 新增「自动阶段」机制：`step` 折叠完一条 action 的事件后，若当前阶段登记在 `AUTO_PHASE_ENTRIES` 里，就调用其 entry 产出并折叠事件，直到停在一个等待输入的位置（上限 8 次） | `NIGHT_RESOLVE` 与 `DAY_ANNOUNCE` 都没有 action 可提交。RFC-003 的解法是让前一个 handler 一次吐完后续事件，逻辑错位、还要把上一条 action 的参数手工传下去。B 方案把这件事正名，并顺手消掉了那个参数 |
| **D-2** | `DAY_LYNCH` 也是自动阶段：谁被放逐由 `VOTE_REVEALED` 折叠进 `state.lynched` | 放逐不需要玩家输入，和天亮同构 |
| **D-3** | 发言起点**只在 `DAY_STARTED` 入口抽一次**，结果写进 payload 与 `rngAfter`；`DAY_STARTED` 登记进 `RANDOM_CONSUMING_EVENTS` | 每次现抽就破坏「同 seed 同结果」与 `replay`。有死者时不抽，但 `rngAfter` 仍要带上——省略它 `replay` 会以为这次转移没动过生成器 |
| **D-4** | 票价：`votes` / `runoff` / `lynched` / `speech` 全部是**派生字段**，只由 `applyEvent` 写 | C-18：派生字段可以存在，但必须能完整重建。不存「判断结果」的副本 |
| **D-5** | 进入下一夜要发**两条** `PHASE_CHANGED`：先 `→NIGHT_WOLF_CHAT`（它负责 `day++`、清空 `night` 与 `pendingDeaths`），再 `→NIGHT_WOLVES` | 夜聊归 RFC-005。与 `START` 跳过夜聊的做法一致，同时保住那些清理逻辑只有一个入口 |
| **D-6** | 新增拒绝码 `ALREADY_VOTED`（同一轮重复投票）；`INVALID_RUNOFF_TARGET` 覆盖「弃权」与「投非并列者」两种 | RFC-004 没有拒绝码表（不像 RFC-003 §4），这两个由实现选定。`INVALID_RUNOFF_TARGET` 是 AC-8 明确要求的 |
| **D-7** | `PLAYER_DIED` 的可见性随场景：夜间 `server`（死因天亮才公布）、白天放逐与白天开枪 `public` | 这是 C-29 的 N9 提醒：夜间之所以不公开是因为天亮前没人该知道，白天放逐不适用 |
| **D-8** | 白天开枪的收尾是**入夜**，夜间开枪的收尾是**天亮** | 同一个 `HUNTER_SHOOT` handler 按 `state.phase` 分流 |

### 8.3 连带改动：RFC-003 → `Spec changed`

D-1 让 `DAY_ANNOUNCE` 不再停留。RFC-003 的 AC-16 断言「夜晚结束后 `phase === 'DAY_ANNOUNCE'`」因此不再成立——夜晚现在停在 `DAY_SPEECH`。

- RFC-003 §5 的 AC-16 与 §2.3 第 8 步已更新，并注明「由 RFC-004 取代」（§2.3 的补注晚了一轮才补上，见 C-34）；
- `tests/engine/{night,witch,death-resolve,night-visibility}.test.ts` 的四处相位断言随之改为 `DAY_SPEECH`；
- **被拒的 action 不触发自动推进**，因此 RFC-002 的 AC-8（除 `seq` 外状态不变）继续成立——这条有专门的用例守着。

### 8.4 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 引擎新增 | `src/engine/phases/auto.ts`（自动阶段契约）、`auto-table.ts`（登记表）、`day.ts`、`vote.ts`、`lynch.ts` |
| 引擎修改 | `step.ts`（自动阶段循环 + 并入白天 handler）、`apply.ts`（折叠 5 个事件、`DAY_STARTED` 计入随机消耗）、`transitions.ts`（填白天阶段）、`phases/night.ts`（夜间结算改为自动阶段的 entry；白天开枪收尾分流） |
| 共享修改 | `src/shared/domain.ts`（4 个派生字段）、`src/shared/schemas.ts`（`DAY_STARTED` schema + 登记） |
| 测试新增 | `tests/engine/{day,vote,lynch,full-game}.test.ts`；夹具 `tests/fixtures/day.ts` |
| 测试修改 | `tests/engine/{night,witch,death-resolve,night-visibility,transitions,replay}.test.ts`、`tests/shared/schemas.test.ts`（相位与键集合随 B 方案更新） |
| 文档 | 本文件 §8、`RFCs/RFC-003`、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.5 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `day.test.ts` · 按 `speechOrder` 逐个发言，每人恰好一次，结束后进 `DAY_VOTE` | PASS |
| 2 | `day.test.ts` · 起点 = **座位最小的死者**的下一位存活席位（`pendingDeaths` 两种顺序断言同一个结果） | PASS |
| 3 | 同上 · 无死者时同 seed 两次运行起点相同；6 个 seed 的起点不止一个值；`speechStartSeat` 与 `replay` 一致 | PASS |
| 4b | 同上 · 公开的 `diedLastNight` 按座位升序，且不等于「刀口 + 毒药」的结算顺序 | PASS |
| 4 | 同上 · 起点不是死者；已出局者不在序列里 | PASS |
| 5 | `vote.test.ts` · `VOTE_CAST.visibleTo === 'self:<seat>'`；最后一张票之前**没有任何公开事件** | PASS |
| 6 | 同上 · `VOTE_REVEALED` 覆盖全部存活席位，弃权标记为 `abstain` | PASS |
| 7 | 同上 · 唯一最高票出局，`PLAYER_DIED.cause === 'lynch'` | PASS |
| 8 | 同上 · 并列进重投、`runoff` 恰为并列者；投非并列者或弃权 → `INVALID_RUNOFF_TARGET` | PASS |
| 9 | 同上 · 重投仍并列 → 当日无人出局进下一夜；全员弃权同理 | PASS |
| 10 | `lynch.test.ts`「放逐最后一只 wolf → `GAME_ENDED(good / all-wolves-dead)`」+ `win.test.ts` 的屠边 / 屠城谓词用例 | PASS |
| 11 | 同上 · 屠城两条 | PASS |
| 12 | `lynch.test.ts` · 放逐最后一名神（hunter）→ 第一次判定即狼胜，事件流无 `HUNTER_SHOOT` | PASS |
| 13 | 同上 · 放逐 hunter 后开枪带走最后一狼 → 第二次判定好人胜；放弃开枪 → 入夜 | PASS |
| 14 | 同上 · 无 `draw`；`GameState` 无 `stalemateDays` | PASS |
| 15 | `full-game.test.ts` · 终局后提交 → `Rejected`（`PHASE_MISMATCH`），状态除 `seq` 外不变 | PASS |
| 16 | 同上 · 固定种子整局脚本从 `LOBBY` 到 `FINISHED`，`replay` 得同一终局 | PASS |

### 8.6 验证输出（实跑）

```
$ pnpm typecheck    → exit 0
$ pnpm lint         → exit 0
$ pnpm format:check → exit 0
$ pnpm build        → exit 0
$ pnpm test         → Test Files 41 passed (41) · Tests 337 passed (337)  exit 0
$ pnpm exec vitest run --project unit --coverage
  All files | % Stmts 96.42 | % Branch 92.85 | % Funcs 96.87 | % Lines 96.73
```

### 8.7 已知缺口（交给后续 RFC）

| 缺口 | 说明 | 归属 |
|---|---|---|
| `NIGHT_WOLF_CHAT` 仍被跳过 | 入夜时发两条相位事件直接到 `NIGHT_WOLVES`（D-5） | RFC-005 |
| AC-5 的「投影」措辞 | 本 RFC 用 `isVisibleTo` 表达，没有实现 `project()` | RFC-007 |
| 白天投票的可见性矩阵 | 只测了「结算前无公开事件」，没做 9 观察者 × 事件的矩阵 | RFC-007 |

---

## 9. Round 1 评审回应（Changes requested → 本轮修复）

Round 1 的结论是 **Changes requested / High**。**这是第一次用 subagent 跑评审**（全新上下文、`reasoning_effort: max`、输入只有仓库与 `REVIEW-PROMPT.md`）。它做了六条门禁实跑、10 条变异探针（并如实报告 3 条不红）、200 种子 fuzz，找到 2 个阻塞项 —— **都在 16 条 AC 的覆盖面之外**。

### 9.1 阻塞项

| 项 | 问题 | 处理 |
|---|---|---|
| **C-31** 死亡公告泄漏死因 | §2.1 规定 `diedLastNight` 按**结算顺序**，而结算顺序固定是「wolf 刀先、毒药后」，payload 又是公开的 —— 全场能读出「谁被刀、谁被毒」；`speechStartSeat` 挂在同一个顺序上，同一个泄漏走了两条路。违反 `FR-9`，也把 RFC-003 D-3 特意藏起来的死因漏了回去 | 用户裁决后走 `/manage-changes`（[`CHANGE-REQUEST-008`](../changes/CHANGE-REQUEST-008.md)）：**公告按座位升序**、发言起点取**座位最小的死者**的下一位存活者。两处都只依赖「谁死了」 |
| **B2** 4 个事件缺 schema | `SPEECH` / `SPEECH_SKIPPED` / `VOTE_CAST` / `VOTE_REVEALED` 没有 payload schema（只补了 `DAY_STARTED`） | `src/shared/schemas.ts` 补 4 个并登记；`schemas.test.ts` 的键集合同步 |

### 9.2 三条「测试不设防」

评审用变异探针指出三处：改坏实现后测试仍全绿。都已补，并**逐条用反向探针确认会红**：

| 缺口 | 补的用例 | 反向探针结果 |
|---|---|---|
| AC-1 的顺时针起点（忽略起点时 8/8 全绿） | 断言 `order[0] === startSeat` 且相邻项在存活环上相邻 | 把 `pivot` 固定成 `-1` → 该用例变红 ✓ |
| AC-3 的 rng（固定取最小座位时 19/19 全绿） | 6 个固定 seed 的起点必须出现多于一个值 | 把抽取固定成 `value: 0` → 变红 ✓ |
| AC-10 的「狼死于放逐」（跳过胜负判定仍 20/20 全绿） | 放逐最后一只 wolf → `GAME_ENDED(good / all-wolves-dead)` | 把 `checkWin` 结果固定成 `null` → 两条变红 ✓ |

### 9.3 未处理（非阻塞，登记在案）

| 项 | 说明 |
|---|---|
| **C-32** | `FEATURES.md` F5 AC-4 与 RUL-2 冲突（重投能否弃权）。已在 `CR-008` 同步为「不能弃权」 |
| **C-33** | F7 的效果插入点（`VOTE_RESOLVE` / `DEATH_RESOLVE` / `WIN_CHECK`）在真实结算里没有调用点，`step(..., [modifier])` 对真实 handler 无效。这是跨 RFC 的能力缺口，应开新 RFC 处理，不在本 RFC 范围内 |
| AC-14 的 `'draw'` 断言 | 类型层不可能成立，属无效断言；保留无害，但不应算作证据 |
| 能否投自己 / `AUTO_PHASE_LIMIT` 静默停止 / `pendingVoters` 死导出 | 记录在评审报告的非阻塞项里，留给后续清理 |

### 9.4 本轮验证输出

```
$ pnpm typecheck/lint/format:check/build → 全 0
$ pnpm test → Test Files 41 passed (41) · Tests 342 passed (342)
$ coverage → 行 96.75% / 分支 92.90%
```

### 9.5 Round 2 回应（Changes requested · Medium）

Round 2 复核了 Round 1 的修复，结论仍是 **Changes requested**，但只剩一项：

**C-31 的第二条路径（发言起点）回归测试是空断言。** 我原来的夹具取「存活非 wolf 的最小/最大座位」，而这一夜里两个候选的「下一位存活者」恰好都绕回 2 —— 于是「取最小」「取结算顺序」「取最大」三种实现得到同一个起点，`M2`（把起点改回 `deaths[0]`）与 `M3`（改成最大）都不会让测试变红。

修法：

- 夹具改为「wolf 刀一个村民、witch 毒一只 wolf」，保证 seer 与 witch 都活着、夜间流程走得完，且公告顺序与结算顺序**不同**（`diedLastNight` 不等于 `[kill, poison]`）；
- 起点规则改为对 `dayAnnounceEntry` 的**直接断言**：构造 `pendingDeaths: [7, 3]` 与 `[3, 7]` 两种顺序，要求 `speechStartSeat` 都是 4（若按结算顺序会是 8、若按最大死者的下一位会是 8）。
- 反向复验：M2 与 M3 各自都让这条用例变红。

同轮修掉的非阻塞项：`events.ts` / `domain.ts` / `apply.ts` / `deaths.ts` / `day.ts` 里「结算顺序」的过时注释；§8.5 的 AC-2 / AC-10 证据表；`PRD` FR-5 与 D34、`FEATURES` F4 AC-2 里的「首个死者」统一成「死者中座位最小者」；`TEST-STRATEGY` 补 AC-4b 行并同步版本引用；README 的进度描述。

**提交归属更正（Round 3 再次纠正）**：C-31 的**代码**修复（`src/engine/phases/day.ts` 的排序与最小死者起点）实际落在 `eeceb96`（`docs(process): 固化 subagent 评审的调用方式与等待策略`）——那次提交用了 `git add -A`，把当时工作树里的代码改动一并带了进去。`4693649` 只包含 `schemas.ts` 与测试文件。

这条写反了两次（先错指 `4693649`，再"更正"成同一个错误结论），根因是**用提交信息的内容去回忆提交内容**，而没有跑 `git show --name-only`。流程上的教训：涉及「改动在哪个提交」的断言，必须查 `git show`，不能凭记忆。

### 8.10 Spec changed（CHANGE-REQUEST-014 / RFC-020）

放逐首轮平票不再直接重投：并列者先做一轮 PK 发言，再重投；重投仍平票则入夜。

### CHANGE-REQUEST-016 / RFC-022

CHANGE-REQUEST-016 / RFC-022：白天发言顺序、放逐票权、警长竞选接入。
