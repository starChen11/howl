# RFC-010 评审 · 流式发言、思考指示与降级

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-19（Round 1）
> **分支 / HEAD**：`main` / `cf9c196`
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

五条阻塞：

1. **C-85 · `DEGRADED` 事件既产不出来，也折不了。** `GameEventMap` 里有 `DEGRADED`，`applyEvent` 没有对应分支，落到 `UnknownEventError`；`project()` / `replay()` 遇到它即崩。RFC §8.4 的 AC-10 却写「引擎照常消费 `DEGRADED` 事件」，RFC-014 也按这个事件消费降级轮次。当前仓库里没有任何代码产出 `DEGRADED`，`tests/engine/replay.test.ts:288-301` 反而把 `DEGRADED` 当作「未实现折叠」的样本并断言抛错。
2. **C-86 · SSE 端点和客户端 reducer 没有接上。** `messagesFor()` 把**每一个**可见事件都映射成 `{ type: 'done' }`：`thinking` / `delta` / `degraded` 从不出现，`DEGRADED` 也会变成一条空文本的 `done`。客户端又用「`phase === 'done'` 时丢弃所有后续 `done`」去重，于是第二段发言的 `done` 被丢掉，`lastId` 永远停在第一条 —— 这不是可用的流，也不是 AC-5 的「不重复、不丢失」。
3. **C-87 · 降级只交付了纯函数，没有一条生产调用链。** `decideDegrade` / `recordDegradation` / `recordSuccess` / `shouldAttempt` / `degradeSentence` 的调用者全部只在测试里；没有 `DEGRADED` 事件、没有把短句写成 `SPEECH`（引擎的发言 cursor 不会前进），也没有「先重试 1 次，仍失败再降级」的真实路径。AC-8 的用例只是给 `decideDegrade` 传 `failed: false`，没有验证重试。
4. **C-88 · `Last-Event-ID` 补偿窗口会真的丢事件。** `messagesFor(...).filter(id > lastEventId).slice(-200)`：300 条事件、`Last-Event-ID: 50` 时返回 `101..300`，`51..100` 无提示丢失；Q-010-2 要求超出窗口时让客户端重新拉快照，代码没有这个信号。测试只断言了 `REPLAY_WINDOW === 200` 这个常量。
5. **C-89 · 客户端 reducer 跨发言不重置，`text` 和 `firstDeltaAt` 会串台。** 第二段发言第一个 `delta` 之后，`text` 变成上一段 + 新 delta，`firstDeltaAt` 仍是上一段的 200。AC-1 的「单局 ≥ 30 次发言 p95」和 AC-2 的逐字显示在第二段起就不成立。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `cf9c196`，`git status --porcelain` 为空。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK_EXIT=0

$ pnpm lint
> eslint .
LINT_EXIT=0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
✓ built in 69ms
vite v8.3.8 building ssr environment for production...
✓ 41 modules transformed.
✓ built in 16ms
dist/server/index.js  87.18 kB │ gzip: 29.18 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  68 passed (68)
      Tests  552 passed (552)
