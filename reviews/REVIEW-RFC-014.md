# REVIEW · RFC-014 · Round 1

> 评审时间：2026-11-19 · 被评审提交：`15bb028 feat(rfc-014): 复盘快照、时间线与推理展示` · HEAD `15bb028`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-014 的实现代码。
> 结论：**Changes requested**

本轮用户点名四件事：**AC-3/4 的 reason 逐条一致与不依赖隐藏思维链、AC-8 的 usage 是否真的来自 `CallMeta`、AC-9~11 的视角是否真的用截断投影且筛选不改时间线、AC-13 的释放后仍可读**。先给直接回答，再展开完整 AC 与工程维度审查。

| 用户点名项 | 结论 | 最短证据 |
|---|---|---|
| **AC-3 / AC-4** | **AC-3 行为不成立；AC-4 结构上成立但证据是合成事件** | `grep -rn toThought src` 只命中定义（`src/server/llm/thought.ts:19`），生产路径没有任何 `AI_THOUGHT` 产出；真实跑完的一局 68 条事件里 `AI_THOUGHT=0`、`snapshot.thoughts=0`。AC-3 用例在 `fromEvents.length === 0` 时直接 `expect(snapshot.thoughts).toEqual([]); return`（`tests/server/replay.test.ts:148-152`），是空真。把 `buildReplaySnapshot` 的 `thoughts` 固定成 `[]`（M-R2）→ 官方 replay **8/8 全绿**。 |
| **AC-8** | **不成立** | 生产只在成功时 `recordUsage(gameId, outcome.meta)`（`src/server/ai/agent.ts:86`），且 `decide` 的 `metaLog` 在生产没有注入（`:80-83`）；`decide` 每次尝试各记一条 `CallMeta`（`client.ts:141/168/175`）。实测一次「第一次 INVALID_OUTPUT、第二次成功」：`CallMetaLog` 有 2 条（17/8 tokens），生产式 `recordUsage` 只有 1 条（10/5）。官方 AC-8 用例只是手工调两次 `recordUsage` 再读 `usageOf`，把 `recordUsage` 从生产删掉（M-R1）仍 **8/8 绿**。 |
| **AC-9 / AC-10 / AC-11** | **行为（探针）成立；官方证据不成立，且没有 AC-11 的 3 席 × 3 seq** | 真实路由探针：3 个席位 × 3 个 `seq`，响应 `view` 与 `project({ state: replay(截断事件), events: 截断事件, observer: seat, pending: null })` **逐字段相等**。但官方用例 `replay.test.ts:189-221` 创建 app 后 `void app;`（`:200`）从未打路由，只断言「事件 seq ≤ seq」；把路由改成「忽略 seq + 用玩家席位作 observer」（M-R3）→ 官方 **8/8 仍绿**。AC-10 只比较时间线条数（`tests/client/replay.test.tsx:73,80-81`），改掉筛选后的条目文本（M-R4）→ **7/7 仍绿**。AC-11 的 3 席 × 3 seq 属性测试不存在。 |
| **AC-13** | **端点字面 PASS；用户路径 FAIL** | 真实 `buildApp` + 会话 + `registry.release()` 后，`GET /api/games/:id/replay` 仍 **200** 且 `seats=9`、`timeline>0`（P-R3）。但官方用例只读 `record.snapshot`（`replay.test.ts:127-136`），没有打路由；把路由改成事件流为空时返回 410（M-R5）→ **8/8 仍绿**。更严重的是界面路径：`GET /api/games/:id` 对释放局返回 410 后，`App.tsx:49/57` 的 `view?.view.phase` 在 `{error}` 对象上抛出 `TypeError: Cannot read properties of undefined (reading 'phase')`（P-R5），根本到不了复盘页。 |

---

## 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `15bb028` · 评审开始时工作树 clean。

```text
$ pnpm typecheck            → exit 0
$ pnpm lint                 → exit 0
$ pnpm format:check         → All matched files use Prettier code style! → exit 0
$ pnpm build                → client 139 modules / server 64 modules → exit 0
$ pnpm test                 → Test Files 87 passed (87) / Tests 737 passed (737) → exit 0
$ pnpm test:e2e             → 10 passed (12.1s) → exit 0
$ coverage（引擎，meta 门禁） → All files 96.96% lines / 92.85% branches
```

`pnpm test` 的 737 条包含 `tests/meta/*` 的构建、五条命令与覆盖率门禁；`pnpm test:e2e` 的 10/10 里只有一条 RFC-014 复盘用例（`tests/e2e/game.spec.ts:230-263`），且它的标题写着「身份与推理」，实际只断言时间线标题与三个席位的「N 号：」前缀，没有断言任何推理内容——这与当前 `AI_THOUGHT=0` 是一致的，不是巧合。

本轮所有探针都从 `/tmp/howl-rfc014-r1/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前 5 个源码文件 SHA-256 已记录，恢复后逐一核对：

```text
4d3f98f2e5416d9da8b758e22d0c6b66b585ab5094dccb056272aa5f0bb4bd33  src/server/ai/agent.ts
7b1bb7d8a6d2b26e9162b89c96bf97bb102a27715d12c74fc4f25d237edf8b64  src/server/replay/snapshot.ts
650c0b41fb7389f3eaf5d405449a68bedd5f286c8c791bb4b30281b396a790fb  src/server/routes/games.ts
2a31dbc5aef4d81ad0557b0a8c8f473ed4010fa5d4fbf91abd6e51c26b0b2b79  src/client/pages/ReplayPage.tsx
942ee2dea4f69066f846210883061e7249124777cf9dacf6cd273e11fd66318c  src/server/store/game-registry.ts
```

临时探针测试 `tests/server/replay-probe.test.ts` / `tests/client/replay-probe.test.tsx` 已删除；探针结束后 `git status --porcelain` 为空；没有 `git commit`。

---

## 1. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本轮按 game 的「核心循环 / 复盘可读性 / 身份揭示 / 信息边界」与 web app 的「语义、键盘、响应式、真实浏览器」检查。平台认证、帧预算、手柄、存档版本化、账号、按资源授权、SEO、离线可用等检查按 PRD 的显式跳过表不适用。没有可用的真机与屏幕阅读器证据，本轮不宣称这两项通过。

---

## 2. 用户点名的四项

### 2.1 AC-3 / AC-4：reason 逐条一致与不依赖隐藏思维链

**AC-3 的核心问题不是「reason 读错」，而是「根本没有 reason 事件可读」。**

`toThought()` 是 RFC-006 留下的纯构造器，`src/server/llm/thought.ts:19`；全仓库 `grep -rn "toThought" src` 只命中这一处定义，**没有任何生产调用者**。`createLlmAgent` 只做三件事：`decide()` → `toAction()` → 返回 `{ action }` 或 `{ action, speech }`（`src/server/ai/agent.ts:80-100`）。`AgentDecision` 没有承载 `reason` 的字段（`src/server/ai/agent.ts:16-19`），`runGame` 只把 `action.action` 交给 `registry.submit`（`src/server/orchestrator.ts:192-201`）。`speak.ts` 也只写 `SPEECH`（`src/server/llm/speak.ts:70-77`）。

真实对局探针（固定种子 `20_261_117`、`playerSeat:1`、`runGame` + `scriptedAgent`、400 步上限）跑完 68 条事件：

```text
[probe] events 68 AI_THOUGHT 0 snapshot.thoughts 0
[probe] event types GAME_STARTED,WOLF_CHAT_POSTED,PHASE_CHANGED,WOLF_KILL_CHOSEN,
        SEER_CHECKED,PLAYER_DIED,DAY_STARTED,SPEECH,VOTE_CAST,VOTE_REVEALED,GAME_ENDED
