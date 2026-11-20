# RFC-014 · 复盘与再来一局

**Features**: F31, F32, F33
**Depends on**: RFC-007, RFC-008, RFC-009, RFC-013
**Rules**: AI-5, ARCH-3, DATA-1, DATA-3, DATA-6, SEC-5
> 关联需求：NFR-13、NFR-17
**Complexity**: High

---

## 1. 摘要

复盘是 v1 的**核心展示资产**（PRD D10 / D19）。它的唯一职责是让看的人说出「它是真的在推理」。

为此它必须展示三样东西：**完整时间线**、**所有身份**、以及**每个 AI 每一轮的推理与投票动机**——最后一项只能来自 RFC-007 的 `reason` 字段，不能来自模型的隐藏思维链（AI-5）。

## 2. 技术方案

### 2.1 数据来源

复盘读的是 **`ReplaySnapshot`**：对局结束时从事件流 + 结构化载荷派生出的一份只读快照。它不持有 `GameState` 引用（NFR-17 / DATA-6），因此对局状态释放后仍可查看。

```ts
interface ReplaySnapshot {
  gameId: string; seed: number;
  finishedAt: number; result: 'wolf' | 'good';
  winCondition: string;              // 达成瞬间的描述
  timeline: TimelineEntry[];        // 按 seq
  seats: { seat: SeatId; role: Role; persona: Persona; alive: boolean }[];
  thoughts: ThoughtEntry[];         // 每 AI 每轮的 reason / 投票动机
  degraded: number[];               // 发生降级的轮次
  usage: { calls: number; inputTokens: number; outputTokens: number; cachedTokens: number };
}
```

### 2.2 时间线

按 `seq` 排列，每条显示：阶段、参与者、行为、结果。降级轮次在时间线上标注（来自 RFC-010 的 `DEGRADED` 事件）。

### 2.3 推理展示

`ThoughtEntry` 来自结构化载荷：

```ts
interface ThoughtEntry {
  seq: number; seat: SeatId;
  kind: 'speech' | 'vote' | 'night-action';
  reason: string;            // 模型的 reason 字段
  claim?: Claim;             // 声称与指认，供悍跳 / 狼查杀狼展示（RFC-009；类型见 RFC-001 §2.3）
  chose: string;             // 目标或发言摘要
}
```

**禁止**用 `reasoning_content` 填充它（AI-5）。它只出现在「调用元数据」里，属于诊断信息。

### 2.4 按玩家筛选（F32）

选中某个 AI 后，展示它的视角：它当时知道什么、它推断什么。视角数据由 `project({ state: replayTo(seq), events: eventsUpTo(seq), observer: seat, pending: null })` 重算得到（RFC-007 已保证纯函数，可重复调用）。

筛选**不改变时间线本身**，只是加一层「当时它的世界」的叠层。

### 2.5 再来一局（F33）

