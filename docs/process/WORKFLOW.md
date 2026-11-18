# Howl 开发流程

本文件定义这个项目**怎么从想法走到代码**，以及每一步由谁、用什么工具、交什么产物。它和 [`AGENTS.md`](../../AGENTS.md) 配套：`AGENTS.md` 是每个会话必读的硬规则，本文件是细则。

改本文件等于改流程，需要单独提交，并在提交信息里写 `docs(process):`。

---

## 1. 适用对象

所有在本仓库工作的 agent 和成员——不论用什么模型、在 macOS 还是 Windows 上。目标是**换个人、换个会话、换台机器，产出同样的东西**。

不追求：让流程跑得更快、允许"这次先跳过"。

---

## 2. 角色

| 角色 | 职责 |
|------|------|
| 用户（人） | 提供需求、拍板取舍、批准计划、接收评审结论 |
| 实现会话 | 跑阶段 1–7，写文档与代码 |
| 评审会话 | 只跑阶段 8，**必须是没写过该 RFC 代码的新上下文**：用户手动开的新会话，或实现会话起的 `subagent`（全新上下文，**不是** `fork`） |

没有人可以既实现又评审同一个 RFC。这一条是流程里唯一无法用文档状态自动兜底的约束，靠人执行。

**两种评审会话的取舍**：`subagent` 省去人工开会话，但与被评审者同模型，可能更客气。所以**每 2–3 轮、以及准备置 `Reviewed` 的那一轮，用用户手动开的新会话**复核。评审的输入一律是 [`REVIEW-PROMPT.md`](REVIEW-PROMPT.md)。

---

## 3. 阶段总表

| # | 阶段 | 命令 | 产物 | 进入条件 | 退出条件 |
|---|------|------|------|----------|----------|
| 1 | 产品需求 | `/create-prd` | `PRD.md` | 无 | 用户确认 PRD 内容与 Open Questions |
| 2 | 需求校验 | `/verify-prd` | `PRD.md`(改) + `PRD-REVIEW.md` | `PRD.md` | 所有 High-impact 缺口已关闭或标 `(assumption)` |
| 3 | 功能清单 | `/extract-features` | `FEATURES.md` | `PRD.md` | 每条需求都有功能或者明确 Won't |
| 4 | 工程规则 | `/generate-rules` | `RULES.md` | `FEATURES.md` | 依赖版本已核对，规则 ID 可引用 |
| 5 | 拆分 RFC | `/generate-rfcs` | `RFCs/` + `RFCS.md` | `RULES.md` | 每个 Must Have 功能落在某个 RFC；cold read 完成 |
| 6 | 测试策略 | `/test-strategy` | `TEST-STRATEGY.md` | `RFCS.md` | 每个 RFC 都有测试小节 |
| 7 | 实现 | `/implement-rfc <id>` | 代码 + RFC 状态 | 该 RFC 前置全部 `Implemented`/`Reviewed`，且有测试小节 | 计划已批准、验收标准逐条演示、状态置 `Implemented` |
| 8 | 评审 | `/review-rfc <id>` | `reviews/REVIEW-RFC-<id>.md` | 状态为 `Implemented` | 无阻塞项 → `Reviewed`；否则 `Changes requested` |
| 9 | 变更 | `/manage-changes` | `changes/CHANGE-REQUEST-<nnn>.md` | 任何时候需求变化 | 用户逐条接受或拒绝，所有受影响产物一起更新并提交 |

阶段 1–6 一次性完成。7、8 反复执行，直到最后一个 RFC `Reviewed`。

**阶段 6 必须在阶段 7 之前**：代码写完之后再补的测试计划是覆盖率审计，不是计划。

---

## 4. 各阶段细则

### 阶段 1 · `/create-prd`

- 交互式访谈，不猜需求。用户答不上来的，标 `(assumption)` 放进 `## Open Questions`。
- PRD 必须含 **Product Type** 段（web app / game / …）。后续每个阶段靠它决定该做哪些检查，缺了就会被重新分类，产生不一致。
- **PRD 里写下的猜测会成为最高权威**，被后面所有阶段继承。所以宁可留空并标假设，也不要写成结论。

### 阶段 2 · `/verify-prd`

- 产出 `PRD-REVIEW.md`（缺口、建议、评分、每处改动的原因）并就地改进 `PRD.md`。
- High-impact 缺口先问用户，问不到才记为 `(assumption)`。
- 后续阶段遇到 `PRD-REVIEW.md` 必须读：其中每条 High-impact 结论要么落进功能/验收标准，要么明确 deferred。

### 阶段 3 · `/extract-features`

- 功能 ID 永久：`F1`、`F2`……只增不改，删除标 `[REMOVED]`，不复用编号。
- 优先级用 MoSCoW。每个 Must Have 后续必须落在某个 RFC 里。

### 阶段 4 · `/generate-rules`

- 规则 ID 永久、按类别编号（`ARCH-1`、`SEC-2`……），同样只增不删。
- 依赖版本必须**核对注册表**，不能凭记忆写版本号。
- `AGENTS.md` 是规则进上下文的通道：RULES.md 定稿后，在本文件与 `AGENTS.md` 之间建立引用，不要各写一份。

