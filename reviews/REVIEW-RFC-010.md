# RFC-010 评审 · 流式发言、思考指示与降级

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-19（Round 6；Round 5 / 4 / 3 / 2 / 1 同日）
> **分支 / HEAD**：`main` / `be4143d`
> **结论**：**Changes requested**（Round 6）
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

## Round 2 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

本轮只复核 Round 1 的五条阻塞（C-85 ~ C-89）与 C-86 的持续推送归属；C-90 ~ C-95 按用户要求不重查，状态保持 Round 1 的记录。

一句话：**C-85 已真正修好并有回归锁；C-86 只修了「下一段以 `thinking` / `delta` 开头」的客户端路径，路由仍然把每个可见事件映射成 `done`，Round 1 的 P9 可原样复现；C-87 / C-88 / C-89 都只修到「函数 / 分支存在」，没有修到「行为被端到端锁住」。** 服务端持续推送不是可选项，判断见 §3。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `ec24536`，`git status --porcelain` 为空。

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
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 65ms
vite v8.3.8 building ssr environment for production...
✓ 41 modules transformed.
dist/server/index.js  87.62 kB │ gzip: 29.33 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  68 passed (68)
      Tests  559 passed (559)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率来自 `tests/meta/coverage.test.ts` 生成的 `coverage/coverage-summary.json`（只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查核心循环 / 事件流 / 重放、服务端 SSE 与可见性、安全、测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / 首屏性能 / Playwright，因为 A 方案把界面留给 RFC-012，`tests/e2e/` 为空。HTTP 端点与事件流仍然检查，因为 `/api/games/:id/stream` 是本 RFC 的交付物。

**探针后的复跑**：所有变异探针从 `/tmp/howl-rfc010-r2-backup/` 的文件备份恢复（**没有使用 `git checkout`**），四处 `md5` 与备份逐一相同；临时探针文件已删除；`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **68 files / 559 tests 全绿**。没有 `git commit`。

---

### 1. 五条阻塞的复核

#### C-85 · `DEGRADED` 折叠 —— **关闭**

- `src/engine/apply.ts:90-93` 已增加 `DEGRADED` 分支，把席位追加到 `state.degradations`；`src/shared/domain.ts:119` 有字段；`tests/engine/replay.test.ts:292-301` 的「未实现事件」样本换成了真正不存在的 `NOT_A_REAL_EVENT`。
- `tests/server/stream.test.ts:176-200` 用真实 `GAME_STARTED` + 追加 `DEGRADED` 后 `replay()`，断言 `state.degradations === [2]`。**M3** 删掉 `apply.ts` 的 `DEGRADED` 分支后该用例 1 红——行为被锁住。
- 留有两条非阻塞尾巴（归入 C-92 / C-95）：`PAYLOAD_SCHEMAS`（`src/shared/schemas.ts:231-248`）仍没有 `DEGRADED`；`src/shared/domain.ts:118` 的「药水位」注释被 `degradations` 顶替，`potionsUsed` 失去了注释。`project()` 没有专门用例，但它与 `replay()` 共用 `applyEvent`，风险低。

#### C-86 · SSE 路由 / 客户端分段 / 持续推送 —— **仍 Open（阻塞）**

**① 客户端：`use-stream.ts:44` 仍会丢掉下一段发言的 `done`。**

```ts
if (state.phase === 'done' && message.type === 'done') return state;
```

这不是 Round 1 建议的「只在终结类消息上按 `<=` 判」：它按**阶段**判，而不是按**发言 id** 判。只要上一段已经 `done`，任何 id 更大的 `done` 都被吞掉。P-R2-A：

```
两个 done（id=3 "第一段"，id=9 "第二段"）
→ {"phase":"done","seat":1,"text":"第一段","lastId":3,"speechId":3,...}
```

新增的 C-89 用例（`tests/client/use-stream.test.ts:70-93`）只覆盖「新一段以 `thinking` 开头」和「新一段以 `delta` 开头」；`tests/client/use-stream.test.ts:44-52` 只覆盖「同一个 id 的 `done` 重放」。**没有任何用例覆盖「上一段 done 之后，下一段只有一个 done」**，而这正是当前路由实际发出的形状。

**② 路由：`routes/stream.ts:37-45` 仍把每一个可见事件都映射成 `done`，不读事件类型。**

P-R2-D（真实 `messagesFor`）：

```
SPEECH(seq=3,"第一段") / DEGRADED(seq=4) / SPEECH(seq=9,"第二段")
→ [{"type":"done","id":3,"seat":1,"text":"第一段"},
   {"type":"done","id":4,"seat":2,"text":""},
   {"type":"done","id":9,"seat":2,"text":"第二段"}]

经 streamReducer 后：
→ {"phase":"done","text":"第一段","lastId":3,"speechId":3,...}
```

`DEGRADED` 变成空文本 `done`（不是 `degraded`），`PHASE_CHANGED` / `DAY_STARTED` 同样变成空气泡。Round 1 的 P9 与 P4 都还能原样复现。AC-9 的「前端收到 `degraded`」、AC-2 的「done 之前至少 2 个中间态」、AC-4 的「thinking / speaking 可区分」在真实路由上都不成立。

**③ `thinking` / `delta` 根本没有生产源。**

- `src/server/llm/stream.ts` 的 `consumeStream` / `IncrementalDecoder` 只有测试调用；`src/server/llm/client.ts` 没有 `stream: true`，也没有 `reasoning_content` 的任何读取（全仓库 `grep` 零命中）。
- RFC-010 §3 的交付物写的是「`src/server/llm/stream.ts`：**流式调用**与增量解析」；当前文件只有「增量解析」，没有流式调用，也没有 OpenAI chunk → `StreamMessage` 的适配层。
- 因此 F18（Must）的「思考进度 + 逐字发言」在真实对局里没有实现点；reducer 的 `thinking` / `delta` 分支只在单测的合成消息上成立。

**④ 持续推送**：`routes/stream.ts:96` 用一次 `reply.send(...)` 写完补偿窗口；没有保持连接、没有订阅、没有「每收到一个 chunk 立刻转发」。详细归属判断见 §3。

#### C-87 · 降级编排 —— **仍 Open（阻塞，部分修复）**

**已修的部分：**

- `runTurn`（`src/server/llm/turn.ts:57-96`）确实做了「失败后重试 1 次 → 仍失败则写短句」。`tests/server/degrade.test.ts:116-137` 的「第一次失败、第二次成功」现在是真的两次调用，不再是传 `failed: false` 的自证。
- `tests/server/degrade.test.ts:166-190` 连续 4 轮、每轮 2 次调用，`calls === 8`；`canAttempt()` 恒 true。**M4** 把 `index < 2` 改成 `index < 1` 后该文件 3 红——重试与「第 4 次仍调用」被锁住。

**没修的部分：**

1. **真实失败模式会直接抛出，不会重试也不会降级。** `src/server/llm/client.ts:189` 的 `decide()` 在重试用尽后 `throw lastError`；`runTurn` 的 `last = await input.attempt()`（`turn.ts:64`）没有 `try/catch`。P-R2-CC：

   ```
   attempt 抛 Error('LlmError: 调用超时') → calls=1, runTurn rejected（没有第二次调用，没有降级）
   ```

   也就是说，`runTurn` 只适配「返回 `{ failed: true }`」的假客户端；真实调用方的契约是 `throw`。除非调用方每次自己包一层 catch，否则 AC-7/8 的失败路径不成立。这一层适配要么放进 `runTurn`，要么把它明确写成调用方义务并测试。

2. **硬超时预算没有在重试前检查，第二次尝试可以把 30 秒变成 60 秒。** `turn.ts:68-75` 的 `decideDegrade` 在两次 `attempt` **之后**才看 `now()`。P-R2-E：`limitMs=30_000`、每次 `attempt` 消耗 20 秒 →

   ```
   calls=2, attempts=2, clock=40_000, degraded=true
   ```

   真实 `decide()` 的 `AbortSignal.timeout(30_000)` 也是每次调用独立计时，所以「第一次 30 秒超时、第二次再 30 秒」会到 60 秒，违反 NFR-1 的「硬超时 30 秒后必须降级」。需要在每次重试前算剩余预算（或把 `AbortSignal` / `remaining` 传进 attempt），并补一条「第一次已用掉预算时不再重试」的用例。

3. **`degradeEvents` 不是可直接写入引擎的事件。** `turn.ts:98-110`：

   ```ts
   degradeEvents({ gameId: 'g', ts: 1, seat: 2, text: '我先过。', seq: 41 })
   → [{ type: 'DEGRADED', payload: { seat: 2 } },
      { type: 'SPEECH', payload: { seat: 2, text: '我先过。' } }]
   ```

   `gameId` / `ts` / `seq` 三个入参**完全没被使用**（seq=41 与 seq=99 的输出逐字相同），返回值缺 `gameId` / `seq` / `ts` / `visibleTo`，两个事件也没有 `seq` 与 `seq+1` 的区分。`tests/server/degrade.test.ts:139-164` 只断言 `['DEGRADED','SPEECH']`，没有把它喂给 `replay()` / `applyEvent()`，没有断言 `state.speech.spoken` 前进，也没有断言 seq 连续。Round 1 要求的「下一席位前进、seq 连续」仍未验收。**而且写回路径也不存在**：`GameRegistry` 只有 `submit(action)`（`src/server/store/game-registry.ts:178`），没有追加原始事件的入口；降级短句也没有走 `SPEAK` action / `toAction`。即使 helper 返回完整 envelope，当前也没有把它写进 record 的 API。

4. **仍没有生产调用者，且没有按 Round 1 允许的方式记录交接。** `grep runTurn src` 只命中定义本身；RFC-011 的 orchestrator 还没开工。Round 1 说「如果本 RFC 不做编排，就把它明确交给 RFC-011 并在 §8.6 / §8.4 如实记录」；当前 §8.4 仍把 AC-10 写成 `PASS（事件已在 RFC-005 定义）`，§8.6 没有提到 `runTurn` / RFC-011，`RFCS.md` §3 的依赖表里 RFC-010 仍然没有后继。代码接缝可以接受，**声明不能接受**。

5. 次要：`runTurn` 自己重试 1 次，而 `decide()` 的 `maxRetries` 默认也是 1；若调用方自然地把 `decide` 包成 `attempt`，一次发言最多 4 次调用，不是 AC-8 的「重试 1 次」。需要明确「重试只能有一层」，并在文档 / 测试里固定。

#### C-88 · `Last-Event-ID` 超窗信号 —— **仍 Open（阻塞，部分修复）**

**代码逻辑本身是对的：**

- `routes/stream.ts:73-87` 先算窗口起点，`lastEventId < oldestInWindow` 时返回 `SNAPSHOT_REQUIRED`。P-R2-B：`last-event-id: 50` → body 为 `id: 50\ndata: {"type":"error","id":50,"message":"SNAPSHOT_REQUIRED"}`；P-R2-B2：`last-event-id: 100` → 200 帧，第一条 `id: 101`。不再静默丢 51..100。

**两个问题：**

1. **测试没有打到路由。** `tests/server/stream.test.ts:202-232` 只调用 `messagesFor`，然后自己算 `windowStart` / 断言 `50 < 101`；它没有注入 `Last-Event-ID`、没有调 `registerStreamRoutes`、没有读响应。**M1** 把整个 `if (hasGap) { ... }` 删掉后 `tests/server/stream.test.ts` **8/8 全绿**。按 TEST-1，这不是回归锁。
2. **`SNAPSHOT_REQUIRED` 的响应 MIME 是 `text/plain`。** `reply.header('content-type', 'text/event-stream')`（`:91-94`）在 gap 分支之后才设置；gap 分支直接 `reply.send(frame)`，P-R2-B 实测：

   ```
   content-type: text/plain; charset=utf-8
   body: id: 50\ndata: {"type":"error","id":50,"message":"SNAPSHOT_REQUIRED"}\n\n
   ```

   浏览器 `EventSource` 收到非 `text/event-stream` 会中止连接，`SNAPSHOT_REQUIRED` 根本到不了客户端 reducer。修法：把 `content-type` / `cache-control` 头移到 gap 分支之前，并用 `app.inject` 断言 header 与 body。

3. 附带一个策略问题：300 条可见事件、**没有** `Last-Event-ID` 的新连接会得到 `id: 0 ... SNAPSHOT_REQUIRED`（P-R2-B3），而不是最近 200 条。Q-010-2 只写了「断线超出窗口」，没写「新连接」；如果这是有意的（新连接先拉 `GET /api/games/:id` 快照），请写进 §2.2 / §8.6 并补用例；如果不是，需要区分「无 Last-Event-ID」与「有但超窗」。

#### C-89 · 客户端跨发言重置 —— **仍 Open（阻塞，部分修复）**

- `text` / `firstDeltaAt` 的跨发言重置在「`thinking` 开头」和「`delta` 开头」两条路径上已修：P-R2-A2 的第二段 `text` 是 `乙`、`firstDeltaAt` 是 300；**M5** 把 `text: (sameSpeech ? state.text : '') + message.text` 改成 `state.text + message.text` 后 `tests/client/use-stream.test.ts` 1 红。这部分有效。
- **`sawThinking` 仍然跨发言保留。** `use-stream.ts:48-51` 的 `base` 只在 `message.type === 'thinking'` 时重置；`delta` / `done` / `degraded` 的新发言分支都不重置。P-R2-A2：

  ```
  第一段 thinking(id=1) → delta(id=1) → done(id=1)
  第二段 delta(id=2, 没有 thinking)
  → {"phase":"speaking","text":"乙","firstDeltaAt":300,"sawThinking":true}
  ```

  AC-4 的「当前这段发言是否经历过思考」从第二段起就是错的；RFC-012 若用 `sawThinking` 决定是否显示「思考过」的标识，会显示假阳性。
- `done` 分支（`use-stream.ts:76-84`）也没有重置 `sawThinking` / `firstDeltaAt`；对于「只有 done、没有 delta」的发言（恰好是当前路由的形状），`firstDeltaAt` 会停在上一段。`use-stream.ts:81` 还有一个死三元：`state.speechId === message.id ? message.text : message.text`，两个分支相同。
- 补测：① 上一段 `thinking+delta+done`，下一段**只有 delta**，断言 `sawThinking === false`；② 上一段有 delta，下一段**只有 done**，断言 `firstDeltaAt` 被重置（或明确 null 的语义）。

---

### 2. 逐条验收标准（本轮受影响的部分）

> `PASS` 只给「有测试会在行为退化时变红」的项；手工项按 D-6 记录。

| AC | 证据 | 判定 |
|---|---|---|
| 1 | reducer 的 `thinking` / 首 `delta` 口径存在；但服务端没有首事件时间，`thinking` 没有生产源；per-speech `firstDeltaAt` 只在 thinking/delta 开头时正确 | **PARTIAL** |
| 2 | 路由不发 `delta`；只有 `done`；第二段 `done` 被 `:44` 丢掉（P-R2-D）；50 字中间态没有测试 | **FAIL** |
| 3 | 真实 p95 是手工项（D-6，接受）；当前没有可采样的服务端时间点 | **PARTIAL（记录）** |
| 4 | `phase` 可区分，但真实流里没有 `thinking`；`sawThinking` 跨发言不重置（P-R2-A2） | **FAIL** |
| 5 | 窗口信号逻辑正确，但测试没打到路由（M1 全绿）；error 帧 MIME 错；第二段 `done` 丢失 | **FAIL** |
| 6 | 逐字节中文解码；Round 1 的 P7 已锁住 | **PASS** |
| 7 | `decideDegrade` 的超时判定有单测；`runTurn` 没有超时用例，且重试可在 30 秒后再等一轮（P-R2-E）；`DEGRADED` 没有生产产出 | **NEEDS WORK** |
| 8 | `runTurn` 的「失败→成功」是真重试（M4 锁住）；但真实 `decide()` 抛错时直接 reject（P-R2-CC） | **PARTIAL** |
| 9 | 路由把 `DEGRADED` 映射成空 `done`，客户端收不到 `degraded`（P-R2-D） | **FAIL** |
| 10 | `degradeEvents` 不是可直接写入引擎的事件；没有 `speech.spoken` / seq 连续性测试；没有调用者 | **FAIL** |
| 11 | `DEGRADED` 可 replay 且状态累计席位；但没有测试把事件对应到轮次，`degradations` 只记席位不记轮次 | **PARTIAL** |
| 12 | 4 轮 × 2 次调用，`canAttempt` 恒 true（M4 锁住重试） | **PASS** |

> TEST-STRATEGY 把 AC-7/8/9/10/11/12 标成 `Should`；即便如此，本轮仍把 C-87 列为阻塞，因为 §8.4 把 AC-10 写成 PASS、而 F19 的核心路径（真实失败 → 降级 → 推进）没有被任何测试端到端验证。

---

### 3. C-86 的服务端持续推送，是否必须在本 RFC 内完成？

**判断：必须在本 RFC 内完成「服务端把增量推给浏览器的能力」；「谁生产这个增量」的实现（`SseOutputChannel` + orchestrator）可以放在 RFC-011。把整件事记到 RFC-012 是不成立的。**

理由，按权威顺序：

1. **RFC-010 的正文与 AC 就是规范。** §2.1（`RFCs/RFC-010...:21-28`）写「THINKING 一开始就向前端推一个 `thinking` 事件」「正文到达后逐字推送」；§2.2（`:30-35`）定义端点、事件类型和 `Last-Event-ID`；§4（`:65-67`）要求 `delta` 不写入事件流、但要在 `done` 前到达；§6（`:89`）要求「每收到一个 chunk 必须立刻转发，不攒批」。AC-1 / 2 / 4 / 5 / 9 全部依赖这条实时链路。一次性 `reply.send` 无法满足其中任何一条：`delta` 按 §4 不落事件流，路由读 `record.events` 永远读不到它。
2. **用户批准的 A 方案是「服务端全做」。** §8.1（`:105-109`）的记录是「先做服务端（SSE、流式解析、降级），前端做成不依赖 DOM 的纯状态机并单测；界面留到 RFC-012」。被推迟的只有**界面**，不是服务端 SSE。§8.6 把「真实 SSE 长连接」记成 RFC-012，与 §8.1 的批准范围相矛盾。
3. **归属也写错了。** RFC-011 §2.3（`RFCs/RFC-011...:44-58`）明确 `SseOutputChannel` 是「把增量推到 RFC-010 的 SSE 端点」，交付物是 `src/server/channels/sse.ts`；RFC-012 是界面（`SpeechFeed.tsx` 等），它不负责服务端通道。服务端端点的实时能力属于 RFC-010，生产侧通道属于 RFC-011；把两者一起推给 RFC-012，既不符合 RFC-010 的 AC，也不符合 RFC-011 的交付物定义。
4. **依赖表没有交接记录。** `RFCS.md` §3 里 RFC-010 的直接后继是「—」，RFC-011 的直接前置只有 005 / 007。如果正式把持续推送交给 RFC-011，就必须把 RFC-011 加入 RFC-010 的后继 / RFC-010 加入 RFC-011 的前置，并同步 RFC-010 §3 / §5 / §8.4 与 `TEST-STRATEGY.md`。只在 §8.6 写一句「留到 RFC-012」不是交接，是未记录偏离（`DOC-1`）。
5. **可行的最小切分**（既不越到 RFC-011 的 orchestrator，又能验收 AC）：
   - RFC-010：`src/server/llm/client.ts` 的流式调用（`stream: true`）+ `reasoning_content` / content 增量映射；`src/server/llm/stream.ts` 的 OpenAI chunk → `StreamMessage` 适配；`src/server/routes/stream.ts` 的保持连接 / 订阅 / 按 chunk 写帧；测试用 stub 生产者覆盖 `thinking` → `delta` → `done`、`DEGRADED` → `degraded`、`Last-Event-ID` 续传。
   - RFC-011：`SseOutputChannel` 把 orchestrator 的增量交给 RFC-010 的端点/订阅；玩家输入与通道抽象。
   - 这样 RFC-010 不依赖 orchestrator 就能验收「`done` 前至少有 2 个中间态」「`thinking` / `speaking` 可区分」「`degraded` 到达」「断线不重不漏」。
6. **如果产品负责人确实要推迟**：这属于需求/验收范围变更，按 `AGENTS.md` 硬规则 6 走 `/manage-changes`，正式改 RFC-010 的 AC / 交付物 / 依赖表，并把 RFC-010 的状态留在 `Changes requested` 或 `Spec changed`；不能在 §8.4 继续标 PASS 后把 RFC 标成 `Reviewed`。

**一句话回答**：服务端持续推送必须在本 RFC 内完成「端点能实时把增量推给浏览器」这一半；只把 `SseOutputChannel` / orchestrator 放 RFC-011 是可以的，但 RFC-010 必须留下可被它推送的实时端点、适配层和测试。当前一次性 `reply.send` + 没有 `thinking` / `delta` 生产源的实现不满足这条。

---

### 4. 非阻塞发现与未重查项

- **C-90（未重查，仍非阻塞）**：`routes/stream.ts:35` 仍用 `isVisibleTo(event, seat, state)` 对全部历史做最终状态判定；`wolves` / `self:<n>` 分支仍没有回归锁（Round 1 的 P1）。建议复用 `GameRegistry.visibleEventsOf`。
- **C-91（未重查，仍非阻塞）**：`src/shared/stream.ts:33-50` 的运行时编解码仍扩大 `ARCH-2` 例外，未登记到 `RULES.md`。
- **C-92（未重查，仍非阻塞；本轮新增两处证据）**：`TEST-STRATEGY.md:3` 仍引 `RFCS.md v2.65`，`:302-312` 的 RFC-010 计划仍全是 `proposed` 且文件名与实际不符（`sse.test.ts` / `replay-degrade.test.ts` / `stream.spec.ts` 不存在；`stream.test.ts` / `use-stream.test.ts` 未登记）；`README.md:9-13,36-40` 仍写「7 Reviewed / RFC-008 等待评审」；RFC-010 §8.4 仍把 AC-10 / 11 写成 PASS；`PAYLOAD_SCHEMAS` 仍缺 `DEGRADED`。
- **C-93（未重查，仍非阻塞）**：p95 的服务端首事件时间仍未记录；`streamReducer` 的 `now` 仍是第三参数（`useReducer` 下会恒为 0），需要把 `receivedAt` 放进 action 或由外层记录；没有 per-speech 样本数组。
- **C-94（未重查，仍非阻塞）**：`src/server/llm/stream.ts:36-52` 的 `parseSseLine` 仍只检查 `type`，绕过 `StreamMessageSchema`。如果按 §3 的切分补上流式调用，这条会在生产路径上被放大，建议一起修。
- **C-95（未重查，仍非阻塞；新实例）**：`src/shared/domain.ts:118` 的注释错位；`src/client/use-stream.ts:81` 的死三元；`src/server/llm/turn.ts:98-110` 的未使用入参；`markUnstable` 仍硬编码 `3`。

---

### 5. 五个审查维度

#### 5.1 RFC ADHERENCE —— **FAIL**

- 12 条 AC 中 AC-6 完全通过，AC-12 通过；AC-1 / 3 / 11 是 PARTIAL；AC-2 / 4 / 5 / 9 / 10 失败；AC-7 / 8 仍缺真实失败路径与超时预算。
- 缺功能：服务端流式调用（`stream: true`）、`reasoning_content` 映射、`thinking` / `delta` / `degraded` 的产出与路由映射、实时 SSE 订阅、`degradeEvents` 的引擎可写入性、`runTurn` 的异常 / 超时处理。
- 多做的部分：`messagesFor` 继续把非发言事件映射成空 `done`，这是协议之外的语义，会在界面上产生空气泡。

#### 5.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：`src/engine/` 没有新增 UI / server / 网络依赖。 |
| `ARCH-2` | **NEEDS WORK**：`src/shared/stream.ts` 的运行时编解码仍未登记（C-91）。 |
| `ARCH-4` | **PASS**：降级决策仍是纯函数；`runTurn` 的时钟由调用方注入。 |
| `DATA-1` | **PASS**：SSE 消息的 `id` 取事件 `seq`；`DEGRADED` 折叠后 `seq` 仍由 `applyEvent` 统一推进。 |
| `DATA-3` | **PASS（本轮修复）**：`DEGRADED` 可 replay；M3 删掉分支会红。 |
| `API-1` | **PARTIAL**：`StreamMessageSchema` 在 shared；`parseSseLine` 仍绕过它（C-94）。 |
| `API-2` | **PARTIAL**：`id === seq` 只在 `done` 上成立；`thinking` / `delta` / `error` 的生产路径缺失。 |
| `TEST-1` | **FAIL**：C-88 的修复没有会红的测试（M1）；C-87 的引擎推进 / seq 连续没有测试；C-86 的第二段 `done` 没有测试。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未因本 RFC 下降。 |
| `DOC-1` | **FAIL**：§8.4 的 AC-10 / 11 PASS、§8.6 的 RFC-012 归属、§8.7 的「已修复」与实测不符。 |
| `AI-3` / `AI-7` | **PASS（未改）**：本 RFC 没有改调用超时 / 重试配置；但 `runTurn` 的重试与 `decide()` 的 `maxRetries` 叠加风险见 C-87。 |
| `SEC-5` | **PASS（数据面）**：SSE 只发可见事件，没有直接序列化完整 `GameState`；会话检查仍在（`routes/stream.ts:52-57`）。 |

#### 5.3 SECURITY —— **PASS**

- 路由先 `resolveSession` 再检查 `session.gameIds.includes(record.gameId)`，没有会话不能读别人的局。
- 可见性由 `isVisibleTo` 统一判定；没有手写 `wolves` 规则；当前 fixture 下没有发现泄漏。
- `SNAPSHOT_REQUIRED` 帧只回显客户端提供的 `Last-Event-ID`，不泄漏服务端状态。
- 没有新增密钥、日志或错误响应里的敏感数据；SSE 的 `data` 是 `JSON.stringify`，换行被转义，不能注入帧。
- 缺口仍是回归锁：D-2 的 `wolves` / `self:<n>` 用例不存在（C-90，未重查）。

#### 5.4 PERFORMANCE —— **NEEDS WORK**

- 一次性 `reply.send` 每次重连都跑 `registry.stateOf(record)`（完整 replay）+ `messagesFor` 全量过滤；`EventSource` 自动重连会把「历史回放」变成每几秒一次的 O(n) 重算。真正的实时推送没有，所以 p95 无法测。
- `consumeStream` 每 chunk 立即回调，本身不攒批；但它没有生产调用者。
- 没有新增 LLM / 数据库 / 网络调用；`runTurn` 的重试最多 2 次（或 4 次，若与 `decide()` 叠加），需要明确的预算。

#### 5.5 MAINTAINABILITY —— **NEEDS WORK**

- `use-stream.ts` 的 `phase === 'done'` 去重与 `speechId` 语义脱节；`done` 分支有死三元；`sawThinking` 的重置分散在 `base` / `delta` / `done` 三处且不一致。
- `routes/stream.ts` 的 `messagesFor` 用 `payload as { seat?; text? }` 与 `as never` 绕过事件 payload 类型；仍然重复 `visibleEventsOf` 的过滤。
- `turn.ts` 的 `degradeEvents` 入参 / 返回类型与真实 `GameEvent` 脱节；`RunTurnInput` 没有超时 / 取消信号。
- 测试计划与实现文件名脱节（C-92）；`tests/server/stream.test.ts:202-232` 的「窗口」用例是常量 / 算术自证。
- 正向：C-85 的折叠与 M3 锁、`runTurn` 的重试与 M4 锁、C-89 的 `text` / `firstDeltaAt` 与 M5 锁都是有效的；`IncrementalDecoder` 的 `{ stream: true }` 注释与 AC-6 的逐字节测试仍然可靠。

---

### 6. 变异探针与恢复

备份在 `/tmp/howl-rfc010-r2-backup/`，覆盖 `src/server/routes/stream.ts`、`src/client/use-stream.ts`、`src/server/llm/turn.ts`、`src/engine/apply.ts`。每个探针用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 注入 / 探针 | 跑什么 | 结果 |
|---|---|---|---|
| P-R2-A | 两个 `done`（id 3 / id 9）经 `streamReducer` | 临时测试 | `text=第一段`、`lastId=3`（C-86 第二段 `done` 被吞） |
| P-R2-A2 | `thinking`+`delta`+`done` 后，新一段只有 `delta` | 临时测试 | `text=乙`、`firstDeltaAt=300`、`sawThinking=true`（C-89） |
| P-R2-B | 300 条可见事件、`Last-Event-ID: 50` 调真实路由 | 临时测试 | body 为 `SNAPSHOT_REQUIRED`，但 `content-type: text/plain; charset=utf-8`（C-88） |
| P-R2-B2 | 同上、`Last-Event-ID: 100` | 临时测试 | 200 帧，首帧 `id: 101`（窗口逻辑正确） |
| P-R2-B3 | 300 条可见事件、无 `Last-Event-ID` | 临时测试 | `id: 0 ... SNAPSHOT_REQUIRED`（策略待定） |
| P-R2-CC | `runTurn` 的 attempt 抛错；`degradeEvents` seq 41 vs 99 | 临时测试 | `calls=1` 且 rejected；两次输出完全相同（C-87） |
| P-R2-D | 真实 `messagesFor`：`SPEECH` / `DEGRADED` / `SPEECH` → reducer | 临时测试 | 3 条 `done`；`DEGRADED` 空文本；最终 `text=第一段`、`lastId=3`（C-86） |
| P-R2-E | `limitMs=30_000`、每次 attempt 20 秒 | 临时测试 | `calls=2`、`clock=40_000`、`degraded=true`（C-87 超时预算） |
| M1 | 删掉 `routes/stream.ts:80-87` 的 `hasGap` 分支 | `tests/server/stream.test.ts` | **8/8 全绿**（C-88 未被锁） |
| M3 | 删掉 `apply.ts:90-93` 的 `DEGRADED` 分支 | `tests/server/stream.test.ts` | **1 failed / 7 passed**（C-85 被锁） |
| M4 | `turn.ts:62` 的 `index < 2` 改成 `index < 1` | `tests/server/degrade.test.ts` | **3 failed / 9 passed**（重试被锁） |
| M5 | `use-stream.ts:70` 去掉 `sameSpeech ? '' : ...` 的重置 | `tests/client/use-stream.test.ts` | **1 failed / 6 passed**（`text` 重置被锁） |

**恢复校验**：

```
$ md5 -q src/server/routes/stream.ts src/client/use-stream.ts src/server/llm/turn.ts src/engine/apply.ts
faa56ac3f4a9964124601575408b7fd4
0496fc460c0e726340cdee6572304563
8ac9ee7d841bd37064002c1892bd4780
a3d30bb6e091ee29cfff48acec20c46f

