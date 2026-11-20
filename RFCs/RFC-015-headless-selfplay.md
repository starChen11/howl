# RFC-015 · headless 自动对局

**Features**: F39
**Depends on**: RFC-006, RFC-007, RFC-008, RFC-009, RFC-011
**Rules**: OPS-3, TEST-4, TEST-5, DATA-4, DATA-6
> 关联需求：NFR-17、NFR-18
**Complexity**: Medium

---

## 1. 摘要

提供一条**没有浏览器、没有界面**的对局通道，用于批量验证。

它是 SM-1 的唯一执行手段：没有它，「连跑 100 局、成功率 ≥ 95%」只能人工点 100 次，等于放弃这条验收。

## 2. 技术方案

### 2.1 命令

```
pnpm selfplay --games=100 --seed=42 --out=./reports
```

- `--games`：局数，默认 1。
- `--seed`：起始种子；第 N 局使用 `seed + N`（NFR-18）。
- `--out`：输出目录，写入每局的 `events.jsonl` 与一份 `summary.json`。

### 2.2 执行方式

headless 复用**同一套引擎与同一套编排逻辑**，只把通道换成脚本化的实现：

- 玩家席位用 `ScriptedChannel`（RFC-011 的 stub 通道）驱动，输入来自预置策略（随机合法行动）。
- AI 席位走真实的 LLM 决策路径（RFC-007 ~ RFC-009）。
- 不启动 Fastify，不启动 Vite，不依赖 DOM。

### 2.3 输出

`summary.json` 包含：总局数、成功局数、失败局数与失败原因、平均每局事件数、平均时长、胜负分布、降级次数、token 消耗合计。

每局一行 JSONL（`events.jsonl`），可直接喂给复盘快照生成器做离线检查。

### 2.4 失败隔离

