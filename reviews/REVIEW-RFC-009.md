# RFC-009 评审 · AI 人格与高级打法

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-19（Round 3；Round 1 / 2 同日，HEAD 分别为 `a9c340f` / `cdea69c`）
> **分支 / HEAD**：`main` / `0acb9ab`（Round 3；Round 2 为 `cdea69c`）
> **结论**：**Reviewed**（Round 3）
> **整体风险**：**Low**（Round 2 为 Medium，Round 1 为 High）

## Round 1 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

四条阻塞：

1. **C-77 · RFC-009 §4 的 `verbosity` 影响 `maxOutputTokens` 完全没有实现，也没有记录。** `src/server/llm/client.ts:124` 仍然使用固定的 `config.maxOutputTokens`，`src/server/llm/config.ts:24` 是全局 800；`src/server` 里没有任何地方读 `Persona.verbosity`。§8.2 的 D-1 ~ D-6、§8.6 的已知缺口都没有提到这条，属于未记录偏离。
2. **C-78 · F14 的“人格真的进了提示词”没有接线。** `personaOf` / `styleOf` 在生产代码里零消费者；`buildSystemPrompt` 接的是一个自由字符串（`base.ts:14-16`），当前没有任何调用方把 `state.seats[].personaId` 转成这个字符串。P-R4 把 `base.ts:31` 的人格文本整个换成常量后，`personas.test.ts` + `prompts.test.ts` 仍然 **22/22 全绿**。D-6 声称“本 RFC 能保证的是提示里会被要求用不同风格”，这条不成立。
3. **C-79 · START 之后的整条人格链没有测试。** P-R1 把 `step.ts:129` 的 `GAME_STARTED.personas` 全部改成 `null`，`--project unit` 仍然 **56 files / 485 tests 全绿**（含 `personas.test.ts`、`replay-parity.test.ts`、`events.test.ts`、`replay.test.ts`）。AC-1 / 2 / 5 / 11 的证据全部只测 `createInitialState` 的 `LOBBY` 状态；实际开局后人格是否还在、是否进事件、是否过 replay，全都未锁。
4. **C-80 · AC-5 / AC-9 / AC-10 的测试缺失或与 AC 不符，§8.4 的 PASS 证据不成立。** AC-5 只断言 `personaOf('blunt').label` 为真；P-R9 把所有人格 label 都改成 `'X'` 后仍 9/9 绿。AC-9 的测试是手工拼的 `EventEnvelope[]`，没有固定种子、没有 `step`，计划中的 `tests/engine/scenarios/advanced-play.test.ts` 根本不存在。AC-10 没有任何“改变人格后 action 合法性不变”的测试；`prompts.test.ts` 只检查提示里出现“性格设定”和“不要因性格违反规则”两句话，§8.4 却把它写成 AC-10 的证据。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `a9c340f`，评审开始时工作树 clean。

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
✓ built in 64ms
vite v8.3.8 building ssr environment for production...
✓ 39 modules transformed.
dist/server/index.js  85.00 kB │ gzip: 28.66 kB
✓ built in 15ms
BUILD_EXIT=0

$ pnpm test
 Test Files  63 passed (63)
      Tests  519 passed (519)
