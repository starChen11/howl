# RFC-004 评审 · 白天发言、投票与胜负判定

> 评审方式：`/review-rfc 004`（独立 subagent，全新上下文）。本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> 基线：`main` @ `d435add`，评审开始时 `git status --porcelain` 为空。
> 权威顺序按 `AGENTS.md` 硬规则 7：`PRD.md > FEATURES.md > RULES.md > RFC > 计划`。

## Round 1 -- 2026-11-18

结论：**Changes requested** · Overall Risk Level: **High**

两条阻塞：

1. **B1 · `DAY_STARTED.diedLastNight` 的顺序把死因（狼刀 / 毒药）公开泄漏**，与 RFC-003 D-3 的「死因不公开」和 `PRD.md:153` 的 FR-9「严禁注入他人夜间行动」冲突。RFC-004 §2.1 / AC-2 自己规定了「按结算顺序」，所以这不是实现手滑，是**规格层的可见性缺口**（C-31）。
2. **B2 · RFC-004 新增 5 个事件里只给 `DAY_STARTED` 补了 Zod payload schema**；`SPEECH` / `SPEECH_SKIPPED` / `VOTE_CAST` / `VOTE_REVEALED` 四个缺失，`PAYLOAD_SCHEMAS` 也没有登记。RFC-001 §2.3 与 C-10 明确「事件 payload 的 schema 由拥有它的 RFC 追加」，RFC-003 的 B3 正是同一类问题且当时按阻塞处理；`tests/engine/events.test.ts:181` 甚至写着“如 SPEECH 归 RFC-004”。

另有 3 条 AC 的测试不会因为行为退化而变红（AC-1 的「从起点顺时针」、AC-3 的「由 rng 决定」、AC-10 的「狼死于放逐」），以及 F7 插入点、FEATURES F5 弃权口径、README / RFC 证据表等非阻塞项，见 §9。

---

## 1. 门禁实跑（真实输出）

全部在本机 macOS / Node 22.22.2 / pnpm 10.33.0 执行，工作树干净（`d435add`）。

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
✓ built in 66ms
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
✓ built in 9ms
EXIT:0

$ pnpm test
 Test Files  41 passed (41)
      Tests  337 passed (337)
EXIT:0

$ pnpm exec vitest run --project unit --coverage
 Test Files  34 passed (34)
      Tests  303 passed (303)
EXIT:0
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   96.42 |    92.85 |   96.87 |   96.73 |
 engine          |   97.74 |    94.59 |     100 |   97.53 |
  apply.ts       |   95.83 |    93.15 |     100 |   95.65 | 129,132,148,262
  step.ts        |     100 |      100 |     100 |     100 |
  win.ts         |     100 |      100 |     100 |     100 |
 engine/phases   |   94.36 |     90.5 |   92.15 |   95.33 |
  auto-table.ts  |     100 |      100 |     100 |     100 |
  auto.ts        |       0 |        0 |       0 |       0 |
  day.ts         |   95.91 |    78.12 |     100 |   97.5 | 25
  lynch.ts       |   92.85 |    83.33 |     100 |   92.85 | 26
  night.ts       |     100 |      100 |     100 |     100 |
  vote.ts        |      85 |    83.33 |   78.94 |   86.53 | 52-55,73,76,138
 engine/resolve  |     100 |      100 |     100 |     100 |
  deaths.ts      |     100 |      100 |     100 |     100 |
