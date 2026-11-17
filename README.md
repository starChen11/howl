# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.5 · 功能清单已生成：[`FEATURES.md`](FEATURES.md) 57 个功能（Must 31 / Should 11 / Could 3 / Won't 12）。需求侧 [`PRD.md`](PRD.md) 58 条需求已通过校验（[`PRD-REVIEW.md`](PRD-REVIEW.md) 21 项发现），[`changes/CHANGE-REQUEST-001.md`](changes/CHANGE-REQUEST-001.md) 为将来的 Roguelike 元层预留了扩展点。规则与架构方案仍在制定中，尚未有代码。

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
/generate-rules     ← 下一步：写 RULES.md，锁定依赖版本与工程规则
```

随时查看全局进度：`/workflow-status`。
