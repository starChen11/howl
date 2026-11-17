# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.7 · 实现计划已拆分：[`RFCS.md`](RFCS.md) + `RFCs/` 下 16 个 RFC，覆盖全部 31 个 Must 功能。[`RULES.md`](RULES.md) 75 条工程规则（含 `RA-1`~`RA-10` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。尚未有代码。

开发流程与 agent 协作方式已先行固化，见下节。

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
/test-strategy      ← 下一步：为每个 RFC 写测试计划（硬规则 3：先有计划才开工）
```

随时查看全局进度：`/workflow-status`。
