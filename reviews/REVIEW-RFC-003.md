# RFC-003 评审 · 板子分配、夜晚阶段与严格规则

> **评审会话**：新会话（未参与 RFC-003 的实现；本会话只读仓库文件、跑命令、做临时探针）
> **日期**：2026-11-18
> **分支 / HEAD**：`rfc/001-project-scaffold-and-shared-contracts` / `cb6582e`（评审开始时工作树 clean；本评审只新增本文件并修改 `RFCS.md` 的状态/冲突）
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-18

### 0. STEP 0 · 实际执行结果

环境：Node `v22.22.2`、pnpm `10.33.0`。工作树在评审开始时 clean（`git status --short` 无输出）。

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

$ pnpm build
vite v8.3.8 building client environment for production...
✓ built in 74ms
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
✓ built in 10ms
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
EXIT 0

$ pnpm test
 Test Files  35 passed (35)
      Tests  270 passed (270)
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[pnpm] ELIFECYCLE  Command failed with exit code 1.
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1          # C-5 登记的临时偏离，预期如此

$ pnpm exec vitest run --project unit --coverage
 Test Files  28 passed (28)
      Tests  236 passed (236)

 % Coverage report from v8
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   97.24 |    94.36 |     100 |   97.05 |
 engine/apply.ts  |   90.56 |    88.63 |     100 |   90.38 | 91,98,127,130,162
 engine/init.ts   |      90 |       75 |     100 |      90 | 39
 engine/rng.ts    |   96.15 |       90 |     100 |      96 | 73
 engine/night.ts  |   97.64 |    94.73 |     100 |   97.56 | 251,282
