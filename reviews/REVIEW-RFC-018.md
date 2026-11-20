# REVIEW-RFC-018 · 狼队夜间讨论改为限时聊天室

**评审对象**：RFC-018 / CHANGE-REQUEST-012 / RUL-14
**评审轮次**：Round 1
**日期**：2026-11-20
**评审者**：独立 subagent（未参与实现；只读仓库 + 实跑 + 临时探针）
**结论**：**Changes requested**（4 条阻塞）

---

## 0. 先跑，再说（本会话实测基线）

本机为 macOS，DSH danger-full-access，无审批能力；以下均为本会话命令的真实输出。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK_EXIT=0            # 实测 4.8s

$ pnpm lint                 # LINT_EXIT=0
$ pnpm format:check         # All matched files use Prettier code style!  FORMAT_EXIT=0
$ pnpm build                # 客户端 146 modules / 服务端 66 modules；BUILD_EXIT=0

$ pnpm test
|unit| + |client|：Test Files 87 passed (87) / Tests 789 passed (789)
|meta|：Test Files 1 failed | 6 passed (7) / Tests 1 failed | 34 passed (35)
  FAIL tests/meta/commands.test.ts > AC-1 > pnpm typecheck 退出 0
  Error: Test timed out in 180000ms.
```

`pnpm test` 的单元与客户端部分与 RFC 的宣称一致（789/789）。**meta 层在本机两轮均未跑通**：
第一轮 `pnpm typecheck` 子进程挂起、第二轮 `tests/meta/commands.test.ts` 改为
`pnpm exec vitest run --project unit` 子进程挂起（两轮挂的测试不同，单跑 `pnpm typecheck`
本身 4.8s 正常）。这是与本机环境/子进程派生相关的 flake（与 RFC-018 §8 D-2 已知的
「vitest 派生 Playwright 会挂」同类），不是 RFC-018 的行为回归；登记为 N-8。
**实现会话与 lead 的确认**：`pnpm test` 789 + 35 全绿、`test:e2e` 16 通过、`test:e2e:all` 18 通过、
`test:perf` 3 通过。**e2e / perf 本会话未复跑**（按 lead 的时限要求，不再跑长命令），
所以这两项的 verdict 是「实现方已证、评审方未复跑」。

---

## 1. 逐条验收标准：哪个测试会红？

| AC | 判定 | 会红 / 不会红 | 证据 |
|---|---|---|---|
| 1. 同一狼可连发多条，相位不推进 | **PASS** | 会红 | `tests/engine/wolf-chat.test.ts:60-71` 断言 `wolfChat` 长度 2、相位仍是 `NIGHT_WOLF_CHAT` |
| 2. 部分准备不推进；全员准备 → 投票 | **PASS** | 会红 | `wolf-chat.test.ts:84-111` |
| 3. 50 秒到 → 未准备者视为准备并进投票 | **PARTIAL** | 会红（只覆盖玩家是狼） | `tests/server/wolf-chat-room.test.ts:46-52` 用 20ms 时限；**没有断言「未到时限前不推进」**，也没有覆盖非狼玩家路径 |
| 4. 倒计时 + `已准备 x/y`；30 秒前准备按钮不可点 | **FAIL** | **不会红**（关键路径无锁） | 组件级 `tests/client/shoot.test.tsx:437-485` 只喂 prop；真实游戏里（a）`跳过` 会在任意时刻把玩家标记成已准备（见 B3），（b）`readySeats` / `selfReady` 直接过滤整局 `ctx.privateEvents`，第二夜会把第一夜的 `WOLF_READY_MARKED` 算进来（见 B4），（c）倒计时是组件本地 `elapsed`，重挂载即归零（见 N-1） |
| 5. 纯玩家 + 脚本局 5 秒可准备 | **FAIL** | 不会红 | 客户端只认 `?fast=1`（`src/client/App.tsx:336-338`）；没有读取 `HOWL_FAKE_AI` 或任何「本局只有玩家+脚本」的标记。普通 `HOWL_FAKE_AI=1 pnpm dev` 开局仍是 30 秒；反过来 `?fast=1` 在真实模型局也能把门槛降到 5 秒，与 RUL-14 的「仅玩家+脚本替身例外」不符 |
| 6. 投票超时 → 弃权；弃权不计票；全员弃权不刀 | **PARTIAL** | 部分会红 | `wolf-chat-room.test.ts:54-64` 只断言玩家超时那一票 `target==='abstain'`；**没有**「弃权不计最高票」「全员弃权不产生 `WOLF_KILL_CHOSEN`」的引擎用例。引擎实现了 `allAbstain` 分支（`src/engine/phases/night.ts:189-221`），但只靠这条路径的行覆盖，没有行为锁 |
| 7. 重投阶段不能弃权（RUL-13 不变） | **FAIL** | **不会红**；行为本身错 | 见 B1。`tests/engine/wolf-vote.test.ts` 全文没有 `'abstain'`；TEST-STRATEGY 第 7 行却标 `existing` |
| 8. 玩家能看到最新聊天；AI 能读到玩家新消息 | **FAIL（AI 侧）** | **不会红** | 见 B2。`tests/server/wolf-chat-room.test.ts` 只有超时两条，**没有** AI 上下文断言；TEST-STRATEGY 第 8 行标 `existing` 与实际不符 |

---

## 2. 阻塞项

### B1 · 重投阶段接受弃权，且全员弃权后无刀口直接进入下一相位

`src/engine/phases/night.ts` 的 `wolfVote` 把 `action.target === 'abstain'` 分支放在
**重投目标校验之前**，且没有 `state.phase === 'NIGHT_WOLF_RUNOFF'` 的拒绝：

- `night.ts:149`（abstain 分支）先于 `night.ts:245-258`（`INVALID_RUNOFF_TARGET` 校验）。
- 服务器路径同样会在重投超时时提交 `abstain`（`src/server/orchestrator.ts:371-379` 明确把
  `NIGHT_WOLF_RUNOFF` 也纳入超时弃权）。

**实测探针**（临时测试，已删除）：三狼先各投不同目标进入 `NIGHT_WOLF_RUNOFF`，再让三狼
全部提交 `WOLF_VOTE target='abstain'`：

```
RUNOFF_ABSTAIN NIGHT_SEER
  [ 'WOLF_VOTE_CAST', 'WOLF_VOTE_REVEALED', 'PHASE_CHANGED' ]
  { seat: 8, target: 'abstain' }
