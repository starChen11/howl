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
| `wolves` | 角色为 `wolf` 的席位，**不看死活**——狼队频道在成员出局后继续（用户裁决，见 §8.1） |
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

### 2.4 死狼仍然看得到狼队频道

初稿假设「死狼看不到死后的夜聊」，用户裁决**反过来**：狼队是队伍频道，成员出局后仍可旁观，信息流不因出局中断。

- 实现上：`isVisibleTo` 对 `wolves` **只校验角色**，不比较 `diedSeq`；
- `seer` / `witch` / `hunter` / `self:<n>` 是**个人频道**，人死了就不会再有新内容，仍按死亡时间收窄；
- 这**不给观战态开口子**：观战者不是狼，`wolves` 事件对他仍不可见；真相视图（RFC-013）不写事件流。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/engine/phases/wolf-chat.ts` | `NIGHT_WOLF_CHAT` |
| `src/engine/phases/self-expose.ts` | 自曝结算 |
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
3. 对 `wolves` 事件：**只要是 wolf 就返回 `true`，与死亡时间无关**（死狼仍能看狼队频道，见 §2.4）。`seer` / `witch` / `hunter` / `self:<n>` 仍按死亡时间收窄（死前的事件可见、死后的不可见）
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
| Q-005-1 | 死狼能否看见死后的夜聊 | **已裁决：能**（用户裁定，与初稿假设相反）。见 §2.4 与 §8.2 D-1 |
| Q-005-2 | 自曝后当日已产生的发言事件是否保留 | **(assumption)** 保留，它们是已发生的公开事实 |
| Q-005-3 | 狼人能否在 `DAY_ANNOUNCE` 阶段自曝 | **(assumption)** 不能；该阶段玩家尚未发言，自曝没有信息价值 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。分支 `main`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 死狼能否看见死后的夜聊（Q-005-1） | **能**（用户裁决，与 RFC 初稿假设相反）：狼队频道不因成员出局中断 |
| TODO 3 的交付物 | 不新建 `src/engine/visibility.ts`（用户同意）：`isVisibleTo` 已在 `src/shared/visibility.ts` 里实现并经测试 |
| Q-005-2 / Q-005-3 | Q-005-2 保持（自曝前的发言事件保留）；Q-005-3 **关闭**——`DAY_ANNOUNCE` 是自动阶段，玩家停不在那里，问题在机制上不存在 |

### 8.2 偏离与决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 可见性里 `wolves` **不看死活**；`seer` / `witch` / `hunter` / `self:<n>` 仍按死亡时间收窄 | 只有狼有「队伍频道」这种死后仍在继续的信息流；个人频道人死了就不会再有新内容。**`self:<n>` 原本没有做死亡收窄**（RFC-001 的实现只在角色分支之后判断），本 RFC 补齐——否则 RFC-005 §2.1 的表与实现不一致 |
| **D-2** | 夜聊的退出条件是「每只**存活**狼各提交一条」，空串也算 | 有界、确定，不依赖编排层判断「AI 说完了没有」 |
| **D-3** | 文本超长**截断**到 500 字，不拒绝 | 狼队内部发言不该因为太长而卡住流程（§4） |
| **D-4** | 夜聊重复提交返回 `ALREADY_SPOKEN` | §2.2 只要求「每人一条」，没给拒绝码；与投票的 `ALREADY_VOTED` 对称 |
| **D-5** | 自曝后进 `NIGHT_WOLF_CHAT`，**不是** `NIGHT_WOLVES` | 否则跳过狼队协商（§4 明文要求） |
| **D-6** | `START` 不再产出相位推进事件 | `GAME_STARTED` 已把相位设成 `NIGHT_WOLF_CHAT`；RFC-003 时代的「跳过夜聊」补丁随之删除 |

### 8.3 AC 修正

| AC | 原文 | 问题 | 改为 |
|---|---|---|---|
| **AC-3** | 「在事件发生**前**已出局的狼返回 `true`，在事件发生后出局的狼返回 `true`，在事件**之前就死亡**的狼返回 `false`」 | 第一句与第三句**说的是同一种情形、结论相反**（「事件前已出局」= 「事件之前就死亡」），实现无法同时满足 | 按用户裁决统一为：**只要是狼就能看狼队事件，与死亡时间无关**；`seer` / `witch` / `hunter` / `self` 仍是「死前可见、死后不可见」 |

### 8.4 连带改动：RFC-001 §2.4 的规则文字

RFC-001 的 `isVisibleTo` 判定说明里写着 `wolves` 要求 `seat.diedSeq` 未定义或 `> event.seq`。D-1 之后这句不再成立，已在 RFC-001 §2.4 注明「`wolves` 的死亡收窄由 RFC-005 的裁决取消」。**RFC-001 的验收标准没有变化**（它没有断言死亡时序），所以状态保持 `Reviewed`。

### 8.5 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 引擎新增 | `src/engine/phases/wolf-chat.ts`、`src/engine/phases/self-expose.ts` |
| 引擎修改 | `src/engine/step.ts`（`START` 停在夜聊、并入两组 handler）、`src/engine/transitions.ts`（夜聊与自曝的允许集）、`src/engine/phases/vote.ts`（`enterNight` 只发一条相位事件）、`src/engine/apply.ts`（折叠两个新事件、入夜清空 `wolfChat`） |
| 共享修改 | `src/shared/visibility.ts`（wolves 豁免死亡收窄、self 补齐死亡收窄）、`src/shared/domain.ts`（`wolfChat`）、`src/shared/schemas.ts`（两个 schema） |
| 测试新增 | `tests/engine/{visibility,wolf-chat,self-expose}.test.ts` |
| 测试修改 | `tests/fixtures/night.ts`（`nightStart` 先过夜聊）、`tests/engine/{full-game,replay-parity,witch,day,events,reject,replay,transitions}.test.ts`、`tests/shared/schemas.test.ts` |
| 文档 | 本文件 §8、`RFCs/RFC-001` §2.4、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.6 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `visibility.test.ts` · `public` 对 9 个观察者全真；`server` 全假 | PASS |
| 2 | 同上 · `wolves` 对 9 个观察者按阵营判定 | PASS |
| 3 | 同上 · 死在事件之前的 wolf 仍可见（反向探针：去掉豁免 → 变红） | PASS |
| 4 | 同上 · `self:4` 恰好 1/9 可见；死前的事件可见、死后的不可见 | PASS |
| 5 | `wolf-chat.test.ts` · 发牌后停在 `NIGHT_WOLF_CHAT`；未全部提交前 `WOLF_KILL` → `PHASE_MISMATCH` | PASS |
| 6 | 同上 · `WOLF_CHAT_POSTED` 可见性 `wolves`、payload 带 `round` | PASS |
| 7 | 同上 · 全部提交后进入 `NIGHT_WOLVES` | PASS |
| 8 | 同上 · 空串同样推进 | PASS |
| 9 | 同上 · 白天提交 → `Rejected`，除 `seq` 外不变 | PASS |
| 10 | `self-expose.test.ts` · 两个白天阶段自曝 → 公开事件 + 进 `NIGHT_WOLF_CHAT` | PASS |
| 11 | 同上 · 自曝事件流无 `VOTE_CAST` / `VOTE_REVEALED`；此前的发言事件保留 | PASS |
| 12 | 同上 · 非狼 → `NOT_A_WOLF`；出局狼 → `NOT_ALIVE` | PASS |
| 13 | 同上 · 自曝前后存活计数相同 | PASS |
| 14 | `visibility.test.ts` · 9 个观察者过滤后只有狼能看到夜聊 | PASS |

### 8.7 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → Test Files 44 passed (44) · Tests 366 passed (366)
$ coverage → 行 96.95% / 分支 93.31%；新文件 wolf-chat.ts / self-expose.ts / visibility.ts 均 100%
```

