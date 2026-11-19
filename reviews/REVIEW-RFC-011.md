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
