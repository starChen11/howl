# RFC-022 · 完整警长竞选与警徽

**Features**: F49, F4, F5
**Depends on**: RFC-002, RFC-003, RFC-004, RFC-006, RFC-007, RFC-012, RFC-014, RFC-020, RFC-021
**Rules**: RUL-1, RUL-2, RUL-9, RUL-14, RUL-15, RUL-16, RUL-18
**Complexity**: Large

---

## 1. 摘要

在 9 人标准局加入**完整警长**：

- 首夜死讯公布前竞选；
- 9 名玩家均可上警，警上依次竞选发言，可退水；
- 从未上警的玩家投票；平票 PK 后警下重投，二次平票无警长；
- 警长放逐票 **1.5**，决定每日发言顺序并最后发言；
- 警长死亡后可移交警徽给存活玩家或撕徽。

## 2. 竞选流程

```
NIGHT_RESOLVE（首夜结算，死讯仍保密）
→ DAY_SHERIFF_SIGNUP     所有人选择上警 / 不上警
→ DAY_SHERIFF_SPEECH     警上按座位顺序各发言一次
→ DAY_SHERIFF_WITHDRAW   警上可选择退水（退水者无投票权）
→：
   · 无候选人 / 全員上警且无人退水 → 无警长
   · 只剩 1 名候选人 → 直接当选
   · 否则 DAY_SHERIFF_VOTE：从未上警的玩家投票
        · 唯一最高票 → 当选
        · 平票 → DAY_SHERIFF_PK（平票者各发言一次）
                 → DAY_SHERIFF_RUNOFF（警下只能投平票者，不能弃权）
                    · 唯一最高票 → 当选
                    · 再次平票 → 无警长
→ DAY_SHERIFF_RESULT（自动）
→ DAY_ANNOUNCE（公布首夜死讯；竞选期自曝也走这里）
→ 若首夜死者中有猎人：NIGHT_HUNTER_SHOOT（公布死讯之后才开枪）
→ 若警长在首夜死亡：DAY_BADGE_TRANSFER（移交警徽 / 撕徽）
→ DAY_SHERIFF_ORDER（警长选择今天从谁开始、方向）
→ DAY_SPEECH（警长在正常轮转中照常发言）
→ DAY_SHERIFF_FINAL_SPEECH（所有人说完后，警长额外归票发言一次）
→ DAY_VOTE
```

### 2.1 首夜死者参与

竞选发生在死讯公布前，因此**9 名玩家名义上都可上警、发言、投票**；服务端知道首夜死亡，
但投影不得泄露。若当选警长在首夜死亡：

1. 先公布死讯；
2. 进入 `DAY_BADGE_TRANSFER`，由其选择存活玩家接任或撕徽；
3. 再进入当天发言。

### 2.2 边界

| 情况 | 结果 |
|---|---|
| 无人上警 | 本局无警长 |
| 所有人上警且无人退水 | 没有警下投票人 → 无警长 |
| 上警者全部退水 | 无警长 |
| 只有一名候选人（含退水后只剩一人） | 直接当选，不投票 |
| 警下全员弃权/无人得票 | 无警长 |
| 平票 PK 后再次平票 | 无警长 |
| 狼人在竞选期间自曝 | 中止竞选、本局无警长；**仍先公布首夜死讯**，处理猎人开枪后进入夜晚 |

## 3. 警长权力

### 3.1 1.5 票

- 放逐投票中，普通玩家一票 = 2 个半票单位，警长一票 = 3 个半票单位；
- 内部一律用整数半票计票，禁止浮点；
- 票型公布时同时显示原始票数与折算票数（例如「3 号 2.5 票」）；
- 平票判定按折算票数；重投仍按同一折算规则。

### 3.2 发言顺序与归票

每天 `DAY_SPEECH` 前由警长选择一次 `DAY_SHERIFF_ORDER`：

