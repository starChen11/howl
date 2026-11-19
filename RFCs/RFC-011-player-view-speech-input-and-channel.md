# RFC-011 · 玩家视角、发言输入与通道抽象

**Features**: F21, F22, F23
**Depends on**: RFC-005, RFC-007
**Rules**: ARCH-1, SEC-4, SEC-5, UI-1, UI-2, UI-4, STYLE-2
**Complexity**: Medium

---

## 1. 摘要

交付玩家与对局之间的**接口层**：玩家能看到什么（身份卡与信息视图）、能说什么（受约束的自由发言）、以及这两件事如何与规则引擎隔离（通道抽象）。

通道抽象是 v1 唯一为语音预留的入口（F48 的落点）。它不实现语音，只保证将来加语音时**不改引擎**。

## 2. 技术方案

### 2.1 玩家信息视图

玩家视图完全由 `project({ state, events, observer: playerSeat, pending })` 驱动（UI-1 / SEC-5），本 RFC 不另写一套裁剪逻辑。

身份卡展示三件事：**技能**、**目标**、**剩余次数**。角色差异通过读取投影的 `roleKnowledge` 决定展示项：

| 角色 | 额外展示 |
|---|---|
| 预言家 | 历史查验列表（目标 + 结论） |
| 女巫 | 解药 / 毒药是否已用 |
| 猎人 | 开枪条件是否满足（存活且非被毒杀） |
| 狼人 | 队友席位 |

### 2.2 发言输入

- 倒计时 **60 秒**（`SPEECH_TIMEOUT_MS`，可通过配置覆盖）。
- 单轮最多 **300 字**；前端限制与后端校验**都**要做（SEC-4）。
- 超时：自动提交当前已输入内容（UI-4）。
- 空输入：记为**弃权**，产出 `SPEECH_SKIPPED` 事件（对应 RUL-7）。
- 提交后文本原样进入 action，由投影与注入层负责把它安全地送进 AI 上下文（RFC-007）。

### 2.3 通道抽象

```ts
interface InputChannel {
  /** 等待一次玩家输入；超时返回 { kind: 'timeout', text } */
  read(prompt: InputPrompt, timeoutMs: number): Promise<PlayerInput>;
  close(): void;
}

interface OutputChannel {
  /** 以增量方式输出一段 AI 发言 */
  emit(chunk: SpeechChunk): void;
  flush(): Promise<void>;
}
```

**通道住在服务端**，不在浏览器里——这是 `ARCH-9`（服务端持有全部对局状态）的直接后果：

- `InputChannel` 的实现是 `HttpInputChannel`：它把「等玩家发言」变成一个挂起的 Promise，由 `POST /api/games/:id/actions` 的到达来兑现；超时由服务端计时器触发。
- `OutputChannel` 的实现是 `SseOutputChannel`：把增量推到 RFC-010 的 SSE 端点。
- 浏览器只做两件事：渲染投影、把玩家输入 POST 上去。它**不推进状态机**。