-----------------|---------|----------|---------|---------|-------------------
EXIT:0
```

- `TEST-2` 门禁（`src/engine/` 行 ≥90 / 分支 ≥85）达标：整体 **96.73 / 92.85**。
- `pnpm test` 的 meta project 会再跑一遍五条命令与覆盖率门禁（`tests/meta/commands.test.ts`、`coverage.test.ts`），全绿。
- RFC-004 §8.6 记录的 `41 files / 337 tests / 96.42 / 92.85 / 96.87 / 96.73` 与实测**逐项一致**——这一节是诚实的。
- `auto.ts` 0% 是**类型文件**（只有 `type` 导出），不是未测分支，不算问题。
- **不适用（已实跑核对，不计入门禁）**：`pnpm test:e2e` → 实跑 exit 0、打印 `skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）`；`pnpm selfplay` → 实跑 exit 1、打印 `pnpm selfplay 未实现（RFC-015）`（RFC-001 的 C-5 已登记该临时偏离，本 RFC 不涉及）；Windows 未复跑（本机 macOS）；浏览器 / UI / LLM 路径本 RFC 不涉及。

---

## 2. 逐条验收标准：如果行为退化，哪个测试会红？

| AC | 测试（文件:行） | 变异探针 | 会红？ | 判定 |
|---|---|---|---|---|
| 1 发言顺序单循环、不重不漏 | `tests/engine/day.test.ts:54-78`（逐个 `speechOrder` 发言）；`:41-51` 断言排序后等于存活集 | P1（`speechOrder` 忽略起点，直接返回座位升序） | **不红（8/8 通过）** | **部分**。「不重不漏」有断言；「从 `speechStartSeat` 起顺时针」没有断言——`speechOrder` 自证自明，退化实现也能过 |
| 2 起点 = 结算顺序第一位死者的下一位存活 | `tests/engine/day.test.ts:16-32`（独立算 expected） | P2（`nextAliveSeat` 直接返回死者座位） | **红 2 条** | PASS |
| 3 无死者时起点由 `state.rng` 决定、记录在 payload、同 seed 相同 | `tests/engine/day.test.ts:95-133`（同 seed 两次 + `replay`） | P3（仍消费 rng，但座位固定取 `ordered[0]`） | **不红（19/19 通过）** | **部分**。只锁了「同 seed 相同」与「可 replay」；「由 rng 决定」没有锁——固定座位也满足这两条 |
| 4 起点不是死者；已出局者不在队列 | `tests/engine/day.test.ts:34-51` | P2 | **红 2 条** | PASS（测试标题「起点恰好是死者时」名不副实，但断言的属性对） |
| 5 每票 `VOTE_CAST`、`visibleTo === self:<seat>`、结算前无公开票型 | `tests/engine/vote.test.ts:20-66` | P4（改成 `public`） | **红 2 条** | PASS。`isVisibleTo` 本身按 RFC-001 §6 延后到 RFC-005，本 RFC 只到 `visibleTo` 元数据层 |
| 6 `VOTE_REVEALED` 公开、含全部投票者与 `abstain` | `tests/engine/vote.test.ts:68-93` | —（直接断言覆盖 seat 集合与 abstain） | 直接断言 | PASS |
| 7 唯一最高票出局、`PLAYER_DIED.cause === 'lynch'` | `tests/engine/vote.test.ts:95-117` | —（P6 破坏胜负判定会先红） | 直接断言 | PASS |
| 8 重投选项集恰为并列者；`abstain` / 非并列者 → `INVALID_RUNOFF_TARGET` | `tests/engine/vote.test.ts:119-168` | P5（重投允许弃权） | **红 1 条** | PASS |
| 9 重投仍并列 / 全员弃权 → 当日无人出局、进下一夜 | `tests/engine/vote.test.ts:170-218` | P10（重投平票改走 `DAY_LYNCH`） | **红 1 条** | PASS |
| 10 屠边：神全灭 / 民全灭 → 狼胜；狼全灭 → 好人胜（狼死因分别为夜间被杀 / 被毒 / 被放逐） | 谓词：`tests/engine/win.test.ts:18-46`；夜间狼灭：`death-resolve.test.ts:70-103`（开枪）、`:291-330`（毒） | P8（放逐狼时跳过胜负判定） | **不红（20/20 通过）** | **部分**。「狼死于放逐」这条集成用例不存在；`win.test.ts` 是纯谓词表，没有任何「死因」维度 |
| 11 屠城：好人全灭 → 狼胜；狼全灭 → 好人胜 | `tests/engine/win.test.ts:48-68` | —（改 `state.mode` 分支会红） | 直接断言 | PASS |
| 12 胜负先于技能：猎人被刀 / 被放逐且是最后一个神 → 狼胜、无 `HUNTER_SHOOT` | `tests/engine/lynch.test.ts:60-89`（放逐版）+ `death-resolve.test.ts:143-187`（被刀版） | P6（放逐后不判胜负） | **红 1 条** | PASS |
| 13 技能后二次判定：开枪带走最后一狼 → 好人胜 | `tests/engine/lynch.test.ts:91-138`（放逐版）+ `death-resolve.test.ts:70-103`（被刀版） | P7（开枪后不判胜负） | **红 2 条** | PASS |
| 14 无平局；无 `stalemateDays` 字段；事件流无 `'draw'` | `tests/engine/lynch.test.ts:141-163` | — | **偏弱** | **部分**。`payload.result === ('draw' as never)` 是类型层不可能成立的比较；`Object.keys(day.state)` 只查一个夹具状态 |
| 15 `FINISHED` 后再提交 → `Rejected(PHASE_MISMATCH)`，除 `seq` 外不变 | `tests/engine/full-game.test.ts:119-142` | P9（`FINISHED` 允许 `VOTE`） | **红 2 条**（含本 AC 1 条） | PASS |
| 16 固定种子无 AI 脚本跑到 `FINISHED`，`replay` 同终局 | `tests/engine/full-game.test.ts:87-117` | —（断言 FINISHED + `result` + `replay(events) === state`） | 直接断言 | PASS |

**16 条中 12 条有会红的测试，3 条只有部分覆盖**（AC-1 / AC-3 / AC-10，P1 / P3 / P8 全绿），AC-14 的断言偏弱。这些是测试缺口，不是当前行为错误——P1 / P3 / P8 改完后现有套件仍全绿，正说明它们此刻不设防。

---

## 3. 变异探针（改代码 → 定向测试 → `git checkout --` 恢复）

每次替换都用脚本断言**目标字符串在文件中恰好出现 1 次**（否则脚本以非零退出、不写文件）；每次探针后 `git checkout -- <file>` 并断言 `git diff --quiet`。10 条探针全部完成，结束时 `git status --porcelain` 为空。

| # | 改动（文件） | 定向测试 | 结果 | 结论 |
|---|---|---|---|---|
| P1 | `phases/day.ts` 的 `speechOrder` 去掉旋转，`return ordered` | `day.test.ts` | **8 passed** | AC-1 的顺时针起点不设防（finding） |
| P2 | `phases/day.ts` 的 `nextAliveSeat` 改为 `return from`（不跳过死者） | `day.test.ts` | **2 failed / 6 passed**（`:31`、`:37`） | AC-2 / AC-4 有效 |
| P3 | `phases/day.ts` 无死者分支改为固定 `ordered[0]`（仍消费 rng） | `day.test.ts` + `vote.test.ts` | **19 passed** | AC-3 的「rng 决定」不设防（finding） |
| P4 | `phases/vote.ts` 的 `VOTE_CAST.visibleTo` 改为 `'public'` | `vote.test.ts` | **2 failed / 9 passed**（`:30`、`:45`） | AC-5 有效 |
| P5 | `phases/vote.ts` 重投允许 `abstain` | `vote.test.ts` | **1 failed / 10 passed**（`:164`） | AC-8 有效 |
| P6 | `phases/lynch.ts` 的 `checkWin(afterDeath)` 改成恒 `null` | `lynch.test.ts` | **1 failed / 6 passed**（`:85`） | AC-12 有效 |
| P7 | `phases/night.ts` 的 `checkWin(afterShot)` 改成恒 `null` | `lynch.test.ts` + `death-resolve.test.ts` | **2 failed / 25 passed**（`lynch:122`、`death-resolve:101`） | AC-13 有效 |
| P8 | `phases/lynch.ts`：被放逐者是狼时跳过胜负判定 | `lynch.test.ts` + `full-game.test.ts` + `vote.test.ts` | **20 passed** | AC-10 的「狼死于放逐」不设防（finding） |
| P9 | `transitions.ts` 的 `FINISHED: []` 改为 `['VOTE']` | `full-game.test.ts` + `transitions.test.ts` | **2 failed / 6 passed**（`full-game:140`、`transitions:38`） | AC-15 有效 |
| P10 | `phases/vote.ts` 重投再平票改走 `DAY_LYNCH` | `vote.test.ts` | **1 failed / 10 passed**（`:189`） | AC-9 有效 |

探针之外另有两条**只读取、不改代码**的探针（临时测试文件，跑完即删）：

**PROBE-C · F7 的插入点是否真的接在真实结算上**：用 `step(state, action, [modifier])` 走真实的投票结算，`modifier` 一次都没有被调用（`seen: []`）；原因是生产代码没有任何 handler 调用 `applyModifiers`——`night.ts:84`、`:324` 与 `lynch.ts:34` 都直接 `applyEffects`，`vote` 结算根本不产出效果。见 §7.2 的 C-33。

**PROBE-D · 两个死者的一夜，公开 payload 是什么**（狼刀 9、女巫毒 3）：

```
WITCH_POTION_USED  witch   {"potion":"poison","target":3}
PHASE_CHANGED      server  {"from":"NIGHT_WITCH","to":"NIGHT_RESOLVE"}
PLAYER_DIED        server  {"seat":9,"cause":"wolf"}
PLAYER_DIED        server  {"seat":3,"cause":"poison"}
PHASE_CHANGED      public  {"from":"NIGHT_RESOLVE","to":"DAY_ANNOUNCE"}
DAY_STARTED        public  {"day":2,"diedLastNight":[9,3],"speechStartSeat":1}
PHASE_CHANGED      public  {"from":"DAY_ANNOUNCE","to":"DAY_SPEECH"}
```

`PLAYER_DIED` 的 `cause` 确实被藏了（`server`），但**公开的 `diedLastNight` 顺序**把「9 是狼刀、3 是毒药」原样交还给了所有人；`speechStartSeat: 1` 也再次确认 9 是「第一位死者」。这是 B1 / C-31。

**Fuzz · 合法输入撞内部不变量**：临时用 200 个固定种子（每 3 个种子切一次 `slaughter-all`，其余 `slaughter-side`），每步挑一个通过 `step` 校验的合法 action（狼刀 / 查验 / 女巫三种用药 / 发言或跳过 / 投票或弃权 / 重投 / 猎人开枪或放弃），一直跑到 `FINISHED` 或 800 步。结果 **`FUZZ failures: []`**：没有崩溃、没有卡死、没有 `Rejected`，`replay(events)` 与最终状态逐字节一致。这轮没有发现「两个合法操作叠加撞内部不变量」的路径（`applyPlayerDied` 重复、`appendSpoken` 重复、`PHASE_CHANGED.from` 不匹配都未被合法路径触发）。

---

## 4. AC 之外主动找的问题

### 4.1 B1 · 公开的 `diedLastNight` 顺序泄漏死因（阻塞）

**证据链**：

- `src/engine/resolve/deaths.ts:69-86`：死亡顺序是**结算顺序**（先狼刀、后毒药），并且注释与 C-26 明确这个顺序不能改；
- `src/engine/apply.ts:237`：`pendingDeaths` 按 `PLAYER_DIED` 事件顺序追加；
- `src/engine/phases/day.ts:67`：`diedLastNight: [...(state.pendingDeaths ?? [])]`——顺序原样进公开 payload；
- `src/engine/phases/day.ts:47`：`speechStartSeat` 取 `deaths[0]` 的下一位存活席位，等于把「第一位死者」再公开一次；
- `RFCs/RFC-004...:24,31,107`：这是 **RFC 自己规定的**行为；
- 对照 `RFCs/RFC-003...:159`（D-3）：「死因（刀 / 毒）在真实规则里**不公开**，天亮只公布『谁死了』」；`RFCs/RFC-003...:284`（§9.4）同样承诺 payload「没有死因」；
- `PRD.md:153`（FR-9）：「严禁注入隐藏身份、**他人夜间行动**或未公开结果」；`PRD.md:149`（FR-5）只说「当日**首个死者**的下一位」，并没有定义「首个」必须按结算顺序。

**为什么算泄漏**：两人同夜出局时，公开顺序 + `speechStartSeat` 让任何观察者（包括 RFC-007 会喂给 AI 的 `publicEvents`）都能断定哪一个是狼刀、哪一个是女巫毒——即「女巫今晚毒了谁」这条**他人夜间行动**。RFC-003 为了让这条信息不公开，专门把夜间 `PLAYER_DIED` 设为 `server`；RFC-004 的公开播报把它从另一条通道原样放了出来。这不是「结构上无法避免」：把「首个死者」定义成**与死因无关**的公开规则（例如死者中座位最小者，或每天都用 `state.rng` 抽起点）即可，且不必改 `PLAYER_DIED`。

**建议（需用户裁决 + `/manage-changes`，不能由实现者顺手改）**：

1. `DAY_STARTED.diedLastNight` 按**座位升序**（或其它与死因无关的顺序）输出；
2. `speechStartSeat` 改用与死因无关的规则（座位最小死者的下一位，或每天抽一次），并在 `PRD` 的「首个死者」解释里写死；
3. 补一条回归测试：狼刀 9 + 毒 3 / 狼刀 3 + 毒 9 两组，`DAY_STARTED` 的公开 payload **不可区分**（顺序与起点都不随死因变化）。

### 4.2 B2 · 四个新事件没有 payload schema（阻塞）

`src/shared/schemas.ts:205-216` 的 `PAYLOAD_SCHEMAS` 只登记 10 项；`GAME_EVENT_TYPES` 有 18 项。实测缺口：

```
EVENT_TYPES 18 SCHEMAS 10
MISSING SPEECH,SPEECH_SKIPPED,VOTE_CAST,VOTE_REVEALED,WOLF_CHAT_POSTED,SELF_EXPOSE,AI_THOUGHT,DEGRADED
```

后四项分属 RFC-005 / 006 / 007 / 010；**前四项正是 RFC-004 拥有的 payload**。而 RFC-004 只补了 `DAY_STARTED`（`src/shared/schemas.ts:193-197`），§8.4 也自述只做了 `DAY_STARTED` schema。

权威依据：

- `RFCs/RFC-001...:193`：`schemas.ts` **为每个 payload** 导出 Zod schema，「服务端校验入站 action、校验**出站事件**与响应」；
- `RFCS.md:170`（C-10）：事件 payload 的 schema「由拥有该 payload 的 RFC 追加」；
- 同类先例：RFC-003 评审的 **B3** 就是「6 个新事件缺 schema」，当时按阻塞处理并补齐；
- `tests/engine/events.test.ts:180-181` 写着 `if (schema === undefined) continue; // 还没登记 schema 的事件类型（如 SPEECH 归 RFC-004）`——项目自己把这张欠条记在了 RFC-004 名下；
- `tests/shared/schemas.test.ts:99-110` 的键集合断言把当前（缺四项）的状态**锁死**了，删一项会红、少四项不会红。

