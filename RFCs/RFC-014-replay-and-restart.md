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
  claimedRole?: string;      // 悍跳等（RFC-009）
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
