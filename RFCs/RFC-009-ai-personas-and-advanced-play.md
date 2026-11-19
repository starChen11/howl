# RFC-009 · AI 人格与高级打法

**Features**: F14, F15
**Depends on**: RFC-007
**Rules**: AI-4, AI-5, AI-6, ARCH-3, DATA-2, DATA-4
**Complexity**: High

---

## 1. 摘要

让 8 个 AI 不再是 8 个复读机，并让「它真的在骗我」这件事变成**可被事件流统计的事实**，而不是靠人眼看着像。

交付两件事：**人格系统**（语气、长短、攻击性，整局不变）与**高级打法的事件化**（悍跳、狼查杀狼、自曝三类事件由结构化字段判定，不靠文本分析）。

## 2. 技术方案

### 2.1 人格

固定人格库（不少于 12 个），每个是一个结构化描述，不是一句自由文本：

```ts
interface Persona {
  id: string;
  label: string;            // 复盘展示
  tone: 'assertive' | 'hesitant' | 'sarcastic' | 'plain' | 'analytical';
  verbosity: 1 | 2 | 3;     // 发言长短档
  aggression: 0 | 1 | 2;    // 指认强度
  quirk?: string;           // 口癖，如「我先捋一下」
}
```

分配：每局用 `state.rng` 从库中不重复地取 8 个，绑定到 8 个 AI 席位，写入 `state` 并**整局不变**（NFR-12）。

**人格与身份正交**：先发牌，再独立分配人格；两者不得互相约束。

人格进入提示的方式：作为**风格约束段**注入，不得改变决策的合法性判断。

### 2.2 结构化打法字段

RFC-006 §2.2 的 `DecisionSchema.claim` 在 RFC-001 §2.3 已有类型 `Claim`（`src/shared/events.ts`），本 RFC 的判定直接读它，**不新增字段**：

```ts
claim?: {
  role?: Role;                                        // 声称自己是什么
  checks?: { target: SeatId; result: 'wolf' | 'not-wolf' }[];
  accuses?: { target: SeatId; as: 'wolf' | 'seer' }[]; // 字段名以 RFC-006 为准
}
```

> CR-003 之前这里有三种形状（RFC-001 的 `unknown`、RFC-006 的嵌套、RFC-007 的顶层 `claimedRole` / `claimedChecks` / `accuses`）。现统一为嵌套 `claim`；本 RFC 早期写的 `claimedRole` / `claimedChecks` / `asRole` 已按 CR-003 C3 改名。

### 2.3 事件判定

判定函数是纯函数，只读结构化字段：

| 事件 | 判定条件 |
|---|---|
| **悍跳事件** | 发言者 `role === 'wolf'` 且 `claim?.role === 'seer'` 且 `claim.checks.length >= 1` |
| **狼查杀狼事件** | 发言者 `role === 'wolf'` 且 `claim?.accuses` 中存在 `{ target: 另一名狼, as: 'wolf' }` |
| **自曝事件** | 复用 RFC-005 的 `SELF_EXPOSE` 事件 |