后果不是理论上的：`EventSchema` 的 payload 是 `z.unknown()`（`src/shared/schemas.ts:139`），所以服务端目前无法校验这四类出站事件；`SPEECH.text`、`VOTE_CAST.target` 这类字段一旦写错，要到客户端才炸。修法：补四个 schema（含 seat / target / abstain / votes 数组的元素校验）并登记进 `PAYLOAD_SCHEMAS`；同时把键集合断言改成「覆盖 `GAME_EVENT_TYPES` 中已拥有者」的表驱动断言，避免下一次再漏。

### 4.3 合法输入 / 内部不变量（本轮未发现崩溃）

Fuzz 见 §3。另检查了模块级不变量：`applyPlayerDied` 的「重复出局」、`appendSpoken` / `appendVote` 的重复、`applyPhaseChanged.from` 不匹配，在 200 个种子的合法动作序列里都没有被触发（夜间的同目标死亡已由 RUL-11 归并）。`DAY_LYNCH` 在 `lynched === undefined` 时抛错（`lynch.ts:24-27`）是防御分支，合法路径进不去（`VOTE_REVEALED` 先折叠）。

### 4.4 可见性（事件 / 投影 / 状态字段）

- 夜间 `PLAYER_DIED` 与全部 `NIGHT_*` 相位仍 `server`；`GAME_STARTED` 仍 `server`；白天放逐 / 白天开枪是 `public`（`phases/night.ts:318` 按 `state.phase` 分流，符合 RFC-003 N9 的提醒）。
- 白天 `PHASE_CHANGED` 全部走 `phaseChangedDraft`（`phases/visibility.ts:29`），没有漏网的硬编码。
- **继承 RFC-003 Round 2 交接的两条缺口没有在本 RFC 收口**（非阻塞，但 RFC-003 的评审明确要求「写进 RFC-004/007 的交接」）：
  1. **「天黑了」没有公开事件**：`DAY_* → NIGHT_WOLF_CHAT` 也走 `phaseVisibility`，是 `server`。RFC-013 的事件面板若只读公开事件，看不到天黑；玩家/AI 只能从 RFC-007 的投影 `phase` 得到（而 C-28 还没裁决）。
  2. **终局之夜没有公开死亡播报**：夜间 `resolveNightEntry` 若直接 `GAME_ENDED`，就不会有 `DAY_STARTED`，`GAME_ENDED` 的 payload 也没有死者。RFC-003 评审第 4 轮把「`GAME_ENDED` 是否带死者 / 面板改读投影」留给 RFC-004/013 决定，RFC-004 §8.7 没有记这条。