### 阶段 5 · `/generate-rfcs`

RFC 文件命名 `RFCs/RFC-001-Short-Title.md`，标题下四行固定格式（工具依赖它做追踪）：

```
**Features**: F3, F7
**Depends on**: RFC-001, RFC-002   (或 none)
**Rules**: ARCH-1, SEC-2
**Complexity**: Low | Medium | High
```

- 序号是**拓扑序**：每个 RFC 在其声明的前置完成后即可独立实现。
- `RFCS.md` 维护 Status 列 + 依赖表 + `## Open conflicts`。
- 每个 RFC 的验收标准要能被测试观测；超过约 15 条就拆 RFC。
- 写完做 **cold read**：让只有 PRD/FEATURES/RULES/该 RFC 及其前置的读者回答"要猜什么才能实现"。优先用独立 subagent 跑。
- 判重：已有 RFC 且状态超过 `Not started` 的，不重编号、不重写、不删除。

### 阶段 6 · `/test-strategy`

- `TEST-STRATEGY.md` **按 RFC 分节**，标题必须是 `## RFC-[ID]: [title]`，这是 7/8 阶段找测试计划的锚点。
- 不按测试类型分节（"安全测试"这种章节在实现时没人读）。
- 一个计划项如果实现中证明是错的：说明原因并在 RFC 的 `## Implementation Notes` 记为偏差，不许悄悄换测别的。

### 阶段 7 · `/implement-rfc <id>`

两个阶段，中间有一道用户批准：

1. **计划**（不写代码）：核对前置状态 → 分析影响面 → 列出要改的文件、决策与取舍 → **把该 RFC 里所有 `(assumption)`、依赖的 PRD 未决问题、`## Open conflicts` 里相关条目逐条请用户确认** → 等批准。
2. **实现**：开始写代码时把状态置 `In progress`；按批准的方案做；所有偏离 RFC 或计划的地方写进 RFC 末尾的 `## Implementation Notes`（改了什么、为什么、用户是否同意）；结束时给出 Files changed 与提交列表。

约束：

- 只实现该 RFC 范围内的东西。发现依赖别的 RFC，记录，不顺手实现。
- 不用 workaround。确实必要：说明原因与取舍，标注 `WORKAROUND:`，并且要用户批准。

### 阶段 8 · `/review-rfc <id>`

- **新上下文**，只凭仓库文件：用户手动开的新会话，或实现会话起的 `subagent`（非 `fork`）。当前会话写过这个 RFC 的代码就必须停下换会话。
- 评审输入是 [`REVIEW-PROMPT.md`](REVIEW-PROMPT.md)——它只写流程要求，不含技术线索。
- 先跑构建、类型检查、测试，贴真实输出。必须执行的命令在阶段 4 的 `RULES.md` 里定义（脚本名、包管理器），评审照抄。
- 逐条验收标准判断"有没有一个测试会在行为退化时失败"，而不是"测试全绿"。
- 每个维度不适用就写 N/A 加一句理由，不要用安慰性结论填充。
- 结论写入 `reviews/REVIEW-RFC-<id>.md`：有阻塞项 → 状态 `Changes requested`；无 → `Reviewed`。

### 阶段 9 · `/manage-changes`

- 先**只写评估**，每条变更标 `Decision: pending`，等用户逐条接受/拒绝。评估前不动任何其他产物。
- 评估要查：是否违反 `RULES.md`（引规则 ID）、是否推翻 PRD 的 Decisions 或历史 change request。
- 接受后，**在同一个提交里**改完所有受影响产物：PRD、FEATURES、RULES、RFCS、相关 RFC、TEST-STRATEGY、代码。
- 验收标准变了的 RFC，若已 `Implemented`/`Reviewed`，状态改 `Spec changed` 并在 `## Implementation Notes` 说明改了什么——否则 RFCS.md 会显示"已评审的代码对应一个已不存在的规格"。
- 编号 `changes/CHANGE-REQUEST-001.md` 顺序递增，不要跳号。

---

## 5. RFC 状态机

```
Not started ──(开始实现)──> In progress ──(实现完成)──> Implemented
                                   ▲                          │
                                   │                     (评审)
                     (返工)        │                          ▼
                             Changes requested <──阻塞─── 评审中
                                                              │
                                                        (无阻塞)
                                                              ▼
                                                          Reviewed

Implemented / Reviewed ──(manage-changes 改了验收标准)──> Spec changed ──> In progress
```

- 状态列是唯一事实来源，由 `/implement-rfc`、`/review-rfc`、`/manage-changes` 维护。
- 别人问进度，看 `RFCS.md`，不要看聊天记录。
- 任何时刻想看全局，跑 `/workflow-status`。

---

## 6. 每个阶段的完成定义（DoD）

提交前逐条对照，缺一条就不算完成：

