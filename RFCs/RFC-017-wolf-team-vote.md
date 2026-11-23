# RFC-017 · 狼队投票决定刀谁

**Features**: F3, F9, F10
**Depends on**: RFC-003, RFC-005
**Rules**: ARCH-3, ARCH-11, DATA-2, RUL-13
**Complexity**: Medium
> 关联需求：FR-17（严格规则集）、G4（为联机留位）

---

## 1. 摘要

「今晚刀谁」从**第一个出手的狼决定**改成**狼队投票**：每名存活狼各一票，票型只有狼可见；
平票只对并列者重投；重投仍僵持时取并列者里席位最小的那个（否则会永远投下去）。

这条规则是为**真人联机**留的位：三狼都是真人时，共同决定不能被一个人代劳。

## 2. 技术方案

### 2.1 规则（RUL-13）

1. 每名存活狼**各投一票**，只能投存活且非狼的席位；死狼不投。
2. 全员投完后唱票：唯一最高票 → 该席位成为刀口。
3. 平票 → 只对并列者重投；重投不能弃权、不能投并列者以外的人。
4. 重投仍未收缩（并列者各得一票）→ **取并列者中席位最小者**（兜底，保证终止）。
5. 唱票结果与票型只对狼可见；好人看不到任何狼队投票信息。

### 2.2 相位与动作

```
NIGHT_WOLF_CHAT（讨论，每人一句）
  → NIGHT_WOLVES（狼队投票）
  → [NIGHT_WOLF_RUNOFF（平票重投）…]
  → NIGHT_SEER → NIGHT_WITCH → NIGHT_RESOLVE
```

| 相位 | 动作 | 说明 |
|---|---|---|
| `NIGHT_WOLVES` | `WOLF_VOTE {seat, target}` | 每名狼一次；旧 `WOLF_KILL` 仅引擎层保留用于旧回放，HTTP 层会拒绝 |
| `NIGHT_WOLF_RUNOFF` | `WOLF_VOTE` | 目标必须在 `state.wolfRunoff` 里 |

### 2.3 事件与状态

| 类型 | 可见性 | payload |
|---|---|---|
| `WOLF_VOTE_CAST` | `wolves` | `{ seat, target }` |
| `WOLF_VOTE_REVEALED` | `wolves` | `{ votes, tied? }`（`tied` 非空 → 进入重投） |
| `WOLF_KILL_CHOSEN` | `wolves` | `{ target }`（沿用） |

`GameState` 增加 `wolfVotes?: { seat, target }[]` 与 `wolfRunoff?: SeatId[]`；`WOLF_VOTE_REVEALED`
负责清空本轮票并设置/清除重投候选。

### 2.4 投影与编排

- `pending`：`wolf-vote` / `wolf-runoff`；`legalTargets` 分别是「存活非狼」与「并列者」。
- `nextActor`：返回还没投票的狼（按席位序）；玩家自己的那一票走输入通道。
- 界面：投票阶段显示**实时票型**（用户选择），重投阶段只列并列者。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/shared/{actions,events,domain,schemas,project}.ts` | 新动作、两条事件、相位、票型状态、pending |
| `src/engine/phases/night.ts` | `tallyWolfVotes` 与 `WOLF_VOTE` handler |
| `src/engine/{transitions,apply}.ts` | 相位转移与票型折叠 |
| `src/server/{orchestrator,project/targets,routes/games,ai/agent}.ts` | 行动者、合法目标、输入兑现、脚本 AI |
| `src/client/components/NightAction.tsx` | 狼队投票界面（实时票型） |
| 测试 | `tests/engine/wolf-vote.test.ts` 等 |

## 4. 验收标准

1. 三狼各一票，唯一最高票成为 `WOLF_KILL_CHOSEN` 的目标，并推进到下一相位
2. 三人各投不同 → 平票，`WOLF_VOTE_REVEALED.tied` 非空且进入 `NIGHT_WOLF_RUNOFF`
3. 重投只能投并列者；投其他人返回 `INVALID_RUNOFF_TARGET` 且相位不变
4. 重投僵持（并列者各得一票）→ 取最小席位，对局能继续（不无限循环）
5. 重复投票返回 `WOLF_VOTE_DUPLICATE`；投队友返回 `WOLF_KILL_WOLF`；非狼投票返回 `NOT_YOUR_TURN`
6. 票型事件只对狼可见；好人的投影/事件流里没有 `WOLF_VOTE_*`
7. 玩家是狼时，被逐票询问并通过输入通道提交 `WOLF_VOTE`
8. 界面在投票阶段显示实时票型；重投阶段只有并列者、没有弃权
9. 旧 `WOLF_KILL` 仍可推进（兼容），但产品流程只产生 `WOLF_VOTE`

## 5. 边界

- **不做**：狼队语音/私聊多轮（讨论仍为每人每晚一句，RFC-005 的规则）。
- **不做**：好人阵营的技能投票（女巫/预言家仍是单人决策）。
- 兼容路径 `WOLF_KILL` 只用于旧回放与既有测试；HTTP 接口返回 `LEGACY_ACTION_DISABLED`，界面/AI 不产生它。

## 6. 实现记录（§8）

见下方 `## 8. Implementation Notes`。

