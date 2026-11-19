# REVIEW · RFC-011 · Round 1

> 评审时间：2026-11-19 · 被评审提交：`04b592a feat(rfc-011): 通道抽象、编排层与身份卡`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-011 的代码。
> 结论：**Changes requested**

**关于用户批准的 A 方案**：用户批准「服务端通道 / 编排 / 玩家视图 / 发言规则先做；身份卡与输入框两个界面部件留到 RFC-012」。这条决定已记入 RFC-011 §8.1 与 D-5。因此 **AC-3 / AC-4 的 DOM 断言顺延本身不是本轮缺陷**；但这项顺延没有落到 RFC-012 的交付物 / 验收标准，`TEST-STRATEGY.md` 仍把它们标在 RFC-011 下，而 §8.4 又给其余多条 AC 写了不成立的 PASS。详见 B1 与 AC 表。

---

## 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 工作树在评审开始时 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK_EXIT=0
```

```
$ pnpm lint
> eslint .
LINT_EXIT=0
```

```
$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0
```

```
$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 67ms
vite v8.3.8 building ssr environment for production...
✓ 42 modules transformed.
dist/server/index.js  91.31 kB │ gzip: 30.46 kB
✓ built in 16ms
BUILD_EXIT=0
```

```
$ pnpm test
...
 Test Files  74 passed (74)
      Tests  613 passed (613)
   Duration  22.07s
TEST_EXIT=0
```

`tests/meta/coverage.test.ts` 也在上述 74 个文件内通过（引擎覆盖率门禁）。

```
$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0

