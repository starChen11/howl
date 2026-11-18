# RFC-007 评审 · 上下文投影与注入隔离

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-18
> **分支 / HEAD**：`main` / `220a0de`（评审开始时 `git status --porcelain` 无输出）
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-18

**结论：Changes requested · Overall Risk Level: High**

三条阻塞：

1. **B1 · C-28 仍未裁决，投影原样输出夜间内部相位与当夜死亡**。`project()` 的 `phase` / `aliveSeats` / `deadSeats` 直接来自 `state`（`src/server/project/index.ts:57-60`）。实跑真实路径「狼刀 hunter → 查验 → 女巫 `none` → 进入 `NIGHT_HUNTER_SHOOT`」后，普通村民观察者的投影里 `phase === 'NIGHT_HUNTER_SHOOT'`、`deadSeats` 已含 hunter，而 `publicEvents` 中没有任何 `DAY_STARTED`。这正是 `RFCS.md` C-28 在 RFC-007 开工前要求裁决的泄漏，且 `TEST-STRATEGY.md:262` 计划的 `tests/server/project/night-visibility.test.ts` 在仓库里不存在。
2. **B2 · `AI_THOUGHT` 无法进入投影 / 重放，AC-15 实际不可满足**。RFC-007 §2.5 定义 `AI_THOUGHT` 进事件流，但 `applyEvent` 没有折叠它，`default` 抛 `UnknownEventError`（`src/engine/apply.ts:95-97`）；`project()` 对每条事件都先 `applyEvent`（`src/server/project/index.ts:35`），所以事件流里一出现 `AI_THOUGHT`，投影就抛错。临时探针实测：`project THREW: UnknownEventError ... AI_THOUGHT`。`tests/engine/replay.test.ts:288-301` 还把 `AI_THOUGHT` 当作「未实现事件」断言抛错，与 AC-15 直接冲突。
3. **B3 · 多条 Must 级 AC 没有能变红的测试**。AC-4 / AC-5 / AC-6 / AC-7 / AC-8 / AC-9 / AC-11 / AC-14 / AC-15 / AC-16 的断言要么缺失、要么是同义反复或只测弱方向。反向探针 M1~M5、M7 全部保持 23/23 绿（详见 §8），其中 M5 甚至把 `GAME_STARTED`（含全员 `roles`）塞进每个观察者的 `privateEvents`，23 条测试仍全绿。`TEST-STRATEGY.md:253-262` 把 1000 局面属性测试、C-28 夜间测试等计划行标成 `existing`，实际只有 `tests/server/project/project.test.ts` 与 `tests/server/inject/injection.test.ts` 两个文件。

另有一条**记录错误已在本次评审中修正**：C-40 声称已同步 `RFCS.md` §1/§2，但评审开始时 §3 依赖表仍写「RFC-007 依赖 005, 006」、§1 关键路径仍是 `004 → 006 → 007`、§1.1 的重排映射表被改成了「旧 LLM → 新投影 / 旧投影 → 新 LLM」。这些已按用户裁决修正，详见 §2。

**C-7 的核对结论：记录与实现都正确**。RFC-007 抬头已写 `Depends on: RFC-005`，§2.1 / §8.1 记录了 `ARCH-8` 的签名偏差并按五字段对象实现，`src/shared/project.ts:15-22` 与 `src/server/project/index.ts:25` 一致；`RULES.md:133` 仍写旧签名，这正是 C-7 待 `/manage-changes` 修正的内容，不是本 RFC 的代码缺陷。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `220a0de`，工作树 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT:0

$ pnpm lint
> eslint .
EXIT:0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT:0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
EXIT:0

$ pnpm test
 Test Files  46 passed (46)
      Tests  389 passed (389)
EXIT:0

