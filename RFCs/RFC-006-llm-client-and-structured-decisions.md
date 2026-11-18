# RFC-006 · LLM 接入与结构化决策

**Features**: F11, F16, F17, F20
**Depends on**: RFC-004, RFC-007
**Rules**: AI-1, AI-2, AI-3, AI-4, AI-5, AI-7, AI-8, SEC-1, SEC-7, DATA-1
**Complexity**: High
> 关联需求：NFR-3、NFR-14、NFR-16

---

## 1. 摘要

把「AI 玩家怎么思考」收进一个模块：**一个客户端、一份配置、一套结构化输出契约**。

交付后，任一 AI 席位都能「看到上下文 → 返回经过校验的决策 → 被映射成引擎 action」。上下文投影由前置的 RFC-007 提供，本 RFC 只保证客户端与契约。

## 2. 技术方案

### 2.1 客户端

`src/server/llm/client.ts` 是**唯一**允许发出模型请求的地方（AI-1）。基于 `openai` SDK，`baseURL: https://api.deepseek.com`。

```ts
interface LlmConfig {
  model: 'deepseek-flash' | 'deepseek-v4-pro';
  thinking: boolean;        // v1 恒为 true（AI-9）
  temperature: number;      // 默认 0.8
  maxOutputTokens: number;  // 默认 800
  timeoutMs: number;        // 默认 30000
  maxRetries: number;       // 默认 1（总尝试次数 = 1 + maxRetries）
}
```

环境变量：`DEEPSEEK_API_KEY`（必填）、`LLM_MODEL`、`LLM_TIMEOUT_MS`、`LLM_MAX_RETRIES`。其余用默认值。

### 2.2 决策契约

```ts
const DecisionSchema = z.object({
  action: z.enum([
    'kill', 'check', 'heal', 'poison', 'none',
    'vote', 'abstain', 'speak', 'skip', 'shoot', 'expose', 'chat',
  ]),
  target: z.number().int().min(1).max(9).optional(),
  reason: z.string().min(1).max(200),   // 必填：复盘唯一推理来源（AI-5）
  speech: z.string().max(300).optional(),  // 仅对局内发言
  claim: z.object({                     // 可选：高级打法的结构化依据
    role: z.enum(['seer', 'witch', 'hunter', 'villager', 'wolf']).optional(),
    checks: z.array(z.object({ target: z.number().int(), result: z.enum(['wolf', 'not-wolf']) })).optional(),
    accuses: z.array(z.object({ target: z.number().int(), as: z.enum(['wolf', 'seer']) })).optional(),
  }).optional(),
});
```

- `reason` 是复盘展示的**唯一**来源（AI-5）。`reasoning_content` 只进调用元数据，复盘不读。
- `claim` 是 RFC-009 判定「悍跳 / 狼查杀狼」的字段。本 RFC 定义形状，RFC-009 定义判定规则。
- `claim` 的**类型**定义在 `src/shared/events.ts` 的 `Claim`（与 `AI_THOUGHT.claim` 同一份，RFC-001 §2.3），本 RFC 只按它写 Zod schema。产出 `AI_THOUGHT` 时 `claim` **原样带入、不做扁平化**（CR-003 C3）。
- `target` 的必填性按 action 决定，由 `toAction` 校验（见 §2.3），不在 Zod 层强制。
- `speech` 的 300 字上限与 PRD FR-30 的**玩家**发言上限是**同一个数字但不同对象**；此处约束 AI 单轮发言，超长截断而非拒绝。

### 2.3 决策 → action

```ts
interface DecisionContext {
  seat: SeatId;
  phase: Phase;
  day: number;
  legalTargets: SeatId[];   // 本阶段允许指向的席位（由投影给出）
}

function toAction(d: Decision, ctx: DecisionContext): Action | { reject: string };
```

映射表（不合法时返回 `{ reject }`，由调用方产出 `Rejected` 事件）：

| decision.action | Action | 前置 |
|---|---|---|
| `kill` | `WOLF_KILL` | `target ∈ legalTargets` |
| `check` | `SEER_CHECK` | 同上 |
| `heal` / `poison` | `WITCH_ACT`（potion 对应） | 同上 |
| `none` | `WITCH_ACT`（`potion: 'none'`） | 女巫回合 |
| `vote` | `VOTE`（`target`） | `target ∈ legalTargets` |
| `abstain` | `VOTE`（`target: 'abstain'`） | 投票阶段 |
| `speak` | `SPEECH` | `speech` 非空 |
| `skip` | `SPEECH_SKIP` | 发言阶段 |
| `shoot` | `HUNTER_SHOOT`（`target`） | 猎人开枪阶段 |
| `expose` | `SELF_EXPOSE` | 狼人 |
| `chat` | `WOLF_CHAT` | 夜聊阶段 |