$ md5 -q /tmp/howl-rfc010-r2-backup/stream.ts /tmp/howl-rfc010-r2-backup/use-stream.ts /tmp/howl-rfc010-r2-backup/turn.ts /tmp/howl-rfc010-r2-backup/apply.ts
faa56ac3f4a9964124601575408b7fd4
0496fc460c0e726340cdee6572304563
8ac9ee7d841bd37064002c1892bd4780
a3d30bb6e091ee29cfff48acec20c46f

$ git status --porcelain
（空）

$ pnpm test
 Test Files  68 passed (68)
      Tests  559 passed (559)
```

临时探针文件 `tests/server/__r2-probe.test.ts` / `tests/server/__r2-timeout-probe.test.ts` 已删除；仓库没有新增探针文件。

---

### 7. 结论

- **Overall Risk Level: High**
- **Summary**：C-85 已修好并有回归锁；C-87 / C-88 / C-89 的代码接缝存在，但关键行为（真实 `decide()` 抛错、30 秒硬超时预算、路由超窗响应、`sawThinking` 跨发言）都没有端到端测试，C-88 的修复在 M1 下完全不受保护。C-86 是最大的缺口：路由仍把每个可见事件变成 `done`，`DEGRADED` 变成空 `done`，第二段 `done` 被客户端吞掉，且没有 `thinking` / `delta` 的生产源；服务端持续推送被错误地记到 RFC-012，而不是 RFC-010 的端点 + RFC-011 的通道。
- **Blocking Issues**：C-86（路由映射 / 第二段 `done` / 实时流与归属）、C-87（真实失败、超时预算、`degradeEvents` 可写入性、未记录的 RFC-011 交接）、C-88（测试未打到路由、`SNAPSHOT_REQUIRED` MIME）、C-89（`sawThinking` / done-only 重置）。
- **Improvement Suggestions**：按 §3 的最小切分补实时端点；把 `use-stream.ts:44` 改成按 `speechId` 去重并在任何新发言起点重置 `sawThinking` / `firstDeltaAt`；把 SSE 头移到 gap 分支之前；让 `degradeEvents` 返回完整 `GameEvent[]` 并用真实 `DAY_SPEECH` 状态断言 `speech.spoken` + `seq`；让 `runTurn` catch 异常并在每次重试前检查剩余预算；补 `DegradedPayloadSchema`、更新 `TEST-STRATEGY.md` / `README.md` / §8.4。
- **Suggested status**：**`Changes requested`**。

---

### 8. Open conflicts（登记到 `RFCS.md` §8.31 Round 2 段）

- **C-86 归属**：RFC-010 §8.6 把持续推送记给 RFC-012；RFC-011 §2.3 / §3 说 `SseOutputChannel` 才是把增量推到 RFC-010 端点的那一层；RFC-012 是界面。本轮按「RFC-010 端点实时能力 + RFC-011 生产通道」判，反对整件事记到 RFC-012。若正式改派，走 `/manage-changes` 并更新依赖表。
- **C-87 交接**：RFC-010 §8.4 把 AC-10 写成 PASS，但 `runTurn` / `degradeEvents` 没有生产调用者，`RFCS.md` §3 里 RFC-010 也没有后继。按「代码 + 实测」判为未验收；若把调用方交给 RFC-011，必须把 RFC-011 加入依赖并改 §8.4 / §8.6。
- **C-88 新连接**：Q-010-2 只规定「断线超出窗口」；当前实现把无 `Last-Event-ID` 的新连接也判成 `SNAPSHOT_REQUIRED`。本轮按保守解释接受，但要求写进协议或区分两种情形。
- **C-92**：`TEST-STRATEGY.md` / `README.md` / RFC-010 §8.4 与实现仍不一致；本轮按代码 + 实测判，文档待回写。

## Round 3 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

本轮只复核 Round 2 的四条阻塞（C-86 / C-87 / C-88 / C-89）与用户点名的四项修复。C-85 已于 Round 2 关闭；C-90 ~ C-95 是非阻塞项，本轮不重查（状态保持 Round 1 / 2 的记录）。

一句话：**C-88 的两条阻塞真正关闭了；C-87 的「接住抛错」和「真实 `EventEnvelope`」成立，但「整体预算」仍不成立；C-86 只修好了「实时管道本身」，补偿 / 重连路径仍把每个可见事件映射成 `done`、客户端仍吞掉第二段 `done`，按路由真实回放后客户端一条发言都看不到；C-89 的 `sawThinking` 只在以 delta 开头的新发言上重置，done-only 的新发言仍保留上一段，且这条修复没有测试锁。**

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `066f554`，`git status --porcelain` 为空。

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
✓ built in 77ms
vite v8.3.8 building ssr environment for production...
✓ 42 modules transformed.
dist/server/index.js  89.85 kB │ gzip: 29.94 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  68 passed (68)
      Tests  564 passed (564)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率来自 `tests/meta/coverage.test.ts` 生成的 `coverage/coverage-summary.json`（只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查核心循环 / 事件流 / 重放、服务端 SSE 与可见性、安全、测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / 首屏性能 / Playwright，因为 A 方案把界面留给 RFC-012，`tests/e2e/` 为空。HTTP 端点与事件流仍然检查，因为 `/api/games/:id/stream` 是本 RFC 的交付物。

**探针后的复跑**：所有探针都是独立临时测试文件，没有改源码（本轮只做了两次变异 M1 / M2）；M1 / M2 改过的文件从 `/tmp/howl-rfc010-r3-backup/` 的文件备份恢复（**没有使用 `git checkout`**），四处 `md5` 与备份逐一相同；临时探针文件已删除；`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **68 files / 564 tests 全绿**。没有 `git commit`。

---

### 1. C-86 · SSE 实时流 —— **仍 Open（阻塞）**

本轮新增的 `StreamBus` + `PassThrough` **确实把「连接建立之后的实时推送」做出来了**，这是相对 Round 2 的实质进步；但 C-86 的四条旧缺口只关掉了「没有长连接」这一条，另外三条仍在，并新增一条协议级阻塞（C-96）。

#### ① 已修：连接建立后的增量推送

- `src/server/stream/bus.ts:24-85`：`publish` / `subscribe` / `replay` / `end`，200 条窗口。
- `src/server/routes/stream.ts:67-103`：`content-type: text/event-stream` 先设置；`PassThrough` 保持连接；先补 committed、再补 bus 增量（`:82-86`），最后 `subscribe`（`:88-90`）；`request.raw.on('close')` 清理订阅（`:98-101`）。
- `tests/server/stream.test.ts:245-273`：连接后 `bus.publish` 四条消息，断言响应里 `types === ['thinking','delta','delta','done']`。这条用例确实覆盖了「端点能把连接建立后的增量写出去」，Round 2 的「`delta` 按 §4 不落事件流，读 `record.events` 永远读不到」这一半已解决。

#### ② 仍 Open：补偿 / 重连路径没有把 committed 与 bus 增量合并好（P3）

`routes/stream.ts:81-86` 的顺序是「先写全部 committed，再写全部 bus replay」。当 bus 里同一段发言的增量与 committed 里的 `done` 共享同一个 `seq`（D-3）时，重连会先收到 `done`、再收到 `thinking` / `delta`。

P3（真实对局 + 真实 SPEECH seq 15，bus 里发布同 seq 的 `thinking` / 首字 `delta`，带 `Last-Event-ID: 14` 重连）：

```
messages= [["done",15],["thinking",15],["delta",15]]
经 streamReducer 后：
{"phase":"speaking","seat":2,"text":"第","firstDeltaAt":300,"lastId":15,"speechId":15,"sawThinking":true}
```

客户端最终停在 `speaking`，正文只有「第」——完整发言被 committed 的 `done` 写过一次，又被总线增量冲掉。若生产者把 `done` 也发布到总线（bus.ts 的文件注释明确说 `done` 也走总线），则 committed `done` 与总线 `done` 是同一 id 的重复消息；`use-stream.ts:44` 的 phase 去重会让结果取决于消息顺序，而不是协议。

这不是「多收几条」的小问题：**AC-5 的「不重复、不丢失」在这条真实重连路径上不成立**，Round 1 的 P9 / Round 2 的 P-R2-D 仍可复现。

#### ③ 仍 Open：路由继续把每一个可见事件映射成 `done`（P4）

`routes/stream.ts:30-45` 没有读 `event.type`，`SPEECH` / `DEGRADED` / `DAY_STARTED` / `PHASE_CHANGED` 一律变成 `done`，文本取 `payload.text ?? ''`。

P4（真实对局 events + 追加一条 `DEGRADED` seq 16）：

```
last = {"type":"done","id":16,"seat":2,"text":""}
```

`DEGRADED` 仍然到不了客户端的 `degraded` 分支，AC-9 的「降级时前端收到 `degraded`」在历史补偿路径上仍不成立；`DAY_STARTED` 等非发言事件会产出空文本 `done`，把客户端提前置为 `done`（这正是 Round 1 / Round 2 指出的形状）。

`tests/server/stream.test.ts:117-119` 的期望集合是「全部 public 事件的 seq」，它**恰好把「每个事件都是 done」这个错误映射锁成了回归基线**；改成正确的按类型映射时，这条用例会先红。修路由映射时必须同步改这条断言。

#### ④ 仍 Open：客户端仍吞掉下一段 `done`（P1 / P10）

`src/client/use-stream.ts:43-44`：

```ts
if (state.lastId !== null && message.id < state.lastId) return state;
if (state.phase === 'done' && message.type === 'done') return state;
```

P1：

```
done(id=3,"第一段") → done(id=9,"第二段")
→ {"phase":"done","seat":1,"text":"第一段","lastId":3,...}
```

P10（走真实路由、真实一局、8 条已提交 `SPEECH`、无 `Last-Event-ID`）把响应逐条喂给 reducer：

```
P10 state= {"phase":"done","seat":1,"text":"","firstDeltaAt":null,"lastId":12,...}
```

**刷新的客户端一条发言都看不到**：第一条可见事件（空文本 `done`）就把 `phase` 置为 `done`，之后所有 `done` 被 `:44` 吞掉。新增的 C-86 实时用例用 `last-event-id: 9999` 跳过了全部 committed，正好绕开了这条路径；仓库里没有任何用例同时覆盖「路由补偿 + reducer 应用」。

修法：终结类的去重改为按「当前发言 id」的 `<=` 判（同一 id 的重复 `done` 丢弃），下一段更大 id 的 `done` 必须应用；同时修路由映射（③），两者缺一，刷新页面仍然看不到历史发言。

#### ⑤ 仍 Open：生产侧没有发布者，文档归属仍自相矛盾

- 全仓库 `grep bus.publish src/` **零命中**；`publish` 的调用者只有 `tests/server/stream.test.ts:258-261,281`。
- `src/server/llm/client.ts` 仍没有 `stream: true` / `reasoning_content`；`src/server/llm/stream.ts` 的 `consumeStream` 仍只有测试调用；`runTurn` 也没有调用者。也就是说，真实对局里 SSE 端点建立后，除 committed 历史外没有任何增量会被 publish。
- RFC-010 §8.6 仍写「真实 SSE 长连接 | 路由用 `reply.send` 一次写完… | RFC-012」——这句话现在与代码和 §8.8 都相反；`RFCS.md:74` 的依赖表里 RFC-010 的直接后继仍是「—」，RFC-011 没有登记为接收生产侧 / 调用 `runTurn` 的 RFC。§8.8 的散文提到「RFC-011 的 `SseOutputChannel` 才是生产侧落点」，但这没有同步到 §8.6 / §3 / `RFCS.md`，按 `DOC-1` 仍是未记录的交接。
- §8.4 的 AC-2 / 4 / 9 仍写 PASS，与 P1 / P3 / P4 / P10 相反。

**C-86 结论**：端点的「实时能力」这一半已经交付，但「补偿与实时合并」「按类型映射」「客户端不吞下一段」「生产侧 / 交接记录」仍未完成。按 TEST-1，至少还缺一条 route → reducer 的集成用例；P10 就是它应该锁住的行为。

#### C-96（本轮新增，阻塞）· 当前发言中途断线会丢掉剩余 delta —— D-3 与 AC-5 冲突

D-3 规定同一条发言的多个 `delta` **共享同一个 `id`**（该发言事件的 `seq`）。但路由的重连续传按 `message.id > lastEventId` 过滤（`routes/stream.ts:82-86`、`bus.ts:53-60`），客户端的 `lastEventId()` 返回的就是这个 `lastId`。

P11（真实对局 SPEECH seq 15，bus 发布 `thinking` + 首字 `delta` id 15，带 `Last-Event-ID: 15` 重连）：

```
body= "id: 23\ndata: {\"type\":\"done\",\"id\":23,...}\n\n"
ids= [23]
```

**id 15 的所有增量（包括后续 `delta` 和 `done`）都被过滤掉**；客户端停在半句话上，直到下一条更大 id 的事件把页面改写成别的形状。这是 AC-5 的「不丢失」在「断线发生在发言中途」时的直接反例，而现有用例只测了「从最后一条 id 重连返回空」。

这是规范级冲突：AC-5 / API-2 说「每条消息 id 等于对应事件的 seq，从下一个 seq 继续」，D-3 说「多个 delta 共享 seq」。两者在「发言中途断线」下不能同时满足。修法二选一（并走 `/manage-changes` 或记录为正式偏离）：

1. 给每个 `delta` 一个单调递增的 SSE id（例如 `seq * 1000 + chunkIndex`），`done` 用该发言的 seq；但这样 AC-5 / API-2 的「id === seq」需要改写。
2. 重连时对「当前未完成发言」从发言起点重放增量，并在协议里给客户端一个「从零重放该发言」的信号；客户端不能盲目拼接，必须按信号重置该发言的 `text`。

不能只靠「id 相同就过滤」——这正是当前实现丢增量的原因。

---

### 2. C-87 · 降级编排 —— **仍 Open（阻塞，两个子项已修）**

#### 已修（本轮验证通过）

- **接住抛错**：`src/server/llm/turn.ts:64-70` 的 `try/catch` 把 `attempt` 抛出的异常当失败；`tests/server/degrade.test.ts:193-233` 覆盖「第一次抛错、第二次成功」和「两次都抛错」。
- **`degradeEvents` 返回真实事件**：`turn.ts:108-133` 返回带 `gameId` / `seq` / `ts` / `visibleTo` / `payload` 的 `EventEnvelope[]`，`seq` 为 `seq` 与 `seq + 1`。P5 把它接到真实 `replay()`：

  ```
  seq= 16 spoken= [2] degradations= [2]
  ```

  说明这两条事件确实可以被引擎折叠、发言 cursor 前进，Round 2 的「不是可直接写入引擎的事件」这一子项成立。

#### 仍 Open 1：整体预算没有真正封顶（P6）

`turn.ts:71-75` 只在一次**失败之后**检查 `now() - startedAt > limitMs`，然后决定是否重试。它没有把剩余预算传给 `attempt`，也没有在 `startedAt + limitMs` 处中止。

P6（`limitMs = 30_000`，每次 `attempt` 消耗 20 秒）：

```
calls= 2 clock= 40000 degraded= true
```

30 秒硬上限仍被跑到 40 秒；若是真实 `decide()` 的 `AbortSignal.timeout(30_000)`，两次调用就是 60 秒。NFR-1 / AC-7 的「硬超时后必须降级」没有成立。新增的 `tests/server/degrade.test.ts:235-255` 只覆盖「第一次 attempt 结束后就已经超过上限（`now=10_000 > 5_000`）」这种最简单的情形，没有覆盖「第一次没超、第二次把总时长推过上限」。

修法：给 `attempt` 传 `remainingMs` / `AbortSignal`（由 `startedAt + limitMs` 派生），或者至少用「剩余预算不足一次最小超时」来拒绝重试；并补一条 20s + 20s → 只调用 1 次（或总时长 ≤ limit）的用例。

#### 仍 Open 2：没有写回路径，也没有生产调用者

- `GameRegistry` 仍只有 `submit(action)`（`src/server/store/game-registry.ts:178`），没有追加原始事件的入口；`degradeEvents` 返回的 `DEGRADED` 无法通过现有 API 落盘。
- `grep runTurn src/` 仍只命中定义本身；`grep degradeEvents src/` 同理。AC-10 的「降级后对局继续推进：下一席位正常获得发言机会」没有任何生产路径或集成测试。
- `RFCS.md:74` 的依赖表没有把 RFC-011 列为 RFC-010 的后继，§8.6 也没有写交接；§8.4 仍把 AC-10 / 11 写成 PASS。

#### 仍 Open 3：重试层数未收敛（非阻塞但需记录）

`runTurn` 自己重试 1 次，`decide()` 的 `maxRetries` 默认也是 1；如果调用方把 `decide` 直接包成 `attempt`，一次发言最多 4 次调用，不是 AC-8 的「重试 1 次」。本轮没有调用方，因此这是接缝风险，不是当前行为；但必须在 RFC-011 接线时固定「重试只能有一层」。

---

### 3. C-88 · `Last-Event-ID` 超窗 —— **关闭**

本轮的两条阻塞都修好了：

1. **用例走路由**：`tests/server/stream.test.ts:275-293` 先 `bus.publish` 210 条把窗口灌满，再 `app.inject` 带 `last-event-id: 1`，读响应体。**M1** 把 `bus.ts:58` 的窗口越界返回从 `undefined` 改成 `[]`（等价于静默截断）：

   ```
   × 断线位置早于窗口起点时返回 SNAPSHOT_REQUIRED（text/event-stream）
   Tests  1 failed | 9 passed
   ```

   这次测试是真锁。失败耗时约 5 秒（没有 error 帧时连接不会结束，靠 vitest 超时），但会红。
2. **MIME**：`routes/stream.ts:67-70` 在 gap 分支（`:75-79`）之前设置 `text/event-stream; charset=utf-8`；用例 `:291` 断言 `content-type` 包含 `text/event-stream`，`:292` 断言 body 含 `SNAPSHOT_REQUIRED`。P-R2-B 的 `text/plain` 已消失。

**遗留（非阻塞）**：

- `tests/server/stream.test.ts:212-242` 的旧算术用例仍保留，标题写「返回 `SNAPSHOT_REQUIRED`」但实际只算 `committedMessages` 的下标，不看路由、不发请求。它不会误导实现（新用例已覆盖），但建议删除或改成纯 `bus.replay` 单测，避免下一位读者以为窗口逻辑在 `committedMessages` 上。
- **新连接**（无 `Last-Event-ID`）在总线已满时也会得到 `SNAPSHOT_REQUIRED`（P9：`id: 0 ... SNAPSHOT_REQUIRED`）。Q-010-2 只写了「断线超出窗口」，没写「新连接」；若这是有意（先拉 `GET /api/games/:id` 快照），需要写进 §2.2 / §8.6 并补用例；若不是，应区分「无 header」与「有 header 但超窗」。

---

### 4. C-89 · 客户端跨发言重置 —— **仍 Open（阻塞，半修）**

#### 已修

- `use-stream.ts:69`：新一段发言的第一个 `delta` 会把 `sawThinking` 置为 `false`（`sameSpeech ? state.sawThinking : false`）。
- `use-stream.ts:82`：死三元 `state.speechId === message.id ? message.text : message.text` 已删，改成 `text: message.text`。

#### 仍 Open 1：`done` 分支不重置 `sawThinking` / `firstDeltaAt`（P2b）

`use-stream.ts:77-85` 的 `done` 分支没有计算 `sameSpeech`，不碰 `sawThinking` / `firstDeltaAt`。P2b（上一段 `thinking` + `delta` 后，下一段只有 `done`）：

```
{"phase":"done","seat":2,"text":"乙","firstDeltaAt":200,"lastId":2,"speechId":2,"sawThinking":true}
```

第二段没有经历过思考，`sawThinking` 仍是 `true`，`firstDeltaAt` 仍是上一段的 200。AC-4 的「当前这段发言是否经历过思考」在 done-only 的新发言上仍然是错的；而 committed 历史回放恰好是 done-only 的形状（C-86 ③）。

#### 仍 Open 2：这条修复没有测试锁（M2）

**M2** 删掉 `use-stream.ts:69` 的 `sawThinking: sameSpeech ? state.sawThinking : false`：

```
✓ tests/client/use-stream.test.ts (7 tests) 3ms
Tests  7 passed (7)
```

`tests/client/use-stream.test.ts:70-92` 的两条 C-89 用例只断言 `text` / `firstDeltaAt`，没有一条断言第二段的 `sawThinking === false`。Round 2 要求的用例（① 上一段 thinking+delta+done、下一段只有 delta → `sawThinking=false`；② 上一段有 delta、下一段只有 done → `firstDeltaAt` 被重置）至今不存在。按 TEST-1，这条修复目前只是代码形状，不是回归锁。

---

### 5. 逐条验收标准（本轮受影响的部分）

> `PASS` 只给「有测试会在行为退化时变红」的项；手工项按 D-6 记录。

| AC | 证据 | 判定 |
|---|---|---|
| 1 | reducer 的 `thinking` / 首 `delta` 口径存在；但服务端没有首事件时间，`thinking` 没有生产源；per-speech `firstDeltaAt` 在 done-only 新发言上不重置（P2b） | **PARTIAL** |
| 2 | 实时总线能发 `delta`，但无生产发布者；committed 回放全是 `done`，P10 下刷新后 `text=''`；50 字中间态没有测试 | **FAIL** |
| 3 | 真实 p95 是手工项（D-6，接受）；当前没有可采样的服务端时间点 | **PARTIAL（记录）** |
| 4 | `phase` 可区分；`sawThinking` 在 done-only 新发言上跨段（P2b），修复无测试锁（M2） | **FAIL** |
| 5 | 超窗 / MIME 已修（M1 红）；但重连合并顺序错（P3）、下一段 `done` 被吞（P1 / P10）、发言中途断线丢增量（P11 / C-96） | **FAIL** |
| 6 | 逐字节中文解码；Round 1 的 P7 已锁住 | **PASS** |
| 7 | `decideDegrade` 有单测；`runTurn` 的 20s+20s 仍突破 30s 上限（P6） | **NEEDS WORK** |
| 8 | `runTurn` 的失败→重试与抛错路径有真实两次调用（`degrade.test.ts:116-137,193-233`）；重试层数风险见 C-87 | **PASS（helper 级）** |
| 9 | committed `DEGRADED` 仍变成空 `done`（P4）；总线没有生产发布者 | **FAIL** |
| 10 | `degradeEvents` 可被 `replay` 且推进 cursor（P5）；但 `GameRegistry` 无追加入口，`runTurn` 无调用者 | **NEEDS WORK** |
| 11 | `DEGRADED` 可 replay；`degradations` 只记席位不记轮次，没有轮次级测试 | **PARTIAL** |
| 12 | 4 轮 × 2 次调用、`canAttempt` 恒 true（`degrade.test.ts:166-190`）；无生产调用者 / 无「对局未卡死」集成测试 | **PARTIAL** |

---

### 6. 五个审查维度

#### 6.1 RFC ADHERENCE —— **FAIL**

- 12 条 AC 中 AC-6 完全通过；AC-8 在 helper 级通过；AC-1 / 3 / 11 / 12 是 PARTIAL；AC-2 / 4 / 5 / 9 失败；AC-7 / 10 仍未验收。
- 缺功能：生产侧 `thinking` / `delta` / `degraded` 发布者；按事件类型映射的 committed 回放；committed 与总线增量的合并 / 去重；中途断线的 delta 续传；`runTurn` / `degradeEvents` 的写回路径；真实整体预算。
- 多做的部分：`committedMessages` 继续把非发言事件映射成空 `done`，会污染客户端状态（P4 / P10）。

#### 6.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：本提交没有让 `src/engine/` import UI / server / 网络。 |
| `ARCH-2` | **NEEDS WORK**：`src/shared/stream.ts:33-50` 的运行时编解码仍未登记（C-91，未重查）。 |
| `ARCH-4` | **PASS**：`runTurn` 的时钟由调用方注入；引擎未读时钟。 |
| `DATA-1` | **PASS**：SSE 消息的 `id` 取事件 `seq`；`DEGRADED` 折叠后 `seq` 仍由 `applyEvent` 统一推进。 |
| `DATA-3` | **PASS**（Round 2 关闭）：`DEGRADED` 可 replay，M3 仍有效。 |
| `API-2` | **FAIL**：`delta` 共享 `seq` 的语义使中途重连无法按「下一个 seq」续传（C-96）；`done` 的去重不是按 `<=`。 |
| `TEST-1` | **FAIL**：C-89 的修复没有测试锁（M2 全绿）；C-87 的预算只测了「第一次已超」；C-86 没有 route → reducer 的回放用例（P10）。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未因本 RFC 下降。 |
| `DOC-1` | **FAIL**：§8.6 仍把长连接 / 持续推送归给 RFC-012 且说 `reply.send` 一次写完；§8.4 的 AC-2 / 4 / 9 / 10 / 11 仍写 PASS；§8.8 的交接没有同步到 §8.6 / `RFCS.md` §3。 |
| `AI-3` / `AI-7` | **PASS（未改）**：本 RFC 没有改调用超时 / 重试配置；但 `runTurn` 的重试与 `decide()` 的 `maxRetries` 叠加风险见 C-87。 |
| `SEC-5` | **PASS（数据面）**：SSE 只发可见事件，没有直接序列化完整 `GameState`；会话检查仍在（`routes/stream.ts:51-56`）。 |

#### 6.3 SECURITY —— **PASS**

- 路由先 `resolveSession` 再检查 `session.gameIds.includes(record.gameId)`，没有会话不能读别人的局。
- 可见性由 `isVisibleTo` 统一判定；没有手写 `wolves` 规则；当前 fixture 下没有发现泄漏。
- `SNAPSHOT_REQUIRED` 帧只回显客户端提供的 `Last-Event-ID`，不泄漏服务端状态。
- 没有新增密钥、日志或错误响应里的敏感数据；SSE 的 `data` 是 `JSON.stringify`，换行被转义，不能注入帧。
- 缺口仍是回归锁：D-2 的 `wolves` / `self:<n>` 用例不存在（C-90，未重查）。