-----------------|---------|----------|---------|---------|-------------------
EXIT 0
```

结论：**五条门禁全绿，覆盖率与 RFC-003 §8.7 的转录一致**（97.24 / 94.36 / 100 / 97.05），270 个用例全部通过。下面所有判断都基于实际运行，而不是只读代码。

**未执行的检查**：

- 没有做干净检出后的 `pnpm install --frozen-lockfile`；本会话基于现有 `node_modules`。`tests/meta/commands.test.ts` 已实际跑过 `typecheck` / `lint` / `unit` / `build` / `pnpm start`（3999 端口探活），构建与启动链路不是纯阅读判断。
- 没有在 Windows 上复跑；本 RFC 没有新增路径拼接或大小写敏感代码，但跨平台回归仍以 CI / 另一平台复核为准。
- Playwright 没有用例（RFC-012 起生效），`test:e2e` 的 skipped 是预期行为。

**临时探针**：下面 §8 的变异探针与 §11 的 bug 复现都使用临时测试文件，跑完即删除；代码工作树没有留下改动（评审产物只有本文件与 `RFCS.md` 的状态/冲突更新）。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-003 只交付规则引擎的夜间部分，没有 UI、HTTP 路由、SSR 或浏览器交互，因此本评审按 game 的「核心循环 / 状态机 / 确定性 / 隐藏信息边界」检查，并显式跳过以下检查：

| 跳过的检查 | 为什么本 RFC 不适用 |
|---|---|
| 响应式布局、无障碍、浏览器兼容、首屏性能 | RFC-003 无 UI；这些归 RFC-012 / RFC-016 |
| 认证、CSRF、XSS、注入 | RFC-003 无 HTTP 端点、无客户端渲染；服务端校验归 RFC-008 / RFC-011 |
| 数据库 / 网络 I/O、缓存 | 引擎是纯函数；本 RFC 没有 I/O |
| 平台认证、帧预算、手柄输入 | PRD Product Type 已显式声明不适用 |

隐藏信息边界**是**本 RFC 适用的检查，见 §5 的 B2。

### 2. 验收标准逐条核对

> 判定依据：实际跑过的测试 + 读测试断言。`PASS*` 表示行为正确但测试没有锁住 AC 的字面要求。

| AC | 证据 | 结果 | 备注 |
|---|---|---|---|
| 1 | `tests/engine/deal.test.ts:25-44` · 50 个固定种子，计数恒为 3/1/1/1/3 | **PASS** | 固定种子，无随机失败 |
| 2 | `deal.test.ts:46-66` + `tests/engine/events.test.ts:103-146` · 同 seed 两次发牌一致；`GAME_STARTED.payload.roles` 与 state 同源 | **PASS** | AC-2 的事件侧由 `events.test.ts` 锁住，不是 `deal.test.ts:59-65` 单独证明的 |
| 3 | `deal.test.ts:68-88` · 50 个种子里玩家拿到狼 / 神 / 民三类 | **PASS** | 只验证「三类都出现过」，与 AC 字面一致 |
| 4 | `night.test.ts:25-42` · `WOLF_KILL_CHOSEN.visibleTo === 'wolves'`，state 记下刀口 | **PASS** | |
| 5 | `night.test.ts:57-110` · `TARGET_NOT_ALIVE` / `WOLF_KILL_WOLF` / 非狼 `NOT_YOUR_TURN` | **PASS\*** | 只有 `TARGET_NOT_ALIVE` 断言了「状态除 seq 外不变」；`WOLF_KILL_WOLF` 只断言了 code（`night.test.ts:75-86`），AC-5 要求的第二种情况没有锁住 |
| 6 | `seer.test.ts:30-77` · 三种目标、`visibleTo === 'seer'`、result 与阵营一致、state 不含结果 | **PASS** | |
| 7 | `witch.test.ts:14-44` · 自救 `WITCH_SELF_SAVE`；毒自己合法 | **PASS** | |
| 8 | `witch.test.ts:46-87` · 第二次用药 `PHASE_MISMATCH`（AC 已修正）；非女巫 `NOT_YOUR_TURN` | **PASS** | 修正经用户批准，见 RFC-003 §8.3 |
| 9 | `witch.test.ts:89-143` · 构造的次夜状态 → `POTION_ALREADY_USED`；用药后 `potionsUsed.heal` 为 true | **PASS\*** | 标题写「用药后 replay 仍在」，但测试**没有调用 `replay`**；见 §7 N3 |
| 10 | `witch.test.ts:145-162` · 解药命中刀口：无 `PLAYER_DIED`，刀口存活 | **PASS** | |
| 11 | `witch.test.ts:164-241` · 解药未命中：只有刀口出局；毒药另加一条 | **PASS** | 没有覆盖「毒药目标 == 刀口」的合法路径，见 B1 |
| 12 | `death-resolve.test.ts:23-106` · 被刀 hunter 进入 `NIGHT_HUNTER_SHOOT`；`source: 'role'`、order 200；带走最后一狼 → 第二次判定好人胜 | **PASS** | 第二次判定在 `hunterShoot` 中使用的是**当前 state**（已含本夜死亡），探针确认正确 |
| 13 | `death-resolve.test.ts:108-143` · 被毒 hunter 不进开枪阶段、无 `HUNTER_SHOOT` | **PASS** | |
| 14 | `death-resolve.test.ts:145-189` · 被刀 hunter 是最后一个神 → 同一步内 `GAME_ENDED(all-gods-dead)`、`phase === 'FINISHED'`、无开枪 | **PASS** | §8.3 的 AC-14 补充断言已落地 |
| 15 | `death-resolve.test.ts:222-278` · 解药 order < 击杀 order < 开枪 order；夜晚效果 source 全为 `role`；效果存活集与事件集一致 | **PASS** | 最后一条只覆盖「无女巫用药、只有狼刀」的路径 |
| 16 | `night.test.ts:112-144` · 夜晚结束进 `DAY_ANNOUNCE`；对该阶段提交 VOTE / SPEECH_SKIP → `Rejected(PHASE_MISMATCH)` | **PASS** | AC 已按 RFC-002 §2.3 的机械判据修正 |

**16/16 按字面通过**。但这不是「RFC 可以合并」的证据：

1. **B1**：一个合法的 `WITCH_ACT`（毒狼刀目标）会让引擎抛 `InvalidEventStreamError`，不在任何 AC 的覆盖面上（§11）。
2. **B2**：公开相位事件泄漏隐藏信息，AC 没有检查事件流的可见性组合（§5）。
3. **B3**：RFC-003 新增 / 接管的 6 个事件 payload 没有 Zod schema，违反 RFC-001 的契约（§3.3）。
4. 测试计划 `TEST-STRATEGY.md:162` 说 C-18 的整 state 比较「RFC-003 起加派生字段会自动覆盖」；实际序列**没有成功执行任何夜间 action**（见 §8.4），这句话不成立。

### 3. RFC ADHERENCE

**Verdict: NEEDS WORK**

#### 3.1 已记录的偏离（D-1 ~ D-9）：大部分成立

读了 RFC-003 §8.2 的九项决定：D-2（`NIGHT_RESOLVE` 瞬态）、D-3（`PLAYER_DIED` 夜间 `server`）、D-4（`night` / `potionsUsed` 派生字段）、D-5（`NOT_YOUR_TURN` 的机械含义）、D-6（首狼先到先得）、D-7（`deal.ts` / `deck` 参数）、D-8（`reject.ts`）、D-9（测试拆 6 个文件）都被实现与测试覆盖，理由成立。

**例外是 D-1 的 `visibleTo: 'public'`**：机制本身成立（相位推进确实需要一个事件），但可见性选择造成了信息泄漏，见 B2。这不是「实现没按 RFC 做」，而是「按 RFC 做了，RFC 的选择与更高权威的 PRD / FR-9 冲突」。

D-3 的理由对**夜间死亡**成立：死因不应公开，公开播报由 RFC-004 的 `DAY_STARTED.diedLastNight` 承担。提醒 RFC-004：`PLAYER_DIED` 的可见性是**逐事件**选择的，`PLAYER_DIED(cause: 'lynch')` 不能照抄 `server`，否则 RFC-013 的事件面板没有公开的放逐结果。这不是 RFC-003 的代码缺陷，但应在 RFC-004 开工时显式写进它的实现说明。

#### 3.2 B1（阻塞）· 合法输入触发引擎崩溃

**位置**：`src/engine/resolve/deaths.ts:71-93`、`src/engine/phases/night.ts:80-86`、`src/engine/apply.ts:124-131`。

`resolveNight` 在狼刀目标与毒药目标**同为一人**时会向 `deaths` 推入两条记录：

```ts
if (killTarget !== undefined && !killCancelled) {
  deaths.push({ seat: killTarget, cause: 'wolf' });
}
if (poisonTarget !== undefined) {
  deaths.push({ seat: poisonTarget, cause: 'poison' });
}
```

`finishNight` 按 `resolution.deaths` 逐条产出 `PLAYER_DIED`；第二条 `PLAYER_DIED` 折叠时 `applyPlayerDied` 看到该座位已经 `alive === false`，抛 `InvalidEventStreamError: 座位 N 已经出局，PLAYER_DIED 重复`。

这不是数据损坏，而是**合法 action**：女巫完全可以选择毒药，并把毒药指向狼刀的目标。复现见 §11.1。若该目标恰好是猎人，还叠加一个 RFC / RULES 没有裁决的分支：§2.3 第 6 步说「被狼刀 → 进开枪阶段」「被毒杀 → 不进」，两个条件同时为真。

**为什么是阻塞**：引擎在合法输入上崩溃，违反 RFC-003 §2.3 的死亡结算要求；FEATURES F8 AC-4 要求「未裁决的分支必须显式失败」，而当前失败是**内部不变量错误**，不是一条对规则歧义的明确失败；ARCH-11 也要求未裁决分支抛明确错误。

**修法（需要用户裁决，不能由评审静默选择）**：

1. 在 `resolveNight` 里按座位去重，**只产生一条 `Death`**；这是无论规则怎么裁都成立的。
2. 对猎人决定死因优先级：若目标同时被狼刀和毒杀，猎人是否开枪？这取决于规则解释，必须进 `RULES.md` §6 或由 `/manage-changes` 裁决。
3. 裁决前，至少把这条路径变成显式的「未裁决规则」错误（例如一个新的 `UnadjudicatedRuleError`），而不是让合法输入撞上 `InvalidEventStreamError` 的不变量。
4. 补一条测试：`killTarget === poisonTarget`，断言 1 条 `PLAYER_DIED`、状态只死一次；若目标为 hunter，断言已裁决的开枪行为。

#### 3.3 B3（阻塞，契约级）· RFC-003 的事件 payload schema 缺失

**位置**：`src/shared/events.ts:103` 的注释、`src/shared/schemas.ts:142` 的归属说明、`src/shared/schemas.ts:159-162` 的 `PAYLOAD_SCHEMAS`。

- `src/shared/events.ts:103`：**「新增成员要同时更新 `src/shared/schemas.ts` 里的 payload schema。」**
- `RFCs/RFC-001...:193`：**「`src/shared/schemas.ts` 为每个 payload 导出对应的 Zod schema。」**
- `RFCs/RFC-001...:339`（C-10）：事件 payload 的 schema **由拥有该 payload 的 RFC 追加**。

RFC-003 接管 / 新增的 payload 有：

| 事件 | 拥有者 | 当前 schema |
|---|---|---|
| `WOLF_KILL_CHOSEN` | RFC-003 | **缺失** |
| `SEER_CHECKED` | RFC-003 | **缺失** |
| `WITCH_POTION_USED` | RFC-003 | **缺失** |
| `PLAYER_DIED` | RFC-003 | **缺失** |
| `HUNTER_SHOOT` | RFC-003 | **缺失** |
| `PHASE_CHANGED` | RFC-003（新增） | **缺失** |

`PAYLOAD_SCHEMAS` 仍只有 `GAME_STARTED` 与 `REJECTED`。这不是「没有运行时影响」就可以不管的细节：它是 RFC-001 的显式契约，也是 RFC-008 的入站 / 出站校验要用的表面。RFC-002 按同一规则补了 `GAME_STARTED` / `REJECTED`，RFC-003 没有补它自己的。

顺便：`GAME_ENDED` 是 RFC-003 实际产出的事件，但 RFC-002 也没有登记它的 schema；归属至少要在实现说明里说清（归 RFC-002/003 哪个），不要留成「谁都没做」。

**建议**：为上述 6 个事件（以及 `GAME_ENDED`，如果本 RFC 认领）在 `schemas.ts` 中加 schema，并在 `events.test.ts` / 新的 schema 测试里做正反两个用例。`PHASE_CHANGED` 用 `z.enum(PHASES)`，`PLAYER_DIED.cause` 用四值枚举，`HUNTER_SHOOT.target` 用 `seatIdSchema.nullable()`。

#### 3.4 文档级偏差：§5 的 AC-8 / AC-16 仍是旧措辞

RFC-003 §5 的 AC-8（`NOT_YOUR_TURN`）与 AC-16（`UnhandledTransitionError`）仍保留原文；修正只写在 §8.3（`RFCs/RFC-003...:171-172`）。虽然 §8.3 有用户批准记录，但**验收标准正文**才是后续 RFC / 评审最先读到的契约。RFC-001 的 C-15/C-16 修正是直接改了 RFC-001 正文；本 RFC 应同样把 §5 的 AC-8 / AC-16 改成修正版，或在 §5 加一行指向 §8.3 的显式「本条已被 §8.3 修正」。这是非阻塞文档问题。

#### 3.5 功能归属：F1 / F3 / F8 与 RFC-003 的范围不完全对齐

`RFCS.md:42` 把 F1 / F3 / F8 归给 RFC-003，但：

- **F1** AC-1（点击开始 ≤3 秒、身份卡）是 RFC-012，AC-5（同会话连续开局不残留）是 RFC-008。
- **F3** AC-1 的「狼队内部先协商后只提交一个击杀目标」依赖 RFC-005 的夜聊；本 RFC 的 D-6 明确「先到先得，不做表决」。
- **F8** AC-3 的「被放逐时可开枪」是 RFC-004 的 `DAY_HUNTER_SHOOT`。

RFC-003 §6 已显式把这些划出范围，代码没有缺陷；问题在**功能映射**：若只在 RFC-003 通过后把 F1/F3/F8 当成全部实现，会漏掉 RFC-004/005/008/012 的剩余验收。已作为 C-25 登记到 `RFCS.md` §8.3，建议 `/manage-changes` 或更新功能映射。

#### 3.6 未记录的实现选择：effect 列表只用于胜负预览

`src/engine/phases/night.ts:89` 与 `:350` 把 `resolution.effects` / `shot.effects` 应用到 state 上，但**只用于 `checkWin` 预览**；真正写入状态的仍是 `PLAYER_DIED` 事件（`step` 折叠）。`HandlerContext.appliers`（`step.ts:40-59`）没有被夜间 handler 使用，`DEFAULT_APPLIERS`（`step.ts:144`）仍是空表，而 handler 直接 hardwire `DEATH_APPLIERS`。

这不是当前可观察行为的错误（探针确认 effect 集与事件集一致），但它与 ARCH-5 的「产出显式效果列表再统一应用」有张力：效果列表不是最终状态变动的路径，只是一次临时预览。未来引入 modifier 时，这条双路径很容易分叉。至少应在 RFC-003 §8 记一笔「effects 仅用于胜负预览，events 是唯一权威」；更好的做法是让夜间 handler 统一从 `context.appliers` 取表，并把 `DEATH_APPLIERS` 注册进默认配置。

### 4. RULES COMPLIANCE

**Verdict: NEEDS WORK**

| 规则 | 结果 | 证据 / 说明 |
|---|---|---|
| ARCH-1 | **PASS** | `tests/dependency-direction.test.ts` 5 例通过；`src/engine/` 只 import `@shared` 与自身 |
| ARCH-3 | **PASS** | `tests/engine/serialization.test.ts` 5 例；`night` / `potionsUsed` 都是纯数据 |
| ARCH-4 | **PASS** | `step` 的 `ts` 来自 action；测试 `events.test.ts:69-74` 锁住 |
| ARCH-5 | **NEEDS WORK（记录缺口）** | 见 §3.6：效果列表存在，但最终状态由事件而非效果列表写入；`context.appliers` 未使用 |
| ARCH-6 | **PASS** | `resolveNight` / `resolveHunterShot` 的所有效果 `source === 'role'`；AC-15 与变异 M6 锁住 |
| ARCH-11 | **NEEDS WORK（B1）** | 狼刀 + 毒药同目标是一个 RULES §6 未裁决的分支；当前以内部数据损坏错误失败，不是明确的规则错误 |
| DATA-1 / DATA-2 | **PASS** | `seq` 严格递增、`ts` 为数字、`PHASE_CHANGED` 已进 `GAME_EVENT_TYPES`；`events.test.ts` / `shared/events.test.ts` 覆盖 |
| DATA-3 | **PASS（代码）/ 测试缺口** | 探针跑了 heal / poison 两整夜，`replay(events)` 与实时 state 深度相等；但套件里的 `replay-parity.test.ts` 没有覆盖夜间派生字段（§8.4） |
| DATA-4 / DATA-5 | **PASS** | `rng.ts` 的 mulberry32 + `shuffle`；`rng.test.ts` 递归扫描无 `Math.random`；发牌用 `seed` |
| TEST-1 | **NEEDS WORK** | 16 条 AC 都有测试，但 AC-5 只锁了一半、AC-9 的标题名不副实、B1 没有测试；见 §2 / §8 |
| TEST-2 | **PASS** | 行 97.05% ≥ 90%，分支 94.36% ≥ 85%；`tests/meta/coverage.test.ts` 通过 |
| TEST-3 | **PASS** | `determinism.test.ts` 4 例；同 seed 同序列事件流一致 |
| TEST-4 | **PASS** | `tests/setup/no-network.ts` 把 `fetch` 换成抛错桩；`no-network.test.ts` |
| STYLE-6 | **PASS** | `src/` 最大文件 `night.ts` 385 行 < 400；无注释掉的代码；无 `TODO` / `FIXME` |
| DOC-1 | **NEEDS WORK** | D-1 ~ D-9 记录充分；但 B1 的未裁决分支、B3 的 schema 缺失、§3.6 的 effect/event 双路径都没有记录 |
| DOC-2 | **PASS** | 本 RFC 未新增依赖 |

### 5. SECURITY

**Verdict: FAIL**

#### 5.1 B2（阻塞）· `PHASE_CHANGED` 公开泄漏隐藏身份 / 死因

**位置**：`src/engine/phases/night.ts:76-77`、`:101-108`、`:120-128`、`:357-361`；`src/engine/step.ts:126-133`。所有相位事件都是 `visibleTo: 'public'`。

这不是「阶段名本身敏感」的问题，而是**跳过阶段**会泄漏隐藏信息：

1. **预言家已出局 → 公开事件出现 `NIGHT_WOLVES → NIGHT_WITCH`**，没有 `NIGHT_SEER`。任何观察者（玩家、AI）都能推断「预言家已经死了」。探针复现见 §11.2。
2. **女巫已出局 → 公开事件从 `NIGHT_SEER → NIGHT_RESOLVE` 或直接到 `DAY_ANNOUNCE`**，同理暴露「女巫已经死了」。
3. **猎人被毒杀 → `NIGHT_RESOLVE → DAY_ANNOUNCE`；猎人被狼刀 → `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT`。** 公开相位事件直接泄漏「猎人的死因是狼刀还是毒药」——这正是 D-3 想用 `PLAYER_DIED: 'server'` 隐藏的东西。

为什么它会进入 AI 上下文：`RFCs/RFC-007...:50` 的 `publicEvents` 定义是「`isVisibleTo` 为 true 且 `visibleTo === 'public'`」，`RFC-007` AC-8/AC-9 要求投影覆盖全部可见事件。只要这些事件是 public，RFC-007 会把它们原样放进每个 AI 的上下文。

为什么它违反更高权威：

- `PRD.md` User Journeys 第 4 步：「进入第一夜 → 玩家闭眼（**只看到「天黑了」**）」。
- `FR-9`：「AI 的决策与发言只能使用该 AI 视角可见的信息……**严禁注入隐藏身份、他人夜间行动或未公开结果**」。
- `D17`：「AI 严格限制在各自视野内，绝不作弊」。

按权威顺序 `PRD > FEATURES > RULES > RFC`，这里 PRD 与 FR-9 优先于 RFC-003 的 D-1。D-1 的「机制」可以保留（相位事件确实需要），但**可见性不能是 public**。

**候选修法（需要用户确认，因为 D-1 已记录为「用户批准」）**：

1. 把夜间 `PHASE_CHANGED` 改为 `server`（或新增一个只在服务端可见的相位可见性）；公共侧只保留 `DAY_STARTED`（RFC-004）这类专门的公开事件。
2. 如果客户端确实需要「天黑了 / 天亮了」的提示，由 `project()` 的 `phase` 字段（RFC-007 已有）或 RFC-004 的公开事件承担，不要用「狼人 → 预言家 → 女巫」的细粒度相位。
3. 加三条回归测试：死预言家、死女巫、被毒猎人，断言**没有任何 public 事件**揭示跳过 / 死因。

**已作为 C-23 登记到 `RFCS.md` §8.3。**

#### 5.2 已做对的部分（不能因为 B2 被忽略）

- `GAME_STARTED` 的 `visibleTo: 'server'`（`events.test.ts:140-142`），全员身份不公开。
- 三条夜间私有事件：`WOLF_KILL_CHOSEN: 'wolves'`、`SEER_CHECKED: 'seer'`、`WITCH_POTION_USED: 'witch'`，各有测试；变异 M1/M2 会让测试变红。
- `REJECTED` 的可见性是 `self:<提交者>`（`night.test.ts:102-109`）。
- 夜间 `PLAYER_DIED` 的 `visibleTo: 'server'`（`apply` 侧不公开 `cause`）。
- 没有把模型原始响应、密钥或完整 state 写进日志 / 错误；本 RFC 没有网络层，SEC-1/SEC-7 在 RFC-006/008 才落地。

#### 5.3 显式跳过的安全检查

- **认证 / 授权**：本 RFC 没有请求、会话或资源；N/A。
- **XSS / CSRF / 注入**：本 RFC 没有客户端渲染或 HTTP 入口；N/A。`ActionSchema` 的运行时校验属于 API 边界（RFC-008 / RFC-011），本 RFC 的 `step` 直接收类型化 `Action`，这是有意的引擎边界，不是漏洞。
- **LLM 原始响应泄漏**：RFC-006 的职责；本 RFC 不调用 LLM。

### 6. PERFORMANCE

**Verdict: N/A**

本 RFC 交付纯函数引擎，没有数据库、网络、缓存或 UI；所有循环的规模由 9 个座位 / 固定板子界定，不存在 N+1 或无界数据获取。唯一值得下游注意的是 RFC-003 §8.8 已记录的 `PHASE_CHANGED` 事件量（每夜 4–6 条），归 RFC-008 的存储策略评估；本 RFC 没有性能缺陷。

### 7. MAINTAINABILITY

**Verdict: NEEDS WORK**

#### 7.1 做得好的部分

- `phases/night.ts` 的注释把 D-1/D-2/D-5 和三条夜间规则讲清楚；`resolve/deaths.ts` 的「解药通过不产生击杀效果抵消」与 RUL-8 直接对应；`finishNight` / `advanceOrFinish` / `nightParams` 的分层让 AC-14 的那个「刀口尚未折叠」的坑有解释。
- `queries.ts` 的职责单一，`tests/engine/queries.test.ts` 覆盖了「只数存活」与「含已出局」的差异。
- `tests/fixtures/night.ts` 沿真实路径推进 + `makeNightState` 构造残局的组合，比手改状态更可靠。
- 文件规模、命名、具名导出、无 `any` / 非空断言，均符合 STYLE。

#### 7.2 发现

**N5 · `hunterShoot` 里的 `deathCauseOf` 循环是空操作**

`src/engine/phases/night.ts:344-348`：

```ts
for (const effect of shot.effects) {
  deathCauseOf(effect);
}
```

返回值被丢弃；真正写进事件的是 `death.cause`（`resolveHunterShot` 里硬编码为 `'shoot'`），循环没有把两者绑定。注释说「顺手用它把效果的 cause 与事件里的 cause 绑在一起」，但实际没有。删掉循环，或者在 `resolveHunterShot` 里用同一个 `cause` 常量同时构造 effect 与 death；后者更符合注释意图。非阻塞。

**N6 · effect applier 的配置没有被夜间路径使用**

见 §3.6。`HandlerContext.appliers` 在 `step.ts:40-59` 被传入，但 `night.ts:89` / `:350` 直接用 `DEATH_APPLIERS`；`DEFAULT_APPLIERS` 为空。现在没有 modifier，所以无可观察影响；但未来一引入 modifier，夜间效果会绕过注入的 applier 表。建议在 RFC-003 §8 记录这个决定，或把 `DEATH_APPLIERS` 注册为默认并改用 `context.appliers`。

**N1 · `replay-parity` 没有覆盖夜间派生字段**

`tests/engine/replay-parity.test.ts:23-36` 的 `playSequence` 用 seed `31337`，先 `START`，再让 seat 1 对 seat 2 下刀。探针确认 seed 31337 的 seat 1 是 **hunter**，所以 `WOLF_KILL` 被拒（`REJECTED`），随后 `VOTE` 也被拒；这个序列**从未成功进入夜间逻辑**，`night` / `potionsUsed` 从未被写入。测试确实比较整个 state，但比较的是两个「没有派生字段」的状态。

这与 `TEST-STRATEGY.md:162` 和 `replay-parity.test.ts:19-20` 的「RFC-003 起加派生字段会自动覆盖」矛盾。**建议**：把 `playSequence` 改成「`START` → 合法 `WOLF_KILL` → `SEER_CHECK` → `WITCH_ACT`（heal 或 poison）」，并保留一个拒绝事件；再断言 `replay(events)` 与实时 state 深度相等。§11.3 的探针证明实现本身能通过这样的序列，所以这是测试缺口，不是代码 bug。

**N2 · AC-5 的第二条「状态不变」断言缺失**

`night.test.ts:75-86` 只断言 `WOLF_KILL_WOLF` 的 code；`TARGET_NOT_ALIVE` 才有 `expect({ ...after, seq: state.seq }).toEqual(state)`。AC-5 明确说「两种情况状态除 seq 外不变」。建议把同一断言抽成 helper，在两个用例里都调用。

**N3 · AC-9 的 replay 测试名不副实**

`witch.test.ts:128-142` 的标题是「药水位确实由事件折叠而来：用药后 replay 仍在」，但只检查 `result.state.potionsUsed?.heal`，没有 `replay`。虽然 `step` 自己折叠事件，`applyEvent` 是唯一写入口，结构上不太可能绕过；但这条测试没有证明「replay 后仍在」，应补 `replay(result.events)`（以及从 `START` 起的完整事件流）断言。与 N1 可以合并成一个「完整一夜的 replay 一致性」测试。

**N7 · 防御分支未测**

覆盖率显示 `apply.ts:91,98,127,130,162` 未覆盖：`PHASE_CHANGED.from` 不匹配、`to === NIGHT_WOLF_CHAT` 的 `delete night`、`PLAYER_DIED` 不存在座位 / 重复、`GAME_STARTED` 缺角色。这些分支要么是数据损坏保护，要么是 RFC-004 的新夜入口；至少 `from` 不匹配与重复 `PLAYER_DIED` 应有直接用例。B1 修好后，「重复 `PLAYER_DIED`」还应保留一条**真正损坏事件流**的负向用例，避免把合法的同目标死亡误判为损坏。

**N8 · 文档同步**

- `README.md:11` 仍写「209 个用例全绿」「2 个 `Reviewed`、14 个 `Not started`」「覆盖率 98.0 / 95.2」；实际是 270 个用例、2 个 `Reviewed` + 1 个 `Changes requested` + 13 个 `Not started`（本评审前是 1 个 `Implemented`）、97.24 / 94.36。`README.md:18` 的 270 与 `:38` 的 Implemented 已经是新值，同一文件内自相矛盾。
- `RFC-003 §8.6` 的 AC-5 证据写「两种情况状态除 seq 外不变」，但测试只覆盖了一种（见 N2）；AC-9 的测试标题写「用药后 replay 仍在」，实际没有 replay（见 N3）。文档的「验收逐条」应与测试实际断言一致。
- `RFC-003 §5` 的 AC-8 / AC-16 旧措辞（见 §3.4）。
- `TEST-STRATEGY.md:3` 仍引用 `RFCS.md` v2.17；本评审把 RFCS 升到 v2.18（状态 + C-23 ~ C-25），这一行需要同步（或在下一次实现提交时一起改）。

### 8. 测试有效性：变异探针与未覆盖路径

> 目的：验证「套件绿」不是「测试没断言」。每个探针改一处源码、跑相关测试、再恢复；全部探针结束后 `git status --short` 为空，完整 unit 套件 236 例重新全绿。

| # | 变异 | 相关测试 | 结果 |
|---|---|---|---|
| M1 | `WOLF_KILL_CHOSEN.visibleTo` 从 `wolves` 改成 `public` | `night.test.ts` | **变红**：1 failed / 13 passed；AC-4 的可见性断言有效 |
| M2 | `SEER_CHECKED.visibleTo` 从 `seer` 改成 `public` | `seer.test.ts` | **变红**：1 failed / 5 passed；AC-6 有效 |
| M3 | 解药不再抵消狼刀（`killCancelled = false`） | `witch.test.ts` + `death-resolve.test.ts` | **变红**：2 failed / 21 passed；AC-10/AC-15 有效 |
| M4 | 任何 hunter 死亡都进 `NIGHT_HUNTER_SHOOT`（忽略毒杀） | `death-resolve.test.ts` | **变红**：1 failed / 11 passed；AC-13 有效 |
| M5 | 删掉第一次 `checkWin`（开枪前不判胜负） | `death-resolve.test.ts` | **变红**：1 failed / 11 passed；AC-14 有效 |
| M6 | 猎人开枪的 order 从 `DEATH_TRIGGER` 改到 `DEATH` | `death-resolve.test.ts` | **变红**：2 failed / 10 passed；AC-15 有效 |

**结论**：与 AC 直接相关的关键行为（私有可见性、解药抵消、毒杀不开枪、胜负先于开枪、效果顺序）确实被测试锁住，这不是「测试只是跟着实现写」。但：

- **B1 不会被现有套件发现**：没有 `killTarget === poisonTarget` 的用例，重复 `PLAYER_DIED` 分支在覆盖率报告里是「未覆盖」而不是「预期抛错」。
- **C-18 的整 state 比较没有覆盖 RFC-003 的派生字段**（N1），所以「replay 能重建 `night` / `potionsUsed`」这条关键契约目前只有代码结构上的保证，没有回归锁。
- **B2 的可见性组合没有测试**：现有测试只逐条断言单个事件的 `visibleTo`，没有断言「死预言家 / 死女巫 / 被毒猎人时，公开事件流不泄漏跳过或死因」。
- **AC-5 的一半、AC-9 的 replay 名称**（N2/N3）是断言缺口，不是代码错误。

### 9. 总体评估

**Overall Risk Level: High**

**Summary**：RFC-003 的核心夜间链路实现得扎实：16 条 AC 按字面全部通过，门禁全绿且覆盖率高于阈值，六个关键变异探针都能让测试变红。但有两个不能在合并前保留的问题：一个合法 action（毒药指向狼刀目标）会让引擎抛内部数据损坏错误；公开的 `PHASE_CHANGED` 会把「预言家 / 女巫是否存活」和「猎人死因」泄漏给所有观察者，而 RFC-007 的投影会把 public 事件原样放进 AI 上下文。此外，RFC-003 接管的 6 个事件 payload 没有 Zod schema，违反 RFC-001 的显式契约。

**Blocking Issues**：

1. **B1 · 合法输入崩溃**：`killTarget === poisonTarget` 时 `resolveNight` 产出两条 `Death`，`finishNight` 产出两条 `PLAYER_DIED`，`applyPlayerDied` 抛 `InvalidEventStreamError`。必须先按座位去重，并由用户裁决猎人同时被狼刀 / 毒杀时是否开枪；补测试。`RFCs/RFC-003...` §2.3、`src/engine/resolve/deaths.ts:71-93`、`src/engine/phases/night.ts:80-99`、`src/engine/apply.ts:124-131`。
2. **B2 · 公开相位事件泄漏隐藏信息**：`PHASE_CHANGED` 在所有夜间转移上都是 `public`；跳过 `NIGHT_SEER` / `NIGHT_WITCH` 暴露对应角色已出局，`→NIGHT_HUNTER_SHOOT` 暴露猎人死因。与 `PRD.md` User Journeys 第 4 步「只看到天黑了」和 `FR-9` 冲突；RFC-007 的 `publicEvents` 会把它带进 AI 上下文。需把夜间相位改为 `server`（或等价过滤），并加死预言家 / 死女巫 / 被毒猎人的回归测试。`src/engine/phases/night.ts:76-77,101-108,120-128,357-361`、`src/engine/step.ts:126-133`、`RFCS.md` C-23。
3. **B3 · 事件 payload schema 缺失**：`WOLF_KILL_CHOSEN` / `SEER_CHECKED` / `WITCH_POTION_USED` / `PLAYER_DIED` / `HUNTER_SHOOT` / `PHASE_CHANGED` 都没有对应 Zod schema；`PAYLOAD_SCHEMAS` 只有 `GAME_STARTED` / `REJECTED`。违反 RFC-001 §2.3 的「每个 payload」与 `src/shared/events.ts:103` 的扩展规则；补 schema + 正反用例，并说明 `GAME_ENDED` 的 schema 归属。`src/shared/schemas.ts:142,159-162`。

**Improvement Suggestions**（非阻塞，按优先级）：

1. **N1**：把 `replay-parity.test.ts` 的序列改成合法的一整夜（含 `WITCH_ACT`），锁住 `night` / `potionsUsed` 的 replay 重建；同步修正 `TEST-STRATEGY.md:162` 的「自动覆盖」说法。
2. **N2**：AC-5 的 `WOLF_KILL_WOLF` 补「除 seq 外状态不变」断言。
3. **N3**：AC-9 的 replay 测试真正调用 `replay`（或与 N1 合并）。
4. **N4**：更新 RFC-003 §5 的 AC-8 / AC-16 正文，或加「已被 §8.3 修正」的显式指针。
5. **N5**：删除 `hunterShoot` 里 `deathCauseOf` 的空循环，或让 effect 与 death 共用一个 `cause` 常量。
6. **N6**：统一 `DEATH_APPLIERS` 与 `context.appliers` / `DEFAULT_APPLIERS` 的关系，或把「effects 只用于胜负预览」写进 RFC-003 §8。
7. **N7**：补 `applyPhaseChanged` 的 `from` 不匹配、`PLAYER_DIED` 不存在座位 / 重复（作为真正的损坏流）负向用例。
8. **N8**：同步 `README.md:11` 的 209 / 2 Reviewed / 14 Not started / 98.0 / 95.2，和 `RFC-003 §8.6` 的 AC-5 / AC-9 证据。
9. **N9**：RFC-004 开工时明确 `PLAYER_DIED(cause: 'lynch')` 是 `public`（放逐结果要进 RFC-013 的事件面板），不要把夜间 `server` 的可见性照搬到白天。
10. **N10**：`WITCH_SELF_SAVE` 检查在 `POTION_ALREADY_USED` 之前；若「已用解药 + 对自己用解药」应返回 `POTION_ALREADY_USED`，需要调整优先级并加测试；当前 RULES 未规定，属可选改进。

### 10. 已登记的 Open conflicts 与状态

按 `AGENTS.md` 硬规则 7 与 `review-rfc` 的要求，以下冲突已写入 `RFCS.md` §8.3：

| ID | 冲突 | 状态 |
|---|---|---|
| **C-23** | `PHASE_CHANGED` 公开泄漏预言家 / 女巫存活与猎人死因；与 PRD User Journeys 第 4 步 / FR-9 冲突 | **开放，阻塞 RFC-003** |
| **C-24** | RULES §6 未裁决「狼刀目标 == 毒药目标时，猎人是否算作被毒杀（是否开枪）」；RFC-003 §2.3 的集合语义只要求该席位出局一次，但 `resolveNight` 产出两条 `Death` / `PLAYER_DIED`，`applyPlayerDied` 把第二次出局当作数据损坏，合法 action 触发引擎崩溃 | **开放，阻塞 RFC-003** |
| **C-25** | FEATURES F1 / F3 / F8 的验收标准包含 RFC-004 / 005 / 008 / 012 的部分，但功能整体归在 RFC-003 | **非阻塞，待映射修正** |

**RFC-003 Status** 已由 `Implemented` 改为 **`Changes requested`**（`RFCS.md` §2）。B1 / B2 / B3 修复后在新会话重跑 Round 2；Round 2 的判定以本文件列出的 AC 矩阵、N1 / N2 / N3 与 C-23 / C-24 的复核为准。`FEATURES.md` 没有 Status 列，因此本轮不改功能状态；C-25 的映射修正由 `/manage-changes` 或下一次 `/generate-rfcs` 处理。

### 11. 证据附录

#### 11.1 B1 复现（临时测试，已删）

```ts
const reached = reachWitch();          // seed 20261117；killTarget = 1（seer）
const witch = roleSeat(reached.state, 'witch'); // seat 4
run(reached.state, {
  type: 'WITCH_ACT',
  ts: 1_200,
  seat: witch,
  potion: 'poison',
  target: reached.killTarget,         // 毒药目标 == 狼刀目标
});
```

实际输出：

```
InvalidEventStreamError: 座位 1 已经出局，PLAYER_DIED 重复
  at applyPlayerDied (src/engine/apply.ts:130:11)
  at applyEvent (src/engine/apply.ts:69:14)
  at foldEvents (src/engine/step.ts:170:17)
  at step (src/engine/step.ts:226:21)