$ pnpm exec vitest run --project unit --coverage
All files        |   96.68 |    93.31 |   97.14 |   96.96 |
EXIT:0（覆盖率阈值 90 / 85）
```

`pnpm test:e2e` 未跑：本 RFC 只有服务端纯函数与共享常量，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位，与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本 RFC 只改服务端投影、引擎折叠与共享常量，因此适用游戏规则、可见性、安全与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright 检查。

---

### 1. 用户要求核对的两点

#### 1.1 C-7 · `ARCH-8` 签名偏差

**结论：记录正确，实现正确。**

- RFC 抬头：`RFCs/RFC-007-context-projection-and-injection-guard.md:4` 写 `Depends on: RFC-005`。
- 偏差登记：同文件 `:23` 写明 `ARCH-8` 的 `project(state, observerId)` 与 RFC 的对象签名不同；`:202` 的 §8.1 批准记录写「先按 RFC 的五参数实现」；`RFCS.md:167` 的 C-7 再次登记。
- 类型：`src/shared/project.ts:15-22` 的 `ProjectInput` 恰有 `state` / `events` / `observer` / `pending` / `excludeSeq` 五个字段；`src/server/project/index.ts:25` 的 `project(input: ProjectInput)` 与 RFC §2.1 的代码块一致。
- 实现没有依赖 RFC-006：`src/server/project/index.ts:1-10` 只 import `@shared/*` 与 `@engine/*`，仓库中也没有 `src/server/llm/`。
- 遗留：`RULES.md:133` 仍写 `project(state, observerId)`；C-7 已说明由 `/manage-changes` 修正。这是已登记冲突，不是本 RFC 的未记录偏离。

#### 1.2 C-40 · RFC-006 / RFC-007 依赖翻转

**实现侧：通过。** `project()` 不调用 LLM、不 import RFC-006 的任何模块；RFC-007 只依赖 RFC-005（引擎与共享类型）。`RFCs/RFC-006:4` 已改成 `Depends on: RFC-004, RFC-007`，`RFCs/RFC-007:4` 已改成 `Depends on: RFC-005`。

**记录侧：评审开始时并不完整，已在本轮修正。** 评审开始时：

- `RFCS.md:71` 仍写 `| RFC-007 | 005, 006 | 008, ... |`；
- `RFCS.md:20` 的关键路径仍是 `001 → 002 → 003 → 004 → 006 → 007 → 008 → 009 → 014`；
- `RFCS.md:29-30` 的 §1.1 重排表被改成了「RFC-007（LLM）→ RFC-007（投影）」「RFC-008（投影）→ RFC-006（LLM）」，既不符合历史，也与实际编号相反；
- `RFCS.md:319` 的 C-40 却已标成「**已修** · … · `RFCS.md` §1/§2」；
- `RFCs/RFC-006:12` 仍写「此时还没有上下文投影（RFC-007）」，与新的前置关系矛盾。

本轮已修正：`RFCS.md` 的 §1 关键路径、§1.1 映射表、§3 依赖表、C-40 痕迹，以及 `RFCs/RFC-006` §1 的过时句。修正后 RFC-007 的直接前置只有 RFC-005，与用户裁决一致。

---

### 2. RFC ADHERENCE

**Verdict: NEEDS WORK**

#### 2.1 C-28：投影的夜间泄漏（阻塞）

`RFCS.md:229` 的 C-28 明确写「**非阻塞 RFC-003 的代码，但 RFC-007 开工前必须裁决**」，候选修法是「把 `phase` 改成公共阶段（night / day / finished）或新增 `publicPhase`；`aliveSeats` / `deadSeats` 按公开事件（或上一次 `DAY_STARTED`）推导，夜间当夜死亡不进公共字段」。RFC-007 的实现照抄了 §2.2 的字段定义，因此代码本身与 RFC 一致，但与 C-28 / PRD FR-9 冲突；不能在 C-28 关闭前合并。

**真实路径探针（临时测试，已删）**：从 `lobbyState()` 正常 `START`，走完狼队夜聊，狼刀 hunter，预言家查验，女巫 `none`。`state.phase` 进入 `NIGHT_HUNTER_SHOOT` 后，观察者 7（村民）的投影输出：

```
night end phase NIGHT_HUNTER_SHOOT
night end dead seats [ 5 ]
projected phase NIGHT_HUNTER_SHOOT
projected aliveSeats [ 1, 2, 3, 4, 6, 7, 8, 9 ]
projected deadSeats [ 5 ]
public phase events []
```

`publicEvents` 里没有任何 `DAY_STARTED`，即「天亮公布」还没发生；但投影已经把「hunter 死了」和「现在是 hunter 开枪阶段」告诉了每个观察者。这比其他玩家在白天从公开事件推断身份更早、更直接。

**第二个探针**：同一个观察者，对「seer 存活」与「seer 已出局」两个夜间状态分别投影：

```
alive seer phase: NIGHT_SEER
dead seer phase: NIGHT_WITCH
```

`phase` 的名字直接区分「seer 还活着」与「seer 已出局」，也就是 C-23 修掉的事件通道在投影层复活。

**测试计划缺口**：`TEST-STRATEGY.md:262` 的 C-28 行要求 `tests/server/project/night-visibility.test.ts` 覆盖死 seer / 死 witch / hunter 开枪夜，并标成 `existing`；实际 `tests/server/project/` 只有 `project.test.ts`。这一行是 Must，且当前不存在。

**建议**：先由 `/manage-changes` 裁决 C-28（推荐把 `ProjectedContext.phase` 收窄成公共阶段，或新增 `publicPhase` 并移除原始 `Phase`；`aliveSeats` / `deadSeats` 按公开事件 / 上一次 `DAY_STARTED` 推导），再改代码与三组回归测试。不要由实现者顺手选一种。

#### 2.2 `AI_THOUGHT`：AC-15 不可满足（阻塞）

RFC-007 §2.5 明确 `AI_THOUGHT` 进事件流（「因此可重放、可复盘」），AC-15 要求「只出现在该席位自己的 `privateEvents`，对 8 个其他观察者不可见」。当前实现：

- `src/shared/events.ts:132` 有 `AI_THOUGHT` 类型；
- `src/engine/apply.ts:95-97` 的 `default` 抛 `UnknownEventError`；
- `src/server/project/index.ts:35` 对每条事件调用 `applyEvent`，所以 `AI_THOUGHT` 在到达可见性判断前就崩；
- `tests/engine/replay.test.ts:288-301` 用 `AI_THOUGHT` 作为「未实现折叠的事件」断言 `replay` 抛错。

**临时探针（已删）**：取真实 `GAME_STARTED`，追加一条 `AI_THOUGHT`（`visibleTo: 'self:3'`），调用 `project()`：

```
project THREW: UnknownEventError applyEvent 不认识事件类型 AI_THOUGHT：它不在 GameEventMap 里，或还没有实现折叠。
```

这不是「RFC-006 还没产出所以不用管」：AC-15 是 RFC-007 的验收标准，且可以用合成事件独立测试；只要 RFC-006 一开始产出 `AI_THOUGHT`，投影与重放都会先崩，而不是把它藏起来。RFC-007 §8.6（`:258`）只把它列为「尚未产出」，但这不消除 AC-15；合成事件仍然必须能被投影正确分类。

**建议**：给 `AI_THOUGHT` 增加 no-op 折叠（像 `SEER_CHECKED` 一样只推进 `seq`、不写 state），把 RFC-002 的「未实现事件」用例换成一个真正未知的类型，并补 `project()` 的 AC-15 用例：本人 `privateEvents` 含该事件，其余 8 个观察者的 `publicEvents ∪ privateEvents` 都不含。登记为 C-41。

#### 2.3 AC 逐条

| AC | 实现 / 证据 | 现有测试 | 变异 / 探针 | 判定 |
|---|---|---|---|---|
| 1 纯函数 | `src/server/project/index.ts:25-67` 只读入参、不调 LLM / 时钟；`project.test.ts:111-133` 两次深相等 + 入参 JSON 不变 | 有 | — | PASS |
| 2 1000 局面 × 9 观察者 | `src/server/project/index.ts:47-56`；`project.test.ts:135-147` 只跑**一局**、9 个观察者；断言 `"role":` 出现 1 次 | 有，但不是 1000 | M5（塞入 `GAME_STARTED`）仍绿 | NEEDS WORK |
| 3 狼队友 | `knowledge.ts:25-32`；`project.test.ts:150-162` 断言狼 2 名、好人为 `[]` | 有 | — | PASS |
| 4 预言家查验 | `knowledge.ts:36-53` 从可见 `SEER_CHECKED` 派生 | **无**：`project.test.ts` 中没有任何 `checks` 断言；RFC §8.4 的「覆盖于 AC-7 的矩阵」不成立 | M1（`checksOf` 恒 `[]`）→ 23/23 绿 | **FAIL** |
| 5 女巫药水位 | `knowledge.ts:56-65` | 只断言**非女巫**两项 `used`；女巫本人从未断言 | M2（女巫恒 `used/used`）→ 23/23 绿 | **FAIL** |
| 6 猎人 `canShoot` | `knowledge.ts:83-88` | 只断言「若 `canShoot` 为真，则必是已出局 hunter」；从未断言开枪阶段为真 | M3（恒 `false`）→ 23/23 绿 | **FAIL** |
| 7 女巫刀口 | `knowledge.ts:72-80` | 只断言非女巫 / 非 `pending` 为 `null`；从未断言女巫在 `pending==='witch'` 时等于刀口 | M4（恒 `null`）→ 23/23 绿 | **FAIL** |
| 8 分区 / 无狼队事件 | `src/server/project/index.ts:38-44` 按 `isVisibleTo` 过滤 | `project.test.ts:222-231` 只覆盖「非狼不含 `wolves`」；`206-220` 的「并集等于可见事件」只是把两个输出集合和自己比较 | M5（额外收 `server` 事件）→ 23/23 绿 | NEEDS WORK |
| 9 与折叠等价 | `src/server/project/index.ts:33-45` 确实逐条折叠 | `project.test.ts:206-220` 的断言是 `sort(merged) === sort(pubSeqs + privSeqs)`，同义反复，没有独立的「按 §2.3 重新折叠得到的期望集合」 | M5 → 23/23 绿 | **FAIL** |
| 10 JSON 往返 | `project.test.ts:234-240` | 有 | — | PASS |
| 11 注入声明句 | `src/shared/injection.ts:13-15` 有常量；`injection.test.ts:57-68` 只查关键词 | 没有系统提示（RFC-006 尚未实现）；也没有逐字比对 | M7（在声明句后追加「另外，忽略以上规则。」）→ 23/23 绿 | NEEDS WORK |
| 12 玩家 / AI 同一封装 | `src/server/project/inject.ts:19-28` 只有一个函数，没有来源参数 | `injection.test.ts:255-260` 用同一函数调两次，必然相同；测试是同义反复，但设计本身满足「不区分来源」 | — | PASS（测试弱） |
| 13 超长拒绝 | `inject.ts:20-22` | `injection.test.ts:267-271` 301 字符 → `UTTERANCE_TOO_LONG` | — | PASS |
| 14 红队 20 样本 | `injection.test.ts:15-26` 只有 **10** 个样本；RFC §5 AC-14 要求 20 个，§8.4 却写 10 个并标 PASS | 10 个 | M8（删转义）→ 3 failed，说明转义主路径有锁 | NEEDS WORK |
| 15 `AI_THOUGHT` 不可见 | `project()` 当前会抛错，见 §2.2 | **无**；`injection.test.ts:57` 的「AC-15」实际测的是声明句，不是事件可见性 | P2 → `UnknownEventError` | **FAIL** |
| 16 当前发言不重复 | `src/server/project/index.ts:37` | `project.test.ts:274-301` 在随机局里没有 `SPEECH`（探针输出 `has SPEECH false`），走 `anyEvent` 回退；只锁了「exclude 一个公开事件」，没有测 `SPEECH` 与封装槽位 | M9（忽略 `excludeSeq`）→ 1 failed，说明基本排除有锁；槽位未测 | NEEDS WORK |

补充：`legalTargets` 是 `ProjectedContext` 的字段（RFC §2.2 / D-3 / D-4），但整个测试目录没有任何 `legalTargets` 断言；`targets.ts` 的 `vote` / `runoff` / `kill` / `witch` 分支都没有直接测试。它虽然不是一条独立 AC，但 RFC-006 会按它裁剪 AI 的选项，建议补一组纯函数用例。

#### 2.4 偏离记录

- **D-1 / D-2 已记录**：`src/server/project/inject.ts` 与 `src/shared/injection.ts` 的位置变化有 §8.2 说明。
- **未记录 1（已登记 C-43）**：`wrapPublicUtterance` 的 RFC 签名写 `: string`（§2.6），实现返回 `{ ok: true; text } | { ok: false; code }`。实现跟了 AC-13 的「返回错误码」，但 §2.6 的签名与 §8 的偏离记录都没回写。建议在 §2.6 / §8.2 记一条，或改 AC-13 的文字。
- **未记录 2**：AC-14 要求 20 个样本，实现只有 10 个；RFC §8.4 把 10 当成 PASS，没有在 §8.2 说明「为什么 10 个足够」。
- **未记录 3**：C-28 的阻塞没有出现在 RFC-007 §8；§8.6 的已知缺口只列了 `AI_THOUGHT` 未产出，没有列「投影原样透出 `phase`」。
- **D-2 的理由不成立**：`src/shared/injection.ts:20-22` 新增了 `escapeAngleBrackets` 运行时函数，`ARCH-2` 只允许类型与纯常量；C-13 已登记的例外只有 `visibility.ts` 与 `schemas.ts`。D-2 说「纯常量与纯函数，符合 ARCH-2」与规则原文不符。见 §6 非阻塞 N1。

---

### 3. RULES COMPLIANCE

**Verdict: NEEDS WORK**

- **ARCH-1 / ARCH-3 / ARCH-4**：`src/engine/` 没有 import `src/server/`；`project()` 是纯函数，没有时钟 / 环境 / 缓存；通过。
- **ARCH-8**：偏差已登记（C-7），对象签名与 RFC 一致；通过。
- **ARCH-2**：`src/shared/injection.ts` 新增运行时函数，超出 C-13 已登记的两处例外；见 N1。
- **SEC-3 / SEC-5**：封装函数与系统提示分离；投影是唯一输出路径。`project()` 当前没有 HTTP 入口，RFC-008 才接线；没有发现新增的原始 state 序列化。
- **AI-5**：`AI_THOUGHT` 的 `reason` 是私有事件；但事件目前无法被折叠 / 投影（B2），所以「复盘读事件流」的路径也还没有被真正验证。
- **API-1**：`ProjectedContext` 是共享响应类型，但没有 Zod schema。RFC-008 才把它暴露成 HTTP 响应；建议在 RFC-008 开工前补 `ProjectedContextSchema`，不在本 RFC 阻塞。
- **TEST-1**：多条 Must 级 AC 没有对应测试，或测试不能变红（B3）；明确违反。
- **TEST-2**：覆盖率门禁通过（行 96.96% / 分支 93.31%），但只统计 `src/engine/`，本 RFC 的 `src/server/` 不在阈值内；不能拿它证明本 RFC 的测试质量。
- **DOC-1**：AC-14 的 20→10、`WrapResult` 签名、C-28 未记录；见 §2.4。
- **STYLE-3 / STYLE-4**：没有 `any` / 非空断言；`event as never` 是类型逃逸，虽不是 `any`，但会在事件类型演进时把编译期错误变成运行时错误（B2 就是例子）。

---

### 4. SECURITY

**Verdict: FAIL**

- **B1（C-28）是安全缺陷，不只是文档问题**：投影是喂给 AI 的唯一上下文；`phase` / `deadSeats` 在 `DAY_STARTED` 之前把夜间身份存活与死亡暴露给每个观察者。PRD FR-9 的第一句就是「AI 的决策与发言只能使用该 AI 视角可见的信息」；这直接违反卖点的技术兑现。
- **B2 是可用性 / 一致性缺陷**：`AI_THOUGHT` 一旦产出，投影与 `replay` 都会抛 `UnknownEventError`，AI 回合会整体失败；这不是「隐藏得很好」，而是直接崩溃。
- **注入封装本身结构正确**：`wrapPublicUtterance` 用固定标签、转义 `<` / `>`、超长拒绝；M8 删转义会 3 红，说明主路径有锁。红队样本只有 10 个（AC 要求 20），且没有把 `events` / `state` 的变化纳入断言（函数本身不接收它们，属于结构性防护，但仍应在 AC 文字或测试中说明）。
- **没有发现密钥、网络、DOM 或原始 LLM 响应泄漏**；这些不在本 RFC 范围。

---

### 5. PERFORMANCE

**Verdict: PASS（有可接受的成本）**

`project()` 每次调用从空状态重放整条事件流（`src/server/project/index.ts:31-45`），复杂度 O(events)。RFC §4 明确「投影不缓存」，且一局 9 人、事件数量在数百量级，单次决策的投影成本远低于 LLM 调用；没有 N+1、网络或数据库路径。全量历史是 Q-007-1 的用户裁决（1M 上下文 + 前缀缓存），不是本 RFC 的缺陷。

---

### 6. MAINTAINABILITY

**Verdict: NEEDS WORK**

- **测试与 AC 的映射不实**：见 §2.3；`TEST-STRATEGY.md:253-262` 的 `existing` 至少对 1000 属性测试、C-28 夜间测试、AC-4 / AC-15 不成立。
- **测试名与行为不符**：`project.test.ts:184` 的 `knownKillTarget ... 非空` 没有断言女巫非空；`:206` 的「并集等于可见事件」是同义反复；`:274` 的「当前发言」在随机局里没有 `SPEECH`，走的是 `anyEvent` 回退。
- **`observes()` 是未使用导出**（`src/server/project/index.ts:70-72`）：没有 src / test 调用，和 `project()` 内部的 `isVisibleTo` 重复；要么删掉，要么用它替换内部调用。
- **`event as never`**（`:35`）：把 `EventEnvelope` 的 `payload: unknown` 逃逸成 `GameEvent`；B2 证明事件类型演进时这里会炸。建议让 `project` 接收 `GameEvent[]`，或在折叠前做一次类型守卫。
- **`legalTargets` 无测试**：见 §2.3 补充。
- **文档残留**：`README.md:11` 仍写「四个 RFC」与 4 个 `Reviewed`；当前是 001–005 五个 `Reviewed` + RFC-007 `Changes requested`。`README.md:42` 仍写「RFC-007 Implemented，等待评审」。`RFCs/RFC-006:12` 的「此时还没有上下文投影」已在本轮修正。

---

### 7. 非阻塞建议

| # | 建议 | 影响 |
|---|---|---|
| N1 | `src/shared/injection.ts` 的 `escapeAngleBrackets` 移到 `src/server/project/inject.ts`，或由 `/manage-changes` 把 C-13 的 shared 运行时例外扩为「类型、纯常量、`visibility.ts`、`schemas.ts`、`injection.ts`」 | 当前 `ARCH-2` 文本不允许；D-2 的理由不成立 |
| N2 | 把 `wrapPublicUtterance` 的返回类型写回 RFC §2.6（`WrapResult`），并在 §8.2 记一条 | 现在 §2.6 的 `: string` 与 AC-13 / 实现不一致 |
| N3 | 把 `ProjectedContext` 的 Zod schema 排到 RFC-008 的 `GET /api/games/:id` 之前 | `API-1` 要求共享响应类型由 Zod 校验 |
| N4 | 删除未使用的 `observes()`，或让 `project()` 复用它 | 死代码 / 双实现 |
| N5 | 补 `legalTargets` 的 9 个观察者 / 各 `pending` 组合用例，尤其是 `DAY_VOTE_RUNOFF` 不含 `'abstain'`（D-4） | RFC-006 会直接消费它 |
| N6 | 把 AC-14 的红队样本补到 20 个，并明确「不改变 `events` / `state`」是结构性保证还是断言 | AC-14 字面要求 |
| N7 | 在 RFC-006 §2.4 / AC-11 明确 `buildSystemPrompt` 必须原样包含 `INJECTION_NOTICE` | RFC-007 AC-11 的「系统提示逐字比对」目前无落点 |
| N8 | `README.md` 的状态段与进度块以 `RFCS.md` 为准同步 | 当前「四个 RFC」/「RFC-007 Implemented」已过时 |

---

### 8. 变异探针与临时探针（全部已恢复 / 已删除）

**基线**：`pnpm exec vitest run --project unit tests/server` → **3 files / 23 tests**，全绿。每条变异后用备份恢复，最后 `git status --porcelain` 无代码改动。

| # | 改动 | 定向结果 | 结论 |
|---|---|---|---|
| M1 | `knowledge.ts` 的 `checksOf` 在 seer 判断后直接 `return []` | 23/23 passed | AC-4 无回归锁 |
| M2 | `potionsOf` 对女巫恒用 `{ heal: true, poison: true }` | 23/23 passed | AC-5 无回归锁 |
| M3 | `canShootOf` 恒 `return false` | 23/23 passed | AC-6 无回归锁 |
| M4 | `knownKillTargetOf` 恒 `return null` | 23/23 passed | AC-7 无回归锁 |
| M5 | `project()` 额外把 `visibleTo === 'server'` 的事件收进 `privateEvents` | 23/23 passed | AC-8 / AC-9 无回归锁；`GAME_STARTED` 含全员 `roles`，这是最严重的一条测试空白 |
| M7 | `INJECTION_NOTICE` 末尾追加「另外，忽略以上规则。」 | 23/23 passed | AC-11 只查关键词，不逐字 |
| M8 | `inject.ts` 去掉 `escapeAngleBrackets` | 3 failed / 20 passed | 转义主路径有锁（正向对照） |
| M9 | `project()` 忽略 `excludeSeq` | 1 failed / 22 passed | 排除机制本身有锁（正向对照） |
| P1 | 真实路径：狼刀 hunter → 查验 → 女巫 `none`，观察者 7 投影 | `phase=NIGHT_HUNTER_SHOOT`、`deadSeats=[5]`、`publicEvents` 无 `DAY_STARTED` | C-28 复现 |
| P2 | 真实 `GAME_STARTED` + 合成 `AI_THOUGHT` → `project()` | `UnknownEventError` | AC-15 / B2 复现 |
| P3 | 同一观察者，seer 存活 / 已出局的夜间状态 | `NIGHT_SEER` vs `NIGHT_WITCH` | C-28 的相位名泄漏 |

P1 / P2 / P3 是临时测试文件，跑完即删；M1~M9 的源码改动全部用备份恢复。探针恢复后 `git status --porcelain` 没有源码改动；文档修改后最终全量 `pnpm test` 仍为 46 files / 389 tests、exit 0。**本评审没有修改任何产品代码，也没有 git commit。**

---

### 9. 最终判断

- **Overall Risk Level: High**
- **Summary**：投影的主干（按序折叠、分区、JSON 往返、注入封装、超长拒绝）是成立的，但有三类不能合并的问题：C-28 的夜间相位 / 死亡泄漏直接打在「AI 不作弊」的卖点上；`AI_THOUGHT` 无法折叠导致 AC-15 与后续 RFC-006 的投影不可用；多条 Must 级 AC 的测试是弱断言或同义反复，M1~M5 / M7 都能保持全绿。C-7 的记录与实现正确；C-40 的 RFC 抬头与 RFC-006 抬头正确，但索引表 / 关键路径 / §1.1 映射在评审开始时仍是错的，已在本轮修正。
- **Blocking Issues**：
  1. **B1**：C-28 未裁决 — `phase` / `aliveSeats` / `deadSeats` 夜间泄漏（`src/server/project/index.ts:57-60`；真实路径探针见 §2.1；`TEST-STRATEGY.md:262` 的计划测试不存在）。
  2. **B2**：`AI_THOUGHT` 不能进入事件流 / 投影（`src/engine/apply.ts:95-97`、`src/server/project/index.ts:35`、`tests/engine/replay.test.ts:288-301`；探针见 §2.2）。
  3. **B3**：AC-4 / AC-5 / AC-6 / AC-7 / AC-8 / AC-9 / AC-11 / AC-14 / AC-15 / AC-16 的测试缺口；M1~M5、M7 全绿（§8）；`TEST-STRATEGY.md` 的 `existing` 与 1000 属性测试不实。
- **状态**：`RFCS.md` → **`Changes requested`**；新增 **C-41**（`AI_THOUGHT` 折叠 / AC-15）、**C-42**（`src/shared/injection.ts` 的 ARCH-2 例外）与 **C-43**（`wrapPublicUtterance` 返回类型与 §2.6 不一致）；**C-28 保持 Open（阻塞 RFC-007）**；**C-40 已在本次评审补全并关闭**。C-7 仍按 RFC 的五字段对象实现，`RULES ARCH-8` 的旧签名待 `/manage-changes`。