#### 6.4 PERFORMANCE —— **NEEDS WORK**

- `committedMessages` 现在对**全部**历史可见事件生成 `done`，没有 200 条窗口；每次重连都做一次完整 replay + 全量序列化，长局下是 O(n) 且没有上限。旧实现的 `slice(-200)` 虽然丢事件，但至少有上限；本轮修复超窗时把 committed 侧的上限去掉了，需要用「窗口 + SNAPSHOT_REQUIRED」统一处理。
- committed 与总线增量可能重复发送同一段发言（P3），既增加带宽，也让客户端做无用功。
- `PassThrough` 的 `write` 没有 backpressure 处理；慢客户端会无界缓冲。
- `bus.end` 之后新连接会挂起（P7），每个这样的连接都保留一个 listener 和缓冲。
- 没有新增 LLM / 数据库 / 网络调用；`runTurn` 的重试仍可能到 40s+。

#### 6.5 MAINTAINABILITY —— **NEEDS WORK**

- `use-stream.ts` 的终止消息去重（`:44`）与 `speechId` 语义脱节；`done` 分支（`:77-85`）不重置 per-speech 字段；`startsNewSpeech`（`:48`）的 `base` 只在 `thinking` 分支使用，`delta` 自己又算一遍 `sameSpeech`，三处口径容易漂移。
- `committedMessages` 与 `StreamBus.replay` 是两份「历史」，路由按「先 A 后 B」硬拼，没有统一的 merge / 排序 / 去重函数；这是 P3 的根因，也是下一位维护者最容易踩的地方。
- `turn.ts` 的 `degradeEvents` 已返回真实信封，但 `tests/server/degrade.test.ts:139-164` 仍只断言 `['DEGRADED','SPEECH']`，不喂 `replay()`、不检查 `seq` 连续 / `speech.spoken`；P5 的行为没有进仓库测试。
- `bus.end` 的「已结束后再连接」没有处理：`isEnded()` 存在但路由没用（P7）；`end()` 重复调用会重复 emit。
- 测试用了 20ms `setTimeout` 等待订阅（`stream.test.ts:256`），在慢 CI 上有竞态；建议用可观察信号（例如 subscribe 后的 ready promise）或注入 hook。
- 正向：`StreamBus` 的接口小而清楚；C-88 的 route 用例与 M1 锁有效；C-87 的抛错用例是真实的两次调用；`degradeEvents` 的类型现在与 `EventEnvelope` 对齐。

---

### 7. 变异探针与恢复

备份在 `/tmp/howl-rfc010-r3-backup/`，覆盖 `src/client/use-stream.ts`、`src/server/routes/stream.ts`、`src/server/llm/turn.ts`、`src/server/stream/bus.ts`。每个变异用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 注入 / 探针 | 跑什么 | 结果 |
|---|---|---|---|
| P1 | `done(3,"第一段")` → `done(9,"第二段")` 走 `streamReducer` | 临时测试 | `text=第一段`、`lastId=3`（C-86 ④） |
| P2 | 两段发言，第二段只有 `done` | 临时测试 | 第二次 `done` 被 `:44` 吞掉；`done` 分支不重置 per-speech 字段（C-86 / C-89） |
| P2b | 上一段 `thinking`+`delta`，下一段只有 `done` | 临时测试 | `sawThinking=true`、`firstDeltaAt=200` 跨段保留（C-89） |
| P3 | 真实 SPEECH seq 15 + bus 同 seq 增量，`Last-Event-ID: 14` | 真实路由 | `[done 15, thinking 15, delta 15]` → 最终 `text='第'`、`phase='speaking'`（C-86 ②） |
| P4 | 真实对局 + 追加 `DEGRADED` seq 16 | `committedMessages` | 最后一条是 `done id=16 text=''`（C-86 ③ / AC-9） |
| P5 | `degradeEvents` 接到真实 `replay()` | 临时测试 | `seq=16, spoken=[2], degradations=[2]`（C-87 已修子项） |
| P6 | `limitMs=30_000`、每次 attempt 20s | 临时测试 | `calls=2, clock=40_000, degraded=true`（C-87 预算） |
| P7 | `bus.end()` 之后才建立连接 | 真实路由 | 300ms 后仍 `still-open`；再次 `end` 才释放（N-R3-1） |
| P9 | 210 条 bus 消息、无 `Last-Event-ID` | 真实路由 | `id: 0 ... SNAPSHOT_REQUIRED`（C-88 遗留策略） |
| P10 | 真实一局 8 条 SPEECH，无 `Last-Event-ID`，响应逐条喂 reducer | 真实路由 | `{"phase":"done","text":"","lastId":12,...}`（C-86 端到端） |
| P11 | 真实 SPEECH seq 15，bus 增量，`Last-Event-ID: 15` | 真实路由 | `ids=[23]`，没有 id 15 的增量（C-96） |
| M1 | `bus.ts:58` 窗口越界从 `undefined` 改成 `[]` | `tests/server/stream.test.ts` | **1 failed / 9 passed**（C-88 被锁） |
| M2 | 删掉 `use-stream.ts:69` 的 `sawThinking` 重置 | `tests/client/use-stream.test.ts` | **7/7 全绿**（C-89 修复未被锁） |

**恢复校验**：

```
$ md5 -q src/client/use-stream.ts src/server/routes/stream.ts src/server/llm/turn.ts src/server/stream/bus.ts
add9eea2c54b695355f717d5d95e06f7
5c46968782c32c78ad6ddfefe0cc56c4
33fc277088429827f1a8474fa1819ed1
a0f19b6fa68128ca4a94f8480f2f402e

$ md5 -q /tmp/howl-rfc010-r3-backup/use-stream.ts /tmp/howl-rfc010-r3-backup/stream.ts /tmp/howl-rfc010-r3-backup/turn.ts /tmp/howl-rfc010-r3-backup/bus.ts
add9eea2c54b695355f717d5d95e06f7
5c46968782c32c78ad6ddfefe0cc56c4
33fc277088429827f1a8474fa1819ed1
a0f19b6fa68128ca4a94f8480f2f402e

$ git status --porcelain
（空）

$ pnpm test
 Test Files  68 passed (68)
      Tests  564 passed (564)
```

临时探针文件 `tests/server/__r3-probe.test.ts` / `tests/client/__r3-probe.test.ts` 已删除；仓库没有新增探针文件。

---

### 8. 结论

- **Overall Risk Level: High**
- **Summary**：C-88 已修好并有真正的路由回归锁；C-87 的抛错处理与真实 `EventEnvelope` 成立，但 30 秒硬上限仍可被一次重试推过，降级事件仍没有写回路径 / 生产调用者；C-86 的 `StreamBus` + `PassThrough` 只解决了「连接建立后的实时推送」，补偿 / 重连路径仍把每个可见事件映射成 `done`，客户端仍吞掉下一段 `done`，P10 下刷新页面看不到任何发言；C-89 的 `sawThinking` 只在 delta 开头的新发言上重置，done-only 路径仍跨段，且修复无测试锁。
- **Blocking Issues**：
  1. **C-86**：committed 与总线增量的合并 / 排序 / 去重（P3）；按事件类型映射（P4）；客户端 `done` 去重（P1 / P10）。
  2. **C-96**：发言中途断线后剩余 `delta` / `done` 被 `id > lastEventId` 过滤掉（P11），D-3 与 AC-5 / API-2 冲突。
  3. **C-87**：整体预算 20s+20s 仍跑到 40s（P6）；`degradeEvents` 无写回路径、`runTurn` 无生产调用者，RFC-011 交接未登记。
  4. **C-89**：`done` 分支不重置 `sawThinking` / `firstDeltaAt`（P2b）；修复无测试锁（M2）。
- **Improvement Suggestions**：把 committed 与 bus 增量合并成一个按 `id` 排序、同 id 去重的函数；committed 侧只映射 `SPEECH` → `done`、`DEGRADED` → `degraded`，其余跳过；客户端终结消息按 `speechId` 的 `<=` 去重，并在任何新发言起点重置 `sawThinking` / `firstDeltaAt`；给 `delta` 设计可续传的 id 或「当前发言重放」信号（C-96）；`runTurn` 接收 `remainingMs` / `AbortSignal` 并在 `startedAt + limitMs` 中止；给 `GameRegistry` 增加追加原始事件的入口（或把降级写回交给 RFC-011 并在 §8.4 / §8.6 / `RFCS.md` §3 正式登记）；补 route → reducer 集成测试、20s+20s 预算测试、`degradeEvents` → `replay` 测试、`sawThinking` done-only 测试；同步 §8.6 / §8.4 与 `README.md` / `TEST-STRATEGY.md`。
- **Suggested status**：**`Changes requested`**。

---

### 9. Open conflicts（登记到 `RFCS.md` §8.31 Round 3 段）

- **C-96**：AC-5 / API-2「每条消息 id === seq，从下一个 seq 继续」与 D-3「同一条发言的多个 delta 共享 id」在「发言中途断线」下冲突。本轮按「AC-5 的 Must 不丢失」判为阻塞；需要改 id 方案或增加「当前发言重放」信号，并同步 RFC-010 §2.2 / §4 / D-3 与 TEST-STRATEGY。
- **C-86 归属 / 文档**：RFC-010 §8.6 仍把持续推送记给 RFC-012，且说路由 `reply.send` 一次写完；代码已经是 `PassThrough` 长连接，§8.8 也说生产侧在 RFC-011。三处必须统一；若正式把 `runTurn` / 生产侧交给 RFC-011，把 RFC-011 加入 RFC-010 的后继 / RFC-010 加入 RFC-011 的前置，并同步依赖表。
- **C-87 交接**：§8.4 仍把 AC-10 / 11 写成 PASS，但 `degradeEvents` 没有 `GameRegistry` 写回入口、`runTurn` 没有调用者；按「代码 + 实测」判为未验收。若把接线交给 RFC-011，必须改 §8.4 / §8.6 并登记依赖。
- **C-88 新连接**：Q-010-2 只规定「断线超出窗口」；当前无 `Last-Event-ID` 且总线已满时也返回 `SNAPSHOT_REQUIRED`（P9）。本轮按保守解释接受为「先拉快照」，但要求写进 §2.2 / §8.6 或区分两种情形。
- **C-92（未重查）**：`TEST-STRATEGY.md` / `README.md` / RFC-010 §8.4 与实现仍不一致；本轮按代码 + 实测判，文档待回写。

## Round 4 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

本轮只复核用户点名的四项：**C-96 / C-86 / C-89 / C-87**。已关闭的 C-85 / C-88 不重查；C-90 ~ C-95 为非阻塞项，按 Round 1 / 2 / 3 的记录保持，本轮不重查（C-92 的文档漂移在第四项复核时顺带观察到，仍是非阻塞，见 §9）。

一句话：**C-89 真正关闭；C-96 / C-86 / C-87 都没有闭合。** C-96 的 `replay` 只重放 `thinking` / `delta`，历史里的 `done` 不重放，且会让已经看完的发言从 `done` 退回 `speaking`；C-86 的三条新增客户端用例都成立，但 P3 的拼接顺序、P4 的「全事件映射成 `done`」、生产侧发布者一个都没动；C-87 的预算检查与旧实现等价，20s + 20s 仍跑到 40s，且没有任何测试能区分新旧代码。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `c2ec4a0`，`git status --porcelain` 为空。

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
✓ built in 65ms
vite v8.3.8 building ssr environment for production...
✓ 42 modules transformed.
dist/server/index.js  89.99 kB │ gzip: 29.98 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  68 passed (68)
      Tests  568 passed (568)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`tests/meta/coverage.test.ts` 生成，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查服务端 SSE 协议、客户端 reducer、降级编排与测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / 首屏性能 / Playwright（A 方案把界面留给 RFC-012，`tests/e2e/` 为空）。HTTP 端点与事件流仍检查，因为它们是本 RFC 的交付物。

**探针后的复跑**：所有探针都是独立临时测试文件，或从 `/tmp/howl-rfc010-r4-backup/` 的文件备份恢复；源码四处 `md5` 与备份逐一相同（见 §7），临时探针文件已删除，`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **68 files / 568 tests 全绿**。没有 `git commit`。

---

### 1. C-89 · 关闭

**判断：关闭（有真正的回归锁）。**

- `src/client/use-stream.ts:81-93` 的 `done` 分支现在计算 `sameSpeech = state.speechId === message.id`，对 `firstDeltaAt` 与 `sawThinking` 都按段重置；空文本 `done` 也不再覆盖 `text`。
- `tests/client/use-stream.test.ts:96-107` 的用例走「上一段 `thinking` + `delta` + `done` → 下一段只有 `done`」，同时断言 `sawThinking === false`、`firstDeltaAt === null`、`text === '第二段'`。这正是 Round 3 P2b 的反例。
- **M2**（删掉 `done` 分支的 `firstDeltaAt` / `sawThinking` 两行）实跑：

  ```
  FAIL tests/client/use-stream.test.ts > C-89 · done 也要按段重置…
  AssertionError: expected true to be false
  Tests  1 failed | 9 passed (10)
  ```

  Round 3 的「修复无回归锁」不成立；本轮这条阻塞可以关闭。

---

### 2. C-86 · 仍 Open（阻塞）

Round 3 的 C-86 一共有四块：① 客户端吞掉下一段 `done`；② committed 与总线增量的拼接顺序；③ 每个可见事件都映射成 `done`；④ 生产侧没有发布者 / 文档归属矛盾。本轮的修复让 ① 和「空文本抹正文」成立，但 ②③④ 一个都没关。

#### 已修且已被锁住

- **空文本 `done` 不再抹正文**：`use-stream.ts:88`；`tests/client/use-stream.test.ts:109-119`。**M4**（把该行改回 `text: message.text`）实跑 `1 failed | 9 passed`。
- **跨段 `done` 可以进来**：`use-stream.ts:45-47` 把去重收窄为「同 id + 已 done + 是 done」；`tests/client/use-stream.test.ts:121-127` 断言 `done(5)` → `done(9)` 后 `text === '乙'`、`speechId === 9`。**M5**（恢复旧的 `phase === 'done' && type === 'done'` 守卫）实跑 `1 failed | 9 passed`。
- **刷新后正文不再被最后一条空 `done` 清空**：真实一局、两次 `SPEECH`、无 `Last-Event-ID`，把路由响应逐条喂 reducer，最终 `text === '第二段发言'`。Round 3 的 P10「刷新后 `text=''`」在本轮确实消失了。

#### 仍 Open 1：committed 与总线增量仍是「先 A 后 B」硬拼（P-R4-3）

`src/server/routes/stream.ts:81-86` 先写全部 `committedMessages`，再写全部 `bus.replay`，两者没有按 id 合并、排序或去重。

探针（真实一局，真实 `SPEECH` seq 15 已提交，bus 里同一 seq 的 `thinking` / 首字 `delta`，带 `Last-Event-ID: 14`）：

```
messages= [["done",15],["thinking",15],["delta",15]]
经 streamReducer 后：
{"phase":"speaking","seat":2,"text":"我","firstDeltaAt":0,"lastId":15,"speechId":15,...}
```

完整发言先作为 `done` 到达，随后被同一 id 的 `thinking` / `delta` 回退成半句。Round 3 的 P3 可原样复现；AC-5 的「不重复、不丢失」仍不成立。只要生产侧按 §2.2 先发布增量、再提交 `SPEECH`，这个顺序就会出现在真实重连里。

#### 仍 Open 2：`committedMessages` 仍不读事件类型（P-R4-4）

`src/server/routes/stream.ts:34-44` 对每个可见事件一律返回 `{ type: 'done', text: payload.text ?? '' }`。探针（真实对局 + 追加一条 `DEGRADED` seq 15）：

```
last= {"type":"done","id":15,"seat":2,"text":""}
```

`DEGRADED` 到不了客户端的 `degraded` 分支，AC-9 在历史补偿路径上仍失败；`DAY_STARTED` / `PHASE_CHANGED` / `SPEECH_SKIPPED` 也继续冒充空文本 `done`。`tests/server/stream.test.ts:117-119` 的期望集合是「全部 public 事件的 seq」，恰好把这个错误映射锁成了基线；按类型过滤时这条用例会先红。

#### 仍 Open 3：生产侧没有发布者，§8.6 仍与代码相反

- `grep bus.publish src/` **零命中**；`publish` 的调用者只有测试。
- `runTurn` / `degradeEvents` 在 `src/` 里仍无调用者（`grep` 只命中定义与 `bus.ts` 的注释）。
- `RFCs/RFC-010...:163` §8.6 仍写「路由用 `reply.send` 一次写完……持续推送在 RFC-012」，而路由早已是 `PassThrough` 长连接、§8.8 也说生产侧在 RFC-011。三处仍未统一，`RFCS.md` §3 的依赖表里 RFC-010 的后继仍是「—」。

**C-86 结论**：三条新增客户端用例是真的，刷新路径也修好了；但 Round 3 判阻塞的协议侧（②③④）未动，C-86 不能关闭。

---

### 3. C-96 · 仍 Open（阻塞）

`src/server/stream/bus.ts:60-68` 新增了 `trailingSpeech`：重放所有 `id === lastEventId` 的 `thinking` / `delta`，再接 `id > lastEventId` 的消息。它确实让「发言还没结束就断线」能继续收到剩余增量（**M3** 删掉这段后 `tests/server/stream.test.ts` `1 failed | 10 passed`，说明增量这一半有锁），但它没有解决 C-96 的完整语义。

#### P-R4-1：断线期间发言完成 → `done` 永远收不到

探针（真实一局，真实 `SPEECH` seq 15；断线时只收到第一个 delta；断线期间 `thinking` / `delta` / `done` 全部已进总线；带 `Last-Event-ID: 15` 重连）：

```
types= [ 'thinking', 'delta', 'delta' ]
ids=   [ 15, 15, 15 ]
```

`done` 的 id 也是 15（与 `committedMessages` 的 `id = event.seq` 一致），被 `id > lastEventId` 过滤，而 `trailingSpeech` 只收 `thinking` / `delta`。这段发言的终结消息客户端收不到，会停在 `speaking`。这正是 Round 3 P11 的「丢 done」，只是 delta 回来了、done 仍没回来。

**为什么现有用例没抓到**：`tests/server/stream.test.ts:307-314` 是在**连接建立之后**才 `bus.publish(done)`（`:313`），`done` 走的是实时订阅而不是 `replay`。把 `done` 挪到连接之前，`types[types.length - 1]` 会变成 `delta`，用例即红。测试名「重放该段剩余的增量」与实际覆盖不符。

#### P-R4-2：重连会把已经看完的发言从 `done` 拉回 `speaking`

更严重的是反向行为。客户端已完整收到该发言的 `thinking` / `delta` / `done`（`lastId === speechId`），网络断开后 EventSource 自动带 `Last-Event-ID: speechId` 重连；`replay` 因为「id 等于断点且是 thinking/delta」把**整段旧增量从头重放**，客户端重新经历 `thinking` → `speaking`，而 `done` 仍不重放：

```
types= [ 'thinking', 'delta', 'delta' ]
state= {"phase":"speaking","seat":2,"text":"我觉得 2 号像狼","firstDeltaAt":0,"lastId":15,"speechId":15,...}
```

文本这次是完整的（`thinking` 重置后所有 delta 都重放了），但 `phase` 停在 `speaking`（直到下一条更大 id 的消息），且这是一次无意义的整段重播。AC-5 的「不重复」和 UI 的完成态都被破坏。Round 3 建议的「协议信号 + 客户端按信号重置」只做了一半：没有信号，且没有把终结消息纳入重放。

#### 规范仍未同步

`RFCs/RFC-010...:33-35` 仍写「每条消息 id 等于 seq，从下一个 seq 继续」，D-3 仍写多个 delta 共享 id；两者在「发言中途断线」下仍不能同时满足。§8.4 的 AC-5 仍写 PASS（`:141`），与上面两个探针相反。C-96 的修复只是启发式，不是正式偏离，也没有走 `/manage-changes`。

**修法建议**：① 至少把 `done` 纳入 trailing 重放（`id === lastEventId` 的 `done` 排在增量之后）；② 增加明确的「从该发言起点重放」信号，客户端收到后重置 `text` 而不是盲目拼接；③ 或者改 id 方案（每个 `delta` 单调递增，`done` 用 seq），并同步 §2.2 / §4 / D-3 / AC-5 与 `TEST-STRATEGY.md`。无论选哪条，都必须补「发言在断线期间完成」和「已收到 done 后重连」两条用例。

---

### 4. C-87 · 仍 Open（阻塞）

#### 预算「修复」与旧实现等价（P-R4-6）

`src/server/llm/turn.ts:64-75` 把检查从「一次失败之后」挪到「下一次尝试之前」：

```ts
for (let index = 0; index < 2; index += 1) {
  if (index > 0 && input.now() - input.startedAt >= input.limitMs) break;
  ...
}
```

在旧实现里，检查位于 `if (!last.failed) break;` 之后——也就是同一个循环迭代末尾、下一次尝试之前；两者之间只差 `index` 自增和失败判断。因此行为只在「恰好等于上限」这一点上从 `>` 变成 `>=`，20s + 20s 的场景完全没变。

探针（`limitMs = 30_000`，每次 `attempt` 消耗 20 秒）：

```
clock= 40000 calls= 2 degraded= true
```

30 秒硬上限仍被跑到 40 秒；NFR-1 / AC-7 的「硬超时后必须降级」仍不成立。`attempt` 没有收到剩余预算，也没有 `AbortSignal`，第二次一旦开始就必然跑满。

#### 这条「修复」没有任何测试锁（M6）

把 `turn.ts` 临时恢复成 Round 2 的旧检查（失败之后、下一次之前）后：

```
✓ tests/server/degrade.test.ts (15 tests)
Tests  15 passed (15)
```

`tests/server/degrade.test.ts:235-254` 只覆盖「第一次 attempt 结束时就已经超上限」（`now() => 10_000`，`limitMs = 5_000`）——旧代码也会只调用 1 次。Round 3 明确要求的「20s + 20s → 只调用 1 次 / 总时长 ≤ limit」用例至今不存在。

#### 其余 C-87 阻塞项未动

- `GameRegistry` 仍没有追加原始事件的入口（`src/server/store/game-registry.ts` 只有 `submit`）；`degradeEvents` 返回的信封无法落盘。
- `runTurn` / `degradeEvents` 仍无生产调用者；AC-10 的「下一席位正常获得发言机会」没有集成测试。
- §8.4 仍把 AC-10 / 11 / 12 写成 PASS（`:146-148`），§8.6 没有 RFC-011 交接记录。

**C-87 结论**：本轮只改了一处边界（`>` → `>=`），没有让重试守住整体预算，也没有测试锁；Round 3 的三项阻塞全部仍在。

---

### 5. 逐条验收标准（只列本轮受影响的）

| AC | Round 3 | Round 4 | 依据 |
|---|---|---|---|
| 1 | PARTIAL | **PARTIAL** | C-89 的 per-speech `firstDeltaAt` 已修；`thinking` 仍无生产源，≥30 次真实 p95 仍是手工项（D-6） |
| 2 | FAIL | **NEEDS WORK** | reducer 的两个中间态与刷新路径成立；但 live 生产侧仍无发布者，P-R4-3 会让重连回退到半句 |
| 3 | PARTIAL | **PARTIAL** | 真实 p95 手工项，服务端首事件时间仍未记录（C-93） |
| 4 | FAIL | **PASS** | C-89 关闭；`tests/client/use-stream.test.ts:96-107` 锁住 done-only 新发言的 `sawThinking` |
| 5 | FAIL | **FAIL** | P-R4-1 / P-R4-2（C-96）；P-R4-3（committed 与总线顺序）仍不重复、不丢失 |
| 6 | PASS | **PASS** | 未改，Round 1 的逐字节用例仍有效 |
| 7 | NEEDS WORK | **NEEDS WORK** | 20s + 20s 仍到 40s（P-R4-6） |
| 8 | PASS（helper） | **PASS（helper）** | 未改；重试层数风险仍在 C-87 |
| 9 | FAIL | **FAIL** | P-R4-4：`DEGRADED` 仍变成空文本 `done` |
| 10 | NEEDS WORK | **NEEDS WORK** | `degradeEvents` 无写回入口 / 无调用者 |
| 11 | PARTIAL | **PARTIAL** | `DEGRADED` 可 replay；仍只有席位、没有轮次标注，无轮次级测试 |
| 12 | PARTIAL | **PARTIAL** | 4 轮 × 2 次调用的 helper 用例成立；仍无生产调用者 / 无「对局未卡死」集成测试 |

---

### 6. 五个审查维度

#### 6.1 RFC ADHERENCE —— **FAIL**

- 用户点名的四项中，只有 C-89 闭合；C-96 / C-86 / C-87 仍阻塞。
- 缺功能不变：生产侧 `thinking` / `delta` / `degraded` 发布者；按事件类型映射的 committed 回放；committed 与总线增量的合并 / 去重；发言中途断线（含已完成）的完整续传；`runTurn` / `degradeEvents` 的写回路径；真正的整体预算。
- 新代码引入的行为回归：C-96 的 `replay` 会让已完成的发言在每次重连时重播并回退到 `speaking`（P-R4-2）。

#### 6.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：本提交没有让 `src/engine/` import UI / server / 网络。 |
| `ARCH-2` | **未重查**：`src/shared/stream.ts` 的运行时编解码仍归 C-91（非阻塞），本轮不改判。 |
| `ARCH-4` | **PASS**：`runTurn` 的时钟仍由调用方注入。 |
| `DATA-1` | **PASS**：SSE 消息 id 取事件 `seq`；`DEGRADED` 折叠后 `seq` 由 `applyEvent` 推进。 |
| `DATA-3` | **PASS**（Round 2 已关闭）：`DEGRADED` 可 replay。 |
| `API-2` | **FAIL**：`delta` 共享 `seq` 与 AC-5「从下一个 seq 继续」在断线中途仍冲突（C-96），且这次多了一个「重连重播已完成发言」的反向问题。 |
| `TEST-1` | **FAIL**：C-96 的用例没覆盖历史里的 `done`（`done` 是连接后实时发布的）；C-87 的预算修改没有测试能区分新旧代码（M6 全绿）。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未因本 RFC 下降。 |
| `DOC-1` | **FAIL**：§8.6 仍写 `reply.send` 一次写完并归 RFC-012；§8.4 的 AC-5 / 9 / 10 / 11 / 12 仍写 PASS；§8.9 把 C-87 的「第二次前检查」写成已修，但与旧实现等价。 |
| `AI-3` / `AI-7` | **PASS（未改）**：本 RFC 没有改调用超时 / 重试配置；`runTurn` 与 `decide()` 的重试层数叠加风险仍未记录。 |
| `SEC-5` | **PASS（数据面）**：SSE 仍只发可见事件，没有直接序列化完整 `GameState`；会话检查仍在。 |

#### 6.3 SECURITY —— **PASS**

本轮改动没有新增输入面、密钥或日志：`StreamBus.replay` 只重放内存里已发布给该对局的 `StreamMessage`；`Route` 仍在 `resolveSession` 之后校验 `session.gameIds`；`SNAPSHOT_REQUIRED` 只回显客户端提供的 `Last-Event-ID`；`JSON.stringify` 的帧编码不变。C-90 的可见性回归锁仍是未重查的非阻塞项。

#### 6.4 PERFORMANCE —— **NEEDS WORK**

- `committedMessages` 仍对全部历史可见事件生成 `done`，没有 200 条窗口；每次重连都做一次完整 replay + 全量序列化。
- C-96 的 trailing 重放会把整段旧增量再发一遍（P-R4-2），重连带宽和客户端重渲染都翻倍；已完成的发言尤其明显。
- committed 与总线增量可能重复发送同一段发言（P-R4-3），既增加带宽，也让客户端做无用功。
- `PassThrough` 的 `write` 没有 backpressure 处理；`bus.end` 之后的新连接仍会挂起（Round 3 的 P7，非阻塞）。
- 没有新增 LLM / 数据库 / 网络调用；`runTurn` 的重试仍可能到 40s+。

#### 6.5 MAINTAINABILITY —— **NEEDS WORK**

- 两份「历史」（`committedMessages` 与 `StreamBus.replay`）仍由路由按「先 A 后 B」硬拼，没有统一的 merge / 排序 / 去重函数；P-R4-3 的根因未变。
- C-96 的注释说「还没结束的那段发言」，代码却无法判断是否已 `done`；注释与行为不一致，容易让下一位维护者误以为已完成发言不会重放。
- `done` 分支现在同时承担「终结一段真实发言」「非发言事件」「跳过发言」三种语义，`committedMessages` 又不按类型映射；`text` 的保留规则因此依赖调用方永远不发送空文本的跳过事件。
- 测试侧：C-96 用例把 `done` 放在连接后发布，测试名却声称覆盖重放；C-87 的预算用例只覆盖「开始时就已超时」。这两处是「测试看起来存在、实际不设防」的典型。
- 正向：C-89 的修复小而准，既有单测又能反向打红；C-86 的三条客户端用例分别锁住了空文本、跨段、同 id 幂等。

---

### 7. 变异探针与恢复

备份在 `/tmp/howl-rfc010-r4-backup/`，覆盖 `src/client/use-stream.ts`、`src/server/routes/stream.ts`、`src/server/llm/turn.ts`、`src/server/stream/bus.ts`。每个变异用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。临时探针 `tests/server/__r4-probe.test.ts` 已删除。

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P-R4-1 | 发言在断线期间完成（`thinking` + `delta` + `done` 全在历史），带 `Last-Event-ID = speechId` 重连 | 真实路由 | `types=[thinking,delta,delta]`，**没有 done**（C-96） |
| P-R4-2 | 客户端已收到完整 `done`，再带同一 id 重连，把响应喂 reducer | 真实路由 + reducer | `phase=speaking`，整段旧增量被重播（C-96） |
| P-R4-3 | 真实 `SPEECH` seq 15 已提交 + bus 同 seq 增量，带 `Last-Event-ID: 14` | 真实路由 + reducer | `[done 15, thinking 15, delta 15]` → `phase=speaking`、`text=我`（C-86 ②） |
| P-R4-4 | 真实对局 + 追加 `DEGRADED` seq 15 | `committedMessages` | 最后一条 `{"type":"done","id":15,"text":""}`（C-86 ③ / AC-9） |
| P-R4-5 | 真实一局两次 `SPEECH`、无 `Last-Event-ID`，响应逐条喂 reducer | 真实路由 + reducer | `text=第二段发言`（刷新路径已修） |
| P-R4-6 | `limitMs=30_000`、每次 attempt 20s | `runTurn` | `clock=40_000 calls=2 degraded=true`（C-87） |
| M2 | 删掉 `use-stream.ts:89-90` 的 done 分支重置 | `tests/client/use-stream.test.ts` | **1 failed / 9 passed**（C-89 已锁） |
| M3 | 删掉 `bus.ts:60-68` 的 trailing 重放 | `tests/server/stream.test.ts` | **1 failed / 10 passed**（delta 重放有锁） |
| M4 | `done` 空文本改回 `text: message.text` | `tests/client/use-stream.test.ts` | **1 failed / 9 passed**（空文本不抹有锁） |
| M5 | 恢复旧的 `phase === 'done'` 守卫 | `tests/client/use-stream.test.ts` | **1 failed / 9 passed**（跨段 done 有锁） |
| M6 | 把 `turn.ts` 恢复成 Round 2 的预算检查（失败之后、下一次之前） | `tests/server/degrade.test.ts` | **15/15 全绿**（C-87 的预算修改无锁） |

**恢复校验**：

```
$ md5 -q src/client/use-stream.ts src/server/routes/stream.ts src/server/llm/turn.ts src/server/stream/bus.ts
c952aa1d8d3d3ee6d4e896f850c2bffb
5c46968782c32c78ad6ddfefe0cc56c4
b88351d93a85c7c36eda144d4978118a
25d8f0cddcca50683c907399f4c895b2