```

补充一句公平的话：D-2 的 `AI_THOUGHT.seat` 本身实现正确——`toThought` 写入 `seat`（`src/server/llm/thought.ts:27`），`AiThoughtPayloadSchema` 校验它（`src/shared/schemas.ts:231-236`），测试也补了——但没有生产事件承载这个字段，所以它只是一个「为空的正确扩展」。

因此真实复盘页只会显示「这一局没有记录到推理。」（`ReplayPage.tsx:125`）。这违反：

- **PRD FR-12**：「每个 AI 每一轮的推理过程与投票动机……由 AI 在决策时显式产出的结构化字段提供」；
- **FEATURES F31 AC-3**：「显示每个 AI 每轮推理与投票动机（来自 F16 载荷）」；
- **FEATURES F16 AC-3/4**：「reason 写入事件流」「复盘展示的 AI 推理必须来自该载荷」；
- **PRD G3 / SM-2**：复盘要让人复述至少 2 个 AI 的意图。

如果实现方认为「产出 `AI_THOUGHT`」属于 RFC-006/007 的历史归属、不在 RFC-014 范围内，那么按权威顺序 `FEATURES.md > RFCs` 仍要求 F31 AC-3 / F16 AC-3；正确做法是走 `/manage-changes` 修改 FEATURES / RFC 并把 AC-3 标为降级，而不是在 §8.4 写 PASS。

RFC §8.4 把 AC-3 写成 PASS，但它的证据在脚本 AI 下永远走空真分支：`tests/server/replay.test.ts:148-152` 的 `if (fromEvents.length === 0) { expect(snapshot.thoughts).toEqual([]); return; }`。M-R2 把 `buildReplaySnapshot` 的 `thoughts` 直接改成 `[]` 后，官方 replay **8/8 仍绿**——也就是说「推理整体消失」这件事没有任何官方测试能发现。

**AC-4 在结构上成立**：`buildThoughts` 只读 `payload.reason`（`snapshot.ts:169-188`），不读 `reasoningContent`；`tests/server/replay.test.ts:70-83` 用带 `reasoningContent` 的合成事件断言输出不含哨兵文本。这一条按 AI-5 的方向是正确的，但证据只在 `buildThoughts` 级别，未覆盖 `buildReplaySnapshot` 的完整输出；由于生产从未写入 `reasoningContent`，这条测试也没有真正区分「从结构化 reason 读」和「从字段是否存在于事件对象读」——建议补一条快照级测试：给事件加 `reasoningContent` 哨兵，断言 `JSON.stringify(snapshot)` 不含哨兵。**AC-4 判 PASS，附带非阻塞测试建议。**

### 2.2 AC-8：usage 聚合是否真的来自 CallMeta

**不是。** 关键有三处：

1. **生产没有 `CallMetaLog`。** `decide` 允许注入 `metaLog`（`src/server/llm/client.ts:44`），但 `createLlmAgent` 调用 `decide({ config }, ...)` 没有传（`src/server/ai/agent.ts:80-83`）。因此生产根本不收集「全部 `CallMeta`」。
2. **只记录成功那一次尝试。** `decide` 在失败 / `INVALID_OUTPUT` 尝试上也各记一条 `CallMeta`（`client.ts:141/168/175`），但 `createLlmAgent` 只在 `decide` 返回成功 outcome 后 `recordUsage(input.gameId, outcome.meta)`（`agent.ts:86`）。重试一次就少算一次调用与失败尝试的 token；全部尝试失败时 `decide` 抛出，`recordUsage` 一次都不会执行。
3. **官方 AC-8 用例是同义反复。** `tests/server/replay.test.ts:161-186` 手工造两个 `CallMeta` 对象喂给 `recordUsage`，再断言 `usageOf` 的加法；它不经过 `createLlmAgent`，也不经过 `decide`/`CallMetaLog`。M-R1 把生产 `recordUsage` 整行删掉后，replay 官方 **8/8 仍绿**。

实测 Retry 探针（`maxRetries:1`、第一次返回非 JSON、第二次成功）：

```text
[probe] CallMetaLog [{"attempt":1,"ok":false,"inputTokens":7,"outputTokens":3},
                     {"attempt":2,"ok":true,"inputTokens":10,"outputTokens":5}]
