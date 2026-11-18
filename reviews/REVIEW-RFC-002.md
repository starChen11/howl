# RFC-002 评审 · 引擎内核：状态机、事件流、种子与效果管道

> **评审会话**：新会话（未参与 RFC-002 的实现；本会话只读仓库文件、跑命令、做临时变异探针）
> **日期**：2026-11-17
> **分支 / HEAD**：`rfc/001-project-scaffold-and-shared-contracts` / `d8a4866`
> **结论**：**Changes requested**
> **整体风险**：**Medium**

## Round 1 -- 2026-11-17

### 0. STEP 0 · 实际执行结果

环境：Node `v22.22.2`、pnpm `10.33.0`、工作树 clean（`git status --short` 无输出）。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0

$ pnpm lint
> eslint .
EXIT 0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
EXIT 0

$ pnpm test
 ✓ |unit| ... 21 个测试文件（152 tests）
 ✓ |meta| ... 7 个测试文件（34 tests）
 Test Files  28 passed (28)
      Tests  186 passed (186)
EXIT 0

$ pnpm build
vite v8.3.8 building client environment for production...
dist/client/index.html                  0.42 kB │ gzip: 0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1   # C-5 登记的临时偏离，预期如此

$ pnpm exec vitest run --project unit --coverage
 Test Files  21 passed (21)
      Tests  152 passed (152)
EXIT 0
 % Coverage report from v8
----------------|---------|----------|---------|---------|-------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|-------------------
All files       |   98.13 |    94.04 |     100 |   98.01 |
 apply.ts       |      96 |     91.3 |     100 |      96 | 81
 effects.ts     |     100 |    88.88 |     100 |     100 | 47
 errors.ts      |     100 |      100 |     100 |     100 |
 init.ts        |    90.9 |       80 |     100 |    90.9 | 52
 replay.ts      |     100 |      100 |     100 |     100 |
 rng.ts         |   96.15 |       90 |     100 |   96.15 | 73
 step.ts        |     100 |      100 |     100 |     100 |
 transitions.ts |     100 |      100 |     100 |     100 |
 win.ts         |     100 |      100 |     100 |     100 |
