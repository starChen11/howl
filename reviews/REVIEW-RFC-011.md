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

## Round 4 — 2026-11-19

> 被评审提交：`e140209 fix(rfc-011): 玩家原文断言、AC-1 结构检查与通道接线（Round 3）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 **B-R3-1 / B-R3-2 / B-R3-3** 三项。AC-3 / AC-4 的用户批准顺延不重开；C-100 已 Closed、AC-10 / AC-14 不重查；AC-7 / AC-8 / AC-11 / AC-13 没有新提交，沿用前判并注明未重查。C-101 / C-106 仅在它们与 B-R3-3 的生产接线相交处引用，不重开。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `e140209`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client) · built in 74ms
✓ 46 modules transformed (server) · built in 17ms
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  620 passed (620)
   Duration  21.53s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

`pnpm selfplay` 仍以退出码 1 结束并提示 RFC-015，按 RFC-011 的范围记 **N/A**，不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 视野 / 跨 RFC 契约检查，以及 web app 的服务端输入校验检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；本轮不冒充已检查。

### 2. 用户列出的三项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **B-R3-1**：玩家原文断言这次真写进 `orchestrator.test.ts`，换成错误文本会红 | **PASS** | `tests/server/orchestrator.test.ts:184-191` 先按 `isPlayer` 找玩家席位，再找该席位的 `SPEECH`，断言 `payload.text === '我过关。'`；AI 的台词是 `我过了。`，两者不同，不会互相冒充。P-R4-1 把 `playerAction` 的 `text: input.text` 换成 `'错误文本'`，运行 `tests/server/orchestrator.test.ts` → **1 failed / 2 passed**，失败在 `:191` `expected '错误文本' to be '我过关。'`。P-R4-2 把玩家轮改成 `SPEECH_SKIP` → 仍 **1 failed / 2 passed**，失败在 `:190` `玩家没有发言`。两种退化都能打红。 |
| **B-R3-2**：AC-1 改成遍历五种角色值的结构检查 | **PASS（针对被点名的 `roleId` 泄漏）/ 有非阻塞残项** | `tests/server/id-card.test.ts:47-66` 在 9 席循环里把投影 `JSON.stringify` 后，对 `['wolf','seer','witch','hunter','villager']` 逐个检查：任何**非自己**的角色值出现就失败。P-R4-3 在 `project()` 返回的 `self` 上注入 `leakedRoles: [{ seat, roleId: role }]`（含全员真实身份），`tests/server/id-card.test.ts` → **1 failed / 6 passed**，失败在 `:65`，泄漏值 `['wolf','witch','hunter','villager']`；上一轮的 P-R3-5 退化现在有牙。残项：P-R4-4 注入的是中文 `roleLabel`（狼人 / 预言家 / …）时 **7/7 绿**——结构检查只认五种角色 id，不认角色名；另外 `otherRoles.has(role) || otherRoles.size > 0` 里的 `has` 永远不影响结果（9 席时 `size > 0` 恒真），`otherRoles` 是死代码。这两点是测试质量问题，不是对 `roleId` 泄漏的否定。 |
| **B-R3-3**：`ChannelRegistry` 接进 `buildApp`，POST 的发言交给挂起的 `HttpInputChannel`，新增 `POST /api/games/:id/input` 同步草稿；用例「先挂起 read 再 POST，断言收到玩家原话」成立，删掉接线会超时红 | **字面声明成立；生产回路仍不成立（C-103 仍 Open）** | 逐条见 §3：`buildApp` 确实构造 `ChannelRegistry`（`src/server/app.ts:40-41`）；`POST /actions` 确实先调 `channels.submit`（`src/server/routes/games.ts:157-160`）；`POST /input` 确实存在（`:104-118`）；新用例确实先 `forGame(gameId).input.read(...)` 再 POST（`tests/server/channels.test.ts:216-232`），删掉接线后该用例 **1 failed / 10 passed**，在 `:196` 以 5007ms 超时红（P-R4-5）。**但**：`ChannelRegistry.forGame` 与 `runGame` 在 `src/` 都没有调用者（`grep -rn "forGame\|runGame" src` 只命中定义：`src/server/channels/session.ts:27`、`src/server/orchestrator.ts:97`），所以生产里 `byGame` 永远为空，`channels.submit` / `setDraft` 都是 no-op；新用例自己调用 `forGame` 把通道塞进注册表，不能证明生产回路。更严重的是，路由在 `registry.submit` **之前**把文本交给通道：P-R4-6 在 `NIGHT_WOLF_CHAT` 提交 SPEECH，HTTP **200**，响应是一条 `REJECTED / PHASE_MISMATCH`，挂起的通道却已经收到 `{ kind: 'speak', text: '我先说' }`。P-R4-7 把 `runGame` 与真实路由接起来后，路由在 day 阶段写出 `SPEECH seq=15 ts=1`，`runGame` 用读之前捕获的旧 `state.seq` 再提交一次，最终记录里的同一条 `SPEECH seq=15 ts=1795072275205` 覆盖了路由写入——**双写 / 丢更新**。详见 §3 的 P-R4-6 / P-R4-7。 |

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r4-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前三个源码文件的 SHA-256：

```text
a671a65e...  src/server/orchestrator.ts
efddae1f...  src/server/project/index.ts
909a2402...  src/server/routes/games.ts
```

每次探针后都 `cp` 回备份并 `shasum -a 256 -c`；最后一次三个文件全部 `OK`。临时探针 `tests/server/__r4_probe.test.ts` / `__r4_race_probe.test.ts` 已删除；探针后（写评审文件前）全量 **75 files / 620 tests** 绿，`git status --porcelain` 为空；没有 `git commit`。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R4-1** | `orchestrator.ts` 的 `playerAction` 把 `text: input.text` 改成 `'错误文本'`（`speech` 同步改） | `tests/server/orchestrator.test.ts` | **1 failed / 2 passed**；`:191` 期望 `我过关。` 实得 `错误文本` | B-R3-1 的原文断言有牙 |
| **P-R4-2** | 同一处把 `SPEECH` 改成 `SPEECH_SKIP` | 同上 | **1 failed / 2 passed**；`:190` `玩家没有发言` | 不只锁文本，也锁「玩家确实发过言」 |
| **P-R4-3** | `project()` 的 `self` 增加 `leakedRoles: [{ seat, roleId: role }]`（全员真实身份） | `tests/server/id-card.test.ts` | **1 failed / 6 passed**；`:65` 泄漏 `['wolf','witch','hunter','villager']` | B-R3-2 对 `roleId` 泄漏有牙 |
| **P-R4-4** | `project()` 的 `self` 增加其他席位的中文 `roleLabel`（狼人 / 预言家 / 女巫 / 猎人 / 村民） | 同上 | **7/7 passed** | 结构检查只认五种角色 id，不认角色名（非阻塞残项） |
| **P-R4-5** | `routes/games.ts` 删掉 `channels.submit(...)` 三行 | `tests/server/channels.test.ts` | **1 failed / 10 passed**；`:196` 5007ms 超时 | 新用例确实是接线的回归锁；但锁的是「测试手工挂起的通道」 |
| **P-R4-6** | 真实 `buildApp`，创建对局后（`NIGHT_WOLF_CHAT`）先 `forGame(...).input.read()`，再 `POST /actions` 提交 `SPEECH` | 临时探针 | `ACTION_STATUS 200`，响应含 `REJECTED / PHASE_MISMATCH`；`PENDING { kind: 'speak', text: '我先说' }` | 被拒绝的动作仍然消费挂起输入；新用例的 `expect([200,409])` 正好放过了这种情形 |
| **P-R4-7** | 真实 `GameRegistry` 推到 `DAY_SPEECH`，启动 `runGame` 等玩家输入；由真实 `POST /actions` 兑现通道 | 临时集成探针 | 路由响应 `SPEECH seq=15 ts=1`；`runGame` 结束后最终记录 `SPEECH seq=15 ts=1795072275205`，`steps=8`、`status=active`，共 8 条 `SPEECH` | 路由与编排层**双写**；编排层用读之前的旧 `state.seq` 覆盖了路由写入（丢更新） |
| **P-R4-8** | 真实 `buildApp`；挂起 `read(timeoutMs:100)`，`POST /input` 传 `'字'.repeat(301)` | 临时探针 | `DRAFT_STATUS 200`；100ms 后 `pending` 为 `{ kind: 'timeout', text.length: 301 }` | 新草稿端点没有 300 字校验；超时会把它当发言交出 |

> P-R4-7 的 ts 差异是关键：路由响应里的 `SPEECH` 是 `ts=1`，最终记录里的同 seq 事件是 `Date.now()`（`playerAction` 的 `now()`），说明最终事件来自编排层的第二次提交，而不是路由的第一次写入。两份记录都基于 `seq=14`，后写覆盖前写。

### 4. 验收标准（本轮范围）

| AC | 判定 | 说明 |
|---|---|---|
| 1 | **PASS（P-R4-3 红）** | 9 席位循环 + 五种角色值结构检查 + `"role":` 计数 + `self.seat`；`leakedRoles[].roleId` 退化会红。残项见 P-R4-4（中文角色名；同角色他人按代码推断未覆盖，因为检查排除了 `role === ctx.self.role`）。 |
| 2 | **未重查（Round 3 PASS）** | 五角色扫描、`goal`、女巫药水、狼队友、猎人开枪文案的锁在 Round 3 已成立；本轮没有改身份卡实现或测试。 |
| 6 | **PASS（编排层回归锁）/ 生产草稿回路仍未闭环** | 玩家原文进入 `SPEECH.payload.text` 的断言在 P-R4-1 / P-R4-2 下会红；`speech.test.ts` 仍覆盖「超时交出草稿」。但 `POST /input` 没有 300 字校验（P-R4-8），且真实路由 + `runGame` 会双写（P-R4-7）；「倒计时归零 → 草稿完整进入事件流」没有生产级端到端用例。 |
| 9 | **静态 PASS（未重查）/ 生产调用者 FAIL** | `tests/security/channel-isolation.test.ts` 仍证明 `src/engine/` 不出现两个类型；但 AC-9 在 C-103 里的另一半「通道/编排有生产调用者」仍未成立：`forGame` / `runGame` 在 `src/` 无调用者，`SseOutputChannel` 无 `emit` 调用者（`src/server/orchestrator.ts:144-145` 只有 `flush`）。 |
| 12 | **FAIL（沿用 / C-103）** | 新用例没有新增通道实现，而是手工 `forGame` 后 POST；`ChannelRegistry.forGame` 在生产没有调用者。`SseOutputChannel` 的 `bus.publish` 仍无断言，`runGame` 仍不 `emit`。 |
| 3 / 4 | **未重查（用户批准的 D-5 顺延）** | 身份卡与输入框界面部件 / DOM 扫描仍归 RFC-012，不重开这项范围决定。 |
| 7 / 8 / 11 / 13 | **未重查（沿用 Round 2/3）** | 没有本轮提交；AC-7 仍缺「超时为空 → `SPEECH_SKIPPED` → 对局继续」的事件流锁，AC-8 仍缺玩家提交 → 他人投影的端到端，AC-11 仍有 stub 输入证据缺口（C-106），AC-13 仍只有纯函数 / 通道单测。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

B-R3-1 与 B-R3-2 真修好：P-R4-1 / P-R4-2 / P-R4-3 都会打红。B-R3-3 的字面接线成立，但**生产回路仍不成立**：`ChannelRegistry` 被构造出来后没有任何生产代码调用 `forGame`，`runGame` 仍只被测试调用，`SseOutputChannel` 仍不 `emit`；新用例自己把通道塞进注册表，因此只能证明「路由 → 已存在的 pending 通道」，不能证明「服务端跑一局时玩家输入会走通道」。真实路由 + `runGame` 还会双写（P-R4-7），所以不能把 AC-9 / AC-12 的 `Open` 改成 `Closed`。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **SEC-4**：新增 `POST /api/games/:id/input` 没有 `isWithinLimit` / Zod 校验（`src/server/routes/games.ts:104-118`）；`HttpInputChannel.setDraft` 原样保存（`src/server/channels/http.ts:62-63`），超时后 `normalizeInput` 原样交出（`:48-55`），编排层的 `playerAction` 原样写进 `SPEECH`（`src/server/orchestrator.ts:159-166`），绕开了路由在 `:141` 的 300 字校验。这不是重开 C-100，而是本轮新增端点新开的一个口；今天因为 `runGame` 没有生产调用者而不可达，接线后就是 AC-5 / SEC-4 的旁路。
- **TEST-1**：新用例 `expect([200, 409]).toContain(res.statusCode)`（`tests/server/channels.test.ts:230`）允许被拒绝的动作；P-R4-6 正是 200 + `REJECTED`，用例仍绿。没有断言「这个 SPEECH 进了事件流」，也没有让 `runGame` 参与。
- **DOC-1**：RFC §8.9（`:219`）写「`ChannelRegistry` 接进 `buildApp`」「反向探针会红」——这些字面成立；但它把「通道没有生产调用者」写成已解决，与 `grep` 事实不符。RFCS v2.100 的「POST 能兑现挂起输入」也只在这一条测试的意义上成立。建议在下一轮把「生产回路 / `forGame` 调用点」明确写成缺口，而不是继续当成已修。
- **ARCH-9 / SEC-5**：本轮没有削弱按席位投影；`runGame` 仍由测试驱动，未发现新的投影泄漏。

#### 5.3 SECURITY — **NEEDS WORK**

- 新草稿端点可写入 >300 字（P-R4-8），超时随后把它当发言；当前不可达只是因为 `runGame` 没有生产调用者，不是代码安全。
- `POST /actions` 先喂通道、后提交引擎（`src/server/routes/games.ts:157-167`）；P-R4-6 证明被拒绝的动作也会消费玩家输入，真实回路中会导致「玩家看到 200 / 输入被吃掉 / 事件流里却没有这句话」。
- 未发现新的投影 / 席位越权：`POST /input` 仍校验会话拥有该局，`POST /actions` 仍有席位校验。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库或网络热路径。`ChannelRegistry` 的 Map 没有释放 / 淘汰逻辑（一局一个 entry），属于长期运行的内存卫生问题，不是本轮性能阻塞；`runGame` 每步一次投影，规模可忽略。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `tests/server/id-card.test.ts:48-56` 为了拿 `otherRoles` 重新 `step` 了一局，但 `(otherRoles.has(role) || otherRoles.size > 0)` 里的前半永远不影响结果；这段是死代码，应该删掉或改成真正按 key 的递归扫描。
- 新用例的 `POST /input` 只断言 `200`（`tests/server/channels.test.ts:234-240`），没有断言草稿真的进了挂起通道 / 超时被用上；因此 `setDraft` 的接线没有回归锁。
- `ChannelRegistry.forGame` 无生产者、无清理；`SseOutputChannel` 无 `emit` 消费者；`runGame` 无生产入口。`src/server/channels/session.ts` 的注释说「不能放在 router 里临时 new」，但没有说明谁负责 `forGame`。
- `tests/server/channels.test.ts:113` 的 `void input` 仍在；虽然 `scriptedInput()` 后面确实调用了 `input.read`，这条语句仍会误导读者。

### 6. 非阻塞建议

1. **B-R3-1 / B-R3-2**：可以关闭 C-105 / C-102。若想再收紧 AC-1，把值扫描改成按键名递归（`/role/i`）并同时覆盖 `ROLE_LABELS`；同时补「其他席位与自己同角色」的定向用例。AC-2 的状态变体（非空查验史、药水 `used`、`canShoot` 两态）仍是 Round 3 的非阻塞缺口。
2. **B-R3-3 的正确接线**：先决定**单一写者**。若 `read()` 挂起，`POST /actions` 只把文本交给通道（返回 202「已接收」），由 `runGame` 在重新读取当前状态后提交；没有挂起时才由路由直接 `registry.submit`。或者反过来：路由提交成功后，把**已应用的事件 / 文本**交给通道，编排层不再提交。两种方案都要补一个真实 `runGame` + 真实路由的集成用例，而不是测试里手工 `forGame`。
3. **生产入口**：`buildApp` 只构造 `ChannelRegistry` 还不够；必须有一个生产路径在开局时调用 `forGame(gameId)` 并启动 `runGame`（或明确本轮只做层、把 C-103 的顺延写成用户批准的范围）。`SseOutputChannel` 需要至少一条 `bus.publish` 断言，`runGame` 也应在合适的回合 `emit`，而不是只 `flush`。
4. **草稿端点**：在 `/input` 用同一 `isWithinLimit` 判据（或 Zod schema）拒绝 >300 字，并在 `HttpInputChannel` / `playerAction` 再兜一层；补「301 字草稿 → 4xx / 不产出超长 SPEECH」的回归用例。草稿端点还应补「没有通道时返回 404 / 或 409」的语义，避免 200 假成功。
5. **新用例**：把 `expect([200,409])` 改成明确的成功路径（先把对局推到 `DAY_SPEECH`），并断言响应里/事件流里有该席位 `SPEECH.payload.text === '我先说'`；同时断言 `POST /input` 的草稿真的被超时使用。这样才能覆盖 AC-6 而不只是「通道被兑现」。
6. **文档**：RFCS v2.100 / RFC §8.9 的「生产调用者已解决」应改成「路由 → 通道已接，`forGame` / `runGame` 尚无生产入口」；README 的「7 Reviewed / 0 Changes requested」与 RFCS 现状不一致（本轮不代改）。

### 7. 结论

**Overall Risk Level: High。**

B-R3-1 和 B-R3-2 都真修好了：原文断言在换文本 / 换 `SPEECH_SKIP` 两种退化下都会红，`roleId` 泄漏探针也会红。B-R3-3 的字面接线成立（删掉会超时红），但**它仍不是生产回路**：`forGame` / `runGame` 在 `src/` 没有调用者，新用例自己挂起通道；真实路由 + `runGame` 会双写并丢更新（P-R4-7），被拒绝的动作也会消费挂起输入（P-R4-6）。此外，新草稿端点绕过了 300 字校验（P-R4-8）。因此 C-103 仍 Open，RFC-011 不能进入 `Reviewed`。

**Blocking Issues**：

- **B-R4-1（C-103 / AC-9 / AC-12，阻塞）**：生产侧仍没有 `ChannelRegistry.forGame` / `runGame` 的调用者；`ChannelRegistry` 的 Map 在 `src/` 永远不会被填充；新用例靠测试自己 `forGame`。`POST /actions` 在引擎提交之前把文本交给通道，P-R4-6 证明被 `REJECTED` 的动作也会消费输入；P-R4-7 证明真实路由 + `runGame` 对同一条发言双写，编排层用旧 `state.seq` 覆盖路由写入。`SseOutputChannel` 仍无 `emit` 消费者。**修法见 §6.2 / §6.3。**
- **B-R4-2（新路径的 SEC-4 / AC-5 旁路，阻塞）**：`POST /api/games/:id/input` 没有 `isWithinLimit` / Zod 校验，`setDraft` 与超时路径原样保存 / 交出 301 字；P-R4-8 实测 301 字草稿 200 + `{ kind: 'timeout', text.length: 301 }`。当前因 `runGame` 无生产入口而不可达，但 B-R4-1 一修就会变成真实的「超时自动提交超长发言」。**修法见 §6.4。**

**Non-blocking**：AC-1 只认角色 id，不认 `ROLE_LABELS` / 同角色他人（P-R4-4）；`otherRoles` 条件里的 `has` 是死代码；新用例的 `expect([200,409])` 与 `/input` 仅 200 的断言太弱；`ChannelRegistry` 无清理；AC-7 / AC-8 / AC-11 / AC-13 沿用前判；C-99 / C-104 未重查；README 状态行过期。

**状态**：RFC-011 → `Changes requested`（从 `Implemented` 回退）。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r4-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），三个源码文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后（写评审文件前）全量 **75 files / 620 tests** 绿、`git status --porcelain` 为空。

## Round 5 — 2026-11-19

> 被评审提交：`fd66de2 fix(rfc-011): 通知顺序与草稿校验；C-103 提请迁移（Round 4）` + `67f6b22 docs(rfc-011): 按 CR-010 裁决把生产入口迁到 RFC-012`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示复核 ① C-107（引擎接受后通知）与 C-108（草稿 300 字）是否真修；② `CHANGE-REQUEST-010` 的边界迁移是否落地一致；③ 其余 AC 是否有能打红的证据。AC-3 / AC-4 的界面顺延是**用户批准的偏离**，本轮不作为缺陷（C-99 的承接问题仍只在 RFCS 记非阻塞）。C-100 已 Closed；AC-10 / AC-14 本轮只复核静态锁仍成立。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `67f6b22`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 46 modules transformed (server) · dist/server/index.js 96.17 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  622 passed (622)
   Duration  24.21s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

`pnpm selfplay` 仍以退出码 1 结束并提示 RFC-015，按 RFC-011 的范围记 **N/A**，不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 视野 / 跨 RFC 契约检查，以及 web app 的服务端输入校验检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；本轮不冒充已检查。

### 2. 用户列出的三项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **C-107**：改成引擎接受之后才通知，夜间提交 `SPEECH` 被拒时不通知，补了用例 | **通知顺序：PASS；C-107 的另一半（单一写者 / 双写）：仍 FAIL** | `src/server/routes/games.ts:180-187` 确实在 `registry.submit`（`:166-171`）之后、且 `result.events` 不含 `REJECTED` 时调用 `channels.submit`。P-R5-1 把通知改回提交之前：`tests/server/channels.test.ts` **1 failed / 12 passed**（`:240` 收到 `{kind:'speak'}`）——负向锁有牙。**但** C-107 原文里的 P-R4-7 双写没有修：P-R5-7 用真实 `buildApp` + 真实路由 + `runGame`，路由接受后返回 `SPEECH seq=15 ts=1`，`runGame` 结束后 store 里同 seq 的事件变成 `ts=1795073117229`（`playerAction` 的 `Date.now()`）——路由的写入被编排层用读前的旧 `record` 覆盖。见 C-113。 |
| **C-108**：草稿接口补 300 字校验，补了用例 | **PASS（301 拒绝）/ 边界缺口非阻塞** | `src/server/routes/games.ts:114-122` 用同一个 `isWithinLimit` 拒绝 >300 字；P-R5-3 删掉这段后 `tests/server/channels.test.ts` **1 failed / 12 passed**（`:264`，`expected 200 to be 400`）。反向锁成立。未测「刚好 300 字草稿被接受」与「emoji 301 的路由级计数」，属非阻塞边界缺口。 |
| **C-103**：生产入口按 CR-010 裁决 A 迁到 RFC-012；RFC-011 只保证「通道接口 + 服务端兑现路径」；依赖表核对 | **RFC-011 侧：一致；迁移的接收侧：不一致（C-112）** | RFC-011 侧已落地：AC-9 改写（`RFCs/RFC-011...:97`）、边界说明（`:102`）、§8.6 把生产入口归 RFC-012（`:178-185`）、`RFCS.md:75` 的依赖表 `RFC-012 | 011 | 016` 正确、`RFCS.md` 变更历史有 v2.103 记录。**但** `RFCs/RFC-012...` 只在 `:4` 写了 `Depends on: RFC-011`，其交付物（`:64-75`）与 15 条 AC（`:84-100`）**没有任何一条**承接「整局循环的生产入口」；`CHANGE-REQUEST-010:81` 自己写着「RFC-012 的 AC 里必须有一条『整局能从一个入口跑完』」，`§4` 的落地清单却只改了 RFC-011 / RFCS / CR-010。`grep -n "runGame\|forGame\|入口\|整局" RFCs/RFC-012...` **零命中**；RFC-012 里只有 `:4` 的依赖行与 `:13` / `:33` 的「复用 RFC-011」描述。因此迁移是**单边**的：RFC-011 说「归 RFC-012」，RFC-012 没有接。 |

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r5-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前源码 SHA-256：

```text
a405a9e3...  src/server/routes/games.ts
a671a65e...  src/server/orchestrator.ts
4eebadb9...  src/server/channels/http.ts
109eed96...  src/server/channels/session.ts
efddae1f...  src/server/project/index.ts
f4f8a60e...  src/server/view/id-card.ts
f5b777b7...  src/server/channels/sse.ts
```

每次探针后都 `cp` 回备份并 `shasum -a 256 -c`；最后四项 `OK`，其余三文件与 Round 3/4 记录的哈希一致，`git status --porcelain` 为空。临时探针 `tests/server/__r5_probe.test.ts` 已删除；探针后（写评审文件前）全量 **75 files / 622 tests** 绿；没有 `git commit`。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R5-1** | `routes/games.ts` 把 `channels.submit` 改回 `registry.submit` **之前**（无条件） | `tests/server/channels.test.ts` | **1 failed / 12 passed**；`:240` 收到 `{ kind: 'speak', text: '我先说' }` | C-107 的「被拒绝不通知」有反向锁 |
| **P-R5-2** | 删掉接受分支的 `channels.submit` 整段 | **全量** `pnpm test` | **75 files / 622 tests 仍全绿** | AC-9「接受后通知」没有任何回归锁；旧的正向用例在 Round 4 已被替换成负向用例 |
| **P-R5-3** | 删掉 `/input` 的 `isWithinLimit` 校验 | `tests/server/channels.test.ts` | **1 failed / 12 passed**；`:264` | C-108 有反向锁 |
| **P-R5-4** | `playerAction` 的 `input.kind === 'skip'` 分支改成 `return { action: undefined }` | **全量** `pnpm test` | **75 / 622 仍全绿** | AC-7「空超时 → `SPEECH_SKIPPED` → 对局继续」没有回归锁 |
| **P-R5-5** | `playerAction` 把 `if (input.kind === 'skip')` 改成 `if (input.kind !== 'speak')`（超时被当弃权） | **全量** `pnpm test` | **75 / 622 仍全绿** | AC-6「超时交出已输入内容并完整进入事件流」没有回归锁 |
| **P-R5-6** | `project()` 返回值增加 `leakedRoles: [{ seat, roleId }]`（全员真实身份） | `tests/server/id-card.test.ts` + `project.test.ts` | **1 failed / 21 passed**；`:65` | AC-1 的 `roleId` 泄漏锁仍有效 |
| **P-R5-7** | 真实 `buildApp` + 真实 `GameRegistry` 推到 `DAY_SPEECH`，启动 `runGame` 等玩家输入；由真实 `POST /actions` 兑现通道 | 临时集成探针 | 路由 **200**，响应 `SPEECH seq=15 ts=1`；`runGame` 结束后同 seq `ts=1795073117229`（`Date.now()`），text 相同 | 路由与编排层**双写**；编排层用读前的旧 record 覆盖路由写入（C-113） |
| **P-R5-8** | `orchestrator-full.test.ts` 同样的整局（playerSeat 1 / seed 20261117），计数 `InputChannel.read` | 临时集成探针 | `status=finished`、`steps=40`、**`reads=0`** | AC-11 的完整局没有消费 stub 输入通道（C-106 仍未关） |
| **P-R5-9** | 玩家 wolf 推进到 `DAY_SPEECH`，`runGame` 的 input 返回 `{ kind: 'skip' }` | 临时集成探针 | `reads=1`、`skipped=1`、`SPEECH_SKIPPED seat=2`、随后 `phase=DAY_VOTE`、`steps=8` | AC-7 行为可成立，但仓库无此回归锁 |
| **P-R5-10** | 玩家提交 `SPEECH` 后，对另一席位 `project()` + `buildUserMessage` | 临时集成探针 | observer=3，`<public_utterance seat="2">玩家原话：我是好人</public_utterance>` 出现 | AC-8 行为可成立，但仓库无端到端用例 |
| **P-R5-11** | `project()` 的键集合检查 | 临时集成探针 | `["self","phase","day","aliveSeats","deadSeats","publicEvents","privateEvents","knowledge","legalTargets","pending"]`，无 `remaining` / `startedAt` | AC-13 没有服务端可见的「剩余时间」；`remainingSeconds` 在 `src/` 无调用者 |
| **P-R5-12** | `runGame` 的 input 返回 `{ kind: 'timeout', text: '超时草稿原话' }` | 临时集成探针 | 玩家席位的 `SPEECH.payload.text === '超时草稿原话'` | AC-6 行为可成立，但仓库无此回归锁 |
| **P-R5-13** | `id-card.ts` 的 `card.goal = goalOf(...)` 改成 `card.goal = ''` | `tests/server/id-card.test.ts` | **1 failed / 6 passed**（`:75-77`） | AC-2 的 `goal` 锁仍有效 |
| **P-R5-14** | `SseOutputChannel.emit` 改成空操作（直接 `return`） | **全量** `pnpm test` | **75 / 622 仍全绿** | 输出通道的 `done` / `delta` 映射没有任何回归锁（也没有生产调用者） |
| **P-R5-15** | 玩家轮到发言时挂起 `read()`，真实 `POST /actions` 提交合法 `SPEECH` | 临时集成探针 | 路由 **200**，挂起 Promise 收到 `{ kind: 'speak', text: '我先说' }` | 「接受后通知」的行为存在，但**只有行为、没有提交的锁**（对比 P-R5-2） |

### 4. 验收标准（本轮逐条）

| AC | 判定 | 说明 |
|---|---|---|
| 1 | **PASS（P-R5-6 红）** | 9 席位循环 + 五种角色值结构检查 + `"role":` 计数 + `self.seat`；`leakedRoles[].roleId` 退化会红。残项（非阻塞）：中文 `ROLE_LABELS` 与「其他席位同角色」仍未覆盖（沿用 Round 4 P-R4-4）；`otherRoles.has(role) || otherRoles.size > 0` 里的 `has` 是死代码。 |
| 2 | **PASS（P-R5-13 红）** | 五角色扫描、`goal`、女巫药水、狼队友、猎人开枪文案的锁成立。残项（非阻塞）：非空查验史、药水 `used`、`canShoot` 两态仍没有状态变体用例。 |
| 3 / 4 | **DEFERRED（用户批准 D-5）** | 身份卡与输入框界面部件 / DOM 扫描归 RFC-012；按用户指示不作为缺陷。RFC-012 的交付物仍没有承接（C-99 非阻塞）。 |
| 5 | **PASS（后端）/ 前端 deferred** | 路由 301 字 → 400 有锁（P-R2-A / `tests/server/speech.test.ts:32-59`）；草稿 301 → 400 有锁（P-R5-3）。边界缺口（非阻塞）：300 字接受、emoji 301 的路由级计数。 |
| 6 | **PARTIAL（行为成立，无可打红的回归锁）** | `speech.test.ts:61-68` 只证明通道超时返回 `{kind:'timeout'}`；P-R5-12 证明超时文本能进 `SPEECH`，但仓库没有这条断言；P-R5-5 把超时改成弃权，**全量 622 仍绿**。AC-6 的「完整进入事件流」没有被锁。 |
| 7 | **FAIL（无可打红的回归锁）** | `normalizeInput` 纯函数有单测；P-R5-9 证明「skip → `SPEECH_SKIPPED` → `DAY_VOTE`」行为成立，但 P-R5-4 把 skip 改成 `undefined` 后**全量 622 仍绿**。仓库没有任何编排层 / 事件流的 `SPEECH_SKIPPED` 用例。 |
| 8 | **PARTIAL（行为成立，无端到端用例）** | P-R5-10 证明玩家提交的原文出现在他人提示的 `<public_utterance seat="...">` 里；`tests/server/llm/prompts.test.ts:125` 锁的是手工构造的事件。TEST-STRATEGY 计划中的 `tests/server/inject/current-speech.test.ts` 仍不存在（C-104）。 |
| 9 | **PARTIAL / 回归锁 FAIL** | 静态半边成立：`tests/security/channel-isolation.test.ts:20-23` 断言 `src/engine` 不出现两个通道类型。负向半边成立（P-R5-1）。**接受半边没有锁**：P-R5-2 删掉 `channels.submit` 后全量 622 绿；**输出半边也没有锁**：P-R5-14 把 `SseOutputChannel.emit` 改成空操作后全量 622 绿。 |
| 10 | **PASS** | `tests/security/channel-isolation.test.ts:27-33` 断言 `src/client` 不 import `@engine/`、不出现 `reduce(`；Round 1 P-6 已证明该检查能打红。本轮无相关改动。 |
| 11 | **PARTIAL** | `tests/server/orchestrator-full.test.ts:23-49` 断言 `FINISHED` 与 seq 连续；Round 3 P-R3-2 已证明有牙。但 P-R5-8 实测整局 **`reads=0`**，stub 输入通道没有被消费（C-106 非阻塞）。 |
| 12 | **PARTIAL（非阻塞）** | `tests/server/channels.test.ts:85-193` 的 stub 是内联对象，不是新增 `ScriptedChannel` 文件；`:113` 的 `void input` 仍在。引擎 / shared 没有被修改这一点成立，但「新增实现不改 engine/shared」没有被独立证明。 |
| 13 | **FAIL / NOT PROVEN** | `remainingSeconds` 只有纯函数测试，`src/` 里没有调用者（`grep` 只命中 `src/server/speech.ts` 定义与测试）；`project()` 没有 `startedAt` / remaining 字段（P-R5-11）；没有「刷新后剩余时间不回满 / 超时仍按原起点」的集成用例。§8.4 却把它标成 PASS。 |
| 14 | **PASS** | `tests/security/channel-isolation.test.ts:37-40` 断言 `src/engine` 不 import `@server/` / `@client/`；本轮无相关改动。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

C-107 的通知顺序与 C-108 的草稿校验都真修好了（P-R5-1 / P-R5-3 会红）。迁移在 **RFC-011 侧**也一致：AC-9 已改写、§8.6 已把生产入口归 RFC-012、依赖表正确。但三件事让它还不能算「满足全部 AC」：① AC-9 新写的「接受后通知」没有任何提交的回归锁（P-R5-2 全量 622 绿），输出半边同样没有锁（P-R5-14）；② 路由 + `runGame` 仍双写，路由写入被编排层覆盖（P-R5-7），这是 C-107 原文里的 P-R4-7，不是「生产入口」迁移能顺带解决的；③ 迁移的**接收侧** RFC-012 没有对应 AC / 交付物（C-112）。AC-6 / AC-7 / AC-13 仍没有能打红的证据。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **TEST-1**：AC-6 的超时分支、AC-7 的弃权事件、AC-9 的「接受后通知」与 `SseOutputChannel.emit`、AC-13 的刷新语义都没有对应自动化测试；其中 P-R5-2 / P-R5-4 / P-R5-5 / P-R5-14 是**全量 622 绿**的退化。这不是「测试写得不够好」，而是这五条 AC 目前无法阻止回归。
- **DOC-1**：RFC §8.4 的 AC-9 证据只写 `channel-isolation.test.ts`，没有本轮新增的 `channels.test.ts` 负向用例，也没有「接受后通知」；AC-13 仍写 PASS，与仓库事实不符。RFCS.md 的 C-107 行写「已修复：引擎接受之后才通知通道；补用例」，但 C-107 原文里的双写没有被修、也没有在 §8.6 记录为移交项。评审开始时 RFCS.md 头部版本仍是 `v2.101`，变更历史已到 `v2.103`（本轮已把头部改为 v2.104，见 C-114）。
- **SEC-4**：`/input` 与 `/actions` 两条外部入口都过 300 字校验，C-108 的旁路已关；`SEC-5` / `ARCH-9` 本轮没有新的投影泄漏（`ctxFor(observer)` 未动）。
- **ARCH-1 / ARCH-9**：静态检查仍通过；本轮新增的通道逻辑都在 `src/server/`。

#### 5.3 SECURITY — **PASS**

- C-108 的 301 字草稿旁路已关（P-R5-3）。
- C-107 的「被拒绝的发言也消费挂起输入」已关（P-R5-1）。
- 未发现新的投影 / 席位越权：`POST /input` 仍校验会话拥有该局；`POST /actions` 仍有席位校验。
- 唯一的保留意见是双写会丢一条已接受的事件（数据完整性），它不是泄漏，但会在 RFC-012 的真实回路里表现为「客户端看到成功、后来刷新却看到另一个版本」——见 C-113。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库或网络热路径。`ChannelRegistry` 的 Map 仍没有释放 / 淘汰逻辑（一局一个 entry），属于长期运行的内存卫生问题，不是本轮性能阻塞；`runGame` 每步一次投影，规模可忽略。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- 正向用例的丢失：Round 4 把「POST 兑现挂起通道」的用例**替换**成「被拒绝不兑现」的用例，两者不是同一条断言；P-R5-2 证明正向分支现在没有锁。
- `tests/server/channels.test.ts:113` 的 `void input` 仍在；`tests/server/orchestrator.test.ts:46-68` 的用例名仍写「从开局推进到 FINISHED」，实际 `decide` 返回 `undefined`、断言仍是 `steps >= 0`（Round 1 C-101 的旧问题）。
- `tests/server/orchestrator-full.test.ts:37-41` 的脚本 AI 仍用 `registry.stateOf(record)` 读引擎真值来选目标，`ctx.legalTargets` 在夜间 / 投票为空；这是 C-106 的证据质量问题，本轮未修。
- TEST-STRATEGY 的 RFC-011 小节（`TEST-STRATEGY.md:318-328`）仍全部 `proposed`，计划文件 `tests/client/id-card.test.tsx` / `speech-input.test.tsx` / `tests/server/inject/current-speech.test.ts` / `tests/meta/dependency-direction.test.ts` 都不存在；实际落地的 `tests/server/{id-card,speech,channels,orchestrator}.test.ts` 与 `tests/security/channel-isolation.test.ts` 没有登记（C-104）。

### 6. 非阻塞建议

1. **单一写者（修 C-113）**：在 `runGame` 的 `playerAction` / `runGame` 层先决定谁写。推荐「路由提交 + 通知，`runGame` 读到 `{kind:'speak'|'timeout'}` 后**不再 submit**」，或「有挂起 `read` 时路由只返回 202，由 `runGame` 重新读取当前 record 后 submit」。补一个真实 `buildApp` + `runGame` 的集成用例，断言只产生一条 `SPEECH`（P-R5-7 的 ts 差异是现成的断言点）。
2. **AC-9 正向锁（修 C-109）**：把 Round 4 删掉的正向用例加回来，但先把对局推到 `DAY_SPEECH`（否则夜间会被 `REJECTED`），断言 `POST` 200 且挂起的 `read()` 收到玩家原文；对 `SseOutputChannel` 补 `bus.publish` 断言（`final` → `done`，非 final → `delta`）。
3. **AC-6 / AC-7 编排用例（修 C-110）**：在 `orchestrator` 层加两条——`input` 返回 `{kind:'skip'}` → 事件流出现 `SPEECH_SKIPPED` 且进入下一阶段；`input` 返回 `{kind:'timeout', text:'草稿'}` → `SPEECH.payload.text === '草稿'`。这样 P-R5-4 / P-R5-5 的退化才会打红。
4. **AC-13（修 C-111）**：二选一——在投影 / `GET /api/games/:id` 暴露服务端 `startedAt`（或 `remainingSeconds`）并补「刷新后剩余秒数不回满 / 超时仍按原起点」用例；或按用户批准的顺延把它正式交给 RFC-012（并在 §8.4 把 PASS 改成 NOT VERIFIED / DEFERRED）。目前 `remainingSeconds` 是孤儿函数。
5. **迁移接收侧（修 C-112）**：给 RFC-012 加一条 AC「整局能从一个入口跑完」与一个交付物（谁调用 `ChannelRegistry.forGame`、谁启动 `runGame`、谁负责 `SseOutputChannel` 的 `emit`），并在 `RFCS.md` 的 Round 5 记录里指到它；否则 CR-010 的「生产入口归 RFC-012」只存在于 RFC-011 的边界说明里。
6. **文档（修 C-114）**：RFC §8.4 的 AC-9 / AC-13 证据行、RFCS C-107 的「已修复」表述、RFCS 头部版本 `v2.101 → v2.104`、README 的「7 Reviewed / 0 Changes requested / 8 Not started」（实际 10 Reviewed / 1 Changes requested / 5 Not started）都是过期信息；C-104 的 TEST-STRATEGY 回填仍非阻塞。

### 7. 结论

**Overall Risk Level: High。**

C-107 与 C-108 的**指定部分**真修好了：P-R5-1 / P-R5-3 都会打红。CR-010 的迁移在 RFC-011 侧也确实是照裁决落地的：AC-9 已改写、§8.6 已移交、依赖表正确。但本轮不能给 `Reviewed`，原因是**证据**而不是「又一轮实现」：AC-9 新写的「接受后通知」被 P-R5-2 从全量 622 用例里整段删掉仍全绿；`SseOutputChannel.emit` 改成空操作（P-R5-14）也全绿；AC-6 / AC-7 的编排层退化（P-R5-5 / P-R5-4）同样全绿；AC-13 没有服务端可见的剩余时间；迁移的接收侧 RFC-012 没有对应 AC；并且 P-R5-7 复现了 C-107 原文里的双写。只要其中任何一条留在 Must AC 上，「每条 AC 都有能打红的证据」就不成立。

**Blocking Issues**：

- **B-R5-1（C-113 / AC-9 / C-107 后半，阻塞）**：真实路由接受 `SPEECH` 后 `runGame` 用读前的旧 record 再提交一次，同 seq 覆盖路由写入（P-R5-7：路由 `ts=1` → 最终 `ts=1795073117229`）。这是 C-107 原文里的 P-R4-7，不是「生产入口」迁移能顺带解决的；§8.6 / CR-010 也没有把它记为 RFC-012 的移交项。**必须在 RFC-011 决定单一写者，或由用户明确把它写成 RFC-012 的移交并补集成用例。**
- **B-R5-2（C-109 / AC-9，阻塞）**：AC-9 的「接受后通知」没有回归锁——P-R5-2 删掉接受分支的 `channels.submit` 后**全量 75/622 全绿**；旧的正向用例在 Round 4 被负向用例替换掉了。输出半边同样：P-R5-14 把 `SseOutputChannel.emit` 改成空操作后全量 622 绿。**补正向路由用例 + bus 断言。**
- **B-R5-3（C-110 / AC-6 / AC-7，阻塞）**：超时文本进入事件流、`skip` → `SPEECH_SKIPPED` 都没有编排层 / 事件流用例；P-R5-5 / P-R5-4 的退化全量 622 绿。**补两条用例。**
- **B-R5-4（C-111 / AC-13，阻塞）**：`remainingSeconds` 没有调用者，投影 / API 没有剩余时间字段（P-R5-11），§8.4 却写 PASS；**实现并测「刷新不回满」，或按用户批准的顺延正式移交 RFC-012 并把 §8.4 改成未验收。**
- **B-R5-5（C-112 / 迁移一致性，阻塞，文档）**：CR-010 要求 RFC-012 的 AC 里必须有一条「整局能从一个入口跑完」，但 RFC-012 的 15 条 AC 与交付物都没有承接；迁移目前只落在 RFC-011 的边界说明里。**给 RFC-012 补 AC / 交付物，并在 RFCS 的 Round 5 记录里互链。**

**Non-blocking**：AC-1 只认五种角色 id，不认 `ROLE_LABELS` / 同角色他人（P-R4-4）；`otherRoles` 条件里的 `has` 是死代码；AC-2 的状态变体（非空查验史 / 药水 `used` / `canShoot` 两态）；AC-5 的 300 / emoji 路由级边界；AC-8 的端到端用例（planned `current-speech.test.ts`）；AC-11 的 `reads=0`（C-106）；AC-12 的内联 stub 与 `void input`；`ChannelRegistry` 无清理；`/input` 在无通道时仍返回 200；C-99 / C-104 未重查；README / RFCS 头部版本过期。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r5-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），七个源码文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后（写评审文件前）全量 **75 files / 622 tests** 绿、`git status --porcelain` 为空。

## Round 6 — 2026-11-19

> 被评审提交：`30cf191 fix(rfc-011): 每轮重读、正向锁与 timer 端点（Round 5）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 **C-113 / C-109 / C-110 / C-111 / C-112** 五项。已关闭项（C-99 ~ C-108 的通过项、C-114 的非阻塞项、AC-1/2/3/4/5/8/10/11/12/14）不重查；本轮未重查项沿用前判。AC-3 / AC-4 的界面顺延是用户批准的 D-5，不作为缺陷。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `30cf191`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client) · built in 66ms
✓ 46 modules transformed (server) · built in 15ms
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  628 passed (628)
   Duration  22.62s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0