```

同一探针用 `makeNightState({ phase: 'NIGHT_WITCH', night: { killTarget: 6 } })`（`FIXTURE_ROLES` 的 hunter 是 6）把毒药指向 hunter，同样复现：`InvalidEventStreamError: 座位 6 已经出局，PLAYER_DIED 重复`。`killTarget === poisonTarget` 的合法路径没有任何测试。

#### 11.2 B2 复现（临时测试，已删）

```ts
const state = makeNightState({ phase: 'NIGHT_WOLVES', deadSeats: [4] }); // seer 已出局
const { events } = run(state, { type: 'WOLF_KILL', ... });
```

实际输出：

```
phase events [ 'public:{"from":"NIGHT_WOLVES","to":"NIGHT_WITCH"}' ]
phase after wolf NIGHT_WITCH
```

同一晚没有 `NIGHT_SEER`，且该 `PHASE_CHANGED` 是 `public`。女巫已出局时同理；被毒猎人走 `NIGHT_RESOLVE → DAY_ANNOUNCE`，被狼刀猎人走 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT`，死因可由公开相位区分。

#### 11.3 N1 的正面探针（临时测试，已删）

从 `lobbyState({ seed: 20261117 })` 开始，按 `START → WOLF_KILL → SEER_CHECK → WITCH_ACT(poison)` 生成完整事件流；`replay(events)` 与实时 state 深度相等（`JSON.stringify` 比较为 true，`expect(replayed).toEqual(state)` 通过）。这说明**实现本身**能重建 `night` / `potionsUsed`，缺的是套件的回归锁。

