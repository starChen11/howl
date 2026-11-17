# 变更请求 003 · 统一 `GameEventMap` 的三个 payload 形状

> 提出日期：2026-11-17
> 提出人：RFC-001 Round 2 评审（阻塞项 B1，登记为 `RFCS.md` C-17）
> 评估基线：`RFCs/RFC-001`（`GameEventMap`）、`RFC-002` §2.3、`RFC-004` §2.3、`RFC-006` §2.2、`RFC-007` §2.5、`RFC-009` §2.2 / §2.3、`RFC-014` §2.3
> 决策状态：**3 项全部由用户裁决并落地**（2026-11-17）

---

## 0. 总体判断

这不是需求变化。PRD 的 FR / NFR、FEATURES 的功能项、RULES 的规则，**一条都不用改**——三处冲突全部发生在「同一个数据长什么样」这一层，属于 RFC 之间的契约对齐。

但它**必须走变更流程**，理由有两条：

1. RFC-001 §2.3 明文规定「各 RFC 只增加成员、**不得改写既有成员的 payload**」。也就是说下游 RFC 无权自己修，只能在开工时撞墙或绕开（绕开就是第二个形状，正是现在的状况）。
2. RFC-001 的交付物就是这 17 个事件的共享形状。一个能被 16 条验收标准全部通过、却支撑不了 RFC-002 实现的契约，是验收标准的盲区，不是通过。

**根因**：RFC-001 的 `GameEventMap` 是凭空一次写出来的，其中三个 payload 从未与写它们的 RFC 对过表。`claim?: unknown` 是最直接的证据——写的时候就没想清楚，用 `unknown` 把问题推给了下游。

---

## 1. 变更分类

| ID | 变更 | 类型 | 规模 | 影响层级 |
|---|---|---|---|---|
| **C1** | `REJECTED.actionType`：`string` → `Action['type']` | 契约收窄 | Small | RFC-001、RFC-002（无需改） |
| **C2** | `VOTE_CAST` 保留 `{ seat, target }`，改 RFC-004 的 `{ target }` 简写 | 契约澄清 | Small | RFC-004 |
| **C3** | `AI_THOUGHT` 统一为**嵌套** `claim: { role?, checks?, accuses? }` | 契约统一 | Large | RFC-001、RFC-007、RFC-009、RFC-014 |

优先级：全部 **Must have**——它们卡住 RFC-002 的开工（`RFCS.md` 关键路径 `001 → 002`）。

---

## 2. 逐项说明

### C1 · `REJECTED.actionType`

| 来源 | 写法 |
|---|---|
| RFC-001 `GameEventMap` | `actionType: string` |
| RFC-002 §2.3 `RejectedPayload` | `actionType: Action['type']` |

RFC-002 的更严也更对：`Action` 的 10 个 `type` 本来就是封闭联合，`DATA-2`「事件类型必须是联合成员，不得使用裸字符串」的同一精神适用于它的载荷。RFC-001 的 `string` 允许 `actionType: 'NOT_AN_ACTION'` 编译通过。

**裁决：按 RFC-002 收窄。** 下游零改动，RFC-001 改一行类型。

### C2 · `VOTE_CAST`

| 来源 | 写法 |
|---|---|
| RFC-001 `GameEventMap` | `{ seat: SeatId; target: SeatId \| 'abstain' }` |
| RFC-004 §2.3 | `payload { target }`（投票者只由 `visibleTo: 'self:<seat>'` 隐含） |

RFC-004 的简写有实际风险：`replay` 重建票型时**没有观察者**，只能从 `visibleTo` 字符串里反解投票者；而 `visibleTo` 是可见性字段，不是数据字段，用它承载「谁投的票」属于语义复用。同一个 RFC 的 `VOTE_REVEALED` 已经用 `votes: { seat, target }[]`，两张票型不一致没有理由。

**裁决：保留 RFC-001 的 `{ seat, target }`，把 RFC-004 的简写改成完整形状。** 下游只改一行文档，代码零改动。

### C3 · `AI_THOUGHT`（三种形状，最严重）

