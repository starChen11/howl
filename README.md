# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.11 · **工程骨架 + 引擎内核已落地。** RFC-001 四轮评审后 `Reviewed`（[`CHANGE-REQUEST-003`](changes/CHANGE-REQUEST-003.md) 统一 payload、[`CHANGE-REQUEST-004`](changes/CHANGE-REQUEST-004.md) 定派生状态）；RFC-002 三轮评审后 `Reviewed`（Round 1/2 的阻塞项都已修完，Round 3 复核通过）。209 个用例全绿，引擎覆盖率行 98.0% / 分支 95.2%。RFC-001 四轮记录见 [`reviews/REVIEW-RFC-001.md`](reviews/REVIEW-RFC-001.md)，修复记录见 [`RFCs/RFC-001`](RFCs/RFC-001-project-scaffold-and-shared-contracts.md) §8.7 / §8.8 / §8.9；RFC-002 三轮记录见 [`reviews/REVIEW-RFC-002.md`](reviews/REVIEW-RFC-002.md)，修复与偏离见 [`RFCs/RFC-002`](RFCs/RFC-002-engine-core-state-events-seed-effects.md) §8，冲突见 [`RFCS.md`](RFCS.md) §8.1 的 C-13 ~ C-22。[`RFCS.md`](RFCS.md) + `RFCs/` 下 16 个 RFC（2 个 `Reviewed`、14 个 `Not started`），[`TEST-STRATEGY.md`](TEST-STRATEGY.md) 覆盖全部 222 条验收标准，[`RULES.md`](RULES.md) 75 条工程规则（含 `RA-1`~`RA-10` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。

已有代码：`src/shared/`（跨层类型契约）、`src/engine/`（纯函数状态机、事件流折叠、种子、效果管道、胜负谓词）、`src/server/`（Fastify 骨架 + `/api/health`）、`src/client/`（占位页）。引擎现在能跑完**第一夜**：发牌 → 狼刀 → 查验 → 用药 → 死亡结算 →（猎人开枪）→ 天亮。白天与投票是 RFC-004 的活。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 270 个用例，含五条命令与覆盖率门禁
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
RFC-001 → 四轮评审后 Reviewed
RFC-002 → 三轮评审后 Reviewed
RFC-003 → 实现完成，Status Implemented（§8 记录了 9 项决定与 3 条 AC 修正）
下一步：/review-rfc 003（新会话）
```

随时查看全局进度：`/workflow-status`。

