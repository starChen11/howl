# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.9 · **工程骨架已落地；RFC-001 Round 2 评审结论为 `Changes requested`，代码与 78 个用例仍全绿。** 三个阻塞项是：C-17 的跨 RFC payload 契约（RFC-002/004/006/007/009/014）、F6 残留的 RFC §2.3 与代码注释、F1 的 `EventEnvelope` 默认类型缺回归夹具。Round 1/2 记录见 [`reviews/REVIEW-RFC-001.md`](reviews/REVIEW-RFC-001.md)，冲突见 [`RFCS.md`](RFCS.md) §8.1 的 C-13 ~ C-17。[`RFCS.md`](RFCS.md) + `RFCs/` 下 16 个 RFC（1 个 `Changes requested`、15 个 `Not started`），[`TEST-STRATEGY.md`](TEST-STRATEGY.md) 覆盖全部 222 条验收标准，[`RULES.md`](RULES.md) 75 条工程规则（含 `RA-1`~`RA-10` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。

已有代码：`src/shared/`（跨层类型契约的唯一归属）、`src/server/`（Fastify 骨架 + `/api/health`）、`src/client/`（占位页）。**还没有任何游戏逻辑**——那是 RFC-002 起的活。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 78 个用例，含五条命令的门禁测试
```

## 怎么参与开发

本项目由人和 AI agent 在 DeepSeek Harness（DSH）里协作完成，流程与工具已固定在仓库内，不依赖个人环境。

| 先读 | 内容 |
|------|------|
| [`AGENTS.md`](AGENTS.md) | 硬规则：阶段门禁、技能来源、跨平台约定（每个会话自动加载） |
| [`docs/process/WORKFLOW.md`](docs/process/WORKFLOW.md) | 完整流程：9 个阶段、RFC 状态机、完成定义、技能治理 |
| [`docs/process/SKILLS.lock.json`](docs/process/SKILLS.lock.json) | 21 个固化技能的版本与校验和 |

用 DSH 打开本仓库后，`.dsh/skills/` 下的技能会自动生效并覆盖个人安装的同名技能，因此每个人跑的是同一套流程。

当前进度：

```
评审 Round 1 → reviews/REVIEW-RFC-001.md（Changes requested）
6 个阻塞项已修 → RFC §8.7
评审 Round 2 → reviews/REVIEW-RFC-001.md（Changes requested：B1 / B2 / B3）
下一步：先 /manage-changes 统一 C-17 的 payload 形状，并修掉 B2 / B3，再开 Round 3
```

随时查看全局进度：`/workflow-status`。

