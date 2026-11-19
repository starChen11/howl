# Howl · 测试计划（TEST-STRATEGY）

> 版本 v1.21 · 来源 `PRD.md` v0.4 / `FEATURES.md` v1.0 / `RULES.md` v1.3 / `RFCS.md` v2.65 · 最后更新 2026-11-19
> **按 RFC 分节**，标题格式 `## RFC-NNN: 标题` —— `/implement-rfc` 与 `/review-rfc` 靠它找到对应计划。不按测试类型分节。

---

## 0. STEP 0 · 基线

### 0.1 制定计划时（2026-11-17，阶段 6）

当时仓库里没有任何代码，实测：

```
$ ls package.json src tests
  ✗ 无 package.json
  ✗ 无 src/
  ✗ 无 tests/

$ pnpm test
ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND
```

所以本文件初稿里 `Exists?` 列全部是 `proposed`。

### 0.2 RFC-001/002 落地后（v1.2 / v1.7 回填）

RFC-001 / RFC-002 已实现并通过评审修复，`Exists?` 按实际落地情况回填（`existing: <文件>`）。当前实测：

```
$ pnpm test
 Test Files  65 passed (65)     # unit 58 个 + meta 7 个
      Tests  532 passed (532)

$ pnpm typecheck   ⇒ 0    $ pnpm lint ⇒ 0    $ pnpm format:check ⇒ 0    $ pnpm build ⇒ 0
```

覆盖统计：**16 个 RFC、222 条验收标准、其中 RFC-001 的 16 条全部已实现（`existing`）**，其余 15 个 RFC 仍为 `proposed`。

---

## 1. Product Type 与测试范围

依据 `PRD.md` 的 **Product Type**（game + web app），只规划适用的检查：

| 适用 | 对应层级 |
|---|---|
| 核心循环 / 状态机 | unit（引擎）+ integration（编排） |
| 响应式布局 | e2e（视口断言） |
| 无障碍 | e2e（键盘路径、语义、对比度） |
| 浏览器支持 | e2e（Playwright projects） |
| 页面加载预算 | performance（首屏预算） |
| 数据模型 / 事件流 | unit（重放、序列化） |
| 安全（密钥、注入、视野） | security（静态扫描 + 红队） |

**显式跳过**（理由同 PRD）：

| 跳过 | 理由 |
|---|---|
| 平台认证测试 | 纯浏览器交付，不上架商店 |
| 帧率 / 渲染性能 | 无实时渲染循环，性能只有首屏与 LLM 延迟 |
| 手柄 / 专用输入设备 | 只有键盘、鼠标、触屏 |
| 存档格式兼容性 | 无中途存档 |
| 账号 / 权限矩阵 | 无账号 |
| 多端同步 | 离线不可用，无同步 |
| SEO / 可抓取性 | 无公开内容页 |

---

## 2. 测试层级与工具

| 层级 | 工具 | 位置 | 跑在哪条命令 |
|---|---|---|---|
| unit | Vitest（node 环境） | `tests/engine/`、`tests/shared/` | `pnpm test` |
| integration | Vitest + `fastify.inject()` | `tests/server/` | `pnpm test` |
| component | Vitest + jsdom + Testing Library | `tests/client/` | `pnpm test` |
| security | Vitest（静态扫描 + 红队样本） | `tests/security/` | `pnpm test` |
| end-to-end | Playwright | `tests/e2e/` | `pnpm test:e2e` |
| performance | Playwright + `performance.now()` | `tests/perf/` | `pnpm test:e2e`（单独 project） |

**门禁（来自 RULES，不在此另立百分比）**：
- `TEST-2`：`src/engine/` 行覆盖率 ≥ 90%、分支 ≥ 85%，不得用忽略注释排除未测分支。
- `TEST-5`：提交前 `pnpm typecheck && pnpm lint && pnpm test`；涉及 UI 再加 `pnpm test:e2e`。
- `TEST-6`：每条 Must 级用户可见功能至少一条 Playwright 冒烟。

**通用替身**：LLM 一律用注入的假客户端（RFC-006 §4），测试不联网（`TEST-4`）；时间用显式 `ts` 注入，不读真实时钟；随机用显式 `seed`。

---

## 3. 总览

> 数字由逐节表格统计得出（测试行数），不是估算。

| RFC | 验收标准 | 计划测试行 | 需人工检查 |
|---|---|---|---|
| RFC-001 工程骨架与共享契约 | 16 | 14 | 0 |
| RFC-002 引擎内核 | 16 | 11 | 0 |
| RFC-003 板子与夜晚 | 16 | 10 | 0 |
| RFC-004 白天与胜负 | 16 | 8 | 0 |
| RFC-005 自曝与夜聊 | 14 | 7 | 0 |
| RFC-006 LLM 客户端 | 14 | 8 | 0 |
| RFC-007 投影与注入 | 16 | 10 | 0 |
| RFC-008 会话与存储 | 16 | 9 | 0 |
| RFC-009 人格与打法 | 11 | 7 | 1 |
| RFC-010 流式与降级 | 12 | 7 | 1 |
| RFC-011 玩家视角与通道 | 14 | 7 | 0 |
| RFC-012 界面与引导 | 15 | 8 | 2 |
| RFC-013 面板与观战 | 15 | 6 | 0 |
| RFC-014 复盘 | 14 | 6 | 1 |
| RFC-015 headless | 9 | 5 | 1 |
| RFC-016 浏览器与首屏 | 8 | 6 | 0 |
| **合计** | **222** | **126** | **6** |

**覆盖率**：222 / 222 条验收标准都有对应的测试行（由脚本逐 RFC 比对"验收标准编号集合"与"表格 Criterion 列"得出，无遗漏、无越界引用）。

## RFC-001: 工程骨架与共享契约