$ md5 -q /tmp/howl-rfc010-r4-backup/{use-stream.ts,stream.ts,turn.ts,bus.ts}
c952aa1d8d3d3ee6d4e896f850c2bffb
5c46968782c32c78ad6ddfefe0cc56c4
b88351d93a85c7c36eda144d4978118a
25d8f0cddcca50683c907399f4c895b2

$ git status --porcelain
（空）

$ pnpm test
 Test Files  68 passed (68)
      Tests  568 passed (568)
```

---

### 8. 结论

- **Overall Risk Level: High**
- **Summary**：C-89 的 done 分支重置是真正的修复，且反向探针会红；C-86 的三条新增客户端用例也成立，刷新后能看到最后一段发言。但 C-96 的 `replay` 只补了增量、没有补历史里的 `done`，还会把已完成的发言整段重播并退回 `speaking`；C-86 的 committed/总线拼接、按类型映射、生产侧发布者三项仍是 Round 3 原样；C-87 的预算修改与旧实现等价，20s + 20s 仍到 40s，且 M6 证明没有任何测试锁。
- **Blocking Issues**：
  1. **C-96**：断线期间完成的发言收不到 `done`（P-R4-1）；已完成发言重连后从 `done` 退回 `speaking`（P-R4-2）；测试把 `done` 放在连接后发布，掩盖了这两条。
  2. **C-86**：committed 与总线增量的顺序错（P-R4-3）；每个可见事件仍映射成 `done`（P-R4-4，AC-9）；`bus.publish` / `runTurn` / `degradeEvents` 仍无生产调用者，§8.6 仍归 RFC-012。
  3. **C-87**：整体预算仍可被一次重试推过（P-R4-6）；预算修改无测试锁（M6）；`degradeEvents` 无写回入口、`runTurn` 无调用者、RFC-011 交接未登记。
- **Improvement Suggestions**：① C-96 至少把 `done` 纳入 trailing 重放，并补「断线期间完成」「已收到 done 后重连」两条用例；更好的做法是给客户端一个「从发言起点重放」信号，或改 delta 的 id 方案并同步 AC-5 / D-3。② C-86 把 committed 与 bus 增量合并成一个按 id 排序、同 id 去重、按类型映射的函数：`SPEECH` → `done`、`DEGRADED` → `degraded`、其余跳过；补 route → reducer 的集成用例；把生产侧 / `runTurn` / `degradeEvents` 的归属写进 §8.6 与 `RFCS.md` §3。③ C-87 给 `attempt` 传 `remainingMs` / `AbortSignal`，并补 20s + 20s 的用例；写回入口要么在 `GameRegistry` 增加，要么正式登记给 RFC-011。④ 同步 §8.4 的 AC-5 / 9 / 10 / 11 / 12 与 §8.6，不再把未验收项写成 PASS。
- **Suggested status**：**`Changes requested`**。

---

### 9. Open conflicts（登记到 `RFCS.md` §8.31 Round 4 段）

- **C-96 · AC-5 / API-2 vs D-3**：仍未正式裁决。当前实现用「重放 id 相等的 thinking/delta」做启发式，既没有 `done`，也没有「从起点重放」信号；按 AC-5 的 Must「不重复、不丢失」判为阻塞。需要改 id 方案 / 增加信号 / 走 `/manage-changes`，三选一并同步 §2.2 / §4 / D-3 / AC-5 与 `TEST-STRATEGY.md`。
- **C-86 归属 / 文档**：§8.6 仍把持续推送归给 RFC-012 且说路由 `reply.send` 一次写完；代码已是 `PassThrough` 长连接，§8.8 也说生产侧在 RFC-011。三处仍不一致，`RFCS.md` §3 的依赖表也没有 RFC-011 这个后继。
- **C-87 交接**：§8.4 仍把 AC-10 / 11 / 12 写成 PASS，但 `degradeEvents` 没有 `GameRegistry` 写回入口、`runTurn` 没有调用者；按「代码 + 实测」判为未验收。
- **C-92（未重查，非阻塞）**：`TEST-STRATEGY.md:302-312` 的 RFC-010 计划仍全 `proposed`，文件名（`sse.test.ts` / `replay-degrade.test.ts` / `stream.spec.ts`）与实现不符；`README.md:11` 仍写「7 个 Reviewed、8 个 Not started」（实际 9 个 Reviewed、6 个 Not started）。按 Round 1 记录保持非阻塞，待下一次 docs 提交统一回写。

## Round 5 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

本轮只复核用户点名的四项：**C-96 断点整段重放**、**C-86 合并顺序**、**C-86 无正文事件过滤**、**C-87 尝试级预算**。已关闭的 C-85 / C-88 / C-89 不重查；C-90 ~ C-95 的非阻塞记录保持不变（C-92 的文档漂移本轮未重查，仍是非阻塞）。

一句话：**C-96 服务端与 C-87 预算项成立；C-86 两项都没有闭合。** C-96 的整段重放能收到 `done`、也会以 `done` 收尾，但客户端「同 id `thinking` 重置正文」没有回归锁（M5 改坏后全量 571 仍绿）。C-86 的合并顺序有锁（M3 红），但已提交的 `done` 在同 id 有总线增量时仍被丢掉（P3）；「无正文事件不进发言流」在代码里根本不存在（P4 / P5），而且非发言事件的空 `done` 会把 `lastId` 推过在途发言，使实时 `done` 被丢弃（P7）。C-87 的预算修复有真实计时锁（M1 红），但写回入口 / 调用者 / RFC-011 交接仍未动。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `ac5cbd4`，`git status --porcelain` 为空。

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
✓ built in 16ms
dist/server/index.js  90.16 kB │ gzip: 30.02 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  68 passed (68)
      Tests  571 passed (571)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`tests/meta/coverage.test.ts` 生成，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查服务端 SSE 协议、客户端 reducer、降级编排与测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / 首屏性能 / Playwright（A 方案把界面留给 RFC-012，`tests/e2e/` 为空）。HTTP 端点与事件流仍检查，因为它们是本 RFC 的交付物。

**探针后的复跑**：所有探针都是独立临时测试文件，或从 `/tmp/howl-rfc010-r5-backup/` 的文件备份恢复；源码四处 `md5` 与备份逐一相同（见 §7），临时探针文件已删除，`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **68 files / 571 tests 全绿**。没有 `git commit`。

---

### 1. C-96 · 断点整段重放 —— 功能通过，客户端回归锁缺失

**服务端行为成立。** `src/server/stream/bus.ts:66-72` 现在只要断点处还能找到同 id 的消息，就把该 id 的全部消息（`thinking` → deltas → `done`）重放，再接 `id > lastEventId`。

- **P1**（真实一局、真实 `SPEECH` seq 15 已提交，`thinking` / `delta` / `done` 全在总线，带 `Last-Event-ID: 15` 重连，响应逐条喂 reducer）：

  ```
  P1 speechTypes= ["thinking","delta","done"]
  P1 finalState= {"phase":"done","seat":2,"text":"我觉得 2 号像狼","lastId":15,"speechId":15,"sawThinking":true}
  ```

- **P2**（客户端已经收到完整 `done`，再带同一 id 重连）：最终 `phase=done`、`text=我觉得 2 号像狼`，没有退回 `speaking`。
- **M2**（删掉 `hasSpeechAt` 整段重放，只保留 `id > lastEventId`）：`tests/server/stream.test.ts` **2 failed / 11 passed**——两条 C-96 用例都会红。服务端修复有锁。

**但客户端那一半没有回归锁。** RFC §8.10 说「客户端看到同 id 的 `thinking` 会重置正文」，`src/client/use-stream.ts:52-55` 也确实无条件在 `thinking` 上重置；可是没有任何 reducer 用例覆盖「同 id 的 `thinking` 重放」。**M5** 把这一行改成「只有 id 变化才重置」（`message.type === 'thinking' && state.speechId !== message.id`）后：

```
✓ tests/client/use-stream.test.ts (10 tests)
✓ tests/server/stream.test.ts (13 tests)
Test Files  2 passed (2)
     Tests  23 passed (23)
```

全量 `pnpm test` 复跑也是 **68 files / 571 tests 全绿**。也就是说，下一次有人为了别的目的收紧 `startsNewSpeech` 条件，P1 的重放会在客户端变成「我 + 我觉得」的重复正文，而整套测试仍然全绿。**这是 C-96 的阻塞性测试缺口**：补一条 reducer 用例（先喂 `thinking(15)` + `delta(15,'我')`，再重放同 id 的 `thinking(15)` / `delta(15,'觉得')` / `done(15,...)`，断言中间态是「我觉得」而不是「我我觉得」）。

**规范仍未同步（非阻塞文档债）**：§8.10 已记录整段重放，但 §2.2 仍写「从下一个 `seq` 继续」、D-3 仍只描述共享 id、§8.4 的 AC-5 仍写「带 `Last-Event-ID` 重连返回空（不重复）」。这是有意的偏离，不是缺陷，但下一次 docs 提交应同步 §2.2 / AC-5 / D-3 / `TEST-STRATEGY.md`，否则下一位维护者会按旧口径把整段重放当成 bug。

**非阻塞风险**：整段重放依赖 `thinking` 在 200 条总线窗口内。若一段发言的 `delta` 超过 200 条，`thinking` 被挤出窗口，客户端没有重置信号，会把重放的尾部 `delta` 追加到已有正文上（直到 `done` 才被完整文本覆盖）。建议后续给重放加独立信号，或加一条「窗口内只剩 delta」的用例；本轮不据此阻塞。

---

### 2. C-86 · 合并顺序 —— 部分通过：顺序有锁，`done` 仍会丢

`src/server/routes/stream.ts:86-93` 现在以总线顺序为主干，已提交事件只在该 id 尚无总线消息时插入，再按 id 稳定排序。

- **M3**（恢复 Round 4 的「先 committed 再 bus」）：`tests/server/stream.test.ts` **1 failed / 12 passed**——`ids=[12,13,14,1]` 打红，顺序修复有锁。
- **但 P-R4-3 的场景仍然不完整。** 真实一局、真实 `SPEECH` seq 15 已提交，总线里放同 seq 的 `thinking` / 首字 `delta`，带 `Last-Event-ID: 14` 重连：

  ```
  P3 ids= ["thinking:15","delta:15"]
  P3 finalState= {"phase":"speaking","seat":2,"text":"我觉得","lastId":15,"speechId":15,"sawThinking":true}
  ```

  已提交事件里的完整正文（`我觉得 2 号像狼`）和 `done` **根本不在响应里**：`busIds.has(15)` 把同 id 的 committed `done` 滤掉了，而总线里没有 `done`。客户端因此停在 `speaking` + 半句，直到——并且只有——生产侧再发布一个 `done` 才可能补全。

- 新增的用例 `tests/server/stream.test.ts:356-378` 只断言 `ids` 已排序，既没有构造「真实已提交 `SPEECH` + 同 id 增量」，也没有把响应喂给 reducer 断言最终状态；即使 committed `done` 被丢掉，它仍然全绿。**这正是 Round 4 P-R4-3 的最终用户可见结果**（`phase=speaking`、半句正文），只是失败原因从「done 被 thinking 回退」变成了「done 根本没发」。

**修法建议（二选一，必须配一条 route → reducer 的断言）**：

1. 按 id 合并时，总线消息在前；如果该 id 的总线消息里**没有 `done`**，把 committed 的 `done` 追加在该 id 的末尾（不能放在前面，否则会回到 P-R4-3 的 `done 15 → thinking 15`）；或
2. 明确并测试生产侧不变量：`done` 必须在 `SPEECH` 提交前发布，并在 `tests/server/stream.test.ts` 里按这个顺序构造「committed + bus 全段」，断言最终 `phase=done`、正文完整。

只断言「ids 有序」不够；AC-5 要的是「不重复、不丢失」，这里的 `done` 仍然丢了。

---

### 3. C-86 · 无正文事件不进发言流 —— 未实现（阻塞）

这是本轮最直接的自相矛盾：RFC §8.10、`RFCS.md` v2.80 变更记录和提交说明都写了「过滤掉没有正文的事件 / 无正文事件不进发言流」，但 `src/server/routes/stream.ts:30-45` 的 `committedMessages` **没有任何类型或文本过滤**——每个可见事件仍然一律映射成 `done`，`text` 缺省为空串。

- **P4**（真实一局 + 追加 `DEGRADED` seq 15）：

  ```
  P4 total= 4 emptyDone= 4
  P4 last= {"type":"done","id":15,"seat":2,"text":""}
  ```

- **P5**（把真实已提交的 `DEGRADED` 从路由发给客户端，响应逐条喂 reducer）：

  ```
  P5 types= ["done:12","done:13","done:14","done:15"]
  P5 finalState= {"phase":"done","seat":2,"text":"","lastId":15,"speechId":15,...}
  ```

  历史补偿路径上，`DEGRADED` 到不了 `degraded` 分支（AC-9），`DAY_STARTED` / `PHASE_CHANGED` / `SPEECH_SKIPPED` 也继续冒充空文本 `done`。

- **P7 证明这不是「只是多几条空消息」，而是会丢实时数据。** 真实一局把当天所有席位都发言完，最后一个 `SPEECH` seq 22 已提交，引擎同一步产出 `PHASE_CHANGED` seq 23；总线放该发言的 `thinking` / 首字 `delta`，带 `Last-Event-ID: 21` 重连，**连接建立后**再发布该发言的实时 `done`：

  ```
  P7 nextCommitted= PHASE_CHANGED 23 phase= DAY_VOTE
  P7 types= ["thinking:22","delta:22","done:23","done:22"]
  P7 finalState= {"phase":"done","seat":1,"text":"我觉得","lastId":23,"speechId":23,...}
  ```

  `done:23` 是 `PHASE_CHANGED` 冒充的空 `done`，它先把 `lastId` 推到 23；随后实时 `done:22` 因 `message.id < state.lastId` 被 reducer 丢弃。最终 UI 停在半句「我觉得」，而完整正文「我是 6」就在已提交的 `SPEECH` 里。**这是「无正文事件不进发言流」缺失造成的真实数据丢失，不是清理项。**

- **M4**（把「只保留带 `text` 的事件」这个声称的过滤加进 `committedMessages`）：`tests/server/stream.test.ts` **2 failed / 11 passed**：

  ```
  AC-5 ... frames.length > 0 失败
  C-88 ... expected 0 to be 300
  ```

  AC-5 的期望集合是「全部 public 事件的 seq」（`tests/server/stream.test.ts:117-119`），C-88 的 fixture 又要求 300 条无正文的 `DAY_STARTED` 全部变成消息（`:235-236`）。**当前这套全绿测试恰好把错误映射锁成了基线**；按声称的行为实现，先红的就是这两条。

**修法建议（按事件类型映射，不要只按文本过滤）**：

- `SPEECH` → `done`（用完整正文）；
- `DEGRADED` → `degraded`（不能简单丢弃，否则 AC-9 的历史路径仍然失败）；
- 其他无正文事件 → 不进发言流；
- 同步修改 AC-5 / C-88 的期望，并补三条 route → reducer 用例：P4（空事件不发送）、P5（历史 `DEGRADED` → `degraded`）、P7（非发言事件不推高 `lastId`，实时 `done` 必须被接收）。

---

### 4. C-87 · 尝试级预算 —— 通过，但 C-87 整体仍未闭合

**预算修复成立。** `src/server/llm/turn.ts:56-72` 给每次尝试套上 `raceTimeout`，`:92-94` 只给剩余预算。

- **P6**（`attempt` 永不 resolve，`limitMs=40`）：`elapsed=41ms, attempts=1, degraded=true`，挂起的调用被预算截断。
- **M1**（把 `last = await raceTimeout(input.attempt(), remaining)` 改回 `last = await input.attempt()`）：`tests/server/degrade.test.ts` **1 failed / 15 passed**：

  ```
  AssertionError: expected 82 to be less than 75
  ```

  真实计时用例（`tests/server/degrade.test.ts:257-283`）确实能区分新旧实现，Round 4 的「无回归锁」在本项上关闭。

**但 C-87 的其余 Round 4 阻塞项一个都没动**：

- `GameRegistry` 仍只有 `submit`（`src/server/store/game-registry.ts:178` 起），没有追加原始事件的入口；`degradeEvents()` 返回的 `DEGRADED` + `SPEECH` 信封仍无法落盘。
- `runTurn` / `degradeEvents` 在 `src/` 里仍无调用者（只有定义与 `bus.ts` 的注释）；AC-10「下一席位正常获得发言机会」没有集成测试。
- §8.4 仍把 AC-10 / 11 / 12 写成 PASS（`RFCs/RFC-010...:146-148`），§8.6 仍写「路由用 `reply.send` 一次写完……持续推送在 RFC-012」（`:163`），没有 RFC-011 交接记录。`RFCS.md` §3 的 RFC-010 直接后继仍是「—」，RFC-011 的 `Depends on` 仍只有 005 / 007，却声称 `SseOutputChannel` 推 RFC-010 的端点。

因此**预算项 PASS，C-87 整体仍 Open（阻塞）**：修复只覆盖了「耗时」这一半，没有覆盖「降级能被写入对局、下一席能继续、复盘能标注」的一半。

**非阻塞建议**：真实计时用例用 50ms 上限 + 75ms 断言，在负载高的 CI 上有一定抖动风险；`expect(calls).toBeGreaterThanOrEqual(1)` 也偏弱（不过「第一次失败、第二次成功」用例锁住了重试）。可考虑 fake timers 或把上限/余量做成可注入参数。`raceTimeout` 超时后没有取消仍在跑的请求，生产侧应接 `AbortSignal`（AI-3 / AI-7 的后续）。

---

### 5. 逐条验收标准（只列本轮受影响的）

| AC | Round 4 | Round 5 | 依据 |
|---|---|---|---|
| 1 | PARTIAL | **PARTIAL** | C-96 的 `done` 已能收到；真实 p95 仍是手工项，生产侧仍无发布者 |
| 2 | NEEDS WORK | **NEEDS WORK** | P7 会让实时 `done` 被空 `done` 推高的 `lastId` 丢掉，正文停在半句 |
| 3 | PARTIAL | **PARTIAL** | 真实 p95 手工项；服务端首事件时间仍未记录（C-93，未重查） |
| 4 | PASS | **PASS（未重查）** | C-89 已关闭 |
| 5 | FAIL | **FAIL** | P3（committed `done` 被丢）与 P7（实时 `done` 被丢）；C-96 客户端锁缺失 |
| 6 | PASS | **PASS（未重查）** | Round 1 的逐字节用例仍有效 |
| 7 | NEEDS WORK | **NEEDS WORK** | P6 证明预算截断成立；但仍无写回入口 / 调用者，无法端到端证明「短句替换 + 对局继续」 |
| 8 | PASS（helper） | **PASS（helper，未重查）** | 重试成功不降级的 helper 用例仍在 |
| 9 | FAIL | **FAIL** | P5：历史 `DEGRADED` 仍是空 `done`；生产侧无 `degraded` 发布者 |
| 10 | NEEDS WORK | **NEEDS WORK** | `degradeEvents` 无写回入口；无「下一席位」集成测试 |
| 11 | PARTIAL | **PARTIAL** | `DEGRADED` 可 replay，但仍只有席位、没有轮次标注；无轮次级测试 |
| 12 | PARTIAL | **PARTIAL** | helper 用例成立；无生产调用者 / 无「对局未卡死」集成测试 |

---

### 6. 五个审查维度

#### 6.1 RFC ADHERENCE —— **FAIL**

- 用户点名的四项中，C-96（服务端）与 C-87（预算）成立；C-86 的合并顺序只修了顺序、没有保住 committed `done`；C-86 的无正文过滤没有实现。
- 缺功能不变：按事件类型映射的 committed 回放；非发言事件不进发言流；committed `done` 的保留规则；生产侧 `thinking` / `delta` / `degraded` 发布者；`runTurn` / `degradeEvents` 的写回路径与调用者。
- 文档过度声明：RFC §8.10、`RFCS.md` v2.80 变更记录和提交说明都写「无正文事件不进发言流」，与 `stream.ts:30-45` 相反；§8.4 的 AC-9 / 10 / 11 / 12 仍写 PASS。

#### 6.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：本提交没有让 `src/engine/` import UI / server / 网络。 |
| `ARCH-4` | **PASS**：`runTurn` 的时钟仍由调用方注入，预算用 `now()` 计算。 |
| `DATA-1` | **PASS**：SSE 消息 id 取事件 `seq`；`DEGRADED` 折叠后 `seq` 由 `applyEvent` 推进。 |
| `API-2` | **PASS**（id = seq）；但 AC-5 的「不重复、不丢失」仍 FAIL，见上表。 |
| `TEST-1` | **FAIL**：C-96 的客户端同 id 重置无锁（M5 全绿）；C-86 的 committed `done` 丢失与空 `done` 推高 `lastId` 无 route → reducer 用例；M4 证明现有用例锁的是旧映射。C-87 预算项的锁已补上。 |
| `DOC-1` | **FAIL**：§8.10 / v2.80 变更记录 / 提交说明声称的无正文过滤不存在；§8.6 仍把持续推送归 RFC-012 且说路由一次写完；§8.4 的 AC-9 / 10 / 11 / 12 仍为 PASS。 |
| `AI-3` / `AI-7` | **未重查**：未改调用超时 / 重试配置；`runTurn` 与 `decide()` 的重试层数叠加风险仍按 Round 4 记录。 |
| `SEC-5` | **PASS（数据面）**：SSE 仍只发可见事件，没有直接序列化完整 `GameState`；会话检查仍在。 |

#### 6.3 SECURITY —— **PASS**

本轮改动没有新增输入面、密钥或日志：`StreamBus.replay` 只重放内存里已发布给该对局的 `StreamMessage`；路由仍在 `resolveSession` 之后校验 `session.gameIds`；`SNAPSHOT_REQUIRED` 只回显客户端提供的 `Last-Event-ID`；`JSON.stringify` 的帧编码不变。C-90 的可见性回归锁仍是未重查的非阻塞项。

#### 6.4 PERFORMANCE —— **NEEDS WORK**

- `committedMessages` 仍对全部历史可见事件生成 `done`，没有 200 条窗口；每次重连都做一次完整 replay + 全量序列化。
- P3 / P7 会重复发送同一段发言的增量（总线 + committed），并让客户端做无用功。
- C-96 的整段重放会把整段旧增量再发一遍；已完成的发言尤其明显。
- `PassThrough` 的 `write` 没有 backpressure 处理；`bus.end` 之后的新连接仍会挂起（Round 3 的 P7，非阻塞）。
- `raceTimeout` 超时后底层请求没有取消，仍在跑；最坏情况下两次请求并行占用资源。

#### 6.5 MAINTAINABILITY —— **NEEDS WORK**

- 两份「历史」（`committedMessages` 与 `StreamBus.replay`）仍由路由内联合并，没有单独的可测 merge 函数；P3 / P7 都出在这段内联逻辑里。
- `committedMessages` 同时承担「快照」「发言」「非发言事件」三种语义，`done` 分支又同时承担「终结真实发言」「非发言事件」「跳过发言」三种语义；P5 / P7 的根因都在这里。
- 测试侧：C-86 的新合并用例只断言 id 有序；C-96 的客户端重置没有用例；C-87 的计时用例有抖动风险。正向是 C-87 的 M1 和 C-96 的 M2 都能打红，说明这两处修复本身不是「假测试」。
- 提交说明 / 变更记录 / §8.10 把未实现的过滤写成已实现，会误导下一轮实现者；这属于 DOC-1，不是措辞问题。

---

### 7. 变异探针与恢复