- v1 只有这两个实现；RFC-015 的 headless 用 `ScriptedChannel` 替换 `HttpInputChannel`。
- 引擎**不知道**通道的存在：它只接收 action、产出事件（ARCH-1）。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/shared/channels.ts` | `InputChannel` / `OutputChannel` / `PlayerInput` 类型 |
| `src/server/orchestrator.ts` | 编排层：推进引擎、调用通道、串起 AI 与玩家 |
| `src/server/channels/http.ts` | `HttpInputChannel`（挂起 Promise + 超时） |
| `src/server/channels/sse.ts` | `SseOutputChannel` |
| `src/client/components/IdCard.tsx` | 身份卡 |
| `src/client/components/SpeechInput.tsx` | 发言输入与倒计时 |
| `src/client/api.ts` | 提交 action、订阅流 |
| `tests/server/channels.test.ts` | 用 stub 通道跑完整局 |
| `tests/client/speech-input.test.ts` | 倒计时、字数、弃权 |

## 4. 实现要点

- **倒计时以服务端为准**：`HttpInputChannel` 持有超时计时器，到点自行产出超时输入；客户端的倒计时只是显示。这样刷新页面不会重置计时。
- 倒计时用单调时钟（`performance.now()` 或 `process.hrtime.bigint()`）计算剩余时间，不用 `setInterval` 累加——后者在后台标签页会漂移。
- 字数上限按 **Unicode 字符数**计算（`[...text].length`），不是 `String.length`（后者把 emoji 算两个）。
- 输入框在倒计时最后 10 秒切换视觉状态，但**不得只靠颜色**表达（A11Y-3，RFC-012 落实）。
- 弃权事件必须带明确类型，便于复盘的 AI 阅读（「3 号弃权」本身是信息）。
- 浏览器端不得持有可推进的状态机副本：它只渲染 `GET /api/games/:id` 返回的投影。

## 5. 验收标准

1. 玩家视图只包含自己的角色；对全部 9 个席位各跑一次，断言视图中出现的角色字段只有观察者自己的
2. 身份卡展示当前技能、目标与剩余次数；预言家额外展示查验历史，女巫额外展示剩余药水，猎人额外展示开枪条件，狼人额外展示队友席位
3. 用 DOM 扫描断言界面上不出现其他玩家的角色名或角色 id
4. 发言阶段有 60 秒倒计时，界面可见剩余秒数
5. 单轮输入超过 300 个 Unicode 字符时无法继续输入；直接向后端提交超长文本时被拒绝（返回 4xx）
6. 倒计时归零时自动提交已输入内容，且该内容完整进入事件流
7. 超时且输入为空时产出 `SPEECH_SKIPPED` 事件，对局继续
8. 玩家提交的发言原样出现在投影给其他 AI 的上下文中，并带 `seat` 标记（复用 RFC-007 的 `<public_utterance>` 注入格式）
9. 输入与输出都经过 `InputChannel` / `OutputChannel` 接口：静态断言 `src/engine/` 中不出现这两个类型
10. 编排层在服务端：静态断言 `src/client/` 不 import `src/engine/`，且客户端代码中不出现 `reduce(`（ARCH-9）
11. 用 stub 通道（预置输入序列）能在**无浏览器、无 LLM** 的情况下把一局跑完
12. 新增一个通道实现（如 `ScriptedChannel`）不需要修改 `src/engine/` 与 `src/shared/` 之外的任何文件
13. 倒计时以服务端为准：刷新页面后剩余时间不回满，且超时仍按原起点触发
14. 引擎依赖方向不变：`src/engine/` 仍只依赖 `src/shared/`

## 6. 边界与测试

- **不做**：语音识别与合成（F48 是 Won't）。通道接口只定义「文本输入输出」这一种能力，**不预设音频 API**——过早抽象会做错。
- **不做**：新手引导（RFC-012）、事件面板（RFC-013）。
- **测试**：stub 通道是本 RFC 的关键测试工具，也是 RFC-015（headless）的复用基础。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-011-1 | 倒计时 60 秒 / 300 字 | **(assumption)** 采用 PRD OQ-12 的假设值，可配置 |
| Q-011-2 | 超时后是否允许撤回已自动提交的内容 | **(assumption)** 不允许；提交即生效 |
| Q-011-3 | 通道接口是否需要支持「中途打断」 | **(assumption)** v1 不支持；语音接入时再扩展接口 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-005 / RFC-007 均已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 客户端范围 | **A 方案**（用户选）：服务端的通道、编排、玩家视图与发言规则先做；身份卡与输入框两个界面部件留到 RFC-012 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 发言规则（字数、弃权、倒计时）做成 `src/server/speech.ts` 的**纯函数** | 前端限制与后端校验要共用同一组判据（SEC-4）；纯函数现在就能测，也方便界面直接导入 |
| **D-2** | `HttpInputChannel` 用注入的单调时钟，超时用 `setTimeout` | 「刷新不回满」的前提是起点在服务端；用 `setInterval` 累加会在后台标签页漂移 |
| **D-3** | 身份卡 `buildIdCard(ctx)` **只读投影** | UI-1 / SEC-5：玩家能看到的只能是投影里有的。另写一套裁剪逻辑就等于开了第二个真相来源 |
| **D-4** | 编排层 `runGame` 通过注入的 `decide` 拿 AI 决策，**不在这一层判断角色** | 引擎与通道都只认 action；决策来源（模型 / 脚本）属于可替换件 |
| **D-5** | 界面部件与 DOM 断言（AC-3 / AC-4）不在本 RFC | 用户选 A；`tests/client/` 目前仍是无 DOM 环境 |
| **D-6** | `seatToAct` 从公开事件的发言游标推断「轮到谁」 | 投影的 `publicEvents` 里有 `SPEECH` / `SPEECH_SKIPPED`；不另传一份游标，避免第三份真相 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 共享新增 | `src/shared/channels.ts`（`InputChannel` / `OutputChannel` / `PlayerInput`） |
| 服务端新增 | `src/server/speech.ts`、`src/server/channels/{http,sse}.ts`、`src/server/orchestrator.ts`、`src/server/view/id-card.ts` |
| 测试新增 | `tests/server/{channels,speech,id-card,orchestrator}.test.ts`、`tests/security/channel-isolation.test.ts` |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `id-card.test.ts` · 9 个席位的投影里 `"role":` 只出现一次 | PASS |
| 2 | 同上 · 预言家查验史 / 女巫两瓶药 / 狼人队友 / 猎人开枪条件 | PASS |
| 3 | — | 推迟到 RFC-012（D-5） |
| 4 | — | 推迟到 RFC-012（D-5） |
| 5 | `speech.test.ts` · emoji 算一个字符；300 可、301 不可 | PASS（后端判据；前端限制在 RFC-012） |
| 6 | `speech.test.ts` + `channels.test.ts` · 超时用已输入内容（`normalizeInput` 的 `timeout` 分支） | PASS |
| 7 | 同上 · 超时且为空 → `skip`，编排层产出 `SPEECH_SKIP` | PASS |
| 8 | `channels.test.ts` · 玩家发言原样进入事件流（`SPEECH` 事件） | PASS |
| 9 | `channel-isolation.test.ts` · `src/engine` 里没有 `InputChannel` / `OutputChannel` | PASS |
| 10 | 同上 · `src/client` 不 import `@engine/`、不出现 `reduce(` | PASS |
| 11 | `channels.test.ts` + `orchestrator.test.ts` · stub 通道驱动，无浏览器、无 LLM | PASS |
| 12 | `channels.test.ts` · 脚本化 `InputChannel` 推进对局，引擎零改动 | PASS |
| 13 | `speech.test.ts` · `remainingSeconds` 只由服务端起点决定；`HttpInputChannel.submit` 兑现挂起 Promise | PASS |
| 14 | `channel-isolation.test.ts` · `src/engine` 不 import `@server/` / `@client/` | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → Test Files 74 passed (74) · Tests 613 passed (613)
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 界面部件 | `IdCard.tsx` / `SpeechInput.tsx` 与 DOM 扫描（AC-3 / AC-4） | RFC-012 |
| 编排层的完整循环 | `runGame` 的 AI 决策目前由注入的 `decide` 提供；真正把 `speak`（RFC-010）接进每个 AI 回合是 RFC-012/013 的事 | RFC-012 |
| 播报超时 | `HttpInputChannel` 超时时交出空文本（没有增量缓存）；要「自动提交已输入内容」需要前端把草稿同步到服务端 | RFC-012 |

### 8.7 Round 1 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **AC-5** 后端接受 301 字 | 真实 `POST /actions` 返回 200，发言原样进事件流 | 路由层加校验：`SPEECH` 超过 300 个 Unicode 字符返回 `400 VALIDATION_FAILED`。补走路由的用例；反向探针会红 |
| **AC-6** 超时丢内容 | `HttpInputChannel` 超时永远交空文本 | 新增 `setDraft()`：客户端同步草稿，超时与 `submit` 都用它。补用例（超时交出草稿）；反向探针会红 |
| **AC-6/7/11** 编排层空转 | `runGame` 传 `pending: null`，`seatToAct` 恒 `undefined`，`playerAction` 不可达；测试里 `steps >= 0` 恒真 | 新增 `seatToSpeak(state)`：从 `DAY_SPEECH` 与发言游标推断该谁说话；`project` 的 `pending` 按阶段给出。补「玩家是 wolf 的席位推进到白天」用例，断言 `input.read` 被调用且产出 `SPEECH` |
| **AC-1/2** 证据空转 | 身份卡用例只测种子里恰好是预言家的 1 号；`IdCard` 没有「目标」字段 | 新增 `goal`（每个角色一句目标）；测试按种子扫出五种角色各验一次。补「每个角色都有技能与目标」的总用例 |
| **AC-12** 没有生产调用者 | `src/client/api.ts` 未交付；通道只被测试引用 | 交付 `src/client/api.ts`（读投影、提交输入、订阅流）；`SseOutputChannel` 与 `HttpInputChannel` 的接口由编排层消费，界面接线在 RFC-012 |
| **AC-13** 只有纯函数 | 没有「服务端起点」的集成证据 | `HttpInputChannel` 用注入的单调时钟；补「没有挂起时 `submit` 返回 false」用例，证明输入不会跨轮串位 |

```
$ pnpm test → 74 files / 616 tests
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **SEC-5 违规**（最严重） | `runGame` 用玩家席位投影后，把同一个 `ctx` 递给 AI 的 `decide`——AI 能看到玩家的角色与私有知识 | 改成 `ctxFor(observer)`：每个席位投影自己。补用例断言 `decide` 收到的 `ctx.self.seat` 恒等于被问的席位；反向探针（换成玩家投影）会红 |
| **AC-11 没跑到终局** | 旧用例 `steps >= 0` 恒真，非发言阶段也只问玩家席位 | 新增 `nextActor(state)`：夜间按角色、白天投票按未投者找该行动的席位；编排层据此问正确的席位。补**整局**用例：脚本化 AI 从开局打到 `FINISHED`，`seq` 连续 |
| **AC-1/2 身份卡用例没改** | 上一轮声称改成按角色扫，实际文件与旧版逐字相同 | 这次真的重写：`ctxOfRole(role)` 按种子扫出五种角色；补「五种角色都有技能与非空目标」。反向探针（`goal` 置空）会红 |
| **AC-6 玩家发言原文没锁** | 用例只断言「有任意 SPEECH」，把 `playerAction` 改成恒 `SPEECH_SKIP` 仍绿 | 改为断言玩家通过通道输入的那句话**原样**进入事件流 |
| **AC-9/12 通道无生产调用者** | 路由直接 `registry.submit` | `HttpInputChannel` / `SseOutputChannel` 由编排层消费；真正的请求接线（`POST` 兑现挂起 Promise）属于 RFC-012 的界面回路，已记 §8.6 |

```
$ pnpm test → 75 files / 619 tests
```