| 昨夜死亡 | 可选起点 |
|---|---|
| 恰好 1 人 | 死者左侧 / 右侧的第一位存活玩家 |
| 平安夜或 ≥2 人 | 警长左侧 / 右侧的第一位存活玩家 |

- 顺时针或逆时针由起点决定（实现时把方向写进事件，不靠位置猜）；
- 警长在正常轮转中**照常发言**；所有人说完后，警长额外进行一次 **归票发言**（`DAY_SHERIFF_FINAL_SPEECH`）；
- 如果警长死亡并由他人接任，新警长当天也做归票发言；
- 无警长时回退 RFC-004 的旧规则（死者下一位 / 随机座位）。

### 3.3 警徽移交 / 撕徽

警长被狼刀、毒杀、放逐、猎人开枪等任何方式杀死后：

- 进入 `DAY_BADGE_TRANSFER`（夜间死亡则在当日 `DAY_ANNOUNCE` 后）；
- 可选择一名**存活且非自己**的玩家接任，或撕徽（本局不再有警长）；
- 接任者立即获得 1.5 票、发言顺序决定权与最后发言权；
- 不接任/超时默认撕徽；
- 猎人开枪导致警长死亡时，先结算开枪，再移交。

## 4. 状态与事件

新增公开状态：

- `sheriffSeat: SeatId | null`
- `sheriffElection`: `{ candidates, withdrawn, voters, votes, runoff, phase }`
- `badge`: `'held' | 'destroyed'`

新增事件（全部写入事件流，复盘可见）：

`SHERIFF_ELECTION_STARTED`、`SHERIFF_SIGNUP`、`SHERIFF_CANDIDATES`、
`SHERIFF_WITHDRAWN`、`SHERIFF_VOTE_CAST`（私有）、`SHERIFF_VOTE_REVEALED`、
`SHERIFF_ELECTED`、`SHERIFF_ELECTION_FAILED`、`BADGE_TRANSFERRED`、
`BADGE_DESTROYED`、`SHERIFF_ORDER_CHOSEN`。

## 5. 新相位与动作

| 相位 | 动作 | 说明 |
|---|---|---|
| `DAY_SHERIFF_SIGNUP` | `SHERIFF_SIGNUP { run }` | 9 人各一次 |
| `DAY_SHERIFF_SPEECH` | `SPEECH` / `SPEECH_SKIP` / `SELF_EXPOSE` | 仅警上 |
| `DAY_SHERIFF_WITHDRAW` | `SHERIFF_WITHDRAW` | 仅警上 |
| `DAY_SHERIFF_VOTE` | `SHERIFF_VOTE { target | abstain }` | 仅警下 |
| `DAY_SHERIFF_PK` | `SPEECH` / `SPEECH_SKIP` | 仅平票者 |
| `DAY_SHERIFF_RUNOFF` | `SHERIFF_VOTE { target }` | 仅警下、仅平票者、不能弃权 |
| `DAY_SHERIFF_RESULT` | 自动 | 产生警长/无警长 |
| `DAY_BADGE_TRANSFER` | `BADGE_TRANSFER { target | tear }` | 仅死亡警长 |
| `DAY_SHERIFF_ORDER` | `SHERIFF_ORDER { start, direction }` | 仅警长 |
| `DAY_SHERIFF_FINAL_SPEECH` | `SPEECH` / `SPEECH_SKIP` | 仅警长，额外归票发言 |

所有新相位继承 RFC-021 的可配置倒计时；默认 120 秒。

## 6. AI

- 上警决定：每个 AI 在 `DAY_SHERIFF_SIGNUP` 调用一次；
- 竞选发言：仅警上 AI 调用；
- 退水：每个警上 AI 一次；
- 警下投票：仅从未上警的 AI 调用；
- 警长选顺序、警徽移交：警长 AI 调用；
- 提示词新增：`sheriffSeat`、`badge`、`candidates`、`voters`、`isCandidate`、`isVoter`；
- 所有决策仍走 `AI_THOUGHT`，复盘可见理由与选择。

## 7. UI