[probe] CallMeta aggregate {"calls":2,"inputTokens":17,"outputTokens":8,"cachedTokens":0}
[probe] usageOf after production-style recordUsage {"calls":1,"inputTokens":10,"outputTokens":5,"cachedTokens":0}
```

AC-8 要求「调用次数与三类 token 之和等于该局**全部** `CallMeta` 的聚合值」，当前在重试 / 失败路径上系统性少算。RFC D-3 说「用量来自进程级 `usageOf(gameId)` 累加器」，但**累加器的输入不是 CallMetaLog，而是最后一次成功的 meta**；`usage.ts` 的注释「数据来自 RFC-006 的 `CallMeta`」只在类型层面成立。

### 2.3 AC-9 / AC-10 / AC-11：视角是否真的用截断投影、筛选是否不改时间线

**实现本身是对的，官方证据是假的。**

真实路由探针用真实 `buildApp` + 会话 cookie + 真实完成的对局，取 3 个席位（1/2/3）× 3 个 `seq`（第 5 个事件附近、事件流中段、最后一条），逐个请求 `GET /api/games/:id/replay/seat/:seat?seq=N`，并把响应 `view` 与独立计算的：

```ts
project({
  state: replay(record.events.filter(e => e.seq <= seq)),
  events: record.events.filter(e => e.seq <= seq),
  observer: seat,
  pending: null,
})
```

深度比较，**9/9 全部相等**。所以 D-4 的「截断后重新投影」是真的，不是界面猜的。

但官方用例 `tests/server/replay.test.ts:189-221`：

- `buildApp()` 后立刻 `void app;`（`:200`），**从未 `app.inject()`**；
- 用的是只完成 `START` 的 `record0`，不是终局；
- `expected` 与实现调用同一个 `project()`，只断言「事件 seq ≤ seq」（`:219-220`），没有席位维度、没有内容比较；
- 没有 `tests/server/replay-perspective.test.ts`（TEST-STRATEGY 计划里的文件）。

M-R3 把路由的 `const truncated = record.events.filter((event) => event.seq <= seq);` 改成 `record.events`，并把 `observer: seat` 改成 `observer: record.playerSeat` 后，官方 replay **8/8 仍绿**；同一个变异下，本轮的临时真实路由探针 **1 failed**（`res.json().view` 与期望不等）——说明这个探针有牙，官方套件没有。

AC-10 也同理：`tests/client/replay.test.tsx:73,80-81` 只比较筛选前后的 `getAllByRole('listitem').length`，没有比较条目文本。M-R4 在选中席位时给每条时间线文本追加 `·MUTATION`（条数不变、内容全变）→ client replay **7/7 仍绿**。AC-10 要求「条目数量**与内容**一致」，当前只锁了数量。

AC-11 的「属性测试覆盖 3 个席位 × 3 个 `seq`」完全不存在；上面的 9/9 是本轮临时探针，不是仓库回归锁。

### 2.4 AC-13：对局状态被释放后仍可读

**端点字面通过；产品路径不通过。**

真实探针：`finishedGame()` → `registry.release(gameId)`（事件流清空）→ `GET /api/games/:id/replay` 返回 **200**，`seats` 长度 9，`timeline` 非空。D-1 的「终局生成一次并落盘」是真的。

但有三层缺口：

1. **官方用例没有打到路由。** `tests/server/replay.test.ts:127-136` 只断言 `registry.getGame(...).snapshot` 仍在，没有 `buildApp` / `inject`。M-R5 把路由改成「事件流为空 → 410」后官方 replay **8/8 仍绿**。
2. **释放后视角端点 500。** `GET /replay/seat/:seat` 直接 `replay(record.events)`（`routes/games.ts:150-151`）；释放后 `record.events=[]`，`replay([])` 抛 `InvalidEventStreamError`（`src/engine/replay.ts:21`），真实探针得到 **500**：`{"statusCode":500,"error":"Internal Server Error","message":"事件流为空：replay 至少需要一个 GAME_STARTED"}`。`seq=0` 同样 500。复盘页选中 AI 时 `client.replayPerspective` 返回 null，视角面板静默消失。
3. **界面路径直接崩。** 释放后的局 `GET /api/games/:id` 返回 410（`games.ts` 的现有逻辑）；`App` 的 `refresh()` 把 410 JSON 原样 `setView`，随后 `view?.view.phase` 对 `{error}` 抛 `TypeError`（`App.tsx:49/57`；真实渲染探针 P-R5 复现）。也就是说，即便用户手里有旧局 URL，界面也到不了复盘页，更读不到快照。

结论：**AC-13 的端点级测试通过，但 RFC §2.1 的「状态释放后仍可查看」在用户路径上不成立**，且没有路由级回归锁。详见 C-161 / C-166 / C-171。

---

## 3. 全部验收标准

| AC | 结论 | 证据 / 缺口 |
|---|---|---|
| 1 | **PASS（行为）/ 证据单向** | 真实一局 54 条 timeline / 68 条事件；`seq` 升序、每条都能在事件流里找到（`replay.test.ts:49-64`）。但只做「timeline → events」方向，没有「events → timeline」；14 条 `VOTE_CAST` 被省略（由 `VOTE_REVEALED` 聚合），`REJECTED` 无分支（RFC-002 Q-002-3 说应计入）。见 C-170（非阻塞）。 |
| 2 | **FAIL（测试）** | 只断言 9 席、`roleLabel.length > 0`、persona 二选一（`replay.test.ts:53-57`）。M-R6 把每席角色都改成狼人、人格都改成 `MUTATION` → 8/8 仍绿；没有与 `GAME_STARTED.roles` / `state.seats` 比对。见 C-163。 |
| 3 | **FAIL（行为 + 测试）** | 生产无 `AI_THOUGHT`；AC-3 用例空真；M-R2 全绿。见 C-156。 |
| 4 | **PASS（结构）/ 建议补快照级断言** | `buildThoughts` 只读 `reason`；合成事件断言不含 `reasoningContent`。见 §2.1。 |
| 5 | **FAIL（测试）** | 只断言 `personaId===null || personaLabel!==null`；没有与实际人格分配比对；M-R6 全绿。见 C-163。 |
| 6 | **FAIL（测试）** | 只断言 `result ∈ {wolf,good}`、`winCondition.length>0`（`:59-60`），没有与 `GAME_ENDED` payload 比对，也没有「定位到达成事件」的断言；M-R6 把 result 固定 good、winCondition 固定 `MUTATION` → 8/8 仍绿。见 C-163。 |
| 7 | **PASS（行为）/ 测试合成** | `buildReplaySnapshot` 从 `DEGRADED` 取 seq，单元用例用合成事件断言 `[4,9]`；时间线 `Timeline` 有降级标记与 client fixture 用例。没有真实 `DEGRADED` 事件进快照的集成用例（RFC-010 的生产降级路径可另测）。 |
| 8 | **FAIL（行为 + 测试 + UI）** | 不是全部 `CallMeta` 聚合；重试少算；官方用例只测累加器；M-R1 全绿；`usage` 也没有在复盘页渲染。见 C-157 / C-158。 |
| 9 | **FAIL（官方证据）/ 行为 PASS** | 真实路由 9/9 等价；官方用例 `void app` 未打路由；M-R3 全绿。见 C-159。 |
| 10 | **FAIL（测试）/ 行为 PASS** | 只锁条数，不锁内容；M-R4 全绿。见 C-160。 |
| 11 | **FAIL（无测试）/ 行为 PASS** | 3 席 × 3 seq 属性测试不存在；真实探针只证明与 `project` 等价（即无越权信息的定义），没有独立泄漏断言。见 C-159。 |
| 12 | **PASS（行为）/ 证据弱** | `client.restart()` 新建游戏 + `/play`；e2e 只断言回到「Howl」界面，没有断言新 `gameId` / 新种子 / 无旧事件。行为由 UUID + 随机种子结构保证。见 C-168（非阻塞）。 |
| 13 | **FAIL（产品路径）/ 端点 PASS** | 端点探针 200 + 9 席；释放后视角 500；App 410 崩溃；官方无路由级锁。见 C-161 / C-166 / C-171。 |
| 14 | **PASS（360）/ 1024 未测** | e2e 360px 复盘无横滚真实通过；1024px 复盘没有用例。见 C-169（非阻塞）。 |

---

## 4. 工程维度

### 4.1 RFC ADHERENCE — **FAIL**

- AC-3 / AC-8 / AC-9 / AC-10 / AC-11 / AC-13 的官方证据与 RFC §8.4 的 PASS 不符（详见 §2 / §3）。
- **超出 RFC 的完成度缺口**：F31 AC-7 / F20 AC-2 要求复盘显示调用次数与 token 汇总，`ReplayPage` 没有任何 usage 渲染；F38 AC-3 要求种子出现在复盘中且可复制，快照里有 `seed` 但界面不显示。
- **契约偏离未记录（DOC-1）**：`ThoughtEntry.kind` 恒为 `'speech'`、`chose` 恒为 `''`（`snapshot.ts:180-186`），而 RFC §2.3 要求 `kind: 'speech' | 'vote' | 'night-action'`、`chose` 是目标或发言摘要；`ThoughtCard` 对非 speech 会直接显示英文 `vote` / `night-action`（`ThoughtCard.tsx:13`）。这是实现决定，但没有写进 §8.2。
- RFC §8.6 的「已知缺口」只写「视角面板只显示事件类型」，没有写「没有推理事件」「没有 usage 展示」这两个更大的缺口。

### 4.2 RULES COMPLIANCE — **FAIL**

| 规则 | 判定 | 证据 |
|---|---|---|
| **AI-5** | **PASS（结构）** | 快照只读 `payload.reason`；`reasoningContent` 不进快照。但由于没有 AI_THOUGHT，这条目前是空真。 |
| **API-1** | **FAIL** | `src/shared/replay-schema.ts` 定义了契约，客户端 `api.ts:67-71` 会 `safeParse`，但服务端 `GET /replay` 直接 `reply.send(record.snapshot)`（`routes/games.ts:346-347`），`GameRecord.snapshot` 还是 `unknown`（`game-registry.ts:36`）；服务端没有 parse，客户端也没有 replay 的正/负用例。与 RFC-013 C-151 是同一模式。见 C-162。 |
| **TEST-1** | **FAIL** | AC-2/3/5/6/8/9/10/11/13 的断言不成立或没有路由级/全链路证据（见 §3）。 |
| **TEST-6** | **部分** | 有一条复盘主路径 e2e，但只覆盖 360px、身份前缀与「再来一局」按钮；没有推理、没有 1024、没有释放后。 |
| **DOC-1** | **FAIL** | `kind`/`chose` 偏离、usage 未渲染、无 AI_THOUGHT 均未记录在 §8.2 / §8.6。 |
| **DATA-6 / ARCH-3** | **PASS** | 快照是值拷贝，不含 `GameState` 引用；`seats` / `timeline` / `thoughts` 都是普通对象与字符串。 |
| **SEC-5 / SEC-6** | **PASS（边界）** | 复盘在终局后才提供全部身份与推理（C-8 的例外）；视角按 observer 投影；路由只允许本会话。 |
| **STYLE-6** | **PASS** | 新增文件均 < 400 行（`snapshot.ts` 191、`ReplayPage.tsx` 140）。 |

### 4.3 SECURITY — **PASS（有边界说明）**

- `GET /replay` / `/replay/seat/:seat` 都校验会话归属，别人的 `gameId` 返回 404；视角按 `observer: seat` 投影，未发现越权事件。
- 快照只在 `FINISHED` 后生成，符合 SEC-6 的时间边界。
- 释放后视角端点 500 不泄漏数据，但会暴露内部错误文案「事件流为空：replay 至少需要一个 GAME_STARTED」（`P-R3`）；生产 `logger` 下虽是 500 抽象响应，建议仍改为 410/空视图，避免把内部状态机错误呈现在 HTTP 上。
- 当前没有测试锁住「视角确实按 observer 过滤」——M-R3 把 observer 换成玩家席位后官方全绿；这属于安全相关的测试缺口（C-159）。

### 4.4 PERFORMANCE — **NEEDS WORK**

- 快照在终局生成一次，`GET /replay` O(1)，方向正确。
- **复盘页每秒轮询 `GET /api/games/:id` 永不停止**（`App.tsx:59-69` 的 `setInterval` 在 `FINISHED` 后没有清理）；每次 `setView` 都让 `ReplayPage` 的 `loadPerspective` 成为新函数（`App.tsx:138`），选中席位后 `useEffect` 每秒重新请求一次完整 `replay + project`（`ReplayPage.tsx:44-57`）。在释放局上这会每秒打一次 500。见 C-172（非阻塞）。
- `usage.ts` 的 `Map<gameId, UsageTotals>` 只增不删（`usage.ts:19`），100 局后线性增长；F37 / NFR-17 的「不随局数线性增长」没有被测试。见 C-165（非阻塞）。
- 视角请求每次从事件流头 `replay`，单机 9 人局可接受；若以后按时间线拖动，需要缓存截断状态。

### 4.5 MAINTAINABILITY — **NEEDS WORK**

- `buildTimeline(state, events)` 的 `state` 参数完全未使用，末尾 `void state;` 的注释声称「没有事件时兜底」，但代码没有兜底（`snapshot.ts:49,165`）。这是误导性死参数。
- `ThoughtEntry.kind` / `chose` 的硬编码让类型看起来支持三类推理，实际全部标成「发言」；测试也从未覆盖非 speech 的渲染（`ThoughtCard.tsx:13`）。
- `tests/server/replay.test.ts:200` 的 `void app;` 是「造了 app 又扔掉」的死代码；`replay.test.ts` 的 AC-3 分支是空真；`tests/server/project/thought.test.ts:29` 的 AI_THOUGHT 夹具仍不带 `seat`，用 `as unknown as GameEvent` 绕过新契约，导致 `AI_THOUGHT.seat` 的类型变更在这条投影用例里没有锁。
- 文档 / 测试计划漂移：`TEST-STRATEGY.md:362-371` 全部仍为 `proposed`，计划中的 `tests/server/replay-perspective.test.ts`、`tests/e2e/replay.spec.ts` 不存在（实际合并进 `game.spec.ts`）；`README.md` 仍写 720 用例、RFC-001~013 Reviewed、剩余 014/015/016；RFC §8.4 把多条空真证据写成 PASS。见 C-167。

---

## 5. 发现汇总

### 阻塞

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-156** | AC-3、PRD FR-12、F31 AC-3、F16 AC-3/4 | **生产从未产出 `AI_THOUGHT`**：`toThought` 只有定义/测试，没有调用者；`AgentDecision` 不承载 `reason`；真实一局 `AI_THOUGHT=0`、`snapshot.thoughts=0`。AC-3 用例在 0 条时提前返回，M-R2 把 `thoughts` 固定 `[]` 仍 8/8 绿。 | 在每条 AI 决策（发言、投票、夜间动作）把 `toThought()` 写入事件流：需要扩展 `AgentDecision` 或让 `runGame`/`speak` 接收 thought 事件；补一条真实 `decide`（假 fetch，带 `reason`/`claim`）→ `AI_THOUGHT` → 快照逐条比对的用例；把 `thoughts: []` 的变异打红。 |
| **C-157** | AC-8、NFR-13、F20 AC-2 | **usage 不是全部 `CallMeta` 的聚合**：生产 `decide` 无 `metaLog`；只用成功 outcome 的 `meta`；重试/失败少算。AC-8 用例只测累加器；M-R1 删 `recordUsage` 仍 8/8 绿。 | 把 `CallMetaLog` 注入 `decide`（或让 `recordUsage` 在 `decide` 的每条 `CallMeta` 处调用），按 gameId 聚合全部 attempt；用假 fetch 构造「失败一次 + 成功一次」，断言 `snapshot.usage` 等于 `metaLog.all()` 的 calls / 三类 token 之和。 |
| **C-158** | F31 AC-7、F20 AC-2 | **复盘页不显示调用次数与 token 汇总**：`ReplaySnapshot.usage` 存在，但 `ReplayPage.tsx` 只渲染时间线条数与降级次数；`grep -rn "usage\|token\|调用次数" src/client` 无命中。 | 在 `ReplayPage` 头部渲染 calls / input / output / cached（并处理 `usage` 可选），补组件测试断言数字与快照一致。 |
| **C-159** | AC-9、AC-11、TEST-1、SEC 相关 | **视角端点没有真实路由测试**：官方用例 `void app`，只断言 seq 边界；3 席 × 3 seq 属性测试不存在；M-R3 忽略 seq + 换 observer → 官方 8/8 绿。 | 用真实 `buildApp` + 完成局 + 3 席 × 3 seq，逐个 `inject` 并与独立 `project(replay(truncated), truncated, seat, null)` 深度比较；补「越权私有事件不出现」断言；M-R3 必须打红。 |
| **C-160** | AC-10、TEST-1 | **筛选只锁条数不锁内容**：`replay.test.tsx:73,80-81` 只比 listitem 数量；M-R4 改文本仍 7/7 绿。 | 记录筛选前 `Timeline` 的 `data-replay-seq` + `textContent` 数组，筛选后逐项 deep equal；M-R4 打红。 |
| **C-161** | AC-13、TEST-1 | **释放后 `GET /replay` 没有 HTTP 回归锁**：官方只查 `record.snapshot`；M-R5 退化成 410 仍 8/8 绿。 | 补 `buildApp` + `release()` + `GET /replay` 200 / 9 席 / timeline 非空；同时断言别人的会话 404。 |
| **C-162** | API-1 | **共享 schema 只完成一半**：服务端 `routes/games.ts:346-347` 直接 `reply.send(record.snapshot)`，没有 `ReplaySnapshotSchema.parse`；`snapshot?: unknown`；`tests/client/api.test.ts` 只有 truth，没有 replay / perspective 的正负用例。 | 服务端 `ReplaySnapshotSchema.parse(record.snapshot)`（执行层用 `safeParse` 回 500 或空），`GameRecord.snapshot?: ReplaySnapshot`；客户端补 replay 合法 / 缺字段两条用例。 |
| **C-163** | AC-2 / AC-5 / AC-6、TEST-1 | **身份 / 人格 / 结果的断言同义反复**：只检查 9 席、标签非空、result 在集合、condition 非空；M-R6 把所有 `roleLabel` 改成「狼人」、`personaLabel` 改成 `MUTATION`、result 固定 `good`、condition 固定 `MUTATION` → 8/8 仍绿。 | 与 `GAME_STARTED` / `replay(GAME_STARTED+...)` 的实际 roles、persona 分配逐席比较；result / winCondition 与 `GAME_ENDED.payload` 精确相等，并在 timeline 中定位 `GAME_ENDED` 的 seq；补 `result` 双分支（wolf / good）。 |
| **C-171** | AC-13（产品路径）、F33 AC-4、FE-AS-2 | **释放后界面崩、到不了复盘**：`GET /api/games/:id` 对释放局返回 410 后，`App.tsx:49/57` 的 `view?.view.phase` 在 `{error}` 对象上抛 `TypeError`（P-R5）；`view.view` 为 undefined 也会让 `buildBoard` 失败。结果是「快照还在，但人打不开」。 | `refresh` 里先判断 `view` / 410，不要把它当 `GameViewResponse`；当对局已释放时直接走 `client.replay(gameId)` 并以复盘页渲染（或显示「已释放」并给旧局入口）；补一条 client 用例：410 → 不崩溃且能显示快照。 |

### 非阻塞

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-164** | RFC §2.3、F31 AC-3、DOC-1 | `ThoughtEntry.kind` 恒 `'speech'`、`chose` 恒 `''`；`ThoughtCard` 对非 speech 显示英文 `vote` / `night-action`。 | 从决策载荷派生 kind / chose（或扩展 `AI_THOUGHT` payload），并在 §8.2 记录取舍；补 vote / night-action 的渲染用例。 |
| **C-165** | F37 / NFR-17 | `usage.ts:19` 的 `Map` 永不删除；进程级用量随局数线性增长。 | 在 `release()` 或 retention 时清理该局 usage，或改用有上限的 LRU；补 100 局内存/键数断言。 |
| **C-166** | AC-9 释放后、鲁棒性 | 释放后 `/replay/seat/:seat` 500（`replay([])` 抛错）；`seq=0` 也 500。 | `record.events.length === 0` 时返回 410/空视图；`seq` 必须 ≥ 1 且为整数；补两条路由用例。 |
| **C-167** | DOC-1、TEST-STRATEGY | 文档 / 测试计划漂移：`TEST-STRATEGY.md:362-371` 仍 `proposed`，两个计划文件不存在；`README.md` 仍 720 用例、RFC-014 未 Reviewed；RFC §8.4 的 PASS 与实测不符。 | 回填 `Exists?` 为实际文件，修 README 计数与状态，按本轮发现重写 §8.4 / §8.6。 |
| **C-168** | AC-12 | e2e 只断言「再来一局」回到 Howl，没有断言新 `gameId` / 新种子 / 无旧事件。 | 在 e2e 或 server 用例里记录旧 `gameId` / 事件，重启后断言新 gameId、`GAME_STARTED` 只有一条、旧事件不在新流里。 |
| **C-169** | AC-14 | 1024px 复盘没有用例；e2e 只测 360px。 | 在 `game.spec.ts` 的复盘 describe 加 1024px 视口，断言侧栏/时间线可见且 `scrollWidth <= clientWidth`。 |
| **C-170** | AC-1、F31 AC-1、RFC-002 Q-002-3 | timeline 只做「条目 → 事件」单向检查；真实一局 68 事件 / 54 条 timeline，14 条 `VOTE_CAST` 省略；`REJECTED` 没有分支（Q-002-3 假设应计入）。 | 明确「完整」口径（哪些事件聚合、哪些省略）并写进 RFC；补 `REJECTED`/`VOTE_CAST` 的预期；或做双向一致性断言。 |
| **C-172** | 性能 | 终局后 `App` 仍每秒轮询 `GET /game`；`ReplayPage` 的 `loadPerspective` 是内联新函数，选中席位后每秒重新 `replay + project`。 | `FINISHED` 时停掉轮询；用 `useCallback` 稳定 `loadPerspective`；只在 `selected` / `seq` 变化时请求。 |
| **C-173** | F38 AC-3 | `ReplaySnapshot.seed` 有值但复盘页不显示、不可复制。 | 在 `ReplayPage` 头部显示 seed（等宽、可复制），补组件用例。 |
| **C-174** | 测试债 | `tests/server/project/thought.test.ts:29` 的 `AI_THOUGHT` 夹具仍不带新必需的 `seat`，用 `as unknown as GameEvent` 绕过类型；`AI_THOUGHT.seat` 没有在投影/重放测试里锁住。 | 给夹具补 `seat`，去掉不必要的 cast；补一条缺 `seat` 的 schema 负用例。 |
| **C-175** | UI-2 / 术语 | `ThoughtCard` 的「发言」与 `replay` 文案有硬编码（不属于 `TERMS` 的 13 个术语，风险较低）；非 speech 的 kind 会显示英文。 | 把 kind 映射成中文标签（发言 / 投票 / 夜间行动），与术语表保持同一来源。 |

---

## 6. 探针记录

所有探针均使用文件备份恢复；没有使用 `git checkout` / `git restore`。

| 探针 | 变更 | 结果 |
|---|---|---|
| **M-R1** | `src/server/ai/agent.ts` 删掉 `recordUsage(input.gameId, outcome.meta);` | `replay.test.ts` **8/8 passed** → AC-8 的生产路径无回归锁 |
| **M-R2** | `snapshot.ts` 把 `thoughts: buildThoughts(events)` 改成 `thoughts: []` | `replay.test.ts` **8/8 passed** → AC-3 的整体推理丢失无回归锁 |
| **M-R3** | `routes/games.ts` 的 `truncated` 改成全量事件，`observer` 改成 `record.playerSeat` | 官方 `replay.test.ts` **8/8 passed**；临时真实路由探针 **1 failed**（9 组对照中至少一组不等）→ 探针有牙、官方无锁 |
| **M-R4** | `ReplayPage.tsx` 在选中席位时给 timeline 文本追加 `·MUTATION` | `tests/client/replay.test.tsx` **7/7 passed** → AC-10 只锁条数 |
| **M-R5** | `routes/games.ts` 的 `GET /replay` 在 `events.length === 0` 时返回 410 | `replay.test.ts` **8/8 passed** → AC-13 的路由退化无锁 |
| **M-R6** | `snapshot.ts` 把每席 `roleLabel` 改成「狼人」、`personaLabel` 改成 `MUTATION`、result 固定 `good`、winCondition 固定 `MUTATION` | `replay.test.ts` **8/8 passed** → AC-2/5/6 断言无牙 |

| 正向探针 | 内容 | 结果 |
|---|---|---|
| **P-R1** | 真实 `runGame` 完成局（seed `20_261_117`，playerSeat 1）| `events=68`、`AI_THOUGHT=0`、`snapshot.thoughts=0`；事件类型见 §2.1 |
| **P-R2** | 真实 `buildApp` + 3 席 × 3 seq 视角路由 vs 独立 `project(replay(truncated))` | **9/9 深度相等** |
| **P-R3** | `release()` 后 `GET /replay` / `GET /replay/seat/1?seq=5` / `seq=0` | replay **200 + 9 席**；视角 **500**（空事件流）；`seq=0` **500** |
| **P-R4** | `decide` 假 fetch：第一次 INVALID_OUTPUT + 第二次成功，`metaLog` 收集 | `CallMetaLog` 2 条（17/8），生产式 usage 1 条（10/5） |
| **P-R5** | `App` + 假 client 返回 `{ error:'GAME_EXPIRED' }`（410） | 未捕获 `TypeError: Cannot read properties of undefined (reading 'phase')`，没有复盘页 |
| **P-R6** | `grep -rn "toThought" src` | 仅 `src/server/llm/thought.ts:19` 定义，无生产调用 |

---

## 7. 结论

**Overall Risk Level: High**

**Summary**：快照的形状与终局落盘（D-1）、截断后重新投影（D-4）这两个最关键的架构点是**真的**：真实路由探针 9/9 等价、释放后 `GET /replay` 仍 200。问题在于**「真的」只存在于临时探针，不在仓库里**：AC-3 没有 AI 推理事件可读，AC-8 不是全部 CallMeta 的聚合，AC-9~11 和 AC-13 的官方用例没有打到真实路由，身份/人格/结果的断言是空真。这不是「测试覆盖率差一点」，而是 v1 核心展示资产（PRD G3 / SM-2）在真实对局里无法演示。

**Blocking Issues（必须修复后才能合并）**

1. **C-156**：生产无 `AI_THOUGHT`，复盘推理永远为空（AC-3 / PRD FR-12 / F31 AC-3 / F16 AC-3）。
2. **C-157**：usage 只记成功尝试，不是全部 `CallMeta` 聚合（AC-8 / NFR-13）。
3. **C-158**：复盘页不显示调用次数与 token 汇总（F31 AC-7 / F20 AC-2）。
4. **C-159**：视角端点没有真实路由测试，AC-11 的 3 席 × 3 seq 属性测试缺失（AC-9 / AC-11 / TEST-1）。
5. **C-160**：筛选只锁时间线条数，不锁内容（AC-10 / TEST-1）。
6. **C-161**：释放后 `GET /replay` 没有 HTTP 回归锁（AC-13 / TEST-1）。
7. **C-162**：服务端不校验 `ReplaySnapshotSchema`，客户端没有 replay 负用例（API-1）。
8. **C-163**：AC-2/5/6 的身份/人格/结果断言同义反复（TEST-1）。
9. **C-171**：释放局让 `App` 在 410 上崩溃，用户到不了复盘（AC-13 产品路径 / F33 AC-4 / FE-AS-2）。

**Improvement Suggestions（非阻塞）**：C-164 ~ C-175。优先补 C-166（释放后视角 500）、C-172（复盘页每秒轮询）、C-167（文档与测试计划回填）；C-158 的 usage 展示建议与 F38 的 seed 展示一起做，复盘页头部一次补齐。

**状态**：`RFCS.md` 中 RFC-014 的 Status 置为 **`Changes requested`**。

---

## Round 2 -- 2026-11-19

> 评审时间：2026-11-19 · 被评审提交：`1eb60b5 fix(rfc-014): 真实产出推理、用量含失败与视角路由级用例（Round 1）` · HEAD `1eb60b5`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-014 的实现代码。
> 结论：**Changes requested**

本轮用户点名复核 Round 1 的六项（C-156 ~ C-161）。先说明编号：你消息里的编号与 Round 1 记录不是同一套，C-158 / C-159 / C-160 / C-161 分别落在 Round 1 的 C-159 / C-171+C-161+C-166 / C-162 / C-158。下面按「你点名的行为」逐项复核，并在括号里标 Round 1 编号。C-164 ~ C-170、C-172 ~ C-175 按指示未重查；C-160（AC-10）与 C-163（AC-2/5/6）是 Round 1 仍 Open 的阻塞项、不在你的六项里，但它们仍会让 RFC 无法通过，所以一并复核。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `1eb60b5` · 评审开始与探针结束时工作树 clean；最终只有本评审记录（`RFCS.md` 与 `reviews/REVIEW-RFC-014.md`）变更。

```text
$ pnpm typecheck            → exit 0
$ pnpm lint                 → exit 0
$ pnpm format:check         → All matched files use Prettier code style! → exit 0
$ pnpm build                → client 139 modules / server 65 modules → exit 0
$ pnpm test                 → Test Files 87 passed (87) / Tests 743 passed (743) → exit 0
$ pnpm test:e2e             → 10 passed (12.2s) → exit 0
$ coverage（引擎，meta 门禁） → 行 96.96% / 分支 92.85%
```

`pnpm test` 在全部探针恢复后又完整跑了一遍，仍是 **87 files / 743 tests**。`pnpm test:e2e` 的 10/10 里，复盘主路径仍由 `HOWL_FAKE_AI=1` 的脚本 AI 驱动（`playwright.config.ts:22-30`），所以它能证明复盘页面能打开，不能证明「真实模型产出的推理」；这与本轮 C-176 的缺口一致。

本轮所有探针都从 `/tmp/howl-rfc014-r2/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。6 个源码文件 SHA-256 已记录，恢复后逐一核对：