$ pnpm selfplay
pnpm selfplay 未实现（RFC-015）
SELFPLAY_EXIT=1
```

`pnpm selfplay` 的 exit 1 是 RFC-015 的占位，按 RFC-011 的范围记 **N/A**，不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 数据完整性检查，以及 web app 的服务端输入 / 路由检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；`tests/e2e/` 为空，e2e 也显式跳过。本轮不冒充已检查。

### 2. 用户列出的五项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **C-113**：`runGame` 每轮从存储重读记录，不再覆盖路由写入 | **FAIL（重读不在竞态窗口；新用例空转）** | 重读在 `src/server/orchestrator.ts:108-111`，发生在 `await playerAction(...)`（`:137`）**之前**；路由在 `await` 期间写入并通知（`src/server/routes/games.ts:190-211`），唤醒后 `registry.submit(session, record, ...)`（`:141`）仍用 `await` 前的 `record` / `state.seq`。P-R6-A 实测：路由响应 `SPEECH ts=1`，最终 store 里同一玩家 `SPEECH` 的 `ts=1_800_000_000_000`（注入的 `now`），路由写入被覆盖。新用例 `tests/server/orchestrator.test.ts:195-244` 没有路由写入：对局停在 `NIGHT_WOLF_CHAT`、`decide` 返回 `undefined`，`runGame` 在 `:139` 即 break，`input.read` 从未被调用；P-R6-6 删掉 `:108-111` 整段重读后该文件仍 **4/4 绿**。 |
| **C-109**：接受分支补了真实路由正向用例；`SseOutputChannel` 补了 delta/done 断言 | **PASS** | 正向路由用例 `tests/server/channels.test.ts:320-467`：先把对局推到 `DAY_SPEECH`、挂起 `read()`，再真实 `POST /actions`；断言 200、响应含 `SPEECH`、挂起 Promise 收到 `{kind:'speak', text:'我觉得 2 号像狼'}`。P-R6-1 删掉 `routes/games.ts:204-211` 的通知后该用例 **1 failed / 16 skipped（5008ms 超时）**。输出半边 `tests/server/channels.test.ts:295-307` 断言总线收到 `['delta','done']`；P-R6-2 把 `SseOutputChannel.emit` 改成空操作后 **1 failed**（`expected [] to equal ['delta','done']`）。负向用例（夜间被 `REJECTED` 不通知）仍在 `:195-265`。 |
| **C-110**：补了超时 / 弃权用例 | **FAIL（只测到通道层，没有编排层 / 事件流锁）** | 新增的 `tests/server/channels.test.ts:309-317` 与既有 `tests/server/speech.test.ts:61-67` 都只测 `HttpInputChannel` 的返回值；仓库没有一条 `runGame` / 事件流用例断言「超时文本进 `SPEECH.payload.text`」或「`skip` → `SPEECH_SKIPPED` → 进入下一阶段」。P-R6-3 把 `playerAction` 的 `skip` 分支改成 `{ action: undefined }` → **全量 75 files / 628 tests 绿**；P-R6-4 把 `if (input.kind === 'skip')` 改成 `if (input.kind !== 'speak')`（超时当弃权）→ **全量 628 绿**。仓库里唯一喂给 `runGame` 的 `{kind:'skip'}` 在 `tests/server/orchestrator.test.ts:225-230`，但该局停在 `NIGHT_WOLF_CHAT` 且 `decide` 返回 `undefined`，`input.read` 不会被调用。 |
| **C-111**：新增 `GET /api/games/:id/timer`，起点来自事件流 | **FAIL（端点存在，但行为与证据都不成立）** | 端点 `src/server/routes/games.ts:129-151`；唯一用例 `tests/server/speech.test.ts:71-96` 建一局**夜里**的对局（没有 `DAY_STARTED` / `SPEECH`），只断言 200、`remainingSeconds >= 0`、`phase` 非空；P-R6-5 把剩余秒数改成常量 `60` 后 **7/7 绿**。行为问题：① `:139-141` 只认 `DAY_STARTED` / `SPEECH`，**忽略 `SPEECH_SKIPPED`**；P-R6-B 用 120 秒前的 `DAY_STARTED` + 刚刚的 `SPEECH_SKIP`，端点返回 `startedAt=旧 ts`、`remainingSeconds=0`，而下一个发言者的 60 秒才刚开始。② 对已释放（`events: []`）的对局，`stateOf(record)` 直接 `throw`，端点返回 **500** 与内部错误「事件流为空：replay 至少需要一个 GAME_STARTED」（`GET /api/games/:id` 与 `POST /actions` 此时返回 410）。③ 起点取自事件 `ts`，而 `SPEECH` 的 `ts` 是客户端提交的（`src/shared/schemas.ts:21` 只要求非负整数），与 `HttpInputChannel` 的真实计时器（`src/server/channels/http.ts:43-58`）是两个来源；P-R6-C 里通道实际等了约 1.1 秒，端点返回 0。 |
| **C-112**：RFC-012 的验收标准补了「整局入口」与「不与 `POST /actions` 双写」两条 | **PASS（核心迁移落地；文档残项非阻塞）** | `RFCs/RFC-012-game-ui-onboarding-and-responsive.md:101`（整局入口）与 `:102`（不双写）已补；依赖 `:4` 仍是 RFC-011，`RFCS.md:76` 的 RFC-012 → RFC-011 行正确，C-112 行已互链。**非阻塞**：两条 AC 都编号 `15.`（`:100` / `:101`），交付物表 `:64-75` 没有 `forGame` / `runGame` / `SseOutputChannel` 的归属行；`TEST-STRATEGY.md:332-345` 没有整局入口 / 不双写的测试行（现有 `15` 只对应屏幕阅读器；C-104）；AC-16 括注的「编排层每轮重读记录」不是有效的单写者保证（C-113）。 |

**小结**：C-109 / C-112 关闭；C-110 / C-111 / C-113 仍阻塞。

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r6-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前的源码 SHA-256：

```text
1d29ec54a764132bbe41dd93ff120d3c0e558845d82a010279ee86e8711b7d49  src/server/orchestrator.ts
efb315299a46ac51272ce4aa156d0e13e99f5dbd473cc6beeb4cee39250e1c4a  src/server/routes/games.ts
f5b777b7b1f5fb0c2d82851c3eee83fadacdf28cceb2c92d5ec41e4a50ae1b1a  src/server/channels/sse.ts
```

每次探针后都 `cp` 回备份并用 `shasum -a 256 -c` / `diff -q` 验证；最后一次三个文件全部 `OK`。临时探针 `tests/server/__r6_probe.test.ts` / `__r6_timer_release.test.ts` / `__r6_timer_skip.test.ts` 已删除；探针恢复后（写评审文件前）全量 **75 files / 628 tests** 绿，`git status --porcelain` 为空，没有 `git commit`。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R6-1** | `routes/games.ts:204-211` 删除 `channels.submit` 整段 | `tests/server/channels.test.ts -t '白天提交 SPEECH'` | **1 failed / 16 skipped**；5008ms 超时 | C-109 的真实路由正向锁有牙 |
| **P-R6-2** | `SseOutputChannel.emit` 直接 `return`（空操作） | `tests/server/channels.test.ts -t 'SseOutputChannel'` | **1 failed**；`expected [] to equal ['delta','done']` | C-109 的输出通道锁有牙 |
| **P-R6-3** | `playerAction` 的 `skip` 分支返回 `{ action: undefined }` | 全量 `pnpm test` | **75 files / 628 tests 仍全绿** | C-110 的弃权分支没有回归锁 |
| **P-R6-4** | `if (input.kind === 'skip')` → `if (input.kind !== 'speak')`（超时被当弃权） | 全量 `pnpm test` | **75 / 628 仍全绿** | C-110 的超时分支没有回归锁 |
| **P-R6-5** | `GET /timer` 的 `remainingSeconds` 改成常量 `60` | `tests/server/speech.test.ts` | **7/7 绿** | C-111 的端到端用例没有牙 |
| **P-R6-6** | 删除 `orchestrator.ts:108-111` 的每轮重读 | `tests/server/orchestrator.test.ts` | **4/4 绿** | C-113 的提交用例没有牙（测试根本没有路由写入） |
| **P-R6-A** | 真实 `buildApp` + `GameRegistry` + `ChannelRegistry`，玩家在白天等输入；真实 `POST /actions` 提交 `SPEECH ts=1` | 临时集成探针 | 路由 **200**，响应 `SPEECH ts=1`；`runGame` 结束后同一玩家 `SPEECH` 的 `ts=1_800_000_000_000` | C-113 双写仍在：编排层用读前的旧 record 覆盖路由写入 |
| **P-R6-B** | `DAY_STARTED` 用 120 秒前的 ts，随后刚提交 `SPEECH_SKIP`，再 `GET /timer` | 临时集成探针 | `{"phase":"DAY_SPEECH","startedAt":1795074067231,"remainingSeconds":0}` | C-111 忽略 `SPEECH_SKIPPED`：下一个发言者刚开始就显示 0 秒 |
| **P-R6-C** | 服务端真实 `read({timeoutMs:60000})` 等 1.1 秒，再 `GET /timer` | 临时集成探针 | 通道实际剩约 59 秒；端点返回 `0` | 端点的起点来自事件 ts，不是通道计时器（夹具 ts=1 放大了差异，但两者确为两个来源） |
| **P-R6-D** | 先 `registry.release(gameId)`，再 `GET /timer` | 临时集成探针 | **500** `{"statusCode":500,...,"message":"事件流为空：replay 至少需要一个 GAME_STARTED"}` | C-111 新端点对已释放对局 500，`GET /api/games/:id` / `POST /actions` 为 410 |

### 4. 验收标准（本轮范围）

| AC | 判定 | 说明 |
|---|---|---|
| 6 | **FAIL** | 超时文本进入事件流的分支没有编排层 / 事件流用例；P-R6-4 把超时当弃权后全量 628 绿。 |
| 7 | **FAIL** | `skip` → `SPEECH_SKIPPED` → 对局继续没有编排层 / 事件流用例；P-R6-3 把 skip 改成 `undefined` 后全量 628 绿。 |
| 9 | **PASS** | 改写后的 AC 两半都有锁：P-R6-1（接受后通知）与 P-R6-2（输出通道）都会打红；静态断言与负向用例仍在。生产入口按 CR-010 归 RFC-012，不重开。 |
| 13 | **FAIL** | 端点存在，但用例不验证刷新 / 递减 / 起点；P-R6-5 常量 60 全绿；P-R6-B / P-R6-D 还暴露忽略 `SPEECH_SKIPPED` 与释放局 500。 |
| 3 / 4 | **DEFERRED（用户批准 D-5）** | 身份卡与输入框界面部件 / DOM 扫描归 RFC-012，不重开。 |
| 其余 AC | **未重查（沿用前判）** | AC-1 / 2 PASS，AC-5 PASS，AC-8 PARTIAL，AC-10 / 14 PASS，AC-11 PARTIAL，AC-12 PARTIAL；本轮无相关改动。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

C-109 与 C-112 的核心都成立：接受分支的正向锁与输出通道锁会打红，RFC-012 已有接收 AC。C-110 / C-111 / C-113 不成立：C-113 是数据完整性问题（真实路由写入被编排层覆盖），C-111 有「忽略 `SPEECH_SKIPPED`」「释放局 500」两个新缺陷，C-110 的回归锁仍只停在通道层。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **TEST-1**：C-110、C-111、C-113 都没有能在行为退化时变红的测试；P-R6-3 / P-R6-4 / P-R6-5 / P-R6-6 是**全量 628 绿**的退化。
- **DOC-1**：RFC §8.11（`RFCs/RFC-011...:245-249`）写「C-113 补用例断言编排层不会缩短或改写已有事件」「C-110 补超时/弃权用例」「C-111 补路由用例」——三处与仓库事实不符（C-113 的用例不做路由写入，C-110 只在通道层，C-111 只断言 200 / >=0）。`RFCS.md` 的 C-110 / C-111 / C-113 行写「已修复（Round 5）」，应改成按本轮证据的实际状态。
- **ARCH-9 / SEC-5**：本轮没有新的投影泄漏；`ctxFor(observer)` 未动；`src/client/` 的静态检查未动。
- **SEC-4**：C-108 的 301 字校验仍有效；本轮没有新增旁路。

#### 5.3 SECURITY — **PASS（附数据完整性保留）**

没有新的身份 / 投影泄漏或越权。C-113 是数据完整性（已接受事件被覆盖），不是保密性问题；C-111 的 500 会回显内部错误文本「事件流为空…」，不敏感，但应修掉。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库 / 网络热路径。`runGame` 每步多一次 `getGame` 是内存存储的线性读取，规模可忽略；而且它在竞态窗口之外，不能抵消 C-113。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `tests/server/orchestrator.test.ts:195-244` 的用例名 / 注释声称「路由先写入一条 SPEECH」，但测试里没有路由写入；`skip` 输入也从未被读取——这会误导下一轮评审。
- `tests/server/channels.test.ts:281-293` 的用例名写「接受分支」，实际直接调 `channels.submit`，与 `:267-277` 重复；真正的路由用例在 `:320-467`。
- `RFCs/RFC-012...:100-101` 有两个 `15.`；交付物与 `TEST-STRATEGY` 没有承接新的 AC-15 / AC-16。
- `tests/server/speech.test.ts:71-96` 的用例名「返回剩余秒数与起点」没有断言起点，也没有第二次读取。

### 6. 非阻塞建议

1. **C-113 的单写者（对应 B-R6-1）**：二选一。① 路由提交 + 通知，编排层读到 `{kind:'speak'|'timeout'}` 后发现该玩家已经发过言就不再 `submit`；② 有挂起 `read` 时路由只返回「已接收」（202），由 `runGame` 重新读取当前 record 后提交。无论哪条，补一个真实 `buildApp` + `runGame` 的集成用例，断言路由写入的 `ts` 仍在、只产生一条 `SPEECH`（P-R6-A 的 ts 差异就是现成断言点）。
2. **C-110 的两条编排用例（对应 B-R6-2）**：`input` 返回 `{kind:'skip'}` → 事件流出现 `SPEECH_SKIPPED` 且进入下一阶段；`input` 返回 `{kind:'timeout', text:'草稿'}` → 玩家席位 `SPEECH.payload.text === '草稿'`。放在 `orchestrator.test.ts`，不要再放通道层。
3. **C-111 的修正（对应 B-R6-3）**：把 `SPEECH_SKIPPED` 纳入起点查找（`routes/games.ts:139-141`）；对 `events.length === 0` 先返回 410；补「两次读取剩余秒数递减 / 刷新不回满」「跳过后的下一个发言者剩余约 60 秒」「释放局 410」三条用例；最好让端点直接消费 `HttpInputChannel` 的同一计时起点，而不是事件 `ts`。
4. **C-112 的文档残项**：把两个 `15.` 改成 `15.` / `16.`，在交付物表补一行「谁调用 `ChannelRegistry.forGame` / 谁启动 `runGame` / 输出通道归谁」，并在 `TEST-STRATEGY.md` 的 RFC-012 小节补 AC-15 / AC-16 的测试行。
5. **C-109 的收尾**：SSE 断言可以再把 `text` / `id` 一起锁上；删掉或重命名 `channels.test.ts:281-293` 的重复单测。
6. **文档**：`RFCs/RFC-011...:245-249` 与 `RFCS.md` 的「已修复」表述按本轮证据回写；`README` 的状态行（7 Reviewed / 0 Changes requested / 8 Not started）仍是过期信息（C-114 非阻塞，本轮未代改）。

### 7. 结论

**Overall Risk Level: High。**

五项里 **C-109 与 C-112 真修好**：接受分支的正向路由锁、输出通道的 `delta` / `done` 锁都会打红；RFC-012 也补上了两条接收 AC。**C-110 / C-111 / C-113 仍阻塞**：C-110 的新用例仍停在 `HttpInputChannel`，P-R6-3 / P-R6-4 证明编排层退化全量 628 绿；C-111 的端点虽然存在，但用例在常量 60 下仍绿，且忽略 `SPEECH_SKIPPED`、对已释放对局 500；C-113 的重读在 `await` 之前，P-R6-A 复现路由写入被覆盖，新增的「回归用例」甚至不做路由写入（P-R6-6 删掉重读仍 4/4 绿）。

**Blocking Issues**：

- **B-R6-1（C-113 / AC-9 / 数据完整性，阻塞）**：`runGame` 每轮重读发生在 `await playerAction` 之前；路由在等待期间写入的 `SPEECH` 仍被编排层用旧 `record` / `state.seq` 以同 `seq` 覆盖（P-R6-A：路由 `ts=1` → 最终 `ts=1_800_000_000_000`）。**先决定单一写者并补真实集成用例；同时修掉 `orchestrator.test.ts:195-244` 的空转用例。**
- **B-R6-2（C-110 / AC-6 / AC-7，阻塞）**：超时文本进事件流、`skip` → `SPEECH_SKIPPED` → 对局继续都没有编排层 / 事件流用例；P-R6-3 / P-R6-4 全量 628 绿。**在 `orchestrator.test.ts` 补两条。**
- **B-R6-3（C-111 / AC-13，阻塞）**：`GET /timer` 的用例只断言 200 / >=0，P-R6-5 常量 60 全绿；起点来自事件 `ts`（客户端可提供），忽略 `SPEECH_SKIPPED`（P-R6-B 下一个发言者显示 0 秒），并对已释放对局 500（P-R6-D）。**修起点 / 410，并补递减、跳过、释放三条用例。**

**Non-blocking**：C-112 的重复编号 `15.`、交付物 / TEST-STRATEGY 未补 AC-15/16；C-109 的重复通道单测与 SSE 只断言类型；RFC §8.11 / RFCS「已修复」表述；C-114 的 README 状态行（本轮未重查）。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r6-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），三个源码文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后（写评审文件前）全量 **75 files / 628 tests** 绿、`git status --porcelain` 为空。

## Round 7 — 2026-11-19

> 被评审提交：`023a641 fix(rfc-011): 提交前重读、skip/timeout 与 timer 用例（Round 6）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 **B-R6-1 / B-R6-2 / B-R6-3**（对应 C-113 / C-110 / C-111）。已关闭项（C-99 ~ C-109、C-112、C-114 及 AC-1/2/3/4/5/8/10/11/12/14）不重查；本轮未重查项沿用前判。AC-3 / AC-4 的界面顺延是用户批准的 D-5，不作为缺陷。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `023a641`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client) · built in 63ms
✓ 46 modules transformed (server) · built in 15ms
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  631 passed (631)
   Duration  21.72s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0