$ pnpm selfplay
pnpm selfplay 未实现（RFC-015）
SELFPLAY_EXIT=1
```

`selfplay` 是 RFC-015 的占位，按 RFC-011 的范围记为 **N/A**；不是本轮回归。`test:e2e` 在 RFC-012 前按设计跳过。

---

## 1. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 视野 / 跨 RFC 契约检查，以及 web app 的服务端输入校验检查。UI / 无障碍 / 响应式检查随 AC-3 / AC-4 一起顺延到 RFC-012，**显式跳过，不冒充已检查**。

---

## 2. 验收标准逐条

| AC | 判定 | 会红的测试 / 一手证据 | 说明 |
|---|---|---|---|
| 1 | **PARTIAL** | `tests/server/id-card.test.ts:25-34` 对 9 个 `playerSeat` 逐一投影，但只数 `JSON.stringify(ctx)` 里 `"role":` 出现几次 | 9 席位循环是真的；但 P-1 在投影里加入含全员真实身份的 `leakedRoles[].roleId` 后，`id-card.test` + `project.test` 共 21/21 仍绿。测试拦不住「另一个 key 的身份泄漏」 |
| 2 | **PARTIAL / NEEDS WORK** | `tests/server/id-card.test.ts:36-84`；`src/server/view/id-card.ts:12-79` | 四个角色用例全部调用 `ctxFor(1)`；seed `20261117` 的 1 号是**预言家**，所以 witch / wolf / hunter 的 `if` 分支永不执行。P-2 让 `buildIdCard` 对这三个角色直接返回空卡，`id-card.test` 仍 6/6 绿。`IdCard` 没有「目标」字段，`remaining` 只对女巫有值，预言家非空查验史也没有用例 |
| 3 | **DEFERRED（用户批准）** | — | 由 RFC-011 §8.1 / D-5 顺延到 RFC-012；本轮不作为缺陷。但 RFC-012 的交付物与 15 条 AC 没有 `IdCard.tsx` / DOM 扫描，TEST-STRATEGY 也没有标 deferred（B1） |
| 4 | **DEFERRED（用户批准）** | — | 同上；`SpeechInput.tsx` 与 60 秒可见倒计时在 RFC-012 的 AC 里也没有明确落点 |
| 5 | **FAIL** | `src/shared/schemas.ts:95-100`；`src/server/routes/games.ts:101-147`；P-4 | `SPEECH.text` 只是 `z.string()`，路由没有 `isWithinLimit`。真实 HTTP 探针：301 个 Unicode 字符 → **200**，响应里有 `SPEECH` 事件，`payload.text.length === 301`。AC-5 的后端 4xx 与 `SEC-4` / F22 AC-5 未实现。前端限制随 RFC-012 顺延 |
| 6 | **FAIL / NOT IMPLEMENTED** | `src/server/channels/http.ts:45-49`；`src/server/speech.ts:34-51`；RFC-011 §8.6:182；`tests/server/channels.test.ts:66-69` | `HttpInputChannel` 超时分支写死 `text: ''`，注释明确「这里没有增量缓存」；只有 `normalizeInput` 纯函数支持「超时用已输入内容」，但没有任何调用者把草稿保存到服务端。§8.6 已承认要前端同步草稿——这是**额外的、用户没有批准的 AC-6 顺延**，不是 DOM 断言 |
| 7 | **NOT PROVEN** | `src/server/orchestrator.ts:73-93,109-126`；`tests/server/orchestrator.test.ts:45-68`；P-3 | `normalizeInput` 对空超时返回 `skip`，但编排层的 `playerAction` 永远走不到（见 AC-11）。P-3 把 `playerAction` 函数体改成 `throw`，`orchestrator.test` + `channels.test` 仍 12/12 绿。没有测试断言「超时 → `SPEECH_SKIPPED` 事件 → 对局进入下一阶段」 |
| 8 | **PARTIAL** | `src/server/llm/prompts/base.ts:47-53`；`tests/server/llm/prompts.test.ts:100-127`；`tests/server/inject/injection.test.ts` | `buildUserMessage` 确实用 `<public_utterance seat="...">` 包装公开 `SPEECH`；但计划中的 `tests/server/inject/current-speech.test.ts` 不存在，没有「玩家提交 → 他人投影 → 提示」的端到端用例。超长发言被接受后，提示实际输出「过长，已省略」，并不原样（P-4） |
| 9 | **PARTIAL** | `tests/security/channel-isolation.test.ts:19-24` 绿；`src/server/routes/games.ts:129`；`grep -rn "runGame\|HttpInputChannel\|SseOutputChannel" src` | 静态断言「engine 不出现 InputChannel / OutputChannel」成立。但生产路由直接 `registry.submit`，`runGame` / 两个通道实现**只被测试引用**；AC-9 的「输入与输出都经过接口」在 `src/` 里没有调用者。F23 的意图未兑现 |
| 10 | **PASS** | `tests/security/channel-isolation.test.ts:26-34`；正向探针 P-6 | 在 `src/client/main.tsx` 加入 `import '@engine/step'` 后，该用例 **1 failed / 3 passed**，说明静态检查有牙。当前 `src/client/` 不 import engine、不出现 `reduce(` |
| 11 | **FAIL** | `tests/server/orchestrator.test.ts:45-68,87-88`；P-5 | 用例名写「从开局推进到 FINISHED」，但唯一断言是 `expect(result.steps).toBeGreaterThanOrEqual(0)`（恒真）与事件前缀 seq 连续。P-5 实测：`steps=0`、`reads=0`、`decide` 只被调用一次、`phase=NIGHT_WOLF_CHAT`、`status=active`。没有 `expect(phase).toBe('FINISHED')`，也没有完整局 |
| 12 | **FAIL / PARTIAL** | `tests/server/channels.test.ts:84-192`；P-3 | 用例用内联 stub 手工推进一夜 + 第一天发言，**没有调用 `runGame`**，也没有真正「新增一个通道实现」；`input` 甚至被 `void input` 掉（:113）。它不能证明「新增通道不需要修改 engine/shared 之外的文件」，也不能证明「无浏览器、无 LLM 跑完整局」 |
| 13 | **NOT PROVEN** | `src/server/speech.ts:53-63`；`src/server/channels/http.ts:36-39`；`tests/server/channels.test.ts:62-80` | `remainingSeconds` 的纯函数公式有测试；`HttpInputChannel.submit` 兑现 Promise 有测试。但「刷新后剩余时间不回满」「超时仍按原起点触发」没有集成用例：`elapsed()` 无人调用，`remainingSeconds()` 无人调用，`runGame` 根本不读通道。AC-13 的服务端权威性没有被锁住 |
| 14 | **PASS** | `tests/security/channel-isolation.test.ts:36-41` | `src/engine` 不出现 `@server/` / `@client/`；既有 `tests/dependency-direction.test.ts` 对 engine → shared 的依赖方向还有更强检查 |

---

## 3. 变异探针

所有探针都从 `/tmp/howl-rfc011-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout`**。探针前三个源码文件的 SHA-256 与恢复后逐字相同：

```
c77578c...  src/server/view/id-card.ts
efddae1...  src/server/project/index.ts
c6f6f52...  src/server/orchestrator.ts
3bd6bce...  src/client/main.tsx
```

| 探针 | 注入的改动 | 定向测试 | 结果 | 证明了什么 |
|---|---|---|---|---|
| **P-1** | `src/server/project/index.ts` 返回值加 `leakedRoles: state.seats.map(s => ({ seat, roleId: s.role }))` | `pnpm vitest run tests/server/id-card.test.ts tests/server/project/project.test.ts` | **21 passed** | AC-1 只数 `"role":`；换一个 key 泄漏全员身份，测试不红 |
| **P-2** | `src/server/view/id-card.ts` 在 `switch` 前加 `if (role === 'witch' \|\| role === 'wolf' \|\| role === 'hunter') return card;`（返回空卡） | `pnpm vitest run tests/server/id-card.test.ts` | **6 passed** | AC-2 的 witch / wolf / hunter 用例是空转；只有预言家分支真执行 |
| **P-3** | `src/server/orchestrator.ts` 的 `playerAction` 第一行插 `throw new Error('PROBE: playerAction reached')` | `pnpm vitest run tests/server/orchestrator.test.ts tests/server/channels.test.ts` | **12 passed** | AC-6 / 7 / 11 / 12 的测试根本没有走到玩家输入路径 |
| **P-4** | 无代码改动：真实 `POST /api/games/:id/actions`，`SPEECH.text = '字'.repeat(301)` | 临时 tsx 脚本 + 真实 Fastify `inject` | **200**；响应 `SPEECH` 的 `textLength=301`；他人投影的提示 `promptHasFullText=false`、`promptHasTooLong=true` | AC-5 服务端拒绝缺失；超长文本既入库又被提示丢掉 |
| **P-5** | 无代码改动：`runGame` + 返回 `undefined` 的 `decide` + 计数 `InputChannel.read` | 临时 tsx 脚本 | `steps=0, reads=0, calls=[{seat:1,pending:null,selfSeat:1}], phase=NIGHT_WOLF_CHAT, status=active, events=1` | 「完整局」证据不成立；`runGame` 的投影 `pending` 恒为 null |
| **P-6（正向）** | `src/client/main.tsx` 加 `import '@engine/step';` | `pnpm vitest run tests/security/channel-isolation.test.ts` | **1 failed / 3 passed**（`main.tsx` 命中 `@engine/`） | AC-10 的静态检查确实能打红 |

探针结束后 `git status --porcelain` 为空；随后重跑全量 **74 files / 613 tests** 全绿。

---

## 4. 阻塞项

### B1 · AC-3/4 的顺延没有「落点」，且多出未批准的 AC-6/AC-13 顺延（C-99）

用户批准的原文是「身份卡与输入框两个界面部件留到 RFC-012」，顺延的是 **AC-3 / AC-4 的 DOM 断言**。实际处理变成了：

- **AC-3 / AC-4**：RFC-012 交付物没有 `IdCard.tsx` / `SpeechInput.tsx`，15 条 AC 也没有「DOM 扫描无他人身份」「60 秒可见倒计时」；RFC-012 §2.2 只写「复用 RFC-011 的卡片」，但 AC 没有承接方。
- **AC-6**：§8.6 把「播报超时（自动提交已输入内容）」也归 RFC-012。AC-6 是发言规则（`UI-4`），不是 DOM 断言；用户没有批准这条顺延。
- **AC-13**：§8.4 写 PASS，但只有 `remainingSeconds` 纯函数；没有刷新 / 服务端起点集成。
- **TEST-STRATEGY**：RFC-011 小节 7 行仍全部 `proposed`，计划文件 `tests/client/id-card.test.tsx`、`speech-input.test.tsx`、`tests/server/inject/current-speech.test.ts`、`tests/meta/dependency-direction.test.ts` 都不存在；实际落地的测试文件没有登记。

结论：**决策本身（AC-3/4 顺延）成立且已获用户批准；迁移不成立**。在 `/manage-changes` 把 AC-3/4（以及 AC-6/13 的剩余行为）明确迁入 RFC-012 或另一个后续 RFC，并把 TEST-STRATEGY 标 `deferred` 之前，RFC-011 不能以「全部 AC 已满足」进入 `Reviewed`。

### B2 · 服务端不拒绝 301 字发言（C-100）

`SPEECH` 的 Zod schema 是 `text: z.string()`（`src/shared/schemas.ts:95-100`），`POST /api/games/:id/actions` 只做 action 形状与席位校验（`src/server/routes/games.ts:101-147`）。P-4 的真实请求：

```
drive: player-turn phase= DAY_SPEECH speaker= 1 seq= 19
POST /actions 301 chars -> 200
{"hasSpeech":true,"textLength":301,"textPrefix":"字字字字字"}
{"promptHasFullText":false,"promptHasTooLong":true}
```

这同时违反 AC-5、`SEC-4`（F22 AC-5）与 `UI-4` 的前提。修复点：在 `SubmitActionBodySchema` 的 `SPEECH` 分支或路由用 `isWithinLimit` 拒绝 >300，返回 4xx；补「300 接受 / 301 拒绝」的真实 HTTP 用例。若产品决定改成截断，必须按 `FEATURES F22` 与 `UI-4` 明确记录，不能静默接受后再在提示里省略。

### B3 · `runGame` 的玩家回合不可达，AC-6/7/11/12/13 的证据不成立（C-101）

`runGame` 每轮都调用：

```ts
project({ ..., pending: null as PendingDecision | null })
```

而 `seatToAct` 只在 `ctx.pending === 'speak'` 时返回席位（`src/server/orchestrator.ts:45-57`），所以 `seatToAct` **恒为 undefined**。因此：

- `playerAction` 永远不会被调用（P-3 改成 `throw` 仍 12/12 绿）；
- `InputChannel.read` 在 `runGame` 中 0 次（P-5）；
- `decide` 只在第一轮的 `NIGHT_WOLF_CHAT` 被调用一次，`ctx.pending` 是 `null`，`legalTargets` 为空，AI 根本不知道当前要做什么；
- `ctx` 的 observer 固定为 `record.playerSeat`，如果将来把 `decide` 接到 AI，AI 会拿到**玩家视角**（`self.role` / 私有知识），违反 `SEC-5` 与 RFC-007 的投影边界；
- 即使把 `pending` 修好，`seatToAct` 的 `spoken` 来自**全量** `publicEvents`（跨天累加），第二天所有存活席位都「已发言」，仍返回 `undefined`；
- `output` 只在最后 `flush()`，从不 `emit`；`AgentDecision.speech` 未使用。

`tests/server/orchestrator.test.ts:63` 的 `expect(result.steps).toBeGreaterThanOrEqual(0)` 是恒真断言；`channels.test.ts:84-192` 手工提交 action，根本没有走 `runGame`。所以 AC-6 / 7 / 11 / 12 / 13 全都没有有效的回归锁。

修复方向：从引擎状态推导当前 actor 与 pending（`currentSpeaker` / phase 对应决策），每个 actor 单独 `project`；玩家回合走 `InputChannel`，AI 回合走 `decide`；真正 `output.emit`；补「stub 输入完整一局到 FINISHED」「第二天玩家回合」「超时 → `SPEECH_SKIPPED` → 对局继续」「AI 的 `ctx.self.seat === seat`」用例。`seatToAct` 必须按当天 `state.speech` / `DAY_STARTED` 游标计算，不能扫全量历史。

### B4 · AC-1 / AC-2 的测试是空转，身份卡还缺「目标」（C-102）

- P-2 已证明：对 witch / wolf / hunter 返回空卡，`id-card.test` 仍 6/6 绿。四个角色用例全部用 `ctxFor(1)`，而 1 号是预言家。
- P-1 已证明：只数 `"role":` 的 AC-1 测试拦不住 `roleId` 形式的全员身份泄漏。
- `IdCard` 类型没有 `goal` 字段；`remaining` 只对女巫赋值；预言家的非空查验史没有用例。
- 这条即使 UI 组件顺延，**服务端卡片数据**仍应在 RFC-011 闭环；否则 RFC-012 只能拿到一个不完整的卡片。

### B5 · 通道 / 编排在 `src/` 没有生产调用者（C-103）

`grep -rn "runGame\|HttpInputChannel\|SseOutputChannel" src tests` 的结果里，`src/` 只有定义，没有调用者；生产路由 `POST /api/games/:id/actions` 直接 `registry.submit`。因此：

- AC-9 的「输入与输出都经过接口」只在测试里成立；
- AC-12 的「新增通道实现不需要改引擎」没有被真正验证——`channels.test.ts` 用的是测试内的内联 stub，`input` 被 `void input`，也没有第二个 `src/server/channels/*` 实现；
- `SseOutputChannel` 的 `bus.publish` 没有断言；
- RFC-011 §3 的 `src/client/api.ts` 没有交付，且 Implementation Notes 的 D-5 只提了「界面部件」，没有记录这个缺口。

如果本轮的目标只是「先把服务端层写好，RFC-012 再接线」，那也可以在 `## Implementation Notes` 明确写成「未接线」，但 AC-9 / 12 不能同时标 PASS。

---

## 5. 非阻塞建议

1. **TEST-STRATEGY 回填（C-104）**：RFC-011 小节的 7 行全部改成实际文件 / `existing`，AC-3/4 标 `deferred to RFC-012`；补 AC-5 后端拒绝、AC-8 端到端、AC-11 完整局、AC-13 刷新四类用例。
2. **AC-12 的字面歧义**：RFC 写「不需要修改 `src/engine/` 与 `src/shared/` 之外的任何文件」，按字面会允许改 engine/shared，和 F23 的意图相反。建议改成「不需要修改 `src/engine/`、`src/shared/` 或任何既有 server 文件」并登记到 `RFCS.md` 的冲突表。
3. **`HttpInputChannel` 的死配置**：`this.timeoutMs` 与 `elapsed()` 没有被 `read()` / 调用方使用；`read()` 实际用 `prompt.timeoutMs`。要么删掉，要么让默认值 / 剩余时间查询真正走它；`InputPrompt.timeoutMs` 的注释「已过去的秒数 / 总秒数」也应改成「本轮总时长」。
4. **`SseOutputChannel` 的测试**：至少断言 `bus.publish` 收到 `delta` / `done` 的 `id`、`seat`、`text`，并且 `final` 只发 `done`。
5. **`src/client/api.ts`**：RFC-011 §3 的交付物；如果确实随 RFC-012 一起做，请在 §8.3 / §8.6 记录，不要让它只存在于交付物表。
6. **`SPEECH_TIMEOUT_MS` 配置**：`runGame` 的 `playerAction` 硬编码 `60_000`，没有使用 `SPEECH_TIMEOUT_MS` 或注入配置；Q-011-1 的「可配置」目前只有常量，没有配置入口。
7. **文档版本头 / 状态段**：`TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.65`；本轮已把 `RFCS.md` 顶部升到 v2.95，但 `TEST-STRATEGY.md` 的版本头尚未同步。`README.md` 的状态段仍写「八个 RFC 001–008」，没有反映 009–011；下一次 docs 提交应一并同步。

---

## 6. 五个维度

### 6.1 RFC ADHERENCE — **FAIL**

14 条 AC 中，只有 AC-10 / AC-14 有能打红且与 AC 对齐的证据；AC-3 / AC-4 是用户批准的顺延（本身不判缺陷）；其余 10 条存在缺失、空转或误归因。`src/client/api.ts`、`IdCard.tsx`、`SpeechInput.tsx` 三个交付物未交付，其中后两个有用户批准，第一个没有在 Implementation Notes 记录。AC-6 / AC-13 的额外顺延没有用户批准。

### 6.2 RULES COMPLIANCE — **NEEDS WORK**

- `SEC-4`：服务端未校验发言长度（P-4）。
- `UI-4`：服务端通道超时永远交空文本，无法自动提交已输入内容；`normalizeInput` 的 timeout 分支没有生产路径。
- `ARCH-9`：`runGame` 把玩家投影传给 AI 决策（如果接线），且通道未接到生产路由；编排层实际上没有承担「按席位推进」。
- `DOC-1`：AC-3/4 的顺延记录了，但 AC-6/AC-13、`src/client/api.ts`、AC-12 的歧义没有记录；§8.4 多条 PASS 与实测不符。
- `STYLE-2` / 命名：未发现新问题。

### 6.3 SECURITY — **FAIL**

- 301 字发言可入库（P-4）；随后 `buildUserMessage` 用「过长，已省略」替代，既没有拒绝也没有原样注入，形成「接受但不一致」的行为。
- `runGame` 的 `ctx` 按 `record.playerSeat` 投影后传给所有 `decide`；一旦接上 AI，AI 会看到玩家的身份与私有知识（`SEC-5` / RFC-007）。
- 生产路由本身仍走 `project()`，没有直接序列化完整状态；这一条目前是安全的，但编排层是下一个接线点，必须在接线前修掉。
- 注入转义本身由 `wrapPublicUtterance` 负责，P-4 未发现标签逃逸；`tests/server/inject/injection.test.ts` 的 10 个红队样本仍通过。

### 6.4 PERFORMANCE — **N/A（附一条低优先级观察）**

没有新增数据库 / 网络热路径；RFC-011 的通道是内存 Promise + SSE。`seatToAct` 每轮线性扫 `publicEvents`，一局约百条事件，不构成实际瓶颈；但它同时是 B3 的正确性缺陷，修的时候应改成按当天状态取，而不是继续优化扫描。

### 6.5 MAINTAINABILITY — **NEEDS WORK**

- `playerAction` 是死代码（P-3）。
- `HttpInputChannel.timeoutMs` / `elapsed()` 未使用；`InputPrompt.timeoutMs` 注释与语义不符。
- `tests/server/channels.test.ts:113` 的 `void input`、`orchestrator.test.ts:52` 的 `void SseOutputChannel` 是掩盖未使用导入的写法。
- `channels.test.ts` 的「一整局」、`orchestrator.test.ts` 的「从开局推进到 FINISHED」两个用例名与断言不符，会误导下一轮。
- `TEST-STRATEGY` 与实现脱节（C-104）。
- `SseOutputChannel` 无行为断言。

---

## 7. 结论

**Overall Risk Level: High。** 门禁全绿，但这是「测试没接上行为」的典型：AC-5 的后端拒绝真实缺失，AC-6/7/11/12/13 的「证据」在探针下全绿，AC-1/2 的断言空转。代码本身没有写坏引擎依赖方向，AC-10 / AC-14 的静态锁有效；但 RFC-011 的核心交付物——「玩家能说、说了能进对局、通道能驱动完整局」——没有被证明，且 `runGame` 的玩家路径当前不可达。UI 顺延本身是用户批准的范围决定；问题在于顺延没有落点、额外的 AC-6/13 顺延没有批准、以及 §8.4 把未证明的行为写成 PASS。

**Blocking Issues**：B1（C-99）、B2（C-100）、B3（C-101）、B4（C-102）、B5（C-103）。

**Improvement Suggestions**：见 §5 的 1–7 条；其中 1（TEST-STRATEGY 回填）与 2（AC-12 措辞）应在下一轮修复提交里一并完成。

**状态**：RFC-011 → `Changes requested`。没有 `git commit`；所有探针源码已从文件备份恢复，探针后全量 74 files / 613 tests 绿，`git status --porcelain` 为空。

---

## Round 2 — 2026-11-19

> 被评审提交：`bc913b5 fix(rfc-011): 后端拒绝超长发言、超时草稿与玩家轮可达（Round 1）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 Round 1 的五项修复；AC-3 / AC-4 的界面顺延按用户批准的 A 方案保留，**不重开这项范围决定**；AC-10 / AC-14 在 Round 1 已 PASS，本轮未重查。AC-8 等 Round 1 未关闭但本轮无代码变化的条目，沿用原判并注明未重查。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `bc913b5`，工作树 clean。

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client)
✓ 43 modules transformed (server)
BUILD_EXIT=0

$ pnpm test
Test Files  74 passed (74)
     Tests  616 passed (616)
  Duration  21.70s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

门禁全绿只能证明「现有用例通过」，不能证明 AC 的用例有牙；下面的探针逐条补这一步。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 视野 / 跨 RFC 契约检查，以及 web app 的服务端输入校验检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延，**显式跳过**；本轮不冒充已检查。

### 2. 用户列出的五项修复逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| AC-5：路由层拒绝超过 300 Unicode 字符的发言（400），反向探针会红 | **PASS（后端）** | `src/server/routes/games.ts:120-129` 在 `registry.submit` 前用 `isWithinLimit` 校验。P-R2-A 删掉该分支后 `tests/server/speech.test.ts` **1 failed / 5 passed**（`expected 200 to be 400`）。C-100 可关闭。边界用例仍缺：300 字接受、emoji 301 的**路由级**验证；P-R2-H 把路由改成 `text.length > 300`，6/6 仍绿，见 §6 非阻塞项。 |
| AC-6：`HttpInputChannel.setDraft` 让超时交出草稿 | **PARTIAL** | `src/server/channels/http.ts:43-64` 的实现与单测成立：P-R2-B 把超时文本改回 `''` 后 **1 failed / 5 passed**（`skip` vs `timeout`）。但 `setDraft` **没有任何生产调用者**：`src/` 里只有定义与测试（`grep -rn "setDraft" src` 只命中 `http.ts`），没有草稿同步路由，`src/client/api.ts` 也没有 `setDraft` 方法。AC-6 的「内容完整进入事件流」只在临时探针 P-R2-G 里成立，仓库里没有这条回归锁。 |
| AC-6/7/11：新增 `seatToSpeak` 让 `playerAction` 可达；用例断言 `input.read` 被调用且产出 `SPEECH` | **PARTIAL（可达性成立，AC 证据仍不成立）** | P-R2-C 把 `seatToSpeak` 改成恒 `undefined` 后 `tests/server/orchestrator.test.ts` **1 failed / 2 passed**（`reads=0`），可达性确实有锁。但该用例只断言 `reads > 0` 与「事件流里有任意 `SPEECH`」；P-R2-D 让 `playerAction` 读完输入后**永远返回 `SPEECH_SKIP`**，`orchestrator.test` 仍 **3/3 绿**——玩家输入原文并没有被锁进事件流。AC-7 的「超时且为空 → `SPEECH_SKIPPED` → 对局继续」没有提交的用例；AC-11 的完整局更没有。 |
| AC-1/2：身份卡加 `goal`，测试按种子扫出五种角色各验一次 | **FAIL（测试完全没改）** | `src/server/view/id-card.ts:19,39,87-105` 确实加了 `goal`，但 `tests/server/id-card.test.ts` 与 Round 1 提交 `04b592a` **逐字相同**（`git diff 04b592a HEAD -- tests/server/id-card.test.ts` 为空，blob hash 都是 `b83f1f9...`）。四个角色用例仍全部用 `ctxFor(1)`（`:38,51,62,71`），而 seed `20261117` 的 1 号是预言家；`if (ctx.self.role === 'witch' / 'wolf' / 'hunter')` 分支永不执行。P-R2-E1 把 `card.goal` 置空、P-R2-E2 让非预言家直接返回空卡，`id-card.test` 都仍 **6/6 绿**。`goal` 没有任何断言。 |
| AC-12：交付 `src/client/api.ts` | **PARTIAL** | 文件已交付（72 行，读投影 / 提交 / 订阅流），但 `grep -rn "ApiClient" tests src` 只命中它自己：没有测试、没有 import。它不能替代 C-103 要求的「通道 / 编排在 `src/` 有生产调用者」，也不能证明 AC-12 的「新增通道实现不动引擎」。 |

### 3. 验收标准逐条

| AC | 判定 | 说明 |
|---|---|---|
| 1 | **PARTIAL（未修）** | `tests/server/id-card.test.ts:25-34` 仍只数投影 JSON 里 `"role":` 出现次数；Round 1 P-1 的 `leakedRoles[].roleId` 泄漏仍拦不住。9 席位循环是真的，但断言只覆盖一个 key。 |
| 2 | **FAIL（未修）** | 见 §2。`goal` 只在实现里；女巫 / 狼 / 猎人分支在测试里仍是死代码；预言家的非空查验史、女巫药水 used/available 的具体值、猎人 `canShoot` 两态都没有用例；`remaining` 仍只对女巫有值。 |
| 3 | **DEFERRED（用户批准）** | A 方案保留；但 RFC-012 的交付物（`RFCs/RFC-012...:64-75`）与 15 条 AC（`:84-100`）仍没有 `IdCard.tsx` 或 DOM 扫描的承接方。 |
| 4 | **DEFERRED（用户批准）** | 同上；`SpeechInput.tsx` 与 60 秒可见倒计时在 RFC-012 也没有明确 AC。 |
| 5 | **PASS（后端）/ 前端 deferred** | 路由 400 有反向锁；前端「无法继续输入」属于 RFC-012。边界用例缺口见 §6。 |
| 6 | **PARTIAL** | 通道级 `setDraft` 有锁；P-R2-G 的临时集成探针证明「超时草稿 → 玩家 `SPEECH` → `DAY_VOTE`」行为可成立（playerSeat 2，`reads=1`，`SPEECH` 文本 `我的草稿`），但仓库里没有这条用例，也没有草稿同步 API。 |
| 7 | **PARTIAL** | P-R2-G2 的临时集成探针证明空超时 → `SPEECH_SKIPPED`（seat 2）→ `DAY_VOTE`；但已提交用例只测 `normalizeInput` 纯函数与通道返回值，没有编排层 / 事件流断言。 |
| 8 | **PARTIAL（沿用 Round 1，本轮未重查）** | `buildUserMessage` 仍用 `<public_utterance seat="...">` 包装公开 `SPEECH`；计划中的 `tests/server/inject/current-speech.test.ts` 仍不存在，没有「玩家提交 → 他人投影 → 提示」的端到端用例。 |
| 9 | **FAIL（未修）** | `grep -rn "runGame\|HttpInputChannel\|SseOutputChannel" src` 仍只有定义：生产 `POST /api/games/:id/actions` 直接 `registry.submit`（`src/server/routes/games.ts:139`）。AC-9 的「输入与输出都经过接口」在 `src/` 里仍不成立。 |
| 10 | **PASS（Round 1，未重查）** | Round 1 P-6 已证明静态检查能打红；本轮 `src/client/api.ts` 只 import `@shared/`，没有回归。 |
| 11 | **FAIL（未修）** | `tests/server/orchestrator.test.ts:46-68` 的用例名仍写「从开局推进到 FINISHED」，唯一断言仍是 `steps >= 0`；P-R2-F 用同一个 `decide` 返回 `undefined` 实测 `steps=0, reads=0, phase=NIGHT_WOLF_CHAT`。`channels.test.ts:84-193` 仍是手工推进一天，不调用 `runGame`。没有任何用例让 `runGame` 到达 `FINISHED`。 |
| 12 | **FAIL（未修）** | `channels.test.ts:113` 仍有 `void input`；测试仍是内联 stub 手工推进一天，没有新增 `src/server/channels/*` 实现，也没有「新增实现不改 engine/shared」的证明。交付的 `src/client/api.ts` 不是 `InputChannel` 实现。 |
| 13 | **FAIL / NOT PROVEN（未修）** | `remainingSeconds` 只有纯函数测试；`HttpInputChannel.elapsed()` 与 `remainingSeconds()` 在 `src/` 没有调用者（`grep` 只命中定义与测试）。没有「刷新后剩余时间不回满 / 超时仍按原起点」的集成证据，也没有把剩余时间暴露给客户端的路由。 |
| 14 | **PASS（Round 1，未重查）** | Round 1 已检查 engine → shared 依赖方向；本轮 orchestrator / client 的改动没有反向 import。 |

### 4. 变异探针与临时集成探针

所有源码探针从 `/tmp/howl-rfc011-r2-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout`**。四个源码文件探针前的 SHA-256：

```
cfd05616...  src/server/routes/games.ts
4eebadb9...  src/server/channels/http.ts
a38f3cec...  src/server/orchestrator.ts
f4f8a60e...  src/server/view/id-card.ts
```

恢复后 `sha256sum -c` 四项全 `OK`，临时探针测试已删除，`git status --porcelain` 为空。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R2-A** | 删掉 `routes/games.ts` 的 AC-5 校验分支 | `tests/server/speech.test.ts` | **1 failed / 5 passed**；`expected 200 to be 400` | AC-5 后端拒绝有反向锁 |
| **P-R2-B** | `http.ts` 超时分支 `const text = this.draft` → `''` | `tests/server/speech.test.ts` | **1 failed / 5 passed**；`skip` vs `timeout` | `setDraft` 通道级有锁 |
| **P-R2-C** | `seatToSpeak` 恒 `undefined` | `tests/server/orchestrator.test.ts` | **1 failed / 2 passed**；`reads=0` | 玩家发言轮可达有锁 |
| **P-R2-D** | `playerAction` 读完输入后恒返回 `SPEECH_SKIP` | `tests/server/orchestrator.test.ts` | **3/3 passed** | 用例没有把玩家输入原文锁进 `SPEECH`；AC-6 回归锁不完整 |
| **P-R2-E1** | `card.goal = ''` | `tests/server/id-card.test.ts` | **6/6 passed** | `goal` 完全没有测试 |
| **P-R2-E2** | 非预言家 `return card`（女巫 / 狼 / 猎人空卡） | `tests/server/id-card.test.ts` | **6/6 passed** | 三个角色分支仍是死代码（Round 1 P-2 未修） |
| **P-R2-F** | 临时探针：`runGame` + `decide` 恒 `undefined` | 临时 `__r2_probe.test.ts` | `steps=0, reads=0, phase=NIGHT_WOLF_CHAT` | 「从开局推进到 FINISHED」用例名不成立 |
| **P-R2-G** | 临时探针：玩家 wolf 推进到 `DAY_SPEECH`，`HttpInputChannel` 超时 + `setDraft('我的草稿')`（prompt 缩短到 20ms） | 临时 `__r2_probe.test.ts` | `reads=1`；玩家 seat 2 的 `SPEECH` 文本 `我的草稿`；随后 `DAY_VOTE` | AC-6 行为可成立，但仓库无此回归锁 |
| **P-R2-G2** | 同上，但不 `setDraft`，超时为空 | 临时 `__r2_probe.test.ts` | `SPEECH_SKIPPED` seat 2；随后 `DAY_VOTE` | AC-7 行为可成立，但仓库无此回归锁 |
| **P-R2-H** | 路由条件改成 `text.length > 300`（UTF-16 计数） | `tests/server/speech.test.ts` | **6/6 passed** | 路由级 Unicode 计数没有回归锁；只有纯函数 `isWithinLimit` 有 |
| **P-R2-I** | 临时探针：捕获每个 AI 发言回合的 `decide({seat, ctx})` | 临时 `__r2_probe.test.ts` | `calls=[{seat:3,selfSeat:2},{seat:4,selfSeat:2},{seat:5,selfSeat:2},{seat:6,selfSeat:2},{seat:7,selfSeat:2}]`，**5 个 mismatch** | AI 决策拿到的是玩家席位的投影（`self.role` / 私有知识），SEC-5 边界破裂 |

P-R2-G 与 P-R2-G2 是**正向行为探针**：临时缩短 `prompt.timeoutMs` 是为了不真等 60 秒；它们证明通道 + 编排在当前实现上能跑通，不代表已提交的测试覆盖了这两条路径。

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **FAIL**

用户列出的五项修复只有 AC-5 后端闭环；AC-6/7 的行为存在但没有提交的回归锁与生产草稿 API；AC-11 的完整局没有证据；AC-1/2 的测试仍是空的；`src/client/api.ts` 交付但没有测试与调用者。AC-9 / AC-12 / AC-13 仍未被证明。RFC §8.7 的「测试按种子扫出五种角色各验一次」与仓库事实不符（`tests/server/id-card.test.ts` 未改）。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **SEC-4**：后端 300 字校验已补，P-R2-A 证明有锁；这条从 FAIL 降为 PASS（边界测试缺口见 §6）。
- **UI-4 / AC-6**：通道层实现了超时草稿，但没有生产草稿同步路径；`setDraft` 只被测试调用。UI-4 的「不得静默丢弃」在真实链路仍不可达。
- **SEC-5 / ARCH-9**：`runGame` 用 `observer: record.playerSeat` 投影一次（`src/server/orchestrator.ts:76-80`），然后把这个 `ctx` 同时传给 AI 的 `decide`（`:96`）。P-R2-I 实测 AI 席位 3–7 的 `ctx.self.seat` 都是玩家 2。只要把 `runGame` 接到生产 AI，AI 就会看到玩家的身份与私有知识，直接违反 SEC-5，并让「AI 不作弊」卖点失效。这是本轮最严重的代码问题。
- **ARCH-9 / 编排**：非发言阶段 `decide({ seat: record.playerSeat, ctx })`（`:86`）始终问玩家席位，AI 的 `WOLF_KILL` / `SEER_CHECK` / `WITCH_ACT` / 投票没有被问；因此 AC-11 的 9 人完整局按当前接口无法可靠跑完。`pending` 只在 `DAY_SPEECH` 给 `'speak'`（`:80`），夜间 / 投票仍是 `null`，与 Round 1 B3 的「从引擎状态推导 pending」要求只完成了一部分。
- **DOC-1**：RFC §8.6 仍写「`HttpInputChannel` 超时时交出空文本」（`RFCs/RFC-011...:182`），与当前实现相反；§8.7 声称身份卡测试按种子扫五种角色，但测试文件未改。RFCS 表 C-99/C-100 的 Round 1「已修复」单元格原本与行错位（C-99 行写的是 AC-5，C-100 行写的是 `setDraft`）；本轮已在 RFCS 增加「Round 2 复核」列并归位（C-100 → Closed，C-101/102/103 仍 Open）。
- **TEST-1**：AC-1/2/6/7/11/12/13 仍缺可打红的自动化测试；计划中的 `tests/server/inject/current-speech.test.ts`、`tests/client/id-card.test.tsx`、`speech-input.test.tsx` 不存在。

#### 5.3 SECURITY — **FAIL**

- 直接证据是 P-R2-I：AI 决策的 `ctx.self.seat` 是玩家席位，不是 `seat`。这泄露玩家角色与 `knowledge`（查验史 / 药水 / 队友），是 `SEC-5` 的硬违规。
- `runGame` 尚未进生产路由，所以当前浏览器路径还没有真的把该投影发给模型；但本 RFC 的交付物正是「编排层」，一旦 RFC-012 接线就会生效。修复应在接线前完成。
- 生产 `project()` 仍只按 `record.playerSeat` 裁剪，`POST /actions` 未直接序列化完整状态；这一条目前没有回归。
- 输入长度校验（`SEC-4`）已修；注入转义（`SEC-3`）仍由 RFC-006/007 的既有测试覆盖，本轮未发现新问题。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库、网络热路径或 N+1；`seatToSpeak` 每次线性扫 9 个席位，`runGame` 每步一次投影，规模可忽略。真正的性能风险是「AI 上下文每轮都按玩家投影构造」会破坏正确性，不归性能维度。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `runGame` 的 `output` 只 `flush()`，从不 `emit`（`src/server/orchestrator.ts:106-107`）；`AgentDecision.speech` 字段从未使用。
- `HttpInputChannel.timeoutMs` 与 `elapsed()` 仍无调用者；`read()` 实际用 `prompt.timeoutMs`，`playerAction` 又硬编码 `60_000`（`orchestrator.ts:117`），Q-011-1 的「可配置」没有落地。
- `InputPrompt.timeoutMs` 的注释仍写「已过去的秒数 / 总秒数」（`src/shared/channels.ts:22`），字段语义是「本轮总时长」。
- `tests/server/orchestrator.test.ts:63` 的 `steps >= 0` 与用例名不符；`channels.test.ts:113` 的 `void input`；`tests/server/id-card.test.ts` 的角色分支仍用 `ctxFor(1)`。
- `src/client/api.ts` 无测试，`ApiClient.game` / `submit` 的错误响应未做状态码区分（非阻塞）。
- `TEST-STRATEGY.md:318-329` 仍全部 `proposed`，且未登记实际落地的 `tests/server/{channels,speech,id-card,orchestrator}.test.ts`；头部的 `RFCS.md v2.65` 也已落后（当前 v2.96）。

### 6. 非阻塞建议

1. **AC-5 边界**：补「300 字接受 / 301 拒绝」和「301 个 emoji → 400」的路由级用例；当前 P-R2-H 证明 UTF-16 计数回归不会被发现。
2. **AC-6 / AC-7 回归锁**：把 P-R2-G / G2 的临时探针固化成 `orchestrator.test.ts`（或新的集成文件），断言玩家 `SPEECH` 文本等于草稿、空超时产出 `SPEECH_SKIPPED` 且阶段继续；同时补草稿同步路由与 `ApiClient.setDraft`，否则 `setDraft` 只在测试里存在。
3. **AC-11 完整局**：新增「stub `InputChannel` + 脚本化 `decide` 从开局跑到 `FINISHED`」用例，并断言 `ctx.self.seat === seat`、夜间 / 投票 actor 正确、第二天仍能轮到玩家。先修 `runGame` 的按 actor 投影与 pending，再写用例；否则用例只会证明「玩家投影喂给 AI」。
4. **AC-1 / AC-2**：用 4 个不同 seed（或直接构造 4 个 `ProjectedContext`）覆盖预言家 / 女巫 / 猎人 / 狼人 / 村民；断言 `goal` 非空且角色相关、女巫两瓶药的具体 used/available、猎人 `canShoot` 两态、预言家非空查验史、狼人队友；AC-1 改成递归检查投影中所有 role-like 值，或至少检查 `roleId` / 角色名，不只数 `"role":`。
5. **AC-9 / AC-12 / C-103**：要么把 `HttpInputChannel` / `SseOutputChannel` / `runGame` 接到 `POST /actions` 与 SSE 生产路径，要么在 RFC §8.4 把 AC-9 / AC-12 改成「未接线」并把接线明确写进 RFC-012；`SseOutputChannel` 至少补 `bus.publish` 的 `delta` / `done` / `degraded` 断言。`src/client/api.ts` 补一个 fetch stub 测试。
6. **AC-13**：把 `elapsed()` / `remainingSeconds()` 接到提示或路由，补「刷新后剩余时间不回满、超时按原起点」的集成用例；当前两者只有纯函数 / 定义。
7. **文档**：修正 RFC §8.6 的旧「超时交空文本」；RFCS 的 Round 2 复核列已补（C-100 Closed，C-101/102/103 仍 Open），剩余 `TEST-STRATEGY` 按实际文件回填 `existing:` 并把 AC-3/4 标 `deferred`；README 的「7 Reviewed / 0 Changes requested」在状态变更后同步；RFC-012 承接 AC-3/4 的组件与 DOM 扫描（或由 `/manage-changes` 正式登记顺延）。
8. **配置**：`playerAction` 使用 `SPEECH_TIMEOUT_MS` 或注入配置；删除或使用 `HttpInputChannel.timeoutMs` / `elapsed()`；修正 `InputPrompt.timeoutMs` 注释。

### 7. 结论

**Overall Risk Level: High。**

Round 1 的五项修复中，只有 **AC-5 后端拒绝**闭环（C-100 可关闭）；AC-6 的通道级 `setDraft` 与 AC-6/7/11 的玩家发言可达性有真实进展，但都停在「单元 / 临时探针」层：没有生产草稿 API、没有提交的 AC-6/7 事件流回归锁、没有完整局。**AC-1/2 的测试没有改动**，`goal` 是唯一没被任何测试断言的实现；`runGame` 仍把玩家投影传给 AI（SEC-5），且非发言阶段只问玩家席位，AC-11 的完整局按当前接口无法可靠完成；AC-9/12 仍无生产调用者，`src/client/api.ts` 只是文件交付。

**Blocking Issues**：

- **B-R2-1（AC-1 / AC-2 / C-102）**：身份卡测试未改，`goal` 未测，女巫 / 狼 / 猎人分支仍是死代码（P-R2-E1 / E2 全绿）。
- **B-R2-2（C-101 / SEC-5 / AC-11）**：`runGame` 把玩家投影传给 AI（P-R2-I）；非发言阶段只问玩家席位；AC-11 没有完整局证据，`steps >= 0` 的用例名不成立。
- **B-R2-3（C-103 / AC-9 / AC-12）**：通道与编排在 `src/` 仍无生产调用者；`channels.test.ts` 仍是手工一天，`void input`；`SseOutputChannel` 的 bus 行为没有断言。
- **B-R2-4（AC-6 / AC-7 / AC-13）**：`setDraft` 没有生产路径；AC-6/7 的事件流没有提交的回归锁；AC-13 的刷新 / 服务端起点没有集成证据，`elapsed()` / `remainingSeconds()` 无调用者。

**Non-blocking**：C-99（AC-3/4 已获用户批准顺延；RFC-012 / TEST-STRATEGY 仍未承接，记文档项）、C-104（TEST-STRATEGY 回填）、AC-5 边界用例、RFC §8.6 旧描述 / README 状态数。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r2-probes/backup/` 的文件备份恢复，四个文件的 SHA-256 与探针前一致，临时探针测试已删除，探针后全量 **74 files / 616 tests** 绿。

---

## Round 3 — 2026-11-19

> 被评审提交：`3670036 fix(rfc-011): 每个席位用自己的投影、整局可达终局（Round 2）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 **SEC-5 / AC-11 / AC-1·AC-2 / AC-6** 四项。AC-3 / AC-4 的用户批准顺延不重开；AC-10 / AC-14 在 Round 1 已 PASS，本轮不重查；C-100 已 Closed，不重查。AC-7 / AC-8 / AC-9 / AC-12 / AC-13 等 Round 1/2 未关闭项沿用原判并注明未重查；其中 C-103（AC-9 / AC-12）在 RFCS 仍是 Open，仍独立阻止 `Reviewed`。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `3670036`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client)· built in 61ms
✓ 43 modules transformed (server)· built in 14ms
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  619 passed (619)
   Duration  21.08s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

`pnpm selfplay` 仍以退出码 1 结束并提示 RFC-015，按 RFC-011 的范围记 **N/A**（RFC-015 的占位），不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 视野 / 跨 RFC 契约检查，以及 web app 的服务端输入校验检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；本轮不冒充已检查。

### 2. 用户列出的四项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **SEC-5**：`ctxFor(observer)`，每个席位看自己的投影；补「`decide` 收到的 `ctx.self.seat` 恒等于被问席位」用例；反向探针会红 | **PASS** | `src/server/orchestrator.ts:118-124` 按 `observer` 调用 `project()`；`tests/server/orchestrator-full.test.ts:95-127` 收集 `mismatches` 并断言 `[]`。P-R3-1 把 observer 改回 `record.playerSeat`：`pnpm exec vitest run tests/server/orchestrator-full.test.ts` → **1 failed / 1 passed**，SEC-5 用例报出 39 个 `{asked:2,self:1}…`；AC-11 用例仍绿。说明反向锁有牙，且它只锁投影的 observer，不靠 AC-11 兜底。 |
| **AC-11**：新增 `nextActor(state)`（夜间按角色、白天投票按未投者），脚本化 AI 能打到 `FINISHED` | **PASS（终局）/ 证据有缺口** | `nextActor` 在 `src/server/orchestrator.ts:50-77`，覆盖 `NIGHT_WOLF_CHAT` / `NIGHT_WOLVES` / `NIGHT_SEER` / `NIGHT_WITCH` / `DAY_VOTE` / `DAY_VOTE_RUNOFF`；`tests/server/orchestrator-full.test.ts:22-50` 断言 `result.record.status === 'finished'` 且 seq 连续。P-R3-2 去掉 `?? nextActor(state)` 后同一文件 **2 failed**（`status=active`、`asked=0`），终局回归锁有牙。**但整局没有消费 stub 输入通道**：P-R3-8 临时探针得到 `status=finished, steps=40, asked=40, reads=0, seqLast=68`，玩家 1（预言家）在 `seq=11` 首夜死亡；`ctx.pending` 在全部 `NIGHT_*` / `DAY_VOTE` 都是 `null`、`legalTargets` 都是空数组，脚本 AI 实际用 `registry.stateOf(record)` 读引擎真值来选目标。见 §4。 |
| **AC-1/2**：身份卡测试按种子扫五种角色；`goal` 置空会红 | **AC-2 PASS；AC-1 PARTIAL** | `tests/server/id-card.test.ts:18-33` 的 `ctxOfRole` 扫 seed 1..200 × 9 席；`:54-61` 遍历五种角色断言技能与 `goal` 非空；P-R3-3 把 `card.goal` 置空 → **1 failed / 6 passed**；P-R3-4 让非预言家直接返回空卡 → **4 failed / 3 passed**（五角色、女巫、狼、猎人）。**但 AC-1 仍是** `tests/server/id-card.test.ts:36-52` 的 `JSON.stringify(ctx).match(/"role":/g)` 只数 `"role":`；P-R3-5 在 `project()` 返回值加 `leakedRoles: state.seats.map(s => ({ seat: s.seat, roleId: s.role }))`，`id-card.test.ts` + `project.test.ts` **22/22 绿**——全员身份换一个 key 泄漏时测试不红。 |
| **AC-6**：玩家发言原文有断言 | **FAIL（声明与仓库不符）** | `tests/server/orchestrator.test.ts:92-187` 的输入文本是 `我过关。`（`:162`），但唯一断言是 `reads > 0`（`:183`）和「事件流里有任意 `SPEECH`」（`:184-186`）。`git diff HEAD~1 HEAD -- tests/server/orchestrator.test.ts` **为空**；新提交只新增 `orchestrator-full.test.ts`，其中 `input` 从未被读（P-R3-8 `reads=0`）。P-R3-6 让 `playerAction` 对 `speak` 也返回 `SPEECH_SKIP` → `orchestrator.test` + `orchestrator-full.test` **5/5 绿**；P-R3-7 把 `input.text` 换成 `'错误文本'` → 仍 **5/5 绿**。因此 `RFCs/RFC-011...:206` 的「改为断言玩家通过通道输入的那句话原样进入事件流」与 `RFCS.md` v2.98 的「玩家发言原文有断言」**不成立**。 |

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r3-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前三个源码文件的 SHA-256：

```text
a671a65e...  src/server/orchestrator.ts
f4f8a60e...  src/server/view/id-card.ts
efddae1f...  src/server/project/index.ts
```

每次探针后都 `cp` 回备份并 `sha256sum -c`，最后一次三个文件全部 `OK`；临时探针 `tests/server/__r3_probe.test.ts` 已删除；探针后 `git status --porcelain` 为空，全量 **75 files / 619 tests** 绿。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R3-1** | `orchestrator.ts` 的 `ctxFor` 改回 `observer: record.playerSeat`（模拟 Round 2 的 SEC-5 违规） | `tests/server/orchestrator-full.test.ts` | **1 failed / 1 passed**；SEC-5 用例 `mismatches` 39 条，AC-11 仍绿 | SEC-5 反向锁有牙；且它不依赖 AC-11 |
| **P-R3-2** | `const seat = seatToSpeak(state) ?? nextActor(state)` → 去掉 `?? nextActor(state)` | 同上 | **2 failed**；AC-11 `expected 'active' to be 'finished'`，SEC-5 `asked=0` | AC-11 的 FINISHED 证据确实依赖 `nextActor` |
| **P-R3-3** | `id-card.ts` 的 `card.goal = goalOf(role, ctx)` → `card.goal = ''` | `tests/server/id-card.test.ts` | **1 failed / 6 passed**；失败在「五种角色都有技能与目标」`goal.length > 0` | `goal` 有真实断言 |
| **P-R3-4** | `buildIdCard` 在 `switch` 前对非 seer 直接 `return card`（空卡） | 同上 | **4 failed / 3 passed**；五角色、女巫、狼、猎人四条红 | 角色分支不是死代码 |
| **P-R3-5** | `project()` 返回值增加 `leakedRoles: [{ seat, roleId: role }]`（含全员真实身份） | `tests/server/id-card.test.ts` + `tests/server/project/project.test.ts` | **22/22 绿** | AC-1 的 `"role":` 计数拦不住换 key 的身份泄漏 |
| **P-R3-6** | `playerAction` 对 `kind === 'speak'` 也返回 `SPEECH_SKIP` | `tests/server/orchestrator.test.ts` + `orchestrator-full.test.ts` | **5/5 绿** | AC-6 没有锁住「玩家输入原样进入 SPEECH」 |
| **P-R3-7** | `playerAction` 的 `text: input.text` 改成 `text: '错误文本'`；`speech` 同步改 | 同上 | **5/5 绿** | 同上；连文本被替换也不会红 |
| **P-R3-8** | 临时整局探针：`playerSeat=1`、`seed=20261117`，计数 `InputChannel.read` 与 `decide` 收到的 `pending` / `legalTargets` | 临时 `tests/server/__r3_probe.test.ts` | `status=finished, steps=40, reads=0, asked=40, seqLast=68`；玩家 1 是 seer，`diedSeq=11`；`NIGHT_*:null:targets=0`、`DAY_VOTE:null:targets=0`、`DAY_SPEECH:speak:targets=0` | AC-11 的整局没有玩家输入；AI 夜间 / 投票拿不到 pending 与合法目标，脚本 AI 读 `registry.stateOf(record)` 才能行动 |

> P-R3-8 是**正向行为探针**：它证明 `runGame` 能把这一局推到 `FINISHED`，同时暴露这个「完整局」并没有消费 stub 通道，也没有给 AI 一个可用的夜间 / 投票上下文。它不是对 AC-11 终局断言的否定，而是对「用 stub 通道（预置输入序列）」与「AI 由投影驱动」两件事的证据缺口。

### 4. 验收标准（本轮范围）

| AC | 判定 | 说明 |
|---|---|---|
| 1 | **PARTIAL / NEEDS WORK** | 9 个席位的循环与 `ctx.self.seat === seat` 成立；但「角色字段只有观察者自己的」仍靠数 `"role":`，P-R3-5 证明 `roleId` 形式的泄漏不红。这是 Round 1 P-1 / C-102 的原问题，未闭环。 |
| 2 | **PASS（附非阻塞缺口）** | 五角色扫描、`goal`、女巫两瓶药、狼队友、猎人开枪文案都有可红断言（P-R3-3 / P-R3-4）。未见「预言家非空查验史」「女巫 `used` 状态」「猎人 `canShoot === true`」的用例；这些是 AC-2 的状态变体，不阻塞本轮，但建议补。 |
| 6 | **FAIL** | 没有断言玩家通过通道输入的原话进入 `SPEECH.payload.text`；P-R3-6 / P-R3-7 全绿。代码当前确实把 `input.text` 写进 action，但没有回归锁，且 RFC §8.8 / RFCS v2.98 的声明与仓库不符。 |
| 7 | **未重查（沿用 Round 2：PARTIAL）** | `normalizeInput` 与 `HttpInputChannel` 的 `skip` 有单测；没有「超时为空 → `SPEECH_SKIPPED` → 对局继续」的编排 / 事件流回归锁。本轮无相关提交，未重查。 |
| 9 | **未重查（沿用 Round 2：FAIL）** | `grep -rn "runGame\\|HttpInputChannel\\|SseOutputChannel" src` 仍只有定义：生产 `POST /api/games/:id/actions` 直接 `registry.submit`（`src/server/routes/games.ts:139`），`runGame` / 两个通道实现在 `src/` 没有调用者。C-103 仍 Open。 |
| 11 | **PASS（终局）/ PARTIAL（stub 输入）** | `orchestrator-full.test.ts` 到 `FINISHED` 且 P-R3-2 会红；但该局玩家首夜死亡、`reads=0`，没有用 stub 输入序列驱动任何玩家回合；`NIGHT_*` / `DAY_VOTE` 的 `ctx.pending` 为 `null`、`legalTargets` 为空，脚本 AI 读 registry 状态。 |
| 12 | **未重查（沿用 Round 2：FAIL）** | 仍没有「新增 `src/server/channels/*` 实现不改 engine/shared」的生产调用证明；`channels.test.ts:113` 的 `void input` 仍在。C-103 仍 Open。 |
| 13 | **未重查（沿用 Round 2：FAIL / NOT PROVEN）** | 仍只有 `remainingSeconds` 纯函数与 `HttpInputChannel` 单测；`elapsed()` / `remainingSeconds()` 在 `src/` 无调用者，没有刷新 / 服务端起点集成证据。本轮无相关提交，未重查。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **FAIL**

四项中 SEC-5、AC-2 通过；AC-11 的终局部分通过但 stub 输入与 AI 投影证据不完整；**AC-6 没有任何提交的原文断言，AC-1 的泄漏断言仍空转**。此外 C-103 / AC-9 / AC-12 仍无生产调用者，AC-7 / AC-13 仍没有事件流 / 刷新集成锁（沿用前判）。因此不能以「四项已修」进入 `Reviewed`。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **SEC-5**：已修且反向锁有牙（P-R3-1），这是本轮最重要的正面变化。
- **TEST-1**：AC-1 与 AC-6 仍缺可打红的回归锁；AC-7 / AC-13 沿用前判。
- **DOC-1**：RFC §8.4 的 AC-1 仍写「9 个席位的投影里 `"role":` 只出现一次」（`:154`），§8.8 的 AC-6 写「断言原样进入事件流」（`:206`），RFCS v2.98 的变更行也写「玩家发言原文有断言」；三处都与仓库事实不符。§8.4 的 AC-8 还写「玩家发言原样进入事件流（`SPEECH` 事件）」（`:161`），但 `tests/server/channels.test.ts` 只断言 `chunks.length > 0` 与 seq，没有断言玩家发言文本或他人投影；AC-8 沿用 Round 1 的 PARTIAL，本轮未重查。§8.6 还留着「`HttpInputChannel` 超时时交出空文本」（`:182`），与当前 `setDraft` 实现相反。
- **ARCH-9 / 编排**：SEC-5 的按席位投影成立；但 `ctxFor` 只在 `DAY_SPEECH` 给 `'speak'`（`src/server/orchestrator.ts:123`），夜间 / 投票的 `pending` 仍是 `null`，AI 的 `legalTargets` 为空（P-R3-8）；`nextActor` 也没有覆盖 `NIGHT_HUNTER_SHOOT` / `DAY_HUNTER_SHOOT`，猎人开枪局会让 `runGame` 在 `seat === undefined` 处停下。
- **STYLE-2 / 命名**：未发现新问题。

#### 5.3 SECURITY — **PASS**

`ctxFor(observer)` 与 `project()` 的组合正确；P-R3-1 证明一旦退回玩家投影，SEC-5 用例会红。未发现新的输入 / 投影泄漏。P-R3-8 里脚本 AI 直接读 `registry.stateOf(record)` 是**测试代码**的行为，不是生产路径；但它掩盖了「AI 只能从投影拿信息」这一层的验证，应在测试里改成只用 `ctx`。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库、网络热路径或 N+1；`nextActor` 每次线性扫 9 个席位与少量事件，规模可忽略。`runGame` 每步一次投影，不构成实际瓶颈。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `tests/server/orchestrator.test.ts:46-68` 的用例名仍写「从开局推进到 FINISHED」，唯一断言是 `steps >= 0`（恒真），且 `decide` 恒返回 `undefined`；新的 `orchestrator-full.test.ts` 虽然补了真正的终局用例，但旧的误导性用例没有删 / 没改名。
- `runGame` 的 `output` 只 `flush()`，从不 `emit`（`src/server/orchestrator.ts:145`）；`SseOutputChannel` 的生产消费仍未发生。
- `nextActor` 缺 `NIGHT_HUNTER_SHOOT` / `DAY_HUNTER_SHOOT`；`seatToSpeak(state) ?? nextActor(state)` 遇到这两个阶段会 break，而不是问猎人开枪。
- `tests/server/channels.test.ts:113` 仍有 `void input`；`TEST-STRATEGY.md` 的 RFC-011 小节仍全部 `proposed`，计划文件 `tests/client/id-card.test.tsx` / `speech-input.test.tsx` / `tests/server/inject/current-speech.test.ts` 仍不存在，实际落地的测试文件没有登记（C-104）。
- `src/client/api.ts` 仍无测试、无 import；`SseOutputChannel` 的 `bus.publish` 行为仍无断言。

### 6. 非阻塞建议

1. **AC-6 回归锁（对应阻塞项 B-R3-1）**：在 `orchestrator.test.ts` 的 C-101 用例里，拿到玩家席位对应的 `SPEECH` 事件并断言 `payload.text === '我过关。'`；再补一个「输入返回 `skip` → 事件流是 `SPEECH_SKIPPED` 且阶段继续」的用例（同时覆盖 AC-7）。
2. **AC-1 结构检查（对应阻塞项 B-R3-2）**：递归扫描投影中所有键名匹配 `/role/i` 的值，断言除 `self.role` 外没有其他角色值；或至少同时断言没有 `roleId` / 其他角色的 `ROLE_LABELS`。保留 9 席位循环与 `ctx.self.seat` 断言。
3. **AC-11 证据**：换一个「玩家活到白天」的 seed / `playerSeat`（或在测试里预置玩家存活），让 `reads > 0`；把 `scriptFor` 改成只读 `ctx`（先给 `ctxFor` 按阶段填 `kill` / `check` / `witch` / `vote` / `shoot` 的 `pending`），不要用 `registry.stateOf(record)` 读引擎真值。否则「stub 通道跑完整局」只证明了引擎能跑，不证明通道能跑。
4. **猎人开枪**：给 `nextActor` 补 `NIGHT_HUNTER_SHOOT` / `DAY_HUNTER_SHOOT`，并在脚本里返回 `HUNTER_SHOOT`；否则「完整局」在猎人开枪局会停在中间。
5. **AC-2 状态变体**：补非空查验史、女巫 `used` / `available` 的具体值、猎人 `canShoot` 两态；这些是从 P-R3-4 之后剩下的非阻塞覆盖缺口。
6. **文档**：修正 RFC §8.4 的 AC-1 证据、§8.8 的 AC-6 声明、§8.6 的旧「超时交空文本」；同步 RFCS v2.98 的变更行与 `TEST-STRATEGY.md` 的 RFC-011 小节（C-104）。C-103 的生产接线若继续留到 RFC-012，请在 RFC §8.6 / RFCS 里写成**用户批准的顺延**，而不是继续把 AC-9 / AC-12 标 PASS。
7. **旧用例**：删除或重命名 `tests/server/orchestrator.test.ts:46-68` 的「从开局推进到 FINISHED」，它的 `steps >= 0` 不构成任何断言。
8. **README 状态行**：`README.md:11` 仍写「7 个 `Reviewed`、0 个 `Changes requested`、8 个 `Not started`」；RFC-011 改回 `Changes requested` 后该行已过期，下一次 docs 提交应改为 7 / 1 / 8（或按 RFCS 的 Status 列重新计数）。

### 7. 结论

**Overall Risk Level: High。**

用户列出的四项里，**SEC-5 与 AC-2 真修好了，AC-11 的终局锁也成立**；但 **AC-6 的「玩家发言原文有断言」不成立**（P-R3-6 / P-R3-7 全绿，提交根本没改 `orchestrator.test.ts`），**AC-1 的 `roleId` 泄漏探针仍绿**（P-R3-5），并且 **AC-11 的完整局没有消费 stub 通道、夜间 / 投票的 AI 上下文仍是空 `pending` / 空 `legalTargets`**。C-103（AC-9 / AC-12）在 RFCS 仍是 Open，生产路由仍直接 `registry.submit`。因此本轮仍是 **Changes requested**，不是 `Reviewed`。

**Blocking Issues**：

- **B-R3-1（AC-6 / TEST-1 / DOC-1）**：没有提交的「玩家发言原文进入事件流」断言；P-R3-6 让玩家轮恒 `SPEECH_SKIP`、P-R3-7 把文本换掉，`orchestrator.test` + `orchestrator-full.test` 仍 5/5 绿。RFC §8.8 / RFCS v2.98 的声明不成立。
- **B-R3-2（AC-1 / C-102）**：AC-1 仍只数 `"role":`；P-R3-5 在投影里加 `leakedRoles[].roleId` 后 22/22 绿，全员身份可通过另一个 key 泄漏。
- **B-R3-3（C-103 / AC-9 / AC-12，沿用前判、本轮未重查）**：`runGame` / `HttpInputChannel` / `SseOutputChannel` 在 `src/` 仍无生产调用者；生产 `POST /actions` 仍 `registry.submit`；`runGame` 只 `flush()`、不 `emit`。RFCS 仍标 Open；若要把接线留到 RFC-012，需按 `/manage-changes` 或用户明确批准记录，不能把 AC-9 / AC-12 标 PASS。

**Non-blocking**：AC-11 的 stub 输入 / `pending` 证据缺口；`nextActor` 缺猎人开枪阶段；AC-2 的状态变体（非空查验史 / 药水 used / `canShoot` 两态）；旧 `orchestrator.test` 的误导性用例；C-99（AC-3/4 已获用户批准顺延，但 RFC-012 / TEST-STRATEGY 仍未承接）；C-104（TEST-STRATEGY 回填）；RFC §8.6 旧描述。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r3-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），三个源码文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后（写评审文件前）`git status --porcelain` 为空，之后只改了 `RFCS.md` 与本评审文件，没有代码改动。