| 来源 | 写法 |
|---|---|
| RFC-001 | `{ reason: string; claim?: unknown; decisionSeq: number }` |
| RFC-006 §2.2 `DecisionSchema` | 嵌套 `claim: { role?, checks?, accuses? }`（`.optional()`） |
| RFC-007 §2.5 | 顶层 `{ reason, claimedRole?, claimedChecks?, accuses?, decisionSeq }` |
| RFC-009 §2.2 / §2.3 | 顶层 `claimedRole` / `claimedChecks` / `accuses`（并称「扩展 RFC-007 的 DecisionSchema」） |
| RFC-014 §2.3 `ThoughtEntry` | 顶层 `claimedRole?: string` |

RFC-001 的 `claim?: unknown` 是**第三种**形状：既不是 RFC-006 的嵌套，也不是 RFC-007 的顶层。三种并存时，下一个实现者必须先猜哪个权威。

附带两处引用漂移，一并修正：

- RFC-009 §2.2 写「RFC-**007** 的 `DecisionSchema`」，实际定义在 RFC-**006** §2.2；
- RFC-006 用 `accuses[].as`，RFC-009 用 `accuses[].asRole`。

**两个候选**：

| 方案 | 形状 | 要改 |
|---|---|---|
| **C3-a 嵌套（推荐）** | `{ reason, claim?: { role?, checks?, accuses? }, decisionSeq }` | RFC-001（把 `claim?: unknown` 收紧，字段名不变）、RFC-007 §2.5、RFC-009 §2.2/§2.3/§2.5、RFC-014 §2.3 |
| C3-b 顶层摊平 | `{ reason, claimedRole?, claimedChecks?, accuses?, decisionSeq }` | RFC-001（重命名三个字段）、RFC-006 §2.2（改成顶层）、RFC-014 的字段名 |

**推荐 C3-a**，三条理由：

1. **归属**：`role` / `checks` / `accuses` 是同一个东西——「这次发言对外声称了什么」。它们在 RFC-006 里是一个可选对象，摊到事件层就变成三个互不相干的字段，「三者是否同时出现」失去结构约束。将来加 `claimedSaves` 一类字段，嵌套只动一处。
2. **不引入转换层**：RFC-006 是这些字段的产出方。嵌套时，模型输出 → 事件是直通；摊平时要写一层扁平化，而这层转换一旦写错就是「复盘显示的声称」与「模型实际声称」不一致——正是 AI-5 要防的那类漂移。
3. **改动面反而更小**：RFC-001 只需把 `claim?: unknown` 收紧成 `claim?: Claim`，字段名不变；RFC-007/009/014 全是 `Not started`，改的是文档里的字段路径，没有代码可改。

**代价（如实记录）**：C3-a 要改 4 个 RFC 的字段路径，C3-b 要改 2 个。这是为「消灭第三种形状 + 避免转换层」付的价。

---

## 3. 冲突检查

### 3.1 与 RULES.md

| 规则 | 结论 |
|---|---|
| **DATA-2** 事件类型必须是联合成员，不得使用裸字符串 | C1 是**落实** DATA-2（`actionType: string` 是裸字符串）；C3 把 `unknown` 换成结构化类型，同向 |
| **AI-5** 复盘只能读结构化载荷的 `reason` | 三案都保留 `reason`；C3 让 `claim` 也变成结构化载荷而非 `unknown`，不违背反而加强 |
| **API-1** 共享类型必须定义在 `src/shared/` 并由 Zod 校验 | C1/C3 都在 `src/shared/events.ts` 内解决；`Claim` 的 Zod schema 按 C-10 由 RFC-006 追加 |
| **ARCH-2** `shared` 只放类型与纯常量 | `Claim` 是纯类型，无运行时逻辑，不新增例外 |
| **SEC-5 / AI-8** 投影不得泄漏 AI 私有信息 | `AI_THOUGHT` 仍是 `visibleTo: 'self:<seat>'`，形状变化不影响可见性 |

**无违反。**

### 3.2 与 PRD / FEATURES / 既有决策