$ pnpm selfplay
pnpm selfplay 未实现（RFC-015）
SELFPLAY_EXIT=1
```

`pnpm selfplay` 的 exit 1 是 RFC-015 的占位，按 RFC-011 的范围记 **N/A**，不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 数据完整性检查、web app 的 HTTP 输入与路由检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；`tests/e2e/` 为空，e2e 也显式跳过。本轮不冒充已检查。

### 2. 用户列出的三项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **B-R6-1**：改成提交前重读（`latest = getGame()`，用最新 `seq` 提交），等待玩家输入期间路由写入的发言不再被覆盖 | **FAIL（覆盖确实修了，但单写者与回归锁仍不成立，且新增可见的 `REJECTED`）** | 正向 P-R7-1：真实 `buildApp` + `runGame`，玩家发言轮挂起后真实 `POST /actions` 提交 `SPEECH ts=1`；路由响应 200，最终事件里 `seq15 SPEECH ts=1 text='路由原话'` 仍在（未被覆盖）。但编排层唤醒后又对同一席位提交一次，引擎追加 **`seq16 REJECTED`（`NOT_YOUR_TURN`，`visibleTo: self:2`）**，玩家投影会收到这条拒绝。P-R7-2 去掉重读后，同一条事件的 `ts` 从 `1` 变成 `1_795_074_892_327`，说明修复本身有效。`tests/server/orchestrator.test.ts:195-244` 仍不做路由写入、`input.read` 未被调用；M-R7-1 删掉提交前重读后 **全量 75 files / 631 tests 仍全绿**。RFC §8.12 写「补『编排层不缩短/改写已有事件』用例」，与仓库不符。 |
| **B-R6-2**：补了编排层的两条用例（`skip` → `SPEECH_SKIPPED`；`timeout` 带文本 → 该文本的 `SPEECH`），反向探针都会红 | **PASS（事件锁）；附非阻塞残项与新的真实路径问题** | 两条用例在 `tests/server/orchestrator.test.ts:247-436`。M-R7-2（`skip` 分支改成 `{ action: undefined }`）→ **1 failed / 5 passed**，失败在 `:341`；M-R7-3（`input.kind !== 'speak'`，超时当弃权）→ **1 failed / 5 passed**，失败在 `:435`。用户声明的两条反向探针都成立。**残项**：skip 用例只断言事件出现，没有断言「对局继续」；M-R7-8 在提交 skip 后立即 `break`，该文件仍 **6/6 绿**。**新发现**：真实 HTTP 的 skip / 空输入路径没有接上通道，见 C-115。 |
| **B-R6-3**：timer 改看事件时间戳（含 `SPEECH_SKIPPED`）、释放局返回 410，并补「120 秒前的发言 → 剩余 0」用例（常量实现会红） | **FAIL（行为成立，测试证据不成立）** | 行为 P-R7-3 成立：`DAY_STARTED` 改成 30 秒前 → `30`，1.1 秒后 → `29`；提交 `SPEECH_SKIP` 后 → `60`，把该 skip 改成 120 秒前 → `0`；释放局 → **410**。但新用例 `tests/server/speech.test.ts:99-179` 在 `DAY_SPEECH` 时**没有任何 `SPEECH` / `SPEECH_SKIPPED` 事件**（实测事件到 `DAY_STARTED` / `PHASE_CHANGED` 为止），它靠 `DAY_STARTED.ts=1` 得到 0。M-R7-7 删掉 `SPEECH` 分支 → **8/8 绿**；M-R7-5 删掉 `SPEECH_SKIPPED` → **8/8 绿**；M-R7-6 删掉 410 → unit **68 files / 597 tests 全绿**；只有 M-R7-4 的常量 60 会红（**1 failed / 7 passed**，`:178`）。Round 6 要求的「递减 / 跳过 / 释放」三条用例仍不存在。 |

**小结**：B-R6-2 的两条事件锁通过；B-R6-1 的覆盖已修但仍有重复提交 / `REJECTED` / 无回归锁；B-R6-3 行为修了但测试没有覆盖它声明的场景。另新增 **C-115**（真实 HTTP skip / 空输入）。

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r7-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前的源码 SHA-256：

```text
b19f8781c6bfca771414e7fccee983a71cfc62c55929342bfe2c621d6fa6d676  src/server/orchestrator.ts
ba9674921392d792960e6b4799b74bd4a092b328f49c7214e61f584f7ca08b83  src/server/routes/games.ts
```

每次探针后都 `cp` 回备份并用 `shasum -a 256 -c` 验证；最后一次两个文件全部 `OK`。临时探针 `tests/server/__r7_probe.test.ts` / `__r7_skip_route.test.ts` 已删除；探针恢复后（写评审文件前）全量 **75 files / 631 tests** 绿，`git status --porcelain` 为空，没有 `git commit`。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R7-1** | 真实 `buildApp` + `GameRegistry` + `ChannelRegistry`，`runGame` 等玩家输入；真实 `POST /actions` 提交 `SPEECH ts=1 text='路由原话'` | 临时集成探针 | 路由 **200**；最终 `seq15 SPEECH ts=1` 保留；`seq16 REJECTED NOT_YOUR_TURN`（`self:2`）；`steps=8` | 覆盖已修；但编排层重复提交，玩家会收到一条拒绝 |
| **P-R7-2** | 在 P-R7-1 基础上去掉提交前重读 | 临时集成探针 | 路由响应 `ts=1`，最终同一事件 `ts=1_795_074_892_327` | 修复前会覆盖路由写入（C-113 原缺陷） |
| **P-R7-3** | 真实 `GET /timer`；分别构造 30 秒前的 `DAY_STARTED`、刚提交的 `SPEECH_SKIP`、120 秒前的 `SPEECH_SKIP`、已释放对局 | 临时集成探针 | `30 → 29`；skip 后 `60`；旧 skip `0`；释放 **410** | 行为层面 B-R6-3 的四处修复都成立 |
| **P-R7-4** | 挂起 `HttpInputChannel.read()` 后 `POST SPEECH_SKIP`；另起一局 `POST SPEECH text=''` | 临时集成探针 | skip：200 + `SPEECH_SKIPPED seq15`，200ms 后挂起 Promise 仍 **未兑现**；空文本：200 + `SPEECH{text:""}`，通道侧得到 `{kind:'skip'}` | **C-115**：真实 skip 不能唤醒编排层；空输入被写成空发言 |
| **M-R7-1** | 删除 `orchestrator.ts:141-149` 的提交前重读 | 全量 `pnpm test` | **75 files / 631 tests 全绿** | C-113 的回归用例没有牙 |
| **M-R7-2** | `skip` 分支返回 `{ action: undefined }` | `tests/server/orchestrator.test.ts` | **1 failed / 5 passed**（`:341`） | B-R6-2 的 skip 锁有牙 |
| **M-R7-3** | `if (input.kind === 'skip')` → `if (input.kind !== 'speak')` | 同上 | **1 failed / 5 passed**（`:435`） | B-R6-2 的 timeout 锁有牙 |
| **M-R7-4** | `GET /timer` 的 `remainingSeconds` 改成常量 `60` | `tests/server/speech.test.ts` | **1 failed / 7 passed**（`:178`） | 常量实现会红（用户声明的这一半成立） |
| **M-R7-5** | 起点查找删掉 `SPEECH_SKIPPED` | 同上 | **8/8 绿** | `SPEECH_SKIPPED` 分支没有锁 |
| **M-R7-6** | 删掉 `events.length === 0 → 410` | `--project unit` | **68 files / 597 tests 全绿** | 释放局 410 没有锁 |
| **M-R7-7** | 起点查找删掉 `SPEECH`（只留 `DAY_STARTED` / `SPEECH_SKIPPED`） | `tests/server/speech.test.ts` | **8/8 绿** | 「120 秒前的发言」用例根本没有依赖 `SPEECH`；它靠 `DAY_STARTED.ts=1` |
| **M-R7-8** | `runGame` 在提交 `SPEECH_SKIP` 后立即 `break` | `tests/server/orchestrator.test.ts` | **6/6 绿** | skip 用例没有断言「对局继续」 |

### 4. 验收标准（本轮范围）

| AC | 判定 | 说明 |
|---|---|---|
| 6 | **PARTIAL** | `timeout` 文本进 `SPEECH` 有编排层用例，M-R7-3 会红；但真实 HTTP 的空输入被写成空 `SPEECH`（C-115），不是弃权。 |
| 7 | **PARTIAL** | `skip` → `SPEECH_SKIPPED` 的编排层用例成立，M-R7-2 会红；但没有断言「对局继续」（M-R7-8 绿），真实 HTTP 的 `SPEECH_SKIP` 不能兑现挂起通道（C-115）。 |
| 9 | **PARTIAL** | 已关闭的「接受后通知」锁本轮未重查；但 B-R6-1 的重复提交会追加玩家可见的 `REJECTED`，`SPEECH_SKIP` 被接受时又不通知通道。 |
| 13 | **FAIL（证据）** | 行为已修（P-R7-3：30→29 / skip 后 60 / 旧 skip 0 / 释放 410），但提交的用例没有 `SPEECH` 事件，删 `SPEECH`、`SPEECH_SKIPPED`、410 都全绿；Round 6 要求的递减 / 跳过 / 释放三条用例缺失。 |
| 3 / 4 | **DEFERRED（用户批准 D-5）** | 身份卡与输入框界面部件 / DOM 扫描归 RFC-012，不重开。 |
| 其余 AC | **未重查（沿用前判）** | AC-1 / 2 PASS，AC-5 PASS，AC-8 PARTIAL，AC-10 / 14 PASS，AC-11 PARTIAL，AC-12 PARTIAL；本轮无相关改动。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

B-R6-2 的两条编排证据成立；B-R6-3 的行为也成立。但 B-R6-1 仍不是单写者：路由已接受并通知，编排层又提交一次，`REJECTED` 进入玩家投影；B-R6-3 的测试没有验证它声称的「120 秒前的发言」，删掉 `SPEECH` 分支仍全绿；C-115 说明真实 HTTP 的 skip / 空输入与 RFC §2.2 不一致。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **TEST-1**：C-113 无回归锁（M-R7-1 全量 631 绿）；C-111 的 `SPEECH` / `SPEECH_SKIPPED` / 410 都无锁（M-R7-5 / M-R7-6 / M-R7-7）；C-115 无路由级用例。
- **DOC-1**：RFC §8.12 的 B-R6-1 行声称补了用例，实际 `tests/server/orchestrator.test.ts:195-244` 未改且空转；B-R6-3 行把「120 秒前的发言」写成已测，实际用例没有发言事件。RFCS 的 C-110 / C-111 / C-113 旧行也仍写着与本轮不符的「已修复」。
- **SEC-4**：`SPEECH` 的 300 字校验仍有效（未重查 C-100 / C-108）；但空文本 / `SPEECH_SKIP` 是同一输入面的新旁路，见 C-115。
- **ARCH-9 / SEC-5**：本轮没有新的投影泄漏；`ctxFor(observer)` 未动；`src/client/` 的静态检查未动。

#### 5.3 SECURITY — **PASS（附数据完整性保留）**

没有新的身份 / 投影泄漏或越权。C-113 的 `REJECTED` 是玩家自己的私有事件，不构成泄密，但它是数据完整性 / 体验问题；C-115 是输入语义问题，不是授权问题。计时端点仍使用客户端可提交的事件 `ts`（`src/shared/schemas.ts:21` 只要求非负整数），正常客户端下不影响服务端超时，但「倒计时以服务端为准」的显示面仍可被客户端时间影响；这是 C-111 的非阻塞残项。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库 / 网络热路径。`GET /timer` 仍是内存事件流线性扫描；`runGame` 提交前多一次 `getGame`，规模可忽略。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `tests/server/orchestrator.test.ts:195-244` 的用例名 / 注释声称「路由先写入一条 SPEECH」，实际没有路由写入，`input.read` 也不会被调用；这会误导下一轮评审。
- `tests/server/speech.test.ts:99-179` 的用例名 / 注释声称「一条很旧的发言」，实际没有发言事件；它依赖夜间动作的 `ts=1`，属误报风险的测试。
- `tests/server/speech.test.ts:104,113` 导入 `project` 后 `void project`，没有用处；新加的两个编排用例复制了约 100 行夜间推进代码，建议提取测试 helper。
- `RFCs/RFC-011...:255-265` 的 §8.12 与 RFCS 的旧 C 行需要按本轮证据回写；`TEST-STRATEGY.md:318-328` 仍全部 `proposed`（C-104，非阻塞）。

### 6. 非阻塞建议

1. **B-R6-1 的单写者**：路由已提交并通知后，编排层读到 `{kind:'speak'|'timeout'}` 时先比较 `latest` 与等待前 `state.seq`；若路由已写入同一席位的 `SPEECH` / `SPEECH_SKIPPED`，直接用 `latest` 继续，不再 `submit`。或走另一条：路由只回「已接收」，由 `runGame` 重读后提交。补真实 `buildApp` + `runGame` 集成用例，断言路由 `ts` 仍在、只产生一条 `SPEECH`、没有 `REJECTED`。
2. **B-R6-3 的测试**：在 `DAY_SPEECH` 真正提交一条 `SPEECH`（或 `SPEECH_SKIP`）并把它的 `ts` 改成 120 秒前；补「两次读取递减 / 刷新不回满」「跳过后的下一位约 60 秒」「释放局 410」三条。不要只改 `DAY_STARTED` 的 ts。
3. **B-R6-2 的补强**：skip 用例追加「`SPEECH_SKIPPED` 之后还有下一位的 `SPEECH` / 离开 `DAY_SPEECH`」断言，让 M-R7-8 这类退化变红。
4. **C-115**：在路由接受 `SPEECH_SKIP` 后兑现挂起通道（可给 `HttpInputChannel` 增加 `skip()`，或复用 `submit('')`）；空 / 纯空白 `SPEECH` 转成 `SPEECH_SKIP`（或 400），并补路由 + `runGame` 用例。
5. **C-111 的计时源**：若还要保留「服务端为准」，让端点消费 `HttpInputChannel` 的同一计时起点，而不是客户端可提交的 `SPEECH.ts`；至少把这一点写进 RFC 的已知缺口。
6. **文档**：修正 RFC §8.12 与 RFCS 的「已修复」表述；同步 README 的状态行（当前仍写 7 Reviewed / 0 Changes requested / 8 Not started，C-114 非阻塞）。

### 7. 结论

**Overall Risk Level: High。**

三项里 **B-R6-2 的事件锁真的修好**：skip / timeout 两条编排用例存在，M-R7-2 / M-R7-3 都会打红。**B-R6-1 只修了「覆盖」**：路由写入不再丢，但编排层对同一席位重复提交，产生玩家可见的 `REJECTED`；C-113 用例仍空转，删掉重读全量 631 绿。**B-R6-3 的行为修了，测试没修**：新用例里根本没有发言事件，删 `SPEECH` / `SPEECH_SKIPPED` / 410 全绿，只有常量 60 会红。另发现 **C-115**：真实 HTTP 的 `SPEECH_SKIP` 不兑现挂起通道，空 `SPEECH` 被写成空发言。

**Blocking Issues**：

- **B-R7-1（C-113 / AC-9 / 数据完整性，阻塞）**：提交前重读保住了路由写入，但编排层仍对同一席位重复提交，引擎追加 `REJECTED`（P-R7-1：`seq16 NOT_YOUR_TURN`，`self:2`）；C-113 的用例不做路由写入（M-R7-1 全量 631 绿）。**改成单写者，并补真实路由 + `runGame` 的集成用例。**
- **B-R7-2（C-111 / AC-13，阻塞）**：行为已修（P-R7-3），但 `tests/server/speech.test.ts:99-179` 没有创建 `SPEECH` / `SPEECH_SKIPPED`，靠 `DAY_STARTED.ts=1` 通过；M-R7-5 / M-R7-6 / M-R7-7 全绿。**按 Round 6 要求补递减 / 跳过 / 释放三条用例。**
- **B-R7-3（C-115 / AC-6 / AC-7 / AC-9，阻塞，新）**：`POST SPEECH_SKIP` 已写 `SPEECH_SKIPPED` 但不兑现挂起通道（P-R7-4）；空文本 `SPEECH` 被写成 `SPEECH{text:""}`，与 §2.2「空输入 = 弃权」相反。**接上 skip 通知与空输入归一，并补路由级用例。**

**Non-blocking**：B-R6-2 的 skip 用例未断言「对局继续」（M-R7-8 绿）；计时端点仍用客户端可提交的事件 `ts`；RFC §8.12 / RFCS 旧 C 行的文档漂移；两个新测试复制夜间推进代码；`TEST-STRATEGY` 的 RFC-011 小节仍全部 `proposed`（C-104）。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r7-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），两个源码文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后（写评审文件前）全量 **75 files / 631 tests** 绿、`git status --porcelain` 为空。

---

## Round 8 — 2026-11-19

> 被评审提交：`9ef46bb fix(rfc-011): 弃权接通道、空输入拒绝、重复提交跳过（Round 7）`
> 评审方式：全新上下文的 subagent，只读仓库文件后实跑；本会话没有写过 RFC-011 的实现代码。
> 结论：**Changes requested**
> 范围：按用户指示只复核 **B-R7-1 / B-R7-2 / B-R7-3（C-113 / C-111 / C-115）**。已关闭项（C-99 ~ C-110、C-112）与非阻塞文档项 C-114 本轮不重查；AC-1 / 2 / 5 / 8 / 10 / 11 / 12 / 14 本轮无相关改动，沿用前判（其中 AC-8 / 11 / 12 此前为 PARTIAL）。AC-3 / AC-4 的界面顺延是用户批准的 D-5，不作为缺陷。

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · 评审开始时 HEAD `9ef46bb`，工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
✓ 14 modules transformed (client) · ✓ 46 modules transformed (server)
BUILD_EXIT=0

$ pnpm test
 Test Files  75 passed (75)
      Tests  637 passed (637)
   Duration  21.64s
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0

$ pnpm selfplay
pnpm selfplay 未实现（RFC-015）
SELFPLAY_EXIT=1
```

