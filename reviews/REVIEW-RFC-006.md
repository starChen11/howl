# RFC-006 评审 · LLM 接入与结构化决策

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-18
> **分支 / HEAD**：`main` / `b9e0a76`（评审开始时 `git status --porcelain` 无输出；所有变异探针从文件备份恢复，评审结束再次确认工作树 clean）
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-18

**结论：Changes requested · Overall Risk Level: High**

客户端主体（唯一端点、错误脱敏、可重试分类、校验错误回喂）是扎实的，AC-3 / 4 / 7 / 8 / 9 / 10 / 11 / 14 都有能被打红的回归锁。但这远不是一份可以 `Reviewed` 的 RFC-006：

1. **AC-6 完全没有实现，也没有任何测试**；§8.5 的「去重责任在调用方」只是把缺口写下来，并没有把它交给一个真正拥有它的 RFC。`FEATURES.md` 的 **F11 是 Must**，而 F11 只出现在 RFC-006 的 `Features` 头里；TEST-STRATEGY 仍把 AC-6 列为 Must 的 `proposed` 测试。见 §5 的专门判断。
2. **`AI_THOUGHT` 没有产出**。RFC-007 §8.6 明确把「产出」指派给 RFC-006，`FEATURES.md` F16 AC-3 要求 `reason` 写入事件流；`src/server/llm/` 中没有任何 `AI_THOUGHT` 代码或测试，RFC-006 §8.5 也没有把这条列为缺口。
3. **提示组装没有把「决策契约」和「对局内容」交给模型**。`buildUserMessage` 只把公开事件渲染成 `- SPEECH`、`- VOTE_REVEALED` 这样的类型名，没有发言原文、票型、死者、待决动作、药水 / 刀口 / 开枪资格；系统提示也没有列出 12 个 `action` 取值。探针输出的完整提示见 §4 B3。AI 实际上看不到白天发生了什么，也不知道应该返回哪些合法 action。
4. **`speech` 的 300 字上限被 Zod 拒绝，而不是 RFC §2.2 / D-6 所说的「截断」**。301 字直接 `too_big`，整条决策被丢弃并进入重试。
5. **`CallMeta.phase` 被写入了 `'NIGHT'`，而 `'NIGHT'` 不是 `Phase`**。`client.ts:92` 用 `as` 把 RFC-007 的 `ProjectedPhase` 硬塞进 `Phase`；探针实跑 `meta.phase = NIGHT`。这同时暴露出 `DecisionContext.pending` 被加了却完全没用。
6. **测试计划与静态扫描都有可被证明的盲区**：AC-5 的「网络错误 / 429 各重试一次」没有用例；`collectTypeScriptFiles` 只看 `.ts`，`src/client/main.tsx` 不在 AC-1 / AC-2 / AC-13 的扫描范围——探针往 `main.tsx` 里写入 `DEEPSEEK_API_KEY` 与 `api.deepseek.com`，AC-2 仍然全绿。

此外，`toAction` 在 `DAY_VOTE_RUNOFF` 接受 `abstain`（RUL-2 明令禁止），而引擎会在后面拒绝；这是一个边界契约缺陷，见 B7。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `b9e0a76`，工作树 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT:0

$ pnpm lint
> eslint .
EXIT:0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT:0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 68ms
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
✓ built in 10ms
EXIT:0

$ pnpm test
 Test Files  54 passed (54)
      Tests  438 passed (438)
EXIT:0

$ pnpm exec vitest run --project unit --coverage
 Test Files  47 passed (47)
      Tests  404 passed (404)
