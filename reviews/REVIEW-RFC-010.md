# RFC-010 评审 · 流式发言、思考指示与降级

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-19（Round 4；Round 3 / 2 / 1 同日）
> **分支 / HEAD**：`main` / `c2ec4a0`
> **结论**：**Changes requested**（Round 4）
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