```text
4873dd84c0ec509dfde76c1ce9d9a94576bf194d8c68dedecc48dbf5190b0693  src/server/ai/agent.ts
5f3ffadae78f821f8d3e5f9bd2bf1416af08d31f2006e08c5b308358fcaebbbb  src/server/orchestrator.ts
eb2ff8577f806ef1783a895fb75b99799122bcda17212e8c35b1928f2f1c366c  src/server/routes/games.ts
7b1bb7d8a6d2b26e9162b89c96bf97bb102a27715d12c74fc4f25d237edf8b64  src/server/replay/snapshot.ts
fafadd5a2832a8217145f56e374b7aa46e272aaa572273e83e250f4ea468d3f0  src/client/pages/ReplayPage.tsx
b49353ebf52f3e6e27a09f29882f94ed39a66a0299ed645a11eeccdf6648edae  src/client/api.ts
```

临时探针测试 `tests/server/replay-probe.test.ts` / `tests/client/app-expired-probe.test.tsx` 已删除；探针结束时 `git status --porcelain` 为空；没有 `git commit`。

### 1. 编号对照与结论

| 你点名 | Round 1 | 本轮结论 |
|---|---|---|
| C-156 推理事件 | C-156 | 生产已产出；**终局快照漏最后一条** → C-176 阻塞 |
| C-157 用量含失败 | C-157 | 行为正确；**用例仍是同义反复** → 仍阻塞（测试） |
| C-158 3 席 × 3 seq | C-159 | **闭合**（M2-E 打红） |
| C-159 释放局 App / 410 | C-171 + C-161 + C-166 | 端点闭合；**App 仍崩** → C-171 仍阻塞 |
| C-160 服务端 parse | C-162 | **闭合（行为）**；无回归锁 → C-177 非阻塞 |
| C-161 复盘页用量 | C-158 | **闭合**；cached 未展示 → C-178 非阻塞 |