备份在 `/tmp/howl-rfc010-r5-backup/`，覆盖 `src/server/routes/stream.ts`、`src/server/stream/bus.ts`、`src/server/llm/turn.ts`、`src/client/use-stream.ts` 以及被测文件；临时探针在 `/tmp/howl-rfc010-r5-backup/__r5-probe.test.ts`，仓库内副本已删除。每个变异用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P1 | 断线期间发言已完成（`thinking` + `delta` + `done` 全在历史），带 `Last-Event-ID = speechId` 重连，响应喂 reducer | 真实路由 + reducer | `[thinking, delta, done]`；最终 `phase=done`、正文完整（C-96 通过） |
| P2 | 已收到完整 `done` 的客户端再带同一 id 重连，响应喂 reducer | 真实路由 + reducer | 最终 `phase=done`、正文完整，未退回 `speaking`（C-96 通过） |
| M2 | 删掉 `bus.ts:66-72` 的 `hasSpeechAt` 整段重放 | `tests/server/stream.test.ts` | **2 failed / 11 passed**（C-96 服务端有锁） |
| M5 | `use-stream.ts:52` 改成「只有 id 变化才重置」 | `use-stream` + `stream` 测试 + 全量 | **68 files / 571 tests 全绿**（C-96 客户端重置无锁；相关 23 条也绿） |
| P3 | 真实已提交 `SPEECH` seq 15 + 总线同 seq `thinking` / `delta`，带 `Last-Event-ID: 14` | 真实路由 + reducer | `[thinking:15, delta:15]`；无 `done`；最终 `speaking` / 半句（C-86 committed done 丢失） |
| M3 | 恢复「先 committed 再 bus」的旧顺序 | `tests/server/stream.test.ts` | **1 failed / 12 passed**（顺序修复有锁） |
| P4 | 真实一局 + 追加 `DEGRADED` seq 15 | `committedMessages` | 4/4 条都是空 `done`，最后一条 `done:15` text `''`（C-86 过滤未实现） |
| P5 | 把已提交 `DEGRADED` 从路由发给客户端，响应喂 reducer | 真实路由 + reducer | `[done:12..done:15]`；最终 `phase=done`，不是 `degraded`（AC-9 历史路径失败） |
| P7 | 最后一个 `SPEECH` seq 22 + 已提交 `PHASE_CHANGED` seq 23；连接后再发实时 `done:22` | 真实路由 + reducer | `[thinking:22, delta:22, done:23, done:22]`；`done:22` 因 `lastId=23` 被丢；最终半句（C-86 数据丢失） |
| M4 | 把「只保留带 `text` 的事件」加进 `committedMessages` | `tests/server/stream.test.ts` | **2 failed / 11 passed**（AC-5 / C-88 锁定旧映射） |
| P6 | `attempt` 永不 resolve，`limitMs=40` | `runTurn` | `elapsed=41ms, attempts=1, degraded=true`（C-87 预算截断成立） |
| M1 | `turn.ts` 改回 `last = await input.attempt()` | `tests/server/degrade.test.ts` | **1 failed / 15 passed**（`expected 82 to be less than 75`；预算有锁） |

**恢复校验**：

```
$ md5 -q src/server/routes/stream.ts src/server/stream/bus.ts src/server/llm/turn.ts src/client/use-stream.ts
1965468670431c8f95150e2f94e066b6
909921a07050e442204e7cf5c774b818
1a36e8e5003b1a56da66cbf185b4257c
c952aa1d8d3d3ee6d4e896f850c2bffb

$ md5 -q /tmp/howl-rfc010-r5-backup/{stream.ts,bus.ts,turn.ts,use-stream.ts}
1965468670431c8f95150e2f94e066b6
909921a07050e442204e7cf5c774b818
1a36e8e5003b1a56da66cbf185b4257c
c952aa1d8d3d3ee6d4e896f850c2bffb

$ git status --porcelain
（空）

$ pnpm test
 Test Files  68 passed (68)
      Tests  571 passed (571)
```

---

### 8. 结论

- **Overall Risk Level: High**
- **Summary**：C-96 的服务端整段重放和 C-87 的尝试级预算都是真修复，而且 M2 / M1 会打红；但 C-96 的客户端同 id 重置没有锁（M5 全绿）。C-86 的两项都没有闭合：合并顺序虽然修好且有锁，但已提交的 `done` 在同 id 有总线增量时仍被丢掉（P3）；「无正文事件不进发言流」根本没有实现（P4 / P5），并且空 `done` 会把 `lastId` 推过在途发言、让实时 `done` 被丢弃（P7）。C-87 的写回入口 / 调用者 / RFC-011 交接仍未动。
- **Blocking Issues**：
  1. **C-86 无正文过滤未实现**：`committedMessages` 仍把每个可见事件映射成 `done`（P4）；历史 `DEGRADED` 仍是空 `done`（P5，AC-9 失败）；非发言事件的空 `done` 会把 `lastId` 推过在途发言，实时 `done` 被 reducer 丢弃（P7，半句正文）。修复按事件类型映射（`SPEECH → done`、`DEGRADED → degraded`、其余跳过），并同步 AC-5 / C-88 的期望与三条 route → reducer 用例。
  2. **C-86 committed `done` 仍会丢**：`busIds.has(id)` 在同 id 有部分总线增量时把 committed `done` 也滤掉（P3），客户端停在 `speaking` / 半句；现有合并用例只断言 id 有序，覆盖不到。按 id 保留「总线无 `done` 时追加 committed `done`」并补 reducer 断言。
  3. **C-86 生产侧 / 归属未动**：`grep bus.publish src/` 零命中；§8.6 仍写 `reply.send` 一次写完并归 RFC-012；`RFCS.md` §3 没有 RFC-011 后继，RFC-011 也不依赖 010。AC-9 / 10 没有端到端证据。
  4. **C-87 其余阻塞未动**：`GameRegistry` 无追加原始事件入口；`runTurn` / `degradeEvents` 无调用者；§8.4 的 AC-10 / 11 / 12 仍写 PASS，§8.6 无 RFC-011 交接。
  5. **C-96 客户端回归锁缺失**：M5 改坏「同 id thinking 重置」后全量 571 仍绿；补一条 reducer 用例再关闭 C-96。
- **Improvement Suggestions**：① 把 `committedMessages` / `StreamBus.replay` 合成一个可单测的 merge 函数，按 id 分组合并，避免 P3 / P7 这类内联顺序问题。② 给 `raceTimeout` 传 `AbortSignal`，超时后取消真实请求。③ 真实计时用例考虑 fake timers 或可注入时钟，降低 75ms 断言的抖动。④ C-96 的 `thinking` 被挤出 200 条窗口时加独立重放信号或补用例。⑤ 下一次 docs 提交同步 §2.2 / §8.4 / §8.6 / `TEST-STRATEGY.md`（C-92）。
- **Suggested status**：**`Changes requested`**。

---

### 9. Open conflicts（登记到 `RFCS.md` §8.31 Round 5 段）

- **C-96 · AC-5 / D-3 vs 整段重放**：行为已按 §8.10 记录并通过 P1 / P2，但 §2.2 仍写「从下一个 `seq` 继续」、D-3 仍只描述共享 id、§8.4 的 AC-5 仍写「重连返回空（不重复）」。这是有意的偏离，不是缺陷；下一次 docs 提交应同步 §2.2 / AC-5 / D-3 / `TEST-STRATEGY.md`，避免下一位维护者按旧口径回退。
- **C-86 · 无正文过滤 / committed `done` / 归属**：§8.10 与 v2.80 变更记录声称「无正文事件不进发言流」，代码没有实现；P4 / P5 / P7 可复现。合并规则在同 id 有总线增量时会丢掉 committed `done`（P3）。`bus.publish` / `runTurn` / `degradeEvents` 仍无生产调用者，§8.6 仍归 RFC-012，`RFCS.md` §3 没有 RFC-011 后继，RFC-011 也不依赖 010。
- **C-87 · 写回与交接**：预算已修且有锁（P6 / M1）；`GameRegistry` 仍无追加原始事件入口，`degradeEvents` 无法落盘，`runTurn` 无调用者；§8.4 的 AC-10 / 11 / 12 仍写 PASS，§8.6 无 RFC-011 交接。按「代码 + 实测」判为未验收。
- **C-92（未重查，非阻塞）**：`TEST-STRATEGY.md` 的 RFC-010 小节仍全 `proposed`，文件名（`sse.test.ts` / `replay-degrade.test.ts` / `stream.spec.ts`）与实现不符；`README.md` 状态与覆盖数字仍待回写。按 Round 1 记录保持非阻塞。

## Round 6 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

本轮只复核用户点名的 Round 5 五项修复：**C-86 按类型映射**、**C-86 保留 committed `done`**、**C-87 的 `speak.ts` 生产接线**、**`GameRegistry.appendEvents`**、**C-96 同 id 整段重放的客户端回归锁**。已关闭的 C-85 / C-88 / C-89 不重查；C-90 ~ C-95 的非阻塞记录保持（C-92 的文档漂移本轮仍未重查）。C-96 本轮关闭。

一句话：**类型映射本身成立，C-96 的客户端锁也真的能打红；但 committed `done` 在同 id 有增量时被排到了增量之前（P-R6-1），`DEGRADED → degraded` 没有任何回归锁（M-R6-1 全量仍绿）；`speak` / `appendEvents` 的写回路径在夜晚写出不可 replay 的事件流（P-R6-2），在白天最后一位发言后不推进到投票（P-R6-3），并且与 RFC-011「引擎只接收 action」的边界冲突（C-97）。**

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `be4143d`，`git status --porcelain` 为空。

```
$ pnpm typecheck
... TYPECHECK_EXIT=0

$ pnpm lint
... LINT_EXIT=0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building client environment for production...
dist/server/index.js  91.29 kB │ gzip: 30.46 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  69 passed (69)
      Tests  575 passed (575)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`coverage/coverage-summary.json`，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查服务端 SSE 协议、流式消息合并、降级写回路径与测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / Playwright（A 方案把界面留给 RFC-012，`tests/e2e/` 为空）。HTTP 端点与事件流仍检查，因为它们是本 RFC 的交付物。

**探针后的复跑**：所有探针都使用独立临时测试文件 `tests/server/__r6-probe.test.ts` 或从 `/tmp/howl-rfc010-r6-backup/` 的文件备份恢复；源码四处 `md5` 与备份逐一相同（见 §6），临时探针文件已删除，`git status --porcelain` 为空；恢复后 `pnpm test` 复跑 **69 files / 575 tests 全绿**。没有 `git commit`，也没有使用 `git checkout`。

---

### 1. C-96 · 同 id 整段重放的客户端回归锁 —— 关闭

Round 5 新增的 `tests/client/use-stream.test.ts:130-142` 是有效的回归锁：先喂 `delta(15,'我')`、`delta(15,'觉得')`，再从同 id 的 `thinking(15)` 开始整段重放；断言最终正文仍是「我觉得」，不是「我觉得我觉得」。

- **M-R6-3**（把 `src/client/use-stream.ts:52` 改成「只有 id 变化才重置」）：

  ```
  FAIL  tests/client/use-stream.test.ts > C-96 · 断线重连时同 id 的 thinking 重置正文（整段重放）
  AssertionError: expected '我觉得我觉得' to be '我觉得'
  Tests  1 failed | 10 passed (11)
  ```

  这正好覆盖了 Round 5 指出的「M5 全绿」缺口。**C-96 关闭。**

- 协议文档仍是旧口径：§2.2 写「从下一个 `seq` 继续」、D-3 只描述共享 id、§8.4 的 AC-5 仍写「重连返回空（不重复）」，而实现是整段重放。行为本身已由 P1 / P2 与 M-R6-3 证明，文档同步是非阻塞的 C-92 债务，不据此重开。

---

### 2. C-86 · 类型映射成立；committed `done` 的合并顺序仍然反，且映射无回归锁

**按事件类型映射本身成立。** `src/server/routes/stream.ts:36-55` 现在只把 `SPEECH` 映射成 `done`、`DEGRADED` 映射成 `degraded`，其余事件跳过。用真实对局验证历史路径（P-R6-4）：在 `DAY_SPEECH` 里追加 `DEGRADED(seq 15)` + 短句 `SPEECH(seq 16)`，带 `Last-Event-ID: 14` 走真实路由：

```
P-degraded messages= [ 'degraded:15', 'done:16' ]
P-degraded finalState= {"phase":"done","seat":2,"text":"我先过。", ...}
```

这证明 AC-9 的历史补偿路径现在能到 `degraded`，短句也能到 `done`；非发言事件不再冒充空 `done`。

**但 `DEGRADED → degraded` 没有任何测试锁（M-R6-1）。** 把 `routes/stream.ts` 的 `DEGRADED` 分支改回 Round 4 的空文本 `done` 后：

```
$ pnpm test
 Test Files  69 passed (69)
      Tests  575 passed (575)
```

全量 69/575 仍然全绿。Round 5 的核心改动（类型映射）在测试里只被 AC-5 的「只含 SPEECH」间接覆盖；`DEGRADED` 分支被改坏时没有任何用例会红。这是 TEST-1 的缺口，不是行为缺口——但鉴于本 RFC 前四轮反复出现「声称修了、实际没锁」，本轮把它列为阻塞项。

**committed `done` 的保留逻辑仍然有顺序错误（P-R6-1，阻塞）。** `src/server/routes/stream.ts:104-112` 先算 `extras`，再写：

```ts
const ordered = [...extras, ...fromBus].sort((a, b) => a.id - b.id);
```

同一段发言的所有消息共享 `id = seq`，而 `Array.prototype.sort` 稳定——`extras` 里的 committed `done` 会排在总线里同 id 的 `thinking` / `delta` **之前**。用真实对局复现（真实已提交 `SPEECH` seq 15，总线里只有同 id 的 `thinking` / `delta`，带 `Last-Event-ID: 14` 重连）：

```
P3 messages= [ 'done:15', 'thinking:15', 'delta:15' ]
P3 finalState= {"phase":"speaking","seat":2,"text":"我","lastId":15,"speechId":15,...}
```

客户端处理完重连响应后停在 `speaking` / 半句「我」，完整正文「我觉得 2 号像狼」与 `done` 的语义都被同 id 的 `thinking` / `delta` 覆盖。把这一行换成 `[...fromBus, ...extras]`（稳定排序，同 id 时总线在前）后，同一个探针变成：

```
P3 messages= [ 'thinking:15', 'delta:15', 'done:15' ]
P3 finalState= {"phase":"done","seat":2,"text":"我觉得 2 号像狼",...}
```

这不是只影响测试的边角：`src/server/llm/speak.ts:83-109` 先 `appendEvents` 写入 `SPEECH`，再发布 `delta` / `done`；在这段窗口里重连的客户端会走到上述路径。只有后续 live `done` 才能补全，若连接再次断开 / 流结束，就永远停在半句。

**现有用例覆盖不到。** `tests/server/stream.test.ts:378-400` 只断言 `ids` 排好序；它的总线消息放在 `record.events[0].seq`，与 committed 的 `SPEECH` 不同 id，既没有构造「同 id committed `done` + 部分总线增量」，也没有把响应喂给 reducer。Round 5 要求的 route → reducer 断言仍未补上。

**结论**：C-86 仍 Open（阻塞）——按类型映射已实现，但 committed `done` 的顺序仍然是错的，且类型映射本身没有回归锁。AC-5（不重复、不丢失）在重连路径上仍 FAIL，AC-2（`done` 之前的中间态）在重连路径上仍 NEEDS WORK。

---

### 3. C-87 · `speak` / `appendEvents` 写回路径 —— 接缝存在，但不能作为可用的生产路径

`src/server/llm/speak.ts` 确实把 `runTurn` → `degradeEvents` → `appendEvents` → `bus.publish` 串了起来，纯函数层面能工作：在真实 `DAY_SPEECH` 里对一个席位调用降级 `speak`，事件流 replay 通过，下一席位前进，`seq` 连续，短句 ≤10 字（P-R6-4）：

```
P-degraded-speak phase= DAY_SPEECH next= 3 degradations= [ 2 ] text= 我先过。 seq= 14 16
```

**但这条写回路径绕过了 `engine.step`，P-R6-2 / P-R6-3 证明它不能直接用于生产。**

#### 3.1 P-R6-2 · 夜晚写出的 `SPEECH` 让事件流不可 replay（DATA-3）

在 `createGame` 直接得到的夜晚局面调用一次正常 `speak`：

```
P-speak-night events= [ 'GAME_STARTED:1', 'SPEECH:2' ]
P-speak-night replay ERROR= SPEECH 之前没有 DAY_STARTED，无法记录席位 3
```

降级路径同样：

```
P-speak-night-degraded replay ERROR= SPEECH 之前没有 DAY_STARTED，无法记录席位 2
```

`GameRegistry.appendEvents`（`src/server/store/game-registry.ts:232-236`）只是把事件数组拼上去、`store.set`，既不校验 `seq` / `gameId`，也不调用 `applyEvent` / `replay`；注释写「`seq` 已由调用方保证连续」，但唯一的调用方 `speak` 在开局就会写出相位非法的 `SPEECH`。更糟的是 `tests/server/speak.test.ts` 的三条用例只检查 `result.record.events` / `seen` / 调用次数，从不 `registry.stateOf(result.record)`，所以这些用例全绿；若真实调用发生在错误相位，第一次 `stateOf` / `project()` / `replay()` 才爆炸，且此时事件已经落盘。

#### 3.2 P-R6-3 · 白天最后一位发言后不进入投票（AC-10 / AC-12 / NFR-10）

`advanceIfDone` 只存在于 `SPEECH` / `SPEECH_SKIP` 的 action handler 里（`src/engine/phases/day.ts:118-147`）：它负责在全员发言完后发出 `PHASE_CHANGED(DAY_SPEECH → DAY_VOTE)`。`speak` 直接 `appendEvents`，不经过 handler，因此：

```
P-speak-day speakers= 8 phase= DAY_SPEECH currentSpeaker= undefined
             lastEvents= [ 'SPEECH:19', 'SPEECH:20', 'SPEECH:21', 'SPEECH:22' ]
```

按 `speak.ts:12` 注释的既定用法（每个 AI 回合调用它），真实一局里 8 个 AI 都通过 `speak` 说完后，状态仍停在 `DAY_SPEECH`，`currentSpeaker(state)` 是 `undefined`，没有任何 `PHASE_CHANGED` 去 `DAY_VOTE`。之后 `SPEECH` / `SPEECH_SKIP` 都会因「本日全员已发言」被拒绝，也没有别的 action 能推进——**这一天会永久卡住**。这正是 AC-10「降级后对局继续推进」与 AC-12「对局未卡死」要防的情况；而 AC-12 的 `tests/server/speak.test.ts:72-98` 用的是连续四次夜晚 `speak`，事件流本身不可 replay，`calls=8` 只证明了「attempt 被调用 8 次」，没有证明对局能继续。

#### 3.3 与 RFC-011 的边界冲突（新 C-97）

`src/server/llm/speak.ts:12` 写「RFC-011 的 `SseOutputChannel` 负责在每个 AI 回合调用它」，但：

- RFC-011 §2.3 明确「引擎**只接收 action**、产出事件」，`OutputChannel.emit(chunk)` 只负责把一段 AI 发言的**增量文本**推给 SSE；它不负责写事件流。
- `speak` 在 `src/` 里没有调用者（`grep` 只有定义与注释）；RFC-011 尚未开工，`RFCS.md:74` 的 RFC-010 后继仍是 `—`，RFC-011 的 `Depends on` 也只有 005 / 007。
- 因此当前既没有可用的生产调用链，也没有记录这次跨 RFC 交接的依赖变更；`speak` 不是「接线」，而是一条与 RFC-011 动作层平行的第二条写路径。

**结论**：C-87 仍 Open（阻塞）。`appendEvents` 作为「追加非 action 事件」的入口本身可以保留，但 `speak` 不应同时负责写 `SPEECH` 与推进回合；建议二选一：

1. **动作层方案（推荐）**：`speak` 只负责生成文本与推送增量；写回合仍走 `registry.submit(SPEECH action)`，由引擎校验当前席位、写 `SPEECH` 并在全员发完后自动发 `PHASE_CHANGED`。降级时把 `DEGRADED` 作为 server 事件追加，再用短句提交 `SPEECH` action（或给 registry 一个「append + advance」方法，内部仍调用同一个 handler）。
2. **如果坚持 `appendEvents` 写 `SPEECH`**：`appendEvents` 必须先把事件 `applyEvent` 到一个临时 `GameState` 上（校验 seq / gameId / 相位 / 是否当前发言人），再在写完后执行 `advanceIfDone` 的同一套派生逻辑（不能复制一份判断）；`speak` 必须校验阶段。无论哪条，都要补「replay 通过」「下一席位」「最后一位进 DAY_VOTE」的端到端用例。

---

### 4. 逐条验收标准（只列本轮受影响的）

| AC | Round 5 | Round 6 | 依据 |
|---|---|---|---|
| 1 | PARTIAL | **PARTIAL** | `speak` 在 attempt 之前发 `thinking`（`speak.ts:45`）；真实 p95 仍是手工项（D-6） |
| 2 | NEEDS WORK | **NEEDS WORK** | P-R6-1 让重连后的正文停在半句；live 总线顺序正常 |
| 3 | PARTIAL | **PARTIAL** | 真实 p95 手工项；服务端首事件时间仍未记录（C-93，未重查） |
| 4 | PASS | **PASS（未重查）** | C-89 已关闭 |
| 5 | FAIL | **FAIL** | P-R6-1（`done:15 → thinking:15 → delta:15`）；C-96 客户端锁已关闭 |
| 6 | PASS | **PASS（未重查）** | Round 1 的逐字节解码用例仍有效 |
| 7 | NEEDS WORK | **PASS（日间行为）/ NEEDS WORK（集成）** | P-R6-4 在 `DAY_SPEECH` 里证明 DEGRADED + ≤10 字短句 + seq 连续；但 `speak` 的夜晚路径不可 replay，且没有测试锁 |
| 8 | PASS（helper） | **PASS（helper，未重查）** | 重试成功不降级的用例仍在 |
| 9 | FAIL | **PASS（行为）/ TEST-1 缺失** | P-R6-4 历史路径能到 `degraded`；M-R6-1 把 DEGRADED 分支改回空 `done` 后全量 575 仍绿 |
| 10 | NEEDS WORK | **FAIL** | P-R6-3：全员 `speak` 后停在 `DAY_SPEECH` / `currentSpeaker=undefined`，无 `PHASE_CHANGED` |
| 11 | PARTIAL | **PARTIAL** | `state.degradations` 只记席位，没有轮次 / 天数标记；没有轮次级测试 |
| 12 | PARTIAL | **NEEDS WORK** | 4 次 attempt 的计数成立，但夜晚事件流不可 replay，且最后一位会卡死；「未卡死」未被证明 |

---

### 5. 五个审查维度

#### 5.1 RFC ADHERENCE —— **FAIL**

- 用户点名的五项里：类型映射成立、C-96 回归锁成立；但 committed `done` 的合并顺序仍错（P-R6-1），生产侧 `speak` 路径不可用（P-R6-2 / P-R6-3），`DEGRADED` 映射无锁（M-R6-1）。
- 额外实现了 RFC §3 未列出的 `speak.ts`（`appendEvents` 写回），但 RFC §8.3 的文件清单没有更新，§8.6 仍写「路由用 `reply.send` 一次写完、持续推送在 RFC-012」——这两句在 Round 2 之后就已经不成立，属于 DOC-1。
- §8.11 声称「`extras` 保留…committed `done`」，实际保留了但顺序错误；§8.11 声称「`speak.ts` 串起生产侧」，实际没有 `src/` 调用者，且写出的流不满足 DATA-3。

#### 5.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：没有让 `src/engine/` import UI / server / 网络。 |
| `ARCH-4` / `ARCH-9` | **PASS（未改）**：`runTurn` 的时钟仍由调用方注入；客户端仍不做状态机权威。 |
| `DATA-1` | **NEEDS WORK**：正常日间路径 `seq` 连续；但 `appendEvents` 不校验，调用方在夜晚能写出相位非法的 `SPEECH`。 |
| `DATA-3` | **FAIL**：P-R6-2 的 `stateOf()` 直接抛错；`speak` 在错误相位产出的流不可 `replay`。 |
| `API-2` | **PASS**：SSE 消息 `id` 仍等于事件 `seq`；AC-5 的「不丢失」另判 FAIL（P-R6-1）。 |
| `TEST-1` | **FAIL**：`DEGRADED → degraded` 无锁（M-R6-1）；`speak.test.ts` 的 AC-10 / 11 用例不 replay、不检查下一席位 / 相位；AC-9 没有 route → reducer 用例。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未因本 RFC 下降。 |
| `DOC-1` | **FAIL**：§8.3 文件清单缺 `speak.ts` / `speak.test.ts`；§8.6 仍写 `reply.send` 一次写完并归 RFC-012；§8.4 的 AC-10 / 11 / 12 仍写 PASS；§8.11 的「`extras` 保留 committed done」与「生产侧」均与实测不符。 |
| `AI-3` / `AI-7` | **未重查**：未改调用超时 / 重试配置；`raceTimeout` 超时后不取消底层请求、`speak` 未接日志的旧风险仍按 Round 5 记录。 |
| `SEC-5` | **PASS（数据面）**：SSE 仍只发可见事件，没有直接序列化完整 `GameState`；`speak` 只发文本 / 席位。 |

#### 5.3 SECURITY —— **PASS**

本轮改动没有新增对外输入面、密钥或日志：`speak` 不在 HTTP 路由上，`committedMessages` 仍先过 `isVisibleTo`，路由仍在 `resolveSession` 之后校验 `session.gameIds`，`StreamBus.replay` 只重放该对局已发布的消息。C-90 的可见性回归锁仍是未重查的非阻塞项；这一点不因本轮改动而变化。

#### 5.4 PERFORMANCE —— **NEEDS WORK**

- `committedMessages` 每次连接都扫描全部历史事件并全量序列化，没有 200 条窗口（旧问题）。
- P-R6-1 会把同一段发言的 committed `done` 与总线增量重复发送，重连带宽和客户端重渲染都翻倍。
- `appendEvents` 每次写回都复制完整事件数组（`[...record.events, ...events]`），一局 n 次发言是 O(n²)；当前规模小，非阻塞。
- `chunkText` 在完整文本生成后一次性切块，不是真实流式；`raceTimeout` 超时后底层请求仍在跑（AI-3 的后续）。
- `PassThrough.write` 仍没有 backpressure 处理（旧非阻塞项）。

#### 5.5 MAINTAINABILITY —— **NEEDS WORK**

- 现在有两条写路径：`submit(action)` 负责校验 + 相位推进；`appendEvents` 负责原样写回。二者的不变量完全不同，却没有在类型 / 方法名 / 文档上说明；`speak` 同时使用后者并承担「引擎推进」的语义，正是 P-R6-3 的根因。
- `routes/stream.ts` 的 committed / bus 合并仍是内联逻辑，没有独立可测的 merge 函数；P-R6-1 就出在这段内联的 spread 顺序里。
- `tests/server/speak.test.ts` 的 describe 名写着「AC-10 / 11」，实际只断言事件类型 / 文本长度；不 replay、不检查下一席位 / 相位。这种「标题覆盖了、断言没覆盖」的测试比没有测试更危险。
- `speak` 正常路径返回 `getGame(...)` 再兜底旧 record，降级路径直接返回 `appendEvents` 的结果；两条路径的 `record` 语义不一致。
- 正向：`committedMessages` 的按类型映射代码清晰，P-R6-4 的历史 `degraded` 路径确实工作；C-96 的新 reducer 用例是一条真正会红的锁。

---

### 6. 变异探针与恢复

备份在 `/tmp/howl-rfc010-r6-backup/`，覆盖 `src/client/use-stream.ts`、`src/server/routes/stream.ts`、`src/server/llm/speak.ts`、`src/server/store/game-registry.ts`；临时探针为 `tests/server/__r6-probe.test.ts`，跑完已删除。每个变异用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P-R6-1 | 真实已提交 `SPEECH` seq 15 + 总线同 id `thinking` / `delta`，带 `Last-Event-ID: 14` | 真实路由 + reducer | `[done:15, thinking:15, delta:15]` → `phase=speaking`、`text='我'`（C-86 顺序错误） |
| P-R6-1b | 同上，把 `[...extras, ...fromBus]` 换成 `[...fromBus, ...extras]` | 真实路由 + reducer | `[thinking:15, delta:15, done:15]` → `phase=done`、正文完整（根因确认） |
| P-R6-2 | 开局（夜晚）正常 / 降级 `speak`，再 `registry.stateOf()` | `speak` + replay | `SPEECH 之前没有 DAY_STARTED，无法记录席位 3 / 2`（DATA-3） |
| P-R6-3 | 真实 `DAY_SPEECH`，8 个 AI 席位全部经 `speak` 发言 | `speak` + replay | `phase=DAY_SPEECH`、`currentSpeaker=undefined`、最后四条都是 `SPEECH`，无 `PHASE_CHANGED` |
| P-R6-4 | `DAY_SPEECH` 里降级 `speak`；以及已提交 `DEGRADED:15` + `SPEECH:16` 走路由 | `speak` / 路由 + reducer | 降级：下一席位 3、`degradations=[2]`、`seq 14→16`、短句 ≤10；路由：`[degraded:15, done:16]` → `phase=done`、`text='我先过。'` |
| M-R6-1 | 把 `routes/stream.ts` 的 `DEGRADED` 分支改回空文本 `done` | 全量 `pnpm test` | **69 files / 575 tests 全绿**（DEGRADED 映射无锁） |
| M-R6-2 | 把 `ordered` 改成 `[...fromBus, ...extras]` | P-R6-1 探针 | 变绿（顺序即根因） |
| M-R6-3 | `use-stream.ts:52` 改成「只有 id 变化才重置」 | `tests/client/use-stream.test.ts` | **1 failed / 10 passed**（C-96 有锁） |

**恢复校验**：

```
$ md5 -q src/client/use-stream.ts src/server/routes/stream.ts src/server/llm/speak.ts src/server/store/game-registry.ts
c952aa1d8d3d3ee6d4e896f850c2bffb
7019be5e13b8ef3951543c66b39ded09
7cf3fb5e266a72071d020db9ac4e6b78
9758257b0723985d95805aa9acb9c828