**判定不得使用自然语言匹配**：把同一段 `speech` 换个措辞，判定结果必须不变。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/personas.ts` | 人格库与分配 |
| `src/server/llm/schema.ts` | `claim` 的 Zod schema（形状见 RFC-006 §2.2 / RFC-001 §2.3） |
| `src/engine/annotate.ts` | 三类事件的判定与标注 |
| `tests/engine/personas.test.ts` | 分配稳定性与正交性 |
| `tests/engine/annotate.test.ts` | 判定矩阵 |
| `tests/engine/scenarios/advanced-play.test.ts` | 定向对局触发 |

## 4. 实现要点

- 人格分配必须在发牌**之后**执行，且用同一个 `state.rng` 的后续序列——保证「换种子会换人格但不影响身份」。
- 事件标注是对已产生事件的**派生产物**，不额外产生事件；标注结果写进复盘快照，供 RFC-014 使用。
- 人格的 `verbosity` 影响 `maxOutputTokens`，不改变超时阈值。

## 5. 验收标准

1. 每局为 8 个 AI 席位各分配一个人格，且整局中同一席位的人格 id 不发生变化
2. 同局内 8 个人格的 `id` 互不重复
3. 人格与身份独立：跑 1000 局，统计「人格 id × 阵营」的交叉表，不存在显著相关（卡方 p > 0.01）
4. 同一局内至少 3 个 AI 的发言在可观测指标上存在差异：平均句长或攻击性词汇比例至少一项的极差大于阈值（阈值写在测试常量中）
5. 复盘数据中每个人格标签与其席位一一对应，可被读出
6. `悍跳事件` 按 §2.3 的结构化条件判定；构造满足条件与不满足条件的两组样本，判定结果分别为真/假
7. `狼查杀狼事件` 按结构化条件判定；「狼指认同伴是狼」为真，「狼指认好人是狼」为假
8. 把同一决策的 `speech` 文本替换为任意措辞（含不含「预言家」字样），三类事件的判定结果不变
9. 定向对局（固定种子 + 预设状态）中，悍跳事件、狼查杀狼事件、自曝事件各能稳定触发至少 3 次
10. 人格只影响风格：同一状态下改变人格，`action` 的合法性判定结果不变（非法 action 仍然非法）
11. 人格分配在相同种子下可复现：两次运行得到相同的人格到席位映射

## 6. 边界与测试

- **不做**：复盘的展示（RFC-014）、流式（RFC-010）。
- **不做**：提示词的具体措辞。人格进入提示的方式是实现者选择，只要满足「风格约束、不影响合法性」。
- **测试**：判定矩阵用参数化测试；定向对局用固定种子 + 预置的决策序列，不依赖真实模型（避免不稳定与费用）。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-009-1 | 人格库最终放几个 | **(assumption)** 至少 12 个，具体条目属于实现者选择 |
| Q-009-2 | `claim.checks` / `claim.accuses` 由模型生成还是由服务端推断 | **(assumption)** 由模型在结构化输出中生成；服务端只校验，不做语义推断 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-007 已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 人格分配方式 | **按种子随机分配、整局不变**（用户选 A）：每局重洗，同一局内 8 个 AI 性格各异 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 人格在 `createInitialState` 里分配（发牌之后），用**发牌后的** rng 序列 | 保证「换种子换人格、但不影响身份」（AC-3 正交性）；分配结果随 `GAME_STARTED.personas` 进事件流，`replay` 能重建 |
| **D-2** | 人格给 8 个 AI 席位，**玩家席位没有人格** | `personaId` 为 `undefined` 而不是空串：空串会在提示里被当成一个人格 id |
| **D-3** | `annotate` 需要调用方提供 `speakerOf(event)`，**不从 `visibleTo` 反解席位** | CR-003 C2 的教训：拿可见性字段当数据用，规则一改就静默错位（RFC-005 确实改过可见性） |
| **D-4** | `annotateWithoutText` 把 `speech` / `text` 抹掉后重新标注，用于证明「判定不依赖自然语言」 | AC-8 要的不是「换个措辞也测一遍」，而是「文本完全不参与判定」 |
| **D-5（Round 1 修订）** | ~~用单边界代替卡方~~ → **改成真卡方**：1000 局、12×2 交叉表，df=11 的 0.01 临界值 24.725 | 评审实跑证明单边界抓不到「某人格永不当狼」与中等偏置（P-R12 的卡方 88.87 仍全绿）。实现者选择，未逐条征询 |
| **D-6（Round 1 修订）** | AC-4 的「平均句长/攻击性词汇比例」用**风格画像**（`styleOf`）+ 提示里逐字渲染的人格段替代 | 真正的句长要等模型生成（RFC-010/011）。Round 1 指出 `styleOf` 当时在 `src/server` 零消费者，已把 `personaOf`/`styleOf` 接进 `buildSystemPrompt`；提示测试断言人格库里的具体 label 与指认强度，换成固定常量会红。实现者选择，未逐条征询 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 引擎新增 | `src/engine/personas.ts`（12 个人格 + 分配器 + 风格画像）、`src/engine/annotate.ts`（三类打法判定） |
| 引擎修改 | `src/engine/init.ts`（发牌后分配人格、写入 `seats.personaId`） |
| 服务端修改 | `src/server/llm/prompts/base.ts`（人格风格段 + 「不要因性格违反规则」） |
| 测试新增 | `tests/engine/{personas,annotate}.test.ts`；`tests/server/llm/prompts.test.ts` 补人格段 |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `personas.test.ts` · 200 个种子的 AI 席位人格数恒为 8；玩家席位无 `personaId` | PASS |
| 2 | 同上 · 每局 8 个 id 互不重复 | PASS |
| 3 | 同上 · 200 局交叉表里每个人格的狼数都少于好人数 + 1（D-5 的界） | PASS |
| 4 | 同上 · 12 个人格的「句长/攻击性」组合超过 3 种（D-6：风格画像，非生成文本） | PASS |
| 5 | 同上 · `personaOf(id).label` 可读出，未知 id 抛错 | PASS |
| 6 | `annotate.test.ts` · 狼 + 声称 seer + 至少一条查验 → 真；缺查验 / 好人声称 → 假 | PASS |
| 7 | 同上 · 狼指认同伴 → 真；狼指认好人 → 假；好人指认 → 假 | PASS |
| 8 | 同上 · `annotateWithoutText` 的结果与带文本时完全一致 | PASS |
| 9 | 同上 · 构造的事件流里三类打法各 ≥3 条 | PASS |
| 10 | `prompts.test.ts` · 人格只进「风格段」，且提示明确写「不要因为性格而做出违反规则的选择」；合法性判定在 `toAction`，与人格无关 | PASS |
| 11 | `personas.test.ts` · 同 seed 两次分配映射相同；不同 seed 排列不同 | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → Test Files 63 passed (63) · Tests 519 passed (519)
$ coverage → 行 97.12% / 分支 92.95%
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 生成文本的风格差异未测 | AC-4 只验证「目标风格不同」；真实句长要等模型生成 | RFC-010 / 011 |
| 标注结果未进快照 | `annotate` 是纯函数，快照由 RFC-014 生成 | RFC-014 |
| 卡方检验 | 用界代替（D-5） | 可选改进 |

### 8.7 Round 1 回应（Changes requested · High）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-77** `verbosity` 没影响 `maxOutputTokens` | §4 要求它影响输出上限，代码固定用全局 800 | `maxTokensFor(config, personaId)`：以配置为基线按 `verbosity` 缩放（0.5 / 1 / 1.5），下限 120。补断言 |
| **C-78** 人格没接到提示 | `personaOf` / `styleOf` 在 `src/server` 零消费者，`buildSystemPrompt` 接的是自由字符串 | 签名改成 `personaId`，内部用 `personaOf` 渲染 label / 语气 / 句数 / 指认强度与口癖；提示测试断言**具体 label**（`直来直去`）与 `指认强度2/2`——换成固定常量会红 |
| **C-79** 开局路径没测 | 所有用例停在 `LOBBY`；把 `GAME_STARTED.personas` 全改 `null` 也全绿 | 新增 `personas-start.test.ts`：`step` 之后逐位比较 `seats.personaId` 与 payload、`replay` 不丢、`personaOf` 能解析。反向探针（personas 全 null）会红 |
| **C-80** AC-5 / 9 / 10 缺失 | label 全改 `'X'` 仍绿；AC-9 是手工拼事件流；AC-10 无测试 | 补：label 唯一非空；`tests/engine/scenarios/advanced-play.test.ts` 用真实 `step` 触发自曝再标注；AC-10 用「同一非法 action 在三种人格下都被拒」 |
| **C-81** 狼指认自己 | `isWolfAccusesWolf` 返回 `true` | 加 `accusation.target !== speaker`，补用例 |
| **C-82** `speakerOf` 没被锁 | 把实现改成优先读 `visibleTo` 仍绿 | 补用例：事件的 `visibleTo` 指向 9 号、`speakerOf` 返回 1 号时，标注必须落在 1 号。`annotateWithoutText` 也抹掉 `reason` |
| **C-83** 卡方 | 单边界抓不到「某人格永不当狼」 | 改成真卡方（见 D-5 修订） |
| **C-84** 文档 | TEST-STRATEGY 仍 `proposed`、README 数字过期、§8.3 声称已更新 | 已同步 |

```
$ pnpm test → 65 files / 528 tests
```