#### 11.4 变异探针的恢复确认

六个变异分别备份 `src/engine/phases/night.ts` 与 `src/engine/resolve/deaths.ts`，跑完相关测试后从 `/tmp` 恢复；恢复后（写入评审产物前）`git diff --stat` 无输出，`pnpm exec vitest run --project unit` 为 28 files / 236 tests passed。

---

## Round 2 -- 2026-11-18

> **评审会话**：新会话（只读仓库文件、跑命令、做临时探针）。
> **HEAD**：`6d16c10`（Round 1 修复 + 文档提交）；评审开始时 `git status --short` 无输出。
> **结论**：**Changes requested**（C-23 的第三个泄漏点仍未修，且新测试只锁 helper 不锁接线；C-24 的裁决仍缺权威记录）。
> **整体风险**：**High**。

### 0. STEP 0 · 实际执行输出

环境：Node `v22.22.2`、pnpm `10.33.0`。以下命令在 `6d16c10`、干净工作树上实跑：

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

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 69ms
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip:  0.86 kB
✓ built in 9ms
EXIT 0

$ pnpm test
 Test Files  37 passed (37)
      Tests  291 passed (291)
EXIT 0

$ pnpm exec vitest run --project unit --coverage
 Test Files  30 passed (30)
      Tests  257 passed (257)

 % Coverage report from v8
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   97.59 |    95.79 |     100 |   97.42 |
 engine          |   97.68 |    94.78 |     100 |   97.47 |
  apply.ts       |   94.33 |    93.18 |     100 |   94.23 | 98,127,162
  deal.ts        |     100 |      100 |     100 |     100 |
  effects.ts     |     100 |    88.88 |     100 |     100 | 47
  errors.ts      |     100 |      100 |     100 |     100 |
  init.ts        |      90 |       75 |     100 |      90 | 39
  queries.ts     |     100 |      100 |     100 |     100 |
  reject.ts      |     100 |      100 |     100 |     100 |
  replay.ts      |     100 |      100 |     100 |     100 |
  rng.ts         |   96.15 |       90 |     100 |      96 | 73
  step.ts        |     100 |      100 |     100 |     100 |
  transitions.ts |     100 |      100 |     100 |     100 |
  win.ts         |     100 |      100 |     100 |     100 |
 engine/phases   |   97.67 |     97.4 |     100 |   97.59 |
  night.ts       |   97.59 |    97.33 |     100 |    97.5 | 253,284
  visibility.ts  |     100 |      100 |     100 |     100 |
 engine/resolve  |   96.66 |    95.45 |     100 |   96.66 |
  deaths.ts      |   96.66 |    95.45 |     100 |   96.66 | 147