----------------|---------|----------|---------|---------|-------------------
```

复核：做完下面的变异探针后，工作树恢复为 clean，再跑一次 `pnpm test` 仍是 `28 files / 186 tests passed`。

**未验证项**：没有重新做干净检出后的 `pnpm install --frozen-lockfile`；本会话的结论基于现有 `node_modules`。`tests/meta/commands.test.ts` 已实际跑过 `typecheck` / `lint` / `unit` / `build` / `pnpm start`（3999 端口探活），所以构建与启动链路不是只靠阅读判断的。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-002 交付的是引擎内核，没有 UI、HTTP 路由或浏览器交互，因此：

| 适用 | 本 RFC 的检查 |
|---|---|
| 数据模型 / 跨层契约 | `GameState` / `GameEvent` / `Action` / `Effect` 的形状与序列化 |
| 核心循环 / 状态机 | `step` / `reduce` / `applyEvent` / `replay` 的推进与事件流 |
| 安全（隐藏信息） | `GAME_STARTED` 的 `server` 可见性、`Rejected` 的席位可见性 |
| 性能 | 纯函数推进的复杂度、是否有 IO / 网络 |
| 测试 | 16 条 AC、TEST-2 / TEST-3 / TEST-4 门禁 |

**显式跳过**（本 RFC 没有对应实现，跳过不是遗漏）：

| 跳过 | 理由 |
|---|---|
| 响应式 / 无障碍 / 浏览器矩阵 | 无用户可见功能；TEST-6 从 RFC-012 起生效 |
| 首屏性能 / 帧预算 | 无页面；NFR-8 归 RFC-016 |
| 平台认证 / 账号 / SEO / 离线 | PRD 已列为不适用；本 RFC 不涉及 |
| 存档 / 读档版本化 | 无中途存档；刷新恢复归 RFC-008 |
| UI 安全（XSS / CSRF） | 没有渲染与表单；输入边界在 RFC-011 / RFC-008 |

安全上有一处需要明确说明：本 RFC 的 `GAME_STARTED` 事件 payload 含全员身份，但 `visibleTo: 'server'`（`src/engine/step.ts:110-123`），并且本 RFC 没有任何把完整 `GameState` 序列化给客户端的路径。**SEC-5 的 `project()` 不归本 RFC**，由 RFC-007 在投影层消费 `visibleTo`；本评审只确认引擎侧没有提前泄露。

### 2. 16 条 AC：回退时哪个测试会红

> 这一节不只读测试名。除逻辑推导外，我做了 **19 个临时变异探针**（改一个文件 → 跑定向测试 → `git checkout` 恢复），探针结束后工作树 clean。✅ = 探针确实变红；⚠️ = 改了也不会红。

| AC | 负责的测试 | 探针 / 结论 |
|---|---|---|
| 1 `reduce === step().state` | `tests/engine/step.test.ts`（16 tests） | ✅ P1：`reduce` 直接返回 `state` → exit 1 |
| 2 `step` 纯函数、冻结不抛 | `tests/engine/step.test.ts` | ✅ P2：`step` 内改 `state.day` → exit 1（冻结用例抛错） |
| 3 JSON 往返 + 递归原型断言 | `tests/engine/serialization.test.ts`（5 tests） | ✅ P3：状态里塞 `Date` → exit 1 |
| 4 只靠事件流重建 | `tests/engine/replay.test.ts`（11）+ `replay-parity.test.ts`（4） | ⚠️ **P4**：把 `applyGameStarted` 改成忽略 `payload.roles`、按 `payload.seed` 重新发牌，replay / events / parity 全部 **exit 0**。P4b（replay 直接返回空状态）exit 1，说明测试不是完全空转，但不能区分「用 payload」和「重新发牌」 |
| 5 同 seed + 同序列逐条相等 | `tests/engine/determinism.test.ts`（4） | ✅ P5：`initialStateFromSeed` 忽略 seed → exit 1 |
| 6 seq 严格递增、type 合法 | `tests/engine/events.test.ts`（9） | ✅ P6：`seq` 不递增 → exit 1 |
| 7 首事件与 GAME_STARTED 四字段 | `tests/engine/events.test.ts` | ✅ P7：payload 的 `seed` 写错 → exit 1 |
| 8 拒绝：PHASE_MISMATCH、除 seq 外不变 | `tests/engine/reject.test.ts`（9） | ✅ P8：`REJECTED` 折叠时顺手改 `day` → exit 1 |
| 9 transitions 声明与 handler 一致 | `tests/engine/transitions.test.ts`（6） | ✅ P9：删掉 START handler、表仍声明允许 → exit 1 |
| 10 效果 order 升序 + id 字典序 | `tests/engine/effects.test.ts`（10） | ✅ P10：order 改降序 → exit 1 |
| 11 假 modifier 改变终态 | `tests/engine/effects.test.ts` | ✅ P11：`applyModifiers` 忽略 modifier → exit 1；**但只测了 `applyModifiers`，没有测 `step(..., modifiers)` 这个入口**（见 N9） |
| 12 无 modifier 时仅顺序规范化 | `tests/engine/effects.test.ts` | ✅ P12：`applyModifiers` 返回未排序列表 → exit 1 |
| 13 扫描 `src/engine/` 全部 `.ts` 无 `Math.random(` | `tests/engine/rng.test.ts`（10） | ❌ **P13**：新建 `src/engine/nested/__probe.ts` 含 `Math.random()`，测试仍 10 passed；P13b（顶层 `win.ts` 加 `Math.random`）exit 1。扫描**只扫一层**，与 AC-13 的「全部」不符 |
| 14 行 ≥ 90% / 分支 ≥ 85% | `tests/meta/coverage.test.ts`（3） | ✅ 实跑 98.01 / 94.04；门禁测试退出 0。**但「无忽略注释」扫描是硬编码的 9 个文件**（见 N12） |
| 15 `checkWin` 纯谓词、两种模式 | `tests/engine/win.test.ts`（10） | ✅ P15：`checkWin` 永远返回 `null` → exit 1 |
| 16 引擎测试零网络 | `tests/engine/no-network.test.ts`（2）+ `tests/setup/no-network.ts` | ✅ P16：移除 `setupFiles` → exit 1 |

**统计**：16 条中 14 条有“回退必红”的直接证据；**AC-4 与 AC-13 存在回退不会红的路径**。这不是说当前代码坏了——AC-4 的代码实现是正确的（`src/engine/apply.ts:78-86` 确实用 `payload.roles`），而是说“测试通过”不能推出“这条 AC 的设计意图被守住”。

### 2.1 变异探针明细

| 探针 | 改动 | 目标测试 | 结果 |
|---|---|---|---|
| P1 | `reduce` 改为 `return state` | `step.test.ts` | exit 1 |
| P2 | `step` 开头 `state.day = 99` | `step.test.ts` | exit 1 |
| P3 | `createInitialState` 往 seat 塞 `new Date()` | `serialization.test.ts` | exit 1 |
| P4 | `applyGameStarted` 忽略 `payload.roles`，用 `createInitialState(payload.seed)` 重新发牌 | `replay / events / replay-parity` | **exit 0 → 缺口** |
| P4b | `replay` 直接返回 `createEmptyState()` | `replay.test.ts` | exit 1（正向对照） |
| P5 | `initialStateFromSeed` 永远返回 `{ __rng: 0 }` | `determinism.test.ts` | exit 1 |
| P6 | `stampEvents` 的 `seq` 去掉 `+1` | `events.test.ts` | exit 1 |
| P7 | `GAME_STARTED.payload.seed` 写成 `action.seed + 1` | `events.test.ts` | exit 1 |
| P8 | `REJECTED` 分支返回 `{ ...base, day: base.day + 1 }` | `reject.test.ts` | exit 1 |
| P9 | `DEFAULT_HANDLERS` 改为 `{}` | `transitions.test.ts` | exit 1 |
| P10 | `orderEffects` 改为 `b.order - a.order` | `effects.test.ts` | exit 1 |
| P11 | `applyModifiers` 忽略全部 modifier | `effects.test.ts` | exit 1 |
| P12 | `applyModifiers` 跳过 `orderEffects` | `effects.test.ts` | exit 1 |
| P13 | 新建 `src/engine/nested/__probe.ts`：`export const noise = Math.random();` | `rng.test.ts` | **exit 0 → 缺口** |
| P13b | 顶层 `win.ts` 加 `void Math.random();` | `rng.test.ts` | exit 1（正向对照） |
| P15 | `checkWin` 开头 `return null` | `win.test.ts` | exit 1 |
| P16 | `vitest.config.ts` 移除 `setupFiles` | `no-network.test.ts` | exit 1 |
| P19 | START 只校验 `seed`，删掉 `mode` 分支 | `reject.test.ts` | **exit 0 → 缺口** |
| P22 | `GAME_STARTED` 后 `phase` 改成 `DAY_ANNOUNCE` | 全部 `tests/engine`（12 files / 96 tests） | **exit 0 → 没有断言 post-START 阶段** |

### 3. 评审维度

#### 3.1 RFC 遵循 · **NEEDS WORK**

**阻塞项**

1. **B1 · AC-13 的扫描不是递归的**（`tests/engine/rng.test.ts:17-24`）

   AC-13 要求「扫描 `src/engine/` 全部 `.ts`，断言不出现 `Math.random(`」。实现只 `readdirSync(ENGINE_DIR)` 后过滤 `entry.isFile()`，子目录被完全跳过。P13 在 `src/engine/nested/__probe.ts` 放 `Math.random()`，`rng.test.ts` 仍全绿。

   这不是理论风险：RFC-003 §3 的第一批交付物就是 `src/engine/phases/night.ts` 与 `src/engine/resolve/deaths.ts`，它们正好落在子目录里；RFC-002 是地基，等 RFC-003 的文件出现时，DATA-5 的自动化保护会静默失效。

   **建议**：改成递归遍历（`readdirSync(dir, { recursive: true })` 或手写 walk），只收 `.ts`；把「扫描确实读到文件」的反空转断言从 `> 5` 改成「包含已知文件且能发现一个嵌套的探针文件」。同时把 `tests/meta/coverage.test.ts:45-55` 的忽略注释扫描从硬编码 9 个文件改为同一套递归遍历（见 N12）。

2. **B2 · AC-4 / §2.2 的「`GAME_STARTED.roles` 是唯一权威」没有被测试锁住**（`src/engine/apply.ts:78-86`、`RFCs/RFC-002-engine-core-state-events-seed-effects.md:60-62`）

   RFC §2.2 明确要求：一旦 `GAME_STARTED` 事件存在，**事件里的 `roles` 是唯一权威**；`applyEvent` 以它为准，不再自行发牌。理由是要让旧对局在发牌算法改动后仍可重放。

   当前代码是对的，但测试全部基于「用本仓库发牌算法产出的正常事件流」。P4 把 `applyGameStarted` 改成按 `payload.seed` 重新发牌，`replay.test.ts`（11）、`events.test.ts`（9）、`replay-parity.test.ts`（4）**全部通过**——因为正常流里两种做法结果相同。也就是说，一个会破坏旧对局重放的实现，在今天不会让任何测试变红。

   **建议**：在 `replay.test.ts` 增加一条合成事件流测试：构造一个合法的 `GAME_STARTED`，把 `payload.roles` 中两个座位对调（不改变数量/类型），断言 `replay([event]).seats` 的身份与 payload 一致，而不是与 `createInitialState(event.payload.seed)` 的发牌一致；同时断言 `personas` 与 `playerSeat` 也从 payload 重建。这类测试不需要改发牌算法，就能证明「事件是权威」。

**非阻塞的 RFC 偏差 / 未记录决定**

3. **`nextInt` 的签名与 §2.5 不同**：RFC 写 `nextInt(state, max) => { state: GameState; value }`（RFC §2.5，原文第 134 行），实现是 `nextInt(rng: RngState, maxExclusive)`（`src/engine/rng.ts:46-53`）。实现更合理（生成器状态不是一个完整对局），但这是 §8.2 没有记录的决定；建议在 §8.2 记一条，或把 §2.5 的签名改成 `RngState`。
4. **`GAME_STARTED` 后的 `phase` / `day` 没有记录也没有断言**：`applyGameStarted` 把状态设为 `phase: 'NIGHT_WOLF_CHAT'`、`day: 1`（`src/engine/apply.ts:88-96`）。RFC-002 §2.2 只规定了 payload，没有规定这两个字段的来源；RFC-003 §2.2 的阶段图以 `NIGHT_WOLF_CHAT` 开头，所以这个选择是合理的，但 §8.2 的 D-1~D-14 没有它。P22 把它改成 `DAY_ANNOUNCE`，全部引擎测试仍绿。建议在 §8.2 记一条，并在 `events.test.ts` / `replay.test.ts` 断言 `phase === 'NIGHT_WOLF_CHAT'`、`day === 1`；这是 RFC-003 开工会直接依赖的交接点。
5. **额外导出没有在 §3 / §8.2 说明**：`createEmptyState`（`src/engine/init.ts:78-89`）、`orderEffects`（`src/engine/effects.ts:44-49`）、`RANDOM_CONSUMING_EVENTS`（`src/engine/apply.ts:21-23`）、`WinCondition` / `WinResult`（`src/engine/win.ts:15-21`）都不在 §3 交付物表。它们各有用途（`createEmptyState` 是 `replay` 的起点，`orderEffects` 被测试用来做顺序对照），不是问题代码，但按 DOC-1 应记录为「实现新增的导出」。
6. **`WinCondition` 的文案与 §2.7 的示例不同**：RFC 举例 `'all-seers-and-witches-and-hunters-dead'`，实现用 `'all-gods-dead'` / `'all-villagers-dead'` / `'all-good-dead'` / `'all-wolves-dead'`（`src/engine/win.ts:15-16`）。§2.7 用的是「如」，实现是合法的可读描述；但 RFC-014 会在复盘里消费 `GAME_ENDED.condition`，建议在 RFC-014 开工前把「condition 是封闭枚举」写成显式契约，避免它按示例字符串匹配。
7. **D-12 的 `mode` 分支没有测试**：`startHandler` 同时校验 `seed`、`mode`、`playerSeat`（`src/engine/step.ts:80-106`），但 `reject.test.ts:73-106` 只覆盖了 seed 与 playerSeat。P19 删掉 `mode` 校验后 `reject.test.ts` 仍 9 passed。D-12 是记录在 §8.2 的行为，建议补一条 `mode` 不一致的拒绝用例（或删掉 `mode` 校验并改 D-12，二选一，不要留一个没有测试的承诺）。
8. **§2.4 的 modifier 注册表没有写进 `GAME_STARTED`**：见 `RFCS.md` 新增的 **C-21**。v1 不注册任何 modifier，当前没有可观察影响；但 §2.4 说「注册表随 run 配置写入 `GAME_STARTED`」，而 §2.2 的 payload 没有这个字段，实现也没有记录。引入第一个 modifier 前必须由 `/manage-changes` 决定：把可序列化的 modifier id / 配置写进 `GAME_STARTED`，或明确扩展效果不参与 replay。**非阻塞本 RFC，但不要把它留成「代码里有个 `modifiers` 参数就算实现」**。

**已记录的偏离（D-1 ~ D-14）**：D-1（`GameEvent` 收窄）、D-2（`step` 自己折叠）、D-3（信封盖章）、D-4（appliers 注入）、D-5（`createEngine` 工厂）、D-6（5 个错误类型）、D-7（`deck` 可选参）、D-8（覆盖率门禁放 meta）、D-9（`ACTION_TYPES` 与 payload schemas）、D-10（no-network setup）、D-11（`rngAfter`）、D-13（gameId 校验）、D-14（LOBBY `day === 0`）的理由都成立，且对应测试大多存在。D-9 的 payload schemas 目前是**未被任何代码或测试使用**的导出（见 N3）；D-12 / D-14 的测试缺口见 3.5 的 N5 / N8。

#### 3.2 RULES 遵循 · **NEEDS WORK**

| 规则 | 结论 | 证据 / 备注 |
|---|---|---|
| ARCH-1（engine 不 import UI/网络/DOM） | PASS | `tests/dependency-direction.test.ts` 5 passed；引擎只 import `@shared/*` 与引擎内部模块 |
| ARCH-2（shared 只放类型与纯常量） | PASS（按 C-13 的既有例外） | `schemas.ts` 的 Zod 与 `ACTION_TYPES` 是 C-13 已登记的例外；本 RFC 没有新增第二种运行时依赖 |
| ARCH-3（状态纯数据） | PASS | `serialization.test.ts` 的 JSON 往返 + 递归原型断言；P3 会红 |
| ARCH-4（纯函数状态转移） | PASS | `step.test.ts` 的冻结/两次调用用例；P1/P2 会红。`reduce` 是 `step().state` 的包装，RFC §2.1 已解释 |
| ARCH-5（先效果列表再统一应用） | PASS | `applyEffects` 只按 `orderEffects` 顺序应用；没有在分支里直接改状态的结算代码 |
| ARCH-6（效果带 source） | PASS | `src/shared/effects.ts:33-45`；测试构造的 Effect 都带 `source` |
| ARCH-11（未裁决/未实现必须抛） | PASS | 未知事件 → `UnknownEventError`；允许但无 handler → `UnhandledTransitionError`；`replay.test.ts` / `transitions.test.ts` 各有负向用例 |
| DATA-1（seq + 数字 ts） | PASS | `stampEvents` 统一盖章；P6/P7 会红 |
| DATA-2（事件类型是联合成员） | PASS | `GameEvent` / `GAME_EVENT_TYPES` 在 RFC-001 已锁；本 RFC 的 handler 只产出 `GAME_STARTED` / `REJECTED` |
| DATA-3（replay === state） | PASS（按当前事件类型） | `replay.test.ts` / `replay-parity.test.ts`；但 §2.2 的 authority 见 B2 |
| DATA-4（可注入 PRNG、种子在状态） | PASS | `state.seed` / `state.rng`；`rng.test.ts` 的确定性用例 |
| DATA-5（禁止 `Math.random()`） | **NEEDS WORK** | 顶层扫描有效（P13b 红），但递归缺口见 B1；RFC-003 的子目录会逃逸 |
| TEST-2（覆盖率 ≥ 90 / 85、无忽略注释） | PASS / 有未来缺口 | 实跑 98.01 / 94.04；「无忽略注释」只扫硬编码 9 个文件，见 N12 |
| TEST-3（确定性测试） | PASS | `determinism.test.ts`：同 seed + 同序列两次运行事件流逐条相等 |
| TEST-4（引擎测试不联网） | PASS | `tests/setup/no-network.ts` + `no-network.test.ts`；P16 会红 |
| TEST-5（提交前四命令） | PASS | 本次实跑 typecheck / lint / test / build / format / e2e 均符合预期 |
| DOC-1（偏离写进 Implementation Notes） | **NEEDS WORK** | `nextInt` 签名、post-START `phase`/`day`、额外导出、D-9 的 schema 未测都没有在 §8.2 / §8.3 说明；C-21 已登记到 RFCS |
| DOC-2（新依赖登记） | PASS | `@vitest/coverage-v8@5.1.0` 已在 `RULES.md` §2 与 `package.json` 一致 |

结论：运行时规则基本都守住了，问题集中在**自动化保护的范围**（DATA-5 / TEST-2 / DOC-1），不是代码违反了架构。

#### 3.3 安全 · **PASS（当前表面）**

- **隐藏信息**：`GAME_STARTED` 含全员 `roles`，但 `visibleTo: 'server'`（`src/engine/step.ts:110-115`），`events.test.ts:88-90` 断言；`REJECTED` 对带席位 action 用 `self:<seat>`（`src/engine/step.ts:136-153`、`reject.test.ts:66-71`）。本 RFC 没有把完整状态序列化给客户端的路径；`project()` 的 SEC-5 验收在 RFC-007，不能因为这里没有投影就宣称 SEC-5 已完成。
- **输入验证**：引擎信任类型化的 `Action`；HTTP 边界由 `ActionSchema`（RFC-001）负责，本 RFC 没有新增网络入口。`replay` 接收的是已定型的 `GameEvent`，从 JSON 恢复时的 envelope + payload 校验明确留给 RFC-008（§8.6），不构成本 RFC 的泄露。
- **密钥 / 日志 / 错误**：引擎没有网络、没有密钥、没有日志。`START_STATE_MISMATCH` 的消息含 `state.seed` / `state.mode`（`src/engine/step.ts:88, 102`），二者都不是秘密（seed 本来就会进 `GAME_STARTED`，mode 是公开配置），且该拒绝发生在 LOBBY、可见性 `public`。
- **数据完整性**：`applyEvent` 校验 seq、gameId、`rngAfter`、未知类型（`src/engine/apply.ts:25-57`），`replay.test.ts` 对每种损坏都有负向用例。一个低风险边缘：`createEmptyState()` 用 `gameId: ''` 当哨兵（`src/engine/init.ts:79-88`），若首个 `GAME_STARTED` 的 `gameId` 也是空串，gameId 混流检查会被跳过（`src/engine/apply.ts:38-42`）。`EventSchema` 要求 `gameId` 非空，RFC-008 会校验；当前不阻塞，但建议在 RFC-008 的 Zod 入口把「首个事件 gameId 非空」也断言掉。
- **注入 / XSS / CSRF**：无 UI、无 HTML、无 SQL；N/A。

#### 3.4 性能 · **PASS**

- `step` / `applyEvent` / `replay` 都是纯函数、单线程、无 IO；`applyEvent` 每次浅拷贝状态 + 9 个 seat，复杂度 O(事件数 × 状态大小)，本 RFC 的状态很小。
- `orderEffects` 是 O(k log k)，`checkWin` 是 O(9)，`shuffle` 是 O(9)，没有 N+1 或重复发牌。
- 没有需要缓存的远程调用；`rng` 的状态进/状态出避免了隐藏的全局状态。
- `tests/meta/coverage.test.ts` 起子进程跑 coverage 是测试期行为，不影响引擎运行时。**没有发现需要在本 RFC 处理性能问题的地方。**

#### 3.5 可维护性 · **NEEDS WORK**

**做得好的地方**

- `step` 自己折叠事件（D-2）把「派生字段只由 `applyEvent` 写」变成结构性事实，而不是靠注释；这是本 RFC 最好的设计决定。
- handler 只产出事件草稿、信封统一盖章（D-3），`seq` / `ts` 不可能被某个 handler 写错。
- 错误类型按 `name` 断言，不靠消息文本；`UnknownEffectError` / `UnhandledTransitionError` 让「没实现」不会静默变成「什么都没发生」。
- 测试分层清楚：`unit`（纯函数）与 `meta`（起子进程的门禁）分开；`no-network` setup 让引擎测试真的不能联网。
- 注释解释了「为什么」而不是复述代码；`init.ts` / `apply.ts` / `step.ts` 的关键取舍都写清了。

**问题**

- **N1 · `replay-parity.test.ts:66-74` 的「分两段重放」测试是空转**。测试体是 `replay([...events.slice(0, half), ...events.slice(half)])`——把两段拼回同一个完整数组，和 `replay(events)` 完全等价。它永远不会因为「分段重放坏了」而红。要么真的做分段（`applyEvent` 逐段折叠，或 `replay(前半)` 后把后半逐条 `applyEvent`），要么删掉并改掉测试名。**这条不是 AC-4 的必需项**（AC-4 只要求整条流可重放），但现在的写法给了假信心。
- **N2 · `ACTION_TYPES` 没有双向类型断言**（`src/shared/actions.ts:16-27`）。`satisfies readonly Action['type'][]` 只保证「数组里没有假类型」，不保证「`Action` 的每个成员都在数组里」。将来给 `Action` 加一个 variant 却忘加 `ACTION_TYPES`，`ActionSchema` 会静默拒绝该 action，而现有测试只遍历当前 10 个动作，不会红。RFC-001 对 `GAME_EVENT_TYPES` / `keyof GameEventMap` 做了 `toEqualTypeOf` 双向锁定（C-15），这里应同样处理：
  `expectTypeOf<Action['type']>().toEqualTypeOf<(typeof ACTION_TYPES)[number]>()`（或等价的 `Exclude` 空集断言）。
- **N3 · D-9 新增的 `GameStartedPayloadSchema` / `RejectedPayloadSchema` / `PAYLOAD_SCHEMAS` 没有任何使用或测试**（`src/shared/schemas.ts:144-162`）。它们按 C-10 属于 RFC-002 的 payload 所有权，但现在既没有被 `replay` 调用，也没有 `safeParse` 夹具。要么在本 RFC 补两三条 schema 测试（合法 payload 通过、少字段/错 mode/错 seat 被拒），要么把它们明确记成「RFC-008 的入站校验会消费」并接受本 RFC 不测。**不要让它们成为未测表面。**
- **N4 · `nextInt` 的签名偏差没有记录**：见 3.1 第 3 条。
- **N5 · post-START `phase` / `day` 与 LOBBY 的 `day === 0` 没有记录/断言**：见 3.1 第 4 条；P22 证明把 post-START 改成 `DAY_ANNOUNCE` 也全绿，RFC-003 的开工依赖这个交接点；D-14 的 LOBBY `day: 0` 也没有直接断言。
- **N6 · 额外导出没有在 §3 或 §8.2 说明**（`createEmptyState`、`orderEffects`、`RANDOM_CONSUMING_EVENTS`、`WinCondition` / `WinResult`）：代码本身合理，但 DOC-1 要求记录。
- **N7 · `WinCondition` 的封闭枚举没有写成契约**：见 3.1 第 6 条；RFC-014 会消费 `GAME_ENDED.condition`，不要让下游按 §2.7 的示例字符串匹配。
- **N8 · D-12 的 `mode` 分支没有测试**：见 3.1 第 7 条；P19 删掉 `mode` 校验后 `reject.test.ts` 仍 9 passed。
- **N9 · `step(..., modifiers)` 入口没有被测**：§2.4 说 `step(state, action, modifiers?)` 是 `applyModifiers` 的入口，但 `step` 只是把 `modifiers` 放进 `HandlerContext`（`src/engine/step.ts:38-41, 233-236`），当前唯一的 handler 不读它；`effects.test.ts:90-137` 全部直接调用 `applyModifiers`。RFC-002 没有 modifier，所以这不是行为缺陷；但 RFC-003/004 第一次写结算时，若忘记把 `context.modifiers` 传给 `applyModifiers`，现有测试不会红。建议在 `step` 的测试里加一条「用 `createEngine` 注入一个会记录 point 的 modifier，走一次真实 handler，断言它被调用」——或者等 RFC-003 的第一个结算点再补，但要在 RFC-003 的测试计划里写明。
- **N10 · `serialization.test.ts:56-64` 的「继续推进」只断言了 `seq`**，没有把 `step(roundTrip(state), action)` 与 `step(state, action)` 的结果整体比较。F2 的 AC-2 要求「反序列化后继续推进的结果与不序列化一致」；本 RFC 的 §6 把 F2 的终局留给 RFC-004，但既然这里已经有 `startedState` + 一个拒绝路径，整体比较的成本很低，能更直接地守住「JSON 往返不改变行为」。
- **N11 · 多事件 `seq` 没有测试**：`stampEvents` 用 `state.seq + index + 1`（`src/engine/step.ts:162-176`），当前每个 action 只产出一个事件，所以 AC-6 的用例只覆盖 1/2/3 的单事件序列。RFC-003 的夜间结算会一次产出多个事件；建议现在就用一个假 handler 产出 3 个草稿，断言 seq 连续、无跳号，避免多事件路径成为未测表面。
- **N12 · `tests/meta/coverage.test.ts:45-55` 的忽略注释扫描是硬编码 9 个文件**。`TEST-2` 要求「不得用忽略注释排除未测分支」，但 RFC-003 往 `src/engine/phases/` / `src/engine/resolve/` 加文件后，这条扫描不会看它们。与 B1 用同一套递归遍历即可。
- **N13 · `RANDOM_CONSUMING_EVENTS` 是手写集合**（`src/engine/apply.ts:21-23`）：RFC-003 的 `DAY_STARTED`（随机发言起点）等事件需要手动加进去，漏加时 `applyEvent` 不会抛 `MissingRngStateError`，而是静默保留旧 rng。建议在 RFC-003/004 的事件测试里为每个消耗随机数的事件断言「缺 `rngAfter` 必须抛」，或者把「是否消耗随机数」变成事件构造的显式参数（类型层更贵，可在后续 RFC 评估）。
- **N14 · `Object.freeze` 只冻结了顶层**（`tests/engine/step.test.ts:61-68`）。当前 `step` 不碰嵌套 seat，所以测试能抓住顶层变异；但如果将来有人在 `applyEvent` 里原地改 `state.seats[i].alive`，冻结测试不会抛错，只能靠 `expect(frozen).toEqual(state)` 的失败来发现（这条仍然会红，但错误信息会指向「状态变了」，不是「你改了入参」）。可以改成深冻结（递归 `Object.freeze`）或在 `applyEvent` 的测试里显式检查。**优先级低。**

### 4. RFC §8.6 作者列出的已知缺口：逐条判断

| §8.6 缺口 | 判断 | 理由 |
|---|---|---|
| 12 个阶段的 transitions / handler | **接受** | RFC-002 §6 明确只填 `LOBBY` / `FINISHED`；`transitions.test.ts` 还断言了「只有 LOBBY 非空」，后续 RFC 加阶段时会主动更新测试，不会静默放行 |
| 15 个事件的 `applyEvent` 折叠 | **接受** | 未实现的事件抛 `UnknownEventError`（`replay.test.ts:139-153`），不静默丢状态；GAME_STARTED / REJECTED 之外的 payload 归后续 RFC |
| 效果 applier 表是空的 | **接受** | RFC-002 不定义 `Effect.type`；空表 + 抛 `UnknownEffectError` 是比「假装结算」更安全的选择 |
| `isVisibleTo` 行为矩阵 | **接受，但排期要早** | 按 RFC-001 / RFC-005 的划分；这是 F13 / SEC-5 的前置，建议 RFC-005 的第一个提交就补矩阵，不要拖到 RFC-007 集成 |
| 从 JSON 恢复时的事件校验 | **接受** | 明确归 RFC-008；但注意 `createEmptyState` 的空 `gameId` 会让 D-13 的空状态哨兵在「首个事件 gameId 为空」时失效（3.3 的边缘项），RFC-008 的 Zod 入口应一起补 |
| 多套板子（F45） | **接受** | `deck` 可选参是缝，不实现功能；D-7 记录了理由 |
| 覆盖率只覆盖 `src/engine/` | **接受** | TEST-2 的范围就是 `src/engine/`；`shared` / `server` / `client` 的覆盖率不在本 RFC |

### 5. 总体结论

#### 5.1 风险与摘要

**Overall Risk: Medium。** 引擎内核的代码质量高：纯函数边界清楚，`step` 自折叠使 `reduce` 与「派生字段只由 `applyEvent` 写」成为结构性事实，事件信封与错误类型也设计得克制。四条门禁（typecheck / lint / test 186 / build）与覆盖率门禁（98.01% / 94.04%）实跑全绿，C-18 的 replay 一致性验收也有真实覆盖。

问题不在「代码跑不起来」，而在**两处最该被保护的未来契约没有测试锁住**：一是 DATA-5 的 `Math.random` 扫描只扫顶层，而 RFC-003 马上要加子目录文件；二是 §2.2 的「`GAME_STARTED.roles` 是唯一权威」在正常事件流下无法与「重新发牌」区分，P4 证明一个会破坏旧对局重放的实现今天也能全绿。加上 `mode` 分支、post-START 阶段、payload schema、`ACTION_TYPES` 等未测/未记录的小口子，这个地基 RFC 值得在合并前补齐。

#### 5.2 阻塞项（合并前必须处理）

1. **B1 · 把 `src/engine/` 的源码扫描改成递归**（AC-13 / DATA-5 / TEST-2）
   - 修 `tests/engine/rng.test.ts` 的 `engineSources()`：遍历子目录，收集所有 `.ts`；反空转断言改成「能发现一个已知的嵌套探针文件」或至少包含 `phases/` / `resolve/`。
   - 同一提交把 `tests/meta/coverage.test.ts` 的忽略注释扫描改成递归（或与 `rng.test.ts` 共用一个 helper）。
   - 加一个临时/固定夹具证明嵌套文件会被扫到（例如在测试里动态创建临时目录，或把 `tests/engine/fixtures/engine-scan.ts` 放进 `src/engine` 的测试专用子目录——选一种不污染生产源码的方式）。
   - 复跑：P13 应变成 exit 1，P13b 仍 exit 1。

2. **B2 · 用合成事件锁住 `GAME_STARTED.roles` 的事件权威**（AC-4 / §2.2）
   - 在 `tests/engine/replay.test.ts` 增加：构造一个合法的 `GAME_STARTED`（或复用 `step` 产生的事件后改写 `payload.roles` 的两项），断言 `replay` 的 `seats[].role` 等于事件 payload，而不是 `createInitialState(payload.seed)` 的发牌结果。
   - 同时断言 `personas` 与 `playerSeat` 从 payload 重建；`replay` 后 `state.seed` / `state.mode` 也等于 payload。
   - 复跑：把 `applyGameStarted` 改成 P4 的「重新发牌」版本，这条测试必须变红（这是验证修复本身的标准，不只跑绿）。

#### 5.3 非阻塞改进（建议同批或随后处理）

- **N1**：`replay-parity.test.ts:66-74` 的「分两段重放」要么真的分段，要么删掉/改名；现在的测试体是同一数组的拼接。
- **N2**：`ACTION_TYPES` 加 `expectTypeOf<Action['type']>()` 与 `(typeof ACTION_TYPES)[number]` 的双向断言，仿照 RFC-001 的 `GAME_EVENT_TYPES`。
- **N3**：给 `GameStartedPayloadSchema` / `RejectedPayloadSchema` 补最小 `safeParse` 夹具，或明确登记为 RFC-008 的入站校验表面。
- **N4**：在 §8.2 记录 `nextInt(RngState)`，或把 §2.5 的签名改成 `RngState`。
- **N5**：在 §8.2 记录 post-START 的 `phase` / `day`，并在 `events.test.ts` / `replay.test.ts` 断言 `phase === 'NIGHT_WOLF_CHAT'`、`day === 1`。
- **N6**：在 §8.3 或 §8.2 记录 `createEmptyState` / `orderEffects` / `RANDOM_CONSUMING_EVENTS` / `WinCondition` 这些额外导出。
- **N7**：把 `WinCondition` 的封闭枚举写成显式契约（RFC-014 会消费 `GAME_ENDED.condition`），或在 §2.7 说明示例文案不是精确匹配。
- **N8**：补 D-12 的 `mode` 不一致拒绝用例（P19 当前是绿的）。
- **N9**：在 `step` 的测试里加一条「注入 modifier 并通过真实 handler 走一次」；若决定留给 RFC-003，写进 RFC-003 的测试计划。
- **N10**：`serialization.test.ts` 的整体推进比较（不只 `seq`）。
- **N11**：多事件 `seq` 测试（假 handler 产出 3 个草稿）。
- **N12**：`tests/meta/coverage.test.ts` 的硬编码文件列表与 B1 一起改成递归。
- **N13**：把 `RANDOM_CONSUMING_EVENTS` 的扩展纪律写进 RFC-003/004 的测试计划，或改成显式的 `rngAfter` 要求。
- **N14**：深冻结 / 更明确的纯函数夹具（优先级低）。
- **文档同步**：`README.md` / `RFCS.md` 的状态已由本评审更新；修复后请同步 RFC-002 §8.4 的「AC-13 扫描全部 `.ts`」与 §8.5 的验证数字，避免下一轮出现「文档说全部、测试只扫一层」的不实陈述。

### 6. 没有发现问题的部分（避免只列负面）

- `step` 自折叠（D-2）是正确且优雅的：`reduce === step().state` 不是两条路径对齐，而是构造保证；这让 C-18 的「派生字段只由 `applyEvent` 写」以后很难被绕过。
- 事件信封统一盖章（D-3）把 `seq` / `ts` 从 handler 手里拿走，AC-6 的严格递增因此几乎不可能被写错。
- `GameStartedPayload` 的「事件即权威」代码实现正确（`src/engine/apply.ts:78-86`）；问题只是测试没有锁住它——这是容易修的。
- `applyEffects` / `applyModifiers` 的顺序规范化、空表抛错、modifier 依次折叠都与 ARCH-5 / ARCH-6 / F7 的意图一致。
- `checkWin` 的优先级（狼全灭先判好人胜）与 RUL-1 / RUL-5 的解释一致；`all-gods-dead` / `all-villagers-dead` / `all-good-dead` / `all-wolves-dead` 是可读的封闭枚举。
- `replay` 对空流、首事件、seq 跳号、`rngAfter` 缺失、未知事件、gameId 混流、roles/personas 长度都有负向用例，错误信息对开发者友好。
- 测试没有联网、没有读真实时钟；`tests/meta/` 的慢门禁与 `unit` 分开，`pnpm test` 16 秒内跑完 186 个用例。

### 7. 评审结论

**Changes requested。** 引擎内核的实现本身可用，D-1 ~ D-14 的偏离理由基本成立；但 AC-13 的递归扫描与 AC-4 的事件权威测试是两条会直接影响 RFC-003 起后续 RFC 的缺口，必须在合并前补。修完后建议在新会话重跑本评审，重点复跑 P4（重新发牌必须红）、P13（嵌套 `Math.random` 必须红）、P19（`mode` 分支必须红）与全量 186 用例。

---

**评审证据**：本文件中的命令输出来自 2026-11-17 的本会话实跑；变异探针均在 `git checkout` 后恢复，最终 `git status --short` 为空，复跑 `pnpm test` 为 `28 files / 186 tests passed`。

---

## Round 2 -- 2026-11-17

> **评审会话**：新会话（未参与 RFC-002 的实现与 Round 1 修复；本会话只读仓库文件、跑命令、做临时变异探针）。
> **基线**：分支 `rfc/001-project-scaffold-and-shared-contracts` / HEAD `217412d`；评审开始时 `git status --short` 为空，所有变异探针恢复后也为空（随后只改了本评审文件与状态文档）。
> **结论**：**Changes requested**
> **整体风险**：**Medium**

### 0. STEP 0 · 实际执行结果

环境：Node `v22.22.2`、pnpm `10.33.0`。以下均为本会话在 macOS 上的实跑输出，不是转述。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0

$ pnpm lint
> eslint .
EXIT 0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT 0

$ pnpm test
 ✓ |unit| tests/helpers/source-scan.test.ts (7 tests)
 ✓ |unit| tests/engine/effects.test.ts (10 tests)
 ✓ |unit| tests/engine/win.test.ts (10 tests)
 ✓ |unit| tests/shared/actions.test.ts (8 tests)
 ✓ |unit| tests/shared/events.test.ts (13 tests)
 ✓ |unit| tests/engine/events.test.ts (14 tests)
 ✓ |unit| tests/server/health.test.ts (3 tests)
 ✓ |unit| tests/engine/step.test.ts (18 tests)
 ✓ |unit| tests/engine/replay.test.ts (14 tests)
 ✓ |unit| tests/engine/determinism.test.ts (4 tests)
 ✓ |unit| tests/shared/terms.test.ts (6 tests)
 ✓ |unit| tests/engine/rng.test.ts (11 tests)
 ✓ |unit| tests/engine/serialization.test.ts (5 tests)
 ✓ |unit| tests/engine/replay-parity.test.ts (4 tests)
 ✓ |unit| tests/helpers/import-scan.test.ts (6 tests)
 ✓ |unit| tests/engine/reject.test.ts (10 tests)
 ✓ |unit| tests/engine/transitions.test.ts (6 tests)
 ✓ |unit| tests/shared/effects.test.ts (7 tests)
 ✓ |unit| tests/security/no-hardcoded-terms.test.ts (2 tests)
 ✓ |unit| tests/dependency-direction.test.ts (5 tests)
 ✓ |unit| tests/engine/no-network.test.ts (2 tests)
 ✓ |unit| tests/shared/domain.test.ts (7 tests)
 ✓ |meta| tests/meta/commands.test.ts (5 tests) 7027ms
 ✓ |meta| tests/meta/tsconfig.test.ts (15 tests) 2341ms
 ✓ |meta| tests/meta/lint.test.ts (5 tests) 1942ms
 ✓ |meta| tests/meta/dev-proxy.test.ts (1 test) 1801ms
 ✓ |meta| tests/meta/coverage.test.ts (3 tests) 1036ms
 ✓ |meta| tests/meta/build.test.ts (4 tests) 492ms
 ✓ |meta| tests/meta/selfplay-placeholder.test.ts (1 test) 334ms

 Test Files  29 passed (29)
      Tests  206 passed (206)
EXIT 0

$ pnpm build
vite v8.3.8 building client environment for production...
dist/client/index.html                  0.42 kB │ gzip: 0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
EXIT 0

$ pnpm exec vitest run --project unit --coverage
 Test Files  22 passed (22)
      Tests  172 passed (172)
EXIT 0
----------------|---------|----------|---------|---------|
File            | % Stmts | % Branch | % Funcs | % Lines |
----------------|---------|----------|---------|---------|
All files       |   98.13 |    95.23 |     100 |   98.01 |
 apply.ts       |      96 |    95.65 |     100 |      96 |
 effects.ts     |     100 |    88.88 |     100 |     100 |
 errors.ts      |     100 |      100 |     100 |     100 |
 init.ts        |    90.9 |       80 |     100 |    90.9 |
 replay.ts      |     100 |      100 |     100 |     100 |
 rng.ts         |   96.15 |       90 |     100 |      96 |
 step.ts        |     100 |      100 |     100 |     100 |
 transitions.ts |     100 |      100 |     100 |     100 |
 win.ts         |     100 |      100 |     100 |     100 |
----------------|---------|----------|---------|---------|

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1   # C-5 登记的临时偏离，预期如此
```

探针全部恢复后复跑：`pnpm typecheck` → 0，`pnpm test` → `29 files / 206 tests passed`，`git status --short` 为空。

**未验证项（不隐藏）**：

- **Windows 实跑**：本会话没有 Windows 主机，没有真的在 Windows 上跑 `pnpm test`。下文 B-R2-1 的结论来自 Node `path.win32.relative` 的确定行为 + `AGENTS.md` 的跨平台硬要求，不是 Windows 实跑输出；如果团队只支持 macOS，这一条可以降级，但仓库当前写的是两平台都必须跑通。
- **干净检出后的 `pnpm install --frozen-lockfile`** 没有重跑；结论基于现有 `node_modules`。
- `pnpm test:e2e` 仍是 skipped（`tests/e2e/` 无用例），`pnpm selfplay` 仍按 RFC-015 的占位约定退出 1；两者都不属于 RFC-002 的验收面。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 仍是 **game（主）+ web app（交付形态）**。RFC-002 只交付引擎内核，没有 UI、HTTP 路由或浏览器交互，因此本轮继续只检查：

| 适用 | 本 RFC 的检查 |
|---|---|
| 数据模型 / 跨层契约 | `GameState` / `GameEvent` / `Action` / `Effect` 的形状与序列化 |
| 核心循环 / 状态机 | `step` / `reduce` / `applyEvent` / `replay` 的推进与事件流 |
| 安全（隐藏信息） | `GAME_STARTED` 的 `server` 可见性、`Rejected` 的席位可见性 |
| 性能 | 纯函数推进的复杂度、是否有 IO / 网络 |
| 测试 | 16 条 AC、TEST-2 / TEST-3 / TEST-4 门禁、Round 1 的 P4 / P13 / P19 |

**显式跳过**（与 Round 1 相同，不是遗漏）：响应式 / 无障碍 / 浏览器矩阵（无用户可见功能，TEST-6 从 RFC-012 起生效）、首屏性能（NFR-8 归 RFC-016）、平台认证 / 账号 / SEO / 离线（PRD 已列为不适用）、存档 / 读档版本化（RFC-008）、UI 安全（无渲染与表单，输入边界在 RFC-011 / RFC-008）。

### 2. Round 1 两条阻塞项的复核

#### B1 · AC-13 / DATA-5 的递归扫描

**结论：运行时已修好。** `tests/helpers/source-scan.ts` 现在递归遍历子目录、只收 `.ts`，并跳过隐藏目录与 `node_modules`；`tests/engine/rng.test.ts` 与 `tests/meta/coverage.test.ts` 都改用它。`tests/helpers/source-scan.test.ts` 用临时目录直接证明了 helper 的递归能力（不往 `src/` 塞夹具）。

本轮重做 P13（新建 `src/engine/nested/__probe.ts`，内容 `export const noise = Math.random();`）：

```
$ pnpm exec vitest run tests/engine/rng.test.ts --project unit
 × 递归扫描 src/engine 的**全部** .ts，没有任何违规调用
 FAIL  |unit| tests/engine/rng.test.ts > AC-13 · 引擎不得使用 Math.random > 递归扫描 src/engine 的**全部** .ts，没有任何违规调用
AssertionError: expected [ 'nested/__probe.ts' ] to deeply equal []
      Tests  1 failed | 10 passed (11)
```

**但永久锁没有完全闭合**：`tests/engine/rng.test.ts:48-55` 的第三个测试（“扫描器是递归的”）只断言返回值是数组、每项有 `relativePath` 字符串，**不检查递归**。我做了反向元探针：把 `engineSources()` 换回一层 `readdirSync`，同时保留 `nested/__probe.ts` 里的 `Math.random()`，再跑 `rng.test.ts`：

```
$ pnpm exec vitest run tests/engine/rng.test.ts --project unit
 ✓ |unit| tests/engine/rng.test.ts (11 tests)
      Tests  11 passed (11)
```

也就是说，B1 所描述的那个回退（只扫一层）在今天的**永久测试套件**里仍然可以全绿；P13 之所以会红，只是因为当前 `engineSources()` 恰好调用了递归 helper。helper 自己的递归测试（`source-scan.test.ts`）不会因为 `rng.test.ts` 的 wiring 退化而红。这条是本轮的新阻塞项 **B-R2-2**，详见 3.3。

#### B2 · AC-4 / §2.2 的“事件是唯一权威”

**结论：已修好。** `tests/engine/replay.test.ts` 新增三个合成事件用例：

1. 互换两个异身份席位的 `payload.roles`，断言 `replay` 采用 payload；
2. 改 `seed` / `mode` / `personas`，断言三者从 payload 重建；
3. 改 `playerSeat`，断言只有一个席位被标成玩家。

本轮重做 P4（把 `applyGameStarted` 改成忽略 `payload.roles`、按 `payload.seed` 用 `createInitialState` 重新发牌）：

```
$ pnpm exec vitest run tests/engine/replay.test.ts --project unit
 FAIL  |unit| tests/engine/replay.test.ts > AC-4 · replay 只靠事件流重建状态 > 采用 payload.roles 的发牌结果，而不是按 seed 重新发牌
 FAIL  |unit| tests/engine/replay.test.ts > AC-4 · replay 只靠事件流重建状态 > seed / mode / playerSeat / personas 也从 payload 重建
      Tests  2 failed | 12 passed (14)
```

P4b（Round 1 的正向对照：`replay` 直接返回空状态）仍不需要重跑——合成事件用例已经证明它不是空转。

### 3. 本轮变异探针（P4 / P13 / P19 必做 + 附加）

所有探针都是“改一处 → 跑定向测试 → `git checkout` 恢复”；探针结束后 `git status --porcelain` 为空，再跑全量 `pnpm test` 仍是 29 files / 206 tests。

#### 3.1 必做三项

| 探针 | 本轮改动 | 目标测试 | 结果 | 失败用例 |
|---|---|---|---|---|
| **P4** | `src/engine/apply.ts` 的 `applyGameStarted` 忽略 `payload.roles`，按 `payload.seed` 调 `createInitialState` 重新发牌 | `tests/engine/replay.test.ts` | **exit 1**（2 failed / 12 passed） | 采用 payload.roles…；seed / mode / playerSeat / personas… |
| **P13** | 新建 `src/engine/nested/__probe.ts`：`export const noise = Math.random();` | `tests/engine/rng.test.ts` | **exit 1**（1 failed / 10 passed） | 递归扫描 src/engine 的**全部** .ts… |
| **P19** | `src/engine/step.ts` 的 `startHandler` 删掉 `action.mode !== state.mode`，只校验 seed | `tests/engine/reject.test.ts` | **exit 1**（1 failed / 9 passed） | START 的 mode 与已发牌状态不一致时同样被拒（N8 / P19） |

P19 的输出：

```
FAIL  |unit| tests/engine/reject.test.ts > AC-8 · 拒绝路径 > START 的 mode 与已发牌状态不一致时同样被拒（评审 N8 / P19）
      Tests  1 failed | 9 passed (10)
```

#### 3.2 附加探针（Round 1 的 N 项，逐条验证新测试不是只看绿）

| 探针 | 改动 | 目标测试 | 结果 | 失败用例 |
|---|---|---|---|---|
| **P22** | `apply.ts` 的 post-START `phase` 改成 `'DAY_ANNOUNCE'` | `tests/engine/events.test.ts` | **exit 1**（2 failed / 12 passed） | 开局后进入第一夜的 NIGHT_WOLF_CHAT…；replay 也重建出同样的相位… |
| **N9** | `step.ts` 把传给 handler 的 `context.modifiers` 改成 `[]` | `tests/engine/step.test.ts` | **exit 1**（1 failed / 17 passed） | 传给 step 的 modifiers 会出现在 handler 的 context 里 |
| **N11** | `stampEvents` 的 `seq` 去掉 `index`（三个草稿都写 `state.seq + 1`） | `tests/engine/step.test.ts` | **exit 1**（1 failed / 17 passed） | handler 返回 3 个草稿，seq 为 +1 / +2 / +3… |
| **N2** | `src/shared/actions.ts` 的 `ACTION_TYPES` 删掉 `'VOTE'` | `pnpm typecheck` | **exit 2** | `tests/shared/actions.test.ts(32,50)` 的 `expectTypeOf` 精确相等断言编译失败 |
| **N12** | 新建 `src/engine/nested/__probe.ts`，内容含 `c8 ignore` | `tests/meta/coverage.test.ts -t "忽略注释"` | **exit 1**（1 failed / 2 skipped） | expected [ 'nested/__probe.ts 含 c8 ignore' ] to deeply equal [] |

N2 的输出证明了 `expectTypeOf` 不是装饰：

```
tests/shared/actions.test.ts(32,50): error TS2344: Type '"START" | ... | "SELF_EXPOSE"' does not satisfy the constraint '"Expected: literal string: START, Actual: literal string: VOTE" | ...'.
```

#### 3.3 反向元探针：B-R2-2 的直接证据

```
$ mkdir -p src/engine/nested && echo 'export const noise = Math.random();' > src/engine/nested/__probe.ts
$ # 把 rng.test.ts 的 engineSources() 临时换成一层 readdirSync
$ pnpm exec vitest run tests/engine/rng.test.ts --project unit
 ✓ |unit| tests/engine/rng.test.ts (11 tests)
      Tests  11 passed (11)
```

这个探针和 P13 是互补的：P13 证明“当前代码会抓到嵌套违规”，元探针证明“如果 wiring 回退，永久测试套件不会抓到”。Round 1 的 B1 要的是后者，不只是前者。

### 4. 16 条 AC：回退时哪个测试会红

> 说明：`git diff d8a4866..HEAD -- src/` 为空——Round 1 评审之后，`src/`（引擎与共享契约）没有任何字节变化，11 个改动文件全部在 `tests/`。因此 AC-1/2/3/5/6/7/8/9/10/11/12/15/16 的 Round 1 探针结论仍然适用于当前 `src/`；本轮对其中受新测试影响的项（AC-8 的 mode 分支、AC-6/7、AC-11 的 N9）做了附加探针。

| AC | 负责的测试 | Round 2 判断 | 回退时红的测试 / 证据 |
|---|---|---|---|
| 1 `reduce === step().state` | `tests/engine/step.test.ts` | PASS | Round 1 P1；`src/` 未变 |
| 2 `step` 纯函数、冻结不抛 | `tests/engine/step.test.ts` | PASS | Round 1 P2；`src/` 未变 |
| 3 JSON 往返 + 递归原型断言 | `tests/engine/serialization.test.ts` | PASS | Round 1 P3；N10 追加了整体推进比较 |
| 4 只靠事件流重建 / 事件权威 | `tests/engine/replay.test.ts` | **PASS（运行时）** | **P4 本轮实红**：两条合成事件用例；若只忽略 personas，第二条也会红 |
| 5 同 seed + 同序列逐条相等 | `tests/engine/determinism.test.ts` | PASS | Round 1 P5；`src/` 未变 |
| 6 seq 严格递增 / type 合法 | `tests/engine/events.test.ts` | PASS | Round 1 P6；N11 多事件 seq 探针本轮红 |
| 7 首事件与四字段 | `tests/engine/events.test.ts` | PASS | Round 1 P7；N3 schema 负向用例存在 |
| 8 拒绝：PHASE_MISMATCH、除 seq 外不变 | `tests/engine/reject.test.ts` | PASS | Round 1 P8；N8 的 mode 分支 **P19 本轮实红** |
| 9 transitions 声明与 handler 一致 | `tests/engine/transitions.test.ts` | PASS | Round 1 P9；`src/` 未变 |
| 10 效果 order 升序 + id 字典序 | `tests/engine/effects.test.ts` | PASS | Round 1 P10；`src/` 未变 |
| 11 假 modifier 改变终态 | `tests/engine/effects.test.ts` + `step.test.ts` | PASS | Round 1 P11；N9 的 step 入口探针本轮红（但测试后半段见 M2） |
| 12 无 modifier 时仅顺序规范化 | `tests/engine/effects.test.ts` | PASS | Round 1 P12；`src/` 未变 |
| 13 扫描全部 `.ts` 无 `Math.random(` | `tests/engine/rng.test.ts` + `tests/helpers/source-scan.ts` | **PASS（运行时）/ 永久锁 NEEDS WORK** | P13 本轮实红；但 **M1 / B-R2-2**：把 `engineSources()` 换成一层扫描后 11/11 仍绿 |
| 14 行 ≥ 90% / 分支 ≥ 85% | `tests/meta/coverage.test.ts` | PASS | 实跑 98.01 / 95.23；N12 递归忽略注释探针本轮红 |
| 15 `checkWin` 纯谓词、两种模式 | `tests/engine/win.test.ts` | PASS | Round 1 P15；`src/` 未变 |
| 16 引擎测试零网络 | `tests/engine/no-network.test.ts` + `tests/setup/no-network.ts` | PASS | Round 1 P16；`src/` 未变 |

**逐条回答 Round 1 的缺口 AC**：

- **AC-4**：如果 `applyGameStarted` 回退成“按 seed 重新发牌”，`replay.test.ts` 会红两条（P4 已实证）；如果忽略 `personas` 或 `seed` / `mode`，第二条会红；如果忽略 `playerSeat`，单独那条会红。新测试不是只验证夹具：它们构造了一个**与重新发牌结果不同**的合法合成事件，并同时断言“重放采用 payload”和“重新发牌得到的是原结果”。
- **AC-13**：如果扫描退回一层且存在嵌套违规，`rng.test.ts` 的第一条会红（P13 已实证）；如果 helper 本身失去递归，`source-scan.test.ts` 的第一条会红。但 **如果只把 `rng.test.ts` 的 `engineSources()` 换成一层扫描，永久套件不会红**（3.3 元探针）。所以 AC-13 的“当前行为”是 PASS，“永久回归锁”仍是 NEEDS WORK。

### 5. 新增测试是否只是在验证自己的夹具

| 新测试 | 判断 | 依据 |
|---|---|---|
| `replay.test.ts` 合成 `GAME_STARTED`（roles / seed / mode / personas / playerSeat） | **真实行为测试** | P4 变异使前两条变红；合成事件与重新发牌结果不同 |
| `reject.test.ts` mode 不一致 | **真实行为测试** | P19 变异使本条变红 |
| `events.test.ts` post-START `phase` / `day` | **真实行为测试** | P22 变异使本条与 replay 相位条变红 |
| `events.test.ts` 两个 payload schema 的 `safeParse` | **真实行为测试**（负向夹具） | 真实 payload 通过、`roles` 长度 / `playerSeat` / `actionType` 坏值被拒 |
| `replay-parity.test.ts` 真分段重放 | **真实行为测试** | 先 `replay` 前半，再逐条 `applyEvent` 折后半；与原 `replay(events)` 比较 |
| `serialization.test.ts` 整体推进比较 | **真实行为测试** | 比较 `StepResult` 整体，不只 `seq` |
| `step.test.ts` N11 多事件 seq | **真实行为测试** | N11 变异使本条变红 |
| `actions.test.ts` `ACTION_TYPES` 双向等值 | **真实类型层测试** | N2 变异使 `pnpm typecheck` 变红（不是只在运行时数长度） |
| `source-scan.test.ts` 临时目录递归 | **真实 helper 行为测试** | 临时目录造嵌套结构；不是 `src/` 里的固定夹具 |
| `rng.test.ts:48-55` “扫描器是递归的” | **空转（M1）** | 只断言数组形状；3.3 元探针在“一层扫描 + 嵌套违规”下仍 11/11 绿 |
| `step.test.ts:125-129` N9 后半段 | **部分空转（M2）** | 它直接调用局部 `applyModifiers`，没有经过 `step`；前半段的 `context.modifiers` 断言是有效的（N9 探针红） |
| `replay.test.ts:169` 标题含 `playerSeat` | **标题与内容不符（M3）** | 该测试只断言 seed / mode / personas；playerSeat 由 `:197` 的单独测试覆盖，不造成行为缺口，但会让失败信息误导 |

### 6. 评审维度

#### 6.1 RFC 遵循 · **PASS（功能面）**

- 16 条 AC 全部有实现与对应测试；B1 / B2 在当前代码上确实修好了（P13 / P4 实红）。
- D-15 ~ D-17 已写入 §8.2，理由成立：`nextInt(RngState)` 比 `nextInt(GameState)` 更纯；额外导出有实际消费者；`WinCondition` 封闭联合满足 §2.7 的 `string` 且给 RFC-014 一个可穷举契约。
- 未发现超范围功能或缺失功能。C-21（modifier 注册表不写入 `GAME_STARTED`）仍是 v1 的可接受缺口，不阻塞本 RFC。
- 文档与实现仍有小偏差（不计入功能面，见 6.2 / 6.5）：RFC §8.4 的 AC-14 还写“分支 94.04%”，实际本轮是 95.23%；§8.5 第 295 行也还写 94.04%；§8.3 的文件清单没有列出本轮新增的 `tests/helpers/source-scan.ts` / `source-scan.test.ts` 与被修改的 `tests/shared/actions.test.ts`。

#### 6.2 RULES 遵循 · **NEEDS WORK**

| 规则 | 结论 | 证据 / 备注 |
|---|---|---|
| ARCH-1 / ARCH-2 / ARCH-3 / ARCH-4 / ARCH-5 / ARCH-6 | PASS | 与 Round 1 相同；`src/` 自 `d8a4866` 未变；依赖方向测试仍绿 |
| ARCH-11（未实现必须抛） | PASS | `UnknownEventError` / `UnhandledTransitionError` / `UnknownEffectError` 的负向用例仍在 |
| DATA-3 / DATA-4 | PASS | `rngAfter` 重建、同 seed 确定性测试未变 |
| DATA-5 / TEST-2 | **PASS（运行时）** | P13 / N12 本轮实红；递归扫描已落地。永久 wiring 锁见 B-R2-2 |
| TEST-3 / TEST-4 / TEST-5 | PASS | 确定性测试、no-network、五条命令均实跑通过 |
| DOC-1 | **NEEDS WORK** | RFC §8.4 / §8.5 的 94.04% 与实测 95.23% 不一致；§8.3 文件清单未同步本轮改动；`TEST-STRATEGY.md:32-33` 仍写 28 files / 186 tests（“当前实测”口径）。`README.md:11` 与 `RFCS.md:3` 已在本轮评审中同步为 Round 2 / 206 / 95.2% 与 v2.14 |
| **AGENTS.md 跨平台** | **NEEDS WORK** | `tests/helpers/source-scan.test.ts` 用 `/` 断言 `relativePath`，而 `path.relative` 在 Windows 返回 `\`；Windows 上必红。见 B-R2-1 |

**B-R2-1（阻塞）· Windows 路径分隔符**

`tests/helpers/source-scan.ts:36`：

```ts
relativePath: relative(rootDir, absolutePath),
```

`tests/helpers/source-scan.test.ts:49 / :76 / :93` 用 POSIX 分隔符断言：

```ts
expect(files).toEqual(['phases/night.ts', 'resolve/deep/deeper/deepest.ts', 'top.ts']);
expect(collectTypeScriptFiles(root)[0]?.relativePath).toBe('engine/phases/night.ts');
expect(findFilesContaining(files, 'Math.random(')).toEqual(['nested/violation.ts']);
```

Node 的 `path.win32.relative` 对本仓库这种同盘路径返回反斜杠：

```
$ node -e "const {win32}=require('node:path'); console.log(JSON.stringify(win32.relative('C:/repo/src','C:/repo/src/phases/night.ts')))"
"phases\\night.ts"
```

因此 Windows 上 `pnpm test` 会在 `source-scan.test.ts` 失败（`AGENTS.md` 要求 macOS 与 Windows 跑完同一套流程）。**未在 Windows 实跑**（本会话无 Windows 主机），但这是 Node 平台路径 API 的确定行为，不是风格判断。

**建议**：在 `source-scan.ts` 的边界统一归一化为 POSIX 路径，例如 `relative(rootDir, absolutePath).split(sep).join('/')`（或 `replaceAll(sep, '/')`）；这样失败消息与断言都跨平台稳定。也可以改测试用 `join('phases', 'night.ts')` 构造期望值，但归一化在 helper 里更彻底。

#### 6.3 安全 · **PASS（当前表面）**

- 与 Round 1 相同：`GAME_STARTED` 含全员 `roles` 但 `visibleTo: 'server'`；`REJECTED` 对带席位 action 用 `self:<seat>`。本 RFC 没有把完整 `GameState` 序列化给客户端的路径；`project()` 的 SEC-5 验收仍在 RFC-007，不能因为这里没有投影就宣称 SEC-5 已完成。
- 本轮新增的 `source-scan` 只在测试期读源码，不进入引擎运行时；没有新增网络、密钥、日志或 HTML 入口。
- `createEmptyState()` 用 `gameId: ''` 当哨兵、首个事件 `gameId` 为空时 D-13 混流检查会跳过的边缘仍在，继续归 RFC-008 的 Zod 入口处理；不阻塞本 RFC。

#### 6.4 性能 · **PASS**

- 引擎运行时没有变化（`src/` 未变）；`step` / `applyEvent` / `replay` 仍是纯函数、无 IO。
- 新增的递归扫描只在测试期运行；`collectTypeScriptFiles` 对 `src/engine` 的 9 个文件是 O(files)，没有性能问题。
- 没有发现需要在本 RFC 处理性能问题的地方。

#### 6.5 可维护性 · **NEEDS WORK**

**做得好的地方**：`source-scan.ts` 把两处门禁共用的递归扫描抽出来，并用临时目录自测，避免了往 `src/` 塞夹具；P4 用合成事件而不是改发牌算法来锁“事件权威”，思路正确；N11 / N12 / P22 的测试都是直接针对回退路径，不是只跑绿。

**问题**：

- **M1（阻塞，B-R2-2）· `rng.test.ts:48-55` 的“扫描器是递归的”是空转**。它只断言 `Array.isArray(scanned)` 和每项有 `relativePath` 字符串；3.3 元探针证明一层扫描 + 嵌套 `Math.random()` 仍 11/11 绿。当前 `engineSources()` 之所以递归，只是因为这一行恰好调用了 helper；测试没有锁住这个 wiring。**建议**：让 `engineSources(root = ENGINE_DIR)` 接受根目录，测试用临时目录造一个嵌套违规并断言 `findFilesContaining(engineSources(tmpRoot), 'Math.random(')` 命中；或者删掉这条空转测试，改成对 `collectTypeScriptFiles` 的明确引用测试（但前者更能锁住 wiring）。不要保留一个名字承诺了递归、内容却不检查递归的测试。
- **M2（非阻塞）· `step.test.ts:125-129` 的 N9 后半段是夹具调用**。它直接调用局部 `handler` → `applyModifiers`，没有经过 `step`；真正有效的只是前半段“传给 step 的 modifiers 出现在 handler context 里”。如果 RFC-003 的 handler 忘记把 `context.modifiers` 传给 `applyModifiers`，这条测试仍不会红。建议把后半段改成“注入一个会调用 `applyModifiers` 的自定义 handler，走 `engine.step(...)`，断言 modifier 被调用”，或明确登记为 RFC-003 的测试计划项。
- **M3（非阻塞）· `replay.test.ts:169` 的标题包含 `playerSeat`，正文只测 seed / mode / personas**。playerSeat 由 `:197` 的单独测试覆盖，行为不缺；但失败信息会误导。改标题或把 playerSeat 并入该测试。
- **文档同步（非阻塞但应在同一修复提交处理）**：RFC §8.4 的 AC-14（`:272`）与 §8.5（`:295`）仍写分支 94.04%，实测 95.23%；§8.3 文件清单缺本轮新增/修改的测试文件；`TEST-STRATEGY.md:32-33` 的“当前”数字仍是 186 / 94.0%。`README.md` 与 `RFCS.md` 的状态/版本已由本评审同步；剩下的 RFC 正文与 TEST-STRATEGY 建议随下一次修复提交一起改，避免下一轮再从文档里读到不实陈述。
- **小 nit（非阻塞）**：`source-scan.ts:27` 的 `entry.name.startsWith('.')` 会连隐藏的 `.ts` 文件一起跳过；AC-13 说的是“全部 `.ts`”。`src/engine` 里目前没有隐藏 `.ts`，但如果要严格按字面，改成只跳过隐藏**目录**（`entry.isDirectory() && entry.name.startsWith('.')`）更贴合。优先级低。

### 7. 总体结论

#### 7.1 风险与摘要

**Overall Risk: Medium。** Round 1 的两条阻塞项在运行时确实修好了：P4 会红（重新发牌）、P13 会红（嵌套 `Math.random()`）、P19 会红（删掉 mode 分支），16 条 AC 的主路径都有真实覆盖，206 个用例、typecheck / lint / format / build / coverage 全部实跑通过。引擎 `src/` 自 Round 1 以来没有变化，所以 Round 1 对其余 AC 的探针结论仍然成立。

问题集中在**新测试基础设施自身**：Windows 上会因路径分隔符必红；AC-13 的递归锁只证明了 helper、没有证明 `rng.test.ts` 的 wiring，反向元探针下“一层扫描 + 嵌套违规”仍然 11/11 绿。这两条都不是产品代码缺陷，但都会让门禁在未来静默失效或在一个支持平台上直接失败，因此不能置 `Reviewed`。

#### 7.2 阻塞项（合并前必须处理）

1. **B-R2-1 · Windows 路径分隔符**
   - 在 `tests/helpers/source-scan.ts:36` 把 `relativePath` 归一化为 POSIX（`split(sep).join('/')`），或把 `source-scan.test.ts` 的期望值改成平台原生拼接。
   - 复跑：macOS 上 `pnpm exec vitest run tests/helpers/source-scan.test.ts --project unit` 必须绿；Windows 上需要一次实跑确认（本会话无法提供）。
2. **B-R2-2 · AC-13 的永久递归锁**
   - 让 `engineSources` 接受根目录参数，测试用临时目录造 `nested/__probe.ts` 并断言 `engineSources(tmpRoot)` 能扫到；或等价地让第三条测试真正经过 `step`/helper 的递归路径。
   - 复验：把 `engineSources()` 换成一层 `readdirSync` 后，`rng.test.ts` 必须变红（本轮 3.3 元探针当前是 11/11 绿）。
   - 修完后 `pnpm test` 应仍是 29+ files / 206+ tests 全绿。

#### 7.3 非阻塞改进（建议同批或随后处理）

- **M2**：把 N9 后半段改成经过 `step` 的真实 handler 测试，或写进 RFC-003 的测试计划。
- **M3**：修 `replay.test.ts:169` 的标题，或把 playerSeat 并入该用例。
- **文档同步**：RFC §8.3 / §8.4 / §8.5 的 94.04% 与文件清单；`TEST-STRATEGY.md:32-33` 的 28 / 186。`README.md` 与 `RFCS.md` 的状态/版本已在本轮同步。
- **小 nit**：`source-scan.ts` 是否要跳过隐藏 `.ts` 文件，按 AC-13 的字面“全部 `.ts`”再确认一次。
- **C-21** 仍是 RFC-003/004 引入第一个 modifier 前必须由 `/manage-changes` 裁决的项，不阻塞本 RFC，但不要忘记。

#### 7.4 没有发现问题的部分（避免只列负面）

- P4 的合成事件思路是正确的地基测试：没有改发牌算法，就能区分“用 payload”和“重新发牌”。
- `source-scan.ts` 的临时目录自测是比“往 `src/` 塞夹具”更干净的做法；helper 自身的递归测试是真实的。
- N11 / N12 / P22 的测试都直接针对回退路径；N2 的 `expectTypeOf` 在 `pnpm typecheck` 下确实会红，不是装饰。
- 覆盖率门禁与实测数字一致（98.01% 行 / 95.23% 分支），`init.ts` 的 80% 分支是已知且可解释的防御分支。
- 引擎运行时没有被本轮修复改动，Round 1 对 ARCH / DATA / SEC 的正面结论仍然成立。

---

**Round 2 评审证据**：本文件中的命令输出来自 2026-11-17 的本会话实跑；P4 / P13 / P19 / P22 / N9 / N11 / N2 / N12 与 3.3 元探针均在 `git checkout` / 删除临时文件后恢复，探针恢复后 `git status --short` 为空；复跑 `pnpm test` 为 `29 files / 206 tests passed`，`pnpm typecheck` 为 0。随后只改了本评审文件、`RFCS.md` 与 `README.md` 的状态文档。

---

## Round 3 -- 2026-11-18

> **评审会话**：新会话（未参与 RFC-002 的实现与 Round 1/2 修复；本会话只读仓库文件、跑命令、做临时变异探针）
> **基线**：分支 `rfc/001-project-scaffold-and-shared-contracts` / HEAD `222bf65`；评审开始时与全部探针恢复后 `git status --short` 均为空。评审产物只改本文件、`RFCS.md`、`README.md`、`TEST-STRATEGY.md`，未改 `src/`、`tests/` 或配置
> **结论**：**Reviewed**
> **整体风险**：**Low**

### 0. STEP 0 · 实际执行结果

环境：Node `v22.22.2`、pnpm `10.33.0`、macOS。以下均为本会话实跑，不是转述。

```text
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0

$ pnpm lint
> eslint .
EXIT 0

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
EXIT 0

$ pnpm test
 Test Files  29 passed (29)
      Tests  209 passed (209)
EXIT 0
  # unit：22 files / 175 tests；meta：7 files / 34 tests

$ pnpm build
vite v8.3.8 building client environment for production...
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
dist/server/index.js  1.25 kB │ gzip:  0.86 kB
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
pnpm selfplay 未实现（RFC-015）
EXIT 1   # C-5 登记的临时偏离，预期如此
```

覆盖率（AC-14 / TEST-2）：

```text
$ pnpm exec vitest run --project unit --coverage
 Test Files  22 passed (22)
      Tests  175 passed (175)
EXIT 0

----------------|---------|----------|---------|---------|
File            | % Stmts | % Branch | % Funcs | % Lines |
----------------|---------|----------|---------|---------|
All files       |   98.13 |    95.23 |     100 |   98.01 |
 apply.ts       |      96 |    95.65 |     100 |      96 |
 effects.ts     |     100 |    88.88 |     100 |     100 |
 errors.ts      |     100 |      100 |     100 |     100 |
 init.ts        |    90.9 |       80 |     100 |    90.9 |
 replay.ts      |     100 |      100 |     100 |     100 |
 rng.ts         |   96.15 |       90 |     100 |      96 |
 step.ts        |     100 |      100 |     100 |     100 |
 transitions.ts |     100 |      100 |     100 |     100 |
 win.ts         |     100 |      100 |     100 |     100 |
----------------|---------|----------|---------|---------|
```

探针全部恢复后复跑：`pnpm typecheck` → 0，`pnpm test` → `29 files / 209 tests passed`，`git status --short` 只有本轮四份文档。

**未验证项（不隐藏）**：

- **Windows 实跑**：本会话没有 Windows 主机。B-R2-1 的结论来自 `path.win32.relative` 的确定行为、`toPosixPath` 的单元测试与代码检查；这一条是「在逻辑层已修 + 有会在归一化失效时变红的单元测试」，不是 Windows 实跑输出。
- **干净检出后的 `pnpm install --frozen-lockfile`** 没有重跑；结论基于现有 `node_modules`。
- `pnpm test:e2e` 仍 skipped、`pnpm selfplay` 仍按 RFC-015 占位退出 1；两者不属于 RFC-002 的验收面。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 仍是 **game（主）+ web app（交付形态）**。RFC-002 只交付引擎内核，没有 UI、HTTP 路由或浏览器交互，因此本轮继续只检查：

| 适用 | 本 RFC 的检查 |
|---|---|
| 数据模型 / 跨层契约 | `GameState` / `GameEvent` / `Action` / `Effect` 的形状与序列化 |
| 核心循环 / 状态机 | `step` / `reduce` / `applyEvent` / `replay` 的推进与事件流 |
| 安全（隐藏信息） | `GAME_STARTED` 的 `server` 可见性、`Rejected` 的席位可见性 |
| 性能 | 纯函数推进的复杂度、是否有 IO / 网络 |
| 测试 | 16 条 AC、TEST-2 / TEST-3 / TEST-4 门禁、Round 2 的 B-R2-1 / B-R2-2 |

**显式跳过**（与 Round 1/2 相同，不是遗漏）：响应式 / 无障碍 / 浏览器矩阵（无用户可见功能，TEST-6 从 RFC-012 起生效）、首屏性能（NFR-8 归 RFC-016）、平台认证 / 账号 / SEO / 离线（PRD 已列为不适用）、存档 / 读档版本化（RFC-008）、UI 安全（无渲染与表单，输入边界在 RFC-011 / RFC-008）。`project()` 的 SEC-5 验收仍在 RFC-007；JSON 恢复时的事件校验在 RFC-008。

### 2. Round 2 阻塞项复核

#### 2.1 B-R2-1 · Windows 路径分隔符

**结论：已修（逻辑层）。** `tests/helpers/source-scan.ts:24-26` 新增 `toPosixPath`，`collectTypeScriptFiles` 在 `:50` 统一把 `relative()` 的结果归一化为 `/`；`tests/helpers/source-scan.test.ts` 同时覆盖 Windows 串、POSIX 串与「收集结果不含反斜杠」。

本会话复核：

```text
$ pnpm exec tsx -e "import { toPosixPath } from './tests/helpers/source-scan.ts'; import { win32 } from 'node:path'; const rel = win32.relative('C:/repo/src', 'C:/repo/src/phases/night.ts'); ..."
{"raw":"phases\\night.ts","normalized":"phases/night.ts"}
{"raw":"resolve\\deep\\deeper\\deepest.ts","normalized":"resolve/deep/deeper/deepest.ts"}
```

反向探针（把 `toPosixPath` 改成直接返回入参）：

```text
 × Windows 风格的反斜杠被转成 / 3ms
 FAIL  |unit| tests/helpers/source-scan.test.ts > toPosixPath（B-R2-1） > Windows 风格的反斜杠被转成 /
AssertionError: expected 'nested\violation.ts' to be 'nested/violation.ts'
      Tests  1 failed | 9 passed (10)
```

**残余限制**：macOS 上 `relative()` 本身返回 `/`，所以「`collectTypeScriptFiles` 真的调用了 `toPosixPath`」这条接线在 macOS 上不会因回退而变红（Windows 上会，因为 `source-scan.test.ts` 的收集结果会带 `\`）。这不是未修，而是跨平台测试的固有边界；本会话已用单元测试锁住归一化函数本身。

#### 2.2 B-R2-2 · AC-13 的永久递归锁

**结论：已修。** `tests/engine/rng.test.ts:26-28` 的 `engineSources(root = ENGINE_DIR)` 把根目录做成可注入；`:56-71` 用临时目录造 `top.ts` + `nested/violation.ts`，断言 `findFilesContaining(engineSources(root), 'Math.random(')` 命中嵌套文件。这守的是 `engineSources` 的接线，而不是 helper 自己的递归能力。

反向探针（把 `engineSources` 换回一层 `readdirSync`，保留临时目录结构）：

```text
 × 接线本身是递归的：临时根目录里的嵌套违规也必须被扫到（B-R2-2） 7ms
 FAIL  |unit| tests/engine/rng.test.ts > AC-13 · 引擎不得使用 Math.random > 接线本身是递归的：临时根目录里的嵌套违规也必须被扫到（B-R2-2）
AssertionError: expected [] to deeply equal [ 'nested/violation.ts' ]
      Tests  1 failed | 10 skipped (11)
```

同时复核 P13（在 `src/engine/nested/__probe.ts` 放 `Math.random()`）：

```text
 × 递归扫描 src/engine 的**全部** .ts，没有任何违规调用
AssertionError: expected [ 'nested/__probe.ts' ] to deeply equal []
      Tests  1 failed | 10 passed (11)
```

#### 2.3 N9 / M3 与文档同步

- **N9 已修**：`tests/engine/step.test.ts` 的自定义 handler 现在真的调用 `applyModifiers('VOTE_RESOLVE', state, [], context.modifiers)`，断言走 `step → handler → applyModifiers` 全链路；把 `step` 传给 handler 的 `modifiers` 换成 `[]` 后，本条变红（见 §3 的 AC-11）。
- **M3 已修**：`replay.test.ts` 的标题改为「playerSeat 从 payload 决定哪个席位是玩家（唯一一个）」，并补了「原玩家席位不再是玩家、全场只有一个玩家」的反方向断言。
- **文档同步**：RFC §8.3 补了 `source-scan.ts` / `source-scan.test.ts`，§8.4 / §8.5 的数字改为实测 98.01 / 95.23 与 209 用例；`TEST-STRATEGY.md` 的 0.2 基线改为 209。本评审顺手把 `RFCS.md` 版本头（v2.14 → v2.16）、`TEST-STRATEGY.md` 版本头（v1.6 → v1.7）与 `README.md` 的状态同步到本轮。

### 3. 16 条 AC：回退时哪个测试会红

> 本节不是「测试名对上了」就结束。除 AC-14 是直接实跑门禁外，本会话做了 17 个临时变异探针（改一处 → 跑定向测试 → 恢复）；下表 ✅ = 探针确实 exit 1，⚠️ = 有残余缺口。探针结束后 `git status --short` 为空，再跑全量仍是 29 files / 209 tests。

| AC | 负责测试 | 本轮探针 / 结论 |
|---|---|---|
| 1 `reduce === step().state` | `tests/engine/step.test.ts` | ✅ `reduce` 直接返回 `state` → 10 个样本全红 |
| 2 `step` 纯函数、冻结不抛 | 同上 | ✅ `step` 内写 `state.seq` → 冻结用例 `TypeError: Cannot assign to read only property 'seq'` |
| 3 JSON 往返 + 递归原型断言 | `tests/engine/serialization.test.ts` | ✅ 把 `day` 换成 `Date` → 2 failed（往返 + 原型断言） |
| 4 只靠事件流重建 / 事件权威 | `tests/engine/replay.test.ts` | ✅ 把 `payload.roles` 旋转 3 位 → 「采用 payload.roles…」failed；Round 2 的 P4（按 seed 重新发牌）在 `src/` 未变的前提下仍适用 |
| 5 同 seed + 同序列逐条相等 | `tests/engine/determinism.test.ts` | ✅ 发牌改成忽略 `input.seed` → 「不同 seed 产出不同发牌」failed |
| 6 seq 严格递增 / type 合法 | `tests/engine/events.test.ts` | ✅ seq 盖章去掉 `+1` → `events.test.ts` 文件级 `InvalidEventStreamError`（构造夹具即失败） |
| 7 首事件与 GAME_STARTED 四字段 | `tests/engine/events.test.ts` | ✅ payload 删掉 `mode` → 2 failed（字段断言 + schema） |
| 8 拒绝：PHASE_MISMATCH、除 seq 外不变 | `tests/engine/reject.test.ts` | ✅ 删掉 `START` 的 `mode` 校验 → 「mode 不一致被拒」failed |
| 9 transitions 声明与 handler 一致 | `tests/engine/transitions.test.ts` | ✅ `FINISHED: ['VOTE']`（无 handler）→ 2 failed（边界 + 每个允许对都有 handler） |
| 10 效果 order 升序 + id 字典序 | `tests/engine/effects.test.ts` | ✅ 排序比较反向 → 3 failed |
| 11 假 modifier 改变终态 | `tests/engine/effects.test.ts` + `step.test.ts` | ✅ `applyModifiers` 忽略 modifier → 3 failed；N9 反向探针也红 |
| 12 无 modifier 时仅顺序规范化 | `tests/engine/effects.test.ts` | ✅ `applyModifiers` 复制效果 → 5 failed（含两条 AC-12） |
| 13 扫描 `src/engine/` 全部 `.ts` | `tests/engine/rng.test.ts` + `source-scan.ts` | ✅ 嵌套 `__probe.ts` → 红；B-R2-2 一层接线 → 红；⚠️ 隐藏 `.ts` 仍逃逸（C-22） |
| 14 行 ≥ 90% / 分支 ≥ 85% | `tests/meta/coverage.test.ts` | ✅ 实跑行 98.01 / 分支 95.23；3 条门禁测试全绿，无忽略注释 |
| 15 `checkWin` 纯谓词、两种模式 | `tests/engine/win.test.ts` | ✅ 把两种模式的判断对调 → 5 failed |
| 16 引擎测试零网络 | `tests/setup/no-network.ts` + `tests/engine/no-network.test.ts` | ✅ 去掉 `vitest.config.ts` 的 `setupFiles` → 2 failed |

**AC-13 的残余缺口（C-22）**：在 `src/engine/.hidden.ts` 放 `Math.random()` 后，`rng.test.ts` 仍 `11 passed`。原因是 `tests/helpers/source-scan.ts:41` 对**所有**以 `.` 开头的条目 `continue`，而函数注释写的是「跳过隐藏目录」、AC-13 写的是「全部 `.ts`」。当前 `src/engine` 没有隐藏 `.ts`，不影响本 RFC 已验收行为；已登记为 RFCS C-22（非阻塞），建议把条件收窄为 `entry.isDirectory() && entry.name.startsWith('.')` 并补一条隐藏文件用例。

### 4. 新增测试是否只是在验证自己的夹具

| 新测试 | 判断 | 依据 |
|---|---|---|
| `rng.test.ts` 的临时根目录嵌套违规（B-R2-2） | **真实接线测试** | 把 `engineSources` 换回一层 `readdirSync` 后本条红；临时目录不碰 `src/` |
| `source-scan.test.ts` 的 `toPosixPath` 三例 | **真实函数测试** | 把 `toPosixPath` 改成直返入参后「Windows 风格…」红 |
| `step.test.ts` 的 N9 全链路 | **真实行为测试** | `step` 不传 modifiers 时本条红；handler 内部真的调用 `applyModifiers` |
| `replay.test.ts` 的 playerSeat 反方向断言 | **真实不变量测试** | 断言原玩家席位被清掉且全场只有一个玩家，不是只换一个值 |
| `source-scan.test.ts` 的临时目录递归 / `findFilesContaining` | **真实 helper 行为测试** | 造嵌套结构；干净输入返回空数组 |
| `rng.test.ts` 的隐藏 `.ts` 场景 | **尚未覆盖（C-22）** | 实测隐藏 `.ts` 仍逃逸，说明 AC-13 的字面边界没有被这条测试锁住 |

### 5. 评审维度

#### 5.1 RFC 遵循 · **PASS**

- 16 条 AC 全部有实现与对应测试；`step` / `reduce` / `applyEvent` / `replay` 的签名与语义与 §2.1 一致（`applyEvent` / `replay` 收 `GameEvent` 是 §8.2 D-1 已批准的收紧）。
- 事件溯源的关键不变量成立：`GAME_STARTED` 是首事件、`visibleTo: 'server'`、携带 `seed` / `mode` / `playerSeat` / `roles` / `personas` 与 `rngAfter`；`applyGameStarted` 以 `payload.roles` 为唯一权威；`replay` 只接收事件流。
- 拒绝/抛错按 §2.3 的机械判据分开：`PHASE_MISMATCH` / `START_STATE_MISMATCH` 产出 `Rejected`，允许对缺 handler 抛 `UnhandledTransitionError`，未知事件抛 `UnknownEventError`。
- 效果管道按 §2.4：`order` 升序 + 同级 `id` 字典序；`applyModifiers` 插入点可用；v1 空 applier 表遇到效果即抛 `UnknownEffectError`；效果不写入事件流。
- §2.5 ~ §2.7：PRNG 可注入、`nextInt` 只收 `RngState`（D-15 已批准）；`GameState` 可 JSON 往返；`checkWin` 是纯谓词，只读 `seats` / `mode`。
- **已登记的偏离**：C-21（modifier 注册表不写入 `GAME_STARTED`）仍是 v1 无可观察影响的可接受缺口；不是未记录偏离。
- **非阻塞边界**：RFC §6 说本 RFC 验「`FINISHED` 后的拒绝路径」，现有测试只直接构造过 `NIGHT_WOLF_CHAT` 的拒绝（`reject.test.ts`）与静态断言 `DEFAULT_TRANSITIONS.FINISHED` 为空（`transitions.test.ts:32-39`），没有一条从 `phase: 'FINISHED'` 的状态提交 action 的用例。行为上 `FINISHED: []` 会走同一条 `PHASE_MISMATCH` 路径，风险低；建议补一条构造 `FINISHED` 状态的拒绝用例后彻底闭合。

#### 5.2 RULES 遵循 · **PASS**

| 规则 | 结论 | 证据 / 备注 |
|---|---|---|
| ARCH-1 / ARCH-2 / ARCH-3 | PASS | `src/engine/` 只 import `@shared/*`；依赖方向测试绿；无类实例 / 函数 / Map / Set / Date |
| ARCH-4 / ARCH-5 / ARCH-6 | PASS | `reduce` 纯函数；`step` 只经 `applyEvent` 折叠；效果带 `source`、显式排序后应用 |
| ARCH-11 | PASS | 未实现的转移 / 事件 / 效果分别抛 `UnhandledTransitionError` / `UnknownEventError` / `UnknownEffectError` |
| DATA-1 ~ DATA-5 | PASS | seq/ts、事件类型联合、`replay`、可注入 PRNG、无 `Math.random`；AC-13 的隐藏文件边界见 C-22 |
| TEST-2 / TEST-3 / TEST-4 / TEST-5 | PASS | 覆盖率 98.01 / 95.23；确定性测试；no-network setup；五条命令实跑通过 |
| STYLE-3 / STYLE-6 | PASS | 无 `any`、无 TODO；`src/engine/step.ts` 256 行，全部文件 < 400 |
| DOC-1 | PASS（本轮） | D-1 ~ D-19 记录在 §8.2；本轮评审同步了 `RFCS.md` / `README.md` / `TEST-STRATEGY.md` 的版本与状态 |
| AGENTS.md 跨平台 | PASS（逻辑层） | POSIX 归一化 + Windows 串单元测试；实际 Windows 未实跑，见 §0 未验证项 |

#### 5.3 安全 · **PASS**

- 与 Round 1/2 相同：`GAME_STARTED` 含全员 `roles` 但 `visibleTo: 'server'`（`src/engine/step.ts:110-123`），`REJECTED` 对带席位 action 用 `self:<seat>`；本 RFC 没有把完整 `GameState` 序列化给客户端的路径。SEC-5 的 `project()` 验收仍在 RFC-007，不能因为这里没有投影就宣称 SEC-5 完成。
- 无密钥、无日志、无网络、无 HTML / 表单入口；`source-scan` 是测试期工具，不进引擎运行时。
- **残余（非阻塞）**：`replay` 信任事件信封上的 `visibleTo`；一个被篡改的 `GAME_STARTED`（例如把 `visibleTo` 改成 `public`）仍会被折叠。事件流是服务端资产，且 `src/shared/schemas.ts` 的 `EventSchema` 只校验枚举、不校验「事件类型 ↔ 可见性」对应关系；RFC-008 的 Zod 入口应把 `GAME_STARTED` 必须是 `server` 这一条补上。`applyEvent` 对非随机事件携带的 `rngAfter` 也会无条件写回（`src/engine/apply.ts:44-46`），`step` 目前不会产生这种 `REJECTED`，但自定义 handler / 篡改事件可以构造；建议在 RFC-008 校验或 `applyEvent` 里收窄为「只对 `RANDOM_CONSUMING_EVENTS` 生效」。

#### 5.4 性能 · **PASS**

- `step` / `applyEvent` / `replay` 仍是纯函数、无 IO、无网络；`checkWin` 每次 O(9)；`applyEffects` 的排序 O(n log n)，n 是结算效果数。
- `source-scan` 的递归只在测试期运行；`src/engine` 的 9 个文件是 O(files)。
- 没有 N+1、无界拉取或缓存问题。

#### 5.5 可维护性 · **PASS（有非阻塞建议）**

**做得好的地方**：`step` 自己折叠事件让 `reduce === step().state` 由构造保证；`stampEvents` 统一盖 `gameId` / `seq` / `ts`；错误类型按 `name` 断言；`source-scan` 抽成共享 helper 并用临时目录自测；Round 2 的三处新测试（B-R2-2 / N9 / playerSeat 反方向）都直接针对回退路径。

**非阻塞建议**：

1. **C-22 · 隐藏 `.ts`**：修 `tests/helpers/source-scan.ts:41`，只跳过隐藏目录，并补隐藏 `.ts` 用例；同时让注释与 AC-13 的「全部 `.ts`」一致。
2. **FINISHED 拒绝路径**：补一条直接构造 `phase: 'FINISHED'` 的 `step` 用例（可基于 `stateWithRoles` 改 `phase`），断言 `REJECTED` + `PHASE_MISMATCH` + 除 seq 外不变。
3. **`rngAfter` 的适用范围**：在 `applyEvent` 或 RFC-008 校验层只允许 `RANDOM_CONSUMING_EVENTS` 携带 / 生效，避免「REJECTED 也能改 rng」这类违反 §2.3 的构造。
4. **C-21**：引入第一个 modifier 前，按 RFCS C-21 由 `/manage-changes` 裁决「modifier 注册表写进 `GAME_STARTED`」还是「扩展效果不参与 replay」。

### 6. 总体结论

#### 6.1 风险与摘要

**Overall Risk: Low。** Round 2 的两条阻塞项都已修好并且被永久锁住：B-R2-1 把 `relative()` 的结果统一归一化为 POSIX，且「归一化函数被改坏」会让 `source-scan.test.ts` 变红；B-R2-2 把 `engineSources` 的根目录做成可注入，反向探针（一层 `readdirSync` + 嵌套违规）会让 `rng.test.ts` 变红。N9 从「测试自己调夹具」改成真正的 `step → handler → applyModifiers` 链路，M3 的标题与反方向断言也修了。209 个用例、typecheck / lint / format / build / coverage 全部实跑通过，16 条 AC 的主路径都有会在行为退化时变红的测试。

剩下的都是非阻塞项：AC-13 对隐藏 `.ts` 的字面缺口（C-22）、`FINISHED` 拒绝路径缺一条直接用例、`rngAfter` 对非随机事件过于宽松、以及 C-21 的 modifier 注册表缺口。它们不影响本 RFC 的引擎内核验收，已分别登记 / 建议，不能悄悄丢掉。

#### 6.2 阻塞项（合并前必须处理）

**无。** 本 RFC 可以置 `Reviewed`。

#### 6.3 非阻塞改进（建议同批或随后处理）

- **C-22**：`tests/helpers/source-scan.ts:41` 的隐藏文件跳过；补隐藏 `.ts` 用例。
- **FINISHED 拒绝路径**：补一条从 `FINISHED` 状态提交 action 的 `PHASE_MISMATCH` 用例。
- **`rngAfter` 收窄**：只对 `RANDOM_CONSUMING_EVENTS` 生效，或在 RFC-008 的事件校验里拒绝非随机事件携带 `rngAfter`。
- **C-21**：第一个 modifier 落地前由 `/manage-changes` 裁决。
- **文档**：本轮已同步 `RFCS.md` v2.16 / `README.md` v0.11 / `TEST-STRATEGY.md` v1.7；C-22 已登记在 `RFCS.md` §8.1。

#### 6.4 没有发现问题的部分（避免只列负面）

- B-R2-2 用临时目录锁「接线」而不是锁「helper」，方向正确；一层扫描的反向探针现在确实会红。
- B-R2-1 在 helper 边界归一化，选择兼容 `\\` 与 `/` 两种分隔符，使这条逻辑在 macOS 上也能被单元测试覆盖。
- N9 的改写让 `step` 的 `modifiers` 参数真正进入结算链路，而不是只断言参数被传入。
- 覆盖率数字与 RFC §8.4 / §8.5 完全一致（98.01% 行 / 95.23% 分支），`init.ts` 的 80% 分支是已知且可解释的防御分支。
- 引擎运行时自 Round 1 以来没有变化（`git diff d8a4866..HEAD -- src/` 为空），Round 1/2 对 ARCH / DATA / SEC 的正面结论仍然成立。

---

**Round 3 评审证据**：本文件中的命令输出来自 2026-11-18 的本会话实跑；17 个变异探针均在 `git checkout` / 删除临时文件后恢复，探针恢复后 `git status --short` 只有本轮四份文档；复跑 `pnpm typecheck` 为 0、`pnpm test` 为 `29 files / 209 tests passed`。`FEATURES.md` 没有 Status 列，因此本轮不修改功能状态；`RFCS.md` 的 RFC-002 状态已置 `Reviewed`。