> v1.2 回填：本 RFC 已实现，`Exists?` 一律为 `existing`。测试分成两个 Vitest project：
> `unit`（纯函数与静态扫描，毫秒级）与 `meta`（起子进程跑 `pnpm` 命令，串行）。

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/meta/commands.test.ts`（5 例）：跑 `typecheck` / `lint` / `vitest --project unit` / `build`，再用 3999 端口起 `pnpm start` 探活并关掉。内层用 `--project unit` 避免递归（T-4） | integration | existing: tests/meta/commands.test.ts | Must |
| 2、3、4 | `tests/meta/tsconfig.test.ts`：`package.json` 三个字段、三份配置存在与 `moduleResolution`/`target`、`include` 边界、别名与 `configs/alias.ts` 一致；五个严格开关用**两向夹具**证明（开启必失败、关闭必通过，C-11 已推翻原文方向） | unit | existing: tests/meta/tsconfig.test.ts + tests/meta/fixtures/ | Must |
| 5、7 | `tests/shared/domain.test.ts`（`PHASES` 恰 14 且逐项相等、`expectTypeOf<Phase>()` 等值）+ `tests/shared/events.test.ts`（`EventEnvelope` 三字段缺失夹具） | unit | existing: domain.test.ts, events.test.ts | Must |
| 6 | `tests/shared/effects.test.ts`：省略 `target` 编译失败、`target: null` 合法、四个分区边界（C-12 由三改四）+ `expectTypeOf<typeof EFFECT_ORDER>()` 字面量断言 | unit | existing: tests/shared/effects.test.ts | Must |
| 8 | `tests/shared/terms.test.ts`：13 条键与标签逐项等于 PRD 术语表、`ROLE_LABELS` 5 项顺序等于 `ROLES` | unit | existing: tests/shared/terms.test.ts | Must |
| 9 | `tests/security/no-hardcoded-terms.test.ts`：扫 `src/**/*.{ts,tsx}`（排除 `terms.ts`），身份名集合从 `ROLE_LABELS` 反查 | security | existing: tests/security/no-hardcoded-terms.test.ts | Must |
| 10、11 | `tests/dependency-direction.test.ts`（路径按 RFC §3，T-6）+ `tests/helpers/import-scan.ts` 及其回归测试：静态 / 仅副作用 / 动态 `import()` / `require()` 四种写法都扫，防的是「动态导入绕过 `shared → server`」（评审 F5） | unit | existing: tests/dependency-direction.test.ts, tests/helpers/import-scan.test.ts | Must |
| 12 | `tests/server/health.test.ts`（`inject`）+ `tests/meta/dev-proxy.test.ts`：起真实 `pnpm dev`，`localhost:3000` 直连与 `localhost:5173` 代理都要 200 且 `{"ok":true}`。**不用 Playwright**（T-5：代理规则不需要浏览器内核） | integration | existing: 两文件 | Must |
| 13 | `tests/meta/build.test.ts`：跑 `pnpm build` 后断言 `dist/client/index.html` 与 `dist/server/index.js` 存在；递归扫 `dist/client` 无 `DEEPSEEK_API_KEY`、无 `@fastify/static` | integration | existing: tests/meta/build.test.ts | Must |
| 14、15 | `tests/meta/lint.test.ts`：用 ESLint API 问 `.ts` 与 `.tsx` 的**生效**等级（M8 的缺口）、`pnpm lint` / `format:check` / `test:e2e` 退出 0，且 `test:e2e` 的 stdout 含 `skipped`（M9） | integration | existing: tests/meta/lint.test.ts | Must |
| 16 | `tests/meta/selfplay-placeholder.test.ts`：退出码 1，stderr 同时含「未实现」与 `RFC-015`（M10） | integration | existing: tests/meta/selfplay-placeholder.test.ts | Must |
| F1（评审新增） | `tests/shared/events.test.ts`：`GameEvent` 的未知 type / 错误 payload 负向夹具、`GameEvent` 与 `EventEnvelope` 各一份（B3）、`GAME_EVENT_TYPES` 与 `keyof GameEventMap` 双向等值、`EventSchema` 拒绝假 type | unit | existing: tests/shared/events.test.ts | Must |
| F2（评审新增） | `tests/shared/actions.test.ts`：`WITCH_ACT` 三种非法组合在类型与 Zod 两侧都被拒、三种合法组合通过 | unit | existing: tests/shared/actions.test.ts | Must |
| F7（评审新增） | `domain.test.ts`（`SEAT_IDS` / `ROLES` / `FACTION_OF` / `FACTIONS` / `WIN_MODES`）、`effects.test.ts`（`EFFECT_SOURCES`）、`events.test.ts`（`SELF_VISIBILITY_PREFIX`） | unit | existing: 三个文件 | Should |
| CR-003（变更） | `tests/shared/events.test.ts`：三个 payload 形状——`REJECTED.actionType` 非法值编译失败、`VOTE_CAST` 缺 `seat` 编译失败、`AI_THOUGHT` 顶层 `claimedRole` 编译失败、嵌套 `claim` 通过 | unit | existing: tests/shared/events.test.ts | Must |

**依赖与夹具**：无前置。`tests/meta/` 会起子进程，两个 wait 超时分别是 30s（`start`）与 60s（`dev`），单例上限 180s。

---

## RFC-002: 引擎内核：状态机、事件流、种子与效果管道

> v1.5 回填：RFC-002 已实现，`Exists?` 全部 `existing`。计划 10 个文件，实际 12 个（多了
> `replay-parity.test.ts` 与 `no-network.test.ts`，少了独立的 `coverage.test.ts`——覆盖率
> 门禁挪进了 `tests/meta/`，因为它是会起子进程的门禁而不是引擎单测）。

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2 | `tests/engine/step.test.ts`：10 种 action 样本逐一断言 `reduce === step().state`；`Object.freeze` 后调用不抛；不修改 action | unit | existing: tests/engine/step.test.ts | Must |
| 3 | `tests/engine/serialization.test.ts`：JSON 往返 + 递归原型断言（含 `Date`/`Map`/`Set` 反例） | unit | existing: tests/engine/serialization.test.ts | Must |
| 4 | `tests/engine/replay.test.ts`：只传事件流重建；seq 跳号 / 首事件不对 / 缺 `rngAfter` / 未知类型 / gameId 混流各有否定用例 | unit | existing: tests/engine/replay.test.ts | Must |
| 5 | `tests/engine/determinism.test.ts`：同 seed + 同序列两次事件流逐条相等；不同 seed 发牌不同 | unit | existing: tests/engine/determinism.test.ts | Must |
| 6、7 | `tests/engine/events.test.ts`：seq 严格递增无跳号；首事件 `GAME_STARTED` 且 payload 四个字段齐全、可见性 `server`、带 `rngAfter` | unit | existing: tests/engine/events.test.ts | Must |
| 8 | `tests/engine/reject.test.ts`：phase 不匹配 → `Rejected`（`PHASE_MISMATCH`）且除 seq 外状态不变；另覆盖 `START_STATE_MISMATCH` | unit | existing: tests/engine/reject.test.ts | Must |
| 9 | `tests/engine/transitions.test.ts`：表覆盖 14 phase、每个允许对都有 handler、假表缺 handler 抛 `UnhandledTransitionError` | unit | existing: tests/engine/transitions.test.ts | Must |
| 10、11、12 | `tests/engine/effects.test.ts`：顺序（order + id）、两次应用相等、假 modifier 注入改变终态、无 modifier 时仅规范化 | unit | existing: tests/engine/effects.test.ts | Must |
| 13 | `tests/engine/rng.test.ts`（递归扫描 + 接线可注入，含临时目录嵌套用例）+ `tests/helpers/source-scan.ts` / `source-scan.test.ts`（helper 的递归能力与 POSIX 归一化）：扫描 `src/engine` 无 `Math.random(`（含反空转断言）+ PRNG 确定性 | unit | existing: 三个文件 | Must |
| 14、16 | `tests/meta/coverage.test.ts`（阈值 + 无忽略注释）+ `tests/setup/no-network.ts` 与 `tests/engine/no-network.test.ts`（`fetch` 抛错桩） | integration / unit | existing: 三个文件 | Must |
| 15 | `tests/engine/win.test.ts`：屠边/屠城各断言、RUL-5 只数存活、纯谓词（调用前后状态相等） | unit | existing: tests/engine/win.test.ts | Must |
| C-18（变更） | `tests/engine/replay-parity.test.ts`：`replay` 后用重建状态继续 `step`，事件/终态/胜负判定都与实时一致。比较的是整个 state，RFC-003 起加派生字段会自动覆盖 | unit | existing: tests/engine/replay-parity.test.ts | Must |

**夹具**：`tests/fixtures/states.ts`（`lobbyState` / `startedState` / `stateWithRoles`）。

---

## RFC-003: 板子分配、夜晚阶段与严格规则

> v1.7 回填：已实现，`Exists?` 全部 `existing`。计划 5 个文件，实际 6 个（多 `queries.test.ts`）。
> AC-8 / AC-16 的措辞已按 RFC-002 §2.3 的机械判据修正，见 RFC-003 §8.3。

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/engine/deal.test.ts`：50 个固定种子，角色计数恒为 3/1/1/1/3 | unit | existing: tests/engine/deal.test.ts | Must |
| 2 | `deal.test.ts`：同 seed 两次发牌一致、座位角色由发牌决定；`events.test.ts`：`GAME_STARTED.payload.roles` 与发牌结果及 `state` 一致 | unit | existing: tests/engine/deal.test.ts + tests/engine/events.test.ts | Must |
| 3 | 同上：玩家席位三类身份各出现 ≥1 次 | unit | existing: tests/engine/deal.test.ts | Must |
| 4 | `tests/engine/night.test.ts`：`WOLF_KILL_CHOSEN` 的 `visibleTo === 'wolves'` | unit | existing: tests/engine/night.test.ts | Must |
| 5 | 同上：`TARGET_NOT_ALIVE` / `WOLF_KILL_WOLF`，状态除 `seq` 外不变；非狼提交 → `NOT_YOUR_TURN` | unit | existing: tests/engine/night.test.ts | Must |
| 6 | `tests/engine/seer.test.ts`：三种目标、`visibleTo === 'seer'`、`result` 与阵营一致 | unit | existing: tests/engine/seer.test.ts | Must |
| 7 | `tests/engine/witch.test.ts`：自救 → `WITCH_SELF_SAVE`；毒自己合法 | unit | existing: tests/engine/witch.test.ts | Must |
| 8 | 同上：第二次用药 → `PHASE_MISMATCH`（**AC 已修正**）；非女巫 → `NOT_YOUR_TURN` | unit | existing: tests/engine/witch.test.ts | Must |
| 9 | 同上：次夜复用已用药 → `POTION_ALREADY_USED`（构造的第二夜状态） | unit | existing: tests/engine/witch.test.ts | Must |
| 10 | 同上：解药命中刀口 → 无 `PLAYER_DIED` | unit | existing: tests/engine/witch.test.ts | Must |
| 11 | 同上：解药未命中 → 只有刀口出局；毒药另加一条 | unit | existing: tests/engine/witch.test.ts | Must |
| 12 | `tests/engine/death-resolve.test.ts`：被刀出局的 hunter 进 `NIGHT_HUNTER_SHOOT`；开枪效果 `source: 'role'`、order 在 200 区；带走最后一狼 → 好人胜 | unit | existing: tests/engine/death-resolve.test.ts | Must |
| 13 | 同上：被毒杀的 hunter 不进开枪阶段、无 `HUNTER_SHOOT` 事件 | unit | existing: tests/engine/death-resolve.test.ts | Must |
| 14 | 同上：hunter 是最后一个神 → 同一步内 `GAME_ENDED`、相位 `FINISHED`、无开枪（RUL-1） | unit | existing: tests/engine/death-resolve.test.ts | Must |
| 15 | 同上：解药 < 击杀 < 开枪的 order；夜晚效果 `source` 全为 `role`；效果存活集与事件集一致 | unit | existing: tests/engine/death-resolve.test.ts | Must |
| 16 | `tests/engine/night.test.ts`：夜晚结束停在 `DAY_SPEECH`（`DAY_ANNOUNCE` 是自动阶段，不停留）；对 `DAY_SPEECH` 提交 `VOTE` → `Rejected`（`PHASE_MISMATCH`）且除 `seq` 外状态不变（**AC 经两次修正，见 RFC-003 §5**） | unit | existing: tests/engine/night.test.ts | Must |
| 查询（§3 交付物） | `tests/engine/queries.test.ts`：`aliveSeats` / `countAliveByFaction` / `findAliveByRole` / `seatAt` 的语义 | unit | existing: tests/engine/queries.test.ts | Should |
| C-23（评审 B2） | `tests/engine/night-visibility.test.ts`：夜间相位一律 `server`；一整夜的公开事件只允许「天亮推进」、`GAME_ENDED` 与合法的 `HUNTER_SHOOT` | unit | existing: tests/engine/night-visibility.test.ts | Must |
| C-24（评审 B1） | `tests/engine/death-resolve.test.ts`：毒药指向狼刀目标时只出局一次、死因 `poison`；目标是 hunter 时不进开枪阶段 | unit | existing: tests/engine/death-resolve.test.ts | Must |
| B3（评审） | `tests/shared/schemas.test.ts`：6 个事件 payload + `GAME_ENDED` 的正反例 | unit | existing: tests/shared/schemas.test.ts | Must |
| C-27（评审 → RUL-12） | `tests/engine/win.test.ts`：直接构造「两阵营同时达成」（屠边的神/民、屠城）断言 **wolf 胜**；`tests/engine/death-resolve.test.ts`：走真实夜间路径（最后一名神被刀 + 最后一只狼被毒）断言 `GAME_ENDED { result: 'wolf' }` | unit | existing: 两个文件 | Must |

**依赖与夹具**：`tests/fixtures/night.ts`（沿真实路径推进到女巫阶段 + `makeNightState` 构造残局）。

---

## RFC-004: 白天发言、投票与胜负判定（16 条 AC + 1 条 C-31 补充）

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3、4 | `tests/engine/day.test.ts`：发言序列单循环不重不漏；有死者时起点为死者下一位；无死者时同 seed 起点相同且写在 `DAY_STARTED.payload`；起点不是死者 | unit | existing: tests/engine/day.test.ts | Must |
| 4b（C-31） | `tests/engine/day.test.ts`：真实夜间路径下 `diedLastNight` 按座位升序；`pendingDeaths` 两种顺序得到同一 `speechStartSeat`（按结算顺序会是另一个值） | unit | existing: tests/engine/day.test.ts | Must |
| 5、6 | `tests/engine/vote.test.ts`：`VOTE_CAST.visibleTo === 'self:<seat>'`；最后一张票之前没有任何公开事件；`VOTE_REVEALED` 覆盖全部存活席位与 `abstain`（「投影」用 `isVisibleTo` 表达，见 RFC-004 §8.1） | unit | existing: tests/engine/vote.test.ts | Must |
| 7 | 同上：唯一最高票出局，`PLAYER_DIED.cause === 'lynch'` | unit | existing: tests/engine/vote.test.ts | Must |
| 8、9 | 同上：并列进重投、`runoff` 仅并列者；弃权或投非并列者 → `INVALID_RUNOFF_TARGET`；重投仍并列 / 全员弃权 → 当日无人出局入夜 | unit | existing: tests/engine/vote.test.ts | Must |
| 10、11 | `tests/engine/win.test.ts` + `tests/engine/lynch.test.ts`：屠边三种（狼死于刀 / 毒 / 放逐）与屠城两种 | unit | existing: 两个文件 | Must |
| 12、13 | `tests/engine/lynch.test.ts`：放逐最后一名神（hunter）→ 第一次判定狼胜、无 `HUNTER_SHOOT`；放逐 hunter 后开枪带走最后一狼 → 第二次判定好人胜 | unit | existing: tests/engine/lynch.test.ts | Must |
| 14 | `tests/engine/lynch.test.ts`：无 `draw`；`GameState` 无 `stalemateDays` | unit | existing: tests/engine/lynch.test.ts | Must |
| 15、16 | `tests/engine/full-game.test.ts`：固定 seed 脚本从 `LOBBY` 跑到 `FINISHED`；终局后提交 → `PHASE_MISMATCH` 且除 `seq` 外不变；`replay` 得同一终局 | integration | existing: tests/engine/full-game.test.ts | Must |

**依赖与夹具**：RFC-003 的夜晚。实际用 `tests/fixtures/day.ts`（沿真实路径走到 `DAY_SPEECH` / 投票），没有 `scripted-game.ts`——脚本内联在 `full-game.test.ts` 里，因为它只服务那一条用例。

---

## RFC-005: 狼人自曝与夜间私聊

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3、4 | `tests/engine/visibility.test.ts`：`public` / `server` / `wolves` / `self:<n>` × 9 观察者 × 死亡时序；`wolves` 不因出局中断（用户裁决），其余按死亡收窄 | unit | existing: tests/engine/visibility.test.ts | Must |
| 5、6 | `tests/engine/wolf-chat.test.ts`：发牌后停在 `NIGHT_WOLF_CHAT`（排在 `NIGHT_WOLVES` 前）；`WOLF_CHAT_POSTED` 的 `visibleTo === 'wolves'` | unit | existing: tests/engine/wolf-chat.test.ts | Must |
| 7、8 | 同上：未全部提交前 `WOLF_KILL` → `PHASE_MISMATCH`；空串也算提交并推进 | unit | existing: tests/engine/wolf-chat.test.ts | Must |
| 9 | 同上：白天提交 `WOLF_CHAT` → `REJECTED`，除 `seq` 外不变 | unit | existing: tests/engine/wolf-chat.test.ts | Must |
| 10、11 | `tests/engine/self-expose.test.ts`：两个白天阶段各一次自曝 → 公开事件、相位进 `NIGHT_WOLF_CHAT`、当日无 `VOTE_CAST`/`VOTE_REVEALED` | unit | existing: tests/engine/self-expose.test.ts | Must |
| 12、13 | 同上：非狼 → `NOT_A_WOLF`；已出局狼 → `NOT_ALIVE`；自曝前后存活计数不变 | unit | existing: tests/engine/self-expose.test.ts | Must |
| 14 | 同上：9 个观察者过滤后只有狼能看到夜聊 | unit | existing: tests/engine/visibility.test.ts | Must |

---

## RFC-006: LLM 接入与结构化决策

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3 | `tests/security/llm-isolation.test.ts`：扫描 `src/` 断言 `api.deepseek.com` 字面量只出现在 `client.ts`；断言 `DEEPSEEK_API_KEY` 只被 `config.ts` 读取；构造带敏感内容的 500 响应，断言错误 message 不含原文 | security | existing: tests/server/llm + tests/security | Must |
| 4、5 | `tests/server/llm/retry.test.ts`：假 `fetch` 依次返回超时/网络错误/429/5xx，断言各重试一次；4xx 不重试；环境变量覆盖生效 | unit | existing: tests/server/llm + tests/security | Must |
| 6 | 同上：同一 `(gameId, seat)` 同一决策轮次内，重试后只产生一个 action | unit | existing: tests/server/llm + tests/security | Must |
| 7、8 | `tests/server/llm/schema.test.ts`：缺 `reason` 被拒；校验失败后第二次请求消息中含首次错误文本 | unit | existing: tests/server/llm + tests/security | Must |
| 9、10 | `tests/server/llm/to-action.test.ts`：`vote`+合法 target → `VOTE`；非法 target → `{reject}`；`abstain` → `target:'abstain'`；`speak`+空文本 → `{reject}`；非猎人阶段 `shoot` → `{reject}` | unit | existing: tests/server/llm + tests/security | Must |
| 11 | `tests/security/prompt-identity.test.ts`：`buildSystemPrompt` 输出断言不含 `human`/`真人`/`你是 AI`/`助手`/`玩家是用户` | security | existing: tests/server/llm + tests/security | Must |
| 12、13 | `tests/server/llm/meta.test.ts`：断言 `CallMeta` 13 个字段齐全；`attempt` 在重试时递增；业务代码除 `config.ts` 外无 `'deepseek-flash'` 字面量 | unit | existing: tests/server/llm + tests/security | Must |
| 14 | 同上：假 `fetch` 返回固定 JSON，断言 `Decision` 被解析且 `CallMeta` 被写 | unit | existing: tests/server/llm + tests/security | Should |

> **RFC-006 Round 1 评审（2026-11-18）**：本表仍全部为 `proposed`，与落地不符——实际用例在 `tests/server/llm/{client,to-action,prompts}.test.ts` 与 `tests/security/llm-isolation.test.ts`。AC-5 的「网络错误 / 429 各重试一次」与 AC-6 的「重试不重复 action」没有用例；`.tsx` 未被 `collectTypeScriptFiles` 扫描，AC-1 / AC-2 / AC-13 对 `src/client/main.tsx` 是空断言。详见 `reviews/REVIEW-RFC-006.md` §2 / §3 / B6。补齐前不要把对应行改回 `existing`。

---

## RFC-007: 上下文投影与注入隔离

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/server/project/purity.test.ts`：同输入两次深相等、不改入参；不构造 LLM 客户端即可调用 | unit | existing: tests/server/project + tests/server/inject | Must |
| 2 | `tests/server/project/property.test.ts`：固定种子生成 1000 个合法局面 × 9 观察者，断言 `self.role` 恰为自己、输出无他人角色字段 | unit | existing: tests/server/project + tests/server/inject | Must |
| 3、4、5 | `tests/server/project/knowledge.test.ts`：狼/预言家/女巫三者断言 `teammates`/`checks`/`potions`；好人侧断言空值形态（`[]`、`'used'`） | unit | existing: tests/server/project + tests/server/inject | Must |
| 6、7 | 同上：猎人仅开枪阶段 `canShoot===true`；女巫在 `pending==='witch'` 时 `knownKillTarget` 等于刀口，其余为 `null` | unit | existing: tests/server/project + tests/server/inject | Must |
| 8、9 | `tests/server/project/partition.test.ts`：对 9 观察者断言并集等于按序折叠判定的可见集合、无交集；非狼观察者不含 `wolves` 事件 | unit | existing: tests/server/project + tests/server/inject | Must |
| 10 | `tests/server/project/serialization.test.ts`：输出 JSON 往返深相等 | unit | existing: tests/server/project + tests/server/inject | Must |
| 11 | `tests/server/inject/wrap.test.ts`：文本只出现在标签内且 `<>` 被转义；系统提示含 `INJECTION_NOTICE`（逐字） | unit | existing: tests/server/project + tests/server/inject | Must |
| 12、13 | 同上：同一文本玩家/AI 封装输出逐字相同；301 字符被拒绝并返回错误码 | unit | existing: tests/server/project + tests/server/inject | Must |
| 14、15 | `tests/security/red-team.test.ts`：20 种对抗样本（含「忽略以上指令」、伪造闭合标签、JSON 块、代码块）后 `events`/`state` 深不变；`AI_THOUGHT` 只出现在该席位 `privateEvents`，对 8 个他人不可见 | security | existing: tests/server/project + tests/server/inject | Must |
| 16 | `tests/server/inject/current-speech.test.ts`：传 `excludeSeq` 后该 `SPEECH` 不在 `publicEvents`，封装槽位使用其文本 | unit | existing: tests/server/project + tests/server/inject | Must |
| C-28（评审） | `tests/server/project/night-visibility.test.ts`：死 seer / 死 witch 的跳过夜与 hunter 开枪夜，断言非相关观察者拿到的 `phase` 是公共阶段、`aliveSeats` / `deadSeats` 不含当夜未公开死亡；`state.phase` 的内部子阶段不出现在投影里 | unit | existing: tests/server/project + tests/server/inject | Must |

> **RFC-007 Round 1 评审（2026-11-18）**：上表多行标 `existing`，实际只有 `tests/server/project/project.test.ts` 与 `tests/server/inject/injection.test.ts`；1000 局面属性测试、C-28 的 `tests/server/project/night-visibility.test.ts`、AC-4 / AC-5 / AC-6 / AC-7 / AC-15 等断言缺失或不能变红（M1~M5、M7 全绿）。补齐前不要把对应行改回 `existing`。详见 `reviews/REVIEW-RFC-007.md` §2.3 / §8。
>
> **RFC-007 Round 2 复核（2026-11-18）**：`night-visibility.test.ts` 已存在，AC-4~7 的精确用例可被 K1~K4 打红；但 AC-2 的 1000 局面属性测试、AC-8 / AC-9 的独立折叠对照（`tests/server/project/partition.test.ts`）、AC-15 的 `AI_THOUGHT` 投影用例仍缺；C-28 的 `aliveSeats` 也未断言（M3 全绿）。详见 `reviews/REVIEW-RFC-007.md` Round 2 §1.5 / §4。
>
> **RFC-007 Round 3 复核（2026-11-18）**：`tests/server/project/partition.test.ts` 与 `tests/server/project/thought.test.ts` 已落地，分别被 M6b / M5 打红；C-28 的 `aliveSeats` / `legalTargets` 夜间方向与 `FINISHED` 终局揭示已有可红回归锁（M3 / M4 / M4b / M7）。仍缺：AC-2 的 1000 局面属性测试（`property.test.ts` 不存在）；`aliveSeats` / `legalTargets` 的反方向（天亮 / 放逐后已知死者必须移出）无锁（M8 / M9 全绿）；重投分支未排除观察者自己、无测试。详见 `reviews/REVIEW-RFC-007.md` Round 3 §1-§3。

## RFC-008: 会话、状态存储与刷新恢复

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/server/session.test.ts`：同一 cookie 连发三次 `POST /api/games`，`GET /api/session` 返回 3 条；`Session.games` 为数组（类型断言） | integration | existing: tests/server/{session,resume,store}.test.ts | Must |
| 2、3 | 同上：创建响应含 `gameId`/`seed`/`playerSeat`/`version`，`seed` 与 `GAME_STARTED` 一致；指定 `mode` 生效 | integration | existing: tests/server/{session,resume,store}.test.ts | Must |
| 4 | 同上：断言 `Set-Cookie` 含 `HttpOnly`、`SameSite=Lax`、`Path=/`，会话 id ≥32 | integration | existing: tests/server/{session,resume,store}.test.ts | Must |
| 5、6 | `tests/server/resume.test.ts`：两次独立 `inject`（不复用响应对象）取同一局，断言 `version` 与 `view` 深相等 | integration | existing: tests/server/{session,resume,store}.test.ts | Must |
| 7 | `tests/server/projection-leak.test.ts`：对 9 个 `playerSeat` 各请求一次，断言响应中无他人角色字段 | security | existing: tests/server/{session,resume,store}.test.ts | Must |
| 8、9、10 | `tests/server/actions.test.ts`：正确版本推进；重复旧版本 → `ALREADY_APPLIED`；过期未应用版本 → `VERSION_MISMATCH`；他人 `gameId` → `404 GAME_NOT_FOUND` | integration | existing: tests/server/{session,resume,store}.test.ts | Must |
| 11、12 | `tests/server/store.test.ts`：`MetaStore.get` 返回值修改后不影响存储；换 Mock 实现后全部测试通过；静态断言 `src/server/` 除 `meta-store.ts` 外无模块级 `Map` 作存储 | integration | existing: tests/server/{session,resume,store}.test.ts | Should |
| 13、14 | 同上：终局后不再缓存 `GameState`，再取时重新 `replay` 得同一状态；跑完 100 局后完整 `events` 不超过 3 局 | integration | existing: tests/server/{session,resume,store}.test.ts | Should |
| 15、16 | 同上：未终局 `replay` 端点 `404 NOT_FINISHED`、`stream` 端点 `501 NOT_IMPLEMENTED`；`package.json` 无数据库驱动 | integration | existing: tests/server/{session,resume,store}.test.ts | Should |

## RFC-009: AI 人格与高级打法

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、11 | `tests/engine/personas.test.ts`：断言整局人格 id 不变、同局不重复、同 seed 分配可复现 | unit | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 3、4 | 同上：1000 局统计「人格 × 阵营」交叉表断言无显著相关（固定种子集合，不用随机失败阈值）；同局内至少 3 个 AI 的句长或攻击性比例极差超阈值 | integration | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 5 | `tests/engine/annotate.test.ts`：复盘数据中人格标签与席位一一对应 | unit | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 6、7 | 同上：构造满足/不满足条件的决策各一组，断言悍跳与狼查杀狼判定为真/假 | unit | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 8 | 同上：替换 `speech` 措辞（含/不含「预言家」字样）后判定结果不变 | unit | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 9 | `tests/engine/scenarios/advanced-play.test.ts`：固定种子 + 预置决策序列，断言三类事件各触发 ≥3 次 | integration | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |
| 10 | `tests/engine/personas.test.ts`：改变人格后非法 action 仍非法 | unit | existing: tests/engine/{personas,personas-start,annotate}.test.ts | Must |

**需人工**：人格差异的「好不好玩」无法自动判定。**手工检查**：连看 3 局，确认 8 个 AI 的发言能被人类一眼区分出至少 4 种语气。

---

## RFC-010: 流式发言、思考指示与降级

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、3、4 | `tests/e2e/stream.spec.ts`：记录首字与完成时间，单局 ≥30 次发言算 p95；断言思考态与发言态在 DOM 上可区分 | e2e | proposed | Must |
| 2 | `tests/e2e/stream.spec.ts`：注入 50 字文本，在 `done` 前断言已渲染出至少 2 个中间态 | e2e | proposed | Must |
| 5 | `tests/server/sse.test.ts`：断言每条消息 `id === seq`；带 `Last-Event-ID` 重连后从下一个 `seq` 继续、不重不漏 | integration | proposed | Must |
| 6 | 同上：把中文字节在任意位置切开喂给解析器，断言无乱码 | unit | proposed | Must |
| 7、8 | `tests/server/degrade.test.ts`：假客户端超时/失败，断言重试 1 次后降级，产出 `DEGRADED` 且发言 ≤10 字；重试成功则不降级 | unit | proposed | Should |
| 9、10、12 | 同上：降级后下一席位正常、`seq` 连续；连续 3 次降级后第 4 次仍调用真实客户端；前端收到 `degraded` 显示提示 | integration | proposed | Should |
| 11 | `tests/server/replay-degrade.test.ts`：复盘数据标注降级轮次 | unit | proposed | Should |

**需人工**：NFR-1 的 p95 必须用**真实 API** 测一次并记录数字（假客户端证明不了延迟）。**手工检查**：`pnpm selfplay --games=3` 后统计日志中的首字与完成时间，把结果写进该 RFC 的 Implementation Notes。

---

## RFC-011: 玩家视角、发言输入与通道抽象

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3 | `tests/client/id-card.test.tsx`：对 9 个 `playerSeat` 渲染断言只含自己角色；预言家/女巫/猎人/狼各自的额外项出现；DOM 扫描无他人角色名 | component | proposed | Must |
| 4、5、6、7 | `tests/client/speech-input.test.tsx`：60 秒倒计时可见；301 字符无法继续输入且服务端拒绝；倒计时归零自动提交；空输入产出 `SPEECH_SKIPPED` | component | proposed | Must |
| 8 | `tests/server/inject/current-speech.test.ts`：提交后的文本原样出现在他人投影的 `<public_utterance>` 中并带 `seat` | integration | proposed | Must |
| 9、12 | `tests/meta/dependency-direction.test.ts`：断言 `src/engine/` 不出现 `InputChannel`/`OutputChannel`；`engine` 仍只依赖 `shared` | unit | proposed | Must |
| 10、11 | `tests/server/channels.test.ts`：用 `ScriptedChannel` 在无浏览器、无 LLM 下跑完整局；新增一个通道实现不修改 `engine` 与 `shared` 之外的文件 | integration | proposed | Must |
| 13 | `tests/server/channels.test.ts`：刷新后剩余时间不回满，超时仍按原起点触发 | integration | proposed | Must |
| 14 | 见 AC-9/12 同文件 | unit | proposed | Must |

---

## RFC-012: 对局界面、新手引导与响应式

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/e2e/game.spec.ts`：断言三块区域存在，阶段与天数正确 | e2e | proposed | Must |
| 2、3 | `tests/e2e/terms.spec.ts`：悬停与键盘聚焦都能看到解释；扫描 `src/client/` 无术语字面量 | e2e | proposed | Must |
| 4、5 | `tests/e2e/onboarding.spec.ts`：引导提示出现且不自动填入；关闭后刷新不再出现 | e2e | proposed | Must |
| 6、7 | `tests/e2e/order.spec.ts`：三项信息正确；注入预置事件流后当前发言者与最后一条发言事件的下一席位一致 | e2e | proposed | Should |
| 8、9、10 | `tests/e2e/responsive.spec.ts`：360px 无横向滚动（`scrollWidth <= clientWidth`）；1024px 侧栏布局；输入框与轮次/倒计时元素几何不重叠 | e2e | proposed | Must |
| 11 | `tests/e2e/keyboard.spec.ts`：纯键盘完成「发言 → 投票」 | e2e | proposed | Must |
| 12、13、14 | `tests/e2e/a11y.spec.ts`：断言无无替代 `outline:none`；对比度 ≥4.5:1；倒计时/阵营/存活均有文字 | e2e | proposed | Must |
| 15 | 同上：可访问名称断言能读出身份、阶段、轮到谁 | e2e | proposed | Must |

**需人工**：屏幕阅读器的实际听感。**手工检查**：VoiceOver（macOS）走一遍第一夜到第一次投票，确认三件事都能听到。

---

## RFC-013: 事件面板、观战与真相视图

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3、4 | `tests/client/event-panel.test.tsx`：按 `seq` 排序；仅三类条目；每条带 `seq` 与天数；点击能定位到发言流 | component | proposed | Should |
| 5、6、7 | `tests/client/spectator.test.tsx`：出局后切观战态仍见后续发言；输入区禁用并提示；对局继续到 `FINISHED` | component | proposed | Should |
| 8、9、10 | 同上：真相开关默认关；开启显示身份与夜间行动；关闭立即恢复 | component | proposed | Should |
| 11 | 同上：开关前后事件流深相等 | component | proposed | Should |
| 12 | `tests/server/truth-guard.test.ts`：未出局时请求真相数据被拒 | integration | proposed | Should |
| 13、14、15 | `tests/client/notepad.test.tsx`：仅自己可见；不进 AI 上下文（断言注入文本不含）；刷新后仍在 | component | proposed | Could |

---

## RFC-014: 复盘与再来一局

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2 | `tests/server/replay.test.ts`：黄金文件测试——固定事件流 → 断言快照 `timeline` 按 `seq` 升序且与事件流一致；`seats` 揭示全部 9 席 | integration | proposed | Must |
| 3、4 | 同上：每条 `reason` 与 `AI_THOUGHT` 载荷逐字一致；清空 `reasoning_content` 后快照不变 | unit | proposed | Must |
| 5、6、7、8 | 同上：人格标签正确；`result` 与 `winCondition` 能定位到达成那一条事件；`degraded` 与 `DEGRADED` 事件一一对应；`usage` 等于 `CallMeta` 聚合 | integration | proposed | Must |
| 9、10、11 | `tests/server/replay-perspective.test.ts`：选中某 AI 后的可见集合等于该 `seq` 的 `project` 输出；筛选前后时间线条数不变；3 席 × 3 `seq` 断言无越权信息 | integration | proposed | Could |
| 12、13 | `tests/e2e/replay.spec.ts`：点「再来一局」建新局且无上局事件；状态释放后复盘端点仍返回完整快照 | e2e | proposed | Must |
| 14 | `tests/e2e/replay.spec.ts`：360px 与 1024px 均可完整浏览 | e2e | proposed | Must |

**需人工**：SM-2「观察者看完能复述 2 个 AI 的意图」。**手工检查**：找一个没参与开发的人看一局复盘，记录他能复述的 AI 意图数量。

---

## RFC-015: headless 自动对局

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3 | `tests/server/selfplay.test.ts`：假 LLM 下跑 3 局，断言退出码 0、种子为 `seed+N`、输出含 `summary.json` 与每局事件流 | integration | proposed | Must |
| 4 | 同上：`summary.json` 含总局数/成功/失败/原因/胜负分布/降级次数/token | integration | proposed | Must |
| 5、6 | 同上：注入必抛错的假客户端，断言其余局仍跑完且失败局单独记录；脚本化玩家产生非法行动时归类为「实现缺陷」 | integration | proposed | Must |
| 7 | 同上：跑 100 局后断言进程内存峰值不随局数线性增长（采样 `process.memoryUsage().heapUsed`） | performance | proposed | Must |
| 8、9 | 同上：命令不再以「未实现」退出；每局事件流 `seq` 连续且 `replay` 通过 | integration | proposed | Must |

**需人工**：SM-1 的真实 100 局。**手工检查**：用真实 API 跑一次 `pnpm selfplay --games=100`，记录成功率与 token 合计（费用估算见 `PRD-REVIEW.md` §2，flash 约 ¥30–80）。

---

## RFC-016: 浏览器兼容与首屏性能

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2 | `tests/e2e/browsers.spec.ts`：Playwright 三个 engine（chromium/firefox/webkit）跑主路径 | e2e | proposed | Should |
| 3 | `tests/e2e/capabilities.spec.ts`：注入删掉 `EventSource` 的脚本，断言显示中文提示且不白屏 | e2e | proposed | Should |
| 4 | 复用 RFC-010 的 `Last-Event-ID` 断言 | integration | proposed | Should |
| 5 | `tests/perf/first-paint.test.ts`：5 次取中位数断言 ≤2 秒 | performance | proposed | Should |
| 6、7 | `tests/perf/bundle.test.ts`：断言首屏 JS 不含复盘页与流式模块标识；全部产物不含 LLM 调用代码或密钥 | security | proposed | Should |
| 8 | `tests/e2e/first-paint.spec.ts`：从加载到按钮可点期间网络请求不含 `/api/games` | e2e | proposed | Should |

---

## 4. 需要人工测试的部分（全量清单）

| # | 项目 | 为什么不能自动化 | 谁来做 |
|---|---|---|---|
| M-1 | 人格差异「好不好玩」 | 主观观感 | 开发者，连看 3 局 |
| M-2 | NFR-1 的真实 p95 | 需要真实 API 与网络 | 开发者在 M5 实测并记录 |
| M-3 | 屏幕阅读器听感 | 需要真人用读屏软件 | 开发者，VoiceOver 走一遍 |
| M-4 | SM-2 观察者能否复述 AI 意图 | 需要真实人类观察者 | 找一个未参与开发的人 |
| M-5 | SM-1 的真实 100 局成功率 | 真实 API + 费用 | 开发者在 M7 后执行一次 |
| M-6 | 移动端真机手感 | 模拟器不覆盖真实输入法与键盘弹起 | 开发者，一部真机 |

这些必须在对应 RFC 的 `## Implementation Notes` 中记录结果，否则等于没做。

---

## 5. 覆盖缺口

| 缺口 | 说明 | 处置 |
|---|---|---|
| 无已有测试 | 项目尚未写第一行代码 | 从 RFC-001 起按本计划逐条落地 |
| NFR 的量化指标 | NFR-8（首屏）有测试；NFR-1（延迟）只能靠 M-2 人工实测 | 接受，已在 M-2 记录 |
| 成本观测 | 只能靠 M-5 的真实跑 | 接受 |
| 跨浏览器真机 | 只覆盖 Playwright 三引擎 | 接受，见 M-6 |

---

## 6. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| TS-1 | `tests/meta/` 的构建类测试是否进 `pnpm test` | **(assumption)** 进，但用 `describe.skipIf(!process.env.CI)` 之外的条件跳过较慢的 `pnpm build`（本机约 20s） |
| TS-2 | 属性测试是否引入 `fast-check` | **(assumption)** 不引入，用固定种子 + 手写生成器，避免新增依赖（`DOC-2` 要求登记） |
| TS-3 | E2E 是否在提交门禁里 | **(assumption)** 是；`TEST-5` 要求涉及 UI 的改动跑 `pnpm test:e2e` |
| TS-4 | 100 局内存测试的阈值 | **(assumption)** `heapUsed` 峰值不超过首局的 2 倍 |

---

## 7. Open conflicts

| # | 冲突 | 处置 |
|---|---|---|
| T-1 | `RULES TEST-6` 要求「每条 Must 级**用户可见**功能至少一条 Playwright 冒烟」，但 RFC-001/002/003/004/005 没有任何用户可见功能 | 按 RULES 的本意解释：TEST-6 从 RFC-012（首个用户可见功能）起生效。已在 RFC-001 的 §4 与本文件 §2 注明 |
| T-2 | `FEATURES F2` 的 AC 曾要求「10000 步内必达终局」，而 RUL-10 已移除平局兜底 | 已由 `CHANGE-REQUEST-002` 解决：终止性由「解药唯一 + 死亡单调累积」保证；测试改为断言 `replay` 一致与随机输入不挂起，不设固定步数上限 |
| T-3 | `RFC-013` 的 F29/F32 是 Could，但计划里仍给了测试 | 保留：Could 功能一旦实现就必须有验收，若被砍则不执行这些测试行 |
| T-4 | RFC-001 第 1 行要求「依次执行 5 条 `pnpm` 命令」含 `pnpm test` 自己——**在本测试里跑完整 `pnpm test` 会无限递归** | 内层改为 `pnpm exec vitest run --project unit`（`tests/meta/commands.test.ts`）。完整套件的结果由实现会话在 RFC 的 `## Implementation Notes` 里贴原始输出 |
| T-5 | RFC-001 第 12 行要求「用 Playwright 请求 `localhost:5173/api/health` 断言代理生效」，但同一 RFC §4 又要求 `test:e2e` 在无用例时退出 0——两条互斥，且为一条代理规则装浏览器内核不划算 | 代理验证改为 `tests/meta/dev-proxy.test.ts`：起真实 `pnpm dev`，用 HTTP 请求打 `:3000` 与 `:5173`。本阶段不引入 Playwright 浏览器依赖；`test:e2e` 由 `scripts/test-e2e.mjs` 保证零用例时打印 `skipped` 并退出 0 |
| T-6 | `tests/dependency-direction.test.ts` 的路径：RFC-001 §3 写 `tests/`，本文件写 `tests/meta/` | 按 RFC 走（权威顺序 `RULES > RFC > 计划`）：放 `tests/dependency-direction.test.ts`，它属于快的 `unit` project；其余 5 个新增门禁测试按本文件放 `tests/meta/` |
| T-7 | `TS-1` 假设「构建类测试进 `pnpm test` 但跳过较慢的 `pnpm build`」 | 实测 `pnpm build` 在本项目只要约 0.5s（客户端产物 220 kB），**不跳过**：`pnpm test` 全量 57 个用例约 14s，可以接受。若后续变慢再引入跳过条件 |

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-18 | v1.19 | RFC-007 Round 1 评审回填：C-28 / 1000 属性 / AC-4 / AC-5 / AC-6 / AC-7 / AC-15 等计划行并非 `existing`；C-28 仍 Open，阻塞 RFC-007。详见 `reviews/REVIEW-RFC-007.md` |
| 2026-11-19 | v1.20 | RFC-008 多轮修复后回填：测试文件拆分（strengthen / release-and-entry / finished-game）；基线 498 → 500 |
| 2026-11-19 | v1.19 | RFC-008 实现后回填：16 条 AC 全部 `existing`；基线 458 → 477 |
| 2026-11-18 | v1.18 | RFC-007 实现后回填：16 条 AC 全部 `existing`（`tests/server/project` + `tests/server/inject`）；基线 369 → 389 |
| 2026-11-18 | v1.17 | RFC-005 实现后回填：14 条 AC 全部 `existing`；基线 342 → 366 |
| 2026-11-18 | v1.16 | RFC-004 Round 2 回填：补 AC-4b 行（C-31 的第二条路径）、同步版本引用 |
| 2026-11-18 | v1.15 | RFC-004 Round 1 回填：C-31 / B2 / 三条不设防测试补齐；基线 337 → 342 |
| 2026-11-18 | v1.14 | RFC-004 实现后回填：16 条 AC 全部 `existing`；夹具改为 `tests/fixtures/day.ts`（无 `scripted-game.ts`）；基线用例数 309 → 337 |
| 2026-11-18 | v1.13 | RFC-003 Round 4 回填（C-30 / 测试缺口）：基线用例数 307 → 309；AC-2 的证据归属改为「`events.test.ts` 真实事件」 |
| 2026-11-18 | v1.12 | RFC-003 Round 3 修复后回填：C-27 落榜为 RUL-12（wolf 胜）并补真实路径用例；基线用例数 295 → 307 |
| 2026-11-18 | v1.11 | RFC-003 Round 3 评审回填：C-23 的公开白名单补合法的 `HUNTER_SHOOT`；RFC-003 加 **C-27**（同时满足两阵营胜利条件）计划行，RFC-007 加 **C-28**（投影的夜间相位 / 死亡泄漏）计划行；引用 `RFCS.md` v2.22 |
| 2026-11-18 | v1.10 | RFC-003 Round 2 修复后回填：RUL-11 落榜、C-26 死亡顺序、hunter 真实路径可见性、PAYLOAD_SCHEMAS 完整性；基线用例数 291 → 295 |
| 2026-11-18 | v1.9 | RFC-003 Round 1 修复后回填：新增三行（C-23 / C-24 / B3）；基线用例数 270 → 291 |
| 2026-11-18 | v1.8 | RFC-003 实现后回填：16 行 + 查询一行全部 `existing`；AC-8 / AC-16 措辞按 RFC-002 §2.3 修正；基线用例数 209 → 270 |
| 2026-11-18 | v1.7 | RFC-002 Round 3 评审同步：基线用例数 206 → 209；AC-13 行补递归扫描与接线可注入；`RFCS.md` 引用更新为 v2.16 |
| 2026-11-17 | v1.6 | RFC-002 Round 1/2 评审修复后回填：基线用例数 186 → 206；AC-13 的扫描改为递归且接线可注入；补 `tests/helpers/source-scan.ts` 一行 |
| 2026-11-17 | v1.5 | RFC-002 实现后回填：10 行全部 `existing`，文件数从计划的 10 改为实际 12（覆盖率门禁移入 `tests/meta/`）；基线用例数 87 → 186 |
| 2026-11-17 | v1.4 | RFC-001 Round 4 后同步：用例数 86 → 87，`RFCS.md` 引用由 v2.7 更新为 v2.10（C-20） |
| 2026-11-17 | v1.3 | RFC-001 Round 2 修复后回填：`contracts.test.ts` 拆成 domain / actions / events 三个文件；补 B3（`EventEnvelope` 夹具）、N1（五个严格开关）、N2（构建前清 `dist`）、N3（`EFFECT_SOURCES` / `SELF_VISIBILITY_PREFIX`）与 CR-003 一行 |
| 2026-11-17 | v1.1 | RFC-001 实现后按实际落地的测试回填：新增 T-4（自递归）、T-5（代理改用 HTTP）、T-6（路径按 RFC）、T-7（构建测试不跳过）；RFC-001 小节的实际用例数以 `RFCs/RFC-001-*.md` §8.5 为准 |
| 2026-11-17 | v1.0 | 初次生成：16 个 RFC 小节、222 条验收标准的逐条落表、126 条计划测试、6 项人工检查 |