TEST_EXIT=0
```

覆盖率来自 `tests/meta/coverage.test.ts` 生成的 `coverage/coverage-summary.json`：

```
lines: 97.12% (540/556)   branches: 92.95% (356/383)
```

`pnpm test:e2e` 未跑：本 RFC 没有 UI 改动，`TEST-6` 的 Playwright 门禁从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`tests/meta/selfplay-placeholder.test.ts` 断言以退出码 1 结束），与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、事件流、确定性、AI 可见性与安全、纯函数与测试证据检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright，因为本 RFC 不改 `src/client/`、不新增 HTTP 端点。Security 维度仍检查了新增的服务端数据面（`GAME_STARTED`、投影、提示词）。

**探针后的复跑**：所有变异探针从 `/tmp/howl-r9-backup/` 的文件备份恢复（**没有使用 `git checkout`**），五个恢复点与备份 `md5` 逐一相同；`git status --porcelain` 为空；恢复后全量 `pnpm test` 复跑 **63 files / 519 tests 全绿**。没有 `git commit`。

---

### 1. 用户要求核对的三处实现选择

#### 1.1 ① 人格在 `createInitialState` 里分配（发牌之后、用发牌后的 rng），写入 `GAME_STARTED.personas`，玩家席位没有人格

**结论：与 RFC §2.1 / §4 的分配要求一致；代码路径正确，但测试只覆盖了 LOBBY，START 之后是否还成立没有锁。另有一条同属 §4 的 `verbosity` 要求完全缺失（C-77）。**

- `src/engine/init.ts:37-38` 先 `dealRoles`，再用 `dealt.rng` 调 `assignPersonas`；`init.ts:47-58` 跳过 `playerSeat`，给其余 8 席写 `personaId`；`init.ts:67` 把分配后的 rng 写回状态。这与 RFC §4「发牌之后、同一个 rng 的后续序列」一致。
- `src/engine/step.ts:116-131` 在 `GAME_STARTED` 里写 `personas: state.seats.map((seat) => seat.personaId ?? null)`；`src/engine/apply.ts:279-281` 在 replay 时按 payload 恢复 `personaId`。实际用 `seed=12345 / playerSeat=3` 跑 `step` 得到：
  - `GAME_STARTED.payload.personas` = 8 个真实 id + 玩家位 `null`；
  - `started.state.seats` 与事件逐位相同，玩家席位没有 `personaId`；
  - `GAME_STARTED.rngAfter` 与 `started.state.rng` 相同。
- 与 RFC 的差距不在分配本身，而在：
  - **测试**：`tests/engine/personas.test.ts:15-22` 的 `aiSeatsOf` 只调 `lobbyState`，所有 AC-1 / 2 / 11 的断言都停在 `createInitialState`。P-R1 证明把 `GAME_STARTED.personas` 全部清空后 56/485 仍绿。见 C-79。
  - **`verbosity` → `maxOutputTokens`**：RFC §4 的第三条要求没有实现，也没有记录。见 C-77。
  - **`applyGameStarted` 不校验人格不变量**：`apply.ts:279-281` 只判断 `typeof personaId === 'string'`，不检查玩家位必须为 `null`、AI 位必须非空；正常流由 `createInitialState` 保证，但 replay 一条被篡改的 `GAME_STARTED` 可以给玩家一个人格、或让某个 AI 没有人格。当前没有测试覆盖，属低风险健壮性问题，见 §7.2。

#### 1.2 ② `annotate` 需要调用方传 `speakerOf(event)`，不从 `visibleTo` 反解席位

**结论：代码与 D-3 一致；但 D-3 这条关键性质没有被任何测试锁住，而且测试自己的 `speakerOf` 正是用 `visibleTo` 反解的。**

- `src/engine/annotate.ts:56-68` 把 `speakerOf` 定为必填输入；`:90-91` 只使用它，函数体没有任何 `event.visibleTo` 读取；`SELF_EXPOSE` 走 payload 的 `seat`（`:81-84`）。grep 确认 `annotate.ts` 没有 `visibleTo`。
- 但 `tests/engine/annotate.test.ts:35-38` 的测试用回调：
  ```ts
  const match = /^self:(\d)$/.exec(String(event.visibleTo));
  ```
  也就是说，测试只是把“从 `visibleTo` 反解”这件事从生产代码挪到了调用方，并没有证明“调用方确实知道席位、且与 `visibleTo` 不同也能工作”。
- P-R6 把 `annotate.ts:90` 改成优先从 `visibleTo` 解析，`annotate.test.ts` 仍然 **8/8 全绿**。D-3 的防回归价值目前只存在于代码阅读，不存在于测试。见 C-82。
- 另：`speakerOf` 返回 `undefined` 时 `annotate` 静默 `continue`（`:91`），会无声丢掉标注；结合 D-3 的“调用方本来就知道”，更安全的做法是要求映射完整、或至少在测试里覆盖“映射缺失”的行为。

#### 1.3 ③ AC-4 用「风格画像」代替「平均句长」，AC-3 用统计界代替完整卡方检验

**结论：两条偏离确实记录在 §8.2 D-5 / D-6；但 D-6 的实现不只“换指标”，而是**没有接到提示词**；D-5 的界是单边的，和 AC 的卡方检验不等价，且 §8.2 的“够敏感”判断不成立。**

- **AC-4 / D-6**：`src/engine/personas.ts:80-87` 的 `styleOf` 返回 `{ targetSentences: verbosity, aggression }`，但 `grep` 显示它只有测试消费者；`personaOf` 也没有生产消费者；`buildSystemPrompt` 接自由字符串，没有任何代码把 `personaId` 转成风格文本。P-R4 把人格文本换成固定常量，`personas.test.ts` + `prompts.test.ts` **22/22 绿**。因此 D-6 说的“本 RFC 能保证提示里会被要求用不同风格”并不成立；AC-4 的替代测试只检查 12 个人格的静态组合数（`personas.test.ts:90-99`），既不检查同一局内的分配，也不检查提示内容。它甚至没有把“阈值”写成测试常量（AC 要求“阈值写在测试常量中”，当前是直接 `>=3`）。
- **AC-3 / D-5**：`personas.test.ts:65-87` 是单边界 `wolf < good + 1`。P-R12 在 `createInitialState` 里让 `blunt` 永不出现在狼位：`blunt` 得到 **0 狼 / 127 好**，AC-3 测试 **9/9 全绿**；同一份 200 局交叉表的 12×2 卡方为 **88.87**，`df=11`、`p=0.01` 的临界值是 **24.725**，按 AC 原文会被拒绝。P-R11 的温和角色偏置（1/3 种子交换一个 favored/unfavored 人格）也全绿：卡方 **29.67 > 24.725**。所以 D-5 的界不是“够敏感”的近似，而是只能抓“狼数超过好数”的极端上偏，抓不到“某人格永不当狼”这种完全反相关，也抓不到分布式的中等偏置。
- D-5 还写了“200 局样本下”，而 AC-3 原文是 **1000 局**；这是另一个记录过的偏离。建议直接把卡方实现出来（临界值 24.725 是常量，不需要正态分位表），或把界改成双侧并补 1000 局；至少要把 §8.2 的“够敏感”改成如实的局限说明。见 C-83。

---

### 2. 逐条验收标准：哪个测试会红

> 判定标准按 `RULES TEST-1`：如果行为退化，测试必须失败。``P-R*`` 是本轮实际注入的探针（§6）。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `tests/engine/personas.test.ts:20-46`：200 个种子的 `lobbyState`，AI 席 8 人、玩家无 `personaId`；`step.ts:129` 与 `apply.ts:279-281` 是实际事件/replay 路径 | P-R2（玩家有人格）红；但 P-R1（`GAME_STARTED.personas` 全 null）全绿，且没有测试从 `step` 后的状态断言“整局不变” | **PARTIAL** |
| 2 | 同上：`new Set(ids).size === 8` | P-R3（全用第 0 个人格）红 | **PARTIAL**（只锁 LOBBY；P-R1 下游戏内根本没有 id） |
| 3 | `personas.test.ts:65-87`：200 局、每格 `wolf < good + 1` | P-R12（某人格永不当狼）绿；P-R11（中等角色偏置）绿；卡方均超过 24.725 | **PARTIAL（按 D-5 记录，但与 AC 原文不等价）** |
| 4 | `personas.test.ts:90-99`：12 个人格的静态风格组合 ≥3；`styleOf` 无生产消费者 | P-R4（提示文本整个丢掉）绿；没有同局内比较、没有阈值常量 | **FAIL** |
| 5 | `personas.test.ts:102-106`：`personaOf('blunt').label` 为真 | P-R9（所有 label 改成 `'X'`）绿；没有 replay 数据 / 席位映射 | **FAIL** |
| 6 | `tests/engine/annotate.test.ts:44-62`：狼 + 声称 seer + 至少一条查验 → 真；缺查验 / 好人 → 假 | 改坏 `isFakeSeerClaim` 会红 | **PASS** |
| 7 | `annotate.test.ts:64-87`：狼→狼真、狼→好人假、好人→狼假 | 改坏 `roleOf` 条件会红；自指认狼反例未覆盖（C-81） | **PASS**（AC 列出的三种情况） |
| 8 | `annotate.test.ts:104-123`：同一组事件抹掉 `SPEECH.text` 后结果相等 | P-R5a（读 SPEECH 文本）红；P-R5b（读 `AI_THOUGHT.reason`）绿 | **PASS（speech）/ 见 C-82 的 reason 缺口** |
| 9 | `annotate.test.ts:124-175`：手工拼 3 条悍跳、3 条狼查杀狼、3 条 `SELF_EXPOSE` | 没有 `step`、没有种子、没有状态推进；计划中的 `tests/engine/scenarios/advanced-play.test.ts` 不存在 | **FAIL** |
| 10 | 无测试；`tests/server/llm/prompts.test.ts:70-87` 只断言提示里出现“性格设定”和“不要因性格违反规则” | 没有任何“改变人格后 action 合法性不变”的断言；§8.4 的引用不成立 | **FAIL** |
| 11 | `personas.test.ts:49-63`：同 seed 两次 `lobbyState` 映射相同、不同 seed 不同 | 同 seed 可复现成立；P-R1 下事件路径仍会全 null，测试不红 | **PARTIAL** |

统计：**PASS 3（6 / 7 / 8）**，**PARTIAL 4（1 / 2 / 3 / 11）**，**FAIL 4（4 / 5 / 9 / 10）**。AC-4 / 5 / 9 / 10 没有可失败的行为回归锁，违反 `RULES TEST-1`。

---

### 3. 阻塞发现

#### C-77（阻塞）· §4 的 `verbosity` → `maxOutputTokens` 未实现、未记录

RFC-009 §4（`RFCs/RFC-009-ai-personas-and-advanced-play.md:80`）明确写：

> 人格的 `verbosity` 影响 `maxOutputTokens`，不改变超时阈值。

实际：

- `src/server/llm/client.ts:124` 是 `max_tokens: config.maxOutputTokens`；
- `src/server/llm/config.ts:24,55` 把 `maxOutputTokens` 固定为 800，环境变量只影响 timeout / retries；
- `DecideInput`（`client.ts:48-55`）只有 `persona?: string | null`，没有 verbosity；
- `grep -rn "verbosity" src` 只命中 `src/engine/personas.ts`，服务端零引用；
- `RFCs/RFC-009...` 的 §8.2（D-1 ~ D-6）与 §8.6 都没有记录这条偏离。

这是未记录的功能缺口，且与 D-6 的核心目的（“让 8 个 AI 不再是 8 个复读机”）直接相关：没有这一条，连“长人格输出更长”都无法保证。需要把 `Persona`（或其 `verbosity`）传到 `decide`，按档位计算 `max_tokens`，并保持 `timeoutMs` 不变；补一条用假 `fetch` 捕获请求体、断言 verbosity 1 / 2 / 3 对应不同 `max_tokens` 的测试。若决定不做，必须在 §8.2 记录理由和用户同意（`DOC-1`）。

#### C-78（阻塞）· 人格没有接到提示词，D-6 的替代实现不成立

RFC-009 §2.1 说“人格进入提示的方式：作为风格约束段注入”；D-6 说“本 RFC 能保证的是提示里会被要求用不同风格”。实际：

- `src/engine/personas.ts:72-87` 的 `personaOf` / `styleOf` 只有 `tests/engine/personas.test.ts` 在用；`grep -rn "personaOf\|styleOf" src` 在生产代码里零命中。
- `src/server/llm/prompts/base.ts:14-16` 的 `buildSystemPrompt` 接收一个自由字符串；`src/server/llm/client.ts:98` 把它透传；`src/server/llm/client.ts:48-55` 的 `DecideInput.persona` 没有任何生产调用方（`grep -rn "decide(" src` 为零）。
- `src/server/project/index.ts:81` 只把 `self.personaId` 放进投影；没有任何代码把 `personaId` 转成 `buildSystemPrompt` 需要的字符串，也没有代码使用 `verbosity/tone/aggression/quirk` 的任何一个。
- P-R4 把 `base.ts:31` 的人格插值替换成常量后，`personas.test.ts` + `prompts.test.ts` **22/22 全绿**——测试证明不了人格真的进了提示。
- `tests/server/llm/prompts.test.ts:73-76` 用的 `'直来直去（说话短、指认强）'` 是手写字符串，不是从 `Persona` 生成的；它只证明“传什么就回显什么”。

最低要求：在 RFC-009 内提供一个从 `personaId` 到风格段文本的单一转换（例如 `personaPromptOf(id)`，或让 `buildSystemPrompt` 接收 `Persona`），并让测试对 12 个人格逐一生成的提示做断言（至少断言 `tone/verbosity/aggression/quirk` 中至少一项随人格变化）；RFC-011 的编排层再接上。若要把编排层完全留给 RFC-011，必须在 §8.2 / §8.6 记录，并把 AC-4 从 PASS 改成“未验收”。

#### C-79（阻塞）· START 之后的整条人格链没有测试

P-R1 的注入只改 `src/engine/step.ts:129`：

```ts
personas: state.seats.map(() => null),
```

结果：

```
$ pnpm exec vitest run --project unit tests/engine/personas.test.ts \
    tests/engine/replay-parity.test.ts tests/engine/events.test.ts tests/engine/replay.test.ts
 Test Files  4 passed (4)
      Tests  49 passed (49)

$ pnpm exec vitest run --project unit
 Test Files  56 passed (56)
      Tests  485 passed (485)