```

期望：第一次弃权应返回 `REJECTED`（RUL-13「重投不能弃权」、RFC-018 AC-7）。
实际：三票都被接受；第三票后 `tallyWolfVotes` 返回 `allAbstain`，代码走
`phaseChangedDraft(state.phase, nextAfterWolves(state))`，**没有 `WOLF_KILL_CHOSEN`**，
直接进入 `NIGHT_SEER`。这既是规则错误，也是可观察行为错误（当夜无刀）。

**测试现状**：TEST-STRATEGY RFC-018 第 7 行写
`tests/engine/wolf-vote.test.ts：重投阶段弃权被拒 | unit | existing`；该文件 189 行内
**没有任何 `abstain`**。计划的测试不存在，所以删掉这段分支也不会红。

**修复方向**：在 `wolfVote` 最前面加
`if (state.phase === 'NIGHT_WOLF_RUNOFF' && action.target === 'abstain') return rejectionDraft({ code: 'INVALID_RUNOFF_TARGET', ... })`；
同时决定 `playerAction` 在重投超时时怎么办（不能提交 `abstain`；建议超时替玩家投
`wolfRunoff[0]`，与 RUL-2 的白天重投处理一致）。补一条引擎用例 + 一条编排用例。

### B2 · AI 队友的投影是 `driveWolfChat` 开始前的冻结快照，永远看不到玩家新消息（也看不到队友发言）

`src/server/orchestrator.ts:211-218` 在进入 `driveWolfChat` 之前构造 `ctxFor`，
闭包捕获的是当时的 `state` 与 `currentRecord.events`；`driveWolfChat` 内部只在
局部 `record` 上推进，`ctxFor` 从未重建。`chatFromAi`（`:504-512`）用的正是这个闭包。

**实测探针**（临时测试，已删除）：玩家发 `hello-from-player`，AI 狼每次决策记录
`ctx.privateEvents` 里的 `WOLF_CHAT_POSTED`：

```
AI_SEEN [{"seat":4,"chats":[]},{"seat":8,"chats":[]},{"seat":4,"chats":[]},{"seat":8,"chats":[]}]
AssertionError: expected false to be true   # 没有任何一次看到玩家消息
```

连 AI 队友自己的开场发言都看不到（`chats` 全空），更不用说玩家的新消息。这直接违反
RFC-018 AC-8 与 §2.2「真实模型因此能看到最新聊天室」，也让 CHANGE-REQUEST-012 的
Q-012-3 裁定落空。**真实模型路径下 AI 实际在真空中讨论**，提示词里的聊天室上下文是空的。

**测试现状**：TEST-STRATEGY 第 8 行写 `tests/server/wolf-chat-room.test.ts：AI 在讨论阶段能推进/回应（脚本路径） | existing`；
该文件只有「讨论超时」和「投票超时」两条，**没有**回应/上下文断言。

**修复方向**：`ctxFor` 每次调用时从 `registry.getGame(record.gameId)` 重读并重新
`project`（或把 `driveWolfChat` 改成接收会重算的 `ctxFor(record)`）；用真实
`runGame` + 会记录 `ctx.privateEvents` 的 decider 加一条回归测试，断言玩家消息
出现在下一次 AI 决策的投影里。

### B3 · 30 秒准备门槛在正常 UI 路径上可被绕过；5 秒例外没有接到「纯脚本局」

1. **`跳过` 按钮 = 立即准备**：`src/client/components/NightAction.tsx:89-107` 的
   `跳过` 调 `onChat('')` → `App.tsx:375` 发 `WOLF_CHAT text:''` → 路由
   `src/server/routes/games.ts:353-355` 调用 `channels.submit(gameId, '')` → 
   `normalizeInput({text:'', timedOut:false})` 返回 `{kind:'skip'}`（`src/shared/speech.ts:24-28`）
   → `orchestrator.ts:590-592` 执行 `markReady(playerSeat)`。
   结果：玩家在任意时刻点「跳过」都会被标记为「准备完成」，30 秒门槛失效；
   同一条路径也是 e2e `passNight` 推进夜间的依赖（`tests/e2e/helpers.ts:17-25`），
   所以 e2e 永远碰不到 30 秒门槛。
2. **服务端没有独立门槛**：直接 POST `WOLF_READY`（`ActionSchema` 接受）在任意时刻
   被引擎接受；只有客户端按钮的 `disabled` 在挡。RUL-14 的「30 秒后可点」不应只靠 UI。
3. **5 秒例外靠 URL 开关**：`App.tsx:336-338` 只判断 `?fast=1`。没有 `HOWL_FAKE_AI=1`
   对局标记。AC-5 的「纯玩家+脚本对局 5 秒」在正常开局里不成立；反过来
   `?fast=1` 在真实模型局也生效，违反「仅玩家+脚本替身例外」。

**修复方向**：服务器在投影/能力接口里给出 `wolfReadyAfterSeconds`（由
`HOWL_FAKE_AI`/实际 decider 种类决定，且不在客户端可改），`WOLF_READY` 在服务端校验
已过门槛（或把服务端超时/准备统一为系统动作）；把 `跳过` 的「空消息」与「准备」分开
（`跳过` 只发空 `WOLF_CHAT`，不触发 `markReady`）；e2e 用真实的准备按钮/时间门槛补一条。

### B4 · 第二夜起聊天室与 `已准备 x/y` 会显示上一夜的数据；`wolfCount` 把死狼算进去

`src/server/project/index.ts:29-48` 的 `privateEvents` 是**整局**对该席位可见的非公开事件，
不按夜截断；客户端直接整包过滤：

- `App.tsx:339-342` `readySeats`：所有历史 `WOLF_READY_MARKED`；
- `App.tsx:343-347` `selfReady`：第一夜准备过，第二夜仍是 `true`，按钮变成
  「已准备，等待队友」且禁用——**玩家第二夜无法主动准备**，只能等 50 秒兜底；
- `App.tsx:367-372` `wolfChats`：第二夜聊天室会显示第一夜的发言；
- `App.tsx:342` `wolfCount = teammates.length + 1`，`teammatesOf` 含已出局狼
  （`src/server/project/knowledge.ts:22-28`），有狼死后 `x/y` 分母错误。

同一类问题在 RFC-017 的 C-220 已经有先例（`currentWolfVotes` 按最近一次
`WOLF_VOTE_REVEALED` 截断）；`WOLF_READY_MARKED` / `WOLF_CHAT_POSTED` 没有同等处理。
引擎的 `wolfReady` 确实随新一夜清空（`src/engine/apply.ts:145-150`），但 UI 不读它。

**修复方向**：`project()` 暴露 `wolfReady`（或 `currentNightStartSeq`），客户端按
当前夜截断；`wolfCount` 用存活狼数；补两夜 `WOLF_READY_MARKED` / `WOLF_CHAT_POSTED`
的 client 用例。

---

## 3. 非阻塞项

| # | 问题 | 证据 / 建议 |
|---|---|---|
| N-1 | 倒计时只在客户端本地累加，重挂载/刷新后与服务器不同步 | `NightAction.tsx:50-56` 的 `elapsed` 以 `pending` 为依赖、从 0 起算；刷新后 50 秒/10 秒倒计时重新开始。服务端的 50 秒推进是真的（`driveWolfChat`），但**显示**会骗人。建议由投影带 `phaseStartedAt` 或剩余秒数 |
| N-2 | 玩家不是狼时仍可能被真实模型拖满 50 秒 | `orchestrator.ts:545-561` 的 `!playerIsWolf` 分支只做「每 5 秒再问一次 AI」+ 50 秒兜底；脚本局 `wolfReadyMs=5000` 会在 5 秒推进，但真实模型不保证输出 `ready`，玩家可能干等 50 秒。5 秒重问条件 `floor(elapsed/5000)!==floor((elapsed-1)/5000)`（`:548`）只在恰好跨 5 秒的 100ms 采样点成立，容易漏。建议非狼玩家设独立的短硬上限（如 5 秒）并在超时直接代准备 |
| N-3 | 提示词硬编码 50/10 秒且没有剩余时间 | `src/server/llm/prompts/base.ts:151-153` 写死「讨论限时 50 秒、投票限时 10 秒」；CHANGE-REQUEST-012 Q-012-3 裁定要求「提示词里要带上讨论/投票剩余时间」，实现没有。e2e 用 `HOWL_WOLF_CHAT_MS=3000` 时提示词也仍是 50 秒。建议把剩余秒数作为投影/decider 输入渲染 |
| N-4 | `to-action.ts` 的 `phaseAllows` 有两个 `case 'ready'` | `src/server/llm/to-action.ts:39-40` 与 `:58-59`；第二个不可达，是死代码。ESLint 配置只用 `typescript-eslint` recommended（`eslint.config.js`），`no-duplicate-case` 不在其中，所以 lint 0 不代表干净 |
| N-5 | 文档漂移 | `RFCS.md:3` 仍写 `RULES.md v1.4`（实际 v1.5）、`复杂度分布` 未计 Large；`README.md:11` 仍写「十七个 RFC / 78 条规则 / RUL-1~13 / 824 用例 / 14 Reviewed + 3 Spec changed」；`TEST-STRATEGY.md:3` 仍是 v1.21 / 最后更新 2026-11-19，`§0.2` 基线 89/794，变更历史没有 RFC-018 条目；`TEST-STRATEGY.md:512-515` 的 RFC-018 第 7/8 行把不存在的测试标成 `existing` |
| N-6 | RFC-017 / RUL-13 契约没有同步 | RFC-018 把 `WOLF_VOTE.target` 扩为 `SeatId \| 'abstain'`、`wolfVotes` 同改，但 `RFCs/RFC-017` 的「重投不能弃权」仍是 `Reviewed`，没有标 `Spec changed`；`RULES.md:246` 的 RUL-13 原文仍写「只能投存活非狼席位」「不能弃权」，而 CHANGE-REQUEST-012 的裁定明确要求给 RUL-13 补「超时/弃权不计票」；RUL-14 只在理由里口头区分「仅超时路径允许」，引擎无法区分超时弃权与显式弃权。已登记到 RFCS §8.63 |
| N-7 | 同 N-5 的测试计划可信度：计划与现状不符 | 见 B1/B2。`TEST-STRATEGY.md` 的 `Exists?` 列在 RFC-018 两行上失真；这会让下一位评审/实现者误以为有回归锁 |
| N-8 | meta 子进程门禁在本机挂起（本轮两次） | 第一次 `pnpm typecheck`、第二次内部 `vitest run --project unit` 均超过 180s；单跑命令本身正常。与 D-2 的 e2e 派生问题同类。建议 meta 的 `run()` 加 `timeoutMs`（当前 helper 支持但 commands.test.ts 未传）并记录失败输出 |

---

## 4. 变异探针

本轮没有对源码做「改回去 → 跑测试」的变异探针，原因是：

1. B1、B2 已经用**直接行为探针**证伪（比变异更强：功能本身就是错的，不只是测试不设防）；
2. B3、B4 是 UI/接线路径，现有测试根本没有到达这些路径（`跳过`、第二夜、5 秒例外）；
3. lead 要求 5 分钟内收尾，长命令已停止。

已做的探针与清理：

| 探针 | 方式 | 结果 |
|---|---|---|
| P-018-A 重投弃权 | 临时 `tests/server/__probe-018.test.ts`，真实 `step` 链 | **行为错误**：进入 `NIGHT_SEER`，无 `WOLF_KILL_CHOSEN` |
| P-018-B AI 上下文 | 同一临时文件，真实 `runGame` + 记录 `ctx.privateEvents` 的 decider | **断言红**：所有 AI 决策 `chats: []`；`expected false to be true` |
| P-018-C `跳过` 准备 | 静态追踪：`onChat('')` → 路由 `WOLF_CHAT` → `channels.submit('')` → `normalizeInput` → `markReady` | 代码路径成立；未运行浏览器 |
| P-018-D 跨夜残留 | 静态追踪：`privateEvents` 全量 + 客户端直接过滤 | 成立；未补 client 用例 |

临时探针文件已删除；`git status --porcelain` 在写本文件前为空。工作树没有 `src/` 改动。

---

## 5. 评审维度

### 1. RFC ADHERENCE — **NEEDS WORK**
- AC-1/2/3 基本满足；AC-4/5/6/7/8 有阻塞或部分缺口（见上）。
- 已记录的偏离 D-1（e2e 只跑 chromium+firefox）与 D-2（meta 不派生 e2e）本身可接受；
  D-2 的「meta 不执行 e2e」在 `tests/meta/lint.test.ts` 已落实为只检查入口存在，
  这是对 TEST-5 的实际放宽，但记录在案，不另记为缺陷。
- **未记录**的偏离：5 秒例外只实现为 `?fast=1`；提示词没有剩余时间；30 秒门槛没有服务端
  强制。这些没有写进 `## Implementation Notes`，违反 DOC-1。