TEST_EXIT=0
```

覆盖率来自 `tests/meta/coverage.test.ts` 生成的 `coverage/coverage-summary.json`（只覆盖 `src/engine/**`）：

```
lines: 96.96% (543/560)   branches: 92.80% (361/389)
```

`pnpm test:e2e`：

```
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`tests/meta/selfplay-placeholder.test.ts` 断言退出码 1），与本 RFC 无关。

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查核心循环 / 事件流 / 重放、服务端 SSE 与可见性、安全、测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / 首屏性能 / Playwright，因为本 RFC 不改 `src/client/` 的界面（A 方案把界面留给 RFC-012），`tests/e2e/` 为空。HTTP 端点与事件流仍然检查，因为本 RFC 新增了 `/api/games/:id/stream`。

**探针后的复跑**：所有变异探针从 `/tmp/howl-rfc010-backup/` 的文件备份恢复（**没有使用 `git checkout`**），三个恢复点的 `md5` 与备份逐一相同；`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **68 files / 552 tests 全绿**。没有 `git commit`。

---

### 1. 用户要求核对的五处实现选择

#### 1.1 ① A 方案：前端纯 reducer，界面留 RFC-012，服务端全做

**结论：前端部分符合；「服务端全做」不成立。**

- `src/client/use-stream.ts` 只 import `@shared/stream` 的 `StreamMessage` 类型，没有 DOM、React、`fetch`、`window`、计时器；`tests/client/use-stream.test.ts` 在 node 环境跑。这是 A 方案要求的不依赖 DOM 的纯 reducer，**符合**。
- 界面留到 RFC-012 记在 §8.1（批准记录）与 §8.6（界面渲染行），**符合**。
- **服务端没有全做**：
  - `src/server/routes/stream.ts:37-45` 把每个可见事件都变成 `done`；`thinking` / `delta` / `error` 从未由服务端产生，`DEGRADED` 也变成空文本 `done`（见 C-86）。
  - `src/server/llm/stream.ts` 的 `consumeStream` 没有任何生产调用者；它解析的是 SSE 文本行，而 OpenAI SDK 返回的是 chunk 对象，二者之间没有适配层。
  - `src/server/llm/degrade.ts` 的所有降级函数没有生产调用者；没有 `DEGRADED` 事件产出，也没有把替换短句写回引擎的路径（见 C-87）。
  - 路由用 `reply.send` 一次性写完整个响应；§8.6 的「持续推送」被记到 RFC-012，但服务端的 `SseOutputChannel` 属于 RFC-011 §2.3 / §3（`RFCs/RFC-011...:55-58,64-76`），RFC-012 只是界面（见 C-86 的归属冲突）。

#### 1.2 ② SSE 可见性复用 `isVisibleTo`，不手写过滤

**结论：代码符合；但测试没有锁住，提交信息里「测试立刻抓到」不成立。**

- `src/server/routes/stream.ts:35` 确实是 `isVisibleTo(event, seat as never, state)`，没有手写 `wolves` 规则，**代码符合 D-2**。
- 但 `tests/server/stream.test.ts:106-108` 的期望集合是 `record.events.filter((event) => event.visibleTo === 'public')`。这个 fixture 的 `playerSeat` 默认 1；我用 `seed: 15` 逐个席位探针，座位 1 是 **witch**，不是 wolf，`advanceToDay` 也没有产生玩家自己的 `WITCH_POTION_USED` / `SEER_CHECKED` 可见事件。因此测试只覆盖 `public` 分支，`wolves` 和 `self:<n>` 分支一个都没碰。
- 反向探针 P1：把 `stream.ts:35` 换成 `record.events.filter((event) => event.visibleTo === 'public')`，`tests/server/stream.test.ts` 仍然 **6/6 全绿**。这正是 D-2 说的「手写漏过 `wolves`」回归，测试抓不到。
- 另：`GameRegistry.visibleEventsOf(record, seat)`（`src/server/store/game-registry.ts:157`）已经按事件逐条折叠并用 `isVisibleTo` 过滤；路由又写了一遍同样的过滤。建议直接复用，减少第二份实现。

#### 1.3 ③ 同一条发言的多个 `delta` 共享 `id`，只在终结类消息上按 `<=` 判重

**结论：单测锁住了「delta 共享 id」；实现不是字面上的「只在终结类消息按 `<=` 判」，而且端到端完全没接上。**

- `src/client/use-stream.ts:40-41` 的实际规则是：
  - 所有消息先按 `message.id < state.lastId` 丢弃；
  - 只有 `phase === 'done' && message.type === 'done'` 再丢一次。
- 这不是「只在终结类消息上按 `<=` 判」：`degraded` / `error` 用相同 `id` 重放时仍会应用（当前是幂等的，所以没暴露）；`done` 用相同 `id` 重放会被 `phase === 'done'` 挡住，效果上接近 `<=`。
- 正向证据：P2 把 `<` 改成 `<=`，`tests/client/use-stream.test.ts` **2 failed / 3 passed**（`expected '我觉得 2 号像' to be '我觉得'`），说明第二个同 id 的 delta 会被错误丢弃，这条性质确实被单测锁住了。
- **但**：`src/server/routes/stream.ts` 从不发 `delta` 或 `thinking`，只发 `done`；客户端 `:41` 会把「下一段发言的 `done`」也当成重复丢掉。P9：两条 `SPEECH`（seq 3、seq 9）经 `messagesFor` 进 reducer，最终 `text` 是 `第一段`，`lastId` 停在 3，第二条 `done` 没有生效。P4：`SPEECH` 之后的 `DEGRADED` 变成 `done`，也被吞掉。note ③ 的规则只在单测的合成消息上成立，端到端不成立。

#### 1.4 ④ `DEGRADE_SENTENCES` 常量、构造时校验 ≤10 字，`shouldAttempt()` 恒 true

**结论：常量与返回值符合；校验点与「可断言位置」没有真正接线。**

- `DEGRADE_SENTENCES` 四条分别 4 / 7 / 6 / 3 字，均 ≤ 10；`degradeSentence` 在取值时检查（`src/server/llm/degrade.ts:22-24`），不是模块构造时。把一条 11 字短句加进常量时，红的是 `tests/server/degrade.test.ts:63-67` 的「句库本身每条都 ≤ 10 字」，不是 `degradeSentence` 的 runtime 检查；那条 `throw` 分支没有任何测试走到。
- `shouldAttempt()` 恒 `true`（`degrade.ts:69-71`），单测 `tests/server/degrade.test.ts:86-92` 通过。但 `grep` 显示它没有生产调用者；AC-12 的「连续 3 次后第 4 次仍尝试真实调用」没有落在任何调用链上，只落在一个函数的返回值上。
- `markUnstable`（`src/client/use-stream.ts:77-80`）又硬编码了 `3`，和 `UNSTABLE_AFTER` 是两个来源；服务端也没有任何「模型不稳定」的 SSE 消息类型（`StreamMessage` 只有 `degraded`，没有 flag）。

#### 1.5 ⑤ 本 RFC 不接真实模型，真实 p95 属手工验收（§8.6）

**结论：这条偏离接受；但测量口径不完整，手工验收也算不出 per-speech p95。**

- `D-6` 与 §8.6 明确「本 RFC 不接真实模型，p95 由测试内的可控 chunk 序列测量；真实 p95 手工验收」。这与 RFC §6「不依赖真实 API」一致，**接受**。
- 缺口在测量点：
  - RFC §4 要求「服务端发出第一个 SSE 事件的时间、客户端渲染首字的时间，两者都记录」。服务端没有记录任何时间；`src/server/routes/stream.ts` 是一次性响应，没有首事件时间戳。
  - 客户端的 `firstDeltaAt` 只在 `state.firstDeltaAt === null` 时赋值（`use-stream.ts:58`），从不按发言重置。P8：第一段 `done` 后开始第二段，`firstDeltaAt` 仍是 200，`text` 是 `第一段第二`。
  - `useReducer` 的 `dispatch` 只能传一个 action；D-1 说「接界面时只是把 `dispatch` 换成 `useReducer`」，但 `streamReducer` 的第三个参数 `now` 在 `useReducer` 下无法传入，会恒为 `0`，`firstDeltaAt` 的记录方式需要改（把时间戳放进 action，或在外面记）。
  - 没有按发言保存的样本数组，也没有 `tests/e2e/stream.spec.ts`（A 方案把 UI 推后，可接受），所以 AC-1 / 3 的 p95 没有可采样的数据源。

---

### 2. 逐条验收标准：哪个测试会红

> 判定按 `RULES TEST-1`：行为退化时测试必须失败。`P*` 是本轮实际注入的探针（§6）。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `tests/client/use-stream.test.ts:12-21`：`thinking` → `phase='thinking'`，首个 `delta` 记 `firstDeltaAt` | 无服务端首事件时间；`firstDeltaAt` 不按发言重置（P8）；没有 per-speech 样本 | **PARTIAL** |
| 2 | `tests/client/use-stream.test.ts:24-41`：两个 `delta` 后 `text` 是中间态，`done` 补全 | 文本只有 8 字，不是 AC 说的 50 字；第二段起 `text` 串台（P8）；路由不发 delta（C-86） | **PARTIAL** |
| 3 | 手工验收；当前没有可采样的 per-speech 数据（见 AC-1） | p95 是手工项，按 D-6 接受；测量口径未就位 | **PARTIAL（记录）** |
| 4 | `use-stream.test.ts:11-21`：`phase` 在 `thinking` / `speaking` 间可区分；`sawThinking` 记录经历 | UI 在 RFC-012（A 方案，接受）；`sawThinking` 不按发言重置 | **PARTIAL** |
| 5 | `tests/server/stream.test.ts:86-118`：首次请求的 `id` 等于 public 事件 seq；从最后一个 id 重连返回空 | 只测了「从最后重连」；P3 用 300 条事件、`Last-Event-ID: 50` 返回 `101..300`，`51..100` 丢失；P9 第二段 `done` 被客户端丢掉 | **FAIL** |
| 6 | `tests/server/stream.test.ts:126-148`：逐字节喂中文不乱码 | P7 去掉 `TextDecoder` 的 `{ stream: true }` 后 2 条 AC-6 用例均红 | **PASS** |
| 7 | `tests/server/degrade.test.ts:22-67`：超时 → 降级，短句 ≤ 10 | 没有 `DEGRADED` 事件产出；`DEGRADED` 也不能 replay（P5） | **FAIL** |
| 8 | `tests/server/degrade.test.ts:70-83`：`failed: false` → 不降级 | 这只是「调用方传 false」，没有「第一次失败、第二次成功」的重试路径 | **FAIL** |
| 9 | `tests/client/use-stream.test.ts:54-61`：`degraded` 把 phase 置为 degraded | 路由把 `DEGRADED` 变成 `done`（P4）；客户端 `done` 去重会吞掉它；没有 UI（A 方案接受） | **FAIL** |
| 10 | `tests/server/degrade.test.ts` 只证明 `decideDegrade` 返回文本；注释声称引擎照常推进 | 没有 caller，没有 `SPEECH` / `DEGRADED` 产出，发言 cursor 不会前进 | **FAIL** |
| 11 | `degrade.test.ts:85-93` 的 `total` 只是内存计数 | `total` 不知道「哪几轮」；没有 `DEGRADED` 事件，也没有 `tests/server/replay-degrade.test.ts` | **FAIL** |
| 12 | `degrade.test.ts:86-92`：`shouldAttempt()` 返回 true | 没有 caller；没有「第 4 次仍调用真实客户端」的模拟；没有对局未卡死的集成测试 | **FAIL** |

---

### 3. 阻塞发现

#### C-85 · `DEGRADED` 事件无法折叠，也没有产出路径（AC-7 / 10 / 11）

- `src/shared/events.ts:134` 定义了 `DEGRADED: { seat: SeatId }`，`:165` 的 `GAME_EVENT_TYPES` 也包含它。
- `src/engine/apply.ts:99-101` 的 `default` 对未实现类型抛 `UnknownEventError`；`applyEvent` 没有 `DEGRADED` 分支。
- `src/server/project/index.ts:35` 对每条事件先 `applyEvent`；`replay()` 同理。因此任何 `DEGRADED` 事件都会让投影 / 重放 / `GET /api/games/:id` 崩掉。
- `tests/engine/replay.test.ts:288-301` 明确把 `DEGRADED` 当作「未实现折叠的事件类型」并断言抛 `UnknownEventError`。这和 RFC-010 §8.4 AC-10「引擎照常消费 `DEGRADED` 事件」、RFC-014 §2.1 / §2.2 / AC-7 的「降级轮次来自 `DEGRADED` 事件」直接冲突。
- 全仓库 `grep DEGRADED src` 只有 `events.ts` 的定义；`degrade.ts` 没有任何构造 `DEGRADED` 的代码。
- 探针 P5：在真实 `GAME_STARTED` 后追加一条 `DEGRADED` 调 `project()`：
  ```
  project error = UnknownEventError: applyEvent 不认识事件类型 DEGRADED：它不在 GameEventMap 里，或还没有实现折叠。
  ```

**修法**：给 `applyEvent` 加 no-op 的 `DEGRADED` 分支（不写 state，只推进 `seq`）；把 `replay.test.ts` 的「未实现事件」样本换成真正不在 `GameEventMap` 的类型；在 `degrade.ts` 或未来的编排层提供 `degradedEvent(seat, seq, ...)`，并在 §8.4 记录它的可见性；补 `project()` / `replay()` 接受 `DEGRADED` 的用例，以及 `PAYLOAD_SCHEMAS` 的 `DEGRADED`（RFC-001 C-10）。

#### C-86 · SSE 路由只发 `done`，客户端会丢掉后续 `done`（AC-2 / 4 / 5 / 9）

- `src/server/routes/stream.ts:37-45`：`visible.map((event) => ({ type: 'done', id: event.seq, seat: payload.seat ?? seat, text: payload.text ?? '' }))`。它不读 `event.type`，所以：
  - `SPEECH` → `done`（正确方向）；
  - `PHASE_CHANGED` / `VOTE_CAST` / `GAME_ENDED` 等 → 空文本 `done`；
  - `DEGRADED` → 空文本 `done`，不是 `degraded`（P4）；
  - `thinking` / `delta` / `error` 从来不会出现，因为事件流里没有这些消息，路由也不调用 `consumeStream`。
- `src/client/use-stream.ts:41`：`if (state.phase === 'done' && message.type === 'done') return state;`。第一次 `done` 之后，任何后续 `done` 都被丢弃 —— 包括下一段发言的 `done`。P9：两条 `SPEECH`（seq 3、9）最终只渲染 `第一段`，`lastId` 停在 3；重连会从 3 开始重复收到第二条，且再次被丢掉。
- 真实对局里第一条 `public` 事件通常是 `DAY_STARTED`（`src/engine/phases/day.ts:66`），它也会变成空文本 `done`；客户端在第一次发言之前就进入 `done`，之后所有 `SPEECH` 的 `done` 都收不到。这不是只影响 p95，而是根本看不到发言。
- `src/server/routes/stream.ts:78` 用 `reply.send` 一次性写完；§8.6 记录了「真实 SSE 长连接留给 RFC-012」。但 RFC-011 §2.3 / §3 明确 `SseOutputChannel` 是 `OutputChannel` 的服务端实现，RFC-012 是界面；把服务端持续推送归给 RFC-012 与 RFC-011 的交付物冲突，也与用户批准的「服务端全做」冲突。
- 结果：AC-2 的「前端在 `done` 之前已渲染至少 2 个中间态」只能靠单元测试合成消息成立；AC-4 的 thinking / speaking 区分在真实流里只有 thinking 的 reducer 分支，永远收不到 thinking；AC-9 的 `degraded` 永远收不到；AC-5 的「不重复」在客户端侧反而会重复。

**修法**（二选一，并补集成测试）：
1. 让路由按事件类型映射：`SPEECH` → `done`，`DEGRADED` → `degraded`，`SPEECH_SKIPPED` / 非发言事件不发（或定义明确的消息类型）；`thinking` / `delta` / `error` 由 RFC-011 的 `SseOutputChannel` 通过 `consumeStream` 推进来，本 RFC 至少把 `consumeStream` → 消息的适配层做出来并测。
2. 若把持续推送正式交给 RFC-011，就在 §8.6 改正归属，并把 RFC-011 加入 RFC-010 的后续 / 前置说明，更新 `RFCS.md` §3；同时修客户端 `done` 去重，不能按 `phase` 吞掉下一段。

#### C-87 · 降级没有生产调用链（AC-7 / 8 / 10 / 11 / 12）

- `src/server/llm/degrade.ts` 的 `decideDegrade` / `recordDegradation` / `recordSuccess` / `initialDegradation` / `shouldAttempt` / `degradeSentence` 在 `src/` 里没有调用者；`grep` 只命中测试。
- `decideDegrade` 只返回 `{ degrade, sentence, seat }`；它不产出 `DEGRADED` 事件，也不产出 `SPEECH` 事件。引擎的 `DAY_SPEECH` 发言 cursor 由 `SPEECH` / `SPEECH_SKIPPED` 推进（`src/engine/phases/day.ts:124-146`）；只把短句交给调用方、不写 `SPEECH`，下一席位不会前进，AC-10「下一席位正常获得发言机会」无法成立。
- AC-8 的用例（`tests/server/degrade.test.ts:70-83`）直接传 `failed: false`，标题也写「由调用方把 `failed` 传 false」——它验证的是输入映射，不是「第一次调用失败、第二次成功」的重试。RFC-006 的 `decide()` 确实有重试，但没有任何代码把它的失败喂给 `decideDegrade`。
- AC-11 的 `total` 是 `DegradationState` 的内存字段，不持久化、不写事件，无法回答「哪几轮降级」；`tests/server/replay-degrade.test.ts` 在 TEST-STRATEGY 里是 planned，但仓库里不存在。
- AC-12 的 `shouldAttempt()` 没有调用者；`recordDegradation` 的 `warned` 也没有任何 SSE / UI 消费路径。

**修法**：增加一个可测的降级回合函数（例如 `degradeTurn({ seat, ... })`），返回「要写入引擎的替换 `SPEECH`」+「`DEGRADED` 事件」；如果本 RFC 不做编排，就把它明确交给 RFC-011 并在 §8.6 / §8.4 如实记录，不能写成 PASS。补三组测试：① 假客户端第一次失败、第二次成功 → 不降级；② 两次都失败 → 写 `SPEECH(短句)` + `DEGRADED`，下一席位前进，`seq` 连续；③ 连续 3 次降级后第 4 次仍调用假客户端。

#### C-88 · `Last-Event-ID` 窗口在重连时丢事件（AC-5）

- `src/server/routes/stream.ts:68-71`：
  ```ts
  const messages = messagesFor(...)
    .filter((message) => message.id > lastEventId)
    .slice(-REPLAY_WINDOW);
  ```
  `slice(-200)` 是在过滤**之后**取最后 200 条。对于已经累积 300 条事件的对局，`Last-Event-ID: 50` 会返回 `101..300`，`51..100` 丢失；对于新连接（`Last-Event-ID` 缺省为 0），也只返回 `101..300`，`1..100` 丢失。
- Q-010-2 的假设是「保留最近 200 条事件用于补偿，超出则要求客户端重新拉取快照」；代码没有快照提示，也没有判断 `lastEventId` 是否落在窗口外。
- 测试 `tests/server/stream.test.ts:120-123` 只 import 常量并断言它等于 200，没有构造 >200 的事件流，也没有从中间 `seq` 续传。
- 探针 P3（300 条 public 事件、`Last-Event-ID: 50`）：
  ```
  count= 200 first= 101 last= 300
  ```

**修法**：先算窗口起点（最旧保留的 seq），如果 `lastEventId < oldestSeq - 1`，返回一条明确的快照/重置信号（或在 `StreamMessage` 增加 `snapshot_required` / `error` 语义并写进契约）；否则返回 `id > lastEventId` 的**全部**消息（上限从窗口起点开始算，不能截掉客户端应得的前半段）。补 >200 条事件、从中间 id 续传的用例。

#### C-89 · reducer 跨发言不重置 `text` / `firstDeltaAt`（AC-1 / 2 / 4）

- `src/client/use-stream.ts:52-60`：`delta` 分支 `text: state.text + message.text`，`firstDeltaAt: state.firstDeltaAt ?? now`；`thinking` 分支只改 `phase` / `seat` / `lastId` / `sawThinking`，不清 `text`，也不清 `firstDeltaAt`；`done` 分支覆盖 `text`，但下一个发言的第一个 delta 又会把上一段文本带上。
- 探针 P8：
  ```
  state= {"phase":"speaking","text":"第一段第二","firstDeltaAt":200,"lastId":2}
  ```
  第二段发言已经开始，但 `text` 是第一段 + 第二段，`firstDeltaAt` 仍是第一段的 200ms。
- 探针 P9 进一步证明路由 + reducer 的组合在第二段 `done` 上直接停住（`text=第一段`，`lastId=3`）。
- 这不只是 p95 问题：AC-2 要求逐字渲染当前发言，第二段起会显示上一段的残留；AC-4 的 `sawThinking` 也会跨发言保留（第一段经历过 thinking 后，第二段没 thinking 也会是 true）。

**修法**：给 reducer 增加「当前发言的事件 id」概念：当 `thinking` / 第一个 `delta` / `done` 的 `id` 比当前发言 id 大时，重置 `text`、`firstDeltaAt`、`sawThinking`；`delta` 用新的 `text` 开始累加；`done` 用完整文本覆盖。补两段及以上发言的用例，并断言每段的首 delta 时间。

---

### 4. 非阻塞发现

#### C-90 · D-2 的可见性没有回归锁（安全相关，但代码当前正确）

- 见 §1.2 与 P1：把 `isVisibleTo` 换成 `visibleTo === 'public'` 后 `stream.test.ts` 6/6 绿。当前 fixture 的 `playerSeat=1` 是 witch，测试没有覆盖 `wolves` / `self:<n>`。
- 建议：至少造一条 `WOLF_CHAT_POSTED`（`visibleTo: 'wolves'`）并断言它对好人不可见、对狼可见；再造一条 `AI_THOUGHT` 或 `SEER_CHECKED`（`self:<n>`）断言只对本人可见。可以直接调 `messagesFor`，不必起完整对局。另建议路由改用 `registry.visibleEventsOf(record, seat)`，避免第二份过滤实现。

#### C-91 · `src/shared/stream.ts` 的运行时函数扩大了 `ARCH-2` 例外

- `RULES.md:127` 的 `ARCH-2`：`src/shared/` 只放类型与纯常量，不得 import engine/server/client，也不得引入除 `zod` 之外的运行时依赖。
- `src/shared/stream.ts:33-50` 有 `encodeSseFrame` / `parseSseData` 两个运行时函数；它不是类型/常量。C-13（`visibility.ts` / `schemas.ts`）与 C-57（`injection.ts`）已经把这个例外扩到三处，现在又多了第四处，但没有登记。
- 这是「RULES vs RFC」的冲突：按权威顺序应先走 `/manage-changes` 把 `ARCH-2` 的例外扩到 `stream.ts`，或把编解码移到 `src/server/` / `src/client/` 各一份（不推荐，正是要防的重复）。本 RFC 的 §8.2 没有记录这个偏离。

#### C-92 · 文档、测试计划与 RFC §8.4 的过度声明

- `TEST-STRATEGY.md:3` 仍写 `RFCS.md v2.65`（当前 v2.73）；RFC-010 的测试表 `:302-312` 全部还是 `proposed`，且文件名与实现不符：
  - 计划 `tests/server/sse.test.ts`，实际 `tests/server/stream.test.ts`；
  - 计划 `tests/server/replay-degrade.test.ts`，仓库里不存在；
  - 计划 `tests/e2e/stream.spec.ts`，`tests/e2e/` 只有 `.gitkeep`；
  - 实际新增的 `tests/client/use-stream.test.ts` 没有进计划。
- `README.md:11` 仍写「RFC-004 ~ 007 Reviewed」「八个 RFC 已合入（001–008）」「7 Reviewed / 0 Changes requested / 8 Not started」；`:36-38` 仍写「RFC-001 ~ 007 Reviewed」「RFC-008 Implemented，等待评审」「下一步 /review-rfc 008」。RFC-009 / RFC-010 已经合入，状态严重过期。
- RFC-010 §8.4 的 PASS 表格与实现不符：AC-8 只是传 `failed: false`；AC-9 没有服务端 `degraded`；AC-10 声称「引擎照常消费 `DEGRADED`」但 `applyEvent` 抛错；AC-11 的 `total` 不能标轮次；AC-12 的 `shouldAttempt` 没有调用者。`DOC-1` 要求偏离写进 `## Implementation Notes`，这些不是偏离，是未实现。
- RFC-010 §2.3 写「重试 1 次（RFC-007 的重试策略）」，实际重试在 RFC-006 §2.3；RFC-010 §2.3 / §3 与 RFC-007 的职责不符。
- `PAYLOAD_SCHEMAS`（`src/shared/schemas.ts:231-248`）没有 `DEGRADED`；按 RFC-001 C-10「payload 的 schema 由拥有该 payload 的 RFC 追加」，RFC-010 应补 `DegradedPayloadSchema` 并更新 `tests/shared/schemas.test.ts:99-115` 的键集合。

#### C-93 · p95 的测量口径还不完整

- 见 §1.5：服务端首事件时间没有记录；`firstDeltaAt` 不按发言重置；`useReducer` 无法传 `now`；没有 per-speech 样本数组。真实 p95 是手工项（D-6，接受），但当前代码连「手工采样」所需的两个时间点都拿不全。建议至少把 `now` 放进 action（例如 `{ message, receivedAt }`），或在 reducer 外层按发言记录样本；服务端在写出第一帧时记录 `startedAt`，并把它写进日志 / 测试输出。

#### C-94 · `parseSseLine` 绕过 Zod，`parseSseData` 却校验

- `src/server/llm/stream.ts:36-52` 只检查 `type !== undefined`，然后 `return candidate as StreamMessage`；`src/shared/stream.ts:42-50` 的 `parseSseData` 走 `StreamMessageSchema.safeParse`。
- 探针 P6：
  ```
  parseSseLine = {"type":"delta"}
  parseSseData = undefined
  ```
  一条缺 `id` / `seat` / `text` 的行会被 `consumeStream` 当作合法消息回调，未来接上客户端后可能把 `undefined` 拼进 `text`。建议 `parseSseLine` 复用 `StreamMessageSchema`（或直接 `parseSseData(data)`），并补一条 schema 非法行的用例。

#### C-95 · 其他维护性小项

- `degradeSentence` 的「≤ 10 字」检查在取值时，不是模块构造时（D-4 的「构造时校验」字面不成立）；`throw` 分支无测试。建议在模块初始化时遍历 `DEGRADE_SENTENCES` 校验，或至少补一条用戳破常量的测试。
- `markUnstable` 硬编码 `3`，不引用 `UNSTABLE_AFTER`；客户端和服务端各有一份阈值，容易漂移。
- `messagesFor` 的 `seat` 参数是 `number`，内部用 `seat as never` 传给 `SeatId`；`payload.seat ?? seat` 也 `as never`。建议把参数改成 `SeatId`，去掉类型逃逸。
- `src/server/routes/stream.ts` 的 `state` 参数只用于 `isVisibleTo`，但路由用最终状态判全部历史；虽然当前可见性规则下等价，仍建议复用 `visibleEventsOf` 的逐事件折叠，避免未来 `diedSeq` / 相位规则变化时出现第二种口径。
- `messagesFor` 把 `SPEECH_SKIPPED` 映射成空文本 `done`，UI 会显示一个空气泡；`PHASE_CHANGED` / `GAME_ENDED` 同理。应在映射层过滤，或给它们明确的消息类型。

---

### 5. 五个审查维度

#### 5.1 RFC ADHERENCE —— **FAIL**

- 12 条 AC 中只有 AC-6 完全通过；AC-1 / 2 / 3 / 4 是 reducer 单元的 PARTIAL；AC-5、7、8、9、10、11、12 没有端到端实现或没有可失败证据（见 §2）。
- 缺功能：服务端 `thinking` / `delta` / `error`、`DEGRADED` 的产出与折叠、降级后的 `SPEECH` / cursor 推进、`Last-Event-ID` 的窗口语义、per-speech p95 采样。
- 多做的部分：`messagesFor` 把非发言事件也当 `done`，这是协议之外的语义，不是「多做功能」，但会让客户端显示错误内容。

#### 5.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：本提交没有让 `src/engine/` import UI / server / 网络；`applyEvent` 未改。 |
| `ARCH-2` | **NEEDS WORK**：`src/shared/stream.ts` 新增运行时函数，扩大 C-13 / C-57 的例外（C-91）。 |
| `ARCH-4` | **PASS**：没有把时钟 / 网络 / LLM 塞进引擎；降级决策是纯函数。 |
| `DATA-1` | **PASS**：SSE 消息的 `id` 取事件 `seq`；事件本身仍带 `seq` / `ts`。 |
| `DATA-3` | **FAIL（若产出 `DEGRADED`）**：`applyEvent` 拒绝 `DEGRADED`，`replay` 不可能与状态一致（C-85）。 |
| `API-1` | **PARTIAL**：`StreamMessageSchema` 在 shared；但 `parseSseLine` 绕过它（C-94）。 |
| `API-2` | **PARTIAL**：路由的 `done` 消息 `id === seq`；`thinking` / `delta` 没有实现，`error` 没有对应的 seq 语义。 |
| `TEST-1` | **FAIL**：AC-7 ~ 12 的测试只测 helper，没有一条会在「降级不产出 / 不推进」时变红（C-87）。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.80%，未因本 RFC 下降。 |
| `DOC-1` | **NEEDS WORK**：§8.4 把未实现写成 PASS；§8.6 把服务端推送归给 RFC-012；§2.3 的 RFC-007 重试引用错误（C-92）。 |
| `AI-3` / `AI-7` | **PASS**（未改）：`client.ts` 的 timeout 来自 `DEFAULT_LLM_CONFIG.timeoutMs=30_000`、`maxRetries=1`；本 RFC 没有改调用路径。 |
| `SEC-5` | **PASS（就数据面而言）**：SSE 只发可见事件，没有直接序列化完整 `GameState`；但建议复用 `visibleEventsOf`（C-90）。 |

#### 5.3 SECURITY —— **PASS（有一条回归锁缺失）**

- 路由先 `resolveSession` 再检查 `session.gameIds.includes(record.gameId)`（`src/server/routes/stream.ts:52-56`），没有会话不能读别人的局。
- 可见性由 `isVisibleTo` 统一判定；没有手写 `wolves` 规则；当前 fixture 下没有发现泄漏（玩家 1 是 witch，wolf / seer / self 事件不会误发）。
- 没有新增密钥、日志或错误响应里的敏感数据；SSE 的 `data` 是 `JSON.stringify`，换行被转义，不能注入帧。
- **缺口**：D-2 的回归锁不存在（C-90）；如果将来有人把 `isVisibleTo` 换成 `public` 过滤，测试不会红。这不是当前泄漏，是回归风险。

#### 5.4 PERFORMANCE —— **PASS**

- `messagesFor` 对事件流做一次 O(n) 过滤，最多发 200 条；`stateOf` 的 replay 是既有路径。没有新增 LLM / 网络 / 数据库调用。
- `consumeStream` 每收到一个 chunk 立即转发，不攒批；但当前没有生产调用者，性能结论只适用于纯函数本身。
- 一次性 `reply.send` 的字符串拼接最多 200 帧，量级可接受；真正的持续推送留给后续 RFC，但归属需要修正（C-86）。

#### 5.5 MAINTAINABILITY —— **NEEDS WORK**

- 路由重复了 `GameRegistry.visibleEventsOf` 的过滤逻辑（C-90）；`messagesFor` 的 `as never` 和 `payload as { seat?; text? }` 绕过了事件 payload 的类型。
- 降级模块有 5 个导出没有生产消费者；`shouldAttempt` / `markUnstable` 是「可断言位置」，但没有接线，容易被误读为已实现。
- 客户端和服务端各有一份「连续 3 次」阈值；`markUnstable` 和 `UNSTABLE_AFTER` 应共享或至少用测试对齐。
- 测试计划与实现文件名脱节（C-92）；`tests/server/stream.test.ts` 的「补偿窗口」用例是常量自证。
- 正向：`src/shared/stream.ts` 的 Zod discriminated union 清楚；`IncrementalDecoder` 的 `{ stream: true }` 注释准确；AC-6 的逐字节测试是有效回归锁。

---

### 6. 变异探针与恢复

备份在 `/tmp/howl-rfc010-backup/`，覆盖 `src/server/routes/stream.ts`、`src/server/llm/stream.ts`、`src/client/use-stream.ts`。每个探针用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 注入 | 跑什么 | 结果 |
|---|---|---|---|
| P1 | `routes/stream.ts:35` 的 `isVisibleTo` 换成 `event.visibleTo === 'public'` | `tests/server/stream.test.ts` | **6/6 全绿**（C-90：D-2 未被锁住） |
| P2 | `use-stream.ts:40` 的 `<` 改成 `<=` | `tests/client/use-stream.test.ts` | **2 failed / 3 passed**（第二个同 id delta 被丢，D-3 被锁住） |
| P3 | 临时 stub registry：300 条 public 事件，`Last-Event-ID: 50` | `registerStreamRoutes` + `app.inject` | `count=200 first=101 last=300`（C-88） |
| P4 | `messagesFor` 处理 `SPEECH` + `PHASE_CHANGED` + `DEGRADED` | 临时测试 | 3 条 `done`；`DEGRADED` 被吞，客户端 `phase=done`（C-86） |
| P5 | 真实 `GAME_STARTED` 后追加 `DEGRADED` | `project()` | `UnknownEventError`（C-85） |
| P6 | `parseSseLine('data: {"type":"delta"}')` | 临时测试 | 返回 `{"type":"delta"}`；`parseSseData` 返回 `undefined`（C-94） |
| P7 | `llm/stream.ts:18` 去掉 `{ stream: true }` | `tests/server/stream.test.ts` AC-6 | **2 failed / 4 skipped**，出现 `\uFFFD`（AC-6 被锁住） |
| P8 | 两段发言走同一个 reducer | 临时测试 | `text=第一段第二`、`firstDeltaAt=200`（C-89） |
| P9 | 两条 `SPEECH` 经 `messagesFor` → reducer | 临时测试 | 最终 `text=第一段`、`lastId=3`（C-86 / C-89） |

**恢复校验**：

```
$ md5 -q src/server/routes/stream.ts src/client/use-stream.ts src/server/llm/stream.ts
b6a4cf0da89f9063ef16428593c0e2b9
b2feb89232e76e42876d9c2e8809a985
6a2b4b64a53b3e454314db78e7812453

$ md5 -q /tmp/howl-rfc010-backup/stream.ts /tmp/howl-rfc010-backup/use-stream.ts /tmp/howl-rfc010-backup/llm-stream.ts
b6a4cf0da89f9063ef16428593c0e2b9
b2feb89232e76e42876d9c2e8809a985
6a2b4b64a53b3e454314db78e7812453

$ git status --porcelain
（空）

$ pnpm test
 Test Files  68 passed (68)
      Tests  552 passed (552)
```

临时探针测试文件已删除；仓库没有新增探针文件。

---

### 7. 结论

- **Overall Risk Level: High**
- **Summary**：前端纯 reducer 的方向符合 A 方案，AC-6 的 UTF-8 增量解码和 D-3 的单测都是有效的；但服务端没有「全做」——SSE 路由只把事件流一次性映射成 `done`，降级只有 helper、没有调用链，`DEGRADED` 甚至不能被 `applyEvent` / `project` 折叠。12 条 AC 里只有 AC-6 完全通过，AC-1 ~ 5 是单元 PARTIAL，AC-7 ~ 12 没有会红的端到端测试。
- **Blocking Issues**：C-85（`DEGRADED` 不能折叠 / 无产出）、C-86（SSE 路由全 `done` + 客户端丢后续 `done`）、C-87（降级无生产调用链 / AC-8 自证）、C-88（`Last-Event-ID` 窗口丢事件）、C-89（reducer 跨发言不重置）。
- **Improvement Suggestions**：C-90（D-2 回归锁）、C-91（`ARCH-2` 例外）、C-92（文档 / 测试计划 / §8.4 回写）、C-93（p95 采样口径）、C-94（`parseSseLine` 校验）、C-95（小项）。
- **Suggested status**：**`Changes requested`**。

---

### 8. Open conflicts（已登记到 `RFCS.md` §8.31）

- **C-91**：`RULES.md:127` 的 `ARCH-2`（`src/shared/` 只放类型与纯常量）vs `src/shared/stream.ts:33-50` 的运行时编解码。按权威顺序先记录冲突；建议 `/manage-changes` 扩展 C-13 / C-57 的例外，或把编解码移到 `src/server/`。
- **C-86（归属部分）**：RFC-010 §8.6 把「持续推送」归给 RFC-012，但 RFC-011 §2.3 / §3 的 `SseOutputChannel` 才是服务端通道，RFC-012 是界面。两处必须选一处，不能把服务端工作记到 UI RFC 上。
- **C-92**：RFC-010 §8.4 的 AC-8 / 9 / 10 / 11 / 12 PASS、§2.3 的「RFC-007 重试」、`TEST-STRATEGY.md` 的 RFC-010 计划、`README.md:11,36-38` 的状态互相不一致；本轮按「代码 + 实测」判，文档待回写。