### 2. 用户点名的六项

#### 2.1 C-156：生产已产出 AI_THOUGHT，但终局快照漏最后一条

核心修复成立：

- `AgentDecision` 已有 `thought`（`src/server/ai/agent.ts:15-20`）；LLM Agent 从 `outcome.decision.reason` 带出 `thought`（`agent.ts:100-108`）；`runGame` 在 `registry.submit` 成功后追加 `AI_THOUGHT`（`src/server/orchestrator.ts:224-241`），payload 含 `seat`（`:236`）。
- 新用例 `tests/server/replay.test.ts:224-271` 有牙：M2-B 删掉追加块后，这条 **1 failed**（`thoughts.length` 为 0），其余 12 条仍绿。与 Round 1 的「`toThought` 没有任何生产调用者」相比，这是实质进展。

**但持久化快照不完整（C-176，阻塞）。** `registry.submit` 在动作导致 `FINISHED` 时生成 `record.snapshot`（`src/server/store/game-registry.ts:217-228`），之后 `runGame` 才 `appendEvents` 追加这条 `AI_THOUGHT`（`orchestrator.ts:224-241`）；`appendEvents` 只改 `events`，不重算 `snapshot`（`game-registry.ts:239-243`）。真实完成局探针（脚本 AI 外层补 `thought`，走真实 `runGame` / `submit`）：