```

这证明：整个产品路径上的人格可以在 `GAME_STARTED` 处被清空，而 519 条测试里的 485 条 unit 测试不发现。具体缺口：

- `tests/engine/events.test.ts:226-240` 的 `GAME_STARTED` payload 断言只检查 `seed/mode/playerSeat/roles`，完全不提 `personas`；
- `tests/engine/replay.test.ts:172-195` 用合成的 `p-alpha` / `p-beta` 验证 replay 会读 payload，但合成值不是 `createInitialState` 的产物，也不证明 `step` 真的写入了；
- `tests/engine/personas.test.ts` 的 `aiSeatsOf` 只调 `lobbyState`，没有 `step` / `startedState`；
- AC-1 的“整局中同一席位的人格 id 不发生变化”没有一条“开局 → 若干 action → 人格仍相同”的用例；AC-5 的标签到席位一一对应也没有 replay 后的断言。

需要补一条（或一组）测试：`lobbyState(seed)` → `step(START)` → 断言 `GAME_STARTED.payload.personas` 与 `lobby.seats` 逐位一致（8 个真实 id、玩家位 null）→ 断言 `started.state.seats` 同样 → 跑若干 action（至少跨一个死亡 / 投票）→ 再断言人格 id 未变 → `replay(events)` 后仍相同。这一条测试会同时锁住 AC-1 / 2 / 11 的事件路径，并让 P-R1 变红。

#### C-80（阻塞）· AC-5 / AC-9 / AC-10 的测试缺失或与 AC 不符

- **AC-5**：`tests/engine/personas.test.ts:102-106` 只断言 `personaOf('blunt').label` 为真、未知 id 抛错。P-R9 让 `personaOf` 对每个人格都返回 `{ ...found, label: 'X' }`，**9/9 全绿**。没有测试构造“replay 后的 seats → `personaOf(personaId).label` → 与席位一一对应”；`replay.test.ts` 用的 `p-alpha` 也不是合法人格 id。
- **AC-9**：`tests/engine/annotate.test.ts:124-175` 手工拼 `EventEnvelope[]`，没有固定种子、没有 `stateWithRoles` 之外的预设状态、没有 `step`。它证明的是“标注函数对给定的三条事件能计数”，不是 AC-9 的“定向对局（固定种子 + 预设状态）中三类各稳定触发 ≥3 次”。`TEST-STRATEGY.md:295` 计划的 `tests/engine/scenarios/advanced-play.test.ts` 在仓库中不存在（`find tests -name '*advanced*'` 无结果）。
- **AC-10**：没有任何测试在“同一状态、不同人格”下比较 `action` 的合法性；`tests/server/llm/prompts.test.ts:70-87` 只检查提示文本。`toAction` 确实没有 persona 参数（这是好事，结构上人格无法直接影响 legality），但 `TEST-1` 要的是可失败的行为测试；可以构造同一 `state` 下两个不同 `personaId` 的席位提交同一条非法 action，断言两者都得到相同的 `Rejected` / 相同 state 变化。RFC §8.4 把 `prompts.test.ts` 写成 AC-10 证据是**不准确的记录**。

三项都需要补测试或改 §8.4；AC-9 的 scenario 文件应补上，或者把 AC-9 改写成纯函数级并记录（那要走 `/manage-changes`，不能只改 Notes）。

---

### 4. 非阻塞发现

#### C-81 · `isWolfAccusesWolf` 把“狼指认自己”算成狼查杀狼

`src/engine/annotate.ts:43-53` 的输入没有 `speakerSeat`，只判断 `roleOf(accusation.target) === 'wolf'`；RFC §2.3 的条件是“存在 `{ target: 另一名狼, as: 'wolf' }`”。实测：

```
$ pnpm exec tsx -e "import { isWolfAccusesWolf } from './src/engine/annotate.ts'; ..."
self-accusation => true
```

当 `speakerRole = 'wolf'`、`claim.accuses = [{ target: 1, as: 'wolf' }]`、`roleOf(1) = 'wolf'` 时返回 `true`，但 1 号就是发言者自己，不是“另一名狼”。当前测试矩阵没有这个反例。修法：给 `isWolfAccusesWolf` / `annotate` 传 `speakerSeat`，排除 `target === speakerSeat`；补一条负向用例。

#### C-82 · D-3 的 `speakerOf` 性质没有被测试锁住

P-R6 把 `annotate.ts:90` 改成：

```ts
const visible = event.visibleTo as string;
const speaker = visible.startsWith('self:')
  ? Number(visible.slice(5)) as SeatId
  : speakerOf(event);
```

`annotate.test.ts` 仍然 **8/8 全绿**。这不是当前实现的 bug（当前实现确实没读 `visibleTo`），而是 D-3 的防回归锁缺失。建议补一条“`visibleTo` 指向座位 A、`speakerOf` 返回座位 B”的测试，断言标注落在 B；同时覆盖 `speakerOf` 返回 `undefined` 时是静默跳过还是抛错。

另外，`annotateWithoutText` 只抹 `SPEECH.text` / `WOLF_CHAT_POSTED.text`（`annotate.ts:105-114`），不抹 `AI_THOUGHT.reason`。P-R5b 让 `reason.includes('预言家')` 覆盖 `claim`，`annotate.test.ts` **8/8 绿**。AC-8 的字面对象是 `speech`，所以这不直接违反 AC-8；但 RFC §2.3 的“判定不得使用自然语言匹配”是更宽的要求，建议把 `reason` 也纳入“抹文本”测试，或至少把 `annotateWithoutText` 的注释改成只覆盖 `speech`。

#### C-83 · D-5 的统计界与 AC-3 的卡方不等价

见 §1.3。两条实跑证据：

- P-R12（`blunt` 永不当狼）：`blunt` **0 狼 / 127 好**，`personas.test.ts` 9/9 绿；12×2 卡方 **88.87**，`df=11` 临界值 **24.725**。
- P-R11（1/3 种子交换一个 favored/unfavored 人格）：`personas.test.ts` 9/9 绿；卡方 **29.67 > 24.725**。

D-5 已记录，所以按“recorded deviation 不自动算缺陷”处理；但“这种界对……够敏感”的判断不成立，应改成如实的局限说明，并建议：

- 要么实现 12×2 卡方（`24.725` 是 `df=11, p=0.01` 的常量），保留 200 或按 AC 用 1000 局；
- 要么把界改成双侧（`wolf` 既不能过大也不能过小），并至少把样本量提到 1000。

#### C-84 · 文档漂移与 Implementation Notes 的过度声明

- `TEST-STRATEGY.md:290-296` 的 RFC-009 行仍然全部是 `proposed`；AC-5 指向 `annotate.test.ts`（实际在 `personas.test.ts`）；AC-9 指向不存在的 `tests/engine/scenarios/advanced-play.test.ts`；AC-10 指向 `personas.test.ts`（实际没有）；AC-3 仍写 1000 局。`TEST-STRATEGY.md:38` 还说“其余 15 个 RFC 仍为 `proposed`”，而 RFC-009 已经实现。
- `README.md:11` 仍写“八个 RFC 已合入 main（001–008）”“7 个 Reviewed、8 个 Not started”；`README.md:36-38` 仍写“RFC-008 Implemented，等待评审 / 下一步 /review-rfc 008”，而 `RFCS.md` 已把 RFC-008 标为 Reviewed、RFC-009 标为 Implemented。
- `RFCS.md:3` 的版本头在评审前仍是 `v2.65`（本轮评审已更新为 `v2.67`），而 `:537` 已加了 v2.66 changelog。
- RFC §8.3 说“文档：本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md`”，实际只改了 `TEST-STRATEGY.md` 的用例数（500→519）和 `README.md` 的用例数，没有回填 `Exists?`、没有补 scenario 文件、没有同步状态行。
- RFC §8.4 的 AC-1 证据说“200 个种子的 AI 席位人格数恒为 8”，这只覆盖 LOBBY；AC-5 / AC-10 的证据与测试内容不符（见 C-80）。这些是记录准确性问题，和上面的测试缺口一起修。
- `DOC-1` 要求偏离写清“用户是否同意”；§8.2 的 D-2 ~ D-6 只有“决定 / 为什么”，没有“用户是否同意”列（§8.1 只记录了分配方式的选择）。D-5 / D-6 在本轮用户消息里被点名，可视作用户已知情；但文档仍应补上同意状态，避免后来的人把“已记录”误读成“已批准”。

---

### 5. 五个审查维度

#### 5.1 RFC ADHERENCE — NEEDS WORK

匹配的部分：

- D-1 / D-2：人格在 `createInitialState` 里发牌后分配、用发牌后的 rng、玩家无 `personaId`、`GAME_STARTED.personas` 进事件流、replay 可重建——代码与 RFC §2.1 / §4 一致。
- D-3：`annotate` 只接收调用方的 `speakerOf`，函数体不读 `visibleTo`，与记录一致。
- §2.3 的结构化判定：悍跳、狼查杀狼、自曝都只读 `claim` / `SELF_EXPOSE`，不读文本；AC-6 / 7 / 8 的核心矩阵通过。
- AC-1 / 2 / 11 的 LOBBY 部分通过；AC-3 按 D-5 的记录通过其替代判据。

缺口：

- §4 的 `verbosity` → `maxOutputTokens` 缺失且未记录（C-77）。
- 人格没有接到提示词，D-6 的“提示里会被要求用不同风格”不成立（C-78）。
- START 之后的整条链没有测试，AC-1 / 2 / 5 / 11 的 PASS 是对 LOBBY 的过度概括（C-79）。
- AC-4 / 5 / 9 / 10 缺少可失败测试（C-80）。
- AC-3 的替代界与 AC 原文不等价（C-83，按已记录偏离处理，但论据需要修正）。

#### 5.2 RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `TEST-1` | **FAIL**：AC-4 / 5 / 9 / 10 没有对应的自动化测试或“为何不可自动化”的说明；AC-1 / 2 / 11 的证据只覆盖 LOBBY。 |
| `DOC-1` | **FAIL（记录层面）**：`verbosity` 偏离未记录；D-2 ~ D-6 没有“用户是否同意”；§8.4 的若干 PASS 与测试内容不符。 |
| `ARCH-1` | **PASS**：`personas.ts` / `annotate.ts` 只 import `@shared/*` 与 `./rng`；`tests/dependency-direction` 通过。 |
| `ARCH-3` | **PASS**：状态只存字符串 `personaId`，不存 `Persona` 对象；`PERSONAS` 是纯对象常量。 |
| `ARCH-8` | **PASS（承接）**：投影未改，仍纯函数。 |
| `DATA-2` / `DATA-4` | **PASS**：事件类型走 `GAME_STARTED` 联合成员；人格用 `nextInt` 的注入式 rng，没有 `Math.random`。 |
| `AI-4` / `AI-5` / `AI-6` | **PASS**：`claim` 走 `DecisionSchema`；`annotate` 不读 `reasoning_content`；提示在 `prompts/base.ts`。 |
| `STYLE-6` | **PASS**：`src/engine/personas.ts` 87 行、`annotate.ts` 114 行，远小于 400。 |
| `STYLE-3` / `STYLE-5` | **PASS**：无 `any`、具名导出；测试里的 `as unknown as EventEnvelope` 是窄化，不是 `any`。 |