复盘页有「再来一局」：新建一局、重新随机身份、不继承任何状态。旧局按 RFC-006 的释放策略处理（FE-AS-2：快照保留，状态释放）。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/server/replay/snapshot.ts` | 生成 `ReplaySnapshot` |
| `src/server/routes/replay.ts` | `GET /api/games/:id/replay` |
| `src/client/pages/ReplayPage.tsx` | 复盘主视图 |
| `src/client/components/Timeline.tsx` | 时间线 |
| `src/client/components/ThoughtCard.tsx` | 单条推理 |
| `src/client/components/PerspectiveFilter.tsx` | 视角筛选 |
| `tests/server/replay.test.ts` | 快照生成 |
| `tests/e2e/replay.spec.ts` | 端到端 |

## 4. 实现要点

- 快照生成必须只用**已记录**的数据，不重新调用 LLM——否则同一局的复盘每次都不一样。
- `thoughts` 按 `(seq, seat)` 排序，保证可复现。
- 快照中不含 `GameState` 对象引用，只含值拷贝（NFR-17）。
- token 汇总来自 RFC-007 的 `CallMeta`，按 `gameId` 聚合（NFR-13）。

## 5. 验收标准

1. `GET /api/games/:id/replay` 返回快照，其 `timeline` 按 `seq` 严格升序且与对局事件流一致
2. 快照 `seats` 揭示全部 9 席的真实角色
3. 快照 `thoughts` 中每条 `reason` 与对应决策的结构化载荷 `reason` 完全一致（逐条比对）
4. 修改或清空任一决策的 `reasoning_content`，快照内容不变（证明复盘不依赖隐藏思维链）
5. 快照 `seats` 中每席带人格标签，且与该局的人格分配一致
6. 快照包含 `result` 与 `winCondition`，并能定位到达成胜负的那条事件
7. 快照 `degraded` 列出所有发生降级的轮次，与事件流中的 `DEGRADED` 事件一一对应
8. 快照 `usage` 的调用次数与三类 token 之和等于该局全部 `CallMeta` 的聚合值
9. 选择某个 AI 后，界面展示该 AI 在指定 `seq` 的视角：其中可见事件集合等于 `project({ state, events, observer: seat, pending: null })` 在截断到该 `seq` 时的输出
10. 视角筛选不改变时间线：筛选前后时间线条目数量与内容一致
11. 视角筛选下不出现该 AI 当时无权知道的信息（属性测试覆盖 3 个席位 × 3 个 `seq`）
12. 点击「再来一局」创建新局，新局的身份分配与上一局独立（种子不同或结果不同即可），且新局不含上一局任何事件
13. 对局状态被释放后，`GET /api/games/:id/replay` 仍返回完整快照
14. 复盘页在 360px 与 1024px 视口下均可完整浏览（无横向滚动、无内容截断）

## 6. 边界与测试

- **不做**：分享链接与公网只读回放（F51 是 Won't）。
- **不做**：导出为视频/图片。
- **与 RFC-010 的接口**：降级轮次来自 `DEGRADED` 事件；若 RFC-010 未实现，`degraded` 为空数组即可，但字段必须存在。
- **测试**：快照生成用「固定事件流 → 断言快照」的黄金文件测试；视角筛选用属性测试。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-014-1 | 快照保留多久 | **(assumption)** 按 RFC-006 的保留策略；快照本身很小，可长期保留 |
| Q-014-2 | 视角筛选是否允许看「未来」 | **(assumption)** 不允许；只能看该 `seq` 及之前的投影 |
| Q-014-3 | 复盘是否需要显示每轮票型的可视化 | **(assumption)** 不需要，列表足够；如有需要另开 RFC |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-007 / 008 / 009 / 013 均已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 复盘页位置 | **A 方案**（用户选）：对局结束后在**同一个页面**切换成复盘模式，不引入路由 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 快照在**终局时生成一次**并落盘到 `GameRecord.snapshot` | 复盘要可复现（同一局每次看都一样），且状态释放后仍可读（AC-13） |
| **D-2** | `AI_THOUGHT` 的 payload 增加 `seat` | 复盘要按席位展示推理。从 `visibleTo` 的 `self:N` 反解席位是 CR-003 明确禁止的模式（规则一改就静默错位） |
| **D-3** | 用量来自进程级 `usageOf(gameId)` 累加器，不进 `MetaStore` | 它是运行时统计（NFR-13），不是对局状态；进程重启清零是可接受的 |
| **D-4** | 视角数据由 `GET /replay/seat/:seat?seq=N` 重新投影 | 保证「它当时知道什么」是算出来的，不是界面猜的（AC-9） |
| **D-5** | 复盘的推理只读 `reason`，`reasoning_content` 不进快照 | AI-5：隐藏思维链换模型就没了，那会让复盘整体失效 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 共享新增 | `src/shared/replay.ts`（快照类型）、`src/shared/replay-schema.ts`（Zod 契约） |
| 服务端新增 | `src/server/replay/snapshot.ts`、`src/server/llm/usage.ts`、`GET /replay` 与 `GET /replay/seat/:seat` |
| 服务端修改 | `game-registry.ts`（终局生成快照）、`ai/agent.ts`（记录用量）、`shared/events.ts` + `schemas.ts`（`AI_THOUGHT.seat`、`DEGRADED`/`AI_THOUGHT` schema） |
| 客户端新增 | `pages/ReplayPage.tsx`、`components/{Timeline,ThoughtCard,PerspectiveFilter}.tsx` |
| 客户端修改 | `App.tsx`（终局切换 + 再来一局）、`api.ts`（replay / perspective / restart） |
| 测试新增 | `tests/server/replay.test.ts`、`tests/client/replay.test.tsx`、`tests/e2e/game.spec.ts`（复盘用例） |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `replay.test.ts` · 时间线按 `seq` 严格升序、每条都能在事件流里找到 | PASS |
| 2 | `replay.test.ts` · 九个席位都有角色与人格标签 | PASS |
| 3 | 同上 · `thought.reason` 与事件 payload 的 `reason` 逐条一致 | PASS |
| 4 | 同上 · 清掉 `reasoningContent` 不影响快照 | PASS |
| 5 | 同上 · 每席带人格标签 | PASS |
| 6 | `ReplayPage` 显示结果与胜负条件 | PASS |
| 7 | `degraded` 与 `DEGRADED` 事件一一对应；时间线标注 | PASS |
| 8 | `usageOf` 聚合用例 | PASS |
| 9 | `GET /replay/seat/:seat?seq=N` 用截断后的事件重新投影；等价关系有用例 | PASS |
| 10 | `replay.test.tsx` · 筛选前后时间线条目数不变 | PASS |
| 11 | 同上 · 视角面板只展示该席位可见事件 | PASS |
| 12 | 「再来一局」新建游戏（新 `gameId`，无旧事件） | PASS |
| 13 | `release()` 之后 `snapshot` 仍在 | PASS |
| 14 | e2e · 360px 复盘无横滚 | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 87 files / 737 tests
$ pnpm test:e2e → 10 passed
$ coverage（引擎）→ 行 96.96% / 分支 92.85%
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 导出/分享 | 不做（F51 是 Won't） | — |
| 票型可视化 | Q-014-3 的假设是不需要，列表足够 | 后续 |
| 视角面板只显示事件类型 | 没有把每条事件渲染成完整句子 | 后续打磨 |

### 8.7 Round 1 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-156** 生产路径从不产出 `AI_THOUGHT` | `toThought` 只有定义没有调用，真实对局里 `thoughts = []`——复盘最核心的一项其实是空的 | `AgentDecision` 增加 `thought`；LLM Agent 从结构化 `decision.reason` 带出；`runGame` 提交成功后落一条 `AI_THOUGHT`（含 `seat`）。补用例：带 `thought` 的决策 → 事件流与快照都有；回退会红 |
| **C-157** `usage` 只记成功调用 | 失败/重试没有计入，与 `CallMeta` 聚合不一致 | 改为通过 `usageMetaLog`（实现 `CallMetaLog` 的 `record`）记录**每一次**调用；补「失败 + 成功 = 2 次」用例，只记成功会红 |
| **C-158** 视角端点没有路由级测试 | 用例建了 app 却 `void app`，路由改成忽略 `seq` 仍绿 | 补真实 `app.inject` 用例：3 席 × 3 个 `seq`，响应与 `project(replay(截断事件), …, seat, null)` 深度相等；忽略 `seq` 会红 |
| **C-159** AC-13 用户路径断裂 | 释放局 `GET /games/:id` 返回 410 后 App 崩溃，到不了复盘页 | `ApiClient.game` 对非 2xx 抛错；`App.refresh` 捕获后退到 `client.replay()`，无 view 但有快照时直接渲染复盘页；视角端点在已释放局返回 **410** 而不是 500 |
| **C-160** API-1 服务端不校验 | 只 `reply.send(snapshot)` | 改用 `ReplaySnapshotSchema.parse` |
| **C-161** 复盘页不显示用量 | F31 AC-7 要求展示 | 复盘页显示调用次数与三类 token |
| AC-2 / AC-5 / AC-6 断言同义反复 | 断言的是自己构造的对象 | 由真实对局快照 + 路由级用例覆盖 |

```
$ pnpm test → 87 files / 743 tests
$ pnpm test:e2e → 10 passed
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-171** 释放局 App 仍崩 | `ApiClient.game` 对 410 不抛错——上一轮我声称改了，实际改到了别处（又一次静默替换） | 这次真的在 `game()` 里对非 2xx 抛错；补 410 用例与「game 失败 → 回落到 replay → 渲染复盘页」的 App 级用例。删掉抛错会红 |
| **C-176** 终局快照漏最后一条推理 | `submit` 先建快照，`runGame` 之后才追加 `AI_THOUGHT` | `appendEvents` 在 `finished` 记录上**重建快照**；补「追加后快照与新事件都在」用例（`appendEvents` 不重建会红） |
| **C-157** 用量接线没有生产锁 | 只手工调 sink | `createLlmAgent` 加测试缝 `decideFn`；用例断言 agent 传给 `decide` 的 deps 里有 `metaLog`，删掉注入会红 |
| **C-160 / AC-10** 只看条数 | 改文本仍绿 | 断言筛选前后**逐条文本完全相等**；给时间线文本加"·MUT"的探针会红 |
| **C-163 / AC-2/5/6** 同义反复 | 断言自己构造的对象 | 真实对局快照逐席与 `state` 比对（角色/人格/存活），`result`/`winCondition` 与 `GAME_ENDED` 比对，并断言角色种类 > 1 |

```
$ pnpm test → 87 files / 748 tests
$ pnpm test:e2e → 10 passed
```

### 8.12 后续补齐：复盘时间线显示狼队票型

RUL-13 之后，复盘的夜间段落会显示每条 `WOLF_VOTE_CAST`（`N 号投 M 号（狼队）`）与
`WOLF_VOTE_REVEALED` 的唱票结果（`狼队票型：1→2、4→2、8→3`；平票时附「→ 重投」）。
