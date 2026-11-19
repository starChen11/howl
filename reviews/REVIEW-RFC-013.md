# REVIEW · RFC-013 · Round 1

> 评审时间：2026-11-19 · 被评审提交：`14cf5d7 feat(rfc-013): 事件面板、观战与真相视图`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-013 的实现代码。
> 结论：**Changes requested**

本轮用户点名四件事：**AC-11 零副作用、AC-12 对局中拒绝真相、AC-13/14 记事板不进投影与提示词、ACL 8/9/10 的「关→开→关」是否真的断言过**，外加已批准的 A 方案（点面板条目 → 发言流高亮/定位到对应 `seq`）。先给这五项的直接回答，再展开完整 AC 审查。

| 用户点名项 | 结论 | 最短证据 |
|---|---|---|
| **A 方案 / AC-4** | **功能不成立，不只是测试弱** | 面板条目的 `seq` 全部来自 `PLAYER_DIED` / `VOTE_REVEALED` / `PHASE_CHANGED`；发言流的行 id 只来自 `SPEECH`。事件 `seq` 全局唯一，因此面板条目的 `seq` **永远不可能等于**某条发言的行 id，`highlightSeq` 永远匹配不到。临时探针：feed id `["4"]`，面板按钮对应 seq 2 / 3，逐个点击后 `highlighted=0`。测试只断言 `onJump` 收到 seq，没有断言 DOM 高亮。 |
| **AC-11 零副作用** | **未验证** | 只断言 `client.submit` 调用 0 次、`client.truth` 调用 1 次（`tests/client/spectator.test.tsx:101-103`）；没有任何「切换前后事件流深度相等」或事件快照断言。RFC §6 明文要求「切换前后事件流快照相等」，计划中的该测试不存在。 |
| **AC-12 对局中拒绝真相** | **服务端一半有牙；客户端入口一半未验证** | `canSeeTruth` 改成永远 true → `truth.test.ts` **1 failed**（`expected 200 to be 403`），所以 403 是真的。但没有测试断言「活着的玩家界面没有真相入口」；把 `App` 的 `ctx.self.alive ? null : <SpectatorBar>` 改成永远渲染 → `app.test.tsx` + `spectator.test.tsx` + `event-panel.test.tsx` **12/12 全绿**。 |
| **AC-13 / AC-14 记事板隔离** | **未验证** | `tests/client/spectator.test.tsx:107-126` 只断言写入 `localStorage`、`calls.submits === 0`，没有构造投影、没有构造一次发言、没有断言注入上下文。计划里的 `tests/client/notepad.test.tsx`（`TEST-STRATEGY.md:358`）不存在。 |
| **ACL 8/9/10「关→开→关」** | **只断言了标题，没断言内容** | 测试只检查 `heading 真相视图`：默认没有（`:92`）、开启后有（`:95`）、关闭后没有（`:99`）；开启时只检查一个假席位 `2 号：狼人`（`:96`）。变异探针：关闭时不清 `truthData`，把 `<ul>` 移到 `truth.enabled` 条件外（标题仍会消失、角色列表仍可见）→ **`spectator.test.tsx` 3/3 仍绿**；加入「关闭后 `2 号：狼人` 必须消失」的断言才变红。即：**AC-10 的内容恢复没有被现有测试锁住**。此外 AC-9 的「夜间行动结果」在实现里是空的（见 §4.2）。 |

---

## 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `14cf5d7` · 评审开始时工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building client environment...
✓ built in 112ms
vite v8.3.8 building ssr environment...
✓ built in 19ms
BUILD_EXIT=0

$ pnpm test
 Test Files  83 passed (83)
      Tests  700 passed (700)
   Duration  33.11s
FINAL_TEST_EXIT=0

$ pnpm test:e2e
Running 8 tests using 1 worker
  8 passed (5.3s)