- 上警/不上警按钮与状态；
- 竞选发言列表、警上/警下标签；
- 警下投票界面（候选人不可投）；
- 警徽图标、警长标识；1.5 票的票数展示；
- 警长选发言顺序控件；
- 警长死亡后的移交/撕徽弹窗；
- 每天状态条显示「警长：N 号」或「本局无警长」。

## 8. 验收标准

1. 首夜结算后、死讯公布前进入竞选，且投影不泄露首夜死者；
2. 9 人上警/不上警各一次，警上按座位顺序发言；
3. 退水者无投票权；只有从未上警的玩家能投警长票；
4. 平票进入 PK 发言，再投只对平票者且不能弃权；二次平票无警长；
5. 无人上警、全员上警无人退水、无有效票均无警长；
6. 警长放逐票计 1.5，内部半票整数，票型显示正确；
7. 警长决定当天发言起点与方向；正常轮转后额外做一次归票发言；
8. 无警长时回退旧发言顺序；
9. 警长夜间死亡：死讯公布、猎人开枪后进入移交/撕徽，再发言；
10. 警长白天被放逐/被枪：先结算死亡，再移交/撕徽；
11. 移交只能给存活他人；撕徽后本局无警长；
12. 首夜死亡者可以上警/投票；若当选后死亡，按第 9 条处理；
13. 竞选期间狼人自曝 → 吞警徽、无警长；仍公布首夜死讯并处理猎人开枪后进入夜晚；
14. 新相位有可配置倒计时，超时按默认动作处理（弃权/不竞选/不发言/撕徽）；
15. 竞选、投票、移交、顺序选择全部写入事件流与复盘；
16. 脚本 AI 与真实模型都能走完整流程，不出现卡死。

## 9. 风险

- **平衡**：9 人局 1.5 票权重很大；先按用户选择实现，用种子/统计观察胜率，必要时后续调整。
- **复杂度**：新增 9 个相位与 11 类事件，必须完整覆盖超时与非法动作，不能留下死锁。
- **信息泄露**：竞选在死讯前，投影必须严格隐藏首夜死亡；这是本 RFC 的最高安全风险。
- **AI 成本**：每局增加约 9～15 次调用，首日延迟上升。

## 10. Implementation Notes

尚未实现。等待实现计划批准后按 RFC-021 的 timer 配置接入所有新相位。

## 11. 用户已确认的规则选择（2026-11-25）

1. 首夜猎人被刀：**先竞选，公布死讯后再开枪**；枪口死者参加过竞选。
2. 竞选期狼人自曝：**先公布首夜死讯**，处理猎人开枪后进入夜晚；本局无警长。
3. 警长发言：正常轮转中照常发言，所有人说完后**额外做一次归票发言**。

## 12. 待修设计阻塞（评审 2026-11-25）

实现前必须补齐：

- 首夜死亡在投影/真相视图/夜间猎人开枪中的保密边界；
- 首夜死者的“未公布死亡”参与集合，不能复用 `aliveSeats`；
- F4/F5/PRD FR-5/FR-6 的无警长回退与 1.5 票验收；
- `NIGHT_RESOLVE → 竞选 → DAY_ANNOUNCE → 猎人开枪 → 警徽移交` 的完整转移；
- 竞选发言独立事件/cursor，不复用白天 `speech`；
- 竞选各动作的调度、超时默认与 `pending`；
- 1.5 票的 tally/payload/UI/prompt 契约；
- `sheriffElection` 公开/私有机会话拆分与状态折叠；
- 新相位/动作/事件/payload/可见性/shared schema 全量契约。

详细评审结论见本轮设计评审报告；解决后再进入实现。

## 13. 设计评审后的落实方案

### 13.1 首夜死亡延后落地

为同时满足「死讯公布前竞选」和「首夜死者可参与」，首夜不再在 `NIGHT_RESOLVE` 立即把席位标成死亡：

