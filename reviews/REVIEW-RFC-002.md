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