-----------------|---------|----------|---------|---------|-------------------
EXIT 0
```

**五条门禁全绿，291 个用例全过，覆盖率与 RFC-003 §9.5 的转录一致**（97.59 / 95.79 / 100 / 97.42）。本轮没有跑 `pnpm test:e2e`（`tests/e2e/` 仍无用例，Playwright 从 RFC-012 起生效）和 `pnpm selfplay`（RFC-015 的占位脚本），也没有在 Windows 上复跑；这三项与 Round 1 相同，不是本轮阻塞项。

**临时探针**：新增 `tests/engine/zz-review-probe.test.ts`，只打印及断言复现结果，跑完立即删除；源码四个文件以 `/tmp` 备份恢复，恢复后 `sha256sum` 一致。以下所有复现均为实跑，不是读代码推断。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-003 只交付规则引擎的夜间部分，没有 UI、HTTP 路由、SSR 或浏览器交互。按 game 的「核心循环 / 状态机 / 确定性 / 隐藏信息边界」检查；显式跳过不适用项：

| 跳过的检查 | 原因 |
|---|---|
| 响应式布局、无障碍、浏览器兼容、首屏性能 | RFC-003 无 UI；归 RFC-012 / RFC-016 |
| 认证、CSRF、XSS、注入 | 无 HTTP 端点、无客户端渲染；归 RFC-008 / RFC-011 |
| 数据库 / 网络 I/O、缓存 | 引擎是纯函数，本 RFC 没有 I/O |
| 平台认证、帧预算、手柄输入 | PRD Product Type 已声明不适用 |

隐藏信息边界是本 RFC 的适用检查，见 §10 的 B-R2-1。

### 2. Round 1 三个阻塞项的逐条复核

#### 2.1 B1 / C-24 · 合法输入崩溃：**已修，双向验证通过**

当前代码对 Round 1 的原始复现（seed `20261117`，`killTarget = 1`，女巫毒同目标）实跑：

```
B1 KILL-TARGET 1
B1 DIED [{"seat":1,"cause":"poison"}]
B1 AFTER DAY_ANNOUNCE false
```

不再抛 `InvalidEventStreamError`；只产生一条 `PLAYER_DIED`，状态只死一次。目标是 hunter 时同样只死一次、`cause === 'poison'`、停在 `DAY_ANNOUNCE`，不进入 `NIGHT_HUNTER_SHOOT`。

反向验证：把 `src/engine/resolve/deaths.ts:69-81` 的按座位 `Map` 归并改回修复前的两次 `deaths.push`，运行 `tests/engine/death-resolve.test.ts`：

```
InvalidEventStreamError: 座位 6 已经出局，PLAYER_DIED 重复
...
AssertionError: expected [ { seat: 7, cause: 'wolf' }, …(1) ] to deeply equal [ { seat: 7, cause: 'poison' } ]
 Test Files  1 failed (1)
      Tests  3 failed | 13 passed (16)