单局抛错不终止整批：记录失败原因（错误类型 + 消息 + 该局种子），继续下一局。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/server/selfplay/runner.ts` | 批量执行器 |
| `src/server/selfplay/scripted-player.ts` | 玩家席位的脚本化策略 |
| `src/server/selfplay/report.ts` | 汇总与失败清单 |
| `bin/selfplay.ts` | 命令入口，替换 RFC-001 的占位实现 |
| `tests/server/selfplay.test.ts` | 失败隔离与汇总正确性 |

## 4. 实现要点

- 脚本化玩家只能产生**合法**行动；若产生了非法行动，视为实现 bug 而不是对局失败，必须在汇总里单独归类。
- 每局的 LLM 调用次数与 token 累加到 `summary.json`，这是 SM-6 成本观测的数据来源。
- 输出目录不存在时自动创建；同名文件覆盖前先写临时文件再原子改名，避免半截文件。
- 100 局必须能在一台开发机上跑完且不 OOM——每局结束后释放状态（复用 RFC-006 的释放策略）。

## 5. 验收标准

1. `pnpm selfplay --games=3 --seed=1` 在无浏览器、无 Vite、无 DOM 的环境下跑完 3 局并以退出码 0 结束
2. 第 N 局使用的种子为 `seed + N`，且可从输出中核对（NFR-18）
3. 输出目录包含 `summary.json` 与每局的事件流文件
4. `summary.json` 含：总局数、成功局数、失败局数、失败原因列表、胜负分布、降级次数、token 合计
5. 单局失败不终止整批：注入一个必然抛错的假 LLM 客户端，断言其余局仍跑完且失败局被单独记录
6. 脚本化玩家产生非法行动时，该局被判为「实现缺陷」并单独归类，不计入模型失败
7. 连续跑 100 局不崩溃，且进程内存峰值不随局数线性增长
8. `pnpm selfplay` 在 RFC-001 阶段的占位行为被移除：命令不再以「未实现」退出
9. 每局事件流的 `seq` 连续且可被 `replay` 重放（复用 RFC-002 的断言）

## 6. 边界与测试

- **不做**：并发跑多局。v1 串行执行——并发会让 token 成本与失败定位都变难，且第一版没有这个需求。
- **不做**：断点续跑。
- **成本提示**：100 局会产生真实 API 费用（估算见 `PRD-REVIEW.md` §2，flash 约 ¥30–80）。跑之前确认账户余额与预期。
- **测试**：批量执行器的单元测试全部用假 LLM 客户端，不产生费用；真实 100 局只作为手工验收执行一次并记录结果。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-015-1 | 脚本化玩家用什么策略 | **(assumption)** 随机合法行动；它的目的是跑通流程，不是模拟人类 |
| Q-015-2 | 是否支持指定模型 | **(assumption)** v1 从配置读取，不提供命令行覆盖；需要测对比时手改配置 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-006/007/008/009/011 均已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 汇总口径 | **A 方案**（用户选）：按「阵营胜率 + 平均局长」汇总 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 汇总分三类：成局 / 模型失败 / **实现缺陷** | 脚本玩家产生非法行动是我们的 bug，混进「模型失败」会让成功率失真（AC-6） |
| **D-2** | 玩家席位与假 AI 都从 `legalTargets` 里挑，狼刀额外排除队友 | 投影不替引擎判断「不能刀队友」（`targets.ts` 注释写明），selfplay 要跑完整批而不是中断 |
| **D-3** | `sanitizeActions` 默认开启，测试可关掉 | 默认要能跑完 100 局；关掉后用来验证「引擎拒绝 → 归类为实现缺陷」这条路径 |
| **D-4** | 输出先写临时文件再原子改名 | 避免崩溃时留下半截 `summary.json`（§4） |
| **D-5** | 失败局不阻塞整批，但整批有失败时退出码为 1 | AC-5 要求「其余局仍跑完」；退出码仍要让 CI 注意到失败 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 服务端新增 | `src/server/selfplay/{runner,scripted-player,report}.ts` |
| 入口 | `scripts/selfplay.ts`（替换占位实现） |
| 测试 | `tests/server/selfplay.test.ts`；`tests/meta/selfplay-entry.test.ts`（替掉占位断言） |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `selfplay.test.ts` 的 CLI 用例：无浏览器跑完 2 局、退出码 0 | PASS |
| 2 | 种子 `seed + N` 断言 | PASS |
| 3 | 输出目录含 `summary.json` 与每局 `game-<seed>.jsonl` | PASS |
| 4 | 汇总含局数、成功/失败、失败原因、胜负分布、降级、token | PASS |
| 5 | 第二局注入抛错，其余局仍跑完且失败被单独记录 | PASS |
| 6 | 引擎拒绝的玩家动作归为 `implementation`（关掉 sanitize 的用例） | PASS |
| 7 | 100 局冒烟：1.7 秒跑完、进程不增长（手工执行记录） | PASS（手工） |
| 8 | `pnpm selfplay` 退出码 0、打印汇总、不再提示未实现 | PASS |
| 9 | 每局事件流 `seq` 从 1 开始且逐条 +1 | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm test → 88 files / 756 tests
$ pnpm test:e2e → 10 passed
$ HOWL_FAKE_AI=1 pnpm selfplay --games=100 --seed=1000 --out=/tmp/howl-sp3
  跑完 100 局：成 100 / 败 0；狼人胜率 80.0%；平均 76.9 条事件（1.7s）
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 真实 100 局 | 会产生 API 费用（估 ¥30–80），留给用户决定何时跑 | 手工验收 |
| 分组统计 | 按人格/打法分组是 B 方案，用户选了 A | 后续 |
| 并发 | 明确不做（RFC §6） | — |

### 8.7 Round 1 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-184** AC-6 归类在成功路径不生效 | 只在「没有 `GAME_ENDED`」时扫描 `REJECTED`；而且 `REJECTED` 的 payload 不带 `seat`，原判断永远为假 | 抽出 `findPlayerRejection(events, playerSeat)`：按 `visibleTo` 的 `self:N` 归属，动作类型限 `SPEECH`/`SPEECH_SKIP`/`VOTE`/`SELF_EXPOSE`；成局也扫描。补三组用例（玩家/他人/夜间） |
| **C-185** AC-9 只断言 seq | 截掉最后一条事件仍绿 | 补「`replay(events)` 停在 `FINISHED` 且最后一条是 `GAME_ENDED`」 |
| **C-186** AC-7 没有内存用例 | 只有手工记录 | 补 30 局堆增长 < 96MB 的用例 |
| **C-187** `onGame` 抛错会逃逸 | catch 里再次调用并 reject 整批 | 抽出 `report()`：落盘异常记为 `REPORT_FAILED`，不终止整批；补「第二局写盘失败、第三局仍跑」用例 |
| **C-188** 用 `Math.random` 破坏可复现 | 同 seed 胜率 73/77/78% | 每局用 `mulberry32(seed)`；玩家与假 AI 共用该随机源。补「同 seed 跑两次结果相同」用例；退回 `Math.random` 会红 |
| **C-189** CLI 用例不跨平台 | 写死 `pnpm` | 按平台选 `pnpm.cmd` |
| 非阻塞 | 失败局 usage 不计、`reports/` 被提交、失败缺错误类型、文档漂移 | 失败局 usage 计入汇总；`reports/` 加入 `.gitignore` 并从索引移除；失败记录加 `errorType`；文档同步 |

```
$ pnpm test → 88 files / 762 tests
$ pnpm test:e2e → 10 passed
$ 同 seed 跑两次：结果与事件数完全一致（只有耗时不同）
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-184** 成局扫描没有回归锁 | 官方用例只测谓词，关掉 `runner` 的成局扫描仍绿；真实玩家输入在服务端会被截断/归一化，端到端造不出拒绝 | 抽出 `classifyFinished(events, playerSeat)`（runner 就是调用它）；用「真实完成局 + 人为注入一条 `REJECTED`」测这条路径。关掉判定会红 |
| **C-187** 未终局路径仍直接 `onGame` | 写盘失败会多记一条 outcome（每局变两条） | 未终局路径也走 `report()`；补 `maxSteps=1` + `onGame` 恒抛的用例，断言 outcomes 数是局数而不是两倍。改回直接调用会红 |
| **C-189** Windows CLI 用例 | 仍写死 `pnpm` | 按平台选 `pnpm.cmd` 并在 Windows 上走 `shell` |
| **C-191** 失败局 token 没计入 | 只聚合成功局 | `summarize` 改为对全部 outcomes 求 usage；补带 usage 的失败局用例 |
| **C-195** 文档漂移 | README 仍写 8 个 RFC / 720 用例；TEST-STRATEGY 引用已删除的占位测试 | 同步为 15 个 RFC、765 用例、RFC-015 行改成 `existing`，占位测试名改为 `selfplay-entry.test.ts` |