### 2. RULES COMPLIANCE — **NEEDS WORK**
- ARCH-4（引擎纯函数）**满足**：`src/engine/` 无 `Date`/`performance`/定时器；50/30/10 秒
  只在 `orchestrator.ts` / `NightAction.tsx`。计时权威在服务端（推进），但客户端显示不同步（N-1）。
- ARCH-1：引擎没有 import 服务端/客户端（既有依赖测试通过）。
- ARCH-11：B1 是一个**已裁决规则被反向执行**，不是未裁决分支；B3 的 30 秒/5 秒是规则与实现不符。
- SEC-5：AI 的投影仍来自 `project()`，没有直接序列化状态；B2 是投影输入过旧，不是泄漏。
- DOC-1：未记录的偏离见上。
- STYLE-6：`orchestrator.ts` 628 行、`NightAction.tsx` 243 行——`src/server/orchestrator.ts`
  超过 **400 行上限**（STYLE-6）。这是既有文件在本次新增 197 行后进一步超限；
  建议把 `driveWolfChat` 拆到 `src/server/wolf-chat.ts`（维护性，非阻塞）。

### 3. SECURITY — **PASS（本 RFC 范围）**
- `WOLF_READY_MARKED` / `WOLF_CHAT_POSTED` 均为 `visibleTo: 'wolves'`；好人投影不包含。
- 新动作仍走 `ActionSchema` 与服务端席位校验（`NOT_YOUR_SEAT`）。
- 未发现新增的密钥/原始 LLM 响应暴露。玩家狼聊无长度上限的问题存在既有 500 字截断
  （引擎层），但**事件条数**在 50 秒内无上限——单机场景可接受，登记为观察项。