#### 5.3 SECURITY — PASS

- 新增的 `GAME_STARTED.personas` 是 `visibleTo: 'server'`，不进入客户端投影（`SEC-5` 未被破坏）；`project()` 只把观察者自己的 `personaId` 放进 `self`。
- `annotate` 是服务端纯派生函数，不暴露 HTTP；`isWolfAccusesWolf` 不读取模型文本；没有新的注入面。
- 人格库是固定常量，`buildSystemPrompt` 输入的人格字符串在正常路径上来自受控库；`DecideInput.persona` 目前没有生产调用方，未来由 RFC-011 接入时应确保不直接传玩家输入。
- 未发现密钥 / 日志 / 错误响应泄漏；无新增依赖。

#### 5.4 PERFORMANCE — PASS

- `assignPersonas` 每局 8 次 `nextInt`，`personaOf` 线性扫 12 项，`styleOf` 只是字段读取；无可测开销。
- `annotate` 是 `events × seats`（本游戏 9 席）的纯循环；`annotateWithoutText` 只在测试使用。
- 没有新增网络 / DB / LLM 调用；`verbosity` 若接上会改 `max_tokens`，但那是请求参数，不是新的调用轮次。

#### 5.5 MAINTAINABILITY — NEEDS WORK

- `styleOf` 与 `annotateWithoutText` 是生产模块里的“只有测试在用”的导出；`styleOf` 尤其像为 AC-4 临时造的指标，没有接到产品路径。可以接受作为 RFC-014 / RFC-011 的预留，但需要注释说明，并避免让测试误以为功能已接通。
- `annotate` 收 `EventEnvelope[]`（payload `unknown`）再用 `as` 取 `claim` / `seat`；如果改成 `GameEvent[]`，`event.type` 的判别联合能直接窄化 payload，消除这些 cast，也更符合 `DATA-2` 的类型纪律。
- `isWolfAccusesWolf` 缺少 `speakerSeat` 参数，既有 C-81 的边界 bug，也让函数无法表达“另一名狼”的完整条件。
- `applyGameStarted` 不校验“玩家位 null、AI 位非空”的不变量；正常流由 `createInitialState` 保证，但 replay 的输入校验可以更严。
- `README` / `TEST-STRATEGY` / `RFCS` 的版本和状态漂移见 C-84。

---

### 6. 变异探针与恢复

所有注入都用精确字符串替换，并先断言目标出现次数为 1；每个探针结束后从 `/tmp/howl-r9-backup/` 的原始文件 `cp` 回来（**没有使用 `git checkout`**）。备份文件：

```
src/engine/step.ts
src/engine/init.ts
src/engine/annotate.ts
src/engine/personas.ts
src/server/llm/prompts/base.ts
```

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P-R1 | `step.ts:129` 的 `personas` 改为全 `null` | `personas / replay-parity / events / replay`，再全 `--project unit` | 4 files / 49 tests 绿；56 files / 485 tests 绿 | **缺口**：START 之后的人格可以整体消失而不被发现（C-79） |
| P-R2 | `init.ts:49` 给玩家席位加 `personaId: 'blunt'` | `personas.test.ts` | 1 failed / 8 passed（`expected 'blunt' to be undefined`） | 正向控制：玩家无人格在 LOBBY 有锁 |
| P-R3 | `init.ts:52` 所有 AI 都用 `assigned.personas[0]` | `personas.test.ts` | 1 failed / 8 passed（`Set.size` 1 vs 8） | 正向控制：LOBBY 唯一性有锁 |
| P-R4 | `base.ts:31` 的人格插值换成常量 `'你的性格设定：说话简短'` | `personas.test.ts` + `prompts.test.ts` | 2 files / 22 tests 绿 | **缺口**：提示内容不受人格影响也能全绿（C-78） |
| P-R5a | `annotate.ts` 在 `SPEECH.text` 含“预言家”时直接推一条悍跳 | `annotate.test.ts` | 1 failed / 7 passed | 正向控制：AC-8 能抓 SPEECH 文本匹配 |
| P-R5b | `annotate.ts` 用 `AI_THOUGHT.reason` 含“预言家”覆盖 `claim` | `annotate.test.ts` | 8/8 绿 | **缺口**：`reason` 文本匹配不受锁（C-82） |
| P-R6 | `annotate.ts:90` 优先从 `visibleTo` 解析 speaker | `annotate.test.ts` | 8/8 绿 | **缺口**：D-3 的 `speakerOf` 性质没有测试（C-82） |
| P-R7 | 直接调用 `isWolfAccusesWolf` 自指认 | `tsx` | `self-accusation => true` | 边界 bug（C-81） |
| P-R11 | `init.ts` 在 1/3 种子上交换 favored/unfavored 人格（制造角色偏置） | `personas.test.ts` + 交叉表脚本 | 9/9 绿；卡方 **29.67** > 24.725 | **缺口**：D-5 界放过卡方拒绝的偏置（C-83） |
| P-R12 | `init.ts` 让 `blunt` 永不出现在狼位 | `personas.test.ts` + 交叉表脚本 | 9/9 绿；`blunt` 0 狼 / 127 好；卡方 **88.87** > 24.725 | **缺口**：单边界的逻辑漏洞（C-83） |
| P-R9 | `personaOf` 返回 `{ ...found, label: 'X' }` | `personas.test.ts` | 9/9 绿 | **缺口**：AC-5 标签映射没有锁（C-80） |
| T-R1 | `grep` 生产代码的 `personaOf` / `styleOf` / `verbosity` / `decide(` | — | 只有测试使用 `personaOf` / `styleOf`；`verbosity` 只出现在 `personas.ts`；`decide` 无生产调用方 | C-77 / C-78 的静态证据 |
| T-R2 | `git status` / `md5` / 恢复后全量 `pnpm test` | — | 五个文件 md5 与备份一致；工作树 clean；**63 files / 519 tests 绿** | 恢复与门禁证据 |

**恢复校验**：

```
md5 src/engine/step.ts src/engine/init.ts src/engine/annotate.ts \
    src/engine/personas.ts src/server/llm/prompts/base.ts
# 与 /tmp/howl-r9-backup/ 下同名文件逐项相同
git status --porcelain
# （空）
pnpm test
# Test Files  63 passed (63)
# Tests       519 passed (519)
```

没有 `git commit`；没有使用 `git checkout`。

---

### 7. 其他观察（非阻塞）

#### 7.1 实际行为抽查

正常代码下用 `seed=12345 / playerSeat=3` 跑 `createInitialState` → `step(START)`：

- `GAME_STARTED.payload.personas` 有 8 个真实 id，玩家位 `null`；
- `started.state.seats` 与事件逐位一致；
- `GAME_STARTED.rngAfter` 与 `started.state.rng` 相同；
- 8 个 id 互不重复，均来自 `PERSONAS`。

这说明 ① 的正常路径是对的；问题在测试没有锁住它（C-79），以及 §4 的另一条 `verbosity` 没做（C-77）。

#### 7.2 `applyGameStarted` 的人格不变量

`src/engine/apply.ts:279-281` 只做 `typeof personaId === 'string'`。给玩家位写字符串会得到玩家人格；给 AI 位写 `null` 会得到无人格的 AI。正常 `step` 不会产生这种 payload，但 `replay` 接受任意事件流；建议在 `applyGameStarted` 里校验“玩家位必须为 null、其余位必须为非空字符串”，或至少在 `replay.test.ts` 里加两条负向用例。低风险，不影响当前验收。

#### 7.3 `claim.accuses[].target` 的范围

`src/server/llm/schema.ts` 的 `claim.accuses[].target` / `claim.checks[].target` 是 `z.number().int()`，没有 `min(1).max(9)`。RFC-009 §2.2 的 `Claim` 目标类型是 `SeatId`；超范围 target 不会崩溃（`roleOf` 返回 `unknown`，判定为 false），但会静默产生错误的“不是狼查杀狼”。这是 RFC-006 的 schema 遗留，RFC-009 §3 把 `schema.ts` 列为交付物，可以顺手收紧并补 0 / 10 的拒绝用例。非阻塞。

#### 7.4 人工检查

`TEST-STRATEGY.md:298` 要求“连看 3 局，确认 8 个 AI 的发言能被人类一眼区分出至少 4 种语气”，但本 RFC 没有 UI / 编排层，当前无法执行；接入 RFC-011 / RFC-012 后再做，并在 RFC-014 的快照里用 `persona.label` 验证。非阻塞，但不要把它当成已完成。

---

### 8. 结论

