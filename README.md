# Howl

在浏览器里与 AI 对战的狼人杀。

## 关于名字

Howl 是狼在夜里的长嚎，也是玩家在白天的"喊话"——两个词义正好对应狼人杀的昼夜两套规则。四个字母，好记，也好放进 URL。

## 状态

v0.12 · **引擎能跑完一整局（不含 AI）**：发牌 → 夜间行动与结算 → 天亮 → 发言 → 投票与放逐 → 终局。 RFC-001 四轮评审后 `Reviewed`（[`CHANGE-REQUEST-003`](changes/CHANGE-REQUEST-003.md) 统一 payload、[`CHANGE-REQUEST-004`](changes/CHANGE-REQUEST-004.md) 定派生状态）；RFC-002 三轮评审后 `Reviewed`；RFC-003 四轮评审后 `Reviewed`——Round 1/2/3 的阻塞项分别在 [`CHANGE-REQUEST-005`](changes/CHANGE-REQUEST-005.md) 落榜 RUL-11「毒药优先」、[`CHANGE-REQUEST-006`](changes/CHANGE-REQUEST-006.md) 落榜 RUL-12「狼刀在先」，Round 4 无阻塞；RFC-004、005、007 均 `Reviewed`（RFC-006 为 `Spec changed`）。**十七个 RFC 的代码已合入 `main`（001–017）。**793 个用例全绿，引擎覆盖率行 96.74% / 分支 93.21%。[`RFCS.md`](RFCS.md) + `RFCs/` 下 17 个 RFC（14 个 `Reviewed`、3 个 `Spec changed`），[`TEST-STRATEGY.md`](TEST-STRATEGY.md) 覆盖全部 222 条验收标准，[`RULES.md`](RULES.md) 78 条工程规则（含 `RUL-1`~`RUL-13` 裁决），[`FEATURES.md`](FEATURES.md) 57 个功能，[`PRD.md`](PRD.md) 58 条需求。

已有代码：`src/shared/`（跨层类型契约）、`src/engine/`（纯函数状态机、事件流折叠、种子、效果管道、胜负谓词）、`src/server/`（Fastify 骨架 + `/api/health` + `project()` 投影 + LLM 客户端）、`src/client/`（首页）。引擎现在能跑完**一整局**（不含 AI）：发牌 → 夜间行动与结算 → 天亮公布 → 轮流发言 → 投票与放逐 →（白天开枪）→ 下一夜，直到终局。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 793 个用例，含五条命令与覆盖率门禁
```

### 两种 AI 模式

| 模式 | 启动方式 | 用的是什么 |
|---|---|---|
| **真实模型**（默认） | `cp .env.example .env`，填入 `DEEPSEEK_API_KEY`，再 `pnpm dev` | DeepSeek API，每个 AI 都在真推理；会产生费用 |
| **脚本替身** | `HOWL_FAKE_AI=1 pnpm dev` | 固定台词与规则动作，不花钱，适合先看界面 |

`.env` 会在启动时自动读取（`dev` 与 `start` 都带 `--env-file-if-exists`）。
没有 key 且没有开替身时，服务端会**直接退出并给出上面两种启动方式**，而不是起来后卡在对局中。

### 以固定身份开局（测试用）

对局 URL 支持两个查询参数：

| 参数 | 作用 |
|---|---|
| `seed` | 固定发牌种子；同一 seed + 同一玩家座位，身份和狼队友固定 |
| `seat` | 玩家坐几号（1–9）；省略时由服务端决定 |

以下 URL 都让**玩家坐 1 号**，身份与狼队友固定；这些种子在**脚本替身**下验证过首夜存活，真实模型的狼刀目标可能不同：

| 身份 | URL |
|---|---|
| 村民 | <http://localhost:5173/?seed=1&seat=1> |
| 狼人 | <http://localhost:5173/?seed=3&seat=1> |
| 预言家 | <http://localhost:5173/?seed=12&seat=1> |
| 女巫 | <http://localhost:5173/?seed=31&seat=1> |
| 猎人 | <http://localhost:5173/?seed=11&seat=1> |

说明：

- 身份和狼队友由 seed + seat 固定；**AI 的发言、投票和狼刀目标在真实模型下不会完全复现**。想复现完全相同的整局行为，用脚本替身：`HOWL_FAKE_AI=1 pnpm dev`。
- `seat` 不写时服务端会选一个座位；上表的 URL 都显式写了 `seat=1`。
- 换 `seed` 会换身份/队友；要测“同一身份、不同发言”时保留 seed、换模型或改 prompt 即可。

批量跑真实模型（会产生费用，先看清局数）：

```bash
DEEPSEEK_API_KEY=sk-... pnpm selfplay --games=10 --seed=42 --out=./reports
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
RFC-001 ~ 017  已实现（001–016 已评审；RFC-017 待评审）
RUL-13 把狼刀改成狼队投票。
```





随时查看全局进度：`/workflow-status`。