### 8.8 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| `project()` 没有实现 | AC-14 只在 `isVisibleTo` 层验证；投影必须调用它，否则夜聊会漏给好人 | RFC-007 |
| 夜聊内容生成 | 本 RFC 只定义通道与有界退出 | RFC-006 |
| 死狼能看夜聊的观感 | 观战态（RFC-013）与玩家视角（RFC-011）都要注意别把这层"死人视角"显示给活人 | RFC-011 / 013 |

### 8.9 Round 1 回应（Changes requested · High）

| 项 | 问题 | 处理 |
|---|---|---|
| **B1 / C-35** 第二夜起没有夜聊 | `vote.ts` 的 `enterNight` 仍发两条相位事件，直接跳到 `NIGHT_WOLVES`；而 `vote.test.ts` / `lynch.test.ts` 把「跳过夜聊」写成断言，所以这条错误行为被测试锁住了。我上一轮声称改过它——**替换是静默失败的**（目标串被 prettier 重排过），和 C-30 / C-34 是同一类错误 | `enterNight` 只发 `→NIGHT_WOLF_CHAT`；5 条把「跳过」当预期的断言改为 `NIGHT_WOLF_CHAT`。新增用例：放逐后进入 `NIGHT_WOLF_CHAT` 且 `wolfChat` 为空 |
| **B2 / C-36** 自曝不取消已投出的票 | 入夜时没清 `votes`，旧票会带到下一天，把已出局席位算成最高票 → `PLAYER_DIED 重复` 崩溃。合法 action 序列 | `applyPhaseChanged` 进入 `NIGHT_WOLF_CHAT` 时清空 `votes` / `runoff` / `lynched`。新增用例：投票阶段先投两票再自曝，入夜后 `votes` 为空 |
| **B3 / C-37** 正文没回写裁决 | §2.1 的 `wolves` 行、§2.4、Q-005-1、AC-3 仍是初稿的「死狼看不到」 | 四处全部改写为「wolf 频道不中断」，并在 AC-3 写明个人频道仍按死亡时间收窄 |
| **C-38**（非阻塞） | 500 字截断无测试 | 补用例：600 字输入 → 事件 payload 恰好 500 字 |

反向探针（本轮实跑）：把 `enterNight` 改回两条 → 第二夜用例变红；去掉 `delete next.votes` → 自曝清票用例变红。

```
$ pnpm test → 44 files / 369 tests 全绿
$ coverage → 行 96.96% / 分支 93.31%
```

### 8.10 Spec changed（CHANGE-REQUEST-012 / RFC-018）

狼队夜聊由「每人一句后推进」改成**限时聊天室**：`WOLF_CHAT` 可多条，新增 `WOLF_READY`，
全员准备或 50 秒到才进入 `NIGHT_WOLVES`。见 RFC-018。