`toAction` 是纯函数，不读时钟、不读状态以外的输入。`ts` 由调用方在执行前填入。

**去重责任**：由调用方按 `(gameId, seat, action.type)` 在**同一决策轮次内**去重；决策轮次的标识是 `(gameId, seq)`，其中 `seq` 取自该决策产生前的 `state.seq`。重试不产生第二个 action（NFR-9）。

### 2.4 提示组装

`src/server/llm/prompts/base.ts` 导出：

```ts
function buildSystemPrompt(input: {
  persona: Persona | null;   // RFC-009 前固定为 null
  rules: string;             // 固定规则段，来自 terms/rules 常量
}): string;

function buildUserMessage(ctx: ProjectedContext): string;  // RFC-007 提供类型
```

**提示中不得出现**（AI-8 / F17）：`human`、`真人`、`你是 AI`、`助手`、`玩家是用户`。9 个席位统一用「你」「其他玩家」「座位」。

### 2.5 调用元数据

```ts
interface CallMeta {
  gameId: string;
  seat: SeatId;
  seq: number;        // 该决策产生前的 state.seq
  day: number;
  phase: Phase;
  model: string;
  thinking: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  attempt: number;    // 第几次 HTTP 尝试，从 1 开始
  ok: boolean;
  errorCode?: string;
}
```