- `NIGHT_RESOLVE` 只计算并暂存 `pendingDeaths`（含狼刀/毒药），胜负判定延后到死讯落地后；
- 竞选期间 `aliveSeats` 仍是 9 人，投影、真相视图、身份卡都不会提前显示死亡；
- `DAY_ANNOUNCE` 才把 `pendingDeaths` 应用到席位并公布；
- 公布后如有猎人，进入 `DAY_HUNTER_SHOOT`；再处理警长死亡移交；
- 竞选期间自曝同样先走 `DAY_ANNOUNCE`，再入夜。

这比给投影加一层「假装活着」更安全：死亡在事件流里真的还没发生。

### 13.2 竞选发言独立

竞选发言不复用白天的 `SPEECH` cursor：新增 `SHERIFF_SPEECH` / `SHERIFF_SPEECH_SKIPPED` 事件与独立轮次状态，避免 `DAY_STARTED` 重置和客户端 `spokenSeats` 污染。

### 13.3 发言顺序与归票

- `SHERIFF_ORDER_CHOSEN` 携带 `startSeat` 与 `direction`，是当天发言顺序的权威；
- `DAY_STARTED.speechStartSeat` 只作为无警长默认值；
- 警长在正常轮转中照常发言；全员说完后进入 `DAY_SHERIFF_FINAL_SPEECH`，警长额外发言一次，再投票。

### 13.4 1.5 票契约

- 引擎内部：普通票 2 个半票单位，警长票 3 个；
- `VOTE_REVEALED` 增加 `countedVotes`（每位玩家折算后的半票数）与 `sheriffSeat` 快照；
- `applyVoteRevealed`、`runoff`、UI、prompt、复盘全部读折算票；原始票仍保留供审计；
- 重投同规则，警长 1.5 继续生效。

### 13.5 竞选动作与超时

| 相位 | 默认动作 |
|---|---|
| 上警 | 不上警 |
| 竞选发言 | 跳过 |
| 退水 | 不退水 |
| 警下投票 | 弃权 |
| PK 发言 | 跳过 |
| 重投 | 投第一个并列者（不能弃权） |
| 警长选顺序 | 沿用无警长默认 |
| 归票发言 | 跳过 |
| 警徽移交 | 撕徽 |

所有新相位接入 RFC-021 的 `PhaseTimers`，默认 120 秒。

### 13.6 状态

公开：`sheriffSeat`、`sheriffCandidates`、`sheriffVoters`、`badge: 'none'|'held'|'destroyed'`。
私有/服务端：`sheriffVotes`、`sheriffRunoff`。
选举失败/从未有警长是 `badge='none'`；被撕是 `'destroyed'`。

### 13.7 仍未清除的门禁

RFC-022 的前置 RFC-002/004/006/007/012/014/021 仍是 `Spec changed`，RFC-003/013/015 也被实际影响。
在这些 delta 未实现/复核前，不写实现代码；需要决定是否允许「RFC-022 作为统一实现载体」一次性落地并随后整体评审。

## 14. Implementation Notes（2026-11-26）

**Status**: Implemented（等待 /review-rfc）

### 实现范围

- 引擎与共享契约：10 个新相位、5 个动作、13 类事件、半票整数计票、警长竞选/移交/定序/归票；
- 首夜死亡延后到 `DAY_ANNOUNCE`，竞选期投影与真相不泄露死亡；猎人开枪在死讯公布后；
- 服务端编排、AI 动作、投影、prompt、工具路由、复盘/真相全部接入；
- 前端上警/退水/警下投票/PK/定序/移交/归票面板，警长标识与 1.5 票展示，首夜死亡遮蔽；
- E2E helper 支持跳过竞选；主路径、手机布局、键盘、猎人、复盘 e2e 全部通过。

### 偏离/补充

