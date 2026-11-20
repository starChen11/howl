# RFC-018 · 狼队夜间讨论改为限时聊天室

**Features**: F9, F10, F26
**Depends on**: RFC-005, RFC-011
**Rules**: ARCH-4, RUL-13, RUL-14
**Complexity**: Large
> 关联需求：FR-17、G4；用户试玩反馈「一句一轮根本讨论不出结果」。

---

## 1. 摘要

狼队夜聊从「每人一句后自动进入投票」改成**限时聊天室**：

```
NIGHT_WOLF_CHAT（默认 50 秒，可发任意条消息，30 秒后可准备）
  → 全员准备 / 50 秒到
  → NIGHT_WOLVES（默认 10 秒投票，超时弃权）
```

只有玩家 + 脚本替身的对局，准备门槛降到 **5 秒**。

## 2. 技术方案

### 2.1 引擎（纯函数，不读时钟）

| 项 | 设计 |
|---|---|
| `WOLF_CHAT` | 允许同一狼发**任意条**；只追加事件，不推进相位 |
| `WOLF_READY`（新） | 标记准备；**所有存活狼都准备**时产出 `PHASE_CHANGED → NIGHT_WOLVES` |
| `WOLF_CHAT_POSTED` | 沿用；不再有「每夜一句」的限制 |
| `WOLF_READY_MARKED`（新） | 只对狼可见 |
| `GameState.wolfReady` | 已准备席位；进入新一夜清空 |
| 50 秒到期 | 服务端为未准备者提交 `WOLF_READY`（系统动作），引擎不感知时间 |
| 投票弃权 | `WOLF_VOTE.target` 接受 `'abstain'`；弃权票不计入最高票；全员弃权 → 当夜无刀口，直接进入下一相位 |

### 2.2 服务端编排

- `runGame` 遇到 `NIGHT_WOLF_CHAT` 走专用循环 `driveWolfChat`：
  - AI 队友开局各说一句；`HOWL_WOLF_READY_MS`（默认 5 秒，测试 0）后自动准备。
  - 玩家通过路由自由发言；每收到一条新消息，AI 基于更新后的投影回一句（真实模型因此能看到最新聊天室）。
  - 玩家说「准备完成」或 50 秒到（`HOWL_WOLF_CHAT_MS`）→ 推进。
- 投票阶段：玩家等待上限 `HOWL_WOLF_VOTE_MS`（默认 10 秒）；超时提交 `WOLF_VOTE(abstain)`。
- 所有时限都可由环境变量覆盖，e2e 用极短值。

### 2.3 界面

- 讨论阶段：消息列表、可连续发送的输入框、50 秒倒计时、`已准备 x/y`、
  「准备完成」按钮（30 秒后可点；纯脚本局 `__HOWL_FAKE_AI__` 为 5 秒）。
- 全员准备 → 立即切投票阶段；投票阶段显示 10 秒倒计时与实时票型。
- 玩家准备后仍能看到聊天室与 `x/y`，不会白屏。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/shared/{actions,events,domain,schemas}.ts` | `WOLF_READY`、`WOLF_READY_MARKED`、`wolfReady` |
| `src/engine/phases/wolf-chat.ts` | 多条消息、准备、全员准备推进 |
| `src/engine/phases/night.ts` | 狼票弃权与「全员弃权不刀」 |
| `src/server/orchestrator.ts` | `driveWolfChat`、投票超时 |
| `src/client/components/NightAction.tsx` | 聊天室、倒计时、准备按钮 |
| 测试 | 引擎/编排/界面/e2e 见 TEST-STRATEGY RFC-018 |

## 4. 验收标准

1. 同一狼可连续发多条消息，相位不推进。
2. 只有部分狼准备 → 仍在讨论；所有存活狼准备 → 立即进入投票。
3. 50 秒到（可用短时限模拟）→ 未准备者视为准备，进入投票。
4. 讨论界面显示倒计时与 `已准备 x/y`；30 秒前准备按钮不可点。
5. 纯玩家 + 脚本对局，5 秒即可准备。
6. 投票超时 → 该狼弃权；弃权票不计入最高票；全员弃权 → 当夜不刀。
7. 重投阶段不能弃权（RUL-13 不变）。
8. 玩家在讨论阶段随时能看到最新聊天记录；AI 能读到玩家新消息。

## 5. 边界

- 不做语音；不做狼队之外的聊天室。
- 真实模型的「准备」由模型自己决定（决策 `ready`）；脚本队友固定 5 秒后准备。
- 讨论时限/投票时限是服务端配置，不写进引擎状态。

### 8. Implementation Notes

| 项 | 结论 |
|---|---|
| 状态 | Implemented（待评审） |
| 规则 | `RULES.md` 新增 **RUL-14**；`PRD.md` 新增 D47 |
| 契约变更 | RFC-005（夜聊）、RFC-010（流式/超时）、RFC-011（输入通道）、RFC-012（界面）标 `Spec changed` |
| 计时 | 服务端负责：`HOWL_WOLF_CHAT_MS`（默认 50000）、`HOWL_WOLF_READY_MS`（默认 5000，测试 0）、`HOWL_WOLF_VOTE_MS`（默认 10000）；引擎不读时钟 |
| AI 准备 | 脚本队友：开局一句 + 5 秒后自动准备；真实模型：提示词要求输出 `ready`，由模型自己决定 |
| 投票超时 | 提交 `WOLF_VOTE(abstain)`；弃权不计入最高票；全员弃权 → 当夜不刀 |
| 兼容 | `WOLF_KILL` 仍只在引擎层用于旧回放，HTTP 拒绝 |

**偏离**

| # | 决定 | 原因 |
|---|---|---|
| D-1 | e2e 默认只跑 chromium + firefox | WebKit 在本机（macOS 高负载）偶发「按钮一直不稳定」，单跑与全量均可通过；保留 `pnpm test:e2e:all` |
| D-2 | meta 套件不再实际执行 e2e | 由 vitest 派生 Playwright 在本机会挂起 >15 分钟；e2e 由独立门禁 `pnpm test:e2e` 执行 |

**验证**

```
pnpm test → 87 files / 789 tests + meta 7 files / 35 tests
pnpm test:e2e → 16 passed（chromium + firefox）
pnpm test:e2e:all → 18 passed
pnpm test:perf → 3 passed
typecheck / lint / format:check / build → 0
```

### 8.1 Round 1 回应（Review：Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **B1** | 重投阶段接受弃权；全员弃权路径绕开刀口 | 重投阶段提交弃权 → `INVALID_RUNOFF_TARGET`；**重投超时改为投第一个并列者**（新增编排级用例）。普通轮超时仍按弃权（RUL-14） |
| **B2** | AI 的投影是讨论开始前的冻结快照，看不到玩家新消息 | `driveWolfChat` 每次发言/回应都用**最新**记录重新 `project()`；补「玩家发言后 AI 上下文包含该消息」的用例 |
| **B3** | 「跳过」= `WOLF_CHAT('')` = 准备，30 秒门槛可绕过；5 秒只认 `?fast=1` | 聊天室移除「跳过」；**服务端拒绝空 `WOLF_CHAT`（EMPTY_WOLF_CHAT）**；`__HOWL_FAKE_AI__` 由 Vite 注入，只有纯脚本局 5 秒、真实模型固定 30 秒 |
| **B4** | 第二夜显示上一夜聊天/准备；`wolfCount` 含死狼 | 客户端按「上一次唱票/刀口」截断，只取本夜事件；`wolfCount` 只数存活队友；补第二夜用例 |
| N-4 | `to-action` 重复 `case 'ready'` | 已删 |