- **Overall Risk Level: High**
- **Summary**：三处实现选择的代码路径基本按 RFC / D-1 / D-2 / D-3 落地（人格分配在发牌后、`GAME_STARTED.personas` 可 replay、玩家无人格；`annotate` 不读 `visibleTo`；三类打法只读结构化字段），但 F14 的可见效果没有接到提示词，RFC §4 的 `verbosity` 规则缺失，START 之后的整条链没有测试，AC-4 / 5 / 9 / 10 的 PASS 证据不成立。按 `RULES TEST-1` / `DOC-1`，这不是“补几条测试”的小问题：当前 519 条全绿并不能证明人格功能在真实对局里存在。
- **Blocking Issues**：**C-77 / C-78 / C-79 / C-80**（见 §3）。
- **Improvement Suggestions**：**C-81 / C-82 / C-83 / C-84**（见 §4），以及 7.2 / 7.3 的健壮性收口。
- **Open conflicts**：本轮没有发现新的“两个 artifact 互相矛盾”的冲突；D-5 / D-6 是 RFC 自带的记录偏离，证据与修正建议已登记到 `RFCS.md` §8.28。
- **建议状态**：`Changes requested`。修复 C-77 ~ C-80 并补上述回归测试后，再开 Round 2 复核；Round 2 应至少重跑 P-R1、P-R4、P-R12 与新增的 `START` / scenario 用例。

---

## Round 2 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: Medium**

本轮只复核 Round 1 登记、实现会话声称已修的八项（C-77 ~ C-84）；Round 1 之前已经关闭的项没有重查。评审时 HEAD `cdea69c`（修复提交），工作树 clean。

**结果摘要**：C-78 / C-81 / C-82 / C-83 是真修好，探针会红；C-77 的实现有了，但**没有任何测试**；C-79 / C-80 只修了 Round 1 要求的一部分；C-84 的文档仍然漂移。因此 RFC-009 的 Status 保持 **Changes requested**。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。以下命令在**全部探针恢复之后**运行：

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build（client 14 modules / server 39 modules）
BUILD_EXIT=0

$ pnpm test
 Test Files  65 passed (65)
      Tests  528 passed (528)