### 4. PERFORMANCE — **NEEDS WORK（低风险）**
- `driveWolfChat` 的 100ms 轮询 + 每条玩家消息对每只 AI 狼一次决策，真实模型下
  50 秒内最多 2×10 次调用（非狼玩家分支每 5 秒重问），成本可控但边界条件脆弱（N-2）。
- `privateEvents` 每轮全量重投影（既有投影方式），聊天室事件数无上限，长局会放大
  prompt 体积；50 秒封顶限制了单夜规模，暂不阻塞。

### 5. MAINTAINABILITY — **NEEDS WORK**
- `driveWolfChat` 与 `playerAction` 职责重叠，且 `driveWolfChat` 自己处理了
  `WOLF_CHAT` 写入、AI 回应、计时三件事（628 行文件，STYLE-6 超限）。
- 重复 `case 'ready'`（N-4）。
- 测试计划与实现漂移（N-7）；`wolf-chat-room.test.ts` 只有 2 条用例，覆盖不了 AC-8。

---

## 6. 总体风险与结论

**Overall Risk：High。**

RFC-018 把「一句一轮」改成了真实的聊天室形态，引擎侧的多条发言、全员准备、状态清理
和投票超时骨架都在，单元测试也覆盖了其中一部分。但两个核心承诺没有兑现：
**AI 看不到聊天室**（等于真实模型仍在真空中说话），**重投可以弃权且弃权后当夜无刀**；
再加上 30 秒/5 秒准备门槛在正常 UI 路径上可被 `跳过` 绕过、第二夜显示上一夜的准备状态，
这四项都会在试玩里被直接看到。TEST-STRATEGY 的两条 `existing` 与仓库实际不符，
说明计划没有真正落地。建议 `Changes requested`，修完 B1-B4 并补上对应回归锁后再评审。