### 8. Implementation Notes

| 项 | 结论 |
|---|---|
| 状态 | Implemented（与文档同一变更批次） |
| 规则 | `RULES.md` 新增 **RUL-13**（append-only） |
| 契约变更 | RFC-001 / RFC-003 / RFC-010 标 `Spec changed`：动作表、相位表、事件流都多了狼队投票 |
| 兼容 | `WOLF_KILL` 保留为直接下刀路径（旧回放与既有测试），产品流程只用 `WOLF_VOTE` |

**偏离与决定**

| # | 决定 | 为什么 |
|---|---|---|
| D-1 | 重投僵持时取**最小席位** | 三狼各执一词会永远投下去；用户选择「直到分出结果」，必须有终止条件 |
| D-2 | 票型**实时**可见 | 用户选择；方便跟随队友，代价是少了表态压力 |
| D-3 | 唱票事件只对狼可见 | 好人知道狼队票型等于泄露夜间决策 |
| D-4 | `WOLF_KILL` 不删除 | 旧回放要能重放；删除会让历史事件流不可读 |

**验证（实跑）**

```
pnpm test → 92 files / 800 tests
pnpm test:e2e → 18 passed
```

**已知缺口**

- TEST-STRATEGY 的 RFC-017 小节是在同一批次补的（先写代码、后补计划），违反硬规则 3 的时序；
  已在 `CHANGE-REQUEST-011` 记录，后续变更恢复「先计划后实现」。

### 8.1 Round 1 回应（Review）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-216** | 默认模型路径仍产出 `WOLF_KILL` | `toAction` 在 `NIGHT_WOLVES` **与 `NIGHT_WOLF_RUNOFF`** 都把 `kill` 翻译成 `WOLF_VOTE`；补两个相位的用例 |
| **C-217** | 路由仍接受旧 `WOLF_KILL`，单狼可替全队决定 | HTTP 层返回 400 `LEGACY_ACTION_DISABLED`；引擎保留仅用于旧回放。`LEGACY_ACTION_DISABLED` 进 `ApiErrorCode` |
| **C-218** | `wolfVotes` / `wolfRunoff` 跨夜残留 | 进入新一夜时清空；补 applyEvent 级用例 |
| **C-219** | 可见性/玩家狼票/界面票型/等待态无测试 | 新增 `tests/server/wolf-vote-visibility.test.ts`、orchestrator 玩家狼票用例、界面票型与等待态用例；引擎测试断言投票事件 `visibleTo: 'wolves'` |
| **C-220** | 界面票型不实时的两处根因 | 票型按「当前轮」计算（唱票后重置）；投影只对**存活狼**给出 `wolfVoteOpen` / `wolfCandidates`；玩家投完后保留只读面板显示「等待队友」 |
| **B-N1** | 重投相位被 `phaseAllows('kill')` 拦住，默认路径每局都会停在重投 | 放行 `NIGHT_WOLF_RUNOFF`；补「LLM 形状的决策在重投也能翻译并跑完」的编排级用例 |
| **N-3** | `LEGACY_ACTION_DISABLED` 不在错误码里 | 已补 |
| **N-5** | `isPlayerPhase` 清单漏重投 | 已补 |

### 8.2 实时票型（2026-11-23）

- 投票界面显示 `已投 x/y 票` 与每一条 `seat → target`，待投票的狼可以跟票。
- AI 狼的票之间默认间隔 1.2 秒（`HOWL_WOLF_VOTE_DELAY_MS`），避免三票在同一瞬间
  投完、玩家看不到过程；e2e 设为 0。
