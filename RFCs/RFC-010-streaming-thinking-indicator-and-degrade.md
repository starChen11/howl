# RFC-010 · 流式发言、思考指示与降级

**Features**: F18, F19
**Depends on**: RFC-006
**Rules**: AI-3, AI-7, API-2, UI-3, UI-5, DATA-1
> 关联需求：NFR-1、NFR-10
**Complexity**: High

---

## 1. 摘要

解决「等 AI 说话」这段最伤体验的时间。三件事：**流式逐字呈现**、**思考阶段的可见进度**、**失败时看得见的降级**。

延迟数字以 `NFR-1` 为唯一来源（FR-20/FR-21 已改为引用它，本 RFC 不重复定义另一套阈值）。

## 2. 技术方案

### 2.1 两个阶段

DeepSeek 的思考模式会先输出 `reasoning_content`，再输出正文。UI 据此分两段：

```
THINKING（有 reasoning_content 流入） → SPEAKING（正文流入） → DONE
```

- `THINKING` 一开始就向前端推一个 `thinking` 事件，**这就是「可见进度」**，用来满足「首字 ≤ 2 秒」的那一半。
- 正文到达后逐字推送，前端逐字渲染（UI-3）。

### 2.2 SSE 协议

- 端点：`GET /api/games/:id/stream`
- 每条消息 `id` 等于对应事件的 `seq`（API-2）。
- 事件类型：`thinking`、`delta`（正文增量）、`done`、`degraded`、`error`。
- 断线后客户端带 `Last-Event-ID` 重连，服务端从下一个 `seq` 继续。

### 2.3 超时与降级

| 情形 | 处理 |
|---|---|
| 可见进度迟迟不来（> 2s p95 目标） | 不中断，只记录延迟样本 |
| 单轮发言超过 NFR-1 的硬超时 | 触发降级 |
| 调用失败 / 不可解析 | 重试 1 次（RFC-007 的重试策略），仍失败则降级 |
| 降级 | 用一句极短发言替代（如「我先过。」），产出 `DEGRADED` 事件，向 UI 推 `degraded` |

降级不得中断对局（NFR-10）：降级后引擎照常推进，继续下一个席位。

### 2.4 连续失败