```text
{"status":"finished","totalEvents":108,"aiThoughtsInEvents":40,"thoughtsInSnapshot":39,
 "lastEventType":"AI_THOUGHT","lastThoughtSeq":108,"gameEndedSeq":107,
 "missingReason":"R-8-NIGHT_WOLVES","snapshotHasLastThought":false}
```

即每局最后一条 AI 决策的推理不会出现在 `GET /replay` 返回的 `record.snapshot` 里。AC-3 要求「每条 `reason` 与对应决策的结构化载荷 `reason` 完全一致（逐条比对）」，F31 AC-3 要求「每个 AI 每轮推理与投票动机」；少最后一条不是完整实现。

新加的「完成局里 thoughts 数量等于事件流里的 AI_THOUGHT 数量」（`tests/server/replay.test.ts:372-380`）仍是 **0 = 0**：它用 `finishedGame()`，而 `scriptedAgent` 根本不返回 `thought`（`src/server/ai/agent.ts:37-64`）。M2-B 删掉追加块后这条仍绿，因为它没有 `expect(fromEvents).toBeGreaterThan(0)`。自定义 decide 的那条用例用 `maxSteps: 40` 且从未打到 `FINISHED`，又在 `replay.test.ts:264-268` 自己调用 `buildReplaySnapshot`，所以恰好绕开了「终局落盘」这条真实路径。

#### 2.2 C-157：用量行为正确，回归锁仍是同义反复

行为层面已修：

- `createLlmAgent` 把 `usageMetaLog` 注入 `decide`（`agent.ts:82-85`）；`decide` 在格式失败、成功、异常三条路径都调用 `deps.metaLog?.record`（`src/server/llm/client.ts:141/168/175`）；`usageMetaLog.record` 按 `meta.gameId` 聚合（`src/server/llm/usage.ts:52-55`）。失败与重试会计入。

但新用例（`tests/server/replay.test.ts:274-302`）只是手工 `usageMetaLog.record` 两次再读 `usageOf`；它不经过 `decide`、不经过 `createLlmAgent`，也不经过 `runGame` 或快照。M2-A 把 `agent.ts` 的 `metaLog: usageMetaLog as never` 删掉后，`tests/server/replay.test.ts` **13/13 仍绿**。这正是 Round 1 C-157 批评的「同义反复」换了一层：验证了 sink，没有验证接线。

建议：用假 `fetch` 让第一次返回非 JSON、第二次返回合法决策，走 `decide({ config, metaLog: usageMetaLog })`，并断言 `buildReplaySnapshot(...).usage`（或完成局的 `record.snapshot.usage`）等于两次 attempt 的 calls / input / output / cached 之和；再把 `metaLog` 注入删掉应打红。

#### 2.3 C-158（R1 C-159）：视角端点路由测试闭合

`tests/server/replay.test.ts:305-341` 现在用真实 `buildApp` + 完成局 + 3 个席位（1/3/5）× 3 个 `seq`，逐个 `app.inject`，响应与 `project({ state: replay(truncated), events: truncated, observer: seat, pending: null })` **深度相等**。

M2-E 把路由的 `truncated` 改成全量事件、`observer` 改成 `record.playerSeat` 后，这条 **1 failed**（视图里出现未来的 `GAME_ENDED`、`self.alive` 也变了），其余 12 条绿。AC-9 / AC-11 的 3 席 × 3 `seq` 有真实锁，Round 1 C-159 闭合。

旧用例 `tests/server/replay.test.ts:189-221` 仍保留 `void app;` 和「路线由 e2e/路由测试覆盖」的注释，是死代码 / 误导；非阻塞，建议删除或改成只锁「截断后投影」的单元断言。

#### 2.4 C-159（R1 C-171 + C-161 + C-166）：端点闭合，App 产品路径仍崩

端点部分：

- 释放后 `GET /replay` 200 + 9 席：`tests/server/replay.test.ts:343-361`；M2-F 在路由里对空事件流返回 410 后，这条 **1 failed**，锁成立。R1 C-161 闭合。
- 释放后 `GET /replay/seat/:seat` 410：`src/server/routes/games.ts:144-146`；用例 `replay.test.ts:363-368` 断言 410。R1 C-166 闭合，500 的内部错误文案也不再出现。

**App 路径仍未修（C-171，阻塞）。** RFC §8.7 写「`ApiClient.game` 对非 2xx 抛错」，但 `src/client/api.ts:40-46` 没有 `response.ok` 检查，410 的 JSON 被原样当成 `GameViewResponse` 返回：

```text
[probe] ApiClient.game 410 → {"error":"GAME_EXPIRED","message":"对局已释放"}，hasView=false，没有抛错
```

因此 `App.refresh` 的 `catch`（`src/client/App.tsx:39-49`）永远不会执行，`client.replay()` 的兜底是死代码。用等价 fake client（`game()` 返回同样的 410 对象，`openStream` 为 noop）渲染 `App`：

```text
TypeError: Cannot read properties of undefined (reading 'phase')
  at App src/client/App.tsx:61  （view?.view.phase）
```

页面不出现「复盘」。`tests/client/replay.test.tsx` 新增的只有 usage 用例；`tests/client/app.test.tsx` 没有任何 410 / 释放局用例。RFC §8.7 的「已修」与代码不符。

修复建议：`ApiClient.game` 对非 2xx 抛错（或返回 `{ ok: false, status, error }` 让调用方显式分支）；`App.refresh` 在 410 / 缺失 `view` 时直接走 `client.replay(gameId)`，无快照时显示错误而不是永久「正在载入对局…」；补一条真实 `ApiClient`（410 + 200 快照）或等价 fake client 的 App 用例，断言不抛 `TypeError` 且出现「复盘」。

#### 2.5 C-160（R1 C-162）：服务端 parse 已加，但无回归锁