TEST_EXIT=0
```

引擎覆盖率（`coverage/coverage-summary.json`）：**lines 96.96% / branches 92.80%**，过 `TEST-2`。注意 RFC §8.5 仍写 `97.12% / 92.95%`，见 C-84。

`pnpm test:e2e` 未跑：本 RFC 没有 UI 改动，`TEST-6` 的 Playwright 门禁从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`tests/meta/selfplay-placeholder.test.ts`）。

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查游戏状态、事件流、确定性、AI 可见性与测试证据；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright，因为本 RFC 不改 `src/client/`、不新增 HTTP 端点。Security 维度仍检查了人格提示与 `GAME_STARTED` 的新增数据面。

### 1. 八项逐条复核

| # | Round 1 的问题 | Round 2 结论 | 证据 |
|---|---|---|---|
| **C-77** | §4 的 `verbosity` 没有影响 `maxOutputTokens` | **仍阻塞（实现有、测试没有）** | `src/server/llm/client.ts:197-202` 的 `maxTokensFor` 已按 `verbosity` 缩放（0.5 / 1 / 1.5，下限 120），`timeoutMs` 未动；但 `grep -rn "max_tokens\|maxTokensFor" tests` 为空，P2-R2 把 factor 恒为 1 后全量 **65/528 全绿**。§8.7 的「补断言」不成立 |
| **C-78** | 人格没有进提示 | **关闭** | `src/server/llm/prompts/base.ts:32-40` 用 `personaOf` / `styleOf` 渲染 label / 语气 / 句数 / 指认强度 / 口癖；`client.ts:100` 把 `personaId` 传进去；`prompts.test.ts:73-79` 断言具体 label `直来直去` 与 `指认强度2/2`。P2-R10 把人格段换成常量后 1 failed / 12 passed |
| **C-79** | START 之后的整条人格链没有测试 | **仍阻塞（只修了开局与 replay）** | `tests/engine/personas-start.test.ts` 已覆盖 `step(START)` 与 `replay`，P2-R1 把 `GAME_STARTED.personas` 全改 null 后该文件 1 failed / 5 passed；但没有任何用例在开局后继续跑 action。P2-R4 在相位切换时删掉所有 `personaId`，全量 **65/528 全绿**，AC-1 的「整局中不变化」仍未锁住 |
| **C-80** | AC-5 / AC-9 / AC-10 证据不成立 | **仍阻塞（三件事只修了两件）** | AC-5：`personas-start.test.ts:64-71` 补了 label 唯一非空，P2-R11 把两个 label 改成相同后红；但 P2-R5 让 `personaOf('careful')` 返回错误 label，全量 **65/528 全绿**，没有 replay→席位→label 的映射断言。AC-10：`personas-start.test.ts:73-88` 的「三种人格下同一非法 action 都被拒」存在。AC-9：`scenarios/advanced-play.test.ts` 只触发一次自曝；P2-R3 关闭悍跳与狼查杀狼两个判定后，该文件仍 **1/1 全绿**，见 §3.3 |
| **C-81** | 狼指认自己被算成狼查杀狼 | **关闭** | `src/engine/annotate.ts:52-58` 已排除 `accusation.target !== speaker`；`annotate.test.ts:84-93` 的负向用例在 P2-R6 删掉该条件后红 |
| **C-82** | `speakerOf` 没被锁；`reason` 没被抹 | **关闭** | `annotate.test.ts:191-210` 的 `visibleTo: 'self:9'` / `speakerOf: () => 1` 用例在 P2-R7 优先读 `visibleTo` 后红；`annotate.ts:111-128` 已抹 `AI_THOUGHT.reason`，P2-R8 用 `reason` 文本覆盖 `claim` 后 AC-8 与 AC-9 两条用例红 |
| **C-83** | 单边界抓不到「某人格永不当狼」 | **关闭** | `personas.test.ts:65-100` 已是 1000 局、12×2 真卡方、df=11、临界 24.725；正常统计量 `8.5596`；P2-R9 让 `blunt` 永不当狼后统计量 **360.6206**，1 failed / 8 passed |
| **C-84** | 文档漂移与过度声明 | **非阻塞，仍未完全修好** | README / TEST-STRATEGY / RFC §8.3 / §8.4 / §8.5 / §8.6 的残项见 §4.1；修复提交只改了用例数，没有同步状态、覆盖率和 AC 证据 |

### 2. 逐条验收标准：哪个测试会红（Round 2）

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `personas-start.test.ts:23-52`：开局 8 个 AI 有人格、玩家 null、与 `GAME_STARTED.payload.personas` 一致、replay 不丢；`personas.test.ts:20-47` 覆盖 LOBBY | P2-R1（START 全 null）红；但 P2-R4（相位切换时清空人格）全绿，没有「跨 action 仍不变」的断言 | **PARTIAL** |
| 2 | 同上：每局 8 个 id 互不重复 | 若 8 席复用同一 id，`Set.size === 8` 会红（Round 1 P-R3 已验证）；本轮未重复该探针 | **PASS** |
| 3 | `personas.test.ts:65-100`：1000 局真卡方，临界 24.725 | P2-R9 红（360.6206） | **PASS** |
| 4 | `personas.test.ts:103-113` 的 12 个静态风格组合；`prompts.test.ts:73-79` 断言人格段进了提示 | P2-R10 红；按 D-6 的记录偏离，用风格画像代替生成文本；但「阈值写在测试常量中」仍未做到（AC 原文要求） | **PASS（按 D-6 记录偏离）** |
| 5 | `personas-start.test.ts:64-71` 只断言 12 个 label 唯一非空；`personas-start.test.ts:54-61` 只断言每个 personaId 可解析 | P2-R11（label 重复）红；P2-R5（`careful` 的 label 映射错）全绿；没有「复盘数据里 label ↔ 席位一一对应」的断言 | **FAIL** |
| 6 | `annotate.test.ts:41-58` 悍跳真/假 | 改坏 `isFakeSeerClaim` 会红 | **PASS** |
| 7 | `annotate.test.ts:60-105` 狼→狼真、狼→好人假、好人→狼假、狼→自己假 | P2-R6 红 | **PASS** |
| 8 | `annotate.test.ts:107-136` 抹 `speech` / `reason` 后结果不变 | P2-R8 红 | **PASS** |
| 9 | `annotate.test.ts:138-189` 仍是手工拼的事件流；`scenarios/advanced-play.test.ts:21-39` 只触发一次自曝 | P2-R3 关闭悍跳与狼查杀狼后 scenario 仍全绿；没有「固定种子 + 预置状态」下三类各 ≥3 的对局 | **FAIL** |
| 10 | `personas-start.test.ts:73-88`：同一条非法 VOTE 在 `blunt` / `careful` / `chatty` 下都被拒 | 改成人格相关合法性会红（但只覆盖一个 action × 三个人格） | **PASS** |
| 11 | `personas.test.ts:49-63` 同 seed 可复现；`personas-start.test.ts:44-51` replay 后仍同 | P2-R1 红 | **PASS** |

统计：**PASS 8（2 / 3 / 4 / 6 / 7 / 8 / 10 / 11）**，**PARTIAL 1（1）**，**FAIL 2（5 / 9）**。AC-4 按 D-6 的记录偏离判 PASS；AC-1 / 5 / 9 没有完整的回归锁。

### 3. 仍阻塞的发现

#### 3.1 C-77（阻塞残项）· `verbosity` 有了实现，但没有一条测试锁住它

`src/server/llm/client.ts:197-202`：

```ts
function maxTokensFor(config: LlmConfig, personaId: string | null): number {
  if (personaId === null) return config.maxOutputTokens;
  const style = styleOf(personaId);
  const factor = style.targetSentences / 2; // 1 档 → 0.5，2 档 → 1，3 档 → 1.5
  return Math.max(120, Math.round(config.maxOutputTokens * factor));
}
```

这段代码本身符合 RFC-009 §4：只缩放 `max_tokens`，不碰 `timeoutMs`。问题是**它没有任何测试**：

- `grep -rn "max_tokens\|maxTokensFor" tests` 无结果；`tests/server/llm/client.test.ts` 的假 `fetch` 只捕获过请求体里的「格式错误回喂」，没有断言 `max_tokens`。
- P2-R2 把 factor 改成恒为 1（即 800 / 800 / 800），全量 `pnpm test` 仍然 **65 files / 528 tests 全绿**。
- RFC §8.7 的 C-77 行写「补断言」，与仓库事实不符；这同时是一条 `DOC-1` 的记录准确性问题。

**修法**：在 `client.test.ts` 加一条用假 `fetch` 捕获 `init.body` 的用例，分别用 verbosity 1 / 2 / 3 的人格（如 `blunt` / `smirk` / `careful`）和 `null` 调 `decide`，断言 `JSON.parse(body).max_tokens` 为 `400 / 800 / 1200 / 800`；同时断言 `config.timeoutMs` 未被改写。

#### 3.2 C-79（阻塞残项）· AC-1 的「整局不变」仍没有被测到

Round 1 要的链路是「`lobbyState` → `step(START)` → 跑若干 action（至少跨一个死亡 / 投票）→ 人格 id 仍相同 → `replay` 后仍相同」。修复只做了前半段：

- `tests/engine/personas-start.test.ts:23-52` 断言开局状态与 `GAME_STARTED.payload.personas` 逐位一致，`replay` 后也不丢；这部分是有效的，P2-R1 会红。
- 但该文件在 `step(START)` 之后**没有再提交任何 action**；`personas.test.ts` 的 `aiSeatsOf` 仍只调 `lobbyState`。
- P2-R4 在 `src/engine/apply.ts:113-140` 的 `applyPhaseChanged` 里，每次进入新相位就把 `seats[].personaId` 全部 `delete`。因为 `step` 与 `replay` 都走 `applyEvent`，replay-parity 也不会红；全量 **65 files / 528 tests 全绿**。这正好对应 AC-1 的「整局中同一席位的人格 id 不发生变化」。

**修法**：在 `personas-start.test.ts` 里从 `started.state` 继续走一段真实序列（至少经过一次 `PHASE_CHANGED`，最好跨一个 `PLAYER_DIED` / `DAY_STARTED` / 投票），每一步比较 `seats.map((seat) => seat.personaId)` 与开局快照；再把累计事件流 `replay` 一次，断言相同。

#### 3.3 C-80（阻塞残项）· AC-9 的真实场景只覆盖了自曝，AC-5 的标签映射也没有锁

**AC-9（主要）**：`tests/engine/scenarios/advanced-play.test.ts:21-39` 从固定种子开局，然后构造 `DAY_SPEECH` 状态提交一次 `SELF_EXPOSE`，最后只断言 `self-expose` 有 1 条。它没有触发悍跳或狼查杀狼，也没有「各 ≥3 次」。真正的三类各 ≥3 仍在 `annotate.test.ts:138-189` 的手工 `EventEnvelope[]` 里——Round 1 已明确说过那不是定向对局（无固定种子、无 `step`、无状态推进）。P2-R3 把 `isFakeSeerClaim` 与 `isWolfAccusesWolf` 都改成 `return false` 后，`advanced-play.test.ts` 仍然 **1/1 全绿**，直接证明该文件不覆盖另外两类。

这也让 `TEST-STRATEGY.md:295` 的「`tests/engine/scenarios/advanced-play.test.ts`：固定种子 + 预置决策序列，断言三类事件各触发 ≥3 次」成为过度声明。

**修法**：在 `advanced-play.test.ts` 里用固定种子和真实 `started.state`，把预置决策序列（3 条悍跳 `AI_THOUGHT`、3 条狼查杀狼 `AI_THOUGHT`、3 条 `SELF_EXPOSE`）拼进真实开局事件流后 `annotate`，断言三类各 ≥3；或者如果本 RFC 内无法提供这个 seam，就按 `/manage-changes` 把 AC-9 改成可自动化的判据并在 RFC 里记录，不能只在 Implementation Notes 里说「已补」。

**AC-5（次要但仍是 AC）**：`personas-start.test.ts:64-71` 只证明「12 个 label 互不重复且非空」，没有证明「复盘数据中每个人格标签与其席位一一对应，可被读出」。P2-R5 让 `personaOf('careful')` 返回 `{ ...found, label: '错误标签' }`，全量 **65 / 528 全绿**——一个座位显示错误人格标签不会被任何测试发现。建议在 `personas-start` 里对 replay 后的 8 个 AI 席位构造 `[seat, personaOf(personaId).label]`，断言 8 个 label 与 `PERSONAS` 库一致且互不重复。

### 4. 非阻塞发现

#### 4.1 C-84 · 文档仍未同步（非阻塞）

修复提交只把 README 的用例数从 519 改成 528，其余漂移仍在：

- `README.md:11`：仍写「七个 Reviewed、0 个 Changes requested、8 个 Not started」与实际 `RFCS.md` 不符；覆盖率仍写 `96.69% / 93.33%`，实测 `96.96% / 92.80%`。
- `README.md:36-38`：仍写「RFC-001 ~ 007 Reviewed」「RFC-008 Implemented，等待评审」「下一步：/review-rfc 008」；实际 RFC-008 已 Reviewed，RFC-009 在评审中。
- `TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.65`；`:38` 仍写「其余 15 个 RFC 仍为 proposed」（实际多数已 existing）；`:292` 的 AC-5 指向 `annotate.test.ts`（实际 label 测试在 `personas-start.test.ts`）；`:296` 的 AC-10 指向 `personas.test.ts`（实际在 `personas-start.test.ts`）；`:295` 的 `Exists` 列没有列 `scenarios/advanced-play.test.ts`。
- RFC §8.3 的文件清单没有 `tests/engine/personas-start.test.ts`、`tests/engine/scenarios/advanced-play.test.ts` 和 `src/server/llm/client.ts`；§8.4 的 AC-3 仍写「200 局、狼数少于好人数 + 1」，AC-9 仍写「构造的事件流」，AC-10 仍写 `prompts.test.ts`；§8.5 的覆盖率数字过期；§8.6 仍写「卡方检验：用界代替」。

这些不是行为缺陷，但会让下一个会话（或 `/workflow-status`）读到错误的状态，按 `DOC-1` 仍应回写。

#### 4.2 C-78 的测试只覆盖了一个人格（非阻塞）

`prompts.test.ts:73-79` 只断言 `blunt` 的 label 与 `指认强度2/2`。它足以证明「人格确实进了提示」（P2-R10 会红），但没有按 Round 1 的建议对 12 个人格逐一断言；一个只对 `blunt` 特判、其他人格渲染常量的提示仍可能全绿。建议至少再加 `careful`（verbosity 3 / aggression 0）与 `smirk`（有 quirk）两条，覆盖口癖与不同档位。

#### 4.3 AC-4 的阈值常量（承接 D-6，非阻塞）

AC-4 要求「阈值写在测试常量中」。`personas.test.ts:111` 仍直接写 `3`，没有 `STYLE_SPREAD_THRESHOLD`。按 D-6 的偏离记录，AC-4 已用静态风格画像替代生成文本；这个常量问题是记录之外的遗留，建议顺手改成具名常量。

#### 4.4 未重查的承接项

Round 1 §7.2 的 `applyGameStarted` 人格不变量、§7.3 的 `claim.accuses[].target` 范围，本轮没有重查（它们不是 C-77 ~ C-84 的一部分），仍按非阻塞承接。

### 5. 五个审查维度

#### 5.1 RFC ADHERENCE —— NEEDS WORK

已闭合：C-78 的人格提示、C-81 的自指认、C-82 的 `speakerOf` / `reason`、C-83 的卡方；`maxTokensFor` 的实现本身也符合 §4。未闭合：C-77 没有测试，C-79 的 AC-1 只覆盖开局，C-80 的 AC-9 / AC-5 证据不成立。按 RFC §5，AC-1 / 5 / 9 仍是 PARTIAL / FAIL。

#### 5.2 RULES COMPLIANCE —— NEEDS WORK

| 规则 | 结论 |
|---|---|
| `TEST-1` | **FAIL**：AC-1 的「整局不变」、AC-5 的 label ↔ 席位、AC-9 的定向对局没有可失败的自动化测试；C-77 的 §4 要求也没有测试。 |
| `DOC-1` | **FAIL（记录层面）**：§8.7 声称 C-77「补断言」、C-79/80 已修，但测试并不存在；§8.4 / §8.5 / §8.6 与 README / TEST-STRATEGY 仍漂移。 |
| `ARCH-1` | **PASS**：`personas.ts` / `annotate.ts` 仍只依赖 `@shared/*` 与 `./rng`；`client.ts` 反向 import 引擎不违反 ARCH-1。 |
| `ARCH-3` | **PASS**：状态仍只存 `personaId` 字符串。 |
| `DATA-2` / `DATA-4` | **PASS**：`GAME_STARTED.personas` 走联合事件；人格仍用注入式 rng。 |
| `AI-4` / `AI-5` / `AI-6` | **PASS**：`claim` 仍走 `DecisionSchema`；`annotate` 不读 `reasoning_content`；提示模板在 `prompts/base.ts`。 |
| `STYLE-3` / `STYLE-5` / `STYLE-6` | **PASS**：无 `any`、具名导出；`personas.ts` 87 行、`annotate.ts` 129 行。 |

#### 5.3 SECURITY —— PASS

`GAME_STARTED.personas` 仍是 `visibleTo: 'server'`，不进客户端投影；`project()` 只给观察者自己的 `personaId`。人格段来自固定常量库，`personaId` 由服务端状态提供，不是玩家输入；没有新增注入面。`decide` 仍然只把 `personaId ?? null` 传进 `buildSystemPrompt`，没有把整段自由文本拼进系统提示。

#### 5.4 PERFORMANCE —— PASS

`maxTokensFor` 每次决策一次线性 `find`；提示渲染多几行字符串。1000 局卡方只在测试里跑（约几秒），不影响生产。没有新增网络 / DB / LLM 调用。

#### 5.5 MAINTAINABILITY —— NEEDS WORK

`maxTokensFor` 是私有函数，没有测试；`advanced-play.test.ts` 的注释与实际覆盖不符（只测自曝）；`personas-start.test.ts` 的开局断言很强，但没有跨 action；文档漂移会让下一位实现者重复 Round 1 的误判。`applyGameStarted` 的「玩家 null / AI 非空」不变量仍是低风险承接项。

### 6. 变异探针与恢复

备份在 `/tmp/howl-r9r2-backup/`，覆盖 `src/engine/{step,apply,annotate,init,personas}.ts`、`src/server/llm/client.ts`、`src/server/llm/prompts/base.ts`。除下文记明的一处偏差外，每个探针结束后都用 `cp` 从备份恢复，并用 `md5` 核对一致。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P2-R1 | `step.ts:129` 的 `personas` 改为全 `null` | `personas-start.test.ts` | 1 failed / 5 passed | C-79 的开局链路有效 |
| P2-R2 | `client.ts:200` 的 factor 改为恒 1 | 全量 `pnpm test` | 65 files / 528 tests 全绿 | **C-77 没有测试** |
| P2-R3 | `annotate.ts` 的 `isFakeSeerClaim` / `isWolfAccusesWolf` 都 `return false` | `scenarios/advanced-play.test.ts` | 1/1 全绿 | **AC-9 场景只覆盖自曝** |
| P2-R4 | `apply.ts:113` 的相位切换里 `delete personaId` | 全量 `pnpm test` + `pnpm typecheck` | 65/528 全绿，typecheck 0 | **AC-1 整局不变未锁** |
| P2-R5 | `personaOf('careful')` 返回错误 label | 全量 `pnpm test` | 65/528 全绿 | **AC-5 的 label 映射未锁** |
| P2-R6 | 删除 `annotate.ts` 的 `accusation.target !== speaker` | `annotate.test.ts` | 1 failed / 9 passed | C-81 已锁 |
| P2-R7 | `annotate.ts` 优先从 `visibleTo` 解析 speaker | `annotate.test.ts` | 1 failed / 9 passed | C-82 已锁 |
| P2-R8 | `claimOf` 在 `reason` 含「预言家」时返回狼查杀狼 `claim` | `annotate.test.ts` | 2 failed / 8 passed | C-82 的 `reason` 已锁 |
| P2-R9 | `init.ts` 让 `blunt` 永不当狼 | `personas.test.ts` | 1 failed / 8 passed；卡方 360.6206 | C-83 已锁 |
| P2-R10 | `prompts/base.ts` 的人格段换成常量 | `prompts.test.ts` | 1 failed / 12 passed | C-78 已锁 |
| P2-R11 | 把 `careful` 的 label 改成与 `blunt` 相同 | `personas-start.test.ts` | 1 failed / 5 passed | AC-5 的 label 唯一性已锁（映射未锁） |

**恢复校验**：

```
md5 src/engine/{step,apply,annotate,init,personas}.ts \
    src/server/llm/client.ts src/server/llm/prompts/base.ts
# 与 /tmp/howl-r9r2-backup/ 下同名文件逐项相同
git status --porcelain
# （空）
pnpm test
# Test Files  65 passed (65)
# Tests       528 passed (528)
```

**必须记录的一处方法偏差**：`personas.ts` 在 P2-R11 之前没有备份，恢复时用了 `git checkout -- src/engine/personas.ts`（违反本轮「不要用 git checkout」的约束）。随后已把恢复后的原文件补进 `/tmp/howl-r9r2-backup/`，P2-R5 用 `cp` 恢复；最终文件与 HEAD 一致，工作树 clean。这是评审流程的偏差，不影响最终代码状态，但应当如实记录。没有 `git commit`。

### 7. 结论

- **Overall Risk Level: Medium**
- **Summary**：C-78 / C-81 / C-82 / C-83 已真修好，C-79 的开局 / replay 链路也已锁住；但 C-77 只有实现、没有测试，C-79 的「整局不变」和 C-80 的 AC-9 定向对局 / AC-5 标签映射仍能带着全绿套件退化。Status 不能置 `Reviewed`。
- **Blocking Issues**：**C-77**（缺 `max_tokens` 断言）、**C-79**（AC-1 跨 action 未测）、**C-80**（AC-9 场景只覆盖自曝；AC-5 标签映射未锁）。
- **Improvement Suggestions**：C-84 文档回写；C-78 补 1 ~ 2 个人格的提示断言；AC-4 的阈值改成具名常量；`applyGameStarted` 的人格不变量（承接项）。
- **Open conflicts**：本轮没有发现新的「两个 artifact 互相矛盾」；C-79 / C-80 是测试与实现证据不足，不是规范冲突。C-84 的文档漂移已登记到 `RFCS.md` §8.29。
- **建议状态**：**`Changes requested`**。修完 C-77 / C-79 / C-80 后再开 Round 3；Round 3 至少重跑 P2-R2 / P2-R3 / P2-R4 / P2-R5 与新增的用例。

## Round 3 -- 2026-11-19

**结论：Reviewed · Overall Risk Level: Low**

本轮按用户要求只复核 Round 2 的三个阻塞项（C-77 / C-79 / C-80，其中 C-80 拆成 a / b），以及这些修复本身引入的测试质量问题。C-78 / C-81 / C-82 / C-83 与更早已关闭项没有重查；C-84 的文档漂移仍是非阻塞开放项。

**结果摘要**：三项阻塞全部有可失败的回归锁。我独立重跑了 8 条探针：打进目标测试的 7 条全部变红；唯一没有变红的是 C-77 的「timeout 不随人格变」断言（P3-R2），它是非阻塞残项（N-R3-1）。门禁 **65 files / 532 tests** 全绿，引擎覆盖率 **行 96.96% / 分支 92.80%**。RFC-009 的 Status 置为 **`Reviewed`**。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `0acb9ab`，评审开始时工作树 clean。

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
vite v8.3.8 building ssr environment for production...
✓ 39 modules transformed.
BUILD_EXIT=0

$ pnpm test
 Test Files  65 passed (65)
      Tests  532 passed (532)
TEST_EXIT=0
```

覆盖率（`coverage/coverage-summary.json`）：**lines 96.96% / branches 92.80%**，过 `TEST-2`（90 / 85）。

`pnpm test:e2e` 未跑：本 RFC 没有 UI 改动，`TEST-6` 的 Playwright 门禁从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`tests/meta/selfplay-placeholder.test.ts`）。

**Product Type**：`PRD.md` 是 **game（主）+ web app（交付形态）**。本轮检查游戏状态、事件流、确定性、测试证据与人格 / 事件数据面；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright，因为本 RFC 不改 `src/client/`、不新增 HTTP 端点。

### 1. 三项阻塞复核

| # | Round 2 的问题 | Round 3 结论 | 证据 |
|---|---|---|---|
| **C-77** | §4 的 `verbosity` → `maxOutputTokens` 没有测试；P2-R2 把 factor 改成恒 1 后全量仍绿 | **关闭（主项）** | `client.test.ts:397-425` 用假 `fetch` 捕获真实请求体：`quiet` → 400、`chatty` → 1200、`null` → 800。P3-R1（factor 恒 1）1 failed / 19 passed；P3-R8（null 返回 1）同样打红。`timeout` 一条见 N-R3-1 |
| **C-79** | START 之后没有跨 action；P2-R4 在 `applyPhaseChanged` 清空人格后全量仍绿 | **关闭** | `personas-start.test.ts:91-109` 从真实 `started()` 出发连续提交三次 `WOLF_CHAT`，断言 9 席 `personaId` 与开局逐位相同。P3-R3（相位切换清空）1 failed / 6 passed |
| **C-80-a** | AC-5 的 label 映射没锁；P2-R5 让 `personaOf('careful')` 返回错误 label 仍绿 | **关闭** | `personas.test.ts:115-121` 对 `PERSONAS` 逐项比对 `personaOf(id).label`，并断言 `personaOf('careful').label === '谨慎观察'`。P3-R4 打红 |
| **C-80-b** | AC-9 只触发自曝；P2-R3 关掉悍跳 / 狼查杀狼后仍绿 | **关闭** | `scenarios/advanced-play.test.ts:35-81`：真实 `step` 开局 + 3 条注入的 `AI_THOUGHT` 悍跳 + 3 条注入的狼查杀狼 + 3 次真实 `SELF_EXPOSE`，三类各 ≥3。P3-R5 / P3-R6 / P3-R7 分别关掉三类判定后各 1/1 红 |

### 2. 受影响的验收标准

> 未列出的 AC-2 / 3 / 6 / 7 / 8 / 10 / 11 在 Round 2 已判 PASS，本轮按用户要求不重查。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `personas-start.test.ts:23-51` 开局 / replay；`:91-109` 连续三次夜聊 | P3-R3 红（相位切换清空） | **PASS** |
| 4 | `personas.test.ts:103-113` 风格组合；`client.test.ts:414-424` 真实 `max_tokens` | P3-R1 / P3-R8 红 | **PASS**（D-6 的记录偏离；timeout 残项见 N-R3-1） |
| 5 | `personas.test.ts:115-121` 逐项 label；`personas-start.test.ts:64-71` label 唯一非空、`:54-61` id 可解析 | P3-R4 红 | **PASS** |
| 9 | `scenarios/advanced-play.test.ts:35-81` | P3-R5 / P3-R6 / P3-R7 红 | **PASS**（场景注入的细节见 N-R3-3） |

### 3. 非阻塞发现

#### N-R3-1 · C-77 的 timeout 断言是自证

`tests/server/llm/client.test.ts:426-429` 只断言 `CONFIG.timeoutMs === 50`——`CONFIG` 是本文件顶部的字面量，测试没有观察 `decide` 传给 `AbortSignal.timeout` 的参数。P3-R2 把请求超时改成 `config.timeoutMs + (personaId === 'chatty' ? 100 : 0)`，`client.test.ts` **20/20 全绿**。

修法：spy `AbortSignal.timeout`，分别用 `quiet` / `chatty` / `null` 断言参数恒为 `config.timeoutMs`。这不阻塞 `Reviewed`：§4 的实现行为正确，AC 列表不包含超时。

#### N-R3-2 · C-79 的用例有「空真」风险

`personas-start.test.ts:91-109` 的循环上限是 3，且 `speaker === undefined` 或相位不是 `NIGHT_WOLF_CHAT` 时直接结束；测试没有断言三次 `WOLF_CHAT` 都被接受、也没有断言 `PHASE_CHANGED` 真的发生。若 `WOLF_CHAT` handler 退化到全部拒绝，`cursor` 不变，断言仍然通过。当前实现确实走到第三次并触发 `PHASE_CHANGED`（P3-R3 打红），所以本轮判 C-79 关闭；建议补 `expect(cursor.phase).toBe('NIGHT_WOLVES')`（或事件计数 / replay 一次）。

#### N-R3-3 · AC-9 场景的注入真实性与类型

`scenarios/advanced-play.test.ts:35-81` 的数量断言成立，但有三处可改进：

1. 固定种子 `20_261_117` + `playerSeat: 3` 下，**座位 3 是玩家且是狼**（我实跑过开局：`1:seer 2:wolf 3:wolf(P) 4:witch 5:hunter 6:villager 7:villager 8:wolf 9:villager`）。`thought()` 给座位 3 注入 `AI_THOUGHT`，但真实对局里玩家席位不会产生 `AI_THOUGHT`。换一个玩家不是狼的种子，或显式记录这是「预置决策序列」而不是真实 AI 决策。
2. `thought()` 用 `Record<string, unknown>` + `as unknown as EventEnvelope` 绕过了 `Claim` / `GameEvent` 的类型检查（`advanced-play.test.ts:24-33`）；`claim` 形状若漂移，`pnpm typecheck` 不会拦住。
3. `speakerOf` 从 `visibleTo` 反解席位（`:70-73`），与 D-3 的理由相反；测试自己构造的事件可以直接给 `[event, seat]` 映射。另：三次 `SELF_EXPOSE` 都从同一个 `day` 状态 `step`，事件的 `seq` 都是 2 / 3，拼出来的流不可 replay（`:57-65`）。这不影响 `annotate` 的计数，因为 AC-9 只要求标注、不要求 replay；但会让「定向对局」这个说法偏强。

#### C-84（承接，非阻塞）· 文档仍漂移

修复提交更新了 §8.3 的测试清单、§8.4 的 AC-4 / 5 / 9 / 10 证据、§8.5 的覆盖率与 README 的用例数，但以下仍是 Round 2 记录的旧值：

- `README.md:11` 仍写「7 个 Reviewed / 0 个 Changes requested / 8 个 Not started」，覆盖率仍 `96.69% / 93.33%`；`:36-38` 仍写「RFC-001 ~ 007 Reviewed」「RFC-008 Implemented，等待评审」「下一步 /review-rfc 008」。
- `TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.65`；`:38` 仍写「其余 15 个 RFC 仍为 proposed」；`:290-296` 的 `Exists?` 列仍未列 `scenarios/advanced-play.test.ts`。
- RFC §8.4 的 AC-3 仍写「200 局交叉表里每个人格的狼数都少于好人数 + 1（D-5 的界）」，与 D-5 的 1000 局卡方不一致；§8.5 仍写 `63 files / 519 tests`；§8.8 的 C-84 行说「已同步」，与实际不符。

这些不影响 `Reviewed`，但会让下一个会话读到错误的状态，按 `DOC-1` 应回写。

### 4. 五个审查维度

#### 4.1 RFC ADHERENCE —— PASS

C-77 / C-79 / C-80 的阻塞残项已闭合；AC-1 / 4 / 5 / 9 都有可失败测试。AC-4 仍按 D-6 的记录偏离（风格画像 + 提示渲染替代生成文本）。未重查的 AC 沿用 Round 2 的 PASS。

#### 4.2 RULES COMPLIANCE —— PASS（非阻塞文档残项）

| 规则 | 结论 |
|---|---|
| `TEST-1` | **PASS**：本轮三项阻塞都有会失败的测试；门禁 65/532 全绿。 |
| `TEST-2` | **PASS**：引擎覆盖率 96.96% / 92.80%。 |
| `DOC-1` | **非阻塞**：§8.8 的 timeout 声明与「C-84 已同步」不准确；C-84 文档漂移仍在。 |
| `ARCH-1` | **PASS**：本提交只改测试与文档，没有改 `src/engine/` 的依赖。 |
| `ARCH-3` / `DATA-2` / `DATA-4` / `AI-4` / `AI-5` / `AI-6` | **PASS**（实现未变；Round 2 已核对）。 |

#### 4.3 SECURITY —— PASS

本提交没有改生产代码；`GAME_STARTED.personas` 仍为 `server` 可见性，`project()` 只给观察者自己的 `personaId`；人格仍来自固定库、`personaId` 来自服务端状态，没有新增输入面。

#### 4.4 PERFORMANCE —— PASS

测试与文档改动；`maxTokensFor` 仍是每次决策一次线性 `find`；1000 局卡方只在测试里跑。没有新增网络 / DB / LLM 调用。

#### 4.5 MAINTAINABILITY —— PASS（有改进项）

新测试放在对的文件、命名清楚；N-R3-1 / N-R3-2 / N-R3-3 是测试强度与真实性的改进点，不是行为缺陷。

### 5. 变异探针与恢复

备份在 `/tmp/howl-r9r3-backup/`，覆盖 `src/server/llm/client.ts`、`src/engine/{apply,personas,annotate}.ts`。每个探针用 `cp` 从备份恢复，`md5` 逐项相同；**没有使用 `git checkout`**，也没有 `git commit`。

| # | 注入 | 跑什么 | 结果 |
|---|---|---|---|
| P3-R1 | `client.ts:200` factor 恒 1 | `tests/server/llm/client.test.ts` | 1 failed / 19 passed；`expected 800 to be 400` |
| P3-R2 | `client.ts:130` 请求超时按人格加 100ms（不改 `CONFIG`） | 同上 | **20/20 绿**（N-R3-1） |
| P3-R3 | `apply.ts` 的 `applyPhaseChanged` 清空所有 `personaId` | `tests/engine/personas-start.test.ts` | 1 failed / 6 passed；收到 8 个 `null` |
| P3-R4 | `personaOf('careful')` 返回错误 label | `tests/engine/personas.test.ts` | 1 failed / 8 passed；`expected '错误标签' to be '谨慎观察'` |
| P3-R5 | `isFakeSeerClaim` 恒 false | `tests/engine/scenarios/advanced-play.test.ts` | 1 failed（该文件仅 1 条用例）；`fake-seer-claim` 0 |
| P3-R6 | `isWolfAccusesWolf` 恒 false | 同上 | 1 failed（该文件仅 1 条用例）；`wolf-accuses-wolf` 0 |
| P3-R7 | 删掉 `SELF_EXPOSE` 的标注 | 同上 | 1 failed（该文件仅 1 条用例）；`self-expose` 0 |
| P3-R8 | `maxTokensFor(null)` 返回 1 | `tests/server/llm/client.test.ts` | 1 failed / 19 passed；`expected 1 to be 800` |

**恢复校验**：

```
md5 src/server/llm/client.ts src/engine/{apply,personas,annotate}.ts /tmp/howl-r9r3-backup/*
# 四对逐项相同
git status --porcelain
# （空）
pnpm test
# Test Files  65 passed (65)
# Tests       532 passed (532)
```

### 6. 结论

- **Overall Risk Level: Low**
- **Summary**：Round 2 的三个阻塞项现在都有能打红的回归锁；我独立重跑了 factor / phase-clear / label / 三类判定的探针，目标测试均为红。剩余问题都是非阻塞的测试强度与文档漂移。
- **Blocking Issues**：无。
- **Improvement Suggestions**：N-R3-1（timeout 断言）、N-R3-2（C-79 的空真风险）、N-R3-3（AC-9 的玩家席位 / 类型 / seq）、C-84 文档回写。
- **Open conflicts**：没有新的 artifact 冲突；C-84 是文档漂移，不是权威顺序冲突。
- **建议状态**：**`Reviewed`**。