$ md5 -q /tmp/howl-rfc010-r6-backup/{use-stream.ts,stream.ts,speak.ts,game-registry.ts}
c952aa1d8d3d3ee6d4e896f850c2bffb
7019be5e13b8ef3951543c66b39ded09
7cf3fb5e266a72071d020db9ac4e6b78
9758257b0723985d95805aa9acb9c828

$ git status --porcelain
（空）

$ pnpm test
 Test Files  69 passed (69)
      Tests  575 passed (575)
```

---

### 7. 结论

- **Overall Risk Level: High**
- **Summary**：`committedMessages` 的按类型映射与 C-96 的客户端回归锁是本轮两项真实的修复，M-R6-3 会打红，P-R6-4 也证明历史 `degraded` 路径能工作；但 committed `done` 在合并时被排到同 id 增量之前，重连后仍会停在半句，且 `DEGRADED` 映射被改坏时全量 575 仍绿。`speak` / `appendEvents` 的写回路径在夜晚写出不可 replay 的事件流，在白天最后一位发言后不推进投票，并与 RFC-011 的动作层边界冲突（C-97）；它不是可用的生产接线。
- **Blocking Issues**：
  1. **C-86 · committed `done` 顺序**：P-R6-1，`[...extras, ...fromBus]` 让 `done:15` 排在 `thinking:15` / `delta:15` 之前；应改为同 id 时总线在前（或按 id 分组后把 committed `done` 追加在该组末尾），并补 route → reducer 用例。
  2. **C-86 · 类型映射无锁**：M-R6-1 把 `DEGRADED` 分支改回空 `done` 后全量 69/575 仍绿；补「历史 `DEGRADED` → `degraded` → 短句 `done`」的 route → reducer 用例。
  3. **C-87 / C-97 · `speak` 写回路径**：P-R6-2（夜晚 `SPEECH` 不可 replay）与 P-R6-3（全员发言后停在 `DAY_SPEECH`，无 `PHASE_CHANGED`）。`speak` 不应绕过 `submit` 写 `SPEECH`；降级写回要么走「append DEGRADED + submit 短句 SPEECH」，要么给 `appendEvents` 加 applyEvent 校验与同一套 `advanceIfDone` 派生逻辑。
  4. **DOC-1 · 交接与文档**：`speak.ts` / `speak.test.ts` 未进 §8.3；§8.6 仍写 `reply.send` 一次写完并归 RFC-012；§8.4 的 AC-10 / 11 / 12 仍写 PASS；`RFCS.md:74` 的 RFC-010 后继仍是 `—`，RFC-011 也不依赖 010。
- **Improvement Suggestions**：① 把 committed / bus 合并抽成可单测的 `mergeMessages(committed, replayable, lastEventId)`，用一个显式的「同 id 组」规则，而不是依赖 spread + 稳定排序的隐含顺序。② `appendEvents` 先 `applyEvent` 到临时状态，失败即不落盘；`speak` 进入前校验 `phase === 'DAY_SPEECH'` 且 `currentSpeaker === seat`。③ 给 `raceTimeout` 接 `AbortSignal`，超时后取消底层请求（AI-3 / AI-7 的后续）。④ 补 AC-10 / 12 的端到端用例：一局 8 个 AI 全部经生产路径发言后必须进入 `DAY_VOTE`，且中途一次降级不改变下一席位。⑤ AC-11 的「轮次」标记与 `degradations` 的持久化仍需在 RFC-014 前定案（当前只有席位列表）。⑥ 下一次 docs 提交同步 §2.2 / §8.3 / §8.4 / §8.6 / `TEST-STRATEGY.md`（C-92，非阻塞）。
- **Suggested status**：**`Changes requested`**。

---

### 8. Open conflicts（登记到 `RFCS.md` §8.31 Round 6 段）

- **C-97（新增，阻塞）· RFC-010 `speak` vs RFC-011「引擎只接收 action」**：`src/server/llm/speak.ts:12` 声称 RFC-011 的 `SseOutputChannel` 每回合调用它；RFC-011 §2.3 说 `OutputChannel` 只 `emit` 增量文本，引擎只接收 action。`speak` 直接 `appendEvents` 写 `SPEECH` 并跳过 `advanceIfDone`，与 RFC-011 §2.3 / `src/engine/phases/day.ts:118-147` 冲突。需决定：`speak` 只产出文本、写回合走 `submit`；或给 `appendEvents` 增加 applyEvent 校验与派生推进。
- **C-86（仍阻塞）· committed `done` 与总线顺序**：§8.10 / §8.11 声称合并已按 id 排序、同 id 不重复、committed `done` 保留；实测 P-R6-1 仍得到 `done → thinking → delta`，且 `DEGRADED` 映射无锁（M-R6-1）。这是实现与文档的不一致，不是新的规则冲突。
- **C-87（仍阻塞）· 生产路径与交接**：`appendEvents` / `speak` 已存在，但没有 `src/` 调用者；§8.4 的 AC-10 / 11 / 12 仍为 PASS，§8.6 的 `reply.send` 一次写完 / RFC-012 归属与代码相反；`RFCS.md` §3 没有 RFC-011 后继，RFC-011 的 `Depends on` 也没有 010。若正式交给 RFC-011，按 `AGENTS.md` 硬规则 6 同步依赖表与 §8.6；若不交，AC-10 / 12 必须在本 RFC 内端到端证明。
- **C-96（Round 6 关闭）· 协议文档仍旧口径**：§2.2 / D-3 / §8.4 AC-5 仍写「从下一个 `seq` 继续 / 重连返回空」，实现是整段重放；行为与测试已成立，文档同步归 C-92 非阻塞。
- **C-92（未重查，非阻塞）**：`TEST-STRATEGY.md` 的 RFC-010 小节仍全 `proposed`，文件名（`sse.test.ts` / `replay-degrade.test.ts` / `stream.spec.ts`）与实现不符；`README.md` 状态与覆盖数字仍待回写。

## Round 7 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: Medium**

本轮只复核 Round 6 的两项阻塞修复：**C-97 `speak` 写回走引擎** 与 **C-86 合并顺序 + `DEGRADED` 映射回归锁**。已关闭的 C-85 / C-88 / C-89 / C-96 不重查；C-87 的非 C-97 遗留（AC-11 的轮次标记、无 `src/` 调用者、文档）与 C-90 ~ C-95 非阻塞项按 Round 6 记录保留，本轮未重新审计。

一句话：**两项修复的核心行为都成立**——C-86 的同 id 顺序在真实路由 + reducer 下已是 `thinking → delta → done`，两个反向探针都会打红；C-97 的正常与降级发言都经 `submit` 推进 cursor / 相位，8 个席位与「最后一位降级」都能离开 `DAY_SPEECH`，夜晚也不再写出非法 `SPEECH`。**但 C-97 的降级分支没有任何回归锁（M-R7-4：只把降级分支改回 `appendEvents`，全量 69 / 578 仍绿），且修复改变了 AC-12 用例的语义却没有更新它（P-R7-7：同一席位连说 4 次实际是 1 次 `SPEECH` + 3 次 `REJECTED`，测试仍绿）。** C-86 本轮关闭。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `06667bf`，`git status --porcelain` 为空。

```
$ pnpm typecheck
... TYPECHECK_EXIT=0

$ pnpm lint
... LINT_EXIT=0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building ssr environment for production...
dist/server/index.js  91.31 kB │ gzip: 30.46 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  69 passed (69)
      Tests  578 passed (578)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`coverage/coverage-summary.json`，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查服务端 SSE 协议、提交 / 写回路径与测试证据；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / Playwright（A 方案把界面留给 RFC-012，`tests/e2e/` 为空）。HTTP 端点与事件流仍检查，因为它们是本 RFC 的交付物。

**探针方式**：所有探针使用独立临时文件 `tests/server/__r7-probe.test.ts`（跑完已删除）；变异用 `/tmp/howl-rfc010-r7-backup/` 的文件备份恢复，**未使用 `git checkout`**，也没有 `git commit`。恢复后四个源码文件 `md5` 与备份逐一相同，全量 69 / 578 复跑全绿，`git status --porcelain` 为空（见 §5）。

---

### 1. C-86 · 合并顺序与 `DEGRADED` 映射回归锁 —— 关闭

**顺序修复成立。** `src/server/routes/stream.ts:114` 已是 `[...fromBus, ...extras].sort(...)`。用真实对局（已提交 `SPEECH` seq 15、总线里只有同 id 的 `thinking` / `delta`、带 `Last-Event-ID: 14`）走真实路由，再把响应逐条喂给 `streamReducer`（P-R7-1）：

```
P1 messages= [ 'thinking:15', 'delta:15', 'done:15' ]
P1 finalState= {"phase":"done","seat":2,"text":"我觉得 2 号像狼","firstDeltaAt":0,
               "lastId":15,"speechId":15,"warned":false,"sawThinking":true}
```

这证明 Round 6 的 P-R6-1（`done → thinking → delta` → `speaking` / 半句）在真实链路上已经消失。

**两个反向探针都会打红。**

- **M-R7-1**（把 `ordered` 改回 `[...extras, ...fromBus]`）：`tests/server/stream.test.ts` **1 failed / 14 passed**，失败在新增用例「同 id 的增量与 committed done 合并后，done 在最后」：

  ```
  AssertionError: expected 'delta' to be 'done'
  ❯ tests/server/stream.test.ts:465
  ```

  同一变异下 P-R7-1 回到 `[done:15, thinking:15, delta:15]` → `phase=speaking`、`text='我'`，根因与 Round 6 一致。

- **M-R7-2**（把 `DEGRADED` 分支改回空文本 `done`）：同一文件 **1 failed / 14 passed**，失败在新增用例「历史路径里 DEGRADED + SPEECH → [degraded, done]」：

  ```
  - "degraded"
  + "done"
  ```

  这补上了 Round 6 的 M-R6-1（改坏后全量仍绿）缺口。

**历史路径的 route → reducer 也成立（P-R7-8）。** 在真实 `DAY_SPEECH` 里降级发言后，换一个「没有总线历史」的 `StreamBus` 重建 app，只走 committed 事件重放（`Last-Event-ID` 指向降级发言之前），响应逐条喂 reducer：

```
P8 messages= [ 'degraded:15', 'done:16' ]
P8 finalState= {"phase":"done","text":"我先过。"}
```

**遗留（非阻塞）**：Round 6 要求的「route → reducer 断言」在 committed 用例里仍未落地——新用例只断言最后一条消息类型是 `done`，`DEGRADED` 用例只单测 `committedMessages`。但消息顺序本身已被 M-R7-1 锁住、reducer 终态由 C-89 的用例锁住、P-R7-1 / P-R7-8 又独立验证了集成终态，因此不据此阻塞；建议下一次把「最后一条类型」改成 `streamReducer` 终态断言（改动很小）。另一个小项：`tests/server/stream.test.ts:436` 把 `registry.stateOf(record)`（追加 DEGRADED/SPEECH 之前的状态）传给 `committedMessages`，对这两个 `public` 事件无影响，但语义上应传 `withDegraded` 的状态。

**C-86 关闭。**

---

### 2. C-97 · `speak` 走引擎 —— 行为修复成立，测试锁不完整

#### 2.1 正常路径：8 个席位后确实离开 `DAY_SPEECH`

`src/server/llm/speak.ts:100-107` 改为 `registry.submit(SPEECH action)`，由引擎写事件并推进 cursor / 相位。独立探针（P-R7-3）在真实一天里对 8 个 AI 席位逐个调用 `speak`：

```
P3 state= {"phase":"DAY_VOTE","speakers":[2,3,4,5,6,7,8,9],
           "lastEvents":["SPEECH:19","SPEECH:20","SPEECH:21","SPEECH:22","PHASE_CHANGED:23"]}
```

`seq` 为 `1..23` 连续，`state.seq === record.events.length`，`stateOf()` 不抛错。Round 6 的 P-R6-3（停在 `DAY_SPEECH` / `currentSpeaker=undefined`）已不复现。M-R7-3（把 `speak` 整体改回 `appendEvents`）会让 `tests/server/speak.test.ts` 的 C-97 用例变红：

```
AssertionError: expected 'DAY_SPEECH' not to be 'DAY_SPEECH'
❯ tests/server/speak.test.ts:179
```

#### 2.2 降级路径：`DEGRADED` 标记 + 短句 `SPEECH` 也走了引擎

`src/server/llm/speak.ts:61-89` 先用 `appendEvents` 补 `DEGRADED`，再把短句交给 `submit`。独立探针（P-R7-2）在真实 `DAY_SPEECH` 里触发降级：

```
P2 events= [ 'DEGRADED:15', 'SPEECH:16' ]
P2 bus= [ 'thinking:15', 'degraded:15', 'done:16' ]
P2 state= {"phase":"DAY_SPEECH","next":3,"degradations":[2],"text":"我先过。"}
```

`seq` 连续、下一席位推进到 3、`degradations` 记录到席位 2、`done` 的 id 等于短句 `SPEECH` 的 `seq`。**最后一位降级也成立**（P-R7-6）：正常说完 7 位后对第 8 位降级：

```
P6 events= [ 'DEGRADED:22', 'SPEECH:23', 'PHASE_CHANGED:24' ]
P6 phase= DAY_VOTE seq= 24 len= 24
```

这正好覆盖 AC-10 的「降级后对局继续推进」。

#### 2.3 夜晚：不再写出非法 `SPEECH`，但把引擎的 `REJECTED` 当成功

Round 6 的 P-R6-2（开局 `SPEECH:2` 让 replay 抛错）已经不会复现——`submit` 让引擎把夜晚的 `SPEECH` 变成 `REJECTED` 事件，`stateOf()` 正常（P-R7-4 / P-R7-9）：

```
P4 outcome= ok
P4 events= [ 'GAME_STARTED:1', 'REJECTED:2' ]
P4 bus= [ 'thinking:2', 'delta:2', 'done:2' ]
P4 replay= ok

P9 events= [ 'DEGRADED', 'REJECTED' ] phase= NIGHT_WOLF_CHAT
P9 bus= [ 'thinking:2', 'degraded:2', 'done:3' ]
```

事件流变干净了，但 `speak` 仍然返回成功并向总线发了一条**带正文、事件流里并不存在的 `done`**（`speak.ts:106` 只检查 `submitted.ok`，没检查 `submitted.events` 里是否真有 `SPEECH`；降级分支 `speak.ts:75-81` 连 `submitted.ok` 都没检查）。白天对非当前席位调用同样如此（P-R7-5）：

```
P5 outcome= ok
P5 events= [ 'REJECTED' ]
P5 bus= [ 'thinking:15', 'delta:15', 'done:15' ]
```

目前 `speak` 在 `src/` 仍无调用者（RFC-011 未开工），所以这是接缝上的潜在缺陷，不是当前生产事故；但它会让下一个集成者把「抢话 / 夜晚说话」当成成功，刷新后正文消失。**列为阻塞**（见 §6 第 3 项），因为最小修复只需在发布 `done` 前确认引擎真的产出了本席位的 `SPEECH`。

#### 2.4 降级分支没有回归锁（阻塞）

只把**降级分支**改回 Round 6 的写法（`appendEvents` 写短句，正常分支保持 `submit`），全量提交的测试仍然全绿：

```
$ pnpm test
 Test Files  69 passed (69)
      Tests  578 passed (578)
```

也就是说 `tests/server/speak.test.ts:102-125`（AC-7）只断言「事件流里有 DEGRADED / SPEECH、短句 ≤ 10 字」，不检查下一席位或相位；`tests/server/speak.test.ts:157-181`（C-97）只跑正常路径。用临时探针 P-R7-6（最后一位降级）能抓到该变异（`phase` 停在 `DAY_SPEECH`），但它不在仓库里。**这是 TEST-1 缺口，与本 RFC 前几轮「声称修了、实际没锁」是同一类问题**，Round 6 也正因同类缺口（M-R6-1）把 C-86 判为阻塞，因此本轮按同一标准处理。

#### 2.5 AC-12 用例现在「绿得没有意义」（阻塞）

`tests/server/speak.test.ts:127-155` 仍然对**同一个席位**连续调用 4 次降级 `speak`，只断言 `calls === 8` 与 `total === 4`。改走 `submit` 后，同一席位第 2 次起会被引擎拒绝，实际序列是（P-R7-7）：

```
P7 rounds= [
  '#1 events=DEGRADED,SPEECH phase=DAY_SPEECH',
  '#2 events=DEGRADED,REJECTED phase=DAY_SPEECH',
  '#3 events=DEGRADED,REJECTED phase=DAY_SPEECH',
  '#4 events=DEGRADED,REJECTED phase=DAY_SPEECH'
]
P7 calls= 8 total= 4 lastPhase= DAY_SPEECH
```

用例的标题写着「连续 3 次降级后仍尝试真实调用 / 对局未卡死」，但它实际证明的是「1 次降级发言 + 3 次被拒绝的提交仍会计数」，而这 4 次调用结束时相位确实停在 `DAY_SPEECH`。这正是 Round 6 批评过的「标题覆盖了、断言没覆盖」。修复方向：改用 4 个不同席位（或在最后一位降级）并断言每次 `SPEECH` / `DEGRADED` 推进 + 最终离开 `DAY_SPEECH`；若 §2.3 的 `REJECTED` 检查也补上，这个用例就不可能再靠被拒绝的调用凑数。

---

### 3. 逐条验收标准（只列本轮受影响的）

| AC | Round 6 | Round 7 | 依据 |
|---|---|---|---|
| 1 | PARTIAL | **PARTIAL（未重查）** | `speak` 在 attempt 前发 `thinking`；真实 p95 仍是手工项（D-6） |
| 2 | NEEDS WORK | **PASS（本轮）** | P-R7-1：重连后 `thinking → delta → done`，reducer 终态为完整正文 |
| 3 | PARTIAL | **PARTIAL（未重查）** | 真实 p95 手工项；服务端首事件时间仍未记录（C-93，未重查） |
| 4 | PASS | **PASS（未重查）** | C-89 已关闭 |
| 5 | FAIL | **PASS（本轮）** | P-R7-1 + M-R7-1；committed 用例仍未做 reducer 断言（非阻塞） |
| 6 | PASS | **PASS（未重查）** | Round 1 的逐字节解码用例仍有效 |
| 7 | NEEDS WORK（集成） | **PASS（本轮）** | P-R7-2 / P-R7-6 / P-R7-8：DEGRADED + ≤10 字短句 + seq 连续 + 可 replay |
| 8 | PASS（helper） | **PASS（未重查）** | 重试成功不降级的用例仍在 |
| 9 | PASS（行为）/ TEST-1 缺失 | **PASS（本轮）** | P-R7-8 历史 `[degraded, done]` → `done` / `我先过。`；M-R7-2 会红 |
| 10 | FAIL | **PASS（行为）/ NEEDS WORK（测试锁）** | P-R7-2 / P-R7-3 / P-R7-6 行为全部成立；但 M-R7-4 证明降级分支无回归锁 |
| 11 | PARTIAL | **PARTIAL（未重查）** | `state.degradations` 仍只记席位，没有轮次 / 天数；RFC-014 前仍要定案 |
| 12 | NEEDS WORK | **NEEDS WORK（用例语义失效）** | P-R7-7：4 次同席位调用实际是 1 次 SPEECH + 3 次 REJECTED，`DAY_SPEECH` 未离开 |

---

### 4. 五个审查维度

#### 4.1 RFC ADHERENCE —— **NEEDS WORK**

- 用户点名的两项：**C-86 关闭**（顺序 + 映射都有会红的锁）；**C-97 行为修复成立**（正常 / 降级 / 最后一位 / 夜晚可 replay）。
- 仍差两件事：**降级分支没有回归锁**（M-R7-4 全绿），**AC-12 用例语义已失效**（P-R7-7）。两者都是 TEST-1，不是新的行为 bug，但在本 RFC 的评价标准下阻塞。
- 另外 `speak` 把引擎的 `REJECTED` 当成功（§2.3），与「事件流是唯一权威」不一致：UI 收到一条事件流里不存在的 `done`。
- 文档漂移仍在：§8.3 没有 `speak.ts` / `turn.ts` / `speak.test.ts`；§8.6 仍写「路由用 `reply.send` 一次写完（补偿窗口内的历史），持续推送在 RFC-012」；§8.4 的 AC-10 / 11 / 12 仍用旧证据写 PASS；`RFCS.md` §3 的 RFC-010 后继仍是 `—`。归 DOC-1 / C-92 非阻塞债务（本轮不重审），但下一轮改测试时应一并回写。

#### 4.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：`src/engine/` 未新增 UI / server / 网络依赖。 |
| `ARCH-4` / `ARCH-9` | **PASS（未改）**：时钟仍由调用方注入；客户端仍不做状态机权威。 |
| `DATA-1` | **PASS（本轮）**：`submit` 盖 `seq`，P-R7-2 / P-R7-3 / P-R7-6 的 `seq` 全部连续，`state.seq === events.length`。 |
| `DATA-3` | **PASS（本轮）**：P-R7-2 / P-R7-4 / P-R7-6 / P-R7-9 的 `stateOf()` 全部不抛；夜晚不再有非法 `SPEECH`。 |
| `API-2` | **PASS**：`committedMessages` 的 `id` 仍是事件 `seq`，`done` 的 id 等于 `SPEECH` 的 `seq`。 |
| `TEST-1` | **FAIL**：M-R7-4（降级分支改回 `appendEvents` 全量仍绿）；P-R7-7（AC-12 用例可用被拒绝的提交凑数）。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未下降。 |
| `DOC-1` | **NEEDS WORK**：§8.3 / §8.4 / §8.6 / §8.11 的旧口径仍在（DOC-1 / C-92）。 |
| `AI-3` / `AI-7` | **未重查**：未改调用超时 / 重试配置；`raceTimeout` 超时后不取消底层请求的旧风险按 Round 5 记录。 |
| `SEC-5` | **PASS**：SSE 仍只发可见事件；`speak` 只发文本 / 席位，没有新增密钥或完整状态序列化。 |

#### 4.3 SECURITY —— **PASS**

本轮改动没有新增对外输入面、密钥或日志：`speak` 不在 HTTP 路由上；`committedMessages` 仍先过 `isVisibleTo`；路由仍在 `resolveSession` 之后校验 `session.gameIds`。C-90 的可见性回归锁仍是未重查的非阻塞项，不因本轮改动而变化。

#### 4.4 PERFORMANCE —— **NEEDS WORK（旧问题，未加重）**

- `committedMessages` 每次连接仍扫描全部历史事件并全量序列化，没有 200 条窗口（旧问题）。
- 降级路径每次 `speak` 多一次 `appendEvents` + 一次 `stateOf` 全量 replay（`submit` 内部），当前规模可接受；但它把「一次写回」拆成两次存储 `set`。
- `chunkText` 在完整文本生成后一次性切块，不是真实流式；`raceTimeout` 超时后底层请求仍在跑（AI-3 的后续）。
- `PassThrough.write` 仍没有 backpressure 处理（旧非阻塞项）。
- 没有新增 N+1 / 无界拉取。

#### 4.5 MAINTAINABILITY —— **NEEDS WORK**

- **两条写路径仍未在类型 / 命名上收口**：`submit(action)` 有校验 + 相位推进；`appendEvents` 仍是「原样拼接、不校验」。现在 `speak` 只把 `DEGRADED` 交给后者、短句交给前者，比 Round 6 好，但 `degradeEvents()`（`src/server/llm/turn.ts:131-157`）仍会**同时**产出 `DEGRADED` + `SPEECH`，而生产路径只取第一条、第二条丢掉——下一个调用者若照文档把两条都 `appendEvents`，就会重新引入 C-97。建议让 `degradeEvents` 只返回 `DEGRADED`，或明确注释「SPEECH 仅供引擎路径 / 测试 fixture 使用」。
- **`speak` 的返回值没有「引擎是否接受」的结构化信号**（§2.3），调用者只能自己扫 `record.events` 找 `REJECTED`。
- **新增了两处 `as never`**（`speak.ts:78,103`）：`{ type: 'SPEECH', ts, seat, text }` 与 `Action` 的 `SPEECH` 成员形状一致，这两次类型逃逸没有必要（C-95 的同类问题仍在）。
- **测试质量**：`speak.test.ts` 的 AC-12 用例现在名不副实（P-R7-7）；C-86 的新用例只断言 message 类型、没有喂 reducer（P-R7-1 已独立证明正确，但仓库里缺这一行断言）。
- 正向：`submit` 让「引擎推进」重新成为唯一路径，P-R7-3 / P-R7-6 的相位推进是真实修复；C-86 的合并顺序注释与两个回归锁都清晰、会红。

---

### 5. 探针与恢复

备份在 `/tmp/howl-rfc010-r7-backup/`，覆盖 `src/server/llm/speak.ts`、`src/server/routes/stream.ts`、`src/server/store/game-registry.ts`、`src/client/use-stream.ts`；临时探针为 `tests/server/__r7-probe.test.ts`（9 个用例），跑完已删除。每个变异用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P-R7-1 | 真实已提交 `SPEECH` seq 15 + 总线同 id `thinking` / `delta`，`Last-Event-ID: 14`，响应逐条喂 `streamReducer` | 真实路由 + reducer | `[thinking:15, delta:15, done:15]` → `phase=done`、`text='我觉得 2 号像狼'`（C-86 顺序成立） |
| P-R7-2 | 真实 `DAY_SPEECH` 里降级 `speak` | `speak` + replay | `DEGRADED:15` + `SPEECH:16`；总线 `thinking:15 / degraded:15 / done:16`；下一席位 3；`degradations=[2]`；短句 ≤10 |
| P-R7-3 | 真实一天 8 个 AI 全部经 `speak` 正常发言 | `speak` + replay | `phase=DAY_VOTE`、`speakers=[2..9]`、`SPEECH:19..22` + `PHASE_CHANGED:23`，`seq 1..23` 连续 |
| P-R7-4 | 开局（夜晚）调用 `speak` | `speak` + replay | `REJECTED:2`，无 `SPEECH`，replay 通过；但 `speak` 返回成功并发布 `done:2` |
| P-R7-5 | 白天对**非当前席位**调用 `speak` | `speak` + replay | `REJECTED`，相位仍 `DAY_SPEECH`；`speak` 仍返回成功并发布 `done:15` |
| P-R7-6 | 正常说完 7 位后对最后一位降级 | `speak` + replay | `DEGRADED:22` + `SPEECH:23` + `PHASE_CHANGED:24` → `DAY_VOTE`，`seq === events.length` |
| P-R7-7 | 同一席位连续 4 次降级（复刻 AC-12 用例） | `speak` | 第 1 次 `DEGRADED+SPEECH`，第 2–4 次 `DEGRADED+REJECTED`；`calls=8`、`total=4`，相位停在 `DAY_SPEECH` |
| P-R7-8 | 降级发言后换无总线历史的 app，仅 committed 重放；响应喂 reducer | 真实路由 + reducer | `[degraded:15, done:16]` → `phase=done`、`text='我先过。'` |
| P-R7-9 | 开局（夜晚）降级 `speak` | `speak` + replay | `DEGRADED` + `REJECTED`，无 `SPEECH`；总线 `thinking:2 / degraded:2 / done:3` |
| M-R7-1 | `routes/stream.ts` 的 `ordered` 改回 `[...extras, ...fromBus]` | `tests/server/stream.test.ts` | **1 failed / 14 passed**（`expected 'delta' to be 'done'`）；P-R7-1 回到 `speaking` / `我` |
| M-R7-2 | `DEGRADED` 分支改回空文本 `done` | `tests/server/stream.test.ts` | **1 failed / 14 passed**（`degraded` → `done`） |
| M-R7-3 | `speak` 整体改回 `appendEvents`（Round 6 写法） | `tests/server/speak.test.ts` | **1 failed / 3 passed**（C-97 用例红） |
| M-R7-4 | **只把降级分支**改回 `appendEvents`，正常分支保持 `submit` | 全量 `pnpm test`（探针文件已移出） | **69 files / 578 tests 全绿**（降级分支无回归锁） |