FINAL_E2E_EXIT=0
```

`pnpm test` 的 83 个文件包含 `tests/meta/*` 的构建、五条命令与覆盖率门禁；全绿。`pnpm test:e2e` 的 8/8 里**没有一条覆盖 RFC-013**——事件面板、观战、真相、记事板都不在 Playwright 用例中，所以它不能为这 15 条 AC 提供任何证据。

本轮所有探针都从 `/tmp/howl-rfc013-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前 8 个源码文件的 SHA-256 已记录，恢复后 `sha256sum -c` 全部 `OK`：

```text
56d6e4e759d557bf5709710c2c4d9d45ef5b0dea6ce2435b7d97a7a3fb1f5273  src/client/App.tsx
79989dc0f5595ed5e435d3eebc1f49b00c53bce742a677eb15393f247b8c399d  src/client/components/EventPanel.tsx
c072e5287e23ec6b91d6f4c4c5d1f95ec92d0bdc9828980aadaa28bd68d4eb4a  src/client/components/SpeechFeed.tsx
45def05c1bbbdc0efa39317cfa60774b126d946c805a9105b5df5e59ecd4eab1  src/client/components/SpectatorBar.tsx
52f4b38af6d4de46fcf94087496ea8e64d1cef1a2520fe0146fb47fa7f4c60a5  src/client/components/Notepad.tsx
a2a50ee928fdd16ef82b9ffb34a1ddea91003e31160da3b3b12a5b2e9b1d7d69  src/server/view/truth.ts
a6f75f902ae2a69a8dec153cc2617745b38d23759b3ded34a03dfc5847121acb  src/server/routes/games.ts
584fca8e3427e426940ed66b1bcaf157e57c2ea9ca73684466c9d370035beae4  src/client/api.ts
```

临时探针测试 `tests/client/probe-rfc013.test.tsx` 已删除；探针结束后 `git status --porcelain` 为空，没有 `git commit`。本文件与 `RFCS.md` 的评审记录是唯一新增/修改。

---

## 1. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本轮按 game 的「玩家是否真的能继续玩、公开信息是否完整」和 web app 的「语义、键盘、内容隔离、真实浏览器」检查；mobile app / library / CLI / service 的检查不适用，跳过。没有可用的真机（M-6）与屏幕阅读器（M-3）证据，本轮不宣称这两项通过。

---

## 2. 用户点名的五项

### 2.1 A 方案 / AC-4：点击面板条目 → 高亮对应发言，实际永远不会发生

`buildPanelEntries()` 只把三类事件变成条目：

- `PLAYER_DIED` → `kind: 'death'`（`EventPanel.tsx:28-32`）
- `VOTE_REVEALED` → `kind: 'vote'`（`:34-42`）
- `PHASE_CHANGED → DAY_LYNCH` → `kind: 'banish'`（`:44-51`，但这条分支永远进不去，见 §4.1）

`App` 把整张发言流映射成 `SpeechLine` 时，行 id 只来自 `SPEECH` 事件：

```ts
// App.tsx:95-100
const committed = view.view.publicEvents
  .filter((event) => event.type === 'SPEECH')
  .map((event) => ({ id: event.seq, ... }));
```

`DATA-1` 保证事件 `seq` 单调且唯一，所以一个**死亡/投票/放逐事件**的 `seq` 不可能同时是某条 `SPEECH` 事件的 `seq`。面板条目全部是非发言事件，`line.id === highlightSeq`（`SpeechFeed.tsx:43`）永远为 false。

实测探针（真实 `App` + 假 client，`publicEvents` 含 `DAY_STARTED seq1`、`PLAYER_DIED seq2`、`VOTE_REVEALED seq3`、`SPEECH seq4`）：

```text
PROBE_FEED_IDS ["4"]
PROBE_PANEL_BUTTONS ["第 1 天，2 号出局，跳到发言","第 1 天，3 号投 2 号，4 号弃权，跳到发言"]
PROBE_AFTER_CLICK 第 1 天，2 号出局，跳到发言 highlighted= 0
PROBE_AFTER_CLICK 第 1 天，3 号投 2 号，4 号弃权，跳到发言 highlighted= 0
```

另外，即使 `highlight` 匹配到了，`SpeechFeed` 也**没有滚动到高亮行**：唯一 `scrollIntoView` 在 `lines.length` 变化时滚到底部（`SpeechFeed.tsx:25-34`），点击面板条目不会改变 `lines.length`。RFC §2.1 写的是「点面板条目能滚到对应发言」，用户批准的 A 方案也写「滚动/高亮到对应 seq」（RFC §8.1）。当前只有「设一个没人能匹配的 state」，连高亮都没有发生，更没有滚动。

测试为什么没抓到：`tests/client/event-panel.test.tsx:92-105` 只渲染孤立的 `EventPanel`，断言 `onJump` 收到 `[2]`。它没有渲染 `App`、没有 `SPEECH` 行、没有断言 `feed__line--highlight`、没有断言滚动。RFC §8.4 却把这条写成 PASS（`RFCs/RFC-013...:135`），不成立。

**结论：AC-4 FAIL；A 方案未交付。** 建议修法：把「面板条目的 seq」映射到发言流的时间锚点——例如取「该 seq 之后的第一条 SPEECH」或「该 seq 之前最近的一条 SPEECH」并按产品语义二选一；渲染后用 `scrollIntoView` / `focus` 到该行，并加一条 `App` 级集成测试，断言目标 `data-seq` 的行获得高亮且 `scrollIntoView` 被调用。不要只测回调。

### 2.2 AC-11：零副作用没有被验证

现有证据：

- `tests/client/spectator.test.tsx:101-103`：`calls.submits === 0`、`calls.truth === 1`。
- `tests/server/truth.test.ts:142-150`：`buildTruth(registry.stateOf(record))` 前后比较 `JSON.stringify`。

这两条都不是 AC-11 要求的「切换前后事件流深度相等」：

1. `submits === 0` 只证明没有调用「提交 action」这一条路径。任何**不经过** `client.submit` 的副作用（直接改本地 `view`、改事件数组、调用其它写接口）都不会被发现；测试也没有记录切换前的 `publicEvents.length` / 事件流长度。
2. `truth.test.ts:142-150` 是**同义反复**：它名为「改它不影响引擎状态」，但根本没有修改 `buildTruth` 的返回值；`registry.stateOf(record)` 每次都从 `record.events` 重新 replay，返回一份全新状态；`buildTruth` 即使原地改掉传入对象，下一次 `stateOf(record)` 仍然从事件流重建，前后 JSON 必然相等。它既没有读事件流长度，也没有检查 `record.events`。
3. RFC §6（`:86`）明确写了「真相视图用『切换前后事件流快照相等』断言零副作用」；`TEST-STRATEGY.md:356` 也计划了「开关前后事件流深相等」。**这两处承诺的测试都没有落地。**

实现本身看起来确实是只读的：`onToggleTruth` 只 `setTruth` / `setTruthData` / `client.truth`，`GET /truth` 只 `stateOf(record)` 后 `buildTruth`，没有写入点。但「看起来没有」不是验收证据。**结论：AC-11 未验证。**

建议：在服务端路由测试里记录 `record.events.length` 与 `JSON.stringify(state)`，开启/关闭前后各取一次并断言完全相等；同时补一条客户端「切换不增加 `publicEvents` 长度」的集成断言。两条都要能在存在真实写路径时变红。

### 2.3 AC-12：403 有牙，客户端「没有入口」没有牙

**服务端一半是好的。** `tests/server/truth.test.ts:94-117` 创建一局（玩家仍活着），直接 `GET /api/games/:id/truth`，断言 403 + `TRUTH_LOCKED`。探针把 `canSeeTruth` 改成「只要席位存在就返回 true」：

```text
FAIL  tests/server/truth.test.ts > AC-12 · 活着的玩家请求真相 → 403
AssertionError: expected 200 to be 403
```

所以「对局中拒绝真相」这条安全线**确实被服务端测试锁住了**。这是本轮少数有真实牙的安全断言。

**但 AC-12 的另一半没有验证：**「对局进行中不存在真相视图的入口」。`App.tsx:170-172` 用 `ctx.self.alive ? null : <SpectatorBar>` 实现；`tests/client/spectator.test.tsx` 只渲染**已出局**的玩家，`tests/client/app.test.tsx` 渲染活着的玩家但从不查询「打开真相视图」。探针把条件删掉、永远渲染 `SpectatorBar`：

```text
Test Files  3 passed (3)
     Tests  12 passed (12)
```

`app.test.tsx`、`spectator.test.tsx`、`event-panel.test.tsx` 全部没反应。也就是说，一个「活着也能点开真相」的回归可以全绿通过。**结论：AC-12 部分通过（服务端拒绝），前半条未验证。**

另有一个契约问题（见 §4.4）：`TRUTH_LOCKED` 不在 `src/shared/api.ts` 的 `ApiErrorCode` 联合类型里，`/truth` 也没有共享的响应 schema。

### 2.4 AC-13 / AC-14：记事板隔离没有被验证

`tests/client/spectator.test.tsx:107-126` 的实际断言只有：

```ts
expect(localStorage.getItem(notepadKey('g'))).toBe('3 号发言太急，可疑。');
expect(calls.submits).toBe(0);
// cleanup + rerender Notepad → textarea.value 仍在（AC-15）
```

它**没有**：

- 构造 `project()` 的输出并断言任何观察者的投影里不含记事板文本（AC-13）；
- 在记事板输入后构造一次真正的发言，检查 `client.draft` / `client.submit` / LLM 提示词里不含记事板文本（AC-14）；
- 检查 `src/shared/` 或服务端类型中不存在记事板字段（结构证明）。

计划中的 `tests/client/notepad.test.tsx`（`TEST-STRATEGY.md:358`，明确写「不进 AI 上下文（断言注入文本不含）」）**不存在**；RFC §8.4 的 AC-13/14 证据（`RFCs/RFC-013...:144-145`）把「只写 localStorage + `submits === 0`」当成了隔离证明，但这两条既不涉及投影也不涉及提示词。

公平地说，实现的设计方向是对的：`grep -rn "notepad" src/server src/shared` 无命中，记事板只存在于 `src/client/components/Notepad.tsx` 与浏览器 `localStorage`，服务端「根本拿不到」。这是结构上的安全优势。但**AC-13/14 要求的是被测试锁住**，当前只是「实现看起来不会泄漏」；如果未来有人把记事板接进 `syncDraft`、会话状态或投影，现有测试不会变红。**结论：AC-13/14 未验证。**

建议：
1. 服务端测试：构造 9 个观察者的 `project()`，断言序列化结果不含记事板哨兵字符串；如服务端没有记事板输入，也至少断言 `ProjectedContext` 的字段集合/序列化中不存在该哨兵。
2. 客户端测试：在记事板输入哨兵文本 → 切到发言 → 断言 `client.draft` / `client.submit` 的 body 不含哨兵；再走一次真实的 `prompt`/`inject` 组装，断言注入文本不含哨兵。

### 2.5 ACL 8/9/10：「关→开→关」只在标题层断言

`tests/client/spectator.test.tsx:85-105` 的顺序确实是：默认关（`:92` 标题为 null）→ 开（`:95` 标题出现，`:96` 一个角色）→ 关（`:99` 标题为 null）。但它只断言**标题**，没有断言**真相内容**：

- 默认关闭时没有断言 `2 号：狼人`（或任何角色文本）不在 DOM；如果初始就渲染了角色列表但没渲染标题，测试会绿。
- 关闭后没有断言角色文本消失；`waitFor` 只等标题消失。
- 开启时只断言一个假席位；fake `truth()` 只返回 2 个席位，不是 9 个；也没有断言「所有席位」。
- `aria-pressed` 的测试在 `event-panel.test.tsx:116-126` 单独渲染 `SpectatorBar`，没有在 `App` 里断言点击后的 `aria-pressed` 变化。

我做了内容泄漏探针：删掉关闭分支的 `setTruthData(null)`，并把 `<ul>` 移到 `truth.enabled` 条件之外（标题仍由 `truth.enabled` 控制，角色列表只要 `truthData` 还在就渲染）。结果：

```text
tests/client/spectator.test.tsx (3 tests)  3 passed
临时探针「关闭后 2 号：狼人 必须消失」  1 failed
AssertionError: expected <li> to be null
+ Received: <li> 2 号：狼人 </li>
```

也就是说：**「关闭后立即恢复为只有公开信息」（AC-10）没有被现有测试保护**，一个标题隐藏而内容泄漏的回归会全绿。AC-8 的「默认关闭时只含公开信息」同样只有标题级断言。

AC-9 还有更实质的问题：`buildTruth` 的 `actions` 恒为 `[]`（`truth.ts:46`），`deaths` 只从 `pendingDeaths` 取且 `cause: 'unknown'`（`:33-38`）；客户端只渲染 `roleLabel`（`App.tsx:177-183`）。所以「开启后显示所有席位的角色与夜间行动结果」只有角色，没有夜间行动结果；RFC §8.6 把这点记为「已知缺口／归 RFC-014」，但 AC-9 本身没有豁免，`FEATURES.md` F28 AC-2 也明确要求夜间行动。详见 §4.2。

**结论：ACL 8/9/10 不是「有过完整断言」；只完成了标题级开关，内容级恢复与所有席位/夜间行动都没有锁。**

---

## 3. 全量验收标准对照

| AC | 结果 | 证据 / 缺口 |
|---|---|---|
| 1 · 三类公开事件、按 seq | **FAIL** | 夜间死亡只存在于 `DAY_STARTED.diedLastNight`，面板忽略（`EventPanel.tsx:23-26`）；`banish` 分支永远进不去（`banished` 从未赋值，`:20,44-55`）；测试只期望 `death` / `vote` 两类（`event-panel.test.tsx:79`）。排序也没有显式 `sort`，测试用顺序输入，不构成排序断言。 |
| 2 · 不显示角色/夜间细节 | **PASS（弱证据）** | builder 只处理三类事件；测试断言序列化不含发言文本，但 `not.toContain('role')` 只是字符串级检查，不是字段级。实现路径本身没有角色字段。 |
| 3 · seq + 第 N 天 | **PASS** | `event-panel.test.tsx:85-90` 逐字段断言。 |
| 4 · 点击定位到发言流 | **FAIL** | 见 §2.1：seq 永不匹配、无滚动、测试只测回调。 |
| 5 · 出局后仍见后续发言与公开事件 | **未验证** | `spectator.test.tsx:73-82` 只断言「没有输入框、没有投票、观战提示」；fixture 的 `publicEvents` 只有 `DAY_STARTED`，没有 SPEECH，也没有断言 `SpeechFeed` / `EventPanel` 渲染。RFC §8.4:136 声称「仍渲染发言流与面板」不成立。 |
| 6 · 输入区不可用 + 提示 | **PASS** | `:79-81` 断言观战提示、无发言框、无投票按钮。 |
| 7 · 观战态推进到 FINISHED | **未验证** | `tests/server/game-loop.test.ts` 只测服务端整局循环，没有渲染 `App` 的观战态；没有任何「玩家出局后仍推进到 FINISHED」的组件/集成用例。RFC §8.4:138 把它算作 PASS，不成立。 |
| 8 · 默认关闭 + 只含公开信息 | **PARTIAL** | 默认状态纯函数 `event-panel.test.tsx:109-114` 有断言；集成只断言标题不在（`spectator.test.tsx:92`），没有断言角色内容不在。 |
| 9 · 所有席位角色 + 夜间行动 | **FAIL** | 只有角色，`actions: []`；测试只检查一个假席位（`spectator.test.tsx:96`）；服务端测试只检查 9 个 `roleLabel`（`truth.test.ts:136-139`），没有夜间行动。 |
| 10 · 关闭后立即恢复 | **PARTIAL / 未被锁** | 只断言标题消失（`spectator.test.tsx:99`）；内容泄漏变异全绿（§2.5）。 |
| 11 · 零事件（深度相等） | **未验证** | 只有 `submits === 0`（`:102`）；没有事件流深度/快照断言；`truth.test.ts:142-150` 是同义反复。 |
| 12 · 对局中无入口 + 请求被拒 | **PARTIAL** | 服务端 403 有牙（探针变红）；客户端无入口无测试（探针全绿）。 |
| 13 · 其他席位投影不含记事板 | **未验证** | 没有投影断言；计划中的 notepad 测试缺失。 |
| 14 · 提示词不含记事板 | **未验证** | 没有构造发言/读取注入文本的测试；`submits === 0` 不是提示词断言。 |
| 15 · 刷新后仍在 | **PASS** | `spectator.test.tsx:117-125` 用 `cleanup` + 重新挂载模拟刷新，`localStorage` 读取成立。严格说不是真页面刷新，但等价覆盖；可接受。 |

**总览：只有 AC-2 / 3 / 6 / 15 是完整通过；AC-1 / 4 / 9 是功能失败；AC-8 / 10 / 12 是部分通过；AC-5 / 7 / 11 / 13 / 14 没有真正的验收证据。**

---

## 4. 其他发现

### 4.1 AC-1：夜间死亡与放逐结果（阻塞）

`EventPanel.tsx:23-26` 遇到 `DAY_STARTED` 只更新 `day`，完全忽略 `payload.diedLastNight`。而夜间死亡按 RFC-003 D-3 是 `visibleTo: 'server'`（`src/engine/phases/night.ts:75-80`），公开渠道只有 `DAY_STARTED.diedLastNight`。因此**每个夜晚的死亡都不会出现在面板里**；面板只在白天放逐（公开 `PLAYER_DIED`）或投票时才有条目。

实测（真实事件形状，`DAY_STARTED.diedLastNight:[2]`，没有公开 `PLAYER_DIED`）：

```text
PROBE_NIGHT_DEATH_ENTRIES []
```

`banish` 分支同样不可能触发：`let banished = null`（`:20`）之后没有任何赋值，只有 `banished = null`（`:48,54`）。`PHASE_CHANGED` 的 payload 只有 `{from,to}`（`src/shared/schemas.ts:189-192`），没有放逐席位；D-5 假设「放逐结果通过相位表达」在现有 payload 下无法得到「谁被放逐」。

实测：

```text
PROBE_BANISH_ENTRIES [{"seq":3,"day":1,"kind":"vote","text":"3 号投 2 号，4 号弃权"}]
```

AC-1 要求三类条目，当前只有 `death`（而且只是白天放逐的死亡）和 `vote`。修法：从 `DAY_STARTED.diedLastNight` 生成夜间死亡条目（同一条事件的多个死者要避免 `key` 冲突，`EventPanel.tsx:73` 的 `${seq}-${kind}` 不够）；放逐结果要么从 `VOTE_REVEALED` 的唯一最高票推导（并区分平票/弃权），要么让引擎产出带席位的放逐事件；不要留不可达分支。测试要覆盖真实 `DAY_STARTED` 形状和一次真实放逐，而不是手造公开 `PLAYER_DIED`。

### 4.2 AC-9：夜间行动结果未实现（阻塞）

`TruthSeat.actions` 的类型注释说「该席位这一局的夜间/白天动作摘要」（`truth.ts:16-17`），但 `buildTruth` 总是返回 `actions: []`（`:46`）。`TruthView.deaths` 来自 `state.pendingDeaths`（`:33-38`），而 `pendingDeaths` 会在下一个 `DAY_STARTED` 被清空（`apply.ts:75-80`），所以玩家在天亮后打开真相看不到死亡列表；`cause` 也恒为 `'unknown'`。客户端只显示 `roleLabel`（`App.tsx:177-183`），即使服务器将来填了 `actions`/`deaths` 也不会渲染。

RFC §8.6 把「真相里的夜间行动结果」记为「当前只给角色……归 RFC-014」。这是**已记录的已知缺口**，但不是用户批准的偏离，而且 RFC-014 是复盘页，不是局内真相视图；AC-9 与 F28 AC-2 仍然成立。要么在本 RFC 补上「所有席位的角色 + 夜间行动结果」，要么由用户明确批准降级并同步修改 AC/FEATURES/测试计划（`DOC-1` / `/manage-changes`）。当前 Implementation Notes 直接写 AC-9 PASS（`:140`），与 `:161` 的已知缺口自相矛盾。

### 4.3 AC-5 / AC-7：观战内容与推进没有测试（阻塞，测试）

`spectator.test.tsx` 的观战用例只覆盖「没有输入、没有投票、有提示」。它没有把一条 `SPEECH` 放进 `publicEvents`，没有断言 `SpeechFeed` 仍显示后续 AI 发言，没有断言 `EventPanel` 仍显示公开事件，也没有把对局推进到 `FINISHED`。RFC §8.4:136/138 声称的「仍渲染发言流与面板」「GameLoop 推进到 FINISHED」都不是这条测试的证据；`game-loop.test.ts` 是服务端循环测试，不经过 `App` 的观战分支。需要一条 `App` 级用例：出局 fixture 含出局后的 `SPEECH`/`VOTE_REVEALED`，断言渲染；再用真实 `runGame` 或可控 fixture 把状态推到 `FINISHED`，断言观战态仍可渲染。TEST-1 要求每条 AC 有测试，当前不满足。

### 4.4 API-1 / 错误码：`/truth` 是「两头各写一份」的新接口（阻塞，规则）

`RULES API-1`：客户端与服务端共享的请求/响应类型必须定义在 `src/shared/` 并由 Zod 校验，不得两头各写一份。当前：

- 服务端的 `TruthSeat` / `TruthView` 在 `src/server/view/truth.ts:11-24`；
- 客户端在 `src/client/api.ts:62-71` 自己写了一份更窄的 inline 返回类型；
- `GET /truth` 没有共享响应 schema / Zod 校验；
- 服务端 403 返回 `error: 'TRUTH_LOCKED'`（`routes/games.ts:139-142`），但 `src/shared/api.ts:56-64` 的 `ApiErrorCode` 不包含它。

这会出现字段漂移：服务端返回 `deaths` / `actions`，客户端类型却只认识 `seats`；以后改字段时两边不会同时报错。修法：把 `TruthView`、`TruthSeat` 及响应 schema 放进 `src/shared/`，用 `z.infer` 推导两端类型；把 `TRUTH_LOCKED` 加进 `ApiErrorCode`（或统一错误码类型）；路由用 schema 校验响应。

### 4.5 e2e：本提交把投票用例改弱了（阻塞，测试回归）

本提交把 `tests/e2e/game.spec.ts:195-196` 从「投票按钮消失」改成「公开事件面板出现任意 `号投 N 号`/`号弃权`」。这条断言可以被 **AI 的票**满足，与玩家按 Enter 是否真的提交无关。探针把 `App` 的 `vote()` 改成 no-op（不调用 `client.submit`），定向 e2e：

```text
Running 1 test using 1 worker
  ✓  1 tests/e2e/game.spec.ts:172:3 › 键盘：Tab 能到投票按钮，Enter 能投票 (502ms)
  1 passed (3.2s)
```

即「Enter 能投票」完全不验证玩家投票。建议断言玩家席位的 `VOTE_CAST`（通过事件/网络或页面上的可区分状态），或至少断言该按钮在玩家投票后进入 disabled/已投状态；仅看「面板出现票型」不够。

### 4.6 文档 / 测试计划漂移（非阻塞）

- RFC §8.4（`RFCs/RFC-013...:132-145`）把 AC-1 / 4 / 5 / 7 / 9 / 10 / 11 / 13 / 14 标成 PASS，但实际证据在 §2–§4 里明确不成立；应按真实结果重写，不能在 Implementation Notes 里把「计划」写成「已验证」（`DOC-1`）。
- `TEST-STRATEGY.md:353-358` 的 RFC-013 六行仍全部 `proposed`，`tests/server/truth-guard.test.ts` 实际叫 `tests/server/truth.test.ts`，`tests/client/notepad.test.tsx` 不存在；应回填 `Exists?`、实际文件名，并记录等价覆盖或补测。
- `README.md:11` 的 RFC 计数仍是「11 Reviewed、1 Changes requested、4 Not started」，与当前「12 Reviewed、RFC-013 Changes requested、3 Not started」不符；`README.md:33-38` 的「RFC-001~012 全部 Reviewed；剩余 013…」也没有 013 已实现的状态。这是非阻塞文档项。
- `EventPanel` 的注释说「只显示三类」，实际只有两类；`truth.ts` 的 `actions` 注释与恒空实现矛盾。注释不能当验收证据。

### 4.7 排序 / 阶段标记（非阻塞）

`buildPanelEntries` 直接按 `ctx.publicEvents` 顺序追加，没有 `sort((a,b)=>a.seq-b.seq)`。`project()` 目前按事件流顺序输出，所以正常路径是升序；但 AC-1 的「按 seq 顺序」没有独立测试，测试也只喂顺序输入。RFC §4 要求「第 N 天 + 阶段」，条目只显示「第 N 天」，没有阶段标记（AC-3 只要求 seq + 第 N 天，故非阻塞）。

---

## 5. 审查维度

| 维度 | 结论 | 说明 |
|---|---|---|
| **1. RFC ADHERENCE** | **NEEDS WORK** | AC-1 / 4 / 9 功能失败；AC-5 / 7 / 11 / 13 / 14 未验证；AC-8 / 10 / 12 部分。A 方案（点击高亮）实际不可达。 |
| **2. RULES COMPLIANCE** | **NEEDS WORK** | API-1（`/truth` 响应两头各写、无 Zod、`TRUTH_LOCKED` 不在错误码）；DOC-1（§8.4 把未验证写成 PASS）；TEST-1（多条 AC 无对应测试）。ARCH/SEC-1/SEC-5 未发现新增违规；`GET /truth` 只在 SEC-6 边界内返回。 |
| **3. SECURITY** | **PASS（服务端）/ NEEDS WORK（证据）** | 服务端「活着 → 403」经变异确认有牙；`/truth` 只在 `record.playerSeat` 已出局时返回，未见越权/投影泄漏。客户端「活着不显示入口」没有测试；记事板没有投影/提示词隔离测试。属于证据缺口，不是已观察到的泄漏。 |
| **4. PERFORMANCE** | **PASS / N/A** | 真相只在开关时请求一次；`buildPanelEntries` 线性扫描；没有新的 N+1 或无限请求。`App` 的 1s 轮询是 RFC-012 遗留，不在本 RFC 新增范围内。 |
| **5. MAINTAINABILITY** | **NEEDS WORK** | `banish` 不可达分支；`actions` 恒空；`resetTruth` 未被使用；`EventPanel`/`truth.ts` 注释与行为相反；e2e 投票断言被改弱；测试计划/README 漂移。 |

**Overall Risk Level：High。** 这是一个「看似全绿、实际核心用户可见功能不可用」的实现：事件面板缺夜间死亡/放逐，点击高亮永远不生效，真相视图缺夜间行动结果，三条安全线里只有服务端 403 有真实回归锁。门禁全绿不能降低风险，因为测试本身把计划中的关键断言漏掉了。

---

## 6. 阻塞问题（合并前必须修复）

1. **C-134（AC-1）**：夜间死亡（`DAY_STARTED.diedLastNight`）未进面板；`banish` 分支不可达；测试只期望 `death`/`vote` 两类。需补真实事件形状的夜间死亡与放逐条目，并修测试。
2. **C-135（AC-4 / A 方案）**：面板条目 seq 与发言行 id 永不相等，点击不可能高亮；也没有滚动。需定义「面板 seq → 发言锚点」映射、真正滚动/高亮，并加 `App` 级集成测试。
3. **C-136（AC-9）**：真相只有角色，`actions` 恒空、`deaths` 不可用；夜间行动结果未实现，且 Implementation Notes 同时写 PASS 和已知缺口。需实现或由用户正式批准范围变更。
4. **C-137（AC-8/9/10 测试）**：ACL 只在标题层断言；关闭后内容泄漏的变异 3/3 全绿。需断言默认/开启/关闭三个阶段的**内容**（角色列表、所有席位、关闭后角色文本消失），并让 AC-9 覆盖 9 席。
5. **C-138（AC-11）**：没有事件流深度/快照断言，只有 `submits===0`；`truth.test.ts` 的只读用例是同义反复。需补服务端事件流深度相等测试与客户端集成断言。
6. **C-139（AC-12）**：服务端 403 有牙，但客户端「活着无入口」没有测试；永远渲染 `SpectatorBar` 的变异 12/12 全绿。需在 `app.test.tsx` 断言活着时没有真相按钮/入口。
7. **C-140（AC-13/14）**：没有投影/提示词隔离测试；计划中的 `tests/client/notepad.test.tsx` 不存在。需构造 9 个 observer 的投影与一次真实发言注入，断言哨兵文本不出现。
8. **C-141（AC-5/7）**：观战测试没有断言后续发言/公开事件，也没有推进到 `FINISHED`；RFC §8.4 的 PASS 不成立。需补 `App` 级观战内容与终局测试。
9. **C-142（API-1）**：`/truth` 响应类型两端各写一份、无共享 schema/Zod；`TRUTH_LOCKED` 不在 `ApiErrorCode`。需收进 `src/shared/` 并统一错误码。
10. **C-143（TEST-5 / e2e 回归）**：本提交把投票 e2e 改成「面板出现任意票型」，no-op `vote()` 仍 1 passed。需断言玩家席位的 `VOTE_CAST` 或等价的可区分状态。

---

## 7. 非阻塞建议

1. **C-144（排序/阶段）**：`buildPanelEntries` 显式按 `seq` 排序；条目补 RFC §4 的「第 N 天 + 阶段」标记；测试喂乱序事件，确保排序断言有牙。
2. **C-145（测试计划/文档）**：回填 `TEST-STRATEGY.md` 的 RFC-013 `Exists?` 与实际文件名；修正 RFC §8.4 的 PASS 表；同步 `README.md:11,33-38`；删除 `resetTruth` 或接进真实重置路径；修正 `EventPanel`/`truth.ts` 的过时注释。
3. **C-146（`buildTruth` 数据）**：如果保留 `deaths` / `actions` 字段，至少让它们来自可重建的事件（而不是会被 `DAY_STARTED` 清空的 `pendingDeaths`），并让客户端渲染；否则先删字段，避免类型承诺与实际返回不符。
4. **C-147（观战真相刷新）**：真相数据只在开关时拉一次；玩家在观战期间死亡人数/存活状态会变化。若真相视图要显示存活状态，应在投影轮询时刷新或明确「快照」语义。当前不阻塞 AC，但会影响后续 RFC-014 的一致性。

---

## 8. 已用探针与恢复记录

| 探针 | 改动 | 结果 | 结论 |
|---|---|---|---|
| **P-13-1** | 临时 `tests/client/probe-rfc013.test.tsx`：真实 `App` + `publicEvents` 含 DAY_STARTED/PLAYER_DIED/VOTE_REVEALED/SPEECH | feed ids `["4"]`；点击 seq 2/3 后 `highlighted=0` | AC-4 功能不成立 |
| **P-13-2** | 同上，`buildPanelEntries` 只给 `DAY_STARTED{diedLastNight:[2]}` | 条目 `[]` | 夜间死亡缺失 |
| **P-13-3** | 同上，`VOTE_REVEALED + PHASE_CHANGED(DAY_LYNCH)` | 只有 `vote` 条目，没有 `banish` | 放逐结果缺失 |
| **M-13-1** | `canSeeTruth` 改成 `return player !== undefined` | `truth.test.ts` **1 failed**（200 ≠ 403） | AC-12 服务端有牙 |
| **M-13-2** | 删 `ctx.self.alive ? null : ...`（永远渲染 SpectatorBar） | app + spectator + event-panel **12/12 绿** | AC-12 客户端入口无锁 |
| **M-13-3** | 关闭时不清 `truthData`，角色 `<ul>` 移到 `truth.enabled` 外 | `spectator.test.tsx` **3/3 绿**；临时断言「角色文本关闭后消失」**1 failed** | AC-10 内容未锁 |
| **M-13-4** | `vote()` 改成 no-op | e2e `-g "Enter 能投票"` **1 passed** | e2e 投票断言被改弱 |

恢复：上述源码改动全部从 `/tmp/howl-rfc013-probes/backup/` 文件备份复制回，`sha256sum -c` 八个文件全部 `OK`；临时探针测试删除；没有 `git checkout`、`git restore` 或 `git commit`。

---

## 9. 结论

**Changes requested。** RFC-013 的门禁、页面骨架和「服务端拒绝活人看真相」这条安全线是有价值的；但用户点名的三件事里，只有 AC-12 的服务端半边被真实验证，AC-11 与 AC-13/14 没有验收证据，ACL 8/9/10 只测了标题；已批准的 A 方案在真实事件序列下根本无法触发高亮。事件面板还漏掉夜间死亡与放逐结果，真相视图缺夜间行动结果。建议先修 C-134 ~ C-143，再重新走 Round 2；在修完之前不要把 RFC-013 标为 Reviewed。

## Round 2 -- 2026-11-19

> 被评审提交：`13400d2 fix(rfc-013): 面板锚点、真相行动与隔离用例（Round 1）`
> 评审方式：全新上下文的 subagent，只读仓库文件 + 实跑 + 文件备份变异探针；本会话没有写过 RFC-013 的实现代码。
> 环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `13400d2` · 评审开始时工作树 clean。
> 结论：**Changes requested**。Round 1 的 10 个阻塞项中 **C-137 / C-139 / C-143 已关闭**；其余 7 项仍未闭合，其中 **AC-9 仍是功能失败**（不是测试弱）。

### 0. 用户点名的七项：直接回答

| 用户点名项 | 结论 | 最短证据 |
|---|---|---|
| **AC-4 面板锚点** | **功能已可用，但验收仍无测试** | 探针：真实 `App` 点击 `9 号出局` 后 `.feed__line--highlight[data-seq="2"]` 命中，`scrollIntoView` 收到 `data-seq=2`。但把 `App.jumpTo` 改成 no-op 后，官方 `event-panel + spectator + app` **14/14 全绿**；新增的 `event-panel.test.tsx:93-107` 只渲染孤立 `EventPanel` 并断言 `onJump` 回调，没有渲染 `App`、没有断言 DOM 高亮、没有断言滚动。 |
| **AC-1 夜间死亡/放逐** | **代码已补，测试只覆盖了一半** | `DAY_STARTED.diedLastNight` 生成死亡条目、`PLAYER_DIED(cause:'lynch'/'shoot')` 生成放逐/枪杀条目，探针均成立。但官方测试只期望 `['death','vote']`（`event-panel.test.tsx:80`），没有 lynch/shoot 夹具；把 lynch 分支删掉后 `event-panel.test.tsx` **6/6 仍绿**。另外，同一次 `DAY_STARTED` 公布两名死者时 `key={`${seq}-${kind}`}` 冲突（`EventPanel.tsx:104`），React 实测告警 `Encountered two children with the same key ... 1-death`。 |
| **AC-9 夜间行动结果** | **仍失败，且比 Round 1 更清楚** | `buildTruth` 仍拿不到刀人/查验/用药的动作者：`WOLF_KILL_CHOSEN` / `SEER_CHECKED` / `WITCH_POTION_USED` 的 payload **没有 `seat`**（`schemas.ts:167-177`），而 `actionsOf` 用 `payload['seat']` 过滤（`truth.ts:25`）。真实对局探针：场上确有 `WOLF_KILL_CHOSEN{target:3}` 与 `SEER_CHECKED{target:1,result:'not-wolf'}`，但九个席位的 `actions` **全部为 `[]`**。客户端 `App.tsx:180-191` 也只渲染 `roleLabel`，从不渲染 `actions` / `deaths`。 |
| **AC-12 活人没有入口** | **已关闭** | 新增 `spectator.test.tsx:75-86`。变异：把 `ctx.self.alive ? null : <SpectatorBar>` 改成永远渲染 → `spectator.test.tsx` **1 failed**（`expected <p class="spectator__notice"> to be null`）。服务端 403 本轮重做：`canSeeTruth` 改成 `return player !== undefined` → `truth.test.ts` **1 failed**（`expected 200 to be 403`）。 |
| **AC-11 零副作用** | **只补了客户端写调用，事件流深度仍未验证** | 新增 `calls.drafts === 0` 与关闭后内容消失（`spectator.test.tsx:112-120`），这部分成立。但 RFC §6 要求的「切换前后事件流快照相等」仍不存在；变异：在 `GET /truth` 里 `record.events.push(...)` 后返回 → `truth.test.ts` **3/3 仍绿**。`truth.test.ts:142-150` 仍只比较 `stateOf()` 重建出的状态，既没读 `record.events` 也没读长度。 |
| **AC-13/14 记事板隔离** | **测试仍抓不到真实泄漏路径** | 新文件确实存在，且 `src/server` 源码扫描、投影/提示词哨兵断言通过。但 `NOTEPAD_MARKER` **从未输入过 Notepad**（`notepad-isolation.test.ts:21-37` 只创建一局并 `buildUserMessage(初始 ctx)`），所以它不是「在记事板输入哨兵 → 构造一次发言 → 断言注入上下文不含」的测试。变异：让 `App.syncDraft` 把 `localStorage['howl.notepad.g']` 拼进每次 `client.draft` → 官方 `spectator + app` **8/8 全绿**；同一变异下，一条「先输入记事板再发言」的临时探针 **1 failed**，draft body 为 `"我怀疑 2 号。\nNOTEPAD_SENTINEL"`。恢复后该探针通过（draft body 只有 `"我怀疑 2 号。"`）。 |
| **e2e 投票断言** | **已关闭** | 变异：`App.vote()` 改成 no-op → `pnpm exec playwright test -g "Enter 能投票"` **1 failed**，`page.waitForResponse` 25s 超时。新 e2e「进行中没有真相入口」也通过。 |

### 1. STEP 0 · 实跑门禁

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building client environment...
✓ 133 modules transformed.
✓ built in 78ms
vite v8.3.8 building ssr environment...
✓ 61 modules transformed.
✓ built in 18ms
BUILD_EXIT=0

$ pnpm test
 Test Files  84 passed (84)
      Tests  704 passed (704)
   Duration  33.05s
TEST_EXIT=0

$ pnpm test:e2e
Running 9 tests using 1 worker
  9 passed (5.5s)
E2E_EXIT=0
```

门禁全绿，但**测试全绿不是 AC 证据**：本轮 7 个变异探针里，5 个在官方套件里是绿的（见 §7）。`pnpm test` 的 84 个文件里，RFC-013 只有 `tests/client/event-panel.test.tsx`、`tests/client/spectator.test.tsx`、`tests/server/truth.test.ts`、`tests/server/notepad-isolation.test.ts` 四个文件，合计 15 个用例。

### 2. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本轮按 game 的「玩家真的能继续看/继续玩、公开信息完整」和 web app 的「内容隔离、DOM 行为、真实浏览器」检查；mobile app / library / CLI / service 的检查不适用，跳过。没有真机与屏幕阅读器证据，本轮不宣称这两项通过。

### 3. 全量验收标准对照（Round 2）

| AC | 结果 | 证据 / 缺口 |
|---|---|---|
| 1 · 三类公开事件、按 seq | **PARTIAL** | 代码已从 `DAY_STARTED.diedLastNight` 取夜间死亡、从 `PLAYER_DIED.cause` 取 lynch/shoot（`EventPanel.tsx:41-71`），探针得到 `death / vote / banish` 三类。但测试只覆盖 death + vote；删掉 lynch 分支 6/6 仍绿；同 seq 多死者 key 冲突（`:104`），React 告警实测。 |
| 2 · 不显示角色/夜间细节 | **PASS（证据弱）** | 构建路径只处理三类公开事件；测试用 `JSON.stringify(...).not.toContain('role')`，是字符串级而非字段级，但实现路径本身没有角色字段。 |
| 3 · seq + 第 N 天 | **PASS** | `event-panel.test.tsx:86-90` 逐字段断言。 |
| 4 · 点击定位到发言流 | **PARTIAL** | **行为已成立**：探针 `PROBE_HIGHLIGHTED 2 ...`、`PROBE_SCROLLED ['?', '2']`。**测试不成立**：只测孤立组件的 `onJump` 回调；`jumpTo` 改 no-op 后 14/14 绿。测试也只覆盖「没有更早发言 → 跳到第一条发言」的回退分支（死亡 seq 1、发言 seq 4），没有覆盖「此前已有发言」的主路径。 |
| 5 · 出局后仍见后续发言与公开事件 | **PARTIAL** | 行为探针成立（出局 fixture 含 `SPEECH` 时，`我觉得 3 号像狼。` 与「公开事件」标题都在）。官方 `spectator.test.tsx:89-97` 只断言无输入/无投票/有观战提示；把 `SpeechFeed` 与 `EventPanel` 都改成只在 `ctx.self.alive` 时渲染 → `spectator.test.tsx` **4/4 仍绿**。 |
| 6 · 输入区不可用 + 提示 | **PASS** | `spectator.test.tsx:89-97`。 |
| 7 · 观战态推进到 FINISHED | **UNVERIFIED** | 没有一条 App 级用例把出局玩家推进到 `FINISHED` 后断言观战 UI 仍可渲染；`game-loop.test.ts` 是服务端循环，不经过 `App` 的观战分支。RFC §8.4:138 的 PASS 不成立。 |
| 8 · 默认关闭 + 只含公开信息 | **PASS（弱）** | `initialTruthState.enabled === false`；集成只断言标题不在（`spectator.test.tsx:107`），没有断言默认时任何角色文本不在 DOM。实现初始 `truthData = null`，风险低，但测试没有内容级锁。 |
| 9 · 所有席位角色 + 夜间行动 | **FAIL** | 服务端：真实对局九个席位 `actions` 全空（见 §0 AC-9）；客户端：只渲染 `roleLabel` 与「已出局」，不渲染 `actions` / `deaths`（`App.tsx:180-191`）。服务端测试只断言 9 个 `roleLabel`（`truth.test.ts:137-139`），没有任何 actions 断言；把 `actionsOf` 改成永远返回 `['伪造行动']`，`truth.test.ts` **3/3 仍绿**。 |
| 10 · 关闭后立即恢复 | **PASS** | 新增 `spectator.test.tsx:112-115`。变异：关闭时不清 `truthData` 且 `<ul>` 继续渲染 → `spectator.test.tsx` **1 failed**（`2 号：狼人` 仍在）。Round 1 的 M-13-3 关闭。 |
| 11 · 切换不产生任何事件 | **PARTIAL / 未验证** | 新增 `calls.drafts === 0`（`:119`）成立。但 RFC §6 的「事件流深度/快照相等」仍没有；服务端路由变异（返回前 `record.events.push(...)`）后 `truth.test.ts` 3/3 绿。`truth.test.ts:142-150` 仍是同义反复。 |
| 12 · 对局中无入口 + 请求被拒 | **PASS** | 服务端 403 本轮重做：`canSeeTruth` 改 `return player !== undefined` → 1 failed（`expected 200 to be 403`）；客户端新用例经变异打红；e2e `game.spec.ts:113-118` 也断言进行中无入口。 |
| 13 · 其他席位投影不含记事板 | **PARTIAL** | `project()` 的单观察者序列化不含哨兵，`src/server` 源码无 `notepad`；但只用了 `record.playerSeat` 一个 observer，不是 AC 写的「其他席位」，且哨兵从未经过真实 Notepad。 |
| 14 · 提示词不含记事板 | **UNVERIFIED** | 哨兵从未输入 Notepad、没有构造一次真实发言；官方套件在「App 把记事板拼进 draft」的变异下 8/8 绿。见 §0。 |
| 15 · 刷新后仍在 | **PASS** | `spectator.test.tsx:137-142`，Round 1 已接受等价覆盖。 |

**总览**：完整通过 2 / 3 / 6 / 8 / 10 / 12 / 15（其中 8 为弱证据）；PARTIAL 1 / 4 / 5 / 11 / 13；FAIL 9；UNVERIFIED 7 / 14。

### 4. Round 1 阻塞项双向复核（C-134 ~ C-143）

| # | Round 1 项 | Round 2 状态 | 本轮证据 |
|---|---|---|---|
| **C-134** | AC-1 夜间死亡/放逐 | **Open（部分修复）** | 夜间死亡、lynch/shoot 代码已补；探针得到三类。仍未闭合：没有 lynch/shoot 测试（删 lynch 分支 6/6 绿）；多死者 duplicate key（`EventPanel.tsx:104`）；测试仍只期望 `['death','vote']`。 |
| **C-135** | AC-4 面板 → 发言定位 | **Open（部分修复）** | anchor/highlight/scroll 实现已成立（探针打红）；但官方没有 App 级断言，`jumpTo` 改 no-op 后 14/14 绿；测试只覆盖回退分支；无滚动断言。 |
| **C-136** | AC-9 夜间行动结果 | **Open（功能失败）** | `actions` 仍空（payload 无 seat）；客户端不渲染 actions/deaths；`truth.test.ts` 无 actions 断言。新增 **C-148**。 |
| **C-137** | ACL 8/9/10 只断言标题 | **Closed** | 关闭后内容消失的变异现在打红（§0 AC-10）；`spectator.test.tsx:112-115` 有内容级断言。残余：默认内容、9 席 UI 仍未断言（非阻塞）。 |
| **C-138** | AC-11 零事件 | **Open（部分修复）** | `drafts === 0` 已补；事件流深度/快照仍无；路由加事件变异 3/3 绿。 |
| **C-139** | AC-12 客户端入口无锁 | **Closed** | 客户端：永远渲染 SpectatorBar → `spectator.test.tsx` 1 failed；服务端：`canSeeTruth` 放宽 → `truth.test.ts` 1 failed（§0）。 |
| **C-140** | AC-13/14 记事板隔离 | **Open（部分修复）** | 新测试存在，但哨兵从未进入 Notepad；客户端泄漏变异下官方 8/8 绿；一个真实「记事板 → 发言」探针才打红。见 §0。 |
| **C-141** | AC-5/7 观战内容与终局 | **Open** | 观战 fixture 仍只有 `DAY_STARTED`；把 feed/panel 对死者隐藏 → 4/4 绿；没有 FINISHED 的 UI 用例。 |
| **C-142** | API-1 `/truth` 契约 | **Open（部分修复）** | 新增 `src/shared/truth.ts`，服务端改用共享 `TruthView`，`TRUTH_LOCKED` 已进 `ApiErrorCode`；但客户端仍是 inline 类型（`api.ts:62-72`），`TruthViewSchema` 从未被 import / `.parse`（`grep` 只有声明处），路由 `games.ts:145` 直接 `reply.send(buildTruth(...))`。新增 **C-151**。 |
| **C-143** | e2e 投票断言被改弱 | **Closed** | no-op `vote()` → e2e 1 failed，25s `waitForResponse` 超时（§0）。 |

**关闭 3 项：C-137 / C-139 / C-143。仍 Open 7 项：C-134 / C-135 / C-136 / C-138 / C-140 / C-141 / C-142。**

### 5. 新发现（Round 2）

#### 5.1 C-148（阻塞，AC-9）· `actionsOf` 的动作者字段与事件 payload 不匹配

`truth.ts:20-46` 用 `payload['seat']` 当动作者，但：

- `WOLF_KILL_CHOSEN` 只有 `{ target }`（`schemas.ts:167`）；
- `SEER_CHECKED` 只有 `{ target, result }`（`:169-172`）；
- `WITCH_POTION_USED` 只有 `{ potion, target }`（`:174-177`）；
- 只有 `HUNTER_SHOOT` 有 `{ seat, target }`（`:184-187`）。

因此真实对局里狼刀、查验、用药三条都不会记到任何席位。探针输出：

```text
EVENTS ... '6:WOLF_KILL_CHOSEN:wolves:{"target":3}', '8:SEER_CHECKED:seer:{"target":1,"result":"not-wolf"}'
TRUTH_ACTIONS [
  { seat: 1, role: 'witch', actions: [], alive: true },
  { seat: 2, role: 'wolf', actions: [], alive: true },
  ... 九个席位全部 []
]
```

这不是「测试没断言」那么简单：九席里恰恰有 `wolf` / `seer` / `witch`，但动作摘要为空。修法必须二选一：由引擎在事件里记录动作者（会改共享 payload，需走 `/manage-changes`），或在 `buildTruth` 里按角色/存活状态归属（狼刀归狼队还是归每只狼，需要产品语义）。同时客户端必须把 `actions` 渲染出来（目前 `truthData` 的类型里根本没有这个字段，`App.tsx:31-33`）。

#### 5.2 C-149（阻塞，AC-1）· 同一次 `DAY_STARTED` 的多名死者产生重复 React key

`EventPanel.tsx:104` 的 key 是 `${entry.seq}-${entry.kind}`，同一条 `DAY_STARTED` 的 `diedLastNight:[8,9]` 会生成两个 `1-death`。探针实测：

```text
PROBE_KEYS [ '1-death', '1-death' ]
PROBE_KEY_WARNING Encountered two children with the same key, `%s`. ... 1-death
```

两名死者都会显示，但 React 明确告警「行为不受支持」。key 至少应包含席位/文本（例如 `${seq}-${kind}-${text}`）。

#### 5.3 C-150（非阻塞，AC-9 数据质量）· `deaths` 的天数全部取当前天；拒绝开枪会写「null 号」

`truth.ts:49-54` 对每条 `PLAYER_DIED` 都写 `day: state.day`，所以第 1 天死的人在第 3 天打开真相会显示第 3 天死。`HUNTER_SHOOT` 的 `target` 允许 `null`（`schemas.ts:184-187`），而 `actionsOf` 直接 `` `开枪带走了 ${String(payload['target'])} 号` `` → 拒绝开枪的猎人会显示「开枪带走了 null 号」。这两条都不在 AC-9 的字面里，但属于同一个真相数据面，建议在修 C-136 时一起处理。

#### 5.4 C-151（阻塞，API-1）· 共享 schema 只完成了一半

`src/shared/truth.ts:18-30` 定义了 `TruthViewSchema` / `TruthView`，但 `grep -rn TruthViewSchema src tests` 只命中声明本身：路由没有 `.parse`，客户端没有 import。`api.ts:62-72` 仍自己写了一份更窄的 `{ seats: { seat, roleLabel, alive }[] }`，把 `actions` / `deaths` 在类型层丢掉。API-1 的「不得两头各写一份」仍未满足；服务端返回的 `buildTruth` 也没有运行时 Zod 校验。修法：客户端 `truth()` 返回 `TruthView`；路由 `TruthViewSchema.parse(buildTruth(...))`；补 schema 的正/负用例。

#### 5.5 C-152（非阻塞，文档）· Implementation Notes / TEST-STRATEGY / README 仍漂移

- RFC §8.4:132 仍写「面板只有 death / vote 两类（放逐由相位触发）」，与现在的 lynch 分支矛盾；:140 仍写 AC-9 PASS；:145 仍把 `submits === 0` 当 AC-14 证据。
- RFC §8.7:170 写「现在会汇总刀人、查验、用药、开枪」，与 C-148 的实测相反；§8.6:161 又写「当前只给角色」——两处自相矛盾。
- `TEST-STRATEGY.md:353-358` 的 RFC-013 六行仍全部 `proposed`，文件名仍是 `truth-guard.test.ts` / `notepad.test.tsx`；实际是 `truth.test.ts` / `spectator.test.tsx`。
- `README.md:11` 仍写「11 个 Reviewed、1 个 Changes requested、4 个 Not started」，与当前 12 Reviewed / 1 Changes requested / 3 Not started 不符。

#### 5.6 C-153（非阻塞，产品语义）· `anchorFor` 的「此前最近」与回退到「之后第一条」混用

`EventPanel.tsx:31-38` 注释写「此前最近的发言」，`found === null` 时却回退到 `speeches[0]`（之后第一条）。探针的 `DAY_STARTED seq1` + `SPEECH seq4` 正是回退分支，测试把它当成正常路径（`event-panel.test.tsx:104-106`），注释也因此不准确。若产品要「没有更早发言就禁用」，这里应返回 `null`；若接受「第一条未来发言」，注释和测试名要改，并补一条真正「此前已有发言」的用例。按 A 方案「点条目 → 跳到对应 seq」两种都可解释，但必须二选一并写清楚。

### 6. 审查维度

| 维度 | 结论 | 说明 |
|---|---|---|
| **1. RFC ADHERENCE** | **NEEDS WORK** | AC-9 FAIL；AC-7/14 UNVERIFIED；AC-1/4/5/11/13 PARTIAL；AC-2/3/6/10/12/15 PASS。A 方案行为已成立，但验收测试仍缺；C-134/135/136/138/140/141 五项 Round 1 阻塞未闭合。 |
| **2. RULES COMPLIANCE** | **NEEDS WORK** | `API-1`（客户端的 `/truth` 类型仍两头各写、`TruthViewSchema` 未使用、路由无响应校验）；`TEST-1`（AC-4/5/7/11/14 无对应测试）；`DOC-1`（§8.4 / §8.7 把未实现/未验证写成 PASS 或「已汇总」）。ARCH-1 / SEC-1 / SEC-5 未发现新增违规；`GET /truth` 仍只在 `canSeeTruth` 后返回。 |
| **3. SECURITY** | **PASS（服务端）/ NEEDS WORK（证据）** | 服务端「活着 → 403」继续有牙（Round 1 探针，代码未变）；客户端活人入口经新用例 + 变异确认。记事板在服务端无字段、投影/提示词无哨兵，结构安全；但 AC-14 缺少真实「记事板 → 发言」的测试，客户端泄漏变异可全绿。未观察到实际泄漏。 |
| **4. PERFORMANCE** | **PASS / N/A** | `buildTruth` 线性扫事件；真相只在开关时 GET 一次；面板构建线性；没有新增 N+1 或无限请求。App 的 1s 轮询是 RFC-012 遗留。 |
| **5. MAINTAINABILITY** | **NEEDS WORK** | 重复 key；`buildTruth` 的动作者提取与 payload 契约不符；`deaths` 天数/`null` 号文本；客户端 `truth()` 与共享契约漂移；RFC/README/TEST-STRATEGY 文档漂移；`resetTruth` 仍未被使用（Round 1 非阻塞项）。 |

**Overall Risk Level：High。**

**Summary**：Round 1 的锚点、夜间死亡/放逐、客户端入口锁、内容级关闭与 e2e 投票都有实质进展，门禁 84/704 + 9/9 全绿。但 **AC-9 的夜间行动结果仍是功能失败**：三个核心夜间事件的 payload 没有动作者，`actionsOf` 拿不到人，客户端又完全不渲染 actions/deaths；同时 AC-4 / AC-5 / AC-7 / AC-11 / AC-14 的关键测试仍没有锁，官方套件在多个合理回归下全绿。现在不能标 `Reviewed`。

### 7. 变异探针与结果

所有探针都从 `/tmp/howl-rfc013-r2/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。每个探针前都断言目标字符串存在（注入非 no-op）；恢复后 SHA-256 与备份逐一一致，工作树 clean。

| 探针 | 改动 | 结果 | 结论 |
|---|---|---|---|
| **M-R2-1** | `App.jumpTo` 改成 no-op（不 setHighlight、不 scroll） | `event-panel + spectator + app` **14/14 passed** | AC-4 的 App 级高亮/滚动无锁（C-135） |
| **M-R2-2** | `SpectatorBar` 永远渲染（删 `ctx.self.alive ? null`） | `spectator.test.tsx` **1 failed / 3 passed** | AC-12 客户端入口有锁（C-139 关闭） |
| **M-R2-3** | `SpeechFeed` 与 `EventPanel` 只在 `ctx.self.alive` 时渲染 | `spectator.test.tsx` **4/4 passed** | AC-5 的观战内容无锁（C-141） |
| **M-R2-4** | `truth.actionsOf` 永远返回 `['伪造行动']` | `truth.test.ts` **3/3 passed** | AC-9 的 actions 无断言（C-136） |
| **M-R2-5** | `GET /truth` 返回前 `record.events.push(record.events[0])` | `truth.test.ts` **3/3 passed** | AC-11 的事件流深度无锁（C-138） |
| **M-R2-6** | `App.syncDraft` 把 `localStorage['howl.notepad.g']` 拼进 draft | 官方 `spectator + app` **8/8 passed**；临时「记事板 → 发言」探针 **1 failed**，body `"我怀疑 2 号。\nNOTEPAD_SENTINEL"` | AC-14 的测试不覆盖真实泄漏路径（C-140） |
| **M-R2-7** | `EventPanel` 删除 `cause === 'lynch'` 分支 | `event-panel.test.tsx` **6/6 passed** | AC-1 的放逐条目无测试（C-134） |
| **M-R2-8** | 关闭真相时不清 `truthData`，且内容继续渲染 | `spectator.test.tsx` **1 failed** | AC-10 内容恢复有锁（C-137 关闭） |
| **M-R2-9** | `App.vote` 改成 no-op | e2e `-g "Enter 能投票"` **1 failed**（`waitForResponse` 25s 超时） | e2e 投票断言有锁（C-143 关闭） |
| **M-R2-10** | `canSeeTruth` 改成 `return player !== undefined` | `truth.test.ts` **1 failed**（`expected 200 to be 403`） | AC-12 服务端 403 有锁（C-139 关闭，重做 Round 1 探针） |

另外两个**不改源码**的探针：

- 真实对局 `buildTruth`：`WOLF_KILL_CHOSEN` / `SEER_CHECKED` 存在但九席 `actions` 全空（C-148）。
- `EventPanel` 同 seq 两名死者：`PROBE_KEYS ['1-death','1-death']` + React duplicate key 告警（C-149）。

### 8. 探针恢复记录

备份与哈希：

```text
304e4f1...  src/server/view/truth.ts
1aae6e7...  src/server/routes/games.ts
4ed33a0...  src/client/App.tsx
584fca8...  src/client/api.ts
45def05...  src/client/components/SpectatorBar.tsx
52f4b38...  src/client/components/Notepad.tsx
1c6ae1d...  src/client/components/EventPanel.tsx
```

恢复后 `cmp` 七个文件全部 `OK`，`git status --porcelain` 为空；临时探针测试 `tests/server/probe-rfc013-r2.test.ts` 与 `tests/client/probe-rfc013-r2.test.tsx` 已删除。没有 `git commit`，没有 `git checkout` / `git restore`。

### 9. 结论

**Changes requested。** 本轮确实关掉了 C-137 / C-139 / C-143 三个 Round 1 阻塞项；AC-4 的锚点、AC-1 的夜间死亡/放逐、AC-10 的内容恢复在行为上已经成立。但 **C-134 / C-135 / C-136 / C-138 / C-140 / C-141 / C-142 仍未闭合**，其中 AC-9 是功能失败（不是测试问题）：夜间行动的 payload 里没有动作者，`actionsOf` 永远拿不到狼/预言家/女巫的动作，客户端也从不渲染 `actions` / `deaths`。在修完下列阻塞项之前，RFC-013 不能标 `Reviewed`。

**Blocking Issues（合并前必须修复）**

1. **C-136 / C-148（AC-9）**：让 `buildTruth` 真的产出狼刀/查验/用药/开枪；在 `App` 渲染 `actions` 与 `deaths`；用真实对局断言具体动作，而不是只断言 9 个 `roleLabel`。
2. **C-138（AC-11）**：服务端记录 `record.events.length` 与事件快照，`GET /truth` 前后相等；客户端补 `publicEvents.length` 不变；删掉同义反复的只读用例或改成真实断言。
3. **C-141（AC-5/7）**：补 App 级观战 fixture（含后续 `SPEECH` / `VOTE_REVEALED`），断言发言流与面板仍渲染；把出局玩家推进到 `FINISHED` 并断言观战 UI 仍可用。
4. **C-135（AC-4）**：补 App 级点击用例，断言目标 `.feed__line--highlight[data-seq]` 与 `scrollIntoView` 调用；覆盖「此前已有发言」的主路径与「没有可定位发言」的禁用。
5. **C-134 / C-149（AC-1）**：补 lynch / shoot 条目的真实事件测试；同 seq 多死者使用唯一 key；补一条两名死者的渲染用例并断言无 React key 告警。
6. **C-140（AC-13/14）**：在真实 `App` 里输入记事板哨兵，再构造一次发言，断言 `client.draft` / `client.submit` 与 `buildUserMessage(project(...))` 都不含哨兵；用 9 个 observer 至少覆盖自己与其他席位；保留 `src/server` 源码扫描作为结构证明。
7. **C-142 / C-151（API-1）**：客户端 `truth()` 返回 `@shared/truth` 的 `TruthView`；路由用 `TruthViewSchema.parse(...)`；补 schema 的正/负用例，确保两端不再各写一份。

**Improvement Suggestions（非阻塞）**

- C-150：`deaths` 的天数按事件发生时的天数记录；`HUNTER_SHOOT.target === null` 时不要输出「null 号」。
- C-152：回填 `TEST-STRATEGY.md:353-358` 的 `Exists?` 与实际文件名（`truth.test.ts` / `spectator.test.tsx` / `notepad-isolation.test.ts`），修正 RFC §8.4 / §8.6 / §8.7，同步 `README.md:11` 的 RFC 计数。
- C-153：明确 `anchorFor` 的「此前最近」与「之后第一条」回退语义，补对应用例，修正注释/测试名。
- 补 `publicEvents` 的显式 `sort((a,b)=>a.seq-b.seq)` 并喂乱序夹具（Round 1 C-144 仍未做）。
- 删除未使用的 `resetTruth`，或接进真实重置路径。
- 让 `truthData` 使用共享 `TruthView` 类型，而不是本地 `{ seats: ... }` 子集。
