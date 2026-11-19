# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.12 · **引擎能跑完一整局（不含 AI）**：发牌 → 夜间行动与结算 → 天亮 → 发言 → 投票与放逐 → 终局。 RFC-001 四轮评审后 `Reviewed`（[`CHANGE-REQUEST-003`](changes/CHANGE-REQUEST-003.md) 统一 payload、[`CHANGE-REQUEST-004`](changes/CHANGE-REQUEST-004.md) 定派生状态）；RFC-002 三轮评审后 `Reviewed`；RFC-003 四轮评审后 `Reviewed`——Round 1/2/3 的阻塞项分别在 [`CHANGE-REQUEST-005`](changes/CHANGE-REQUEST-005.md) 落榜 RUL-11「毒药优先」、[`CHANGE-REQUEST-006`](changes/CHANGE-REQUEST-006.md) 落榜 RUL-12「狼刀在先」，Round 4 无阻塞；RFC-004 ~ RFC-007 均 `Reviewed`。**八个 RFC 的代码已合入 `main`（001–008）。**637 个用例全绿，引擎覆盖率行 96.69% / 分支 93.33%。[`RFCS.md`](RFCS.md) + `RFCs/` 下 16 个 RFC（7 个 `Reviewed`、0 个 `Changes requested`、8 个 `Not started`），[`TEST-STRATEGY.md`](TEST-STRATEGY.md) 覆盖全部 222 条验收标准，[`RULES.md`](RULES.md) 77 条工程规则（含 `RUL-1`~`RUL-12` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。

已有代码：`src/shared/`（跨层类型契约）、`src/engine/`（纯函数状态机、事件流折叠、种子、效果管道、胜负谓词）、`src/server/`（Fastify 骨架 + `/api/health` + `project()` 投影 + LLM 客户端）、`src/client/`（占位页）。引擎现在能跑完**一整局**（不含 AI）：发牌 → 夜间行动与结算 → 天亮公布 → 轮流发言 → 投票与放逐 →（白天开枪）→ 下一夜，直到终局。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 637 个用例，含五条命令与覆盖率门禁
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
RFC-001 ~ 007  Reviewed（共七个）
RFC-008 会话与存储  Implemented，等待评审
下一步：/review-rfc 008
```

随时查看全局进度：`/workflow-status`。