**Blocking Issues（必须修）**

1. **B1** 重投阶段接受弃权；全员弃权重投会无刀进入下一相位（RUL-13 / AC-7）。
2. **B2** AI 决策使用冻结的投影，永远看不到玩家新消息/队友发言（AC-8）。
3. **B3** 30 秒门槛可被「跳过」与直接 API 绕过；5 秒例外只认 `?fast=1`，没有接到纯脚本局（AC-4/5，RUL-14）。
4. **B4** 第二夜聊天室/已准备数复用整局历史事件；`wolfCount` 含死狼（AC-4）。

**Improvement Suggestions（非阻塞）**

- N-1 倒计时由投影带服务端时间；N-2 非狼玩家独立短超时；N-3 提示词带剩余秒数；
  N-4 去掉重复 case；N-5 文档回填；N-6 RFC-017/RUL-13 契约同步（已登记 §8.63）；
  N-7 修正 TEST-STRATEGY 的 `Exists?`；N-8 meta 子进程加超时与输出。
- 把 `driveWolfChat` 拆出 `orchestrator.ts`，满足 STYLE-6。

---

## 7. 定向复现路径（给实现会话）

```bash
# B1：重投弃权
#   tests/engine/wolf-vote.test.ts 补：
#   三狼各投不同 → NIGHT_WOLF_RUNOFF → 三狼各投 'abstain'
#   期望：第一票 REJECTED / INVALID_RUNOFF_TARGET；实际：NIGHT_SEER，无 WOLF_KILL_CHOSEN

# B2：AI 新鲜上下文
#   tests/server/wolf-chat-room.test.ts 补：
#   玩家发一条消息 → 记录下一次 AI decide 的 ctx.privateEvents
#   期望：含玩家 WOLF_CHAT_POSTED；实际：始终为空

# B3：跳过 = 准备
#   tests/server/channels.test.ts 或 e2e：
#   讨论阶段点「跳过」→ 断言玩家没有被 WOLF_READY_MARKED
#   期望：无 ready 事件；实际：markReady(playerSeat)

# B4：第二夜
#   client 用例：两夜各一条 WOLF_READY_MARKED / WOLF_CHAT_POSTED
#   断言第二夜只显示本夜事件；实际：两夜都显示
```

