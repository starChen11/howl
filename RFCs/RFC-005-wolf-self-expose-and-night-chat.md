# RFC-005 · 狼人自曝与夜间私聊

**Features**: F9, F10
**Depends on**: RFC-004
**Rules**: ARCH-5, ARCH-6, ARCH-11, DATA-2, RUL-4
**Complexity**: Medium
> 关联需求：FR-15、FR-31

---

## 1. 摘要

给狼阵营补上两种只有他们才有的行为：**白天自曝**（用一天换一夜）与**夜间私聊**（动手前先把话说清楚）。

两者共同依赖 RFC-001 已定义的**可见性**（`EventEnvelope.visibleTo` + `isVisibleTo`）。本 RFC 负责把可见性从「有个类型」变成「有经过测试的判定」，并保证所有狼专属事件都不会漏给好人。

## 2. 技术方案

### 2.1 可见性的落点

- `visibleTo` 是**事件信封**的必填字段（RFC-001 §2.3），不在 payload 里。
- `isVisibleTo(event, observer, state)` 定义在 `src/shared/visibility.ts`（RFC-001 已交付），本 RFC 负责**行为规则**与测试矩阵：

| `visibleTo` | 谁可见 |
|---|---|
| `public` | 所有观察者 |
| `wolves` | 角色为 `wolf` 的席位，且**该席位的死亡事件不早于本事件**（死狼看不到死后发生的事，见 §2.4） |
| `seer` / `witch` / `hunter` | 对应角色的席位，且死亡不早于本事件 |
| `self:<n>` | 仅席位 n，且死亡不早于本事件 |

「死亡不早于本事件」用 `state` 中该席位的出局事件 `seq` 与当前事件 `seq` 比较得出。

### 2.2 狼人夜间私聊

阶段 `NIGHT_WOLF_CHAT`（RFC-003 中占位跳过），位于 `NIGHT_WOLVES` 之前。

- 每个**存活**狼人提交且仅提交一条 `WOLF_CHAT`（`text` 可为空串，表示「我先听」）。
- 已提交的席位记录在状态里（由 `WOLF_CHAT_POSTED` 事件推导）。这是 RFC-001 §2.3 的 C-18 派生字段规则在本 RFC 的实例：只由 `applyEvent` 写，且可完整重建。
- **当所有存活狼都提交过一条后**，阶段推进到 `NIGHT_WOLVES`。这是确定性的、有界的退出条件，不依赖编排层判断「AI 说完了没有」。
- 白天提交 `WOLF_CHAT` → `Rejected`（`code: 'PHASE_MISMATCH'`）。

事件：`WOLF_CHAT_POSTED`，`visibleTo: 'wolves'`，payload `{ seat, text, round: 'night-chat' }`。

### 2.3 狼人自曝

`SELF_EXPOSE` 允许在 `DAY_SPEECH` 与 `DAY_VOTE` 两个阶段提交（**不要求轮到该狼发言**——真实局里自曝常常是插话）。

结算：

1. 校验：提交者必须是**存活**的 `wolf` 席位，否则 `Rejected`（`code: 'NOT_A_WOLF'` / `'NOT_ALIVE'`）。
2. 产出 `SELF_EXPOSE` 事件（`visibleTo: 'public'`，payload `{ seat }`）。
3. **当日立即结束**：发言队列清空、投票取消（RUL-4），`phase` 直接进入 `NIGHT_WOLF_CHAT`。

自曝日不产生任何投票相关事件。

### 2.4 死狼的可见性收窄

冷读指出一个真实冲突：若死狼仍能看见死后夜聊，就与 PRD FR-11 与 D35（观战态默认只见公开信息）矛盾。