**恢复校验**：

```
$ md5 -q src/server/llm/speak.ts src/server/routes/stream.ts src/server/store/game-registry.ts src/client/use-stream.ts
22610511df8f7244282722e780a95650
070fdb37d5f118119feb2030addc52b6
9758257b0723985d95805aa9acb9c828
c952aa1d8d3d3ee6d4e896f850c2bffb

$ md5 -q /tmp/howl-rfc010-r7-backup/{speak.ts,stream.ts,game-registry.ts,use-stream.ts}
22610511df8f7244282722e780a95650
070fdb37d5f118119feb2030addc52b6
9758257b0723985d95805aa9acb9c828
c952aa1d8d3d3ee6d4e896f850c2bffb

$ git status --porcelain
（空）

$ pnpm test
 Test Files  69 passed (69)
      Tests  578 passed (578)
```

---

### 6. 结论

- **Overall Risk Level: Medium**
- **Summary**：C-86 的两项修复都是真的：真实路由 + reducer 下同 id 顺序已是 `thinking → delta → done`，M-R7-1 / M-R7-2 都会打红，C-86 关闭。C-97 的行为也真的修好了：正常、降级、最后一位降级都经 `submit` 推进，夜晚不再写出不可 replay 的 `SPEECH`；但**降级分支没有回归锁**（只改回它，69 / 578 全绿），**AC-12 用例靠被拒绝的提交凑数**（1 次 SPEECH + 3 次 REJECTED 仍绿），且 `speak` 把引擎的 `REJECTED` 当成功、会发布事件流中不存在的 `done`。这三处都是可最小修复的接缝 / 测试问题，不是新的大 bug，但在本 RFC 的评审标准下阻塞。
- **Blocking Issues**：
  1. **C-97 · 降级分支无回归锁**：M-R7-4。补一条 committed 用例：在真实 `DAY_SPEECH` 中让**最后一位**剩余发言人降级，断言 `DEGRADED` + `SPEECH` + `PHASE_CHANGED`、相位离开 `DAY_SPEECH`、`seq` 连续、`stateOf()` 通过；该用例必须在「降级分支改回 `appendEvents`」时变红。
  2. **C-97 · AC-12 用例语义失效**：P-R7-7。把同一席位 4 次的写法改成 4 个不同席位（或 8 席位序列、最后一位降级），断言每次 `SPEECH` 真的推进发言 cursor、最终相位前进、`stateOf()` 通过；不能再让 `REJECTED` 计入「降级轮次」。
  3. **C-97 · `speak` 把 `REJECTED` 当成功**：P-R7-4 / P-R7-5 / P-R7-9。`submit` 后检查 `submitted.ok` 且 `submitted.events` 里确有本席位的 `SPEECH`，否则抛错 / 返回明确的拒绝，不要发布 `done`；降级分支同样检查 `submitted.ok`。补「夜晚 / 非当前席位被拒绝」的用例，这也让第 2 项不可能再假绿。
- **Improvement Suggestions**：① 把 C-86 新用例的最后一条断言从「`types[last] === 'done'`」改成 `streamReducer` 终态，顺带把 `committedMessages` 的测试状态参数改成 `registry.stateOf(withDegraded)`。② 让 `degradeEvents` 只返回 `DEGRADED`，或在注释里明确「`SPEECH` 只用于引擎路径，禁止 `appendEvents`」；否则下一个调用者可能重新引入 C-97。③ 去掉 `speak.ts:78,103` 两处没有必要的 `as never`。④ 降级路径的 `appendEvents` 先 `applyEvent` 到临时状态（失败即不落盘），或把 DEGRADED 也变成一种受校验的 server 事件；当前「先写 DEGRADED、再 submit」不是原子的。⑤ 下一次 docs 提交同步 §8.3 / §8.4 / §8.6 / §8.11 / `TEST-STRATEGY.md` / `README.md` 与 `RFCS.md` §3 的 RFC-011 依赖（C-92 / DOC-1，非阻塞）。
- **Suggested status**：**`Changes requested`**。

---

### 7. Open conflicts（登记到 `RFCS.md` §8.31 Round 7 段）

- **C-86（Round 7 关闭）**：合并顺序与 `DEGRADED → degraded` 映射均已有会红的回归锁（M-R7-1 / M-R7-2）；真实路由 + reducer 终态正确（P-R7-1 / P-R7-8）。committed 用例仍未直接喂 reducer（非阻塞）。
- **C-97（仍阻塞，行为已修 / 测试锁不全）**：正常与降级都走 `submit`（P-R7-2 / P-R7-3 / P-R7-6），夜晚不再写非法 `SPEECH`（P-R7-4 / P-R7-9）；但只回退降级分支全量仍绿（M-R7-4），AC-12 用例已变成「1 次 SPEECH + 3 次 REJECTED」（P-R7-7），且 `speak` 把 `REJECTED` 当成功发布 `done`（P-R7-4 / P-R7-5）。需补降级分支的端到端锁、修正 AC-12 用例、让 `speak` 在引擎拒绝时失败。
- **C-87（本轮未重查）**：C-97 的写回路径部分已由修复覆盖；AC-11 的轮次标记、`src/` 调用者、§8.4 / §8.6 文档按 Round 6 记录保留。若正式交给 RFC-011，按 `AGENTS.md` 硬规则 6 同步依赖表与 §8.6。
- **C-92 / DOC-1（未重查，非阻塞）**：`TEST-STRATEGY.md` 的 RFC-010 小节仍全 `proposed`；`README.md` 的 RFC 状态 / 覆盖数字仍待回写；§8.3 / §8.6 / §8.4 的旧口径仍在。

---

## Round 8 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: Medium**

本轮只复核 Round 7 的三项阻塞修复：**`speak` 把引擎 `REJECTED` 当失败**、**降级分支「走引擎」的回归锁**、**AC-12 用例按当前发言者轮转**。已关闭的 C-85 / C-86 / C-88 / C-89 / C-96 不重查；C-87 的非 C-97 遗留（AC-11 轮次标记、`src/` 调用者）与 C-90 ~ C-95 非阻塞项按 Round 7 记录保留，本轮未重新审计。

一句话：**第 1 项和第 3 项是真的修好了**——拒绝路径返回 `ok:false`、不发 `done`（P-R8-B），删掉 `REJECTED` 检查会让两条用例变红（M-R8-2）；AC-12 现在按 `currentSpeaker` 轮转 4 个席位，`spoken=4` / `calls=8` / `total=4`（P-R8-C），同一席位连说 4 次的旧写法会在第 2 轮被拒、`spoken` 变 1，测试会红。**但第 2 项（降级分支回归锁）不成立：把降级分支改回 `appendEvents` 绕开引擎后，全量 69 files / 581 tests 仍然全绿（M-R8-1）。** 此外，这次修复把 `DEGRADED` 事件挪到短句 `SPEECH` **之后**，没有同步总线消息 id 与历史重放顺序，引入一个新回归：live 的 `degraded` id 与事件 seq 不一致（违反 AC-5 / API-2），刷新 / 重连会把刚显示的降级短句抹掉并停在 `degraded` / 空正文（P-R8-A）。**仍为 `Changes requested`。**

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `c160821`，`git status --porcelain` 为空。

```
$ pnpm typecheck
... TYPECHECK_EXIT=0

$ pnpm lint
... LINT_EXIT=0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building ssr environment for production...
dist/server/index.js  91.31 kB │ gzip: 30.46 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  69 passed (69)
      Tests  581 passed (581)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`coverage/coverage-summary.json`，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查服务端 `speak` 写回 / `DEGRADED` 事件顺序 / SSE id / 客户端 reducer 重放；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / Playwright（界面归 RFC-012，`tests/e2e/` 为空），以及需要真实模型的 p95 手工验收（D-6）。不把「跳过」当成 PASS。

**探针方式**：临时探针 `tests/server/__r8-probe.test.ts`（4 个用例，跑完已删除）；变异用 `/tmp/howl-rfc010-r8-backup/speak.ts` 的文件备份恢复，**未使用 `git checkout`**，也没有 `git commit`。恢复后 `speak.ts` 的 `md5` 与备份相同（`ed036cca6a21e15bc00d21d81c8493d3`），探针文件已删除，全量 69 / 581 复跑全绿，`git status --porcelain` 为空（见 §7）。

---

### 1. C-97 第 1 项 · `REJECTED` 当失败 —— 关闭

**行为成立。** `src/server/llm/speak.ts:70-85` 现在先看 `submitted.ok`，再扫 `submitted.events` 里的 `REJECTED`；命中就返回 `{ ok: false, code }`，且在任何 `bus.publish(done / degraded)` 之前返回。返回值是真正的可判别联合（`speak.ts:30-40`），`tests/server/speak.test.ts:94,117,250` 等调用点都改为先处理失败。独立探针：

```
P-R8-B night normal=   {"ok":false,"code":"PHASE_MISMATCH",
                        "events":["GAME_STARTED:1","REJECTED:2"],"bus":["thinking:2"]}
P-R8-B night degraded= {"ok":false,"code":"PHASE_MISMATCH",
                        "events":["GAME_STARTED:1","REJECTED:2"],"bus":["thinking:2"]}
P-R8-B day normal wrong seat=   {"ok":false,"code":"NOT_YOUR_TURN",
                                 "newEvents":["REJECTED:15"],"bus":["thinking:15"],
                                 "expectedSpeaker":2,"tried":1}
P-R8-B day degraded wrong seat= {"ok":false,"code":"NOT_YOUR_TURN",
                                 "newEvents":["REJECTED:15"],"bus":["thinking:15"],
                                 "expectedSpeaker":2,"tried":1}
```

夜晚 / 非当前席位、正常 / 降级四条路径都没有 `done`、没有 `degraded`、没有多写 `SPEECH` / `DEGRADED`，只是保留了提交前的 `thinking`。**回归锁成立**：删掉 `speak.ts:76-85` 的 `rejected` 分支后：

```
$ pnpm vitest run tests/server/speak.test.ts --project unit
 Tests  2 failed | 5 passed (7)
  FAIL  夜晚调用返回 ok=false，且不向总线发 done        expected true to be false
  FAIL  非当前发言者返回 ok=false                       expected true to be false
```

这与 Round 7 要求的「夜晚 / 非当前席位被拒绝」一致。**第 1 项关闭。**

**非阻塞小项**：`speak` 在知道会被拒绝之前已经发了 `thinking`，失败后总线留下一条没有终结消息的 `thinking`（`speak.ts:49`）。RFC-011 的调用方必须处理 `ok:false`（例如不要进入 thinking UI），否则界面会停在「思考中」；当前没有生产调用者，不据此阻塞。另外，仓库里没有「夜晚 / 非当前席位 + 降级」的组合用例（P-R8-B 已独立验过行为正确），建议补一条，锁住「被拒绝时连 `DEGRADED` 都不写」。

---

### 2. C-97 第 2 项 · 降级分支「走引擎」的回归锁 —— 不成立（阻塞）

Round 7 新增的用例是 `tests/server/speak.test.ts:236-255`：

```ts
it('降级一轮之后，当前发言者换人', async () => {
  ...
  const before = registry.stateOf(record).speech?.spoken.length ?? 0;
  const result = await speak({ ... attempt: async () => ({ text: '', failed: true }) });
  const after = registry.stateOf(result.record).speech?.spoken.length ?? 0;
  expect(after).toBe(before + 1);
});
```

RFC §8.13 据此声称「绕开引擎时这条会红」（`RFCs/RFC-010...:255`）。**实跑不成立。** 把降级分支改回 Round 6 的写法——不调用 `submit`，直接用 `appendEvents` 写 `DEGRADED` + 短句 `SPEECH`（正常分支保持 `submit`）——全量测试仍然全绿：

```
$ pnpm test
 Test Files  69 passed (69)
      Tests  581 passed (581)
```

**根因**：`speech.spoken` 是 `applyEvent` 折叠出来的，不是 `submit` 的 handler 写的。`src/engine/apply.ts:81-83` 对 `SPEECH` / `SPEECH_SKIPPED` 一律 `appendSpoken(base, seat)`——**只要事件流里有这条 `SPEECH`，不管它是 `submit` 还是 `appendEvents` 写进去的，`spoken` 都会 +1**。降级路径上 `submit` 唯一独有的行为是 `advanceIfDone`（`src/engine/phases/day.ts:118-147`）：**最后一位**发言者说完后补 `PHASE_CHANGED(DAY_SPEECH → DAY_VOTE)`。新用例用的是当天第一位发言人（还有 7 位没说），本来就不会触发相位推进，所以引擎路径和 `appendEvents` 路径在这里没有可观测差异。

这是 TEST-1 缺口，而且与 Round 7 自己的阻塞项要求不一致——Round 7 原文要求「在真实 `DAY_SPEECH` 中让**最后一位**剩余发言人降级，断言 `DEGRADED` + `SPEECH` + `PHASE_CHANGED`、相位离开 `DAY_SPEECH`、`seq` 连续、`stateOf()` 通过；该用例必须在『降级分支改回 `appendEvents`』时变红」。修复方向应回到这条：

1. 先正常说完 7 位，再让第 8 位降级；断言新增事件里有 `SPEECH` + `PHASE_CHANGED`，`registry.stateOf(result.record).phase === 'DAY_VOTE'`，`seq` 连续，`stateOf()` 不抛；
2. 或（更直接）断言 `result.record.applied` 里出现了这次 `SPEECH` 动作（`submit` 会写 `applied`，`appendEvents` 不会）；
3. 用 M-R8-1 验证：改回 `appendEvents` 后该用例必须红。

**第 2 项仍 Open（阻塞）。**

---

### 3. C-97 第 3 项 · AC-12 用例轮转 —— 关闭

`tests/server/speak.test.ts:129-164` 现在每轮先取 `currentSpeaker(registry.stateOf(current))`，再用它调 `speak`，并断言 `spoken === 4`、`calls === 8`、`degradation.total === 4`。独立探针（P-R8-C）在真实一天里跑 4 轮降级：

```
P-R8-C rotated= {"rounds":[
  {"seat":2,"ok":true,"events":["SPEECH:15","DEGRADED:16"],"next":3,"spoken":1},
  {"seat":3,"ok":true,"events":["SPEECH:17","DEGRADED:18"],"next":4,"spoken":2},
  {"seat":4,"ok":true,"events":["SPEECH:19","DEGRADED:20"],"next":5,"spoken":3},
  {"seat":5,"ok":true,"events":["SPEECH:21","DEGRADED:22"],"next":6,"spoken":4}],
  "spoken":4,"calls":8,"total":4,"phase":"DAY_SPEECH","nextSpeaker":6}
```

对照组（Round 7 的旧写法：同一席位连说 4 次）在**当前**正确实现下是：

```
P-R8-C fixed seat= {"rounds":[
  {"ok":true,"events":["SPEECH:15","DEGRADED:16"]},
  {"ok":false,"code":"NOT_YOUR_TURN","events":["REJECTED:17"]}],
  "calls":4,"total":1,"phase":"DAY_SPEECH"}
```

也就是说，旧的同席位写法今天会在第 2 轮 `break`，`spoken` 只有 1，新断言会红。**第 3 项关闭。** 非阻塞建议：顺手断言 4 轮的席位互不相同、第 4 轮之后仍存在下一发言人（`currentSpeaker` 不为 `undefined`），把「对局未卡死」写死，而不是只靠 `spoken` 代理。

---

### 4. C-98（新，阻塞）· 降级事件被挪到 `SPEECH` 之后，id 与重放语义回归

Round 7 为了让 `REJECTED` 检查发生在写 `DEGRADED` 之前，把降级分支改成了：

1. `submit(SPEECH)`（`speak.ts:63-68`）→ `SPEECH` 的 seq 为 `N`；
2. 成功后 `appendEvents(DEGRADED)`（`speak.ts:89-100`）→ `DEGRADED` 的 seq 为 `N+1`（最后一位发言时，`submit` 还会先产出 `PHASE_CHANGED`，于是是 `N+2`）；
3. 总线却仍用 `nextSeq`（= `N`）发 `degraded`（`speak.ts:102`），再用 `nextSeq` 发 `done`（`speak.ts:103-108`）。

这带来三个可观测问题。

**4.1 live 的 `degraded` 消息 id 不等于事件 seq（AC-5 / API-2）**

`src/shared/stream.ts:9` 写得很明确：「`id` 恒等于对应事件的 `seq`（API-2）」。P-R8-A 在真实 `DAY_SPEECH` 里让当前发言人降级：

```
P-R8-A events= ["SPEECH:15","DEGRADED:16"]
P-R8-A bus=    ["thinking:15","degraded:15","done:15(我先过。)"]
P-R8-A committed tail= ["done:15(我先过。)","degraded:16"]
```

`degraded` 的事件 seq 是 16，live 消息 id 是 15；而 `committedMessages`（`src/server/routes/stream.ts:47-51`）按事件 seq 映射出的是 `degraded:16`。同一个标记在 live 与历史里 id 不一致。最后一位降级更明显（P-R8-D）：

```
P-R8-D newEvents= ["SPEECH:22","PHASE_CHANGED:23","DEGRADED:24"]
P-R8-D busTail= [...,"thinking:22","degraded:22","done:22(我先过。)"]
```

`degraded:22` 与 `DEGRADED:24` 相差 2。现有 AC-5 用例（`tests/server/stream.test.ts:130-149`）只把 `SPEECH` 的 seq 拿来比，完全不覆盖 `degraded`，所以套件看不到。

**4.2 刷新 / 重连会把短句抹掉，并停在 `degraded`**

`streamReducer` 的 `degraded` 分支会清空 `text` 并把 `phase` 置为 `degraded`（`src/client/use-stream.ts:95-104`）。Round 6 的顺序是 `DEGRADED → SPEECH`，历史重放 `[degraded, done]` 最终停在 `done` / 短句（P-R7-8）；现在顺序反了，历史是 `[done, degraded]`：

```
P-R8-A refresh(reduce committed)= {"phase":"degraded","text":"","lastId":16}
P-R8-A live(reduce bus)=          {"phase":"done","text":"我先过。","lastId":15}
P-R8-A refresh route tail= ["done:15(我先过。)","degraded:16"]
P-R8-A refresh route state= {"phase":"degraded","text":"","lastId":16}
```

不只是「刷新后看不到」，**在线重连也会把已经显示的短句清掉**：客户端收到 live 的 `done:15` 后 `lastId=15`，重连带 `Last-Event-ID: 15`，总线重放 `id===15` 的那段（thinking / degraded / done），`committedMessages` 又补上 `degraded:16`，最终状态：

```
P-R8-A reconnect frames= ["degraded:16"]
P-R8-A reconnect state=  {"phase":"degraded","text":"","lastId":16}
```

这破坏了 `routes/stream.ts:19-20` 写下的「刷新看到历史、实时看到增量，两路看到同一段对话」，也与 AC-9「降级时前端收到 `degraded` 并显示可见提示」的意图不一致——live 有短句、刷新/重连没有。AC-10 的推进不受影响（见 §5），但这条是用户可见的回归。

**4.3 事件顺序与 RFC 记录不一致（DOC-1）**

RFC §8.12 明确写的是「降级路径**先** `appendEvents` 补 `DEGRADED` 标记，**再**走同一条通道写短句」（`RFCs/RFC-010...:244`）；`src/server/llm/turn.ts:131` 的 `degradeEvents()` 也仍注释「`DEGRADED` 在前，短句 `SPEECH` 在后」。Round 7 的实现反了过来，但 §8.13 只记了「补回归锁 / 改 AC-12」，没有记录这次顺序变更及其后果。测试侧也没跟上：C-86 的历史用例（`tests/server/stream.test.ts:403-439`）仍手工构造 `DEGRADED` 在 `SPEECH` 之前，断言 `['degraded','done']`，**与真实生产顺序相反**，所以它既没抓到 4.1，也没抓到 4.2。

另外，最后一位降级现在把 `DEGRADED` 写在 `PHASE_CHANGED` **之后**（`SPEECH:22, PHASE_CHANGED:23, DEGRADED:24`）。RFC-014 的复盘要按 `DEGRADED` 标「发生降级的轮次」（AC-7 / AC-11），事件落在 `DAY_VOTE` 之后会让「轮次」的归属更难判；AC-11 本来就是未关闭的非阻塞项，这里只提示修复顺序时一并考虑。

**修复方向**（任选其一，但必须让事件顺序、总线 id、committed 重放与 reducer 终态一致）：

- **(a) 恢复 `DEGRADED → SPEECH`**：在写 `DEGRADED` 之前用引擎导出的纯函数做接受性预检（`currentSpeaker` / phase），或把 `DEGRADED` 变成引擎在 `SPEECH` handler 内产出的同批事件（最干净，但改 engine 接口，需登记）。
- **(b) 保留 `SPEECH → DEGRADED`**：总线先发 `done`（id = `SPEECH` seq）、再发 `degraded`（id = `DEGRADED` seq），并调整 reducer / committed 映射，让 `degraded` 不再清空刚显示的短句（否则刷新仍会丢正文）。这等于修改 AC-9 的展示语义，需要写进 RFC。

无论哪条，至少补三组测试：① live 的 `degraded.id === DEGRADED.seq`；② 刷新 / 重连后的终态与 live 一致（`done` + 短句）；③ C-86 的 fixture 使用真实事件顺序。**列为阻塞。**

---

### 5. 逐条验收标准（只列本轮受影响的）

| AC | Round 7 | Round 8 | 依据 |
|---|---|---|---|
| 5 | PASS | **FAIL（回归）** | P-R8-A：live `degraded:15` vs `DEGRADED:16`；AC-5 用例只比 `SPEECH` seq，未覆盖 `degraded` |
| 7 | PASS | **PASS（未变）** | P-R8-C / P-R8-D：`DEGRADED` + ≤10 字短句，`seq` 连续 |
| 9 | PASS | **NEEDS WORK（回归）** | live 有 `degraded` 提示；刷新 / 重连终态 `degraded` / 空正文（P-R8-A） |
| 10 | PASS | **PASS（未变）** | P-R8-C 下一席位 3；P-R8-D 最后一位降级 → `DAY_VOTE`，`seq 24 === len 24` |
| 12 | NEEDS WORK | **PASS（本轮）** | P-R8-C；同席位旧写法在第 2 轮被拒、`spoken=1`，新断言会红 |
| 1/2/3/4/6/8/11 | — | **未重查** | 本轮没有触碰 / 属已关闭或按记录保留的非阻塞项 |

---

### 6. 五个审查维度

#### 6.1 RFC ADHERENCE —— **NEEDS WORK**

- 用户点名的三项：**第 1 项关闭**（P-R8-B + M-R8-2），**第 3 项关闭**（P-R8-C），**第 2 项仍不成立**（M-R8-1 全绿）。
- 新回归 **C-98**：AC-5 / API-2 的 id 契约被破坏，刷新 / 重连丢短句；且 §8.12 的「先 DEGRADED 后短句」被实现反转但未记录（DOC-1）。
- 文档漂移：§8.3 仍没有 `speak.ts` / `turn.ts` / `speak.test.ts`；§8.6 仍写「路由用 `reply.send` 一次写完，持续推送在 RFC-012」；§8.4 的 AC-10 / 11 / 12 仍是旧证据；`RFCS.md` §3 的 RFC-010 后继仍是 `—`。归 C-92 / DOC-1 非阻塞债务（本轮未重审），但 C-98 相关的 §8.12 / §8.13 应在下一次修复中一并回写。

#### 6.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：`src/engine/` 未新增 UI / server / 网络依赖。 |
| `ARCH-4` / `ARCH-9` | **PASS**：引擎仍是唯一权威；客户端 reducer 只是呈现层。 |
| `DATA-1` | **PASS**：P-R8-C / P-R8-D 的事件 `seq` 连续（15,16 / 17,18 / … / 22,23,24），`state.seq === events.length`。 |
| `DATA-3` | **PASS**：P-R8-A / C / D 的 `stateOf()` / `replay` 均不抛。 |
| `API-2` | **FAIL**：live `degraded` 的 `id`（15 / 22）不等于 `DEGRADED` 事件 seq（16 / 24）。 |
| `TEST-1` | **FAIL**：第 2 项的回归锁无效（M-R8-1 全量 581 绿）；C-98 无测试（AC-5 用例只覆盖 `SPEECH`）。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未下降。 |
| `DOC-1` | **NEEDS WORK**：§8.12 / §8.13 与实现不一致（顺序反转、声称会红的锁实际不红）。 |
| `AI-3` / `AI-7` | **未重查**：未改调用超时 / 重试配置。 |
| `SEC-5` | **PASS**：`speak` 不在 HTTP 路由上；SSE 仍先过可见性过滤；没有新增密钥或完整状态序列化。 |

#### 6.3 SECURITY —— **PASS**

本轮改动没有新增对外输入面、密钥或日志：`speak` 仍不在 HTTP 路由上，`committedMessages` 仍先过 `isVisibleTo`，路由仍在 `resolveSession` 之后校验 `session.gameIds`。C-90 的可见性回归锁仍是未重查的非阻塞项，本轮未改变其状态。C-98 只影响发言流消息的 id / 顺序，不泄露非可见事件。

#### 6.4 PERFORMANCE —— **N/A**

本轮是写回路径与测试改动，没有新增循环、查询或 N+1；降级路径现在多一次 `submit` 的 `stateOf` 全量 replay 和一次 `appendEvents`，与 Round 7 同量级，当前规模可接受。既有的「`committedMessages` 每次连接扫描全部历史」「`PassThrough` 无 backpressure」等旧非阻塞项未变，本轮不重新审计。

#### 6.5 MAINTAINABILITY —— **NEEDS WORK**

- **测试名与注释名不副实**：`tests/server/speak.test.ts:236` 的「降级发言也走引擎」只证明「事件流里有 `SPEECH`」，不证明走 `submit`；M-R8-1 就是反证。RFC §8.13 的「绕开引擎时这条会红」也应删掉或改成真实成立的条件。
- **C-86 fixture 失真**：`tests/server/stream.test.ts:403-439` 手工构造的顺序（`DEGRADED` 前、`SPEECH` 后）已不是生产顺序，且只断言消息类型、未喂 reducer；应改成真实顺序并断言 `streamReducer` 终态。
- **两套顺序并存**：`degradeEvents()`（`turn.ts:131-157`）仍产出 `DEGRADED + SPEECH` 且注释「DEGRADED 在前」，生产路径却只取第一条并反向写；下一个调用者很容易照文档写错（Round 7 已提过，仍未处理）。
- **`unstable` 重复计算**：降级返回里用 `turn.degradation.consecutive >= UNSTABLE_AFTER`（`speak.ts:116`），而 `turn` 本身已有 `unstable` 字段；二者等价但容易漂移。
- **两处 `as never`**（`speak.ts:66` 及测试中的注入）仍是 C-95 的同类类型逃逸。
- **AC-12 可再加强**：断言 4 个席位互异、第 4 轮后仍有下一发言人，避免未来「返回 ok 但不写事件」的实现假绿。
- **正向**：第 1 项的实现小而清晰，`ok:false` 路径在发 `done` 之前返回，探针和反向变异都干净；第 3 项的轮转也确实消除了「用被拒绝的提交凑数」。

---

### 7. 探针与恢复

备份在 `/tmp/howl-rfc010-r8-backup/speak.ts`；临时探针为 `tests/server/__r8-probe.test.ts`（4 个用例），跑完已删除。源码变异一律用 `cp` 从备份恢复，**没有使用 `git checkout`**，也没有 `git commit`。

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P-R8-A | 真实 `DAY_SPEECH` 里降级当前发言人；对比事件、总线、committed、刷新 / 重连 | `speak` + 真实路由 + reducer | `SPEECH:15 + DEGRADED:16`；bus `thinking:15 / degraded:15 / done:15`；刷新 / 重连终态 `degraded` / 空正文（C-98） |
| P-R8-B | 夜晚正常 / 夜晚降级 / 白天非当前席位正常 / 白天非当前席位降级 | `speak` | 四条均 `ok:false`（`PHASE_MISMATCH` / `NOT_YOUR_TURN`），无 `done` / `degraded` / `SPEECH`（第 1 项成立） |
| P-R8-C | 按 `currentSpeaker` 轮转 4 轮降级 vs 同一席位 4 次 | `speak` + replay | 轮转：席位 2/3/4/5、`spoken=4`、`calls=8`、`total=4`、下一席位 6；同席位：第 2 轮 `NOT_YOUR_TURN`、`spoken=1`（第 3 项成立） |
| P-R8-D | 正常说完 7 位后让最后一位降级 | `speak` + replay | `SPEECH:22 + PHASE_CHANGED:23 + DEGRADED:24` → `DAY_VOTE`，`seq===len===24`；bus `degraded:22`（C-98 的 id 偏差更大） |
| M-R8-1 | 只把降级分支改回 `appendEvents([DEGRADED, SPEECH])`，不调 `submit` | **全量 `pnpm test`**（探针已移出） | **69 files / 581 tests 全绿**（第 2 项回归锁不成立） |
| M-R8-2 | 删掉 `speak.ts:76-85` 的 `REJECTED` 检查 | `tests/server/speak.test.ts` | **2 failed / 5 passed**（夜晚、非当前席位，`expected true to be false`） |

**恢复校验**：

```
$ md5 -q src/server/llm/speak.ts
ed036cca6a21e15bc00d21d81c8493d3
$ md5 -q /tmp/howl-rfc010-r8-backup/speak.ts
ed036cca6a21e15bc00d21d81c8493d3