---

## Round 2 -- 2026-11-21

复核范围：**只复核 Round 1 的 B1–B4 是否闭合**，不重审已通过项。按 lead 指令未跑
`pnpm test` / `test:e2e` / meta 套件 / e2e / perf；只跑定向测试与静态门禁。

### 0. 本轮实测

```
$ pnpm exec vitest run --project unit tests/engine/wolf-vote.test.ts tests/server/wolf-chat-room.test.ts
 ✓ tests/engine/wolf-vote.test.ts (10 tests) 7ms
 ✓ tests/server/wolf-chat-room.test.ts (3 tests) 100ms
 Test Files  2 passed (2) / Tests 13 passed (13)   # 284ms

$ pnpm exec vitest run --project client tests/client/shoot.test.tsx
 ✓ tests/client/shoot.test.tsx (16 tests) 298ms
 Test Files  1 passed (1) / Tests 16 passed (16)   # 939ms

$ pnpm typecheck   → 0
$ pnpm lint        → 0
$ pnpm format:check→ 0（All matched files use Prettier code style!）
```

`pnpm build` / e2e / perf / meta **未复跑**（按 lead 时限要求），verdict 只覆盖上述命令
与代码阅读；meta 的 N-8 环境挂起问题本轮不重新认定。

### 1. B1–B4 逐项结论

| 项 | 结论 | 证据 |
|---|---|---|
| **B1** 重投弃权 / 超时 | **未完全闭合（阻塞）** | ① 显式弃权已拒：`night.ts:212-221` 在 `NIGHT_WOLF_RUNOFF` 返回 `INVALID_RUNOFF_TARGET`，新用例 `wolf-vote.test.ts:94-105` 断言拒绝码且相位不变（本轮通过）；② 但**重投超时自动投并列者没有真正实现**：`orchestrator.ts:369-379` 对 `NIGHT_WOLF_RUNOFF && input.kind==='timeout'` 仍返回 `target:'abstain'`，引擎按 ① 拒绝后 `runGame` 在 `orchestrator.ts:286-289` 直接抛 `动作被拒绝：INVALID_RUNOFF_TARGET`。RFC-018 §8.1 与 commit 声称的「重投超时改为投第一个并列者」在代码中不存在。空输入超时之所以能走通，是因为 `normalizeInput('')` 变成 `skip` 后落到 `nightTarget()` 的 `legalTargets[0]`（重投投影恰好只剩并列者），属旁路而非声明中的超时处理。③ 无任何「重投超时」回归用例。 |
| **B2** AI 每次用最新投影 | **闭合** | `orchestrator.ts:500-515` 的 `chatFromAi` 每次从 `registry.stateOf(record)` + `record.events` 重新 `project()`，不再用进入聊天室前的 `ctxFor` 闭包；`handle` 在玩家消息写入后（`:607-624`）调用 `chatFromAi`。新用例 `wolf-chat-room.test.ts:67-119` 用真实 `runGame` 断言玩家 `WOLF_CHAT_POSTED` 出现在 AI 决策的 `ctx.privateEvents`，本轮通过。队友发言同样走同一投影（`record.events` 全量），但用例只单独断言了玩家消息，队友可见性未单独断言（非阻塞）。 |
| **B3** 无跳过 / 空消息 / 5 秒门槛 | **未闭合（阻塞）** | 已改：`NightAction.tsx` 删除「跳过」且空提交不调 `onChat`（`shoot.test.tsx:518-536` 覆盖）；`App.tsx:337-340` 用 Vite 注入的 `__HOWL_FAKE_AI__` 在 5/30 秒间切换。**仍开**：① 服务端路径未修——`routes/games.ts:353-355` 对 `WOLF_CHAT` 仍 `channels.submit(gameId, parsed.data.action.text)`；`wolf-chat.ts:28-55` 接受空 `text`；`HttpInputChannel.submit('')` 经 `normalizeInput` 变成 `{kind:'skip'}`，`orchestrator.ts:593-595` 立即 `markReady(playerSeat)`。即直接 POST 空 `WOLF_CHAT` 仍可绕过 30 秒门槛，「空消息不触发准备」只在 UI 层成立。② `?fast=1` 仍保留：真实模型局加 `?fast=1` 依旧降到 5 秒；`__HOWL_FAKE_AI__` 是构建期常量、服务端不校验，RUL-14「仅玩家+脚本替身」的判定仍不在服务端。③ `WOLF_READY` 仍随时被引擎接受，门槛仍只是按钮 `disabled`。 |
| **B4** 跨夜截断 / wolfCount | **闭合** | `App.tsx:445-457` 的 `currentNightWolfEvents` 以最后一次 `WOLF_VOTE_REVEALED` / `WOLF_KILL_CHOSEN` 为界截断，`readySeats` / `selfReady` / `wolfChats` 均改用它；`wolfCount` 改为 `teammates.filter(t => ctx.aliveSeats.includes(t)).length + 1`（`:344-347`）。第二夜用例 `shoot.test.tsx:543-607` 断言旧夜聊天不显示、`已准备 0/`，本轮通过。`wolfCount` 分母没有专门断言死狼用例，但实现直接依赖投影的 `aliveSeats`，逻辑无歧义（非阻塞）。 |