本 RFC 的裁决：**死亡之后的事件，该席位不可见**——包括狼夜聊。这既符合「死人不能参与」的直觉，也不给观战态开口子。真相视图（RFC-013）是唯一的例外，且只对玩家本人开放、不写事件流。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/visibility.ts` | `isVisibleTo` 的行为实现（委托 `shared/visibility`，补充状态比较） |
| `src/engine/phases/wolf-chat.ts` | `NIGHT_WOLF_CHAT` |
| `src/engine/actions/self-expose.ts` | 自曝结算 |
| `tests/engine/visibility.test.ts` | 可见性矩阵 |
| `tests/engine/wolf-chat.test.ts` | 夜聊与退出条件 |
| `tests/engine/self-expose.test.ts` | 自曝与当日终止 |

## 4. 实现要点

- `isVisibleTo` 的判定逻辑只写一份（`src/shared/visibility.ts`），`src/engine/visibility.ts` 只做状态相关的补充（死亡时间比较），不得复制角色判断。
- 自曝后进入的下一阶段是 `NIGHT_WOLF_CHAT`（不是直接 `NIGHT_WOLVES`），否则会跳过狼队协商。
- 夜聊文本长度不限（PRD 只约束白天玩家发言的 300 字），但写入事件前截断到 500 字，避免事件流膨胀。
- 自曝校验的角色与存活判定走 RFC-003 的 `Rejected` 机制，不抛异常。

## 5. 验收标准

1. `isVisibleTo` 对 `public` 事件对所有观察者返回 `true`
2. 对 `wolves` 事件：存活狼返回 `true`、存活好人返回 `false`
3. 对 `wolves` 事件：在事件发生前已出局的狼返回 `true`，在事件发生后出局的狼返回 `true`，在事件之前就死亡的狼返回 `false`（死亡时间与事件 `seq` 比较）
4. 对 `self:<n>` 事件：仅席位 n 返回 `true`，其余 8 席返回 `false`
5. 夜晚存在 `NIGHT_WOLF_CHAT`，且排在 `NIGHT_WOLVES` 之前；自曝后的下一阶段也是它
6. 每个存活狼各提交一条 `WOLF_CHAT` 后产出对应的 `WOLF_CHAT_POSTED` 事件，`visibleTo === 'wolves'`
7. 所有存活狼都提交后阶段自动推进到 `NIGHT_WOLVES`；未全部提交前提交 `WOLF_KILL` 产出 `Rejected`（`code === 'PHASE_MISMATCH'`）
8. `WOLF_CHAT` 的 `text` 为空串时同样算提交，阶段照常推进
9. 白天提交 `WOLF_CHAT` 产出 `Rejected`，除 `seq` 外状态不变
10. 存活狼在 `DAY_SPEECH` 或 `DAY_VOTE` 提交 `SELF_EXPOSE` 后：产出 `SELF_EXPOSE` 公开事件、当日投票被取消、`phase` 进入 `NIGHT_WOLF_CHAT`
11. 自曝后到当日结束为止，事件流中不含任何 `VOTE_CAST` 或 `VOTE_REVEALED` 事件
12. 非狼人提交 `SELF_EXPOSE` 产出 `Rejected`（`code === 'NOT_A_WOLF'`）；已出局狼提交产出 `Rejected`（`code === 'NOT_ALIVE'`）
13. 自曝不改变存活计数，因此不触发任何 `WIN_CHECK` 结论变化
14. 对任意狼夜聊事件，好人观察者经 `isVisibleTo` 过滤后得到的事件集合中不含该事件（对 9 个观察者全覆盖）

## 6. 边界与测试

- **不做**：AI 狼是否/何时自曝（RFC-009）、夜聊内容生成（RFC-006）、夜聊 UI（RFC-011）。
- **与 RFC-007 的接口**：`project()` 必须调用 `isVisibleTo`，否则夜聊会漏给好人。该集成断言写在 RFC-007 的验收标准里（本 RFC 的前置不包含 007，故不在本 RFC 断言）。
- **测试**：可见性用「事件类型 × 观察者角色 × 死亡时序」三维矩阵参数化；自曝用「当天没有投票事件」断言。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-005-1 | 死狼能否看见死后的夜聊 | **(assumption)** 不能；见 §2.4。若需要，只能通过真相视图（RFC-013） |
| Q-005-2 | 自曝后当日已产生的发言事件是否保留 | **(assumption)** 保留，它们是已发生的公开事实 |
| Q-005-3 | 狼人能否在 `DAY_ANNOUNCE` 阶段自曝 | **(assumption)** 不能；该阶段玩家尚未发言，自曝没有信息价值 |