`pnpm selfplay` 的 exit 1 是 RFC-015 的占位，按 RFC-011 的范围记 **N/A**，不是本轮回归。

### 1. 产品类型与跳过项

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。本轮采用 game 的状态机 / 数据完整性检查、web app 的 HTTP 输入与路由检查。UI、无障碍与响应式检查随 AC-3 / AC-4 顺延到 RFC-012，**显式跳过**；`tests/e2e/` 为空，e2e 也显式跳过。本轮不冒充已检查。

### 2. 用户列出的三项逐条复核

| 用户声明 | 判定 | 一手证据 |
|---|---|---|
| **B-R7-1**：重读后先看「该谁行动」，已换人就 `continue`，不再重复提交产生 `REJECTED` | **FAIL（只修好了「下一位换人」的常见路径；最后一位发言时仍重复提交）** | 正向 P-R8-A 成立：真实 `buildApp` + `runGame`，玩家 1 号是当天第一位发言者，路由写入 `SPEECH ts=1` 后编排层 `continue`，最终事件里只有一条 `SPEECH{seat:1,text:'路由原话',ts:1}`，没有 `REJECTED`。但 P-R8-B / P-R8-C 反向：玩家 1 号是当天**最后一位**发言者时，路由写入的发言让相位从 `DAY_SPEECH` 变成 `DAY_VOTE`，而投票的第一位行动者仍是 1 号；`orchestrator.ts:147` 的 `(seatToSpeak(latestState) ?? nextActor(latestState)) === seat` 因此仍为 `true`，编排层把同一动作再提交一次，引擎追加 `REJECTED / PHASE_MISMATCH`（`visibleTo: self:1`）。P-R8-B `seq24`、P-R8-C `seq24` 都是玩家可见的拒绝。M-R8-1 删掉整段守卫后**全量 75 files / 637 tests 仍全绿**，说明这条修复没有回归锁。 |
| **B-R7-2**：timer 用例重写成四种真实起点（刚刚的 `SPEECH` / 120 秒前 / `SPEECH_SKIPPED` / 已释放 410），删任一分支都会红 | **PARTIAL（用户列出的四类都打红；但 `DAY_STARTED` 起点与「两次读取递减」仍没有锁）** | M-R8-A 删 `SPEECH` → **1 failed / 11 passed**（`speech.test.ts:223`）；M-R8-B 删 `SPEECH_SKIPPED` → **1 failed / 11 passed**（`:235`）；M-R8-C 删 410 → **1 failed / 11 passed**（`:251`）；M-R8-D 常量 60 → **2 failed / 10 passed**（`:100` / `:230`）。用户声明的四类确实都有牙。**但 M-R8-E 删掉 `DAY_STARTED` 分支后 12/12 全绿**：旧的「一条很旧的发言…」（`:100`）在 `DAY_SPEECH` 时仍没有 `SPEECH` / `SPEECH_SKIPPED` 事件，它靠 `startEvent === undefined → 0` 也能通过；新用例只注入 `SPEECH` / `SPEECH_SKIPPED`，没有 `DAY_STARTED`。Round 6 要求的「两次读取递减」也仍不存在。行为本身是对的：P-R8-D 用真实白天记录把 `DAY_STARTED.ts` 改成 30 秒前 → `30`，1.1 秒后 → `29`；改成刚刚 → `60`，`phase=DAY_SPEECH`。 |
| **B-R7-3 / C-115**：`POST SPEECH_SKIP` 兑现挂起通道；空文本 `SPEECH` 返回 400 要求弃权 | **PASS（行为与提交的锁都成立；附测试鉴别力问题）** | 行为：`src/server/routes/games.ts:241-243` 在引擎接受后 `channels.submit(record.gameId, '')`；`HttpInputChannel.submit('')` 归一为 `{kind:'skip'}`。提交的用例 `tests/server/channels.test.ts:470-607` 真正挂起 `read()` 再走路由，断言 200 与 `{kind:'skip'}`。M-R8-F 删掉 skip 通知 → 该用例 **1 failed（5012ms 超时）**；M-R8-G 删掉空文本 400 → **1 failed（expected 200 to be 400）**。空文本检查在 `games.ts:191-202`，先于引擎与席位校验，`'   '` 也被拒。**保留**：M-R8-H 在删掉 skip 通知的同时把 vitest 超时改成 8 秒，该用例 **1 passed（5094ms）**——通道自己的 5 秒超时空草稿也会归一成 `{kind:'skip'}`，所以这条断言只靠「测试超时 = 读取超时」勉强打红，不能证明「路由**及时**兑现」。属非阻塞测试质量问题，见 §6。 |