- 状态字段层面：`state.votes` / `state.speech` / `state.runoff` / `state.lynched` 都在 `GameState` 里，但 RFC-007 的 `ProjectedContext`（`RFCs/RFC-007...:44-55`）不输出它们，所以不构成当前泄漏；它们是否该在投影里出现，归 RFC-007。

### 4.5 跨 RFC 契约与文档漂移

- **FEATURES F5 AC-4 与 RUL-2 冲突**（C-32，非阻塞）：`FEATURES.md:66` 写「选项集为并列者 **+ 弃权**」，`RULES.md:234`（RUL-2）与 RFC-004 AC-8 / `phases/vote.ts:128` 都拒绝弃权。`changes/CHANGE-REQUEST-002.md:28` 的 R-2 影响面只列了「RULES、RFC-001、RFC-004」，漏了 FEATURES；`PRD.md:102`（RA-2）是开放歧义，`PRD.md:349`（D40）把裁决权委托给 `RULES.md`，所以按 **RUL-2** 走、FEATURES 待修。按权威顺序这是我唯一一处需要特别说明的：PRD 沉默、FEATURES 与 RULES 冲突，但 D40 把 RA-2 的裁决权明确交给了 RULES，且用户在 CR-002 里已拍板。
- **F7 的插入点没有接在真实结算上**（C-33，非阻塞但必须排期）：`FEATURES.md:68`（F7 AC-1/AC-3）要求每个结算点（含**投票**与**胜负判定**）产出带 source 的效果列表，并用一个假效果证明插入点能改变结算结果。现实是：`step(state, action, [modifier])` 的 modifier 对真实 handler **无效**（PROBE-C：`seen: []`）；`VOTE_RESOLVE` / `DEATH_RESOLVE` / `WIN_CHECK` 三个 `ResolutionPoint` 在 `src/` 里没有任何调用点。`tests/engine/effects.test.ts:91-108` 与 `step.test.ts:91` 只证明了 `applyModifiers` 本身与「自定义 handler + step」的合成链路，没有碰真实 handler——RFC-002 评审的 N9 当时就点明「RFC-003/004 第一次写结算时若忘记接线，现有测试不会红」。
- **RFC-004 §8.5 的证据表有两处比事实强**：
  - AC-10 写「`lynch.test.ts` + `win.test.ts`：屠边三种（狼死于刀 / 毒 / 放逐）与屠城两种」——`win.test.ts` 是纯谓词表，没有死因维度；`lynch.test.ts` 没有放逐狼的用例（P8 证明该路径不设防）；
  - AC-3 写「同 seed 两次运行起点相同；payload 与 replay 一致」——属实，但不能推出「由 rng 决定」（P3）。