不记录对话全文（避免日志膨胀）。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/server/llm/config.ts` | 配置与默认值 |
| `src/server/llm/client.ts` | 单次调用、超时、重试 |
| `src/server/llm/schema.ts` | `DecisionSchema` |
| `src/server/llm/to-action.ts` | 决策 → action |
| `src/server/llm/prompts/base.ts` | 系统提示与用户消息组装 |
| `src/server/llm/meta.ts` | `CallMeta` 收集 |
| `tests/server/llm/*.test.ts` | 契约、重试、密钥、元数据 |

## 4. 实现要点

- 重试只对**可重试错误**：超时、网络错误、429、5xx、schema 校验失败。4xx 参数错误不重试。
- schema 失败的重试**必须把校验错误回喂**，否则会原样再错一次。
- 错误信息不得含响应体原文（SEC-7），只保留状态码与错误码。
- 客户端必须可注入 `fetch` 桩，测试全程不联网（TEST-4）。

## 5. 验收标准

1. 静态扫描 `src/` 断言：除 `src/server/llm/client.ts` 外，不存在指向 `api.deepseek.com` 的字面量
2. `DEEPSEEK_API_KEY` 只被 `config.ts` 读取一次；`src/client/` 全部文件与该字符串无关
3. 客户端抛出的错误对象不含响应体原文：构造一个带敏感内容的 500 响应，断言错误 `message` 中不出现该内容
4. `timeoutMs` 与 `maxRetries` 可通过环境变量覆盖；未设置时取 §2.1 的默认值
5. 超时、网络错误、429、5xx 各自触发一次重试；4xx 参数错误不重试
6. 重试路径不产生重复 action：同一 `(gameId, seat)` 在同一决策轮次内最多产出一个 action
7. `DecisionSchema` 拒绝缺少 `reason` 的对象；接受含 `action` / `target` / `reason` 的对象
8. schema 校验失败时，第二次请求的消息中包含第一次的校验错误文本
9. `toAction` 对 `vote` + 合法 target 返回 `VOTE`；对 `vote` + 非法 target 返回 `{ reject }`；对 `abstain` 返回 `target: 'abstain'` 的 `VOTE`
10. `toAction` 对 `speak` + 空 `speech` 返回 `{ reject }`；对 `shoot` 在非猎人阶段返回 `{ reject }`
11. `buildSystemPrompt` 的输出中不出现 `human`、`真人`、`你是 AI`、`助手`、`玩家是用户` 五个字符串
12. 每次调用产出一条 `CallMeta`，含 §2.5 列出的全部 13 个字段；`attempt` 在重试时递增
13. 模型名与思考模式来自配置对象；业务代码中除 `config.ts` 外不出现 `'deepseek-flash'` 字面量
14. 测试用一个假 `fetch` 返回固定 JSON，断言 `Decision` 被正确解析且 `CallMeta` 被写入

## 6. 边界与测试

- **不做**：上下文投影（RFC-007）、人格（RFC-009）、流式与降级（RFC-010）、HTTP 端点（RFC-008）。
- **不做**：真实 API 调用。本 RFC 全部测试使用假 `fetch`；真实调用只在手工验证时进行。
- **`F20`（调用元数据）在本 RFC 完成**：数据在此采集，展示在 RFC-014。
- **实现者选择**：退避与抖动策略、用 JSON Output 还是 tool call、`CallMeta` 的落盘形态。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-006-1 | 思考模式是否可关 | **(assumption)** 配置项存在但 v1 恒为 true；关闭需走 `/manage-changes`（RULES AI-9） |
| Q-006-2 | `reason` 是否对玩家可见 | **(assumption)** 对局中不可见，复盘可见；由 RFC-007 的投影保证 |
| Q-006-3 | 具体模型版本 | **(assumption)** 默认 `deepseek-flash`；版本号记录在 RULES §2 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置已满足：RFC-007 `Reviewed`（「知情清单」的类型由它提供）。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 规则书放哪 | 单独 `src/server/llm/prompts/rules.ts`（用户选 A） |
| 装 `openai` | 是，`openai@7.57.0`（用户选 A，与 `RULES.md` §2 登记的版本一致） |
| `ProjectedContext` 归属 | 由 RFC-007 提供；本 RFC 只消费，不另造一份（用户选「先做 007」） |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 客户端基于 `openai` SDK，但关掉 SDK 自带重试（`maxRetries: 0`） | 本 RFC 的重试要逐次产出 `CallMeta` 并回喂校验错误；两套重试叠在一起会让 `attempt` 与本节的计数对不上 |
| **D-2** | 错误只保留状态码与错误类别，**不含响应体** | `SEC-7`：响应体可能带着整段提示词甚至密钥回显 |
| **D-3** | 格式校验失败时，把**校验错误文本**作为新一轮 user 消息追加 | 只重试不喂错误，第二次会原样再错一次（`§4` 明文要求） |
| **D-4** | 规则书里的身份名从 `ROLE_LABELS` 取，不硬编码 | 项目规则要求 `src/` 里的身份名只有 `terms.ts` 一处；提示词是**产品文案**，更应该走同一个来源 |
| **D-5** | `toAction` 对不合法组合返回 `{ reject }`，不抛错 | 「AI 说了句不属于当前阶段的话」是正常情况，不该让服务端崩掉 |
| **D-6** | `toAction` 对 `speak` 要求非空 `speech`；超长由提示词侧截断（`§2.2`） | 空发言等于没说；超长截断而不是拒绝，避免 AI 因为啰嗦被整条丢弃 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 服务端新增 | `src/server/llm/{config,client,schema,to-action,meta}.ts`、`src/server/llm/prompts/{base,rules}.ts` |
| 依赖 | `openai@7.57.0`（`package.json`） |
| 测试新增 | `tests/server/llm/{client,to-action,prompts}.test.ts`、`tests/security/llm-isolation.test.ts` |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `llm-isolation.test.ts` · `api.deepseek.com` 只命中 `config.ts` / `client.ts` | PASS |
| 2 | 同上 · `DEEPSEEK_API_KEY` 只命中 `server/llm/config.ts`；`src/client/` 与两个字符串无关 | PASS |
| 3 | `client.test.ts` · 500 响应里的 `sk-SECRET-DO-NOT-LEAK` 不出现在错误 message 中 | PASS |
| 4 | 同上 · 未设环境变量取默认值；`LLM_TIMEOUT_MS` / `LLM_MAX_RETRIES` 可覆盖；缺 key 抛错 | PASS |
| 5 | 同上 · 5xx 重试一次（两次调用）、4xx 不重试（一次）、超时重试 | PASS |
| 6 | — | 去重责任在调用方（`§2.3`），本 RFC 未实现编排层；见 §8.5 |
| 7 | `schema.test.ts`（`client.test.ts` 的 INVALID_OUTPUT 路径）· 缺 `reason` 被拒 | PASS |
| 8 | `client.test.ts` · 第二次请求体里含第一次的校验错误文本，且第二次成功 | PASS |
| 9 | `to-action.test.ts` · `vote` + 合法/非法 target；`abstain` | PASS |
| 10 | 同上 · `speak` + 空文本 → reject；`shoot` 在非开枪阶段 → reject | PASS |
| 11 | `prompts.test.ts` · 5 个禁词在有/无人格两种提示里都不出现 | PASS |
| 12 | `client.test.ts` · `CallMeta` 13 个字段；重试时 `attempt` 递增（`[1,2]`） | PASS |
| 13 | `llm-isolation.test.ts` · `'deepseek-flash'` 只在 `config.ts` | PASS |
| 14 | `client.test.ts` · 假 fetch 返回固定 JSON → 解析出 `Decision` 且写入 `CallMeta` | PASS |

### 8.5 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| AC-6（重试不重复 action） | 去重是**调用方**的责任（`§2.3` 的 `(gameId, seq, seat)` 键）。本 RFC 只交付客户端与契约，没有编排层可挂 | RFC-008 / 后续 |
| 真实 API 调用 | 本 RFC 全部用假 `fetch`；真实调用只在手工验证时做（`§6`） | 手工 |
| 流式与降级 | 不做 | RFC-010 |