- PRD **FR-16**（悍跳 / 狼查杀狼 / 自曝的验收判据）依赖「结构化字段」存在，不依赖它们的嵌套方式 → 无影响。
- PRD **D17**（AI 严格视野）与 **D36**（全思考模式）无关。
- **C-10**（`schemas.ts` 只做信封 + `ActionSchema`）不受影响：本 CR 只改类型，payload 的 Zod schema 仍归各自 RFC。
- **C-15**（事件 type 绑定）不受影响。
- **RUL-1 ~ RUL-10** 无一条涉及事件载荷形状。
- 既有的 **CR-001 / CR-002** 与本 CR 无重叠，不推翻任何已接受的决策。

**无撤销的决策。**

### 3.3 与 `RFCS.md` 的登记

`RFCS.md` 的 **C-17** 已由 Round 2 评审登记，本 CR 是它的裁决过程。裁决后 C-17 要改成「已解决 + 采用了哪种形状」。**C-17 不能直接删掉**——它是「为什么当年有三种形状」的记录。

---

## 4. 落地清单（按裁决结果执行，一次提交内完成）

| # | 文件 | 改动 | 依赖 |
|---|---|---|---|
| 1 | `src/shared/events.ts` | `REJECTED.actionType` → `Action['type']`；新增 `Claim` / `ClaimedCheck` / `ClaimedAccusation` 类型；`AI_THOUGHT.claim` → `claim?: Claim` | C1、C3-a |
| 2 | `RFCs/RFC-001` §2.3 `GameEventMap` | 同步上面三处；补一句「payload 形状的权威来源是拥有该事件的 RFC」 | C1、C3-a |
| 3 | `RFCs/RFC-002` §2.3 | **无需改**（C1 采纳它的写法）；补一句「与 RFC-001 的 `GameEventMap` 一致」 | C1 |
| 4 | `RFCs/RFC-004` §2.3 | `payload { target }` → `{ seat, target }` | C2 |
| 5 | `RFCs/RFC-006` §2.2 | 无需改形状；补一句「`claim` 原样进入 `AI_THOUGHT`，不做扁平化」 | C3-a |
| 6 | `RFCs/RFC-007` §2.5 | payload 改成 `{ reason, claim?, decisionSeq }` | C3-a |
| 7 | `RFCs/RFC-009` §2.2 / §2.3 / §2.5 | 字段路径改成 `claim.role` / `claim.checks` / `claim.accuses`；订正「RFC-007 的 DecisionSchema」→ RFC-006；`asRole` → `as` | C3-a |
| 8 | `RFCs/RFC-014` §2.3 | `ThoughtEntry.claimedRole` → 取自 `claim.role` | C3-a |
| 9 | `tests/shared/` | 三个 payload 的正负夹具（`REJECTED` 非法 actionType 编译失败；`AI_THOUGHT` 按嵌套形状构造；`VOTE_CAST` 必带 seat） | 全部 |
| 10 | `RFCS.md` | C-17 标记已解决并写明采用形状；版本与变更历史 | 全部 |
| 11 | `TEST-STRATEGY.md` | RFC-001 小节记一行「payload 形状对齐（CR-003）」 | 全部 |
| 12 | `changes/CHANGE-REQUEST-003.md` | 记录用户裁决 | 全部 |

RFC 状态：RFC-001 当前 `Changes requested`，改完回 `Implemented`。RFC-002/004/006/007/009/014 全部 `Not started`，**不需要置 `Spec changed`**（那是给 `Implemented` / `Reviewed` 用的）。

---

## 5. 风险评估

| 风险 | 影响 | 缓解 |
|---|---|---|
| C3-a 改了 4 个 RFC 的字段路径，将来实现时有人照着旧记忆写 | 编译失败或运行时字段缺失 | 类型是唯一权威；RFC-001 的 `GameEventMap` 与测试夹具同时改，Round 3 会复跑三种形状的探针 |
| 现在就定形状，可能仍然不是最终形态 | 下游返工 | 三个形状的分歧点已经收敛到「嵌套 vs 摊平」；`claim` 内容（role / checks / accuses）四个 RFC 无争议 |
| 裁决拖到 RFC-002 之后 | 成本从「改类型」变成「改引擎 + 改事件流 + 改重放」 | 本 CR 在 RFC-002 开工前完成 |

