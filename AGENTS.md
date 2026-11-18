# Howl · Agent 协作契约

在浏览器里与 AI 对战的狼人杀。本文件对**每一个**在本仓库工作的 agent 生效，每个会话自动注入。流程细则在 [`docs/process/WORKFLOW.md`](docs/process/WORKFLOW.md)。

## 动手之前

先读 `docs/process/WORKFLOW.md` 的阶段表，确认当前阶段、以及你这一步被允许做什么。阶段不要凭记忆判断：跑 `/workflow-status`，或直接看仓库里有 `PRD.md` / `RFCs/` / `RFCS.md` 到哪一步。

## 硬规则

违反任何一条就停下来问，不要"先做起来再说"。

1. **没有 `PRD.md` 不写产品代码；没有对应 RFC 不开工。** 讨论、调研、写文档不受限。
2. **前置未完成不开工。** 开工某 RFC 前，它在 `RFCS.md` 里声明的前置 RFC 必须是 `Implemented` 或 `Reviewed`；`Changes requested` / `Spec changed` 不算。
3. **测试计划早于实现。** `TEST-STRATEGY.md` 中该 RFC 的小节必须已存在，实现阶段按它写测试，而不是写完代码再补计划。
4. **评审只在 subagent 里做。** 写过该 RFC 代码的会话不得自审：由实现会话起一个**全新上下文**的 `subagent`（`subagent`，不是 `fork`；`reasoning_effort: max`），只凭仓库文件进行，输入用 [`docs/process/REVIEW-PROMPT.md`](docs/process/REVIEW-PROMPT.md)。用户不再手动开评审会话。
5. **未获用户明确批准，不写代码。** `/implement-rfc` 的第一阶段只出计划，等批准。
6. **需求变化走 `/manage-changes`。** 不许直接改 `PRD.md` / `FEATURES.md` / `RULES.md` / RFC 来"顺手支持新需求"。
7. **冲突不许静默裁决。** 权威顺序 `PRD.md > FEATURES.md > RULES.md > RFC > 计划`；按哪个走、为什么，写进 `RFCS.md` 的 `## Open conflicts`。
8. **不修改 `.dsh/skills/` 下的任何文件。** 见下方「技能」。

## 工程规则

写代码前读 [`RULES.md`](RULES.md)。它有 77 条带永久 ID 的规则，权威在那一份，这里**不复制**，只点出四条最容易被违反、且违反后最贵的：

- **ARCH-1** —— `src/engine/` 不得 import 任何 UI、网络或 DOM 依赖。规则引擎必须能脱离浏览器与 LLM 单独跑。
- **SEC-1 / SEC-5** —— API key 不出服务端；发给客户端的对局视图必须由 `project(state, observerId)` 生成，禁止直接序列化完整状态。这两条一起守住了「AI 不作弊」这个卖点。
- **AI-5** —— 复盘展示的 AI 推理只能来自结构化载荷的 `reason` 字段，不许用模型的隐藏思维链。否则换模型或改参数时，复盘会整体崩掉。
- **RUL-1 ~ RUL-12** —— 狼人杀的规则歧义已在 `RULES.md` §6 裁决。引擎遇到**未裁决**的分支必须抛错（ARCH-11），不许默认选一个。

依赖版本一律以 `RULES.md` §2 为准，且那一节的数字是核对过 npm 注册表的；改版本必须重新核对并登记。

## 阶段

| # | 阶段 | 技能 | 产物 |
|---|------|------|------|
| 1 | 产品需求 | `create-prd` | `PRD.md` |
| 2 | 需求校验 | `verify-prd` | `PRD.md`(改) + `PRD-REVIEW.md` |
| 3 | 功能清单 | `extract-features` | `FEATURES.md` |
| 4 | 工程规则 | `generate-rules` | `RULES.md` |
| 5 | 拆分 RFC | `generate-rfcs` | `RFCs/` + `RFCS.md` |
| 6 | 测试策略 | `test-strategy` | `TEST-STRATEGY.md` |
| 7 | 实现 | `implement-rfc <id>` | 代码 + `RFCS.md` 状态 |
| 8 | 评审 | `review-rfc <id>` | `reviews/REVIEW-RFC-<id>.md` |
| 9 | 变更 | `manage-changes` | `changes/CHANGE-REQUEST-<nnn>.md` |

阶段 0（`document-existing`）只用于已有代码库的项目；本项目从零开始，不走。

阶段 1–6 是**一次性**的：产物稳定后，只有阶段 7/8 会反复执行，直到最后一个 RFC 通过评审。

## 技能

- **唯一来源是 `.dsh/skills/`。** 它是项目级技能（DSH 发现优先级 rank 100），会自动压过任何成员个人 `~/.dsh/skills` 里的同名技能。不要在项目里用个人版本替代。
- **用裸名调用**，如 `skill({ name: "create-prd" })`。技能正文里写的 `superpowers:writing-plans`，就是去掉前缀的 `writing-plans`。
- **版本以 `docs/process/SKILLS.lock.json` 为准**，用 `node scripts/verify-skills.mjs` 校验（无第三方依赖，macOS 与 Windows 同一条命令）。
- **要用未固化的技能**（例如 `document-existing`、`post-dev-testing-playbook`）时，先按 WORKFLOW.md「技能治理」把它纳入仓库，再使用；不要临时用个人副本。

## 跨平台

所有成员都用 DSH 开发，macOS 与 Windows 必须能跑完同一套流程。

| | macOS | Windows |
|---|---|---|
| Shell 工具 | `bash` | `pwsh` |
| Python | `python3` | `py -3`，没有就 `python` |
| 换行 | LF | LF（`.gitattributes` 强制，不要改） |
| 路径 | 含空格必须加引号 | 反斜杠路径，同样加引号 |

- **流程门禁只由文档状态决定，不依赖任何脚本。** `.sh` 帮助脚本（`executing-plans`、`subagent-driven-development`、`brainstorming` 等自带）在 Windows 上用 Git for Windows 的 `bash` 执行；跑不了就按对应 `SKILL.md` 里的步骤**手工等价执行**，不要因此跳过步骤。
- 新增工具优先用 Node（两平台一致）；不要把只支持 bash 的必需步骤塞进流程。
- 命令一律写绝对路径或明确的工作目录，不要依赖 `cd` 之后的状态。

## 目录

```
PRD.md  PRD-REVIEW.md  FEATURES.md  RULES.md
RFCS.md  RFCs/  TEST-STRATEGY.md
reviews/  changes/  docs/
.dsh/skills/        固化的技能，只读
scripts/            跨平台校验脚本
```

## 状态从哪看

`RFCS.md` 的 Status 列是唯一事实来源。任何时刻想知道进度，跑 `/workflow-status`。