- RFC 原写「9 个相位」，实际为 10 个（含 `DAY_SHERIFF_FINAL_SPEECH`）；已全部实现。
- 额外增加 `SHERIFF_SPEECH` / `SHERIFF_SPEECH_SKIPPED` 事件（竞选发言独立 cursor）。
- `DAY_SHERIFF_ORDER` 超时默认没有「旧合法默认」时，选第一个合法选项；记录为 deviation。
- 首夜死亡事件在 `DAY_STARTED` 之后以 server 可见事件落地；公开死讯仍只有 `diedLastNight`。
- `AI_THOUGHT.detail`、`TruthView.sheriff` 为向后兼容 additive 字段。
- 竞选期自曝在所有竞选可行动子阶段允许；`DAY_SHERIFF_FINAL_SPEECH` 不允许自曝（按 RFC 表格）。

### 验证

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0（root/server/client） |
| `vitest --project unit --project client` | 96 files / 958 tests passed |
| `vitest --project meta` | 7 files / 35 tests passed |
| `pnpm test:e2e` | 16 tests passed |
| `pnpm lint` / `format:check` / `build` | 全部 exit 0 |

### 改动文件

```text
src/client/App.tsx
src/client/components/EventPanel.tsx
src/client/components/SeatGrid.tsx
src/client/components/SheriffPanel.tsx
src/client/components/SpeechFeed.tsx
src/client/components/SpeechInput.tsx
src/client/components/StatusBar.tsx
src/client/components/VoteInput.tsx
src/client/game-state.ts
src/client/styles/global.css
src/engine/apply.ts
src/engine/phases/auto-table.ts
src/engine/phases/day.ts
src/engine/phases/lynch.ts
src/engine/phases/night.ts
src/engine/phases/self-expose.ts
src/engine/phases/sheriff.ts
src/engine/phases/vote.ts
src/engine/step.ts
src/engine/transitions.ts
src/server/ai/agent.ts
src/server/config/phase-timers.ts
src/server/llm/prompts/base.ts
src/server/llm/schema.ts
src/server/llm/to-action.ts
src/server/orchestrator.ts
src/server/project/index.ts
src/server/project/targets.ts
src/server/project/timer.ts
src/server/replay/snapshot.ts
src/server/routes/games.ts
src/server/selfplay/runner.ts
src/server/selfplay/scripted-player.ts
src/server/view/truth.ts
src/shared/actions.ts
src/shared/api.ts
src/shared/domain.ts
src/shared/events.ts
src/shared/phase-labels.ts
src/shared/project.ts
src/shared/schemas.ts
src/shared/terms.ts
src/shared/truth.ts
src/shared/votes.ts
tests/client/game-state-sheriff.test.ts
tests/client/sheriff.test.tsx
tests/e2e/browsers.spec.ts
tests/e2e/game.spec.ts
tests/e2e/helpers.ts
tests/engine/day.test.ts
tests/engine/death-resolve.test.ts
tests/engine/full-game.test.ts
tests/engine/night-visibility.test.ts
tests/engine/night.test.ts
tests/engine/sheriff.test.ts
tests/engine/transitions.test.ts
tests/engine/witch.test.ts
tests/fixtures/day.ts
tests/fixtures/night.ts
tests/fixtures/sheriff.ts
tests/helpers/sheriff.ts
tests/server/channels.test.ts
tests/server/death-matrix.test.ts
tests/server/finished-game.test.ts
tests/server/game-loop.test.ts
tests/server/llm/prompts.test.ts
tests/server/llm/to-action.test.ts
tests/server/orchestrator.test.ts
tests/server/project/knowledge.test.ts
tests/server/project/night-visibility.test.ts
tests/server/release-and-entry.test.ts
tests/server/sheriff-integration.test.ts
tests/server/sheriff-projection.test.ts
tests/server/speak.test.ts
tests/server/stream.test.ts
tests/server/truth.test.ts
tests/server/wolf-chat-room.test.ts
tests/shared/actions.test.ts
tests/shared/domain.test.ts
tests/shared/events.test.ts
tests/shared/schemas.test.ts
tests/shared/terms.test.ts
tests/shared/votes.test.ts
```