**不做的风险**：RFC-002 开工时 `REJECTED.actionType` 只能写 `string`，等于 DATA-2 少守一处；`AI_THOUGHT` 的三种形状会让 RFC-009 的判定与 RFC-014 的复盘各自猜一种，而它们是同一个数据的读方。

---

## 6. 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 保持三个形状，由下游 RFC 各自适配 | RFC-001 §2.3 明文禁止下游改写既有 payload；适配层会把同一个概念复制成 2–3 份，改一处漏两处 |
| `AI_THOUGHT.claim` 保持 `unknown` | 这正是「把问题推给下游」的写法。`unknown` 让复盘侧无法在编译期知道该读什么，AI-5 的结构化要求也随之失去约束 |
| 把三个 payload 都推到各自的 RFC 里定义 | `GameEventMap` 是 16 个 RFC 共用的唯一形状来源；推到各处等于取消 RFC-001 的这项交付物 |
| C3-b 摊平全部字段 | 需要给 RFC-006 加一层扁平化转换，且「三个声称字段是否同时出现」失去结构约束。若用户偏好扁平以对齐 RFC-007/009/014 的现有写法，本表这一条即改为采纳 C3-b |

---

## 7. 待确认

| ID | 变更 | Decision |
|---|---|---|
| **C1** | `REJECTED.actionType` 收窄为 `Action['type']`（按 RFC-002） | **接受** |
| **C2** | `VOTE_CAST` 保留 `{ seat, target }`，改 RFC-004 的 `{ target }` | **接受** |
| **C3** | `AI_THOUGHT` 用嵌套 `claim`（C3-a）而非顶层摊平（C3-b） | **接受 C3-a** |

用户对三项均采纳推荐方案，C3 选嵌套。理由记录在 §2 与 §6，不再重开。

### 7.1 落地结果

| # | 文件 | 状态 |
|---|---|---|
| 1 | `src/shared/events.ts` | 已改：`REJECTED.actionType` → `Action['type']`；新增 `Claim` / `ClaimedCheck` / `ClaimedAccusation`；`AI_THOUGHT.claim` → `claim?: Claim` |
| 2 | `RFCs/RFC-001` §2.3 | 已改：同步三处，并补「payload 形状的权威来源是拥有该事件的 RFC」 |
| 3 | `RFCs/RFC-002` §2.3 | 已加注：采纳本节写法，两边一致 |
| 4 | `RFCs/RFC-004` §2.3 | 已改：`{ target }` → `{ seat, target }`，写明为什么必须带 `seat` |
| 5 | `RFCs/RFC-006` §2.2 | 已加注：`claim` 原样带入、不做扁平化 |
| 6 | `RFCs/RFC-007` §2.5 | 已改：payload 改为 `{ reason, claim?, decisionSeq }` |
| 7 | `RFCs/RFC-009` §2.2/§2.3/§2.5 | 已改：字段路径改嵌套；订正「RFC-007 的 DecisionSchema」→ RFC-006；`asRole` → `as` |
| 8 | `RFCs/RFC-014` §2.3 | 已改：`ThoughtEntry.claim?: Claim` |
| 9 | `tests/shared/events.test.ts` | 已加：三个 payload 的正负夹具（非法 actionType / 缺 seat / 顶层 claimedRole 都编译失败） |
| 10 | `RFCS.md` | C-17 标记已解决并写明采用形状 |
| 11 | `TEST-STRATEGY.md` | RFC-001 小节记 CR-003 一行 |
| 12 | 本文件 | 裁决与落地记录 |

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-17 | v1.0 | 用户裁决：C1 / C2 / C3-a 全部接受；落地清单 12 项一次完成 |
| 2026-11-17 | v0.1 | 由 RFC-001 Round 2 评审的 B1 / C-17 发起；三项待裁决 |