- **RFC-004 §3 交付物表**列 `tests/engine/win.test.ts`「胜负判定与两次判定的时序」：该文件在 RFC-003 就已存在（`git log -1 -- tests/engine/win.test.ts` → `2cce950`），RFC-004 没有改它，「两次判定的时序」实际在 `lynch.test.ts` / `death-resolve.test.ts`。
- **`README.md:13`** 仍写「引擎现在能跑完**第一夜**…白天与投票是 RFC-004 的活」——实现已能跑完整局；`:38-40` 的进度与「下一步」也会在本次状态变更后过期。
- **`tests/engine/death-resolve.test.ts:58`** 的标题仍写「…但仍然推进到 `DAY_ANNOUNCE`」，`:67` 断言的是 `DAY_SPEECH`。
- **RFC-004 头 `Rules`**（`:5`）列了 `RUL-10`（`RULES.md:242` 已 `[REMOVED]`），却漏了 AC-9 实际依赖的 `RUL-7`（弃权合法）。
- **RFC-003 现在 `Spec changed`**（被 RFC-004 的自动阶段改了 AC-16）：我复核了 `RFCs/RFC-003...:119`（AC-16 已注明被取代）、`night.test.ts:122-135`、`death-resolve.test.ts:67` 与四处 `DAY_SPEECH` 断言，**代码与测试是一致的**，RFC-003 的 AC-16 修改没有留下不实陈述；但它的 `Reviewed` 需要重新收口，否则 RFC-005/006 按硬规则 2 不能开工。这不是 RFC-004 的代码缺陷，列在流程项里。

### 4.6 规则缺口（候选，非阻塞）

`src/engine/phases/vote.ts:137-139` 只校验「目标存活 / 不是 `abstain`」，**没有裁决「能否投自己」**；`RULES.md` §6、`PRD.md:150`（FR-6）、`FEATURES.md:66`（F5）都没有这条，测试也没有用例。实现默认允许（自投计入票数、可被放逐）——真实狼人杀里自投通常合法，且它不产生「两种都可能成立」的结论分歧（不像 RUL-12），所以我**不按阻塞处理**；但严格按 `RULES.md:136`（ARCH-11「§6 未覆盖的分支必须抛出明确错误」）的字面，这是一个未裁决分支。建议由 `/manage-changes` 补一条 RUL-13「自投合法」，或至少在 RFC-004 / RFC-005 的规则清单里写明；不要留成「代码恰好允许」。

---

## 5. 维度结论

| 维度 | 结论 | 说明 |
|---|---|---|
| 1. RFC 符合度 | **NEEDS WORK** | 16 条 AC 中 12 条有会红的测试（3 条部分、AC-14 偏弱）；D-1 ~ D-8 的实现与记录基本成立（B 方案、`DAY_ANNOUNCE`/`DAY_LYNCH` 自动阶段、两次判定、拒绝不触发自动推进）。但 AC-2 的「结算顺序起点」本身就是 B1 的泄漏源；AC-10 的证据表不实。 |
| 2. RULES 合规 | **NEEDS WORK（TEST-1 / DOC-1）** | 见 §6 表；ARCH-1/3/4/5/6/11、DATA-1~5、STYLE 全 PASS；TEST-1 有 3 处 AC 缺口；DOC-1 有未记录的偏离（B2 的 schema 范围、F7 接线）。 |
| 3. 安全 | **FAIL（B1）** | 无密钥 / 无网络 / 无注入面（引擎纯函数），但公开 `DAY_STARTED` 泄漏死因顺序，直击 FR-9 与「AI 不作弊」卖点。 |
| 4. 性能 | **N/A** | 纯函数引擎，规模由 9 席与固定板子界定；每步 `tallyOf` / `speechOrder` 为 O(9)；无 I/O。200 种子 × ≤800 步的 fuzz 在 52ms 内跑完。 |
| 5. 可维护性 | **NEEDS WORK（非阻塞）** | `vote.ts` 与 `apply.ts` 各有一份票型统计 / 决胜逻辑（`tallyOf` vs `applyVoteRevealed`），靠实现纪律对齐；`pendingVoters` 是死导出；新夜不清 `speech`/`votes`/`runoff`/`lynched`（当前无读者）；`AUTO_PHASE_LIMIT` 到上限后静默停在一个无 action 的阶段。 |