`src/server/routes/games.ts:350-351` 已改为 `ReplaySnapshotSchema.parse(record.snapshot)`，API-1 的服务端行为闭合。但：

- M2-G 去掉 `parse`、直接 `reply.send(record.snapshot)` 后，`tests/server/replay.test.ts` **13/13 仍绿**；没有「快照缺字段 → 契约错误」的用例。
- `tests/client/api.test.ts` 仍只有 truth 的三条，没有 replay / perspective 的合法 / 缺字段用例；`GameRecord.snapshot` 仍是 `unknown`（`game-registry.ts:36`）。

归 C-177（非阻塞）；R1 C-162 的「服务端 parse」部分闭合。

#### 2.6 C-161（R1 C-158）：复盘页用量已显示

`src/client/pages/ReplayPage.tsx:76-81` 显示「模型调用 N 次，输入 X / 输出 Y tokens」，`usage` 仍按可选处理；`tests/client/replay.test.tsx:132-143` 断言 `模型调用 12 次` 与 `输入 3400`。主路径闭合。

未显示 `cachedTokens`，用例也没有断言 output / cached；F20 AC-1 要求缓存命中 token，F31 AC-7 的「token 汇总」建议补齐。归 C-178（非阻塞）。

### 3. Round 1 其余阻塞项（不在本轮六项里，但仍 Open）

#### 3.1 R1 C-160（AC-10）：筛选仍只锁条数，不锁内容

`tests/client/replay.test.tsx:73-81` 仍只比较 `getAllByRole('listitem').length`，没有比较条目文本 / seq。M2-C 在选中席位时给每条时间线文本追加 `·MUTATION`（条数不变）后，`tests/client/replay.test.tsx` **8/8 仍绿**。AC-10 要求「条目数量**与内容**一致」，内容没有被锁。**仍 Open（阻塞）**。

修复：记录 `Timeline` 每条 `data-replay-seq` + `textContent` 数组，筛选前后 deep equal；或断言具体条目文本。

#### 3.2 R1 C-163（AC-2 / AC-5 / AC-6）：身份 / 人格 / 结果断言仍是同义反复

`tests/server/replay.test.ts:53-60` 仍是 `roleLabel.length > 0`、persona 二选一、`result ∈ {wolf,good}`、condition 非空。M2-D 把每席 `roleLabel` 改成「狼人」、`personaLabel` 改成 `MUTATION`、`result` 固定 `good`、`winCondition` 固定 `MUTATION` 后，**13/13 仍绿**。

RFC §8.7 写「由真实对局快照 + 路由级用例覆盖」，但新增的路由级 3×3 用例只比较 `project()` 的投影视图，没有读 `snapshot.seats` / `result` / `winCondition`；这条声明不成立。**仍 Open（阻塞）**。

修复：把快照 `seats` 与 `GAME_STARTED` / `replay(GAME_STARTED + …)` 的实际 roles / persona 逐席比较；`result` / `winCondition` 与 `GAME_ENDED.payload` 精确相等并定位其 `seq`；补 wolf / good 双分支。

### 4. 全部验收标准

| AC | 本轮结论 | 证据 / 缺口 |
|---|---|---|
| 1 | PASS（沿用 R1） | 时间线升序、每条能在事件流里找到；本轮未重查双向口径（C-170 非阻塞，未重查） |
| 2 | **FAIL（测试）** | `replay.test.ts:53-60` 仍只断言非空；M2-D 全绿。C-163 |
| 3 | **FAIL（行为）** | 生产已产出 `AI_THOUGHT`，但终局快照漏最后一条（40 条事件 / 39 条快照）；「完成局」用例仍是 0=0。C-176 |
| 4 | PASS（沿用 R1） | `buildThoughts` 只读 `payload.reason`；`reasoningContent` 不进快照 |
| 5 | **FAIL（测试）** | persona 只做二选一；M2-D 全绿。C-163 |
| 6 | **FAIL（测试）** | result 只做集合、condition 只做非空；M2-D 全绿。C-163 |
| 7 | PASS（沿用 R1） | `degraded` 与 `DEGRADED` 一一对应 |
| 8 | PASS（行为）/ **FAIL（回归锁）** | `usageMetaLog` 计入全部 attempt；但 M2-A 删生产接线仍 13/13 绿。C-157 |
| 9 | PASS（路由级） | 3 席 × 3 `seq` 真实 `app.inject` 与截断投影深度相等；M2-E 打红。C-159 闭合 |
| 10 | **FAIL（测试）** | 只锁条数；M2-C 改文本仍 8/8 绿。C-160 |
| 11 | PASS（路由级） | 3 席 × 3 `seq`；M2-E 打红。C-159 闭合 |
| 12 | PASS（沿用 R1） | 新 `gameId` + `/play`；C-168 未重查 |
| 13 | **FAIL（产品路径）** | 端点 200 / 410 已锁；App 410 仍抛 `TypeError`，到不了复盘。C-171 |
| 14 | PASS（360）/ 1024 沿用 R1 | e2e 360px 无横滚；C-169 未重查 |

### 5. 工程维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

- C-176 使 AC-3 的「每条推理」不完整；C-171 使 AC-13 的产品路径不成立。
- RFC §8.7 的两条声明与代码不符：「`ApiClient.game` 对非 2xx 抛错」没有实现（`api.ts:40-46` 无 `ok` 检查）；「AC-2 / AC-5 / AC-6 由真实对局快照 + 路由级用例覆盖」也不成立（路由级用例只比较投影）。这是错误的实现记录，不只是文档漂移。
- §8.5 仍写 737 tests，实际 743；TEST-STRATEGY 的 RFC-014 小节仍全 `proposed`，计划中的 `tests/server/replay-perspective.test.ts` 不存在。这些属于 R1 C-167（非阻塞、按指示未重查），但 RFC §8.7 的新声明需要一并修正。

#### 5.2 RULES COMPLIANCE — **FAIL（TEST-1 / DOC-1）**

| 规则 | 判定 | 证据 |
|---|---|---|
| **AI-5** | **PASS** | `buildThoughts` 只读 `payload.reason`（`snapshot.ts:170-190`）；`reasoningContent` 不进快照；新 `AI_THOUGHT` payload 只有 `reason` / `claim` |
| **API-1** | **PASS（代码）/ 测试缺口** | 服务端 `ReplaySnapshotSchema.parse`（`routes/games.ts:351`）；客户端 `safeParse`（`api.ts:65-72`）；但两端都没有 replay 正负用例，服务端 parse 无回归锁 → C-177 |
| **TEST-1** | **FAIL** | C-157 / C-160 / C-163 的验收证据不成立；C-176 无完成局锁 |
| **TEST-6** | **PASS（主路径）** | e2e 10/10；但 `HOWL_FAKE_AI=1` 下脚本 AI 不产 `thought`，e2e 的「推理」标题只断言身份与时间线，不能替代 C-176 |
| **DOC-1** | **FAIL** | §8.7 的 C-159 / AC-2/5/6 声明与代码不符；§8.5 计数陈旧 |
| **SEC-5 / SEC-6** | **PASS** | 视角仍按 `observer: seat` 投影；释放后视角 410；`AI_THOUGHT.visibleTo = self:<seat>` |
| **DATA-6 / ARCH-3** | **PASS** | 快照为值拷贝；事件流仍是唯一权威 |
| **STYLE-6** | **PASS** | 本轮新增行数不大；无超 400 行文件 |

#### 5.3 SECURITY — **PASS（有边界说明）**

- 会话归属、视角投影、释放后 410 都保持；未发现新的越权读取。
- `AI_THOUGHT` 仍是 `self:<seat>`，第三人称投影看不到；快照只在终局后提供全部身份与推理（SEC-6 的时间边界）。
- 释放后视角端点从 500 改为 410，不再把内部错误文案暴露在 HTTP 上；这是本轮的改进。
- App 410 崩溃是可用性缺陷，不是数据泄漏。

#### 5.4 PERFORMANCE — **N/A（本轮无新增热点）**