1. 产物文件存在，且在阶段表指定的位置。
2. 该阶段的"退出条件"由文档本身可验证（不是"我问过了"）。
3. `RFCS.md` 状态与实际一致。
4. 引用的 ID（F / ARCH / SEC / RFC）都存在且指向正确的东西——**引用一个有效但错误的 ID 是最危险的情况**，不会报错，只会误导。
5. 改了 `.dsh/skills/` 或流程文档时，`node scripts/verify-skills.mjs` 通过。
6. 没有在聊天里做决定却忘了写进文件——评审者只看文件。

---

## 7. 分支与提交

- 一个 RFC 一个分支：`rfc/<id>-<slug>`，例如 `rfc/001-lobby-and-rooms`。
- 评审通过（状态 `Reviewed`）后合并回 `main`。未评审的 RFC 代码不进 `main`。
- 提交信息用 Conventional Commits：`<type>(<scope>): <subject>`，`type` ∈ `feat|fix|docs|test|refactor|chore|build`，`scope` 用 RFC 号或目录名。
  - `feat(rfc-001): ...`、`docs(process): ...`、`tests(rfc-003): ...`
- 一个提交只做一件事。改写规格的提交和实现代码的提交分开。

---

## 8. 跨平台约定

| | macOS | Windows |
|---|---|---|
| Shell 工具 | `bash` | `pwsh` |
| Python | `python3` | `py -3`（无则 `python`） |
| Node | `node` | `node` |
| 换行 | LF | LF（`.gitattributes` 强制） |

规则：

1. **流程门禁不依赖脚本。** 允许写代码、允许合并这类判断只由文档状态决定。
2. 技能自带的 `.sh` 帮助脚本（`executing-plans/scripts/*`、`subagent-driven-development/scripts/*`、`brainstorming/scripts/*`、`systematic-debugging/find-polluter.sh`）是 POSIX bash。Windows 上用 Git for Windows 的 `bash` 跑；没有就按对应 `SKILL.md` 手工等价执行。
3. Python 脚本（各技能自带的 `trace-check.py`）在 Windows 上用 `py -3` 调用。
4. 新增工具优先 Node：`node scripts/xxx.mjs`，两平台命令完全相同。
5. 别提交 CRLF 文件；也别在无提示的情况下改 `.gitattributes`。

---

## 9. 技能治理

### 固化清单

21 个技能已 vendor 到 `.dsh/skills/`，DSH 以项目级（rank 100）加载，压过个人安装的同名技能。

| 域 | 技能 |
|----|------|
| 流程（10） | `create-prd` `verify-prd` `extract-features` `generate-rules` `generate-rfcs` `test-strategy` `implement-rfc` `review-rfc` `manage-changes` `workflow-status` |
| 工程护栏（11） | `brainstorming` `writing-plans` `executing-plans` `test-driven-development` `systematic-debugging` `verification-before-completion` `requesting-code-review` `finishing-a-development-branch` `subagent-driven-development` `using-git-worktrees` `writing-skills` |

未固化、按需申请：`document-existing`（已有代码库时）、`post-dev-testing-playbook`（上线前验收）、`technical-writer`（文档专项）。品牌化/UI 类技能（`hallmark`、`modern-web-guidance` 等）不进仓库，需要时由成员在个人环境自备。

### 为什么 vendor 而不是"各自安装"

个人安装的版本会漂移：同一条 `/implement-rfc`，两个人可能跑在不同版本的提示词上，产出不可比。vendor 进 Git 后，技能内容和代码一样有版本、有 diff、有评审。

### 新增或升级技能

1. 从本机 `~/.dsh/skills/<name>/` 整目录复制到 `.dsh/skills/<name>/`（不带 `.DS_Store`）。
2. `node scripts/verify-skills.mjs --update` 重写 `docs/process/SKILLS.lock.json`。
3. 更新本文件第 9 节的清单表；若是新技能，说明它属于哪个阶段、什么条件下使用。
4. 一个提交，信息 `chore(skills): add|upgrade <name> <old>→<new>`。
5. **不修改技能正文**。项目专属差异写进 `AGENTS.md` 的跨平台段或本文件，而不是改 vendor 的文件——否则 `SKILLS.lock.json` 的哈希失去意义，下次升级也无法判断哪些是上游变更。
6. 技能里的 `metadata.version` / `source` 由 lock 记录；没有这两个字段的技能，靠逐文件 sha256 追踪。

### 校验

```
node scripts/verify-skills.mjs          # 不一致时退出码 1，逐条列出被改/缺失/多余的文件
node scripts/verify-skills.mjs --update # 有意变更后重写 lock
```

建议在每个改动了 `.dsh/skills/` 或 `docs/process/` 的提交前跑一次。

---

## 10. 例外与越权

- **唯一允许跳过的情形**：用户在当前对话里明确说"跳过 X"。跳过必须记进对应产物（`## Open conflicts` 或 `## Implementation Notes`），否则对下一个会话来说没有发生过。
- "时间紧"、"先跑起来再说"、"这个简单不用走流程"都不是理由。这个项目的流程成本主要在阶段 1–6，一次性付出；省下它的代价是后面每个 RFC 都在猜同一个没人确认过的需求。
- 发现流程本身碍事：停下来讨论并改流程（改本文件），不要默默绕过。