```

恢复后 16/16 绿。**B1 的崩溃本身确实修好了，测试也会红。**

但 C-24 还有两项本轮必须写清楚：

1. **「毒药优先」的裁决仍没有落入权威文件。** `RFCs/RFC-003...:252` 与 `RFCS.md` C-24 都写着「用户裁决」，但 `RFCs/RFC-003...:143-148` 的批准记录里没有 C-24；`RULES.md:228` 明确「§6 下表未覆盖的分支，引擎必须抛错」，而 §6 的 RUL-1~RUL-10 没有覆盖「同一目标既被狼刀又被毒」这一分支。`RULES.md:136` 的 ARCH-11 与 `FEATURES.md:69` 的 F8 AC-4 都要求未裁决分支显式失败。按用户这轮的要求，§9 只是作者自述，不能当作批准证据；所以这条在本轮仍是**未闭环的裁决记录问题**，见 §10 的 B-R2-2。
2. **修复顺手改变了死亡事件的顺序。** `deaths.ts:79-81` 加了 `.sort((a, b) => a.seat - b.seat)`。这不是 B1 崩溃所必需（去重只需要按座位归并），而且改变了合法场景的 `PLAYER_DIED` 顺序：实跑 `resolveNight({ killTarget: 7, poisonTarget: 3 })` 与真实 `WITCH_ACT`：

```
RESOLVE-ORDER [{"seat":3,"cause":"poison"},{"seat":7,"cause":"wolf"}]
ENGINE-DIED-ORDER [3,7]
```

修复前是狼刀 7 先、毒药 3 后，符合 RFC-003 §2.3 的步骤顺序（第 2–3 步狼刀，第 4 步毒药）。RFC-004 §2.1 的 `diedLastNight` 写的是「按死亡结算顺序」，`speechStartSeat` 取「结算顺序第一位死者」的下一位；座位排序会让这个「第一位」在跨座位场景下变化。这个选择既不在 RFC-003 §2.3，也没有记进 Implementation Notes（DOC-1），建议删掉排序或显式裁决并同步 RFC-004。见 §9 的 N-R2-1。

#### 2.2 B2 / C-23 · 夜间相位泄漏：**seer / witch 两条已修；hunter 路径仍未修，新测试是 helper-only**

**已修的两条**（Round 1 的 11.2 复现）实跑：

```
SEER-DEAD PHASE-EVENTS [{"v":"server","p":{"from":"NIGHT_WOLVES","to":"NIGHT_WITCH"}}]
WITCH-DEAD PHASE-EVENTS [{"v":"server","p":{"from":"NIGHT_SEER","to":"NIGHT_RESOLVE"}},
                         {"v":"public","p":{"from":"NIGHT_RESOLVE","to":"DAY_ANNOUNCE"}}]
```

跳过 `NIGHT_SEER` / `NIGHT_WITCH` 的相位事件已是 `server`；白天推进仍 `public`。

反向验证：把 `src/engine/phases/visibility.ts` 的 `phaseVisibility` 改成恒 `public`，运行 `tests/engine/night-visibility.test.ts`：

```
Test Files  1 failed (1)
     Tests  5 failed | 1 passed (6)
```

恢复后 6/6 绿。这两条路径确实有回归锁。

**hunter 路径仍未修**。`src/engine/phases/night.ts:102-109` 是唯一一条**没有走 `phaseChangedDraft` 的硬编码 `PHASE_CHANGED`**：

```ts
drafts.push({
  type: 'PHASE_CHANGED',
  visibleTo: 'public',
  payload: {
    from: 'NIGHT_RESOLVE',
    to: hunterKilledByWolf ? 'NIGHT_HUNTER_SHOOT' : 'DAY_ANNOUNCE',
  },
});
```

真实路径（狼刀 hunter → seer 查验 → 女巫 `none`）实跑：

```
FULL-HUNTER-PATH PUBLIC
PHASE_CHANGED:public:{"from":"NIGHT_RESOLVE","to":"NIGHT_HUNTER_SHOOT"}
HUNTER_SHOOT:public:{"seat":6,"target":1}
PHASE_CHANGED:public:{"from":"NIGHT_HUNTER_SHOOT","to":"DAY_ANNOUNCE"}
```

这正是 Round 1 B2 的第 3 条：「进入 `NIGHT_HUNTER_SHOOT` 说明 hunter 死于狼刀而不是毒杀」。`PLAYER_DIED` 虽然是 `server`，公开相位又把死因漏了回去；RFC-007 的 `publicEvents` 会把它原样放进每个 AI 的上下文（FR-9）。**C-23 没有闭环。**

**新测试为什么没发现**：`tests/engine/night-visibility.test.ts:115-122` 根本没有走引擎路径：

```ts
it('进入 NIGHT_HUNTER_SHOOT 的相位事件是 server（否则泄漏猎人死于狼刀）', () => {
  const hunter = 6 as SeatId;
  const state = makeNightState({ phase: 'NIGHT_RESOLVE', night: { killTarget: hunter } });
  // 直接构造「结算后进入开枪」的路径太长，这里用 night 状态 + 一次真实结算更脆；
  // 改为断言可见性函数的规则 + 上一整夜测试已覆盖真实路径。
  expect(phaseVisibility('NIGHT_HUNTER_SHOOT')).toBe('server');
  expect(state.night?.killTarget).toBe(hunter);
});
```

它只断言了纯函数 `phaseVisibility('NIGHT_HUNTER_SHOOT')` 和一个 fixture 字段；注释里「上一整夜测试已覆盖真实路径」是**错的**——上一整夜测试（`:50-81`）走的是 `potion: 'none'` 后直接 `DAY_ANNOUNCE`，没有 hunter。它锁住的是 helper，不是 helper 的接线，和 RFC-002 的 B-R2-2 是同一类问题。

双向验证这条更直接：把 `night.ts` 的中段改成 `phaseChangedDraft('NIGHT_RESOLVE', …)`（正确的修法），`night-visibility.test.ts` 仍是 **6/6 绿**；把该行改回硬编码 `public`（当前的泄漏），也仍是 **6/6 绿**。两个方向都不红，说明**没有任何测试在锁这条路径**。

另外，`tests/engine/night-visibility.test.ts:25-32` 的 `leaksOf` 白名单只允许「非 NIGHT 的 `PHASE_CHANGED`」与 `GAME_ENDED`；真实的 `HUNTER_SHOOT` 是**应当公开**的（猎人开枪全桌可见），但会被这个 helper 当成泄漏。实跑 `HELPER-LEAKS` 同时命中 `PHASE_CHANGED→NIGHT_HUNTER_SHOOT` 与 `HUNTER_SHOOT`。也就是说，即使有人把 hunter 路径加进整夜测试，`leaksOf` 也会误报；这条测试从设计上就无法覆盖它想覆盖的场景。

#### 2.3 B3 · payload schema：**schema 本体已补，真实载荷可校验；但「登记」和「接线」没有测试**

`src/shared/schemas.ts:166-209` 已为 `WOLF_KILL_CHOSEN`、`SEER_CHECKED`、`WITCH_POTION_USED`、`PLAYER_DIED`、`HUNTER_SHOOT`、`PHASE_CHANGED`、`GAME_ENDED` 定义 schema 并登记进 `PAYLOAD_SCHEMAS`。我用真实事件逐条跑 `makeEventEnvelopeSchema(PAYLOAD_SCHEMAS[type])`：

```
VALIDATE hunter-shoot: ALL OK
VALIDATE night-game-over: ALL OK
VALIDATE hunter-shot-win: ALL OK
```

反向验证：把 `deathCauseSchema` 从四值改成 `['wolf','poison']`，`tests/shared/schemas.test.ts` 变红：

```
FAIL tests/shared/schemas.test.ts > PLAYER_DIED > 接受四种死因，拒绝未知死因
Test Files  1 failed (1)
     Tests  1 failed | 6 passed (7)