**小结**：C-115 的行为与锁成立；B-R7-2 的四类声明成立，但 `DAY_STARTED` / 递减证据仍缺；B-R7-1 在最常见的「换下一位」路径成立，在「玩家是最后一位发言者且投票第一个行动」的路径仍会产生玩家可见的 `REJECTED`，且没有回归锁。

### 3. 变异探针与临时集成探针

所有探针从 `/tmp/howl-rfc011-r8-probes/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。探针前的源码 / 测试 SHA-256：

```text
8367b501052f80fe871e0b1e606d05119b09f68f3276d4229dbd394594290007  src/server/orchestrator.ts
d5711265d1f7bd5f35a12878ea3bb6482aa9189e64d441a0c5853c99351ef0a2  src/server/routes/games.ts
b0f9a1428e489b9562b3c9ab666f271dbfec08dd041ec9fd382696edcdbb6aa3  src/server/speech.ts
604321e93f8b44705b4bfb8253860da78b048aef977aeda18093956104bd5efd  tests/server/speech.test.ts
8eca97d6b8a9f74f4cf8809d646de400514602561df080dcd1b92d9ac432a63e  tests/server/channels.test.ts
14ec30aea8c224dd293cdc54cb4d23f59eb90ec41e02ce739c6e7897d092a4ee  tests/server/orchestrator.test.ts
```

每次探针后都 `cp` 回备份并用 `shasum -a 256 -c` 验证；最后一次六个文件全部 `OK`。临时探针 `tests/server/__r8_probe.test.ts` / `__r8_probe_explore.test.ts` / `__r8_timer_probe.test.ts` 已删除；探针恢复后（写评审文件前）全量 **75 files / 637 tests** 绿，`git status --porcelain` 为空，没有 `git commit`。

| 探针 | 注入 / 场景 | 定向测试 | 结果 | 证明 |
|---|---|---|---|---|
| **P-R8-A** | 真实 `buildApp` + `GameRegistry` + `ChannelRegistry` + `runGame`，seed 2、玩家 1 号、`speechStartSeat=1`；路由 `POST SPEECH ts=1` | 临时集成探针 | 路由 **200**；`seq15 SPEECH{seat:1,text:'路由原话',ts:1}` 保留；后续 AI 发言 `seq16-22`；**没有 `REJECTED`** | B-R7-1 的常见路径成立 |
| **P-R8-B** | 同上，seed 4、狼刀 2 → `speechStartSeat=3`，存活 `[1,3..9]`；玩家 1 号是**最后一位**发言者；路由 `POST SPEECH` | 临时集成探针 | `seq22 SPEECH{seat:1}`；`seq23 PHASE_CHANGED DAY_SPEECH→DAY_VOTE`；**`seq24 REJECTED PHASE_MISMATCH`（`self:1`）** | B-R7-1 仍有洞：相位变了、席位没变 |
| **P-R8-C** | 同 P-R8-B，但路由 `POST SPEECH_SKIP` | 临时集成探针 | `seq22 SPEECH_SKIPPED{seat:1}`；`seq23 PHASE_CHANGED`；**`seq24 REJECTED PHASE_MISMATCH`，message「阶段 DAY_VOTE 不接受 SPEECH_SKIP」（`self:1`）** | C-115 的跳过在最后一位时同样会被编排层重复提交 |
| **P-R8-D** | 真实推进到 `DAY_SPEECH`，把 `DAY_STARTED.ts` 改成 30 秒前，再 `GET /timer` 两次（间隔 1.1s）；最后改成刚刚 | 临时集成探针 | `30 → 29`，`startedAt` 不变；刚刚 → `60`，`phase=DAY_SPEECH` | timer 的 `DAY_STARTED` 路径行为正确，缺的只是测试 |
| **M-R8-1** | 删掉 `orchestrator.ts:143-151` 的「重读 + 换人守卫」整段 | 全量 `pnpm test` | **75 files / 637 tests 全绿** | B-R7-1 没有回归锁 |
| **M-R8-A** | timer 起点查找删掉 `SPEECH` | `tests/server/speech.test.ts` | **1 failed / 11 passed**（`:223`） | 「刚刚的 SPEECH」分支有牙 |
| **M-R8-B** | 删掉 `SPEECH_SKIPPED` | 同上 | **1 failed / 11 passed**（`:235`） | 跳过起点有牙 |
| **M-R8-C** | 删掉 `events.length === 0 → 410` | 同上 | **1 failed / 11 passed**（`:251`） | 释放局 410 有牙 |
| **M-R8-D** | `remainingSeconds` 改成常量 `60` | 同上 | **2 failed / 10 passed**（`:100` / `:230`） | 常量实现会红 |
| **M-R8-E** | 起点查找删掉 `DAY_STARTED` | 同上 | **12 passed（全绿）** | `DAY_STARTED` 分支没有锁 |
| **M-R8-F** | 删掉 `routes/games.ts:241-243` 的 `SPEECH_SKIP → channels.submit` | `channels.test.ts -t 'POST SPEECH_SKIP'` | **1 failed / 18 skipped（5012ms 超时）** | C-115 的 skip 通知有牙（但见 M-R8-H） |
| **M-R8-G** | 删掉 `routes/games.ts:191-202` 的空文本 400 | `channels.test.ts -t '空文本的 SPEECH'` | **1 failed（expected 200 to be 400）** | 空输入 400 有牙 |
| **M-R8-H** | 同 M-R8-F，但加 `--testTimeout=8000` | 同上 | **1 passed（5094ms）** | 这条断言分不清「路由兑现」与「通道自己超时」；见 §6 |

### 4. 验收标准（本轮范围）

| AC | 判定 | 说明 |
|---|---|---|
| 6 | **未重查（沿用 Round 7 的 C-110 核心闭合）** | 超时文本进 `SPEECH` 的编排层用例仍在；C-115 只补了真实 HTTP 的弃权 / 空输入。 |
| 7 | **未重查（沿用 Round 7）** | `skip → SPEECH_SKIPPED → 继续` 的编排层锁仍在；真实 HTTP 的 `SPEECH_SKIP` 现在能兑现通道。残项：最后一位发言者 + 投票第一个行动时，编排层仍会追加一条 `REJECTED`（B-R8-1）。 |
| 9 | **NEEDS WORK** | 路由的接受后通知两半都有锁（C-109 已关闭、C-115 新增），但 B-R7-1 的单写者仍不完整：**同席位在下一个相位成为行动者**时编排层重复提交，且没有集成用例（M-R8-1）。 |
| 13 | **PARTIAL** | 用户声明的四种起点都锁住；但 `DAY_STARTED` 分支（每个白天第一个发言者的唯一计时起点）删掉后 12/12 绿，Round 6 要求的「两次读取递减」仍缺。行为经 P-R8-D 证明正确。 |
| 3 / 4 | **DEFERRED（用户批准 D-5）** | 身份卡与输入框界面部件 / DOM 扫描归 RFC-012，不重开。 |
| 其余 AC | **未重查（沿用前判）** | AC-1 / 2 / 5 / 8 / 10 / 11 / 12 / 14 本轮无相关改动。 |

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

B-R7-1 的守卫方向对，但判定条件把「该谁行动」与「是不是同一席位」混为一谈：`seatToSpeak(latestState) ?? nextActor(latestState)` 在 `DAY_SPEECH` 结束后会落到 `DAY_VOTE` 的第一位投票者；玩家恰好是这个席位时，守卫误判「还在等你」。这正是 B-R7-1 要消除的重复提交 / `REJECTED`，只是换了相位。B-R7-2 的四类声明成立，但 `DAY_STARTED` 与递减证据缺失；B-R7-3 / C-115 的行为与锁成立，附测试鉴别力问题。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **TEST-1**：B-R7-1 的守卫没有回归锁（M-R8-1 全量 637 绿）；`DAY_STARTED` 起点没有锁（M-R8-E 12/12 绿）。C-115 的锁存在，但 M-R8-H 说明它只靠测试超时打红（非阻塞）。
- **DOC-1**：RFC §8.13 的 B-R7-1 行写「如果已经不是这个席位…就 `continue`」——实际条件不是「不是这个席位」，而是「不是这个席位或这个相位」；同席位在 `DAY_VOTE` 仍会提交。B-R7-2 行写「四个分支出错都会红」——对用户列的四类成立，但 `DAY_STARTED` 是第五条分支，删掉仍全绿。C-115 行写「两条用例 + 反向探针都会红」——操作上成立，但 M-R8-H 说明不是语义上的「已兑现」证明。
- **SEC-4 / SEC-5 / ARCH-9**：本轮没有新的投影泄漏或越权；空文本校验与席位绑定未动；`ctxFor(observer)` 未动；`src/client/` 的静态检查未动。
- **UI-4**：`DAY_STARTED` 的 60 秒起点没有路由级用例（见 AC-13），属于 TEST-1 的同一缺口。

#### 5.3 SECURITY — **PASS（附数据完整性保留）**

没有新的身份 / 投影泄漏或越权。多出来的 `REJECTED` 是 `visibleTo: self:1` 的私有事件，不构成泄密；它是数据完整性 / 体验问题（B-R8-1）。空文本 400 是 SEC-4 要求的前置校验；`SPEECH_SKIP` 的通道兑现不引入新的输入面。

#### 5.4 PERFORMANCE — **N/A**

没有新增数据库 / 网络热路径。`GET /timer` 仍是内存事件流的线性反向扫描；去掉 `stateOf` 重放反而避免了已释放 / 事件不全时的异常开销。`runGame` 每次提交前多一次 `getGame` 是原有逻辑，规模可忽略。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- `tests/server/channels.test.ts:470-607` 的 C-115 新用例复制了约 100 行夜间推进代码；`timerFor` 返回的 `record` 无人使用。
- 新 timer 用例把 `SPEECH` / `SPEECH_SKIPPED` 直接塞进一个仍处于 `NIGHT_WOLF_CHAT` 的事件流；这些事件流不可 replay（`GET /api/games/:id` 会抛错），它们只覆盖路由的查找逻辑，不是「真实白天」的端到端。
- `tests/server/speech.test.ts:100` 的用例名仍写「一条很旧的发言…」，实际没有任何 `SPEECH` / `SPEECH_SKIPPED`；它靠 `DAY_STARTED.ts=1` 得到 0，删掉 `DAY_STARTED` 分支仍绿。这个命名会误导下一轮。
- `stillTheirTurn` 把「席位」当作「回合」；名字与语义不符，是 B-R8-1 的直接原因。

### 6. 非阻塞建议

1. **C-115 的测试鉴别力**：在 `read()` 之后调用 `setDraft('草稿')`，再 POST `SPEECH_SKIP`；如果路由兑现，挂起 Promise 得到 `{kind:'skip'}`，如果只是通道超时，会得到 `{kind:'timeout', text:'草稿'}`。或者断言 `await pending` 的耗时 < 1 秒。不要依赖「测试超时 = 读取超时」。
2. **timer 的真实路径**：补一条以真实 `DAY_STARTED` 为起点的用例（刚刚 → 约 60，30 秒前 → 30，1.1 秒后 → 29），并让它成为删 `DAY_STARTED` 会红的第五条分支；这条同时在语义上满足 Round 6 的「两次读取递减 / 刷新不回满」。
3. **timer 夹具**：优先用 `registry.submit` 在 `DAY_SPEECH` 真正提交一条 `SPEECH`（或 `SPEECH_SKIP`），再改它的 `ts`；不要往夜间事件流里塞 `SPEECH`。旧用例 `speech.test.ts:100` 要么改成真实发言，要么改名。
4. **测试去重**：把 `channels.test.ts` 里反复出现的「推进到白天」抽成 helper；C-115 的两条用例目前各自复制一份。
5. **文档**：本轮后回写 RFC §8.13 与 RFCS 的 C-111 / C-113 / C-115 行；B-R7-1 的「换人就跳过」要改成「换人或换相位就跳过」，B-R7-2 的「四个分支」要说明它只指用户列出的四类，`DAY_STARTED` 仍未锁。
6. **上一轮已关闭项的文档残项**（C-104 / C-114）不在本轮范围内，不重查、不代改。

### 7. 结论

**Overall Risk Level: High。**

C-115 是三项里真正修好的：`POST SPEECH_SKIP` 兑现挂起通道、空文本 `SPEECH` 返回 400，行为与提交的反向探针都成立；唯一的问题是那条 skip 用例的断言分不清「路由及时兑现」与「通道自己 5 秒超时」。B-R7-2 的用户声明四类都有牙（M-R8-A/B/C/D 全红），但 `DAY_STARTED` 分支仍然删掉全绿，Round 6 的「两次读取递减」仍缺；行为本身正确。B-R7-1 只修好了「下一位是别人」的常见路径：当玩家是当天最后一位发言者、且是 `DAY_VOTE` 的第一个行动者时，重读后的 `latestState` 已经是 `DAY_VOTE`，`nextActor` 仍返回同一个席位，守卫误判「还在等你」，编排层把同一动作再提交一次，产生玩家可见的 `REJECTED / PHASE_MISMATCH`；删掉整段守卫全量 637 仍绿，说明没有回归锁。

**Blocking Issues**：

- **B-R8-1（C-113 / AC-9 / 数据完整性，阻塞）**：最后一位发言者 + 投票第一个行动者时，编排层仍重复提交；P-R8-B：`SPEECH seq22` → `PHASE_CHANGED seq23` → `REJECTED seq24 PHASE_MISMATCH (self:1)`；P-R8-C 的 `SPEECH_SKIP` 同样。M-R8-1 删掉守卫后全量 75/637 绿。**修守卫：发言轮用 `latestState.phase === 'DAY_SPEECH' && seatToSpeak(latestState) === seat`（或比较等待前后的 record），并补真实 `buildApp` + `runGame` 集成用例，覆盖「第一位发言」与「最后一位发言 / 第一位投票」两种起点，断言只有一条 `SPEECH` / `SPEECH_SKIPPED` 且没有 `REJECTED`。**
- **B-R8-2（C-111 / AC-13 / 证据，阻塞）**：用户列的四类起点都有锁，但 `DAY_STARTED` 分支删掉后 **12/12 绿**，Round 6 的「两次读取递减」仍不存在；`DAY_STARTED` 是每个白天第一个发言者的计时起点，删掉它会让白天一开始就显示 0 秒。行为经 P-R8-D 证明正确（30 → 29，刚刚 → 60）。**补一条真实 `DAY_STARTED` 的递减用例；不需要改实现。**

**Non-blocking**：C-115 的测试只靠「测试超时 = 读取超时」打红（M-R8-H 在 8 秒超时下通过）；timer 新用例把 `SPEECH` 塞进夜间事件流、事件流不可 replay；旧用例 `speech.test.ts:100` 名不副实；`channels.test.ts` 的夜间推进代码重复；`timerFor` 的 `record` 返回值未用；RFC §8.13 的措辞需要按本轮证据修正。

**状态**：RFC-011 → `Changes requested`。本轮没有 `git commit`；探针源码已从 `/tmp/howl-rfc011-r8-probes/backup/` 的文件备份恢复（**未用 `git checkout` / `git restore`**），六个文件 SHA-256 与探针前一致；临时探针测试已删除；探针恢复后全量 **75 files / 637 tests** 绿、`git status --porcelain` 为空。