**跳过的检查（显式）**：PRD Product Type 为 game + web app；本 RFC 无 UI、无 HTTP、无 LLM、无存储、无浏览器运行路径，所以 A11Y / UI / 响应式 / 首屏预算 / SEO / 认证 / Playwright 冒烟全部 N/A（`RULES.md:33-43` 的跳过表同样适用）。`TEST-6` 的 Playwright 要求从 RFC-012 起生效。

---

## 6. RULES 合规表

| 规则 | 结果 | 证据 |
|---|---|---|
| ARCH-1 | PASS | `tests/dependency-direction.test.ts` 5/5 |
| ARCH-3 | PASS | `serialization.test.ts`；`speech` / `votes` / `runoff` / `lynched` / `pendingDeaths` 都是纯数据，`Map` 只作 `tallyOf` 的局部变量 |
| ARCH-4 | PASS | `ts` 只来自 action；`DAY_STARTED` 的随机数只从 `state.rng` 来 |
| ARCH-5 | PASS | 放逐 / 夜间先产出 `Effect[]` 再 `applyEffects` |
| ARCH-6 | PASS | `source: 'role'`；`EFFECT_ORDER` 分区未改 |
| ARCH-11 | **PASS（有保留）** | 重投弃权 / 非并列者显式拒绝；`DAY_LYNCH` 无 `lynched` 抛错；RUL-2 / RUL-7 / RUL-9 / RUL-12 均有裁决。**保留**：「能否投自己」未裁决（§4.6 / N12） |
| DATA-1 / DATA-2 | PASS | `seq` 严格递增；`DAY_STARTED` 进 `GameEventMap` 与 `GAME_EVENT_TYPES`；**payload schema 见 B2** |
| DATA-3 | PASS | `full-game.test.ts:116` 的 `replay(events) === state`；200 种子的 fuzz 也逐字节一致 |
| DATA-4 / DATA-5 | PASS | `rng.test.ts` 递归扫描；`DAY_STARTED` 的 `rngAfter` 已登记进 `RANDOM_CONSUMING_EVENTS`（`apply.ts:21-25`） |
| TEST-1 | **NEEDS WORK** | AC-1 / AC-3 / AC-10 部分缺口（§2），FEATURES F5 AC-6 的出局者投票无测试（`vote.ts` 覆盖 85 / 83.33，`73/76/138` 未覆盖） |
| TEST-2 | PASS | 96.73 / 92.85，无 ignore 注释（`tests/meta/coverage.test.ts`） |
| TEST-3 | PASS | `determinism.test.ts` |
| TEST-4 | PASS | `tests/setup/no-network.ts` |
| STYLE-1 ~ 7 | PASS | 文件名 kebab-case、具名导出、`night.ts` 362 行 < 400、无 `any` / `!` / TODO / 注释代码 |
| DOC-1 | **NEEDS WORK** | B2 的 schema 范围（只做 `DAY_STARTED`）只写在 §8.4 的清单里，没有作为偏离说明；F7 接线缺失没有记录；RFC-003 交接的两条缺口没有记录 |
| DOC-2 | PASS | 未新增依赖 |

---

## 7. 冲突与裁决依据

### 7.1 已关闭的 C-29

`RFCS.md` C-29 原状态是「非阻塞 RFC-003；阻塞 RFC-004」。本轮逐条复核：

- `RFCs/RFC-004...:5` 的 `Rules` 头已含 `RUL-12`；§2.6（`:77-81`）与 Q-004-4（`:134`）已改为「同批夜间死亡按 RUL-12 判 wolf 胜」；
- `FEATURES.md:67`（F6 AC-4）已含 RUL-12；
- `RULES.md:233`（RUL-1 依据句）已改；`RFCS.md:166`（C-6）与 `:190`（OQ-C6）已改；
- 差异只在于 `RFCs/RFC-004...:81` 还留着「原『同归于尽 → 平局』分支与『连续 N 天无进展 → 平局』兜底均已移除」——这是事实陈述，不是矛盾。

结论：**C-29 关闭**（见 `RFCS.md` §8.6 的更新）。

### 7.2 新登记