```

恢复后 7/7 绿。**B3 的「有 schema」这一层确实修好了。** 但有两处测试缺口：

1. `tests/shared/schemas.test.ts` 只用手写字面量校验 schema 本身，没有把真实生产事件喂给 schema；`events.test.ts` 只对 `GAME_STARTED` / `REJECTED` 做了真实载荷校验。上面的 `VALIDATE ... ALL OK` 是我临时探针证明的，不是套件里的回归锁。
2. 「登记进 `PAYLOAD_SCHEMAS`」没有测试。把 7 个 RFC-003 条目从 `PAYLOAD_SCHEMAS` 删掉（只保留 `GAME_STARTED` / `REJECTED`），`tests/shared/schemas.test.ts` 仍然 7/7 绿，全量套件也绿——因为测试直接 import 各个 schema，没有任何测试断言 `PAYLOAD_SCHEMAS` 的键集合。见 §9 的 N-R2-2。

### 3. 新增测试的有效性（不是「有测试」而是「测试会不会红」）

| 测试 | 问题 | 证据 |
|---|---|---|
| `night-visibility.test.ts:115-122` hunter 用例 | 只测 `phaseVisibility` + fixture，不测 `finishNight` 的接线；注释里「上一整夜测试已覆盖真实路径」不成立 | 改对/改错 `night.ts` 中段，均 6/6 绿 |
| `night-visibility.test.ts:25-32` `leaksOf` | 白名单缺少合法公开的 `HUNTER_SHOOT`；真实 hunter 路径上会把它报成泄漏 | 实测 `HELPER-LEAKS` 同时命中相位与 `HUNTER_SHOOT` |
| `replay.test.ts:253-268` | 标题「PLAYER_DIED 指向不存在的座位时抛错」，正文却先对 9 号（存在）出局、再重复出局，断言 `/重复/`；`apply.ts:127` 的「不存在座位」分支仍未覆盖 | `--coverage` 的 `apply.ts` 未覆盖行仍是 `98,127,162` |
| `schemas.test.ts` | 手写 fixture 对 schema；没有真实事件集成校验，也没有 `PAYLOAD_SCHEMAS` 键集合断言 | 删掉 7 个登记条目后 7/7 仍绿 |
| `death-resolve.test.ts:240-245` | 把 `.sort(seat)` 的实现选择写成「按座位升序」断言，等于给一个未记录的实现选择上锁，而不是锁 RFC 的结算顺序 | `resolveNight({kill:7, poison:3})` 返回 `[3,7]`，与 §2.3 的步骤顺序相反 |
| `night-visibility.test.ts:50` | 标题说「公开事件数为 0」，实际有 1 条公开的 `PHASE_CHANGED(→DAY_ANNOUNCE)`；断言用 `leaksOf` 而不是计数 | 实测公开事件 1 条，测试仍绿 |

### 4. 「修过头」检查

本轮改动确实没有把该公开的东西全部变私有；`HUNTER_SHOOT`、`GAME_ENDED`、`→DAY_ANNOUNCE` 都仍是 `public`，这是对的。但有两处需要显式记录，否则会在 RFC-004/013 变成信息缺口：

1. **「天黑了」不再有公开事件。** `phaseVisibility` 把所有 `to: NIGHT_*` 的 `PHASE_CHANGED` 设为 `server`，包括 RFC-004 将来从白天进入 `NIGHT_WOLF_CHAT` 的那一条。PRD User Journeys 第 4 步要求玩家「只看到『天黑了』」；当前唯一的公开信号是投影后的 `state.phase`（RFC-007 §2.2 的 `phase` 字段），而不是事件流。RFC-007 尚未实现，这条跨 RFC 契约没有测试。若 RFC-011/012/013 的 UI 只消费公开事件，玩家将看不到天黑提示。非阻塞，但应写进 RFC-004/007 的交接。
2. **终局之夜的死亡没有公开播报。** `PLAYER_DIED` 在夜间一律 `server`；正常情况由 RFC-004 的 `DAY_STARTED.diedLastNight` 补公开播报，但如果 `finishNight` 直接 `GAME_ENDED`（例如猎人正好是最后一个神），根本不会进入 `DAY_ANNOUNCE`，`GAME_ENDED` 的 payload 只有 `result` / `condition`，没有死者。实测：

```
NIGHT-GAME-OVER EVENTS
WOLF_KILL_CHOSEN:wolves:{"target":6}
PHASE_CHANGED:server:{"from":"NIGHT_WOLVES","to":"NIGHT_RESOLVE"}
PLAYER_DIED:server:{"seat":6,"cause":"wolf"}
GAME_ENDED:public:{"result":"wolf","condition":"all-gods-dead"}
```

公开事件里没有任何死者信息。RFC-013 §2.1 的事件面板只显示三类公开条目（死亡播报、放逐结果、票型），这条终局夜死亡会缺席。它不是 B2 泄漏，而是「堵泄漏」带来的公开信息缺口；非阻塞，但应该由 RFC-004/013 决定 `GAME_ENDED` 是否带死者或面板改读投影状态。

payload 契约方面没有发现「修过头」：真实事件全部能通过新增 schema；`GameEndedPayloadSchema.condition` 仍是 `z.string()` 而不是封闭的 `WinCondition`，属于**校验不足**而不是过紧，且 `PAYLOAD_SCHEMAS` 目前没有运行时消费者。

### 5. RFC 符合度

**Verdict: NEEDS WORK**

- **B1**：崩溃已修，测试双向有效。但「毒药优先」的裁决没有进 RULES §6，且 `resolveNight` 的座位排序是未记录的额外行为改变（见 B-R2-2 / N-R2-1）。
- **B2**：只修了 seer / witch 两条；hunter 路径仍公开泄漏，RFC-003 §9.1 的「规则收敛在 `phaseVisibility()`」与「一整夜的公开事件只允许天亮与 `GAME_ENDED`」两句都不成立（`night.ts:102-109` 没有走 helper；整夜测试没走 hunter）。`RFCS.md` C-23 的「已裁决并修复」不能关闭。
- **B3**：schema 本体补齐，真实载荷可校验；登记与真实事件集成没有回归锁。
- **16 条 AC**：套件仍全绿，Round 1 的矩阵结论没有反转。但 AC 之外的 B2 hunter 路径、C-24 裁决记录、`resolveNight` 顺序仍是覆盖缺口——这正是 Round 1 说的「AC 全绿不等于交付物可用」的延续。
- **N1~N10**：N1 / N2 / N3 / N4 / N5 / N6 / N10 已落地；N7 只落地了重复出局与非存在座位标题（后者名不副实），`apply.ts:127` 仍未覆盖；N8 只同步了 `pnpm test` 的数字，`README.md:11` 仍是 209 / 98.0 / 95.2 / 14 个 Not started，`README.md:18` 又写 291，同一文件自相矛盾；`TEST-STRATEGY.md:3` 仍引用 `RFCS.md` v2.17（现 v2.20）。
- **C-25** 未处理，本轮不阻塞。

### 6. RULES 合规

**Verdict: NEEDS WORK**

| 规则 | 结果 | 证据 |
|---|---|---|
| ARCH-1 | **PASS** | `tests/dependency-direction.test.ts` 5/5 |
| ARCH-3 | **PASS** | `tests/engine/serialization.test.ts` 5/5；`night` / `potionsUsed` 是纯数据 |
| ARCH-4 | **PASS** | `ts` 来自 action，事件测试锁住 |
| ARCH-5 | **PASS（有已知记录）** | 效果列表仍只用于 `checkWin` 预览；`context.appliers` 已接通，不再是 N6 的双路径 |
| ARCH-6 | **PASS** | 夜晚效果 `source` 全为 `role`；AC-15 测试 |
| ARCH-11 | **NEEDS WORK** | C-24 的「毒药优先」在 RULES §6 无裁决记录；按 §6 前言应抛错。见 B-R2-2 |
| DATA-1 / DATA-2 | **PASS** | `seq` 严格递增；事件类型在 `GAME_EVENT_TYPES` 中 |
| DATA-3 | **PASS** | `replay-parity` 已覆盖真实一晚的 `night` / `potionsUsed` |
| DATA-4 / DATA-5 | **PASS** | `rng.test.ts` 递归扫描无 `Math.random`；固定种子 |
| TEST-1 | **NEEDS WORK** | B2 的 hunter 路径无有效测试；N7 的「不存在座位」名不副实 |
| TEST-2 | **PASS** | 行 97.42 ≥ 90，分支 95.79 ≥ 85 |
| TEST-3 | **PASS** | `determinism.test.ts` |
| TEST-4 | **PASS** | `no-network` setup |
| STYLE-1 ~ STYLE-6 | **PASS** | 命名、导出、`night.ts` 378 行 < 400 |
| STYLE-7 | **PASS（有死代码）** | 无 TODO / 注释代码；但 `deathCauseOf` 在 N5 后只剩测试调用，`NIGHT_PHASE_EVENTS` 无人使用 |
| DOC-1 | **NEEDS WORK** | `resolveNight` 的座位排序、C-24 的裁决未进权威文件、B2 的「全部夜间相位」声明与代码不符 |
| DOC-2 | **PASS** | 本 RFC 未新增依赖 |

### 7. SECURITY

**Verdict: FAIL**

- **B-R2-1（阻塞）**：`src/engine/phases/night.ts:102-109` 对 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 硬编码 `visibleTo: 'public'`。这会把「猎人死于狼刀而非毒杀」泄漏给所有观察者，和 Round 1 的 B2 第 3 条完全相同。`isVisibleTo` / RFC-007 的 `publicEvents` 会把该事件放进每个 AI 的上下文，违反 FR-9 与 PRD User Journeys 第 4 步。
- 已做对的部分没有因本轮改动退化：三条夜间私有事件仍是 `wolves` / `seer` / `witch`；`GAME_STARTED` 仍是 `server`；`PLAYER_DIED` 夜间仍是 `server`；`REJECTED` 仍是 `self:<seat>`；`HUNTER_SHOOT` / `GAME_ENDED` / `→DAY_ANNOUNCE` 公开是合理的。
- 认证、CSRF、XSS、注入：本 RFC 无网络/客户端入口，N/A；`step` 接收类型化 `Action` 是引擎边界，运行时校验归 RFC-008 / RFC-011。
- 没有把密钥、模型原始响应或完整 state 写进事件 / 错误；SEC-1 / SEC-7 的落点在 RFC-006 / 008。

### 8. PERFORMANCE

**Verdict: N/A**

纯函数引擎，循环规模由 9 席界定；没有数据库、网络、缓存或 UI。`PHASE_CHANGED` 每夜 4–6 条的量级已由 RFC-003 §8.8 交给 RFC-008 评估，本 RFC 没有性能缺陷。

### 9. MAINTAINABILITY

**Verdict: NEEDS WORK**

- **N-R2-1 · 死亡事件顺序被座位排序改变**：`src/engine/resolve/deaths.ts:79-81`。去重不需要排序；排序改变了 `PLAYER_DIED` 顺序与 RFC-004 `diedLastNight` 的「结算顺序第一位」。建议删除排序（`Map` 的插入顺序天然是「先狼后毒」），或在 RFC-003 / RFC-004 里显式裁决并补测试。
- **N-R2-2 · `PAYLOAD_SCHEMAS` 的登记没有测试**：`tests/shared/schemas.test.ts` 只验证导出对象；`PAYLOAD_SCHEMAS` 删掉 7 个条目仍全绿。建议加一条表驱动测试：真实一晚的事件逐条 `makeEventEnvelopeSchema(PAYLOAD_SCHEMAS[type]).safeParse(event)`，并断言 `PAYLOAD_SCHEMAS` 覆盖 RFC-003 拥有的事件类型。
- **N-R2-3 · `leaksOf` 的公开白名单不完整**：`tests/engine/night-visibility.test.ts:25-32`；应显式允许 `HUNTER_SHOOT`（以及 `→DAY_ANNOUNCE`），否则这个 helper 无法覆盖 hunter 路径。
- **N-R2-4 · `deathCauseOf` 在 N5 后成为死代码**：`src/engine/resolve/deaths.ts:144-150` 只剩测试调用；`deaths.ts:147` 的有效分支未覆盖。删掉它，或在 `resolveHunterShot` 里真正使用同一个 `cause` 常量。
- **N-R2-5 · `NIGHT_PHASE_EVENTS` 未被使用**：`src/engine/phases/visibility.ts:36-38`；若留给 RFC-007，应在 RFC-007 的交接里明确，否则是死导出。
- **N-R2-6 · 文档同步只做了一半**：`README.md:11` 仍是 209 / 98.0 / 95.2 / 14 个 Not started；`README.md:18` 写 291；`TEST-STRATEGY.md:3` 仍引用 `RFCS.md` v2.17；`tests/engine/replay.test.ts:240` 的注释写 `NIGHT_VOTES`，payload 是 `NIGHT_WITCH`。§9.2 的 N8 声称已同步，不成立。
- **N-R2-7 · `finishNight` 的可见性逻辑重复**：`night.ts:102-109` 手写 `PHASE_CHANGED`，而其余三处都走 `phaseChangedDraft`；本次 bug 就是这条重复路径造成的。建议把该行也交给 helper，并加一条「源码里所有 `PHASE_CHANGED` 都经 helper」的静态扫描/测试（类似 RFC-002 的接线锁）。

### 10. 总体评估

**Overall Risk Level: High**

**Summary**：B1 的崩溃确实修好了，B3 的 schema 也确实补齐了，N1/N2/N3/N6/N10 的改动有效。但 B2 只修了 seer / witch 两条，`finishNight` 的 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 仍是 `public`；而新增的 hunter 测试只断言 helper 和一个 fixture，改对改错都不会红，正好复制了 Round 1「测试存在但覆盖不到」的问题。此外，C-24 的「毒药优先」仍只存在于作者自述，未进 RULES §6；`resolveNight` 的座位排序还改变了死亡事件顺序，可能影响 RFC-004 的发言起点。

**Blocking Issues**：

1. **B-R2-1 · B2 第三个泄漏点仍在**：`src/engine/phases/night.ts:102-109` 把 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 设为 `public`，公开事件直接暴露猎人死于狼刀；`tests/engine/night-visibility.test.ts:115-122` 没有走真实路径，改对/改错都绿。修法：改用 `phaseChangedDraft`；加一条真实路径测试（狼刀 hunter → seer → witch none → 断言公共事件里没有 `NIGHT_HUNTER_SHOOT` 相位），并让 `leaksOf` 允许合法的 `HUNTER_SHOOT`。
2. **B-R2-2 · C-24 的裁决仍缺权威记录**：`RFCs/RFC-003...:252` / `RFCS.md` C-24 声称「用户裁决」，但 `RULES.md` §6 没有对应 RUL；`RFCs/RFC-003...:143-148` 的批准记录也没有 C-24。按 `RULES.md:136` 的 ARCH-11 与 `FEATURES.md:69` 的 F8 AC-4，未裁决分支必须显式失败。若用户确实裁决了「毒药优先」，请通过 `/manage-changes` 把它写进 RULES §6（并同步 RFC-003 / RFC-004 的引用）；否则应改成明确的未裁决错误，而不是在代码里静默选择。

**Improvement Suggestions**（非阻塞，按优先级）：

1. **N-R2-1**：删掉 `resolveNight` 的 `.sort(seat)`，恢复「先狼刀、后毒药」的结算顺序；或在 RFC-003 / RFC-004 显式裁决，并补跨座位用例。
2. **N-R2-2**：用真实事件驱动 `PAYLOAD_SCHEMAS` 的集成测试，并断言键集合覆盖 RFC-003 的事件类型。
3. **N-R2-3**：修 `leaksOf` 白名单，让 hunter 路径可以被整夜测试覆盖。
4. **N-R2-4**：`deathCauseOf` 已无生产调用，删除或重新接线。
5. **N-R2-5**：把 `PHASE_CHANGED` 的构造统一到 `phaseChangedDraft`，加源码扫描锁。
6. **N-R2-6**：补 `PLAYER_DIED` 不存在座位的真实测试（`apply.ts:127`），修正 N7 的标题/正文。
7. **N-R2-7**：同步 `README.md:11`、`TEST-STRATEGY.md:3`、`replay.test.ts:240` 的注释；更新 RFC-003 §9 的两处不实声明（B2「全部夜间相位」与 N8「已同步」）。
8. **N-R2-8**（跨 RFC）：给 RFC-004 / RFC-007 / RFC-013 留交接：夜晚进入没有公开事件（「天黑了」依赖 `project().phase`）；终局之夜的 `PLAYER_DIED` 没有 `DAY_STARTED` 可承载，事件面板需要读投影状态或扩展 `GAME_ENDED`。

### 11. 本轮 Open conflicts / 状态更新

本轮在 `RFCS.md` 登记/更新：

- **C-23 保持 Open / 阻塞**：seer / witch 路径已修，hunter 路径仍泄漏；§8.3 的「已裁决并修复」被本轮复核推翻。
- **C-24 保持 Open / 阻塞（记录层面）**：代码行为已实现并测试，但「毒药优先」的裁决没有进入 `RULES.md` §6；需 `/manage-changes` 或改为显式失败。
- **C-26（新，非阻塞）**：`resolveNight` 的座位排序改变了死亡事件顺序，可能影响 RFC-004 的 `diedLastNight` / `speechStartSeat`；RFC-003 §2.3 没有这个排序，Implementation Notes 也没有记录。
- **C-25** 不变（非阻塞）。

**RFC-003 Status** 由 `Implemented` 改为 **`Changes requested`**。Round 3 的复核门槛：B-R2-1 的 hunter 路径必须有一条**真实路径**测试且改回泄漏会红；B-R2-2 必须有 RULES §6 的裁决记录或代码改为显式失败；N-R2-1 的顺序问题需要结论。

### 12. 证据附录

#### 12.1 B1 原始复现（当前代码）

```
B1 KILL-TARGET 1
B1 DIED [{"seat":1,"cause":"poison"}]
B1 AFTER DAY_ANNOUNCE false
```

#### 12.2 B2 hunter 路径（当前代码）

```
FULL-HUNTER-PATH PUBLIC
PHASE_CHANGED:public:{"from":"NIGHT_RESOLVE","to":"NIGHT_HUNTER_SHOOT"}
HUNTER_SHOOT:public:{"seat":6,"target":1}
PHASE_CHANGED:public:{"from":"NIGHT_HUNTER_SHOOT","to":"DAY_ANNOUNCE"}
HELPER-LEAKS PHASE_CHANGED:public:{"from":"NIGHT_RESOLVE","to":"NIGHT_HUNTER_SHOOT"}
HUNTER_SHOOT:public:{"seat":6,"target":1}
```

#### 12.3 B3 真实载荷校验

```
VALIDATE hunter-shoot: ALL OK
VALIDATE night-game-over: ALL OK
VALIDATE hunter-shot-win: ALL OK
```

#### 12.4 死亡顺序探针

```
RESOLVE-ORDER [{"seat":3,"cause":"poison"},{"seat":7,"cause":"wolf"}]
ENGINE-DIED-ORDER [3,7]
```

#### 12.5 变异探针的恢复确认

- B1 变异（`deaths.ts` 改回两次 push）：`death-resolve.test.ts` 3 failed / 13 passed；恢复后 16/16。
- B2 变异（`phaseVisibility` 恒 `public`）：`night-visibility.test.ts` 5 failed / 1 passed；恢复后 6/6。
- B2 接线变异（`night.ts` 中段改 `phaseChangedDraft` → 正确；再改回 `public` → 泄漏）：两次 `night-visibility.test.ts` 都是 6/6。
- B3 变异（`deathCauseSchema` 去掉 `lynch` / `shoot`）：`schemas.test.ts` 1 failed / 6 passed；恢复后 7/7。
- B3 登记变异（删掉 `PAYLOAD_SCHEMAS` 的 7 个条目）：`schemas.test.ts` 仍 7/7，全量套件仍绿。
- 探针文件删除后 `git status --short` 无源码改动；四个源码文件恢复后的 sha256 与备份一致。