本轮没有新增计算热点；`ReplaySnapshotSchema.parse` 每次 `GET /replay` 对快照做一次线性校验，规模很小。R1 C-172（终局后每秒轮询、视角重复请求）与 C-165（usage Map 不清理）按指示未重查，仍为非阻塞。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `toThought()` 仍没有生产调用者；`runGame` 手工复制了同一套事件构造并 `as EventEnvelope`（`orchestrator.ts:226-240`）。两条构造路径未来可能漂移；`decisionSeq` 用 `result.version`（动作后），而 `toThought` 的注释约定是「决策产生前的 `state.seq`」（`src/server/llm/thought.ts:11-14`）。归 C-179（非阻塞）。
- `usageMetaLog as never` 用强制类型转换掩盖了 `CallMetaLog` 与 sink 的结构差异；`decide` 只用到 `record`，所以现在能跑，但类型契约没有表达出来。归 C-179。
- 测试债：`replay.test.ts:238-242` 的 `deciding` 是声明后 `void` 的死函数；`replay.test.ts:189-221` 的 `void app` 是死用例；`replay.test.ts:148-152` 与 `:372-380` 的空真分支仍在。归 C-180（非阻塞）。
- 没有任何测试经过 `createLlmAgent`：M2-H 把 `reason: outcome.decision.reason` 改成 `'MUTATION'` 后，全套 **743/743 仍绿**。生产推理的来源（AI-5 的核心）没有回归锁。归 C-180（非阻塞）。

### 6. 发现汇总

#### 阻塞

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-157** | AC-8、NFR-13 | 用量接线正确，但新用例只测 sink；M2-A 删掉 `agent.ts` 的 `metaLog` 注入仍 13/13 绿。 | 走 `decide` + 假 fetch 的「失败 + 成功 = 2 次」用例，并断言快照 usage；删接线应打红。 |
| **C-160** | AC-10、TEST-1 | 筛选只锁时间线条数；M2-C 改文本仍 8/8 绿。 | 记录 `data-replay-seq` + 文本，筛选前后 deep equal。 |
| **C-163** | AC-2 / AC-5 / AC-6、TEST-1 | 身份 / 人格 / 结果断言同义反复；M2-D 全绿；§8.7 的「已覆盖」不成立。 | 与 `GAME_STARTED` / state / `GAME_ENDED.payload` 逐项比较，补双分支。 |
| **C-171** | AC-13 产品路径、F33 AC-4、FE-AS-2 | `ApiClient.game` 对 410 不抛错，App 的 catch 是死代码；真实路径仍在 `App.tsx:61` 抛 `TypeError`，到不了复盘。 | `game()` 对非 2xx 抛错；`App` 退到 `client.replay()`；补 410 → 复盘页的 client 用例。 |
| **C-176** | AC-3、F31 AC-3、PRD FR-12 | 终局时 `snapshot` 先于最后一条 `AI_THOUGHT` 生成；真实完成局 40 条事件推理、快照只有 39 条，最后一条在 `GAME_ENDED` 之后。 | 追加 thought 后若已 `FINISHED` 重新生成快照（或让 `appendEvents` 维护快照）；补完成局「事件流条数 = 快照条数且含最后一条」用例。 |

#### 非阻塞

| # | 规则 / AC | 发现 | 建议 |
|---|---|---|---|
| **C-177** | API-1 | 服务端 parse 已加但无回归锁（M2-G 绿）；客户端 `api.test.ts` 没有 replay / perspective 正负用例；`snapshot` 仍 `unknown`。 | 补非法快照 → 契约错误的 server 用例；补 client 合法 / 缺字段 / 非 2xx 三条用例；收窄 `GameRecord.snapshot` 类型。 |
| **C-178** | F31 AC-7、F20 AC-1 | 复盘页显示 calls / input / output，但未显示 cached；用例未断言 output / cached。 | 在用量行补 cached，并补齐三类 token 断言。 |
| **C-179** | DOC-1 / 维护性 | `toThought` 无生产调用者，`runGame` 手工构造并 cast；`decisionSeq` 是动作后版本，与 helper 的「决策前」注释不一致；`usageMetaLog as never` 隐藏类型契约。 | 让 `runGame` 复用 `toThought`（或明确删除它）；修正 `decisionSeq` 口径；把 `metaLog` 的类型收窄为 `{ record(meta: CallMeta): void }`。 |
| **C-180** | TEST-1 / 测试债 | 没有 `createLlmAgent` 用例，M2-H（reason 改成 `'MUTATION'`）全套 743 绿；`deciding` 死函数、`void app` 死用例、两处 0=0 空真仍在。 | 补假 fetch 的 `createLlmAgent` → `reason` / `claim` → `AI_THOUGHT` 用例；删死代码；完成局用例加 `fromEvents > 0` 与最后一条比对。 |

### 7. 探针记录

所有探针均使用文件备份恢复；没有使用 `git checkout` / `git restore`。

| 探针 | 变更 / 内容 | 结果 |
|---|---|---|
| **P-R2-1** | 真实 `runGame` 完成局（seed `20_261_117`，脚本 AI 外层补 `thought`） | 108 事件 / 事件流 40 条 `AI_THOUGHT` / 快照 39 条；最后一条 seq 108 在 `GAME_ENDED`（107）之后，`snapshotHasLastThought=false` → **C-176** |
| **P-R2-2** | 真实 `ApiClient` + 410 假 `fetch` | 返回 `{error:'GAME_EXPIRED'}`，`hasView=false`，不抛错 → App catch 不可达 |
| **P-R2-3** | `App` + 等价 fake client（410 错误对象、`replay` 返回快照） | 未捕获 `TypeError: Cannot read properties of undefined (reading 'phase')` @ `App.tsx:61`；无复盘页 → **C-171** |
| **M2-A** | `agent.ts` 删 `metaLog: usageMetaLog as never` | `tests/server/replay.test.ts` **13/13 passed** → C-157 接线无锁 |
| **M2-B** | `orchestrator.ts` 删 `AI_THOUGHT` 追加块 | **1 failed / 12 passed**（自定义 decide 用例红）；「完成局」用例仍绿（0=0） |
| **M2-C** | `ReplayPage.tsx` 选中席位时给时间线文本追加 `·MUTATION` | `tests/client/replay.test.tsx` **8/8 passed** → AC-10 仍只锁条数 |
| **M2-D** | `snapshot.ts` 每席 `roleLabel='狼人'`、`personaLabel='MUTATION'`、result 固定 `good`、condition 固定 `MUTATION` | `tests/server/replay.test.ts` **13/13 passed** → AC-2/5/6 断言无牙 |
| **M2-E** | `routes/games.ts` 视角路由忽略 `seq` + 用 `record.playerSeat` 作 observer | **1 failed / 12 passed** → 新 3×3 路由测试有牙 |
| **M2-F** | `GET /replay` 在事件流为空时返回 410 | **1 failed / 12 passed** → 释放后 200 有锁 |
| **M2-G** | `GET /replay` 去掉 `ReplaySnapshotSchema.parse` | **13/13 passed** → 服务端 parse 无回归锁（C-177） |
| **M2-H** | `agent.ts` 的 `thought.reason` 固定为 `'MUTATION'` | 全套 **87 files / 743 tests passed** → `createLlmAgent` 的 reason 映射无锁（C-180） |

### 8. 结论

**Overall Risk Level: High**

**Summary**：这轮修复有真实进展——生产路径现在会产出 `AI_THOUGHT`、视角端点有真实 3 席 × 3 `seq` 路由锁、释放后的 `GET /replay` 与视角端点都锁住了、复盘页显示了用量。但最关键的「释放局仍能看复盘」在产品路径上仍然不成立：`ApiClient.game` 不抛错，App 的 catch 是死代码，410 时仍在 `App.tsx:61` 抛 `TypeError`。同时，最后一条 AI 推理在终局快照生成之后才写入，导致每局复盘少一条推理；C-157 / C-160 / C-163 的验收证据仍是 Round 1 指出的空真 / 同义反复。

**Blocking Issues（必须修复后才能合并）**

1. **C-171**：释放局 410 仍让 App 崩溃，用户到不了复盘页（AC-13 / F33 AC-4）。
2. **C-176**：终局快照漏最后一条 `AI_THOUGHT`（AC-3 / F31 AC-3）。
3. **C-157**：用量生产接线无回归锁；删掉 `metaLog` 注入全套仍绿（AC-8 / TEST-1）。
4. **C-160（R1）**：AC-10 只锁时间线条数，不锁内容（TEST-1）。
5. **C-163（R1）**：AC-2 / AC-5 / AC-6 断言仍与实现同义反复（TEST-1）。

**Improvement Suggestions（非阻塞）**：C-177 ~ C-180。优先修 C-180 的 `createLlmAgent` 用例与 C-179 的 `toThought` 复用；C-178 的 cached token 展示可与 C-173（seed 展示，未重查）一起做进复盘页头部。

**状态**：`RFCS.md` 中 RFC-014 的 Status 置为 **`Changes requested`**。本轮已关闭的 C-158 / C-159 / C-161 / C-162 / C-166 不再重开；C-164 ~ C-170、C-172 ~ C-175 按指示未重查。