### 2. 结论

- **B2、B4 闭合**；**B1、B3 仍有阻塞**。
- **RFC-018 Status 保持 `Changes requested`**。B1 需要修 `playerAction` 的 `timeout` 分支
  （重投超时直接投 `ctx.legalTargets[0]` 或 `state.wolfRunoff[0]`）并补一条编排级
  「重投超时」用例；B3 需要把空 `WOLF_CHAT` 与 `WOLF_READY` 的「准备」在服务端拆开
  （空消息只发聊天/忽略，不 `markReady`），并移除或严格限制 `?fast=1` 在真实模型局的
  生效（推荐由服务端投影给出 `readyAfterSeconds`）。
- 本轮未新增冲突；C-235 / C-238 仍 Open，C-237 的测试计划回填仍未做。

---

## Round 3 -- 2026-11-21

复核范围：只复核 Round 2 剩余两项 **B1 / B3**。按 lead 指令，**本轮不运行任何命令**
（不执行 `pnpm` / `vitest` / `playwright` / `git`），以下判定全部来自仓库文件静态阅读；
测试是否实际通过未被本轮独立复测，因此不声称门禁结果，也不把「实现方说绿」当作证据。

### 1. 结论

| 项 | 结论 | 一句话证据 |
|---|---|---|
| **B1** 重投超时不再弃权 | **PASS** | `src/server/orchestrator.ts:371-384` 在 `NIGHT_WOLF_RUNOFF` 取 `ctx.legalTargets` 第一个数字目标，普通 `NIGHT_WOLVES` 仍 `abstain`；`tests/server/wolf-chat-room.test.ts:122-183`（最后一个 describe）覆盖该分支 |
| **B3** 空聊天/5 秒门槛/无跳过 | **FAIL** | `src/client/App.tsx:336-340` 仍以 `?fast=1` 把门槛降到 5 秒；`src/server/routes/games.ts:348-353` 的 `EMPTY_WOLF_CHAT` 检查在 `registry.submit(...)`（`:319-331`）之后，空消息已写入事件流后才返回 400 |

**RFC-018 Status 保持 `Changes requested`。**

### 2. B1 —— PASS

**代码（符合要求）**

- `src/server/orchestrator.ts:331` 把 `NIGHT_WOLVES` 与 `NIGHT_WOLF_RUNOFF` 一起当作狼队投票；
- `:371-375` 的超时分支：`NIGHT_WOLF_RUNOFF` 取
  `ctx.legalTargets.find((target) => typeof target === 'number') ?? 'abstain'`，
  即**第一个数字目标**；`NIGHT_WOLVES` 固定返回 `'abstain'`；
- `src/server/project/targets.ts:41-43` 的 `wolf-runoff` 返回 `state.wolfRunoff`（并列者，均为数字），
  与 `pendingForPhase('NIGHT_WOLF_RUNOFF')`（`orchestrator.ts:111-112`）配套；
- 引擎侧 `src/engine/phases/night.ts:214-223` 已拒绝重投阶段的显式 `abstain`（`INVALID_RUNOFF_TARGET`），
  与 Round 2 的修复一致。

**回归锁（最后一个 describe）**

`tests/server/wolf-chat-room.test.ts:122-183`：