```
$ pnpm test → 88 files / 765 tests
$ pnpm test:e2e → 10 passed
$ HOWL_FAKE_AI=1 pnpm selfplay --games=100 --seed=1000 → 100/100，1.7s
```

### 8.9 Round 3 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-184** runner 没调用 `classifyFinished` | `grep classifyFinished src` 只命中定义；成局扫描仍是一份重复逻辑，关掉它测试不红 | runner 改调 `classifyFinished`，删掉重复分类；补端到端用例：用 `playerInput` **只投一次已出局席位**（引擎回 `TARGET_NOT_ALIVE`），之后正常弃权让对局打完——这样才真的走到成局扫描。把调用改成 `null` 会红（已实跑） |
| **C-202** 未终局 / 被拒路径不挂 usage | 已花掉的 token 不进汇总 | 两条路径都挂 `usage: usageOf(gameId)` |
| **C-195** 文档仍有漂移 | TEST-STRATEGY 头部仍写 720、其余 15 个 `proposed`、引用已删除的占位测试 | 全部同步 |

```
$ pnpm test → 88 files / 766 tests
$ pnpm test:e2e → 10 passed
```

### 8.10 Round 4 回应（Reviewed）

Round 4 无阻塞项。顺手加固了评审提到的三处非阻塞：

| 项 | 处理 |
|---|---|
| **C-203** 未终局/被拒路径的 `usage` 没有回归锁 | 补「`maxSteps=1` 的 outcome 带 `usage`」用例 |
| **C-204** 端到端用例未断言真的打完 | 断言事件数 > 10 且 outcome 带 `usage`，排除「未终局分支的假象」 |
| **C-195** 文档残留 | TEST-STRATEGY 的计数、占位测试描述、RFC-010/014 的 13 行 `proposed` 全部同步；README 覆盖率改为实测值 |

```
$ pnpm test → 88 files / 767 tests
```