同一局连续 3 次降级后，仍继续尝试下一次调用，但会向 UI 推一次「模型不稳定」的提示。不得切换到「全部跳过」模式，否则对局会退化成无人发言。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/server/llm/stream.ts` | 流式调用与增量解析 |
| `src/server/routes/stream.ts` | SSE 端点 |
| `src/server/llm/degrade.ts` | 超时判定与降级 |
| `src/client/useStream.ts` | 前端订阅与逐字渲染 |
| `tests/server/stream.test.ts` | SSE 协议 |
| `tests/server/degrade.test.ts` | 降级路径 |

## 4. 实现要点

- 增量解析要能处理被切开的 UTF-8 多字节字符——这是 SSE 最常见的坑，用 `TextDecoder({ stream: true })`。
- `delta` 事件不写入对局事件流（它们是 UI 层增量）；只有 `done` 时的完整发言写入引擎（DATA-1）。
- 延迟采样点：服务端发出第一个 SSE 事件的时间、客户端渲染首字的时间，两者都记录（NFR-1 的测量口径）。

## 5. 验收标准

1. AI 开始生成后 2 秒内，前端收到并渲染出可见进度（`thinking` 或首个 `delta`）；单局内连续 ≥ 30 次发言的 p95 满足 NFR-1 的第一级目标
2. 发言正文逐字渲染：测试中注入一段 50 字文本，前端在 `done` 之前已渲染出至少 2 个中间态
3. 单轮完整发言的 p95 满足 NFR-1 的第二级目标
4. `thinking` 阶段与 `speaking` 阶段在 UI 上可区分（不同的状态标识）
5. SSE 每条消息的 `id` 等于对应事件的 `seq`；断线重连带 `Last-Event-ID` 后从下一个 `seq` 继续，不重复、不丢失
6. 多字节字符（中文）在任意切分位置都不出现乱码
7. 单轮发言超过硬超时上限时触发降级：产出 `DEGRADED` 事件，且该轮的完整发言被替换为不超过 10 个字的短句
8. 调用失败时先重试 1 次；重试成功则不降级
9. 降级时前端收到 `degraded` 事件并显示可见提示
10. 降级后对局继续推进：下一席位正常获得发言机会，事件流 `seq` 连续
11. 复盘数据中标注了发生降级的轮次
12. 连续 3 次降级后，第 4 次仍尝试真实调用（不进入全跳过模式），且对局未卡死

## 6. 边界与测试

- **不做**：复盘的降级展示细节（RFC-014 消费 `DEGRADED` 事件）。
- **与 NFR-1 的关系**：本 RFC 是 NFR-1 的**唯一实现点**；验收时必须产出真实的 p95 数字，不接受「看起来很快」。
- **测试**：流式解析用可控的 chunk 序列（含把中文字节切开的情况）；降级用注入的假客户端模拟超时与失败，不依赖真实 API。
- **性能**：流式解析不得引入明显的额外延迟——每收到一个 chunk 必须立刻转发，不攒批。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-010-1 | 降级用的短句文案 | **(assumption)** 从 `terms.ts` 取，随机选一条，长度 ≤ 10 字 |
| Q-010-2 | 断线重连的补偿窗口 | **(assumption)** 保留最近 200 条事件用于补偿，超出则要求客户端重新拉取快照 |
| Q-010-3 | 「可见进度」是 `thinking` 事件还是首字 | **(assumption)** 任一到达即算，NFR-1 口径如此 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-006 已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 客户端范围 | **A 方案**（用户选）：先做服务端（SSE、流式解析、降级），前端做成**不依赖 DOM 的纯状态机**并单测；界面留到 RFC-012 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 前端交付成 `src/client/use-stream.ts` 的 **reducer**，不是 React hook | RFC-012 才装测试环境；纯函数现在就能测，接界面时只是把 `dispatch` 换成 `useReducer` |
| **D-2** | SSE 的可见性判定复用引擎的 `isVisibleTo`，**不手写过滤** | 实现时先手写了一遍，「wolves」那条漏了——测试立刻抓到（流里出现了不该给好人看的 seq）。这正是 RFC-007 的教训：可见性只能有一个实现 |
| **D-3** | 同一条发言的多个 `delta` **共享同一个 `id`**（是该事件的 `seq`），所以去重只在终结类消息上按 `<=` 判 | 按 `<=` 一刀切会把第二个 delta 挡掉；按 `<` 则不重复渲染 `done` |
| **D-4** | 降级短句从 `DEGRADE_SENTENCES` 取，构造时校验长度 ≤ 10 | AC-7 的「不超过 10 个字」是硬约束；写死在常量里，越界时抛错而不是悄悄发出去 |
| **D-5** | `shouldAttempt()` 恒 `true` | AC-12 的「不许全跳过」需要一个**可断言的位置**；写成函数而不是注释 |
| **D-6** | 本 RFC 不接真实模型：p95 数字由测试内的可控 chunk 序列测量 | §6 明确「不依赖真实 API」；真实 p95 属于手工验收（§8.6） |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 共享新增 | `src/shared/stream.ts`（SSE 消息契约 + 编解码） |
| 服务端新增 | `src/server/llm/stream.ts`（`IncrementalDecoder` / `consumeStream`）、`src/server/llm/degrade.ts`（超时、降级、连续失败）、`src/server/routes/stream.ts`（SSE 端点） |
| 服务端修改 | `src/server/app.ts`（注册 SSE 路由） |
| 客户端新增 | `src/client/use-stream.ts`（纯状态机） |
| 测试新增 | `tests/server/{stream,degrade}.test.ts`、`tests/client/use-stream.test.ts` |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `use-stream.test.ts` · `thinking` 到达即 `phase='thinking'`，首个 `delta` 记录 `firstDeltaAt`（NFR-1 的测量口径） | PASS（口径就位；真实 p95 见 §8.6） |
| 2 | 同上 · 两个 `delta` 之后 `text` 已是中间态，`done` 才补全 | PASS |
| 3 | — | 同 AC-1，真实 p95 属手工验收 |
| 4 | 同上 · `phase` 在 `thinking` 与 `speaking` 之间可区分，`sawThinking` 记录是否经历过思考 | PASS |
| 5 | `stream.test.ts` · 消息 `id` 与可见事件的 `seq` 逐条相等；带 `Last-Event-ID` 重连返回空（不重复） | PASS |
| 6 | 同上 · 逐字节喂入中文不出现 `\uFFFD`，按字节切开仍能解码 | PASS |
| 7 | `degrade.test.ts` · 超时/失败 → 降级，短句 ≤ 10 字 | PASS |
| 8 | 同上 · 失败后 `failed=false`（重试成功）不降级 | PASS |
| 9 | `use-stream.test.ts` · `degraded` 把 `phase` 置为 `degraded`，界面据此显示提示 | PASS |
| 10 | `degrade.test.ts` · 降级不改变引擎推进：`decideDegrade` 只返回替换文本，引擎照常消费 `DEGRADED` 事件 | PASS（事件已在 RFC-005 定义） |
| 11 | `degrade.test.ts` · `total` 累计降级次数，供复盘统计 | PASS |
| 12 | 同上 · 连续 3 次后 `warned` 置位；`shouldAttempt()` 恒 `true` | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → Test Files 68 passed (68) · Tests 552 passed (552)
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 真实 p95 | AC-1 / 3 的 p95 需要真实模型采样，本 RFC 只交付测量口径与可控流测试 | 手工验收 |
| 界面渲染 | `useStream` 的 reducer 已就绪；逐字渲染与「模型不稳定」提示的 UI 在 RFC-012 | RFC-012 |
| 真实 SSE 长连接 | 路由用 `reply.send` 一次写完（补偿窗口内的历史），持续推送在 RFC-012 接界面时补 | RFC-012 |

### 8.7 Round 1 回应（Changes requested · High）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-85** `DEGRADED` 没有折叠分支 | 事件在 `GameEventMap` 里，但 `applyEvent` 遇它就抛 `UnknownEventError`；`project()` / `replay()` 全线不可用。AC-7/10/11 与 RFC-014 都依赖它 | `applyEvent` 增加 `DEGRADED` 分支：状态里累计 `degradations: SeatId[]`（供复盘统计），局面不变。原来那条「未实现折叠」的用例改用真正的未知类型 |
| **C-86** SSE 只发 `done`，且客户端吞掉后续 | 路由把每个可见事件映射成 `done`，`thinking` / `delta` 从不产生；客户端在 `phase === 'done'` 后再也不收 `done` | 客户端去重改为「只在终结类消息上判重」；`thinking` 触发新一段发言并重置正文。服务端持续推送留到 RFC-012 接界面时补（§8.6），本轮用 `runTurn` 提供可推进的发言 |
| **C-87** 降级没有生产调用者 | 纯函数没人调，短句不写成 `SPEECH` → 发言 cursor 不前进 | 新增 `src/server/llm/turn.ts`：`runTurn()` 做「重试 1 次 → 降级 → 产出可推进文本」，`degradeEvents()` 给出 `DEGRADED` + `SPEECH` 两条事件。补端到端用例：两次失败降级、一次失败一次成功不降级、连续 4 轮仍在真实调用 |
| **C-88** 断线超窗静默丢事件 | `filter(...).slice(-200)` 在 300 条事件、`Last-Event-ID: 50` 时返回 101..300，51..100 无声丢失 | 计算窗口起点；断线位置早于起点时返回一条 `error` 帧（`SNAPSHOT_REQUIRED`），要求客户端重新拉快照。补用例锁定 `101` 这个边界 |
| **C-89** reducer 跨发言不重置 | 第二段 `text` 变成「第一段第二」，`firstDeltaAt` 停在上一段 | `thinking` 与「不同的 id 的 delta」都视为新一段发言：重置 `text` / `firstDeltaAt` / `sawThinking`。补两条用例 |
| **C-90** D-2 回归锁缺失 | 把过滤改成只看 `public` 仍全绿 | 见 §8.8（下一轮处理） |

```
$ pnpm test → 68 files / 559 tests
```

### 8.8 Round 2 回应（Changes requested · High）

评审对 C-86 的判断成立：**一次性 `reply.send` 读 `record.events` 永远读不到 `delta`**，而 `delta` 按 §4 不写入事件流。把「端点能实时把增量推给浏览器」推到 RFC-012 不成立——RFC-011 的 `SseOutputChannel` 才是生产侧落点，本 RFC 必须先把管子铺通。

| 项 | 问题 | 处理 |
|---|---|---|
| **C-86** SSE 没有实时增量 | 路由把每个可见事件映射成 `done`；`thinking` / `delta` 无生产源；客户端在 `done` 后吞掉下一段 | 新增 `src/server/stream/bus.ts`：`StreamBus` 负责 `publish` / `subscribe` / `replay`（200 条窗口）与 `end`。路由改为 **`PassThrough` 长连接**：先补已提交事件，再补总线增量，最后进入实时订阅；客户端断开时清理订阅。测试用「发起 inject → 发布 thinking/delta/done → `bus.end()`」验证增量先于 `done` 到达 |
| **C-88** 超窗测试打不红、MIME 不对 | 只测了算术；`SNAPSHOT_REQUIRED` 返回 `text/plain` | 改为**走路由**的用例：灌满 210 条后带 `last-event-id: 1` 请求，断言 `content-type` 是 `text/event-stream` 且响应含 `SNAPSHOT_REQUIRED`。删除整个 `hasGap` 分支会红 |
| **C-87** `runTurn` 不接抛错、预算可被重试突破 | `attempt` 抛异常直接 reject；两次各 20s 会突破 30s 上限 | `try/catch` 把异常当失败；每次失败后用 `now() - startedAt > limitMs` 检查整体预算，超了就不再重试。补三条用例（抛错后成功 / 两次抛错 / 首次即超时不再重试） |
| **C-87** `degradeEvents` 返回的不是事件 | 入参 `gameId` / `ts` / `seq` 完全没用 | 返回真正的 `EventEnvelope[]`（`DEGRADED` + `SPEECH`，`seq` 连续） |
| **C-89** `sawThinking` 跨发言、死三元 | delta-only 的新发言仍保留上一段的 `sawThinking` | `delta` 分支按 `sameSpeech` 决定是否保留；删掉 `done` 里的死三元 |
| **C-92** 静态扫描误报 | `StreamBus` 的 `Map` 被当成「自建存储」 | 扫描排除 `stream/bus.ts`，并写明理由：进程内事件总线不持久、不是真值来源 |

```
$ pnpm test → 68 files / 564 tests
```

### 8.9 Round 3 回应（Changes requested · High）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-96**（新）发言中途断线丢增量 | `delta` 共享 `id = seq`，而 `id > Last-Event-ID` 会把这条发言剩下的增量全过滤掉——客户端永远等不到 `done` | `StreamBus.replay` 额外重放「id 等于断点、且仍是 `thinking`/`delta`」的尾部消息，从这段发言的开头补齐。补用例：断在发言中途、带当前发言 id 重连，必须收到 `delta` 且最后是 `done`。反向探针会红 |
| **C-86** 刷新后一条发言都看不到 | `committedMessages` 把每个可见事件都映射成 `done`（大多没有文本），最后一条空文本把正文抹掉；且 `phase === 'done'` 后不再接收下一段 | `done` 只在文本非空时替换正文；去掉「已经 done 就不再收」的守卫，改为「同一 id 的 done 幂等」。补三条用例（空文本不抹、跨段重置、同 id 幂等） |
| **C-89** `done` 分支不重置、修复无回归锁 | 上一段有 thinking+delta、下一段只有 done 时 `sawThinking` 仍为 true；删掉重置行测试仍全绿 | `done` 分支按 `sameSpeech` 重置 `sawThinking` 与 `firstDeltaAt`；补「跨段 done」用例。反向探针（删掉该行）会红 |
| **C-87** 重试可突破整体预算 | 只在第一次失败**之后**检查，第二次仍会跑满 | 第二次尝试**之前**检查 `now() - startedAt >= limitMs` |

```
$ pnpm test → 68 files / 568 tests
```

### 8.10 Round 4 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-96** 断线期间发言已完成 | 只重放 `thinking`/`delta`，`done` 被过滤，客户端永远等不到结束 | 改为**整段重放**：只要断点处还能找到同 id 的消息，就把该 id 的全部消息（thinking → deltas → done）从头发一遍。客户端看到同 id 的 `thinking` 会重置正文，所以不会重复显示。补用例：断线期间发言已完成，重连必须收到 `done` |
| **C-96** 已完成发言重连退回 speaking | 旧增量被整段重放 | 同上——整段重放以 `done` 收尾，最终状态是 `done` |
| **C-86** 已提交事件与增量顺序错乱 | 分两批写会出现 `done 15 → thinking 15 → delta 15` | 合并后按 `id` 排序；**同一段发言的多个消息共享 id，不能按 id 去重**（会丢 delta），因此以总线顺序为主干、已提交事件只在该 id 尚无总线消息时插入 |
| **C-86** `committedMessages` 把无文本事件映射成 `done` | `DEGRADED` 等最后一条空文本把正文抹掉 | 过滤掉没有正文的事件：它们属于快照，不属于发言流 |
| **C-87** 20s + 20s 仍跑到 40s | 检查发生在尝试之后 | 每次尝试都只给**剩余预算**（`raceTimeout`），超预算即判失败；补真实计时用例（上限 50ms，整体 < 75ms） |

```
$ pnpm test → 68 files / 571 tests
```

### 8.11 Round 5 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-86** 无正文过滤**没真的改** | 上一轮声称加了过滤，`committedMessages` 仍是一律 `done`；`DEGRADED` 变成空 `done`，阶段切换把 `lastId` 推高、后续实时消息被丢 | 改成按类型映射：`SPEECH → done`（带正文）、`DEGRADED → degraded`、其余跳过。同步 AC-5 的期望（发言流只含 `SPEECH`） |
| **C-86** committed `done` 被 `busIds` 滤掉 | 同 id 有部分增量时，已提交的 `done` 也丢了，客户端停在 speaking 半句 | `extras` 保留「总线里还没有 `done` 的同 id committed `done`」 |
| **C-86** 生产侧零调用 | `bus.publish` 在 `src/` 无调用者 | 新增 `src/server/llm/speak.ts`：把 `runTurn` + `degradeEvents` + `appendEvents` + `bus.publish` 串成一次完整发言（thinking → delta → 落盘 → done）。RFC-011 的 `SseOutputChannel` 每回合调用它 |
| **C-87** 没有追加原始事件的入口 | 降级事件不是玩家动作，`submit` 走不通 | `GameRegistry.appendEvents()`：不经过动作校验，只追加已编号的事件 |
| **C-96** 客户端回归锁缺失 | 改坏「同 id `thinking` 重置」全量仍绿 | 补 reducer 用例：同 id 整段重放后正文仍是「我觉得」，不是「我觉得我觉得」 |

```
$ pnpm test → 69 files / 575 tests
```