$ ls tests/server/__r8-probe.test.ts
No such file or directory

$ git status --porcelain
（空）

$ pnpm test
 Test Files  69 passed (69)
      Tests  581 passed (581)
```

---

### 8. 结论

- **Overall Risk Level: Medium**
- **Summary**：第 1 项（`REJECTED` 当失败）和第 3 项（AC-12 轮转）都真的修好了，并且第 1 项有会红的反向锁。第 2 项声称的「降级分支绕开引擎会红」不成立——`spoken` 由 `applyEvent` 折叠 `SPEECH` 推进，和写回路径无关，M-R8-1 全量 581 绿；要用最后一位降级 + `PHASE_CHANGED` / 离开 `DAY_SPEECH` 才能锁住。同时，修复把 `DEGRADED` 挪到 `SPEECH` 之后却没同步总线 id 和历史顺序，引入了 C-98：live `degraded` id ≠ 事件 seq（AC-5 / API-2），刷新 / 重连会抹掉短句并停在 `degraded`。
- **Blocking Issues**：
  1. **C-97 第 2 项 · 降级分支回归锁无效**：M-R8-1 全量 69 / 581 绿。改成「7 位正常 + 最后一位降级」并断言 `SPEECH` + `PHASE_CHANGED` + 离开 `DAY_SPEECH` + `seq` 连续 + `stateOf()` 通过；该用例必须在 `appendEvents` 绕开引擎时变红。同步修正 §8.13 的「绕开引擎时这条会红」与测试名。
  2. **C-98 · 降级事件顺序 / id / 重放回归**：`speak.ts:89-108` 在 `submit` 后追加 `DEGRADED`（seq `N+1` / 最后一位 `N+2`），总线却用 `nextSeq`（`N`）发 `degraded`；live 与 committed 的 id 不一致（P-R8-A / P-R8-D），刷新 / 重连终态 `degraded` / 空正文。修复时二选一：恢复 `DEGRADED → SPEECH`（并在写前做接受性预检 / 让引擎同批产出），或保留新顺序并同步 `done` / `degraded` 的 id 与 reducer 语义；补 live id、刷新 / 重连终态、真实 fixture 三组测试，并更新 §8.12 / §8.13。
- **Improvement Suggestions**：① 补「夜晚 / 非当前席位 + 降级」拒绝用例，锁住「拒绝时连 `DEGRADED` 都不写」；② AC-12 断言 4 个席位互异、第 4 轮后仍有下一发言人；③ 消除 `degradeEvents()` 与生产路径的顺序分叉（只返回 `DEGRADED` 或明确注释仅供 fixture）；④ 去掉 `speak.ts:66` 的 `as never`，用 `turn.unstable` 替代重复计算；⑤ 下一次 docs 提交同步 §8.3 / §8.4 / §8.6 / §8.11 / `TEST-STRATEGY.md` / `README.md` 与 `RFCS.md` §3 的 RFC-011 依赖（C-92 / DOC-1，非阻塞）；⑥ 拒绝时已发 `thinking` 的悬挂问题留给 RFC-011 的调用方契约（`ok:false` 必须清掉 thinking UI）。
- **Suggested status**：**`Changes requested`**。

---

### 9. Open conflicts（登记到 `RFCS.md` §8.31 Round 8 段）

- **C-97（第 1 / 3 项关闭，第 2 项仍阻塞）**：`REJECTED` 当失败已实现并有反向锁（M-R8-2 2 failed）；AC-12 轮转成立（P-R8-C，同席位旧写法会红）。但降级分支「走引擎」的回归锁无效（M-R8-1 全量 581 绿），需最后一位降级 + `PHASE_CHANGED` 的断言。
- **C-98（新，阻塞）**：`DEGRADED` 被挪到 `SPEECH` 之后，live `degraded` id 与事件 seq 不一致（AC-5 / API-2），刷新 / 重连丢短句（AC-9）；§8.12 的旧顺序仍写在文档里，C-86 fixture 与真实顺序相反。
- **C-86（Round 7 关闭，本轮不重开）**：类型映射与合并顺序本身未退化；C-98 是**生产侧事件顺序**的新问题，不是 C-86 的映射问题。
- **C-87 / C-90 ~ C-95（未重查，按 Round 7 记录保留）**：AC-11 轮次标记、`src/` 调用者、`TEST-STRATEGY.md` / `README.md` / §8.3 / §8.4 / §8.6 的文档漂移仍是非阻塞债务；其中 §8.12 / §8.13 与 C-98 直接相关，应随 C-98 一起改。

---

## Round 9 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: Medium**

本轮只复核 Round 8 的两项阻塞修复：**C-97 的降级分支回归锁**、**C-98 的降级消息 id / 重放语义**。已关闭的 C-85 / C-86 / C-88 / C-89 / C-96 与 Round 8 关闭的 C-97 第 1 / 3 项不重查；C-87 的非 C-97 遗留、C-90 ~ C-95 非阻塞项按 Round 8 记录保留，本轮未重新审计。

一句话：**C-97 真的修好了**——把降级分支改回 `appendEvents` 绕开引擎后，新用例在 `expect(state.phase).not.toBe('DAY_SPEECH')` 精确打红（M-R9-1：1 failed / 7 passed），`seq` 连续性也在同一条用例里锁住。**C-98 只修好了一半**——普通席位降级时 `done:15` / `degraded:16` 与事件 seq 对齐、刷新与实时终态一致（P-R9-A），但**最后一位发言者降级时 `degraded` 仍是 `nextSeq + 1`，而 `PHASE_CHANGED` 已经占用了那个 seq**（P-R9-B：总线 `degraded:23` vs 事件 `DEGRADED:24`）；真实路由的新连接 / 重连因此各出现两条 `degraded`（`degraded:23` + `degraded:24`）。这正是 AC-5 / API-2 的 id 契约，而全量套件看不到它。**仍为 `Changes requested`。**

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `b08091b`，`git status --porcelain` 为空。

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
dist/server/index.js  91.31 kB │ gzip: 30.46 kB
BUILD_EXIT=0

$ pnpm test
 Test Files  69 passed (69)
      Tests  583 passed (583)
TEST_EXIT=0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
E2E_EXIT=0
```

覆盖率（`coverage/coverage-summary.json`，只覆盖 `src/engine/**`）：

```
lines: 96.96% (544/561)   branches: 92.85% (364/392)
```

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查 `speak` 写回、SSE id 契约、客户端 reducer 与真实路由的刷新 / 重连；**显式跳过** UI / A11Y / 响应式 / 浏览器兼容 / Playwright（界面归 RFC-012，`tests/e2e/` 为空），以及需要真实模型的 p95 手工验收（D-6）。不把「跳过」当成 PASS。

**探针方式**：临时探针 `tests/server/__r9-probe.test.ts`（2 个用例，跑完已删除）；变异用 `/tmp/howl-rfc010-r9-backup/` 的文件备份恢复，**未使用 `git checkout`**，也没有 `git commit`。恢复后 `speak.ts` 的 `md5` 为 `f4c3846d453ceb6c17571d262028e71a`、`use-stream.ts` 为 `0429ecccc6f7055c75429040168bfe6b`，均与备份一致；探针已删除，全量 69 / 583 复跑全绿，`git status --porcelain` 为空（见 §6）。

---

### 1. C-97 第 2 项 · 降级分支的回归锁 —— 关闭

**行为与锁都成立。** `tests/server/speak.test.ts:257-294` 现在先按 `currentSpeaker` 正常说完整天，只在最后一位（`isLast = index === total - 1`）让 `attempt` 返回 `failed: true`，然后断言：

- `registry.stateOf(current).phase` 不再是 `DAY_SPEECH`（`:288`）；
- 事件流 `seq` 逐条连续（`:291-292`）。

正向探针 P-R9-B 在真实一天里跑出：

```
events tail = SPEECH:22, PHASE_CHANGED:23, DEGRADED:24
phase       = DAY_VOTE
seq         = 连续（1..24）
```

即最后一位降级确实经 `submit` 触发了 `advanceIfDone` → `PHASE_CHANGED(DAY_SPEECH → DAY_VOTE)`，并补上 `DEGRADED`。

**反向锁成立（M-R9-1）**：只把降级分支改回「`appendEvents([DEGRADED, 短句 SPEECH])` 绕开 `submit`」、正常分支保持原样，`tests/server/speak.test.ts` 变为 **1 failed / 7 passed**，失败点正是新用例的相位断言：

```
FAIL  C-97 · 最后一位席位降级时也要推进相位
AssertionError: expected 'DAY_SPEECH' not to be 'DAY_SPEECH'
 ❯ tests/server/speak.test.ts:288:29
```

`seq` 连续断言本身不会因为绕开引擎而红（`appendEvents` 写的 seq 也连续），真正锁住引擎的是相位断言；当前的组合已经足够——绕开引擎时相位停在 `DAY_SPEECH`。**关闭。**

**非阻塞残项**：① `tests/server/speak.test.ts:236` 的旧用例名「降级发言也走引擎」仍保留，M-R9-1 下它是绿的，名不副实；② RFC §8.13:255 仍写「绕开引擎时这条会红」，指的是那条旧用例，陈述不成立；应一起改名 / 改成「最后一位」的表述，但不影响本轮行为。③ 新用例没有显式断言 `DEGRADED` 事件存在（只有相位与 seq），若将来降级路径只写短句不写 `DEGRADED`，它仍会绿；建议补一条 `DEGRADED` 断言（AC-7 的主路径已有，但这条最后一位路径没有）。

---

### 2. C-98 · 降级消息 id 与重放语义 —— 部分修复，仍 Open（阻塞）

#### 2.1 已修复的部分：普通席位 + 正文保留

P-R9-A 在真实 `DAY_SPEECH` 里让当前（非最后）发言人降级：

```
events     = SPEECH:15, DEGRADED:16
bus        = thinking:15, done:15, degraded:16
live       = { phase: 'degraded', text: '我先过。', lastId: 16 }
committed  = { phase: 'degraded', text: '我先过。', lastId: 16 }
```

`done.id === SPEECH.seq`、`degraded.id === DEGRADED.seq` 在**没有其他事件插在中间**时成立，刷新与实时终态一致（`text` 保留）。M-R9-2 把 `degraded` 分支改回 `text: ''`，`tests/client/use-stream.test.ts` **1 failed / 11 passed**，失败在 `:151` 的 `expect(state.text).toBe('我先过。')`——「不清正文」有回归锁。Round 8 review 的 4.2（刷新 / 重连丢短句）在普通席位这条路径上关闭。

#### 2.2 仍未修复：最后一位降级时 `degraded.id` 差 1

`src/server/llm/speak.ts:113` 仍写死 `id: nextSeq + 1`，注释（`:102-104`）假设 `DEGRADED` 紧跟在 `SPEECH` 之后。但最后一位发言时 `submit` 先产出 `PHASE_CHANGED`（`src/engine/phases/day.ts:140-146` 的 `advanceIfDone`），`DEGRADED` 被 `appendEvents` 追加到 `seq = nextSeq + 2`。P-R9-B：

```
events tail      = SPEECH:22, PHASE_CHANGED:23, DEGRADED:24
bus tail         = thinking:22, done:22, degraded:23
bus done.id      = 22   （= SPEECH.seq，正确）
bus degraded.id  = 23   （≠ DEGRADED.seq 24）
fresh route      = ..., done:22, degraded:23, degraded:24
reconnect from 22= thinking:22, done:22, degraded:23, degraded:24
live state       = { phase: 'degraded', text: '我先过。', lastId: 23 }
refresh state    = { phase: 'degraded', text: '我先过。', lastId: 24 }
```

三个后果：

1. **AC-5 / API-2 仍被违反**：`src/shared/stream.ts:9` 写的是「`id` 恒等于对应事件的 `seq`」；`degraded:23` 对应的是 `PHASE_CHANGED:23`，不是 `DEGRADED:24`。新增的注释和 RFC §8.14 都声称「`degraded` 用 `DEGRADED` 事件的 seq」，在最后一位场景不成立。
2. **同一条降级在真实路由上出现两条 `degraded`**：总线发 `degraded:23`，`committedMessages` 按事件发 `degraded:24`；`routes/stream.ts` 的 `busIds` 去重只按 id，两个 id 不同，于是全新连接与重连都各发两次。`lastId` 被推到 24，虽然 `degraded` 分支幂等、正文不丢，但违反 AC-5 的「不重复」。
3. **live 与历史仍不一致**：`lastId` 23 vs 24；`done` 的 id 恰好对了（`SPEECH` 是 `submit` 的第一条事件），`degraded` 的 id 没有从写入结果回读，而是继续用算术推导。

**根因**：`nextSeq + 1` 假设「`SPEECH` 后面紧邻 `DEGRADED`」，而 `submit` 的事件批里可能先插入 `PHASE_CHANGED`。修复只需一行——用 append 后的真实 seq：

```ts
const degradedEvent = record.events[record.events.length - 1] as EventEnvelope;
input.bus.publish(record.gameId, { type: 'degraded', id: degradedEvent.seq, seat: input.seat });
```

（`done` 也建议从 `submitted.events.find((event) => event.type === 'SPEECH')?.seq` 取，避免同类推导。）

#### 2.3 测试缺口

Round 8 review 要求的三组测试只落实了第三组的一半：

| 要求 | 现状 |
|---|---|
| ① live 的 `degraded.id === DEGRADED.seq` | **没有**。`tests/server/stream.test.ts:121-150` 的 AC-5 用例只取 `record.events.filter(type === 'SPEECH')` 的 seq，完全不看 `DEGRADED` / `degraded`；`tests/server/speak.test.ts:103-127` 只断言总线里有 `degraded`，不断言 id。 |
| ② 刷新 / 重连终态与 live 一致 | **没有**。`tests/client/use-stream.test.ts:145-154` 是手工喂三条消息的 reducer 单测，不经过 `speak`、`committedMessages` 或路由；fixture（`stream.test.ts:403-439`）只测 `committedMessages` 的类型映射，不喂 reducer。 |
| ③ C-86 fixture 使用真实顺序 | **做了**（`SPEECH:16` → `DEGRADED:17`），但 `:404` 的用例名仍是「历史路径里 `DEGRADED + SPEECH` → `[degraded, done]`」，与 fixture 和断言 `['done', 'degraded']` 相反，属误导性命名。 |

M-R9-B 与全绿套件已经证明缺口①真实存在：`degraded:23` vs `DEGRADED:24` 能被 69 files / 583 tests 全部放过。

#### 2.4 文档偏差（随 C-98 一起改）

- RFC §8.14:267 声称「`degraded` 用 `DEGRADED` 事件的 seq」——在最后一位场景不成立；应写明限制或按修复后的实际行为改写。
- RFC §8.12:244 仍写「降级路径先 `appendEvents` 补 `DEGRADED`，再走同一条通道写短句」，与当前生产顺序（`SPEECH → PHASE_CHANGED? → DEGRADED`）相反。
- `src/server/llm/turn.ts:131` 的 `degradeEvents()` 注释仍写「`DEGRADED` 在前，短句 `SPEECH` 在后」；该函数已无生产调用者，只有测试 fixture 在用，两套顺序并存容易让下一个调用者照文档写错（Round 7 / Round 8 已提过，仍未处理）。

**C-98 仍 Open（阻塞）。** 修复时至少补上 2.3 的①②两组测试；②必须走真实 `speak` + `committedMessages` / 路由，并覆盖「最后一位降级」这个已经出现在 C-97 用例里的场景。

---

### 3. 逐条验收标准（只列本轮受影响的）

| AC | Round 8 | Round 9 | 依据 |
|---|---|---|---|
| 5 | FAIL（回归） | **FAIL（部分修复）** | P-R9-A：普通席位 `degraded:16 === DEGRADED:16`；P-R9-B：最后一位 `degraded:23` vs `DEGRADED:24`，真实路由出现两条 `degraded`；AC-5 用例仍只看 `SPEECH` |
| 7 | PASS | **PASS（未变）** | P-R9-B：`DEGRADED` + 短句 ≤ 10、`seq` 连续 |
| 9 | NEEDS WORK（回归） | **PASS（修复）** | P-R9-A / P-R9-B：live / 刷新 / 重连 `text='我先过。'`、`phase='degraded'`；M-R9-2 锁定「不清正文」 |
| 10 | PASS | **PASS（未变）** | P-R9-B：最后一位降级后 `phase=DAY_VOTE`，`seq 24 === events.length` |
| 12 | PASS | **未重查** | Round 8 关闭，本轮未触碰 |
| 1/2/3/4/6/8/11 | — | **未重查** | 本轮没有触碰 / 属已关闭或按记录保留的非阻塞项 |

---

### 4. 五个审查维度

#### 4.1 RFC ADHERENCE —— **NEEDS WORK**

- **C-97：关闭。** 最后一位降级的相位推进有真实路径证据，且有会红的反向锁（M-R9-1）。
- **C-98：仍阻塞。** 普通席位已对齐；最后一位仍差 1，导致 AC-5 / API-2 的 id 契约和 AC-5 的「不重复」在真实路由上不成立；Round 8 要求的三组测试缺两组。
- 文档漂移：§8.12 / §8.14 / `turn.ts:131` 与实现不一致（§2.4）；其余 §8.3 / §8.4 / §8.6 / §8.11 / `TEST-STRATEGY.md` / `README.md` 归 C-92 / DOC-1，本轮未重审。

#### 4.2 RULES COMPLIANCE —— **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| `ARCH-1` | **PASS**：`src/engine/` 未新增 UI / server / 网络依赖。 |
| `ARCH-4` / `ARCH-9` | **PASS**：引擎仍是唯一权威；降级短句经 `submit(SPEECH)` 写回。 |
| `DATA-1` | **PASS**：P-R9-B 事件 seq 连续（22, 23, 24），`state.seq === events.length`。 |
| `DATA-3` | **PASS**：P-R9-A / B 的 `stateOf()` 均不抛。 |
| `API-2` | **FAIL**：最后一位降级时 live `degraded.id`（23）≠ `DEGRADED.seq`（24）。 |
| `TEST-1` | **FAIL**：C-98 的 live id / 路由重放两组回归锁缺失；全量 69/583 在 id 错位时仍绿。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.85%，未下降。 |
| `DOC-1` | **NEEDS WORK**：§8.14 的「用 `DEGRADED` 事件的 seq」过声明；§8.12 与生产顺序相反；`turn.ts:131` 注释过期。 |
| `AI-3` / `AI-7` | **未重查**：未改调用超时 / 重试配置。 |
| `SEC-5` | **PASS**：`speak` 不在 HTTP 路由上；SSE 仍先过可见性过滤；没有新增密钥或完整状态序列化。 |

#### 4.3 SECURITY —— **PASS**

本轮改动没有新增对外输入面、密钥或日志：`speak` 仍不在 HTTP 路由上；`committedMessages` 仍先过 `isVisibleTo`；`degraded` 的 seat 来自公开事件 payload。C-90 的可见性回归锁仍是未重查的非阻塞项，本轮未改变其状态。

#### 4.4 PERFORMANCE —— **N/A**

本轮是写回路径与测试改动，没有新增循环、查询或 N+1；最后一位降级多一次 `appendEvents` 与一次路由合并，和 Round 8 同量级，当前规模可接受。既有「`committedMessages` 每次连接扫描全部历史」「`PassThrough` 无 backpressure」等旧非阻塞项本轮不重审。

#### 4.5 MAINTAINABILITY —— **NEEDS WORK**

- **id 靠算术推导而不是从写入结果回读**：`nextSeq + 1` 是这次 bug 的直接原因；改成读取 append 后的事件 seq 既正确又更难再错。
- **测试名与断言相反**：`tests/server/stream.test.ts:404` 仍写 `DEGRADED + SPEECH → [degraded, done]`，实际 fixture / 断言已经是 `SPEECH → DEGRADED`、`['done', 'degraded']`。
- **两套顺序并存**：`turn.ts:131-157` 的 `degradeEvents()` 仍返回 `DEGRADED + SPEECH` 且注释「DEGRADED 在前」；生产路径已反向，建议只保留一套或把函数标为仅供 fixture。
- **旧用例名不副实**：`tests/server/speak.test.ts:236` 的「降级发言也走引擎」在绕开引擎的变异下仍是绿的；它不构成 C-97 的锁，真正的锁在 `:257-294`。
- **正向**：C-97 的新用例结构清楚、证据直接；C-98 的 reducer 改动小且 M-R9-2 能精确打红；普通席位的 id / 终态确实修对了。

---

### 5. 探针与变异

| # | 探针 / 变异 | 跑什么 | 结果 |
|---|---|---|---|
| P-R9-A | 真实 `DAY_SPEECH` 里让当前（非最后）发言人降级；对比事件 / 总线 / committed / reducer | `speak` + `committedMessages` + `streamReducer` | `SPEECH:15 / DEGRADED:16`；bus `done:15 / degraded:16`；live 与 refresh 均 `degraded` / `我先过。` / `lastId 16`（C-98 普通路径修复成立） |
| P-R9-B | 7 位正常 + 最后一位降级；真实路由全新连接 + 从 `done:22` 重连 | `speak` + `app.inject` + `bus.replay` + reducer | 事件 `SPEECH:22 / PHASE_CHANGED:23 / DEGRADED:24` → `DAY_VOTE`；bus `done:22 / degraded:23`；fresh 与 reconnect 都出现 `degraded:23` + `degraded:24`；live `lastId 23` vs refresh 24（C-98 最后一位仍错） |
| M-R9-1 | 把降级分支改回 `appendEvents([DEGRADED, SPEECH])`，不调 `submit` | `tests/server/speak.test.ts` | **1 failed / 7 passed**，失败在 `:288` `expected 'DAY_SPEECH' not to be 'DAY_SPEECH'`（C-97 锁成立） |
| M-R9-2 | 给 `degraded` 分支加回 `text: ''` | `tests/client/use-stream.test.ts` | **1 failed / 11 passed**，失败在 `:151` `expected '' to be '我先过。'`（「不清正文」锁成立） |
| （观察） | 正常实现下跑全量 | `pnpm test` | **69 files / 583 tests 全绿**——说明 §2.2 的 id 错位没有被任何现有用例覆盖 |

---

### 6. 探针与恢复

备份在 `/tmp/howl-rfc010-r9-backup/`（`speak.ts` / `use-stream.ts` / `speak.test.ts` / `stream.test.ts`）；临时探针 `tests/server/__r9-probe.test.ts` 跑完已删除。源码变异一律用 `cp` 从备份恢复，**没有使用 `git checkout`**，也没有 `git commit`。

恢复校验：

```
$ md5 -q src/server/llm/speak.ts
f4c3846d453ceb6c17571d262028e71a
$ md5 -q /tmp/howl-rfc010-r9-backup/speak.ts
f4c3846d453ceb6c17571d262028e71a

$ md5 -q src/client/use-stream.ts
0429ecccc6f7055c75429040168bfe6b
$ md5 -q /tmp/howl-rfc010-r9-backup/use-stream.ts
0429ecccc6f7055c75429040168bfe6b

$ ls tests/server/__r9-probe.test.ts
No such file or directory

$ git status --porcelain
（空）

$ pnpm test
 Test Files  69 passed (69)
      Tests  583 passed (583)
```

---

### 7. 结论

- **Overall Risk Level: Medium**
- **Summary**：C-97 的降级回归锁本轮真的成立——「7 位正常 + 最后一位降级」在绕开引擎时精确打红，相位断言锁住了 `submit` 独有的 `advanceIfDone`。C-98 只修好了普通席位：`done` / `degraded` 的 id 在无插入事件时对齐、正文不再被清空；但最后一位降级时 `DEGRADED` 前多了 `PHASE_CHANGED`，`degraded` 仍发 `nextSeq + 1`，与事件 seq 差 1，真实路由的新连接 / 重连因此重复发两条 `degraded`。AC-5 / API-2 仍是 FAIL，且现有「id 等于 seq」用例只覆盖 `SPEECH`，套件全绿也发现不了。
- **Blocking Issues**：
  1. **C-98 · 最后一位降级时 `degraded` 的 id 与 `DEGRADED` 事件 seq 差 1**：`src/server/llm/speak.ts:113` 用 `nextSeq + 1`，而 `submit` 在最后一位时先产出 `PHASE_CHANGED` 占掉 `nextSeq + 1`；P-R9-B 证明 live `degraded:23` vs `DEGRADED:24`，真实路由出现 `degraded:23` + `degraded:24`。改为从 append 后的事件读取真实 seq，并补①live id、②真实路由刷新 / 重连两组回归测试（覆盖最后一位降级）。
  2. **C-98 的文档回写**：§8.14:267 的「`degraded` 用 `DEGRADED` 事件的 seq」在最后一位场景不成立；§8.12:244 与 `turn.ts:131` 仍是旧的 `DEGRADED → SPEECH` 顺序。随代码修复一起改。
- **Improvement Suggestions**：① 把 `done` / `degraded` 的 id 都改成从 `submitted.events` / append 后的事件回读，删掉 `nextSeq + 1` 的算术假设；② AC-5 的用例改成「每条流消息的 id 必须等于它映射的事件 seq」，至少把 `DEGRADED` 纳入，并用最后一位降级的真实路径；③ 把 `tests/server/stream.test.ts:404` 的用例名改成 `SPEECH + DEGRADED → [done, degraded]`，并直接喂 `streamReducer` 断言终态；④ 修 §8.13:255 与 `tests/server/speak.test.ts:236` 的旧「绕开引擎会红」表述，给最后一位用例补 `DEGRADED` 断言；⑤ `degradeEvents()` 与生产路径的顺序二选一，或在注释里标成仅供 fixture；⑥ C-87 的非 C-97 遗留（AC-11 轮次标记、`src/` 调用者）与 C-90 ~ C-95 非阻塞项按 Round 8 记录继续保留，本轮未重查。
- **Suggested status**：**`Changes requested`**。

---

### 8. Open conflicts（登记到 `RFCS.md` §8.31 Round 9 段）

- **C-97（关闭）**：最后一位降级 + `PHASE_CHANGED` + 离开 `DAY_SPEECH` 的回归锁成立（M-R9-1：1 failed / 7 passed，失败在相位断言）；P-R9-B 正向证明 `SPEECH:22 / PHASE_CHANGED:23 / DEGRADED:24 → DAY_VOTE`。残项：旧用例名 `speak.test.ts:236` 与 §8.13:255 的表述不成立（非阻塞）。
- **C-98（仍 Open，阻塞）**：普通席位已对齐（P-R9-A）；最后一位降级 `degraded:23` vs `DEGRADED:24`（P-R9-B），真实路由 fresh / reconnect 重复 `degraded`，违反 AC-5 / API-2。缺 live id 与真实路由重放两组测试；§8.12 / §8.14 / `turn.ts:131` 的文档需同步。
- **无新增 artifact 冲突**：PRD > FEATURES > RULES > RFC 的权威顺序本轮未遇到需要裁决的矛盾；本节只登记实现与 RFC / 测试计划之间的偏差。
