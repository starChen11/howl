# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.10 · **工程骨架 + 引擎内核已落地。** RFC-001 四轮评审后 `Reviewed`（[`CHANGE-REQUEST-003`](changes/CHANGE-REQUEST-003.md) 统一 payload、[`CHANGE-REQUEST-004`](changes/CHANGE-REQUEST-004.md) 定派生状态）；RFC-002 Round 1 的两条阻塞项已修，Round 2 评审为 `Changes requested`（[`REVIEW-RFC-002`](reviews/REVIEW-RFC-002.md)：B-R2-1 新测试在 Windows 上因路径分隔符必红、B-R2-2 AC-13 的递归锁只测 helper 没锁 wiring；P4 / P13 / P19 本轮均实红）。206 个用例全绿，引擎覆盖率行 98.0% / 分支 95.2%。RFC-001 四轮记录见 [`reviews/REVIEW-RFC-001.md`](reviews/REVIEW-RFC-001.md)，修复记录见 [`RFCs/RFC-001`](RFCs/RFC-001-project-scaffold-and-shared-contracts.md) §8.7 / §8.8 / §8.9，冲突见 [`RFCS.md`](RFCS.md) §8.1 的 C-13 ~ C-21。[`RFCS.md`](RFCS.md) + `RFCs/` 下 16 个 RFC（1 个 `Reviewed`、1 个 `Changes requested`、14 个 `Not started`），[`TEST-STRATEGY.md`](TEST-STRATEGY.md) 覆盖全部 222 条验收标准，[`RULES.md`](RULES.md) 75 条工程规则（含 `RA-1`~`RA-10` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。

已有代码：`src/shared/`（跨层类型契约）、`src/engine/`（纯函数状态机、事件流折叠、种子、效果管道、胜负谓词）、`src/server/`（Fastify 骨架 + `/api/health`）、`src/client/`（占位页）。引擎目前只覆盖 `LOBBY → 第一夜` 的骨架——角色与昼夜分支是 RFC-003/004 的活。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 206 个用例，含五条命令与覆盖率门禁
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
RFC-002 → Round 1（Changes requested）→ 阻塞项已修 → Round 2（Changes requested：B-R2-1 Windows 路径 / B-R2-2 AC-13 递归锁）
下一步：修完 Round 2 的两条阻塞项后，再用 /review-rfc 002 重审（新会话，不能是写这份代码的会话）
```

随时查看全局进度：`/workflow-status`。

