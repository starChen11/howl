# RFC-017 评审 · 狼队投票决定刀谁

> **评审会话**：Round 1 独立 subagent（`agent-67`），全新上下文；没有参与 RFC-017 的 RFC、测试或代码写作。
> **日期**：2026-11-20
> **评审时 HEAD**：`73adac3`（`feat(rules): 狼刀改为狼队投票（RUL-13 / RFC-017）`）；`git status --porcelain` 为空。
> **RFC 前置**：RFC-005 `Reviewed`；RFC-003 当前为 **`Spec changed`**（见 C-229），严格按 AGENTS.md 硬规则 2 不满足「前置必须是 `Implemented` / `Reviewed`」。
> **结论**：**`Changes requested`**
> **整体风险**：**High**

## Round 1 -- 2026-11-20

**结论：Changes requested · Overall Risk Level: High**

六条阻塞（按影响排序）：

1. **C-216 · 默认（LLM）路径仍然是 `WOLF_KILL`，AI 狼根本不会逐票投票。** `createLlmAgent` 把模型的 `kill` 决策经 `toAction` 映射成 `WOLF_KILL`，而 `NIGHT_WOLVES` 又接受这个旧动作；`DecisionSchema` 没有 `wolf-vote`，提示词的可选动作列表也只有 `kill`。实测：在生产路径下跑一局，`WOLF_VOTE_CAST` **0 条**、`WOLF_KILL_CHOSEN` 2 条；玩家是狼时第一夜被问过一次、第二夜不再被问，提交的 1 票被后续 AI 的 `WOLF_KILL` 覆盖。AC-7 / AC-9 在默认产品模式下不成立。
2. **C-217 · 活着的 `WOLF_KILL` 入口让单狼决定刀口。** `transitions.ts:26` 仍把 `WOLF_KILL` 放在 `NIGHT_WOLVES` 的允许集里，`night.ts:108-146` 只校验「提交者是存活狼」，不校验投票轮次；`routes/games.ts:337-343` 仍然兑现这个动作，`App.tsx:335` 也保留 `pending === 'kill'` 时发 `WOLF_KILL` 的分支。引擎层任何存活狼、当前单机下玩家自己的狼席，都可以在投票开始前或投票中途用一次 API 调用直接下刀，绕过 RUL-13。RFC-017 §5 要求「界面与 AI 不产生它」，生产 AI 实际产生它；这是 RULES（RUL-13）与 RFC-017 兼容条款的冲突。
3. **C-218 · 新一夜没有清空 `wolfVotes` / `wolfRunoff`，上一夜票会漏进下一夜。** `applyPhaseChanged` 进入 `NIGHT_WOLF_CHAT` 时清掉 `night` / `votes` / `wolfChat` 等，却没有清掉 RFC-017 新增的两个派生字段（`apply.ts:139-149`）。实测：先 `WOLF_VOTE`、再兼容路径 `WOLF_KILL` 后，状态已进入 `NIGHT_SEER` 但 `wolfVotes` 仍是 `[{seat:2,target:1}]`。下一夜 `nextActor` 会以为该狼已经投过票而跳过它；如果该狼白天已经出局，旧票还会被算进新的唱票，导致错误刀口。生产 LLM 路径正好会触发这条混合路径（玩家先投、AI 后 `WOLF_KILL`）。
4. **C-219 · TEST-STRATEGY 声称已存在的 AC-6 / AC-7 / AC-8 测试并不存在。** `TEST-STRATEGY.md:483-493` 三行都写 `existing`，但服务端 / 客户端测试里没有任何狼队投票用例；`WOLF_VOTE` 的测试只集中在 `tests/engine/wolf-vote.test.ts`、shared 契约用例与 e2e 辅助循环；`tests/server/project/*` 没有任何 WOLF_VOTE 投影断言，`tests/server/orchestrator.test.ts` 没有玩家当狼的用例，`tests/client/shoot.test.tsx` 仍只测旧的 `pending: 'kill'`。这是硬规则 3「测试计划早于实现」的实际后果：计划本身也没有被执行。
5. **C-220 · AC-8 的界面不显示「当前/实时」票型。** `App.tsx:306-311` 把**整局**所有 `WOLF_VOTE_CAST` 事件都塞给 `NightAction`，没有按「最近一次 `WOLF_VOTE_REVEALED` 之后」截断，所以第二夜会把第一夜的票显示成「当前票型」。另外 `App.tsx:298-304` 只在 `pending` 非空时挂载 `NightAction`；玩家投完票后 `pending` 变 null，面板消失，看不到 AI 队友正在投的票，用户选择的「实时可见」没有落地。临时渲染探针两条都复现了。
6. **C-229 · 前置状态与硬规则 2 不一致。** RFC-017 声明依赖 RFC-003 / RFC-005（`RFCS.md:82`），但 RFC-003 现在是 `Spec changed`（`RFCS.md:42`），不是 `Implemented` / `Reviewed`。这不是代码缺陷，但按项目流程不能直接进入 `Reviewed`；需要一次 RFC-003 复核或用户明确裁决。

> 另有 8 条非阻塞问题（C-221 ~ C-228）：1 条投影边界硬化、7 条测试/文档/维护性问题。详见 §4。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `73adac3`，工作树 clean。

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm test
 Test Files  92 passed (92)
      Tests  800 passed (800)
   Duration  72.59s
POST_PROBE_TEST_EXIT=0

$ pnpm build
✓ built in 77ms（client）
✓ built in 18ms（server）
BUILD_EXIT=0

$ pnpm test:e2e
  18 passed (40.4s)
```

e2e 的 `webServer.env` 显式设置 `HOWL_FAKE_AI=1`（`playwright.config.ts:42-45`），所以这 18 条全部只跑 `scriptedAgent`，**不能证明默认 LLM 路径会投票**。

补充：

```
$ pnpm exec vitest run --project unit --coverage
 Test Files  74 passed (74)
      Tests  669 passed (669)