- **C-31（阻塞）**：`DAY_STARTED.diedLastNight` 顺序 + `speechStartSeat` 泄漏死因，冲突双方是 RFC-004 §2.1 / AC-2 与 `PRD.md:153`（FR-9）+ RFC-003 D-3 / §9.4。按权威顺序取 **PRD**：不得把「女巫毒了谁」放进公开 payload。修法见 §4.1。
- **C-32（非阻塞）**：`FEATURES.md:66`（F5 AC-4「+ 弃权」）vs `RULES.md:234`（RUL-2）/ RFC-004 AC-8 / `vote.ts:128`。按 `PRD.md:349`（D40）把 RA-2 的裁决权委托给 RULES、且 CR-002 已由用户拍板，**按 RUL-2 判**，FEATURES 待 `/manage-changes` 修。
- **C-33（非阻塞）**：`FEATURES.md:68`（F7 AC-1/AC-3）与 RFC-002 §2.4 的 `Modifier` 插入点，在 RFC-004 新增的投票 / 胜负结算上没有接线（PROBE-C）。v1 不注册任何 modifier，所以当前无可观察行为差异；但 F7 是 Must，且它是 RFC-002 评审 N9 明确交给 RFC-003/004 的欠条。

---

## 8. 阻塞项（必须修复后才能合并）

### B1 · `DAY_STARTED` 的公开顺序泄漏死因（C-31）

**复现**（两个合法 action，均通过 `step` 校验；残局只决定谁已出局）：

```
state = makeNightState({ phase: 'NIGHT_WITCH', night: { killTarget: 9 } })   // roles: wolf×3/seer/witch/hunter/villager×3
step(state, { type: 'WITCH_ACT', seat: 5, potion: 'poison', target: 3 })
→ 公开事件：
  PHASE_CHANGED  public {"from":"NIGHT_RESOLVE","to":"DAY_ANNOUNCE"}
  DAY_STARTED    public {"day":2,"diedLastNight":[9,3],"speechStartSeat":1}
  PHASE_CHANGED  public {"from":"DAY_ANNOUNCE","to":"DAY_SPEECH"}
```

`diedLastNight` 的第 1 位 = 狼刀、第 2 位 = 毒药（`src/engine/resolve/deaths.ts:69-86` 的结算顺序），任何观察者都能据此还原女巫的毒药目标；`speechStartSeat` 又独立地确认了「第一位死者」是 9。行号：`src/engine/phases/day.ts:47,67`、`src/engine/apply.ts:237`、`src/engine/resolve/deaths.ts:69-86`；规格：`RFCs/RFC-004...:24,31,107`；对照：`RFCs/RFC-003...:159,284`、`PRD.md:153`。

**修复方向**（需要用户先裁决，再走 `/manage-changes`；实现者不必在本次提交里猜）：

1. `diedLastNight` 改成与死因无关的顺序（座位升序）；
2. `speechStartSeat` 改成与死因无关的规则（座位最小死者的下一位 / 每天抽一次），并同步 PRD 对「首个死者」的解释；
3. 补回归测试：交换两组死亡的座位，公开 payload 应完全一致（顺序 + 起点都不随死因变化）。

### B2 · 四个新事件缺 payload schema（阻塞）

**复现**：

```
$ # 临时测试打印（已删）
EVENT_TYPES 18 SCHEMAS 10
MISSING SPEECH,SPEECH_SKIPPED,VOTE_CAST,VOTE_REVEALED,WOLF_CHAT_POSTED,SELF_EXPOSE,AI_THOUGHT,DEGRADED
```

前四项是 RFC-004 拥有的 payload。行号：`src/shared/schemas.ts:193-197`（只有 `DAY_STARTED`）、`:205-216`（`PAYLOAD_SCHEMAS` 10 项）、`:139`（`EventSchema` 的 payload 是 `z.unknown()`）；`tests/shared/schemas.test.ts:99-110`（把缺四项的集合写死）；`tests/engine/events.test.ts:180-181`（跳过未登记类型的注释）。依据：`RFCs/RFC-001...:193,268`、`RFCS.md:170`（C-10）、RFC-003 的 B3 先例。

**修复**：补 `SpeechPayloadSchema`（`seat` + `text`）、`SpeechSkippedPayloadSchema`、`VoteCastPayloadSchema`（`seat` + `target: SeatId | 'abstain'`）、`VoteRevealedPayloadSchema`（`votes` 数组元素同 `VoteCast`），登记进 `PAYLOAD_SCHEMAS`；把键集合断言改成「覆盖 `GAME_EVENT_TYPES` 中已拥有者」的表驱动检查；用真实一天的事件（发言 → 投票 → 公布）逐条过一遍 `makeEventEnvelopeSchema`。

---

## 9. 非阻塞项

