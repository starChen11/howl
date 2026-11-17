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