All files        |   96.73 |    92.98 |    97.5 |   97.19
COVERAGE_EXIT=0

$ HOWL_FAKE_AI=1 pnpm selfplay --games=100 --seed=42 --out=/tmp/howl-rfc017-selfplay
跑完 100 局：成 100 / 败 0；狼人胜率 90.0%；平均 83.4 条事件、0.0 秒
SELFPLAY_EXIT=0
```

`pnpm test:perf` 未运行：RFC-017 不改变首屏预算或打包产物，不属于本 RFC 的门禁；这不影响本评审的阻塞判断。

---

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本评审采用其中适用的检查：核心循环与状态机、响应式与可访问性、浏览器主路径、数据模型与事件流、安全与视野。显式跳过：平台商店认证、帧预算与目标硬件、手柄、存档版本化、账号登录、按资源授权、SEO、离线/多端同步（与 `PRD.md:20-49` 一致）。`pnpm test:perf` 不适用（见 §0）。

---

### 2. 逐条 AC 复核

| AC | 结论 | 证据 / 回归时哪个测试会红 |
|---|---|---|
| **1** 三狼各一票，唯一最高票成为 `WOLF_KILL_CHOSEN` 目标并推进相位 | **PASS** | `tests/engine/wolf-vote.test.ts:22-45` 构造 2:1，断言 `WOLF_VOTE_REVEALED.votes` 长度为 3、`WOLF_KILL_CHOSEN.target` 为多数目标、相位不再是 `NIGHT_WOLVES`。该用例不会在「没有唱票」或「相位不推进」时继续绿。 |
| **2** 三人各投不同 → `tied` 非空、进入 `NIGHT_WOLF_RUNOFF` | **PASS** | `wolf-vote.test.ts:47-63` 断言 `state.phase === 'NIGHT_WOLF_RUNOFF'` 且 `state.wolfRunoff` 等于三个候选排序。 |
| **3** 重投只能投并列者；投其他人 `INVALID_RUNOFF_TARGET` 且相位不变 | **PASS** | `wolf-vote.test.ts:65-90` 先造出平票，再投并列者以外的席位；断言第一条事件是 `REJECTED`、code 为 `INVALID_RUNOFF_TARGET`、phase 仍为 `NIGHT_WOLF_RUNOFF`。注意该用例开头有一段无效的 `current` 构造后 `void current`，见 C-225。 |
| **4** 重投僵持 → 取最小席位，对局能继续 | **PASS** | `wolf-vote.test.ts:92-110` 断言 `WOLF_KILL_CHOSEN.target === tied[0]` 且相位离开 runoff。**变异探针 M1** 把兜底条件改成永不成立后，只跑这个文件 → **1 failed / 5 passed**，失败点正是 `:107`，说明这条测试不是空转。 |
| **5** 重复 / 投队友 / 非狼投票三种拒绝码 | **PASS** | `wolf-vote.test.ts:112-128` 断言 `WOLF_KILL_WOLF`、`WOLF_VOTE_DUPLICATE`、`NOT_YOUR_TURN`。`TARGET_NOT_ALIVE`（`night.ts:209-218`）没有测试覆盖，但不在本 AC 列出的三种里（C-224）。 |
| **6** 票型事件只对狼可见；好人的投影/事件流没有 `WOLF_VOTE_*` | **行为 PASS / 回归锁 FAIL** | 正常路径实测：好人的 `project({pending: null})` 在平票夜晚 `privateVoteCount=0`、`publicVoteCount=0`；狼的投影有 4 条。HTTP 的 `?pending=` 也不接受 `wolf-vote` / `wolf-runoff`（`PendingQuerySchema`，`src/shared/api.ts:44-46`），当前没有正常泄漏路径。**但没有任何官方测试**：`TEST-STRATEGY.md:490` 写 `existing`，`tests/server/project/*` 没有 WOLF_VOTE 断言。**M2b** 只把 `WOLF_VOTE_CAST.visibleTo` 改成 `'public'`，`--project unit` 仍然 **74 files / 669 tests 全绿**，说明这条可见性没有回归锁。 |
| **7** 玩家是狼时被逐票询问并通过输入通道提交 `WOLF_VOTE` | **默认模式 FAIL / 脚本 AI 下 PASS** | 脚本 AI 路径实测：玩家 2 号是狼，`runGame` 在 `NIGHT_WOLVES` 向输入通道要 `kind=action`，并产出 `WOLF_VOTE`；`scriptedAgent` 三票都落盘。**默认 LLM 路径实测**：同一玩家第一夜被问、第二夜不再被问；`WOLF_VOTE_CAST` 只有 1 条，`WOLF_KILL_CHOSEN` 有 2 条（其中第一夜是 AI 的 `WOLF_KILL`）。`TEST-STRATEGY.md:491` 声称 `orchestrator.test.ts` 有这条，仓库里没有。 |
| **8** 界面显示实时票型；重投阶段只有并列者、没有弃权 | **FAIL** | 并列者列表本身正确（`App.tsx:318-326` + `legalTargetsOf` 的 `wolf-runoff` 分支）；但票型显示有两个缺陷：① `App.tsx:306-311` 取全部 `WOLF_VOTE_CAST`，不按轮次截断，第二夜会显示第一夜的票；② 只有 `pending` 非空才挂载 `NightAction`（`App.tsx:298-304`），玩家投完自己的票后面板消失，看不到队友的实时票。临时渲染探针复现：在 `privateEvents` 放 seq 2（上一夜）和 seq 10（当前夜）两条 CAST，`当前票型` 同时显示两条；`pending: null` 时 `queryByRole('list', {name:'当前票型'})` 为 `null`。`TEST-STRATEGY.md:492` 声称 `tests/client/shoot.test.tsx` 覆盖，实际该文件只测 `pending: 'kill'` 与 `pending: 'chat'`（`tests/client/shoot.test.tsx:100-170`）。 |
| **9** 旧 `WOLF_KILL` 仍可推进（兼容），但产品流程只产生 `WOLF_VOTE` | **默认模式 FAIL** | 引擎兼容用例通过（`wolf-vote.test.ts:130-140`）；但默认产品流程不是只产生 `WOLF_VOTE`：`toAction` 把模型在 `NIGHT_WOLVES` 的 `kill` 决策映射为 `WOLF_KILL`（`src/server/llm/to-action.ts:109-118`），提示词也仍把 `kill` 列为可选动作（`src/server/llm/prompts/base.ts:138-141`）。实测默认路径 `WOLF_VOTE_CAST=0`。RFC-017 §5 明文写「界面与 AI 不产生它」（`RFCs/RFC-017-wolf-team-vote.md:86`）。 |

---

### 3. 阻塞项详述

#### C-216 · 默认 LLM 路径没有接入狼队投票（AC-7 / AC-9）

**证据链**

1. 动作契约没有 `wolf-vote`：`DecisionSchema.action` 是 `kill` / `check` / ... / `chat`（`src/server/llm/schema.ts:9-23`）。
2. 阶段映射只认 `NIGHT_WOLVES` 上的 `kill`，且 `buildWithTarget` 把它建成 `WOLF_KILL`：

   ```ts
   // src/server/llm/to-action.ts:37-40
   case 'kill':
     return ctx.phase === 'NIGHT_WOLVES';
   // src/server/llm/to-action.ts:115-118
   case 'kill':
     return { type: 'WOLF_KILL', ts, seat: ctx.seat, target };
   ```

3. 生产入口默认 `agentKind = 'llm'`（`src/server/index.ts:32`），`createLlmAgent` 把模型决策交给 `toAction`（`src/server/ai/agent.ts:134-143`）。
4. 提示词同时给出矛盾信息：`当前需要你做出：wolf-vote 决策`，下一行可选动作仍是 `kill`（`src/server/llm/prompts/base.ts:138-141`）；规则书仍写「狼每晚共同选择一名玩家袭击」，没有每人一票 / 平票重投 / 重投候选（`src/server/llm/prompts/rules.ts:24-34`）。
5. 现有测试反向锁死旧行为：`tests/server/llm/to-action.test.ts:107-112` 断言 `kill` → `WOLF_KILL`；`tests/server/llm/prompts.test.ts:132-138` 断言可选动作含 `kill` 且是 12 个。

另外，`phaseAllows('kill')` 只允许 `NIGHT_WOLVES`；模型若在 `NIGHT_WOLF_RUNOFF` 返回 `kill`，`toAction` 返回 `{ reject }`，`createLlmAgent` 回 `{ action: undefined }`，`runGame` 遇到 undefined 动作会直接 `break`（`orchestrator.ts:222-238`），对局会卡在重投。即使 C-216 只把 `kill` 映射到 `WOLF_VOTE` 而忘了 `NIGHT_WOLF_RUNOFF`，这条仍会成立。

**实跑证据**

```
$ pnpm exec tsx -e "toAction({action:'kill',target:2,reason:'x'}, {seat:1, phase:'NIGHT_WOLVES', day:1, legalTargets:[2,3]}, 1)"
{"action":{"type":"WOLF_KILL","ts":1,"seat":1,"target":2}}

$ pnpm exec tsx -e "... phase:'NIGHT_WOLF_RUNOFF' ..."
{"reject":"阶段 NIGHT_WOLF_RUNOFF 不接受动作 kill"}
```

用 `createLlmAgent` + 注入 `decideFn`（返回 `kill`）跑 `runGame`：

```
WOLF_VOTE_CAST count 0
WOLF_KILL_CHOSEN [ { target: 1 }, { target: 3 } ]
REJECTED []
```

玩家为狼（2 号）时：

```
playerPrompts action@NIGHT_WOLF_CHAT | action@NIGHT_WOLVES | speech@DAY_SPEECH |
              vote@DAY_VOTE | action@NIGHT_WOLF_CHAT | speech@DAY_SPEECH | vote@DAY_VOTE
WOLF_VOTE_CAST count 1
WOLF_KILL_CHOSEN [ { target: 1 }, { target: 3 } ]
```

第一夜玩家确实被问了一次并投出一票，但紧接着的 AI 狼 `WOLF_KILL` 直接结束夜晚；第二夜 `nextActor` 因 C-218 的残留票把玩家当成「已投票」，不再问。AC-7 的「逐票询问」在默认模式下不成立。

**修法建议**（任一实现方案都要同步改动）：把 `NIGHT_WOLVES` / `NIGHT_WOLF_RUNOFF` 上的 `kill` 映射为 `WOLF_VOTE`（保留 `kill` 作为模型词汇），或新增 `wolf-vote` 决策动作；同步 `DecisionSchema`、规则书、`renderEvent`（识别 `WOLF_VOTE_CAST` / `WOLF_VOTE_REVEALED`），并更新 `to-action` / `prompts` 的测试。若改 `DecisionSchema`，RFC-006 必须标 `Spec changed`；若只改映射，RFC-006 的「kill 动作」语义也要在 RFC-017 §8 记录，并清理 RFC-017 §5 与实际不符的「AI 不产生它」。

#### C-217 · 活着的 `WOLF_KILL` 可以单人决定刀口（RUL-13 冲突）

`transitions.ts:25-26` 把 `WOLF_KILL` 留在 `NIGHT_WOLVES` 的允许集里；`night.ts:108-146` 的 handler 不检查 `state.wolfVotes` 是否为空、也不检查是否还有其他存活狼未投票。因此：

- 引擎层任意存活狼提交 `WOLF_KILL` 一次，就立即产出 `WOLF_KILL_CHOSEN` 并推进相位；当前单机 API 只允许玩家自己的席位，所以是玩家当狼时用一次请求即可决定；
- 玩家可以在投票开始前、或自己投完票后、或要求 AI 投票的中途提交，绕过整个票型；
- 如果先投了 `WOLF_VOTE` 再 `WOLF_KILL`，还会留下 C-218 的残票。

路由仍然接受它（`routes/games.ts:337-343`），UI 也保留了 `pending === 'kill'` → `WOLF_KILL` 的分支（`App.tsx:335`）。正常可点击路径里 `pending` 由服务端默认值决定，`pendingForPhase` 已不再返回 `kill`（`orchestrator.ts:102-104`），所以普通 UI 不会走到它；但手工 `?pending=kill` 仍通过 `PendingQuerySchema`（`src/shared/api.ts:44-46`），且直接 POST 不受影响。更关键的是，**生产 AI 确实会产生它**（C-216），所以 RFC-017 §5 的「界面与 AI 不产生它」已被证伪。

**修法建议**：`WOLF_KILL` 若只为旧回放/旧测试保留，应从 `NIGHT_WOLVES` 的实时转移表中移除，或用显式兼容开关 / 仅 replay API 接受；若必须保留，至少拒绝「已有 `WOLF_VOTE`」或「已进入投票轮」的 `WOLF_KILL`，并让 `WOLF_KILL` 清掉/不产生 `wolfVotes`。同时删除 UI 的 `pending==='kill'` 分支与 `PendingQuerySchema` 的 `kill`（或证明它仅用于旧客户端）并更新旧测试。

#### C-218 · `wolfVotes` / `wolfRunoff` 未在新一夜清空（派生字段不变量）

`apply.ts:128-129` 的注释说「进入 `NIGHT_WOLF_CHAT` 意味着新的一夜开始，清空本夜暂存（C-18 的派生字段规则）」，但 `:139-149` 的清理列表只有 `night`、`pendingDeaths`、`wolfChat`、`votes`、`runoff`、`lynched`；RFC-017 新增的 `wolfVotes` / `wolfRunoff` 漏了。

实跑：

```
after WOLF_VOTE  phase=NIGHT_WOLVES  wolfVotes=[{"seat":2,"target":1}]
after WOLF_KILL  phase=NIGHT_SEER    wolfVotes=[{"seat":2,"target":1}]
```

后续后果（按严重度）：

1. 下一夜 `nextActor` 的 `voted` 集合包含上一夜投过的狼，跳过该狼；玩家当狼时直接表现为「第二夜不让我投票」。
2. 若该狼白天已出局，下一夜唱票仍把这条旧票算进 `votes.length` 和 `counts`，可能提前唱票或选中错误目标。
3. 玩家若通过 API 再次提交 `WOLF_VOTE`，会收到 `WOLF_VOTE_DUPLICATE`，因为 `state.wolfVotes` 里还有上一夜的记录。

这个 bug 与 C-216 / C-217 联合出现：默认 LLM 路径下玩家先投、AI 再 `WOLF_KILL`，就正好把残票留到下一夜；上面的玩家当狼实跑已经复现了第 1 条。

**修法建议**：在 `applyPhaseChanged` 进入 `NIGHT_WOLF_CHAT` 时 `delete next.wolfVotes; delete next.wolfRunoff;`（与 `votes` / `runoff` 同组），并在 `WOLF_KILL` 兼容路径上清空本夜票。增加一个「混合路径跨两夜」的引擎测试：第一夜 `WOLF_VOTE` + `WOLF_KILL` → 第二夜所有存活狼都能投、唱票只算本夜票。

#### C-219 · 计划中的 AC-6 / AC-7 / AC-8 测试不存在

`TEST-STRATEGY.md:483-493` 的 `Exists?` 列：

| 行 | 声称 | 实际 |
|---|---|---|
| `:490` AC-6 | `tests/server/project/*` 好人投影不含 `WOLF_VOTE_*` | `grep -R WOLF_VOTE tests/server` 无结果；`tests/server/project/night-visibility.test.ts` / `partition.test.ts` 仍走 `WOLF_KILL`。 |
| `:491` AC-7 | `tests/server/orchestrator.test.ts` 玩家是狼被问且提交 `WOLF_VOTE` | 文件中没有 `WOLF_VOTE`；只有 C-127 白天重投与猎人开枪用例。`isPlayerPhase` 的相位清单（`tests/server/orchestrator.test.ts:484-493`）也没有 `NIGHT_WOLF_RUNOFF`。 |
| `:492` AC-8 | `tests/client/shoot.test.tsx` 投票界面显示实时票型、重投只有并列者 | 该文件只有 `pending: 'chat'`、`pending: 'kill'` 的旧用例，没有 `wolf-vote` / `wolf-runoff`。 |

此外 `tests/server/orchestrator-full.test.ts:73-74` 的整局脚本仍用 `WOLF_KILL`，`tests/client/shoot.test.tsx:100` 的用例名还叫「刀人提交 `WOLF_KILL`」。这解释了为什么 800 条测试全绿却漏掉 C-216 / C-218：**官方集成路径根本没有走新投票**。

**修法建议**：补三条官方测试并把 `Exists?` 改成真实值：
- 投影：跑一个含 `WOLF_VOTE_CAST` + `WOLF_VOTE_REVEALED` 的夜晚，对每个好人席位断言 `privateEvents` / `publicEvents` 中无 `WOLF_VOTE_*`；对每个狼席位断言可见。
- 编排：玩家是狼的完整一局，记录 `input.read` 的 `kind/phase`，断言 `NIGHT_WOLVES` 和（若平票）`NIGHT_WOLF_RUNOFF` 都被问且提交 `WOLF_VOTE`；同时断言 `decide` 没有替玩家席位提交。
- UI：`pending: 'wolf-vote'` 显示当前票型；`pending: 'wolf-runoff'` 只列 `wolfRunoff`、无弃权；并补「上一夜票不出现」的过滤用例。

#### C-220 · AC-8 界面票型是「整局历史」且不在非本人轮次显示

`App.tsx:306-311`：

```tsx
wolfVotes={ctx.privateEvents
  .filter((event) => event.type === 'WOLF_VOTE_CAST')
  .map(...)}
```

没有以最近一条 `WOLF_VOTE_REVEALED` 为界。临时 jsdom 探针（已删除）用两条 CAST（seq 2 上一夜、seq 10 当前夜）渲染后，`当前票型` 列表同时出现 `2 号投 4 号` 与 `3 号投 5 号`；第二夜玩家会把上一夜的票当成当前票。

`App.tsx:298-304` 只在 `pending` 为 `chat/kill/wolf-vote/wolf-runoff/check/witch` 时挂 `NightAction`。玩家投完自己那一票后，`nextActor` 变成 AI，GET 的 `defaultPending` 变 `null`（`routes/games.ts:104-106`），面板卸载；玩家看不到队友随后投的票，用户选择的「实时可见」（RFC-017 §2.4 / §8 D-2）没有实现。

**修法建议**：票型只取「最近一条 `WOLF_VOTE_REVEALED` 之后」的 CAST；若要在非本人轮次也显示，需要在投影里给狼观察者一个不依赖 `pending` 的只读票型字段（或让 `pending` 在 `NIGHT_WOLVES` 对所有 wolf 观察者为 `wolf-vote`，但必须同时处理 `legalTargets` 的角色边界，见 C-221），并把「实时」的验收标准写进 `TEST-STRATEGY`。

#### C-229 · 前置 RFC-003 仍是 `Spec changed`，硬规则 2 的状态门禁不成立

- `RFCS.md:42`：RFC-003 `Spec changed`。
- `RFCS.md:82`：RFC-017 的直接前置是 `003, 005`。
- `AGENTS.md` 硬规则 2 / `WORKFLOW.md` 阶段 7：前置必须是 `Implemented` 或 `Reviewed`；`Spec changed` 不算。

本次变更给 RFC-003 增加了 `WOLF_VOTE` / `WOLF_VOTE_CAST` / `WOLF_VOTE_REVEALED` / `NIGHT_WOLF_RUNOFF` 的契约（`RFCs/RFC-003...:406-410`），这些内容实际上由 RFC-017 实现；但 RFC-003 的状态没有回到 `Reviewed`。这不是代码可以修的，必须由用户裁决：要么补一次 RFC-003 的窄范围复核，要么在 `RFCS.md` 明确记录「RFC-017 同时承担 RFC-003 的这次规格变更」并接受状态例外。**在此项解决前，RFC-017 不应进入 `Reviewed`。**

---

### 4. 非阻塞项

#### C-221 · `project()` 对「角色不匹配的 pending」没有防御，存在潜在身份泄漏

`src/server/project/targets.ts:35-43` 的 `wolf-vote` 分支直接用 `state.seats` 的真实 `role` 过滤：

```
good observer=1, pending='wolf-vote' → legalTargets=[1,4,5,6,7,9]
（本局狼是 2、3、8）
```

对好人观察者传入 `pending='wolf-vote'` 时，`legalTargets` 直接排除了三个狼席，等于泄露狼队身份；`wolf-runoff` 同样会暴露 `state.wolfRunoff`。当前所有生产调用点都不会给好人传这个 `pending`（`routes/games.ts:104-106` 只给当前行动者；`orchestrator.ts:205-210` 只给 `nextActor` 返回的狼；`selfplay` 的投影只在玩家输入时构造），`PendingQuerySchema` 也拒绝 `wolf-vote` / `wolf-runoff`，所以**不是当前可达的泄漏**。但 `project()` 是 SEC-5 / ARCH-8 的安全边界，不应该依赖调用方永远传对 `pending`。建议在 `legalTargetsOf` 里先判断观察者角色（非狼一律返回 `[]`），或在 `project` 入口把角色不匹配的 `pending` 归一为 `null`，并补一个「好人 + wolf-vote pending」的反向测试。C-220 的修法如果让所有狼观察者都拿到 `wolf-vote`，这条就会从潜在问题变成真实约束。

#### C-222 · `WOLF_VOTE_CAST` 的可见性没有回归锁

`tests/engine/wolf-vote.test.ts:37` 只断言 `WOLF_VOTE_REVEALED.visibleTo === 'wolves'`；没有断言 `WOLF_VOTE_CAST`，也没有「好人投影/事件流看不到」的测试。变异探针 M2b 只把 CAST 的 `visibleTo` 改成 `'public'`，`vitest --project unit` **74 files / 669 tests 全绿**；M2 同时改两条时只有 REVEALED 的属性断言失败（1 failed / 668 passed）。这说明 AC-6 的回归锁只覆盖了半条事件和一半属性。

#### C-223 · 文档与实现漂移

- **PRD**：D46 被追加到 `## 变更记录` 表（`PRD.md:424`），而不是 `## Decisions` 表（D1-D45 在 `:310-354`）；它占用了「日期/版本/变更」四列，读者会把它当成一条变更记录。PRD 头部仍是 `v0.4 · 最后更新 2026-11-17`（`:3`），没有 v0.5 / 2026-11-20。
- **RULES**：头部仍是 `v1.3 · 最后更新 2026-11-18`（`RULES.md:3`），但变更历史已有 v1.4（`:303`）；RUL-13 插在 RUL-11 与 RUL-12 之间（`:245-246`），不是 append-only 的末尾。
- **RFC-017**：§6 写「见下方 `## 8. Implementation Notes`」（`:90`），实际标题是 `### 8`；§8 的「已知缺口」只说「已在 `CHANGE-REQUEST-011` 记录」（`RFCs/RFC-017-wolf-team-vote.md:117-120`），没有 §8 可引；`TEST-STRATEGY.md:495` 却引用 `CHANGE-REQUEST-011` §8 与 `RFCs/RFC-017` §8——后者存在但标题是 `### 8`，前者不存在（`CHANGE-REQUEST-011.md` 只有 §0~§7）。
- **RFC-006**：本次新增 `wolf-vote` pending / 每狼一票语义，但 `RFCS.md` 只把 RFC-001/003/010 标 `Spec changed`，没有标 RFC-006。如果 C-216 的修法改动 `DecisionSchema`（新增动作），RFC-006 也必须 `Spec changed`。
- **README**：`README.md:11` 写「15 个 `Reviewed`、3 个 `Spec changed`、1 个 `Implemented`」（15+3+1=19，和 17 个 RFC 对不上；实际是 13 Reviewed / 3 Spec changed / 1 Implemented）、「`RULES.md` 77 条工程规则（含 RUL-1~RUL-12）」（实际 78 条、含 RUL-13）、覆盖率 97.14 / 93.11（本轮实测 97.19 / 92.98）。
- **FEATURES**：F3 仍写「狼队内部先协商后只提交一个击杀目标」（`FEATURES.md:64`），F10 仍写「再提交击杀目标」（`:71`），没有同步「每名存活狼一票、平票重投」。最终目标仍是一个，但验收标准没有覆盖投票/重投/僵持兜底，属于需求追踪缺口。RFC-017 的 `**Features**: F9, F10` 也没有列 F3（夜晚角色行动），但改变的正是 F3 的击杀语义；`RFCS.md:56` 的功能覆盖同样漏了 F3。
- **RFC-017 §3 交付物**没有列出 `src/server/llm/{schema,to-action,prompts/*}`，这正是 C-216 被漏掉的结构性原因；§8 也没有 `Files changed` 列表（评审需要，见 `REVIEW-PROMPT.md`）。

#### C-224 · `TARGET_NOT_ALIVE` 分支无测试；死狼不投票只有间接覆盖

`night.ts:209-218` 的 `TARGET_NOT_ALIVE` 是 `night.ts` 中唯一未被覆盖率覆盖的行（`night.ts` 行覆盖 99.18%，未覆盖行 210）。死狼不投票本身正确（`aliveSeats`），但 `tests/engine/wolf-vote.test.ts` 没有死狼用例；**M3** 把 `aliveSeats` 改成 `state.seats` 后，整局测试有 13 条失败（4 个文件），说明这个行为被下游整局用例间接保护，但没有一条能直接说明「死狼不投票」的定向断言。建议补一个「三狼中一狼已死，只有两名存活狼投票」的用例，同时覆盖 `TARGET_NOT_ALIVE`。

#### C-225 · 复盘 / 真相视图没有消费新的投票事件

- `src/server/replay/snapshot.ts:77-125` 的 `buildTimeline` 只处理 `WOLF_KILL_CHOSEN`，`WOLF_VOTE_CAST` / `WOLF_VOTE_REVEALED` 落入 `default: break`；复盘时间线看不到谁投了谁、是否进入重投。
- `src/server/view/truth.ts:58-70` 把 `WOLF_KILL_CHOSEN` 记在每个存活狼头上（「袭击了 X」），但没有展示每个狼的实际票；当某个狼投了 A、最终刀口是 B 时，真相视图会让人误以为该狼投了 B。

这不违反 RFC-017 的 9 条 AC，但 RFC-014 的「完整事件时间线」和 RFC-013 的「每个 AI 每一轮推理与投票动机」在语义上被新事件改变了；建议把这两份 RFC 列入 `Spec changed` 或在 RFC-017 §8 记录「复盘暂不展示狼队票型」的取舍。

#### C-226 · selfplay / 旧脚本仍保留 `WOLF_KILL` 分支，`legalActionFor` 没有 `wolf-vote`

- `src/server/selfplay/scripted-player.ts:69-72`、`:140-145` 仍有 `case 'kill'` → `WOLF_KILL`；`legalActionFor` 没有 `wolf-vote` / `wolf-runoff` 分支，遇到这些 pending 会返回 `undefined`。
- `tests/server/orchestrator-full.test.ts:73-74` 的整局脚本也仍用 `WOLF_KILL`。
- 当前 `scriptedAgent` 会先给 `WOLF_VOTE`，所以 100 局 selfplay 能跑完；但 selfplay 的 `decide` 回退路径（`runner.ts:123-131`）在模型返回非法动作时调用 `legalActionFor`，在 `NIGHT_WOLVES` 会拿到 `undefined` 并让对局停住。建议把 selfplay 的脚本策略与 `legalActionFor` 一起更新，或至少显式拒绝旧 `kill`。

#### C-227 · 旧测试与相位清单漂移

- `tests/server/orchestrator.test.ts:484-493` 的 `isPlayerPhase` 白名单没有 `NIGHT_WOLF_RUNOFF`；实现已加（`orchestrator.ts:136`），但这条测试不会在实现退化时变红。
- `tests/client/shoot.test.tsx:100` 的用例名仍说「刀人提交 `WOLF_KILL`」，`:137-170` 测 `pending: 'kill'` 的旧 UI；这既不是新 UI 的回归锁，也会在删除旧路径时被迫修改。

#### C-228 · 测试内的死代码

`tests/engine/wolf-vote.test.ts:67-76` 先构造了一组 2:1 的 `current`，注释说「这里实际 2:1，用另一个构造」，然后 `void current` 重新造状态。这段不参与断言，容易让后续维护者误以为重投分支被覆盖。建议删掉，或改成真正的三票各不同断言。

---

### 5. 变异探针与恢复

所有探针都用 `/tmp/howl-rfc017-r1/backup/` 的文件备份恢复，**没有使用 `git checkout` / `git restore`**，没有 `git commit`。探针前先比对 SHA-256；探针后用 `cp -p` 恢复并再次比对。

| 探针 | 改动 | 结果 |
|---|---|---|
| **M1** | `night.ts` 的僵持兜底条件 `tied.length === candidates.length` → `tied.length === -1` | `wolf-vote.test.ts` **1 failed / 5 passed**，失败点 `:107`（AC-4）；恢复后 6/6 绿 |
| **M2** | 两条 `WOLF_VOTE_*` 的 `visibleTo` 都改成 `public` | `--project unit` **1 failed / 668 passed**，失败点 `wolf-vote.test.ts:37`（REVEALED 属性）；说明 REVEALED 有一半锁 |
| **M2b** | 只把 `WOLF_VOTE_CAST` 改成 `public` | `--project unit` **74 files / 669 tests 全绿** → CAST 可见性无锁（C-222） |
| **M3** | `tallyWolfVotes` 的 `aliveSeats(state).filter(...)` → `state.seats.filter(...)`（把死狼算进应投票人数） | `--project unit` **13 failed / 656 passed**（`death-matrix`、`orchestrator`、`selfplay`、`game-loop`），说明死狼不投票被整局用例间接保护；恢复后全绿 |
| **M4** | `to-action.ts` 的 `case 'kill'` 映射 `WOLF_KILL` → `WOLF_VOTE` | `to-action.test.ts` **1 failed / 10 passed**，失败点 `:110`：旧测试明确锁死 `WOLF_KILL`，所以改对的行为反而会红（C-216） |
| **P-AI** | 不改源码；`createLlmAgent` + 注入返回 `kill` 的 `decideFn` 跑 `runGame`（玩家好人 / 玩家狼各一次） | 玩家好人：`WOLF_VOTE_CAST=0`、`WOLF_KILL_CHOSEN=[1,3]`；玩家狼：`WOLF_VOTE_CAST=1`、`WOLF_KILL_CHOSEN=[1,3]`，第二夜不再问玩家 |
| **P-PROJ** | 不改源码；用真实 `step` 造三票各不同的平票夜，再对好人/狼/观察者投影 | 好人 `privateVoteCount=0`、`publicVoteCount=0`；狼 `privateVoteCount=4`；好人 + `pending='wolf-vote'` 的 `legalTargets=[1,4,5,6,7,9]`（狼为 2/3/8） |
| **P-STATE** | 不改源码；真实 `step`：先 `WOLF_VOTE` 再 `WOLF_KILL` | 两件事后 `wolfVotes` 仍为 `[{seat:2,target:1}]`；`phase=NIGHT_SEER` |
| **P-UI** | 临时 `tests/client/_review-rfc017-probe.test.tsx`（已删除），渲染 `App` 并注入两条不同 seq 的 CAST / `pending: null` | 两条都出现在「当前票型」；`pending: null` 时没有「当前票型」列表。2/2 passed，证明 C-220 |

恢复证明：

```
$ git status --porcelain
(empty)
$ shasum -a 256 src/engine/phases/night.ts src/server/llm/to-action.ts src/server/orchestrator.ts
14c4eaa8574aa830b8ac896095c1fa1ea39c97525a6a317ea432baf76d7dca35  src/engine/phases/night.ts
bd84abd77bc05827bbfb7dd130f19df391d1f883e222727c87e1fa2c03a0c244  src/server/llm/to-action.ts
26b6c08109efccb1fd35fa97cbbe546b1cda1b27cdc00855e60bc3cd0840990c  src/server/orchestrator.ts
```

与 `/tmp/howl-rfc017-r1/backup/` 对应文件的 SHA-256 一致；临时探针文件已删除；恢复后重新跑 `pnpm test` **92 files / 800 tests 全绿**，`typecheck` / `lint` / `format:check` 均 exit 0。工作树 clean，没有 commit。

---

### 6. 各维度结论

#### 6.1 RFC  adherence · **NEEDS WORK**

- AC-1 ~ AC-5：PASS；AC-4 有 M1 证明。
- AC-6：行为 PASS（正常投影无泄漏），但无官方测试，且 `project()` 对角色不匹配的 pending 无防御（C-221/C-222）。
- AC-7：默认 LLM 模式 FAIL（C-216）；脚本 AI 下 PASS。
- AC-8：FAIL（C-220），且计划测试不存在（C-219）。
- AC-9：默认模式 FAIL（C-216/C-217）。
- 缺失功能：默认 LLM 路径的狼队投票（`src/server/llm/*`）、真实实时票型、`wolf-vote` 的回归测试。
- 越界/多余：`WOLF_KILL` 仍作为活动作存在（RFC 允许兼容，但实际造成绕过；见 C-217）。

#### 6.2 RULES 合规 · **FAIL**

- **RUL-13**：默认模式由第一个 AI 狼 `WOLF_KILL` 决定，玩家自己的票被覆盖；引擎层存活狼可单动作下刀（C-216/C-217/C-218）。
- **ARCH-11**：当前正常状态没有未裁决分支；`wolfRunoff===undefined` 的 runoff 状态是异常输入，暂不构成实际违规。
- **DATA-2**：新事件/动作/相位均进入联合类型与运行时列表；PASS。
- **ARCH-3/4/5/6**：引擎仍是纯函数与事件折叠；PASS。
- **DOC-1**：生产 LLM 路径与 RFC-017 §2.4 / §5 不一致，未记入 `## Implementation Notes`；FAIL。
- **OPS-2**：本 RFC 没有新增依赖或脚本；PASS。
- **测试/DoD**：`TEST-STRATEGY` 的三条 `existing` 是假值；硬规则 3 的时序偏离已被承认，但计划内容没有兑现（C-219）。

#### 6.3 SECURITY · **NEEDS WORK**

- 正常投影与 SSE：好人看不到 `WOLF_VOTE_*`；`isVisibleTo('wolves')` 正确（P-PROJ）。
- 事件流：SSE 的 `committedMessages` 不把 `WOLF_VOTE` 当发言消息推送；HTTP 投影按事件可见性过滤；没有发现正常路径泄漏。
- **潜在**：`project()` + `wolf-vote` pending 可把狼名单从 `legalTargets` 排除项反推出来（C-221）；当前不可达，但属于安全边界硬化。
- **规则安全**：`WOLF_KILL` 绕过投票，未来三真人狼局任何一人可单方面决定（C-217）；这正是本 RFC 要解决的原始问题。
- 密钥 / 注入 / XSS：本 RFC 未改动相关代码；无新增风险。

#### 6.4 PERFORMANCE · **PASS**

- 每个狼多一票、每轮多一两条事件；`tallyWolfVotes` 为 O(wolves × votes)，9 人局可忽略。
- 没有新增 LLM 调用、数据库查询或网络请求；`project` 仍按事件流折叠，未引入缓存或额外全量遍历。
- 100 局 fake-AI selfplay 100/100；e2e 18/18。`pnpm test:perf` 不适用（RFC-017 不改首屏与产物预算）。

#### 6.5 MAINTAINABILITY · **NEEDS WORK**

- 生产 LLM 链路的动作/提示/事件渲染没有一起改，留下两套语义（C-216）。
- 旧的 `kill` 客户端分支、`WOLF_KILL` selfplay 分支、`legalActionFor` 的缺失分支，形成死代码与半成品兼容层（C-226/C-227）。
- 新增派生字段没有纳入 `applyPhaseChanged` 的清理列表，破坏 C-18 的「派生字段只由事件折叠」不变量（C-218）。
- 测试计划与测试文件漂移，旧的 `to-action` / `prompts` 测试反而锁死旧行为（C-219/C-227）。
- 文档（PRD D46、RULES 头、README 数字、无 §8 引用、FEATURES F3/F10）需要一次 `/manage-changes` 收口（C-223）。

---

### 7. Open conflicts

| # | 冲突 | 本评审采用 | 待处理 |
|---|---|---|---|
| **O-1** | **RUL-13**（每名存活狼一票）vs **RFC-017 §2.2 / §5 / AC-9**（旧 `WOLF_KILL` 仍被接受；界面与 AI 不产生它） | 按 `PRD > FEATURES > RULES > RFC`：**RUL-13 优先**。兼容路径只能用于旧回放/旧测试，不能让单狼决定刀口；生产 AI 必须投 `WOLF_VOTE`。 | RFC-017 §2.2/§5 与 `CHANGE-REQUEST-011` 需要修正；已登记到 `RFCS.md §8.60`。代码修 C-216/C-217。 |
| **O-2** | **RFC-006** 的决策契约（`kill` → `WOLF_KILL`）vs **RFC-017** 的「AI 也投票」 | 按 RUL-13 / RFC-017 的产品意图：生产 AI 必须能投 `WOLF_VOTE`；RFC-006 未标 `Spec changed` 是文档缺口。 | C-216 修法若改 `DecisionSchema`，把 RFC-006 标 `Spec changed`；若只改映射，在 RFC-017 §8 记录。 |
| **O-3** | **AGENTS.md 硬规则 2**（前置必须 `Implemented`/`Reviewed`）vs **RFC-003 当前 `Spec changed`** | 本轮按变更请求的意图继续评审（RFC-017 实际承担了 RFC-003 的新契约），但不把 RFC-017 标 `Reviewed`。 | 用户裁决：补一次 RFC-003 窄范围复核，或在 `RFCS.md` 明确记录例外。 |
| **O-4** | **PRD D46** 在 `## 变更记录`（`:424`）vs `## Decisions` 表（D1-D45） | 以 D46 的**文本**为准；位置是文档缺陷，不影响代码判断。 | `/manage-changes` 把 D46 移进 Decisions 表并更新 PRD 头部。 |

---

### 8. 总结

**Overall Risk Level: High。** 引擎的票型/唱票/重投/兜底逻辑本身写对了，AC-1 ~ AC-5 有有效测试（M1 能打红 AC-4）；但默认产品模式没有接入狼队投票：LLM 的 `kill` 仍被翻译成 `WOLF_KILL`，第一个 AI 狼单人决定刀口，玩家自己的票被覆盖，第二夜还会因残票被跳过。这不是“少一条测试”，而是 RFC-017 要解决的原始问题在默认路径上仍然存在。

**Summary**：默认 LLM 路径仍是旧 `WOLF_KILL`（C-216），而引擎又保留活 `WOLF_KILL` 入口（C-217），并且新一夜不清空 `wolfVotes`（C-218），三者叠加会让玩家当狼时“第一夜投票无效、第二夜不被询问”。AC-6/7/8 的计划测试不存在（C-219），界面票型也不实时（C-220）。文档侧还有 PRD D46 位置、RULES/README 计数、RFC-006 未标 `Spec changed`、RFC-003 前置状态等漂移（C-223/C-229）。

**Blocking Issues**：

- C-216：默认 LLM 路径不投 `WOLF_VOTE`，AC-7/AC-9 失败。
- C-217：活 `WOLF_KILL` 允许单狼决定，违反 RUL-13。
- C-218：新一夜不清空 `wolfVotes` / `wolfRunoff`，残票跨夜。
- C-219：AC-6/AC-7/AC-8 的计划测试不存在。
- C-220：AC-8 界面票型不实时/跨夜。
- C-229：前置 RFC-003 为 `Spec changed`，硬规则 2 不满足。

**Improvement Suggestions**（非阻塞）：

1. 补投影边界防御（C-221）和 CAST 可见性回归锁（C-222）。
2. 复盘/真相视图消费 `WOLF_VOTE_*`，或明确记录“复盘不展示”（C-225）。
3. 清理 selfplay / 旧客户端 `WOLF_KILL` 死代码（C-226/C-227）。
4. 补死狼/`TARGET_NOT_ALIVE` 定向用例（C-224），删测试死代码（C-228）。
5. `/manage-changes` 收口 PRD D46、RULES/README 计数、FEATURES F3/F10、RFC-017 §8 的 §8 引用与 Files changed（C-223）。

**Suggested status**：**`Changes requested`**。

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-20 | v1.0 | RFC-017 Round 1 评审：门禁 92 files / 800 tests、18/18 e2e、74 files / 669 tests 覆盖、100/100 selfplay；六条阻塞（默认 LLM 仍 `WOLF_KILL`、单狼可绕过投票、`wolfVotes` 跨夜残留、AC-6/7/8 测试缺失、AC-8 界面票型不实时、RFC-003 前置 `Spec changed`）；非阻塞 C-221 ~ C-228。探针 M1/M2/M2b/M3/M4 与 P-AI/P-PROJ/P-STATE/P-UI 全部从 `/tmp/howl-rfc017-r1/backup/` 文件备份恢复，工作树 clean，无 commit。 |