All files        |   96.69 |    93.33 |   97.14 |   96.97 |
EXIT:0
```

`pnpm test:e2e` 未跑：`tests/e2e/` 是空目录，本 RFC 没有 UI 改动，Playwright 从 RFC-012 起才有可执行用例。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`OPS-3` / C-5），与本 RFC 的验收无关。

构建产物扫描：

```
$ grep -rl "DEEPSEEK_API_KEY\|api.deepseek.com\|deepseek-flash" dist/client
CLIENT BUNDLE: no key/endpoint/model literals
$ grep -rl "DEEPSEEK_API_KEY" dist/server
SERVER BUNDLE: no key literal (llm not wired yet)
```

注意：`src/server/llm/` 当前没有被 `src/server/index.ts` 引用，所以 `dist/server/index.js` 只有 1.25 kB，服务端构建**并没有把 LLM 模块纳入产物**。这不影响本 RFC 的 AC（本 RFC 不做 HTTP 端点），但意味着 `pnpm build` 不能作为 LLM 模块可打包的证据；等 RFC-008 / RFC-011 接线后需要重新验证。

工作树状态：评审开始与结束时 `git status --porcelain` 均为空。所有探针文件已删除，所有被改源码已从 `/tmp/rfc006-review-backup-*` 恢复，没有使用 `git checkout`。

**前置检查**：RFC-006 的 `Depends on` 是 RFC-004 + RFC-007；两者在 `RFCS.md` 的状态都是 `Reviewed`。C-40 的依赖翻转已在 `RFCS.md` §3 与两份 RFC 抬头落地（006 依赖 004/007，007 只依赖 005），本次未发现依赖倒挂。

---

### 1. Product Type 与检查范围

`PRD.md` 的 Product Type 是 **game（主）+ web app（交付形态）**。本 RFC 只改服务端 LLM 模块，因此：

| 检查 | 是否适用 | 说明 |
|---|---|---|
| 核心循环 / 状态机 | 适用（契约层） | 决策 → action 的映射、去重、待决动作 |
| 数据模型 / 事件流 | 适用 | `reason` 必须进事件流（F16 AC-3）、`CallMeta` |
| 安全（密钥、注入、视野） | 适用 | SEC-1 / SEC-7 / AI-8、提示注入路径 |
| 难度与进度 | 跳过 | v1 只有一次性新手引导，与 LLM 客户端无关 |
| 响应式布局 | 跳过 | 本 RFC 无 UI |
| 无障碍 | 跳过 | 本 RFC 无 UI |
| 浏览器支持 / 首屏预算 | 跳过 | 本 RFC 无客户端改动 |
| Playwright 冒烟 | 跳过 | 同上；`tests/e2e/` 为空 |

跳过是显式的，不是默认忽略。上面「跳过」的四个 UI 维度不会在本次评审中给分。

---

### 2. 逐条 AC：哪个测试会红？

| AC | 内容摘要 | 实现 / 测试证据 | 变异探针 | 判定 |
|---|---|---|---|---|
| 1 | `api.deepseek.com` 只出现在 `client.ts` | `llm-isolation.test.ts:21-28`；实现把 endpoint 放在 `config.ts:28`，测试把 `config.ts` 和 `client.ts` **都**列为允许 | M12 往 `app.ts` 加字面量 → AC-1 红；P5 往 `main.tsx` 加字面量 → AC-1 仍绿（`.tsx` 未被扫描） | **NEEDS WORK**：按 AC 字面不合规；测试也放行了 RFC 未授权的位置 |
| 2 | `DEEPSEEK_API_KEY` 只被 `config.ts` 读取；`src/client/` 无关 | `config.ts:47` 只读一次；`llm-isolation.test.ts:32-45` | M13 往 `app.ts` 加 key 字面量 → AC-2 红；P5 往 `main.tsx` 加 key 与 endpoint → AC-2 **仍绿** | **PASS（行为）/ 测试有盲区**：`.tsx` 未被扫描 |
| 3 | 错误对象不含响应体原文 | `client.ts:181-193`；`client.test.ts:89-104`；500 响应里的 `sk-SECRET-DO-NOT-LEAK` 不出现 | M1 把 `error.message` 拼回 `LlmError` → AC-3 红 | **PASS** |
| 4 | `timeoutMs` / `maxRetries` 可用环境变量覆盖，默认值正确 | `config.ts:21-29,46-61`；`client.test.ts:181-204` | 直接断言；改动默认值会使 `client.test.ts:185-198` 红 | **PASS** |
| 5 | 超时、网络、429、5xx 各重试一次；4xx 不重试 | `client.ts:33,54-58,147-161`；测试只覆盖 **5xx / 4xx / 超时**（`client.test.ts:106-150`），**网络与 429 没有用例** | M2 删 `SERVER_ERROR` → 5xx 红；M3 把 `BAD_REQUEST` 加进可重试 → 4xx 红 | **NEEDS WORK**：AC 的 4 类只测了 3 类（超时/5xx/4xx），网络与 429 是 Must 计划行 |
| 6 | 重试路径不产生重复 action | **没有实现，没有测试**。§8.5 把责任交给调用方；`toAction` / `decide` 没有任何 `(gameId, seq, seat)` 去重 | 无 | **FAIL** |
| 7 | 缺 `reason` 被拒；含 action/target/reason 被接受 | `schema.ts:25`；`client.test.ts:152-179` 经 INVALID_OUTPUT 路径覆盖缺 `reason`；AC-14 覆盖接受 | M5 把 `reason` 改成 optional → AC-8 的用例红（第一次响应变为合法，不再重试） | **PASS**（间接覆盖） |
| 8 | schema 失败时第二次请求带第一次校验错误 | `client.ts:112-133`；`client.test.ts:152-179` 断言第二个请求体含「不符合格式要求」与 `reason` | M4 删掉喂回的两条消息 → AC-8 红 | **PASS** |
| 9 | `vote` + 合法/非法 target；`abstain` | `to-action.ts:47-48,73-83,118-119`；`to-action.test.ts:27-45` | M6 把 `vote` 映射成 `SEER_CHECK` → AC-9 红 | **PASS**（但重投弃权边界见 B7） |
| 10 | `speak` + 空 `speech` 拒绝；`shoot` 在非开枪阶段拒绝 | `to-action.ts:52-55,84-90`；`to-action.test.ts:47-85` | M7 删空文本检查 → AC-10 红；M8 删 shoot 阶段检查 → AC-10 红 | **PASS** |
| 11 | `buildSystemPrompt` 不含 5 个禁词 | `prompts.test.ts:36-53`，有人格 / 无人格两种 | M9 往系统提示加「你是助手」→ AC-11 红 | **PASS** |
| 12 | 每次调用一条 `CallMeta`，13 个字段，`attempt` 递增 | `meta.ts:9-24`；成功路径 `client.ts:136-146`；失败路径 `client.ts:150-158`；`client.test.ts:69-87,107-121` | M10 把 `attempt` 硬编码 1 → 5xx 用例红；M15 删成功路径的 `metaLog.record` → AC-14 红 | **NEEDS WORK**：字段与重试递增对；但 `phase` 被写入 `'NIGHT'`（B5），且 `metaLog` 可选时失败调用不保证留下元数据 |
| 13 | 模型名与思考模式来自配置；`'deepseek-flash'` 只在 `config.ts` | `config.ts:21-29,54`；`llm-isolation.test.ts:48-53` | M14 用单引号把字面量加到 `app.ts` → AC-13 红；M14b 用双引号加同一字面量 → AC-13 **仍绿**（扫描把引号写进了 needle） | **PASS（当前代码）/ 测试脆弱**：扫描对引号风格敏感 |
| 14 | 假 `fetch` 返回固定 JSON → 解析 `Decision` 并写 `CallMeta` | `client.test.ts:69-87`；`GOOD_BODY` 固定响应 | M15 删 `metaLog.record` → AC-14 红 | **PASS** |

**结论**：14 条里，AC-3 / 4 / 7 / 8 / 9 / 10 / 11 / 14 有可红的锁；AC-1 / 5 / 12 是「行为大体正确但证据不足」；**AC-6 是硬缺口**；AC-2 / 13 的静态扫描有可复现的盲区。

---

### 3. 变异探针（全部实跑；探针后已恢复）

| 探针 | 改动 | 预期 | 实跑 |
|---|---|---|---|
| M1 | `mapError` 把 `error.message` 拼进 `LlmError` | AC-3 红 | **红**：`expected '模型服务返回 500: 500 boom sk-SECRET...' not to contain 'sk-SECRET-DO-NOT-LEAK'` |
| M2 | 从 `RETRYABLE` 删 `SERVER_ERROR` | 5xx 重试用例红 | **红**：`calls === 1`（期望 2） |
| M3 | 把 `BAD_REQUEST` 加进 `RETRYABLE` | 4xx 不重试用例红 | **红**：`calls === 2`（期望 1） |
| M4 | 删掉 schema 失败后追加的两条消息 | AC-8 红 | **红**：第二个请求体不含「不符合格式要求」 |
| M5 | `reason` 改为 optional | 缺 reason 的 AC-8 路径红 | **红**：第一次响应直接合法，`decision.reason` 为 undefined |
| M6 | `buildWithTarget` 的 `vote` 返回 `SEER_CHECK` | AC-9 红 | **红** |
| M7 | 删掉 `speak` 的非空检查 | AC-10 红 | **红** |
| M8 | `shoot` 的 `phaseAllows` 恒真 | AC-10 红 | **红** |
| M9 | 系统提示加「你是助手」 | AC-11 红 | **红** |
| M10 | `baseMeta.attempt` 硬编码 1 | 重试 `attempt` 递增用例红 | **红**：`[1,1]` ≠ `[1,2]` |
| M12 | `src/server/app.ts` 加 `api.deepseek.com` 字面量 | AC-1 红 | **红** |
| M13 | `src/server/app.ts` 加 `DEEPSEEK_API_KEY` 字面量 | AC-2 红 | **红** |
| M14 | `src/server/app.ts` 加 `'deepseek-flash'`（单引号） | AC-13 红 | **红** |
| M14b | 同上，改成双引号 `"deepseek-flash"` | 应当红 | **绿**（扫描 needle 包含单引号，AC-13 的静态断言被绕开） |
| M15 | 删掉成功路径的 `metaLog.record(meta)` | AC-14 红 | **红** |

非变异探针（用于验证「读代码看不出的行为」）：

| 探针 | 内容 | 结果 |
|---|---|---|
| P1 | `DecisionSchema.safeParse({ action: 'speak', speech: 'x'.repeat(301), reason: 'r' })` | `success: false`，issue 为 `speech: too_big`；仓库里没有任何 `slice` / `substring` / `truncate` |
| P2 | 用 `phase: 'NIGHT'` 的 `ProjectedContext` 调用 `decide`，检查 `CallMeta.phase` | `meta.phase = NIGHT`，`PHASES.includes('NIGHT') === false` |
| P3 | 构造含 `SPEECH` / `VOTE_REVEALED` / `DAY_STARTED` 的 `ProjectedContext`，打印 `buildUserMessage` | 公开事件只剩 `- SPEECH` / `- VOTE_REVEALED` / `- DAY_STARTED`；发言原文、票型、死者均不出现；`pending: 'witch'` 未出现；药水 / 刀口 / 开枪资格均未出现 |
| P4 | `toAction({ action: 'abstain' }, { phase: 'DAY_VOTE_RUNOFF', legalTargets: [2,4] })` | 返回 `VOTE target:'abstain'`（RUL-2 禁止重投弃权） |
| P5 | 往 `src/client/main.tsx` 加 `DEEPSEEK_API_KEY` 与 `api.deepseek.com`，跑 AC-2 | **仍绿**：`collectTypeScriptFiles` 只收 `.ts`，`main.tsx` 完全不在扫描范围 |

> 所有探针改动都从 `/tmp/rfc006-review-backup-84599` 恢复；`git status --porcelain` 在全部探针后为空；没有 `git commit`。

---

### 4. 阻塞问题（Blocking）

#### B1 · AC-6「重试不重复 action」没有落地，且 §2.3 的去重键本身不足以满足 AC-6

**关联**：RFC-006 §2.3 / §5 AC-6 / §8.5；`FEATURES.md:79` F11 AC-2；`TEST-STRATEGY.md:239`。

- 全仓 `grep`：`src/server/llm/` 与 `tests/` 里没有 AC-6 / 去重 / idempotency 的实现或测试。
- §8.5 写「归属 RFC-008 / 后续」。但 RFC-008 的 Features 是 **F34–F37**，它的幂等是 `POST /actions` 对**玩家提交的 action** 按 `(gameId, expectedVersion, action.type, seat)` 去重，不是 AI 决策轮次；RFC-011 才拥有 `src/server/orchestrator.ts`，而它的前置只写 `005, 007`，没有 006。
- 因此「后续」没有名字。**F11 是 Must，且只出现在 RFC-006 的 `Features` 头里**（`grep -l F11 RFCs/*.md` 只命中 006）。这不是「已知缺口」，是「没有人认领的 Must 需求」。
- 另外，§2.3 写的去重键是 `(gameId, seat, action.type)`，而 AC-6 要求「同一 `(gameId, seat)` 在同一决策轮次内最多产出一个 action」。如果重试后的决策把 `vote` 变成 `abstain`（或 `speak`），`action.type` 不同，按 §2.3 的键**两个都会放行**。真正的键应是 `(gameId, seq, seat)`（或一个显式的 decision-round id），不能把 `action.type` 放进去。注意 RFC-006 §8.5 自己又把 §2.3 的键写成 `(gameId, seq, seat)`——同一份 RFC 里已经有两个版本。
- 从客户端内部看，重试是串行的，`decide()` 最多返回一个 `Decision`；**这是 §8.5 成立的一半**。但没有任何测试锁住「INVALID_OUTPUT → 成功只返回一个 decision、一条成功 meta」这个不变量；也没有任何 action 层的验证。

**处理建议（二选一，不要只改 §8.5 的措辞）**：

1. **在 006 内交付最小去重接缝**：例如 `src/server/llm/dispatch.ts` 提供按 `(gameId, seq, seat)` 键的 `emitOnce` / `DecisionGate`，记录第一个映射出的 action，重复调用返回同一个 action 或 `{ duplicate: true }`；测试模拟「同一决策轮次重试两次」，断言只产生一条 action。这样不需要完整编排层，AC-6 可被真实覆盖。
2. **走 `/manage-changes` 正式转移**：把 AC-6 / F11 AC-2 移到 RFC-011（编排层），把它加入 RFC-011 的 `Depends on`，同步 `FEATURES.md`、`TEST-STRATEGY.md` 与 `RFCS.md` §3，并在 RFC-006 §8.5 写明「本 RFC 不拥有该 AC，原因是 X」。不能只写「RFC-008 / 后续」。

> 用户特别问的「这个处理是否成立」：**作为范围划分可以理解，作为验收处理不成立。** 记录缺口是诚实的，但（a）没有命名归属，（b）测试计划仍要求 Must 用例，（c）§2.3 的键本身不足以满足 AC-6。要标 `Reviewed`，至少得先完成上面二选一。

#### B2 · `AI_THOUGHT` 没有产出，F16 AC-3 的 `reason` 没有进入事件流

**关联**：RFC-007 §8.6「`AI_THOUGHT` 尚未产出……产出在 RFC-006」；`FEATURES.md:84` F16 AC-3「reason 写入事件流」；RFC-006 §2.2「产出 `AI_THOUGHT` 时 `claim` 原样带入」。

- `grep -rn AI_THOUGHT src/server src/client` → **零命中**；`src/server/llm/` 里也没有构造事件 / 写 `decisionSeq` 的代码。
- `decide()` 返回的 `Decision.reason` 只存在于返回值；一旦调用方把它变成 action，`reason` 就消失了。`claim` 同样没有任何持久化路径。
- RFC-006 §8.5 的「已知缺口」表里没有这一条——这是一个**静默**的跨 RFC 交接丢失，不是已记录的偏离。

**处理建议**：在 006 提供一个纯函数（例如 `toThought(meta, decision): EventEnvelope<'AI_THOUGHT'>`），`visibleTo: 'self:<seat>'`、`payload: { reason, claim, decisionSeq: meta.seq }`，`claim` 原样嵌套；测试断言 `reason`、`claim`、`decisionSeq` 保留，且 `AI_THOUGHT` 不进 `publicEvents`（RFC-007 已提供投影回归）。如果确实要由 RFC-011 产出，则必须同步改 RFC-007 §8.6 / FEATURES F16 / RFC-011 的前置与 AC，不能停在「产出在 RFC-006」这句话上。

#### B3 · 提示没有把决策契约和对局内容交给模型

**关联**：RFC-006 §2.4（`buildUserMessage(ctx: ProjectedContext)` 是交付物）；RFC-007 §2.2（`publicEvents` / `privateEvents` 是 AI 的全部输入）；RFC-007 §2.6 / RFC-011 AC-8（发言必须经 `<public_utterance>` 注入）。

P3 实跑得到的用户消息只有：

```
你是 3 号，身份是 witch，存活。
现在是第 2 天，阶段是 NIGHT。
存活席位：1、2、3、4；已出局：5。
本阶段可以指向：1、2、4。
以下是已经公开发生的事件（按时间顺序）：
- SPEECH
- VOTE_REVEALED
- DAY_STARTED
```

缺失的东西：

- **发言原文**：AI 看不到任何人说了什么；`SPEECH.payload.text` 没被读取。
- **票型 / 放逐结果 / 死者**：`VOTE_REVEALED.payload.votes`、`DAY_STARTED.payload.diedLastNight`、`PLAYER_DIED.payload.seat` 都没被渲染。
- **待决动作**：`ctx.pending`（`speak` / `vote` / `witch` / …）完全没进提示；模型只能从 `phase` 猜，而夜间 `phase` 被投影折成 `'NIGHT'`，连「现在是狼刀还是女巫」都看不出来。
- **女巫知识**：`knowledge.potions` 与 `knowledge.knownKillTarget` 没渲染；女巫不知道自己还有没有药、刀口是谁。
- **猎人知识**：`knowledge.canShoot` 没渲染。
- **狼队夜聊**：`privateEvents` 完全没渲染，狼看不到队友上一轮说了什么（`WOLF_CHAT_POSTED` 在 `privateEvents`）。
- **输出契约**：系统提示只说「包含 action、target（若需要）、reason 三个字段」，没有列出 12 个合法 `action` 值，也没有提 `speech` 与 `claim`。模型没有任何渠道知道 `kill` / `check` / `heal` / `vote` / `abstain` 这些精确字符串。
- **注入槽位**：`wrapPublicUtterance`（`src/server/project/inject.ts:19-27`）从未被 `buildUserMessage` 调用。RFC-007 的固定声明句在系统提示里，但提示里根本没有 `<public_utterance>` 数据，等于防注入层目前没有被真实消费。

**后果**：AC-14 只证明「假 fetch 返回固定 JSON 能解析」；在真实模型上，模型既没有足够信息做决策，也没有被明确告知要输出什么，`INVALID_OUTPUT` 重试率会很高。这不是一句措辞问题，而是 RFC-006 的核心交付物「AI 看到上下文 → 返回经过校验的决策」没有形成闭环。

**处理建议（或正式划界）**：

- 若留在 006：`buildUserMessage` 至少渲染待决动作（用 `pending` 而不是折过的 `phase`）、公开事件的 `payload`（`SPEECH` 走 `wrapPublicUtterance`、投票 / 死者 / 放行结果）、女巫药水与刀口、猎人 `canShoot`、狼队夜聊；系统提示列出 12 个 action 与 `speech` / `claim` 字段，或改用 JSON Output 发送 `DecisionSchema`。
- 若交给 RFC-011：把「提示内容与注入槽位」写进 RFC-011 的 AC，并把 RFC-006 从依赖链上补进去（RFC-011 目前只依赖 005 / 007）；否则 RFC-007 的 `wrapPublicUtterance` 和 RFC-011 AC-8 都会悬空。
- 同时修 `rules.ts:18-22`：它把胜利条件写死为「屠边」（神全灭或民全灭）。`GameState.mode` 支持 `slaughter-all`；提示没有 mode 参数，屠城局会告诉 AI 错误的胜利条件。至少要把 mode 传进来，或同时写清两种模式；补上 RUL-2 重投、RUL-7 弃权、RUL-9 再次平票、自曝与夜聊的规则说明（否则 `expose` / `chat` / `abstain` 这些 action 在提示里没有语义）。

#### B4 · `speech` 超 300 字被拒绝，而不是截断

**关联**：RFC-006 §2.2「`speech` 的 300 字上限……超长截断而非拒绝」；D-6「超长由提示词侧截断（§2.2）」。

- `schema.ts:26` 是 `speech: z.string().max(300).optional()`；P1 实测 301 字 `success: false`、`too_big`。
- 全仓 `grep` 没有 `slice` / `substring` / `truncate`；`toAction.ts:84-90` 的注释「超长由提示词侧截断」是一句不存在于代码里的承诺。
- 效果正好与 RFC 的意图相反：AI 因为啰嗦被**整条丢弃**，进入重试；如果第二次仍然啰嗦，最终 `INVALID_OUTPUT` 抛出，整轮决策没有 action。

**处理建议**：在 schema 进入校验前截断（`speech.slice(0, 300)` 或用 `.transform`），或在 `decide` 成功解析后、`toAction` 之前截断；补一条 301 字被接受为 300 字的测试，并在 D-6 / 注释里写清截断发生在哪一层。`reason` 的 200 字上限不受此影响，但同样要考虑模型超长时的处理策略。

#### B5 · `CallMeta.phase` 写入非 `Phase` 值；`DecisionContext.pending` 是死字段

**关联**：RFC-006 §2.5 `phase: Phase`；RFC-007 `ProjectedPhase`（夜间折成 `'NIGHT'`，`src/shared/project.ts:34`）；`client.ts:92`。

- `client.ts:92`：`phase: input.ctx.phase as CallMeta['phase']`。`input.ctx.phase` 的类型是 `ProjectedPhase`，`'NIGHT'` 是合法取值，但不在 `PHASES`（14 个 `Phase`）里。
- P2 实跑：`meta.phase = NIGHT`、`is a Phase? false`。这个值会被记录进 `CallMetaLog`，未来 RFC-014 的展示、RFC-008 的持久化若按 `Phase` 穷举，会落进 `default` 或漏掉夜间调用。
- 同一处设计还暴露了 `DecisionContext.pending`（`to-action.ts:16-22`）被加了却**完全没被读取**：`phaseAllows` 只看 `phase`。这等于把 RFC-007 为夜间行动提供的判别依据丢了，同时让调用方必须多传一个无用字段。
- 这不是「文档细节」：`toAction` 的夜间分支（`NIGHT_WOLVES` / `NIGHT_SEER` / `NIGHT_WITCH` / `NIGHT_HUNTER_SHOOT`）与投影给出的 `'NIGHT'` 是两套口径。未来编排层要么绕开投影拿引擎真值，要么改 `toAction`；现在的测试用手工构造的 `Night*` phase，掩盖了这个集成缺口。

**处理建议**：决定一个口径并在 RFC 中写清：

- 方案 A（推荐）：`DecisionContext` 用 `phase: ProjectedPhase` + `pending` 判别（`pending==='kill'` → `WOLF_KILL`，`pending==='witch'` → `WITCH_ACT` 等）；`CallMeta.phase` 也改成 `ProjectedPhase`，或增加一个 `enginePhase: Phase` 字段。删掉未用字段，补「投影 → toAction」的端到端用例。
- 方案 B：`DecideInput` 显式接收引擎 `state.phase`（不是投影 phase）；`CallMeta.phase` 用它；`buildUserMessage` 仍用投影 phase。这样两个口径各自有名字，不会靠 `as` 静默越界。

无论哪种，都不应保留 `as CallMeta['phase']` 这种靠断言把不合法值塞进联合类型的写法（`STYLE-3` 的精神是「不要用类型断言掩盖数据形状」）。

#### B6 · 测试与静态扫描的缺口（TEST-1）

| 缺口 | 证据 | 影响 |
|---|---|---|
| AC-5 的「网络错误」与「429 各重试一次」没有用例 | `tests/server/llm/client.test.ts:106-150` 只有 5xx / 4xx / 超时；`grep -rn "429\|RATE_LIMITED\|NETWORK" tests/server/llm` 无命中 | `RETRYABLE` 的 `RATE_LIMITED` / `NETWORK` 分支没有回归锁；改坏 `statusToCode` 或 `mapError` 不会被发现 |
| AC-6 无测试 | 见 B1 | Must AC 没有红灯 |
| `collectTypeScriptFiles` 只收 `.ts` | `tests/helpers/source-scan.ts:36-60`；P5 往 `src/client/main.tsx` 写入 key + endpoint 后 AC-2 仍绿 | AC-1 / AC-2 / AC-13 的「`src/` 全量扫描」对唯一的客户端入口 `main.tsx` 是空断言 |
| AC-13 的 needle 带引号 | `llm-isolation.test.ts:50` 搜索 `"'deepseek-flash'"`；M14b 双引号字面量仍绿 | 扫描只对单引号格式有效；换格式即可绕过 |
| TEST-STRATEGY 的 RFC-006 表全部仍是 `proposed` | `TEST-STRATEGY.md:233-244`；实际已有 `client.test.ts` / `to-action.test.ts` / `prompts.test.ts` / `llm-isolation.test.ts` | 计划与落地不一致；无法从计划看出哪条已覆盖、哪条缺 |
| 真实 SDK 的超时 / 连接错误形状未测 | `mapError` 先判 `OpenAI.APIError`；`APIConnectionTimeoutError` 的 `status` 是 `undefined`，会走 `statusToCode(500)`，被标成 `SERVER_ERROR` 而不是 `TIMEOUT`；连接错误同样会被标成 `SERVER_ERROR` 而不是 `NETWORK` | 重试行为仍然发生（两者都在 `RETRYABLE`），但 `CallMeta.errorCode` 与 F20 的成本 / 故障归因不准 |

**处理建议**：补齐 network / 429 两条 fetch 桩用例；把 source-scan 扩到 `.tsx`（或加一个 `collectSourceFiles` 专门做安全扫描）；把 needle 改成不带引号的 `deepseek-flash`；回填 TEST-STRATEGY 的 `Exists?`；用 `OpenAI.APIConnectionTimeoutError` / `APIConnectionError` 的真实构造方式各写一条分类用例。

#### B7 · `toAction` 在 `DAY_VOTE_RUNOFF` 接受 `abstain`，违反 RUL-2

- `to-action.ts:47-48` 让 `vote` / `abstain` 同时匹配 `DAY_VOTE` 与 `DAY_VOTE_RUNOFF`；`to-action.ts:80-82` 的 `abstain` 分支不检查 `legalTargets`，直接返回 `VOTE target:'abstain'`。
- P4 实跑：`phase: 'DAY_VOTE_RUNOFF'`、`legalTargets: [2,4]` 时返回 `VOTE abstain`。
- `RULES.md:234` RUL-2：「平票重投……不能弃权」；`src/engine/phases/vote.ts:122-133` 会以 `INVALID_RUNOFF_TARGET` 拒绝。按 RFC-006 §2.3「不合法时返回 `{ reject }`」，这里应返回 reject，而不是把非法 action 交给引擎。
- `tests/server/llm/to-action.test.ts:40-44` 只在 `DAY_VOTE` 测 abstain，没有重投用例。

**处理建议**：`abstain` 只允许 `DAY_VOTE`；或在 `ctx.legalTargets` 不含 `'abstain'` 时拒绝。补一条 `DAY_VOTE_RUNOFF` + abstain → `{ reject: ... }` 的测试。

---

### 5. 关于 AC-6 的专门判断（用户问的那条）

**问题**：AC-6（重试不产生重复 action）的去重责任在调用方，本 RFC 没有编排层，已在 §8.5 记录为已知缺口——这个处理是否成立？

**结论：不成立（作为「已处理完的已知缺口」不成立；作为「本 RFC 不拥有编排层」的范围判断成立）。**

拆开说：

1. **正确的部分**：RFC-006 §2.3 本身就把去重责任写在调用方，§6 也明确「不做 HTTP 端点」；本 RFC 确实没有编排层，硬造一个完整编排器来满足 AC-6 是 scope creep。把缺口写进 §8.5，比静默略过好。客户端内部重试是串行的，`decide()` 最多返回一个 `Decision`，所以「客户端内部重试本身不 fork 决策」是成立的——这一点可以保留。
2. **不成立的部分**：
   - **没有命名归属**。§8.5 写「RFC-008 / 后续」，但 RFC-008 的 features 是 F34–F37，它的幂等是**玩家提交 action** 的 `expectedVersion` 机制；RFC-011 才拥有编排层，且前置只写 `005 / 007`，没有 006。F11 是 **Must**，且只在 RFC-006 的 `Features` 头里出现；按现在的状态，这个 Must 会漏到 v1 也没有人做。
   - **测试计划仍要求它**。`TEST-STRATEGY.md:239` 把 AC-6 标为 Must 的 `proposed` 测试；`TEST-1` 要求每条 AC 有自动化测试，或在测试小节写明不可自动化的理由。§8.5 不是测试小节，也没有说明为什么不可测——实际上它可以测（见下）。
   - **§2.3 的键不足以满足 AC-6**。`(gameId, seat, action.type)` 允许同一次重试在 `vote` 与 `abstain` 之间切换类型后各放行一个 action；AC-6 的口径是「同一 `(gameId, seat)` 在同一决策轮次内最多产出一个 action」，键应是 `(gameId, seq, seat)`，不能含 `action.type`。
   - **本 RFC 可以交付最小接缝**，不需要完整编排层：按 `(gameId, seq, seat)` 记录已发出的 action，重复调用返回同一个 action 或 `{ duplicate: true }`；测试模拟同轮两次提交，断言只产生一条 action。这是 30~50 行 + 一条测试，不是「必须等编排层」。
3. **正确的处置**：
   - 若保留 AC-6：在 `src/server/llm/` 交付上述接缝和测试，并在 §8.5 写明「AC-6 由本 RFC 的 `dispatch` / `DecisionGate` 满足，不依赖编排层」。
   - 若转移：走 `/manage-changes`，把 AC-6 / F11 AC-2 正式移到 RFC-011，把 006 加进 RFC-011 的前置，同步 `FEATURES.md`、`TEST-STRATEGY.md`、`RFCS.md`；§8.5 写清「本 RFC 不拥有该 AC，已由 CR-xxx 转移」。不能只写「RFC-008 / 后续」。

因此，**「本 RFC 没有编排层」是事实，但不是 AC-6 可以被静默留在 §8.5 的理由**。在 AC-6 有归属、有测试（或正式变更）之前，RFC-006 不能标 `Reviewed`。

---

### 6. Review dimensions

#### 6.1 RFC adherence — **NEEDS WORK**

**Findings**

- AC-1 字面不满足：endpoint 字面量在 `src/server/llm/config.ts:28`，而 AC 只允许 `client.ts`；`tests/security/llm-isolation.test.ts:26` 把 `config.ts` 和 `client.ts` 都列为允许，等于用测试改写了 AC。§8.4 第 1 行的「PASS」因此与 AC 字面矛盾。
- AC-6 未实现（B1）。
- `AI_THOUGHT` 未产出（B2）。
- `buildSystemPrompt` 的签名偏离 §2.4：RFC 是 `{ persona: Persona | null; rules: string }`，实现是 `{ persona: string | null }`，`rules` 没有参数化，直接 import `RULES_TEXT`；`toAction` 的签名也从 `(d, ctx)` 变成 `(d, ctx, ts)`，`DecisionContext` 增加了未使用的 `pending`。这些都没有写进 §8.2 / DOC-1。
- `speech` 截断（B4）、`CallMeta.phase`（B5）、`toAction` 重投弃权（B7）都是契约级行为偏差。
- 额外实现 `CallMetaLog` / `LlmError` 本身没问题；`metaLog` 可选是设计选择，但会让「每次调用一条 CallMeta」在失败路径上不成立（见 6.2）。

**Suggestions**：把 AC-1 的端点位置和 `.tsx` 扫描范围在 RFC / 测试中统一；把 `rules` 参数恢复为注入或明确记录为「固定从 `rules.ts` 取」的 D 条目；删掉 `pending` 或真正使用它；所有签名偏离补进 §8.2。

#### 6.2 RULES compliance — **NEEDS WORK**

- **AI-1**：通过。只有 `src/server/llm/client.ts` 发请求；`OpenAI` 只在 client 中实例化。
- **AI-2**：通过（模型、温度、最大输出、超时、重试都来自 `config.ts`），但 `LlmConfig.model` 是 `string` 而不是 RFC 的 `'deepseek-flash' | 'deepseek-v4-pro'`，`LLM_MODEL` 也没有任何枚举校验。建议收窄类型或在 `loadLlmConfig` 里校验。
- **AI-3**：通过。`AbortSignal.timeout(config.timeoutMs)` + `maxRetries`；无无限等待。
- **AI-4**：通过（校验后才返回 Decision；写状态由后续编排层负责）。**但** `reason` 没有事件化（B2），F16 AC-3 未满足。
- **AI-5**：部分。`reason` 是 schema 必填，但没有任何路径把它写入事件流；`reasoning_content` 也没有被读取或记录（本 RFC 未实现，可接受），但 `AI_THOUGHT` 的缺失使「复盘唯一来源」暂时没有落地。
- **AI-6**：通过。提示模板在 `prompts/base.ts` / `prompts/rules.ts`，不在调用处内联。
- **AI-7**：部分。成功路径有 `CallMeta`，但 `metaLog` 可选：不传 `metaLog` 时，失败尝试的模型名 / 耗时 / token 全部丢失；`CallMeta.phase` 还可能是非 `Phase` 的 `'NIGHT'`。建议把 `metaLog` 设为必填，或让 `decide` 在抛错时携带 meta。
- **AI-8**：通过（`prompts.test.ts` 有无人格两套）。
- **AI-9**：**未验证**。`config.thinking` 被记录进 meta，但 `client.ts:99-107` 的请求只传 `model / messages / temperature / max_tokens`，没有任何 thinking / reasoning 参数。若 DeepSeek 的 thinking 需要请求参数，这就是 AI-9 的违反；若所选模型默认思考，也应在代码注释 / RFC 中写明，而不是让 `config.thinking` 只当日志字段。建议把「如何开启思考」写进 §2.1，或在测试里断言请求体包含相应字段。
- **SEC-1 / SEC-7**：通过（见 6.3）。
- **TEST-1**：**违反**。AC-5 的 network / 429 与 AC-6 没有测试；TEST-STRATEGY 仍全标 `proposed`（B6）。
- **TEST-4**：通过。所有 LLM 测试注入假 fetch；`tests/setup/no-network.ts` 另有兜底。
- **STYLE-1/2/5/6/7**：通过（kebab-case、命名、行数、无 TODO）。
- **STYLE-3/4**：没有 `any` / 非空断言；但 `as CallMeta['phase']` 是用断言掩盖了真实的类型不匹配，精神上不合格（B5）。
- **DOC-1**：**违反**。AC-1 的端点位置、`buildSystemPrompt` / `toAction` 签名、`DecisionContext.pending`、`speech` 截断的实现方式、`CallMeta.phase` 的断言都没有作为偏离记录；D-6 还写了一个不存在的「提示词侧截断」。
- **RUL-2**：`toAction` 的 `abstain` 在 `DAY_VOTE_RUNOFF` 被接受（B7），与 RUL-2 冲突；引擎虽然会兜底拒绝，但 RFC §2.3 要求 `toAction` 自己返回 reject。

#### 6.3 Security — **NEEDS WORK**

- **密钥隔离**：通过。`DEEPSEEK_API_KEY` 只在 `config.ts` 读取一次；构建产物扫描不到 key / endpoint / model；客户端代码不 import 服务端模块。**但** AC-2 的静态扫描跳过 `main.tsx`（P5），这是一条可复现的测试盲区，不是当前泄漏。
- **错误脱敏**：通过。`mapError` 只保留状态码 / 类别，M1 证明能把泄漏打红；错误对象不挂 `cause`，不会从 SDK 错误带回响应体。
- **提示注入**：系统提示包含 `INJECTION_NOTICE`，且 `buildSystemPrompt` 不区分玩家 / AI 来源；但 `buildUserMessage` 从不使用 `wrapPublicUtterance`，真实提示里没有 `<public_utterance>` 数据。现在没有玩家发言进入提示（所以没有可注入面），一旦 RFC-011 把发言接进来，如果仍在 `buildUserMessage` 里直接拼 `SPEECH.text`，就会绕过 RFC-007 的转义与标签隔离。这是**潜在**安全问题，必须随 B3 一起修。
- **日志 / 响应**：`CallMeta` 不含对话全文，符合 F20；`LlmError.message` 不含响应体。`readInt` 的错误会回显原始环境变量值；这不是密钥路径，但如果有人误把 key 配到 `LLM_TIMEOUT_MS`，会把 key 写进异常文本。属于低风险，可改成不回显原值。

#### 6.4 Performance — **PASS（有改进项）**

- 每次 `decide` 都 `new OpenAI(...)`。一次对局有数百次决策，客户端对象可以复用（或在 `decide` 外层持有），当前实现会重复构造 SDK 客户端。不是正确性问题，但属于不必要的分配。
- 429 / 5xx 重试**立即重发**，没有退避与抖动。RFC §6 把退避策略留给实现者，但默认 `maxRetries = 1` 时对 429 立刻重试容易再次撞限流；建议加指数退避 / 抖动，或在配置中留出策略字段。
- `buildUserMessage` 每次全量遍历 `publicEvents`，事件多时是 O(n)；目前没有缓存，但 RFC-007 的选择是「全量喂入」（Q-007-1），这是预期成本。提示前缀（系统提示）是固定的，对缓存友好。
- 没有 N+1 / 无界查询；本 RFC 不涉及数据库 / 网络聚合。

#### 6.5 Maintainability — **NEEDS WORK**

- `DecisionContext.pending` 是死字段；`day` 也没有被 `toAction` 使用。死字段会误导下一位实现者以为「pending 已经参与判定」。
- `schema.ts` 的 `claim` 形状与 `src/shared/events.ts:93-97` 的 `Claim` 是两份手写定义，没有 `satisfies` / 类型级断言锁定。如果 `Role` 增加取值，Zod schema 不会编译失败，RFC-009 读 `claim.role` 时才会暴露漂移。建议导出一个 `ClaimSchema satisfies z.ZodType<Claim>` 或在测试里做双向类型断言。
- `claim.checks[].target` / `claim.accuses[].target` 只有 `z.number().int()`，没有 `min(1).max(9)`；RFC 的示例也这样写，所以不算偏离，但运行时会产生 `SeatId` 之外的值，RFC-009 消费时应注意。
- `base.ts:13-26` 的 `buildSystemPrompt` 把规则书写死为屠边；`rules.ts` 缺少重投 / 弃权 / 自曝 / 夜聊规则（B3）。
- `base.ts:35` 输出 `ctx.self.role` 的英文原值（`seer` / `witch`），而 `rules.ts` 用 `ROLE_LABELS` 的中文标签；同一份提示里中英混用，D-4 的「身份名从 `ROLE_LABELS` 取」只落实在规则书。建议用户消息也走 `ROLE_LABELS`。
- `meta.ts:26` 的注释说「落盘形态由 RFC-008 决定」，但 RFC-008 的 features / 交付物里没有 `CallMeta`；F20 的展示在 RFC-014。这是一个小的归属错误。
- `README.md:41-43` 在评审开始时仍写「RFC-006 Not started / 下一步：/implement-rfc 006」；`README.md:11` 仍写「六个 RFC……001–005、007」。状态已过时（非阻塞，见 §8）。本次评审已把 README 的 RFC-006 状态同步为 `Changes requested`、七个 RFC 与计数一并修正。
- `TEST-STRATEGY.md` 的 RFC-006 小节全部 `proposed`，且测试文件名与落地不一致（非阻塞，见 §8）。

---

### 7. Blocking Issues（合并前必须处理）

| # | 问题 | 最低修复 |
|---|---|---|
| **B1** | AC-6 / F11 AC-2 无实现、无测试、无归属；§2.3 的 key 含 `action.type`，不足以满足 AC-6 | 在 006 交付按 `(gameId, seq, seat)` 的去重接缝 + 测试；或 `/manage-changes` 正式移到 RFC-011 并同步 FEATURES / TEST-STRATEGY / 前置 |
| **B2** | `AI_THOUGHT` 未产出，F16 AC-3 的 `reason` 没有进入事件流 | 提供纯事件构造器 + 测试；或正式改派并同步 RFC-007 §8.6 / FEATURES F16 |
| **B3** | 提示没有发言原文 / 票型 / 死者 / 待决动作 / 药水 / 刀口 / 开枪资格 / action 枚举；`wrapPublicUtterance` 未使用 | 补 `buildUserMessage` 的内容与契约（或正式交给 RFC-011 并补依赖 / AC）；修 `rules.ts` 的胜利条件与缺失规则 |
| **B4** | `speech` 超过 300 字被拒绝，不是截断 | 在 schema 前或 `toAction` 前截断；补 301 → 300 的测试；修正 D-6 / 注释 |
| **B5** | `CallMeta.phase` 写入 `'NIGHT'`（非 `Phase`）；`pending` 未使用 | 统一 `DecisionContext` 与 `ProjectedPhase` 的口径；删 `as`；补投影 → toAction 的用例 |
| **B6** | AC-5 的 network / 429 无用例；AC-1/2/13 的静态扫描跳过 `.tsx`；AC-13 扫描对引号敏感 | 补测试；source-scan 扩到 `.tsx`；needle 去引号；回填 TEST-STRATEGY |
| **B7** | `toAction` 在重投阶段接受 `abstain`，违反 RUL-2 | `abstain` 仅 `DAY_VOTE`；补重投用例 |

### 8. Improvement Suggestions（非阻塞）

1. 把 `metaLog` 设为必填，或在 `LlmError` 上挂 `meta`，保证失败调用也有 F20 数据；同时把 `APIConnectionTimeoutError` / `APIConnectionError` 映射成 `TIMEOUT` / `NETWORK`（现在会先命中 `OpenAI.APIError` 分支，被记成 `SERVER_ERROR`）。
2. 给 429 / 5xx 加退避与抖动；把 `new OpenAI` 提到 `decide` 外层复用。
3. 把 `LlmConfig.model` 收窄为 `'deepseek-flash' | 'deepseek-v4-pro'`，或在 `loadLlmConfig` 里校验 `LLM_MODEL`；把 `thinking` 如何生效写进 RFC 或测试（AI-9）。
4. 用 `satisfies z.ZodType<Claim>` / 类型级双向断言锁定 `claim` schema 与 `src/shared/events.ts` 的 `Claim`；给 `claim` 的 target 加 `min(1).max(9)`。
5. 修 `RULES_TEXT`：支持 `slaughter-all`；补 RUL-2 / RUL-7 / RUL-9 / 自曝 / 夜聊 / 女巫自救限制；用户消息中的身份名改走 `ROLE_LABELS`。
6. 更新 `TEST-STRATEGY.md` 的 RFC-006 小节：把已有的 `client.test.ts` / `to-action.test.ts` / `prompts.test.ts` / `llm-isolation.test.ts` 回填为 `existing`，把 AC-6 与 network / 429 标为缺失（或转移后更新），并修正测试文件名。
7. 同步 `FEATURES.md` F15 / F16 的 `claimedRole` 为 CR-003 C3 之后的嵌套 `claim`（这条需要 `/manage-changes`，不要在本轮代码提交里顺手改）；`README.md` 的 RFC 状态已在本轮评审同步。
8. 修正 `meta.ts` 的「落盘形态由 RFC-008 决定」表述；F20 的展示在 RFC-014，落盘归属应写成「本 RFC 不决定」或指向实际拥有者。

---

### 9. 结论与状态

**结论：Changes requested · Overall Risk Level: High。**

这不是「实现基本正确、只差一两个测试」的 RFC。客户端、schema、错误脱敏与 vote/speak/shoot 映射的主体是好的；但 **AC-6 这条 Must 没有被任何人拥有**、**`AI_THOUGHT` 这条跨 RFC 交接被静默丢掉**、**提示实际上没有把对局内容交给模型**、**`speech` 截断与 RFC 相反**、**`CallMeta.phase` 写入了非法值**——这些都不会因为「测试 438 全绿」而消失。

建议的下一步：

1. 由 `/implement-rfc 006` 按 B1–B7 修复，并在 §8.2 / §8.5 回写每一条的决定。
2. 若决定把 AC-6 / `AI_THOUGHT` / 提示内容交给后续 RFC，先走 `/manage-changes` 改 RFC-011 / RFC-007 / FEATURES / TEST-STRATEGY 的归属与依赖，再标 `Reviewed`。
3. 修完后重新跑本文件里的 M1–M15 探针（至少 B1–B7 对应的那些），并把结果写进 RFC-006 的 §8.4 / §8.5。

本次评审没有修改任何源码，没有 `git commit`；所有探针改动已恢复，工作树在评审结束时 clean。评审证据与探针见本文件 §2 / §3；Open conflicts 已登记到 `RFCS.md` §8.16（C-47 ~ C-53）。