- 第一次 `read` 返回 `skip`（狼聊阶段），随后全部返回 `timeout`；
- 首轮狼投票超时 → `abstain`；AI 狼按 `targets[seat % targets.length]` 分票制造平票 → `NIGHT_WOLF_RUNOFF`；
- 重投阶段再次 `timeout`，若实现退回 `abstain`，`night.ts:214-223` 会产出 `REJECTED`，
  `runGame` 在 `orchestrator.ts:286-289` 直接抛 `动作被拒绝：INVALID_RUNOFF_TARGET`，该用例必红；
- 用例断言玩家 1 号至少有一票 `target !== 'abstain'` 且最终相位不是 `NIGHT_WOLF_RUNOFF`。

同种子/同席位的既有编排用例 `tests/server/orchestrator.test.ts:814-859` 也明确用
`seed: 3, playerSeat: 1` 的 AI 分票制造平票，并注明「2 号是并列者之一」，可佐证该场景确实进入重投，
不是空跑的断言。

**非阻塞的回归锁强度问题**

- 该用例只断言「重投那一票不是 `abstain`」，没有断言「等于 `ctx.legalTargets` 的第一个数字目标」。
  若实现改成投第二个并列者，测试仍绿。代码本身用的是 `.find`，行为正确；建议后续把断言收紧为
  「等于并列者排序后的第一个席位」，让 AC-7 的「第一个」也被锁住。

### 3. B3 —— FAIL

#### 3.1 `?fast=1` 仍然生效（阻塞）

`src/client/App.tsx:336-340`：

```ts
readyAfterSeconds={
  __HOWL_FAKE_AI__ || new URLSearchParams(window.location.search).get('fast') === '1'
    ? 5
    : 30
}
```

`?fast=1` 仍在或运算里；`src/client/pages/Home.tsx:39` 开局时还会把 `fast=1` 继续带进对局 URL。
因此真实模型局加 `?fast=1` 依旧把准备门槛降到 5 秒，与用户要求的「`readyAfterSeconds` 只由
`__HOWL_FAKE_AI__` 决定（5/30）」以及 RFC-018 §8.1 B3 的声明不符。这是本轮 B3 的直接失败点。
（`__HOWL_FAKE_AI__` 本身由 `vite.config.ts:11` 注入，`vitest.config.ts:16` 固定为 false，这部分没问题。）

#### 3.2 空 `WOLF_CHAT` 的「拒绝」发生在写入之后（阻塞）

`src/server/routes/games.ts:348-353` 确实返回了 `400 EMPTY_WOLF_CHAT`，但它在
`registry.submit(...)`（`:319-331`）之后：

- `src/shared/schemas.ts:53-58` 的 `WOLF_CHAT.text` 是 `z.string()`，没有 `min(1)`；
- `src/engine/phases/wolf-chat.ts:42-55` 对空文本只做 `slice`，不拒绝；
- 所以 `registry.submit` 先接受了空消息并写入 `WOLF_CHAT_POSTED`，路由再返回 400；
  这是一个「响应拒绝、状态已变」的假拒绝。`channels.submit`（`:360-362`）因提前返回而未执行，
  Round 2 的「空消息 → `normalizeInput('')` → `markReady`」即时旁路确实被切断，但事件流仍被污染，
  且同一请求的 400 与已落盘事件互相矛盾。

`tests/server/strengthen.test.ts:433-457` 只断言状态码 400 与 `error: 'EMPTY_WOLF_CHAT'`；
标题写的「不推进/不准备」没有任何断言，也没有断言事件流里没有 `WOLF_CHAT_POSTED`。
建议把空文本检查移到 `registry.submit` **之前**（或在 `registry.submit` 内部按 action 校验），
并在该用例里补「提交前后 `WOLF_CHAT_POSTED` 数量不变」的断言。

#### 3.3 聊天室无「跳过」（通过）

`src/client/components/NightAction.tsx:65-116` 的 `pending === 'chat'` 分支没有「跳过」按钮；
表单只在 `text.trim() !== ''` 时调用 `onChat`（`:100-105`），`App.tsx:380` 只把非空文本发成
`WOLF_CHAT`。客户端 grep 也只剩 `NightAction` / `App` 两处 `onChat`，没有聊天室跳过路径。
这一子项 **PASS**。

### 4. Round 3 总结

- **B1 闭合**：代码与用例都对，超时分支不再在重投提交 `abstain`；仅剩「没有锁死第一个并列者」的
  测试强度小缺口（非阻塞）。
- **B3 未闭合**：`?fast=1` 仍可绕过 5/30 秒的单一来源；空 `WOLF_CHAT` 的 400 发生在事件落盘之后。
  前者直接违反用户本轮的验收口径，后者是同一路径上的真实状态污染。
- 因此 **Status 保持 `Changes requested`**，不改 `RFCS.md` 的状态列；等 B3 两处修完后再复核。
- 本轮未新增冲突，C-238 继续 Open；C-235 / C-237 的既有状态不变。