1. **N1（测试）· AC-1 的「从起点顺时针」不设防**：`speechOrder` 忽略 `startSeat` 时 8/8 全绿（P1）。补一条断言 `speechOrder(state)[0] === state.speech.startSeat`，并直接断言整段序列等于「从起点旋转」。
2. **N2（测试）· AC-3 的「由 rng 决定」不设防**：固定取 `ordered[0]` 时 19/19 全绿（P3）。补一条「不同 seed / 不同 rng 状态 → 起点不全相同」或用 `nextInt` 的期望值做直接断言。
3. **N3（测试 + 文档）· AC-10 的「狼死于放逐」不设防**（P8，20/20 全绿）；RFC-004 §8.5 的 AC-10 证据表把 `win.test.ts` 算成了死因用例。补一条「放逐最后一只狼 → `GAME_ENDED(good, all-wolves-dead)`」；修正证据表。
4. **N4（测试）· FEATURES F5 AC-6「出局玩家不参与后续投票」无测试**：`src/engine/phases/vote.ts:72-78` 的三条拒绝分支（死投票者 / `ALREADY_VOTED` / `TARGET_NOT_ALIVE`）都没有用例（覆盖率 85 / 83.33，未覆盖 `73/76/138`）。至少补「出局者投票 → `NOT_YOUR_TURN`」与「同轮二次投票 → `ALREADY_VOTED`」。
5. **N5（AC-14 断言偏弱）**：`tests/engine/lynch.test.ts:158-162` 的 `result === ('draw' as never)` 类型层不可能成立；`:145` 只查夹具键。建议改成「`GAME_ENDED` 的 `result` 只能是类型联合的两值」+ 用 `expectTypeOf` 断言 `GameState` 不含该字段。
6. **N6（F7 / C-33）**：`VOTE_RESOLVE` / `DEATH_RESOLVE` / `WIN_CHECK` 三个 `ResolutionPoint` 没有调用点；`step(..., [modifier])` 对真实 handler 无效（PROBE-C）。要么在本 RFC 的 `settle` / `lynchEntry` / `checkWin` 调用点接 `applyModifiers` 并补真实路径测试，要么由 `/manage-changes` 把 F7 的可观察面收窄。
7. **N7（liveness）**：`step.ts:238-246` 的 `AUTO_PHASE_LIMIT` 到 8 次后**静默停止**；若某天 entry 不收敛，会停在一个 `transitions` 为空的阶段、之后所有 action 都 `Rejected`，且没有错误。当前 entry 最多 2 步，不可达；建议超限时抛 `Error`（ARCH-11 的精神）。
8. **N8（可维护性）**：`tallyOf` / `outcomeOf`（`vote.ts:22-48`）与 `applyVoteRevealed`（`apply.ts:158-191`）是两份决胜逻辑，靠实现纪律保持一致；`pendingVoters`（`vote.ts:51-56`）是死导出；进入新夜不清 `speech` / `votes` / `runoff` / `lynched`（当前无读者，但 `state` 会携带陈旧派生值）。
9. **N9（文档）**：`README.md:13` 仍说只能跑第一夜；`:38-40` 的进度/下一步会在状态变更后过期。`tests/engine/death-resolve.test.ts:58` 的标题仍写 `DAY_ANNOUNCE`（断言是 `DAY_SPEECH`）；`RFC-004:5` 列了已移除的 `RUL-10`、漏了 `RUL-7`；RFC-004 §3 把 `win.test.ts` 说成 RFC-004 的「两次判定时序」。
10. **N10（跨 RFC 交接）**：RFC-003 评审留给 RFC-004 的两条没有记录——「天黑了」没有公开事件（`visibility.ts:25` 把所有 `to: NIGHT_*` 设为 `server`）、终局之夜没有公开死亡播报（`GAME_ENDED` 只有 `result` / `condition`）。它们不阻塞 RFC-004 的代码，但阻塞 RFC-007 / RFC-013 的读法；建议写进 RFC-004 §8.7 的缺口表，或由 `/manage-changes` 决定 `GAME_ENDED` 是否携带死者。
11. **N11（流程）**：RFC-003 现为 `Spec changed`；AC-16 的改写与四处 `DAY_SPEECH` 断言我已核对一致，但它需要重新收口为 `Reviewed`（或被再评审一次），否则 RFC-005/006 按 `AGENTS.md` 硬规则 2 不能开工。**不阻塞 RFC-004 的代码**（RFC-004 开工时它还是 `Reviewed`，改动是 RFC-004 造成的）。
12. **N12（规则缺口）**：「投票给自己」没有被 `RULES.md` §6 裁决（§4.6）；实现默认允许，测试没有用例。不阻塞，但建议在 `/manage-changes` 里补 RUL-13 或明确写明这是有意的允许。

---

## 10. 我实际验证了什么 / 没验证什么

**实际跑了、并贴了真实输出的**：

- `pnpm typecheck` / `lint` / `format:check` / `build` / `test` / `pnpm exec vitest run --project unit --coverage` 全部 exit 0；`pnpm test` 41 files / 337 tests；覆盖率 96.42 / 92.85 / 96.87 / 96.73（`src/engine/` 97.74 / 94.59）。
- `pnpm test:e2e`（skipped，无 e2e 用例）与 `pnpm selfplay`（exit 1，RFC-015 占位；C-5 已登记的偏离）。
- 10 条变异探针 + 每次注入前的「目标字符串恰好 1 处」断言 + 每次的 `git checkout --` 恢复；结束时 `git status --porcelain` 为空。
- 200 个固定种子的合法动作 fuzz（含屠城模式）：无崩溃、无卡死、`replay` 一致。
- 两条只读探针：两个死者之夜的公开 payload（B1 的复现）、`step(..., [modifier])` 是否调用 modifier（C-33）。

**没能验证的**：

- **Windows**：本机是 macOS，未在 Windows 上复跑；`tests/helpers/source-scan.ts` 的 POSIX 归一化在 RFC-002 已修，但本 RFC 没有 Windows 实跑证据。
- **浏览器 / UI / Playwright**：本 RFC 没有 UI，`tests/e2e/` 无用例；`TEST-6` 从 RFC-012 起生效。
- **真实 LLM / 服务端**：本 RFC 不涉及；RFC-006/007 的路径未验证。
- **投影**：`project()` 不存在（RFC-007），AC-5 只在 `visibleTo` 元数据层验证；`isVisibleTo` 的行为矩阵按 RFC-001 §6 仍归 RFC-005。
- **变异探针 P1 / P3 / P8 的结论是「没有测试变红」**——这本身就是结论（测试不设防），不是「跑不起来」。

**本次评审对仓库的改动**：只新增本文件，并把 `RFCS.md` 的 RFC-004 状态改为 `Changes requested`、登记 C-31 / C-32 / C-33、关闭 C-29、版本 +1。没有改 `src/`、`RULES.md`、`PRD.md`、`FEATURES.md`，没有 commit。
