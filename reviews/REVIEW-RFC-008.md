# RFC-008 评审 · 会话、状态存储与刷新恢复

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-19
> **分支 / HEAD**：`main` / `10e0374`（评审开始时 `git status --porcelain` 无输出）
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-19

**结论：Changes requested · Overall Risk Level: High**

五条阻塞：

1. **B1 · `POST /api/games/:id/actions` 把 `visibleTo: 'server'` 与其他席位的私有事件原样返回给客户端**。`src/server/routes/games.ts:132` 直接返回 `result.events`，没有经过 `isVisibleTo` / `project()`。实测玩家是女巫（座位 1）时提交女巫动作，响应里出现 `PLAYER_DIED { seat: 1, cause: 'wolf' }`（`server` 可见，死因正是引擎注释里明确不公开的信息）与 `PHASE_CHANGED NIGHT_WITCH → NIGHT_RESOLVE`（`server`）；同一路由还接受替其他席位提交动作，因此玩家可以拿到狼队私聊与预言家查验结果（见 B2）。这违反 `RULES SEC-5`，并在 HTTP 层重新打开了 RFC-007 的 C-28（夜间子阶段 / 死因不得泄漏）。
2. **B2 · 公开动作路由不校验动作席位是否属于玩家**。`src/server/routes/games.ts:101-123` 只校验 `session.gameIds`，从不比较 `action.seat` 与 `record.playerSeat`。实测 `playerSeat = 1`（女巫）的会话可以成功提交 `WOLF_CHAT seat: 3`、`WOLF_KILL seat: 3`、`SEER_CHECK seat: 7`，并分别收到 `WOLF_CHAT_POSTED`（`wolves`）、`WOLF_KILL_CHOSEN`（`wolves`）、`SEER_CHECKED { target: 3, result: 'wolf' }`（`seer`）。这既是信息泄漏，也是服务端对局完整性的缺口：客户端可以代替 AI 行动。RFC-008 未把它指派给别的 RFC，RFC-011 也没有对应 AC。
3. **B3 · 生产入口从不启用 `Secure` cookie**。`src/server/index.ts:26` 只调用 `buildApp({ logger: true })`；`src/server/app.ts:32` 的 `production` 默认 `false`，`src/server/session.ts:38` 只有 `production === true` 才加 `Secure`。构建产物 `dist/server/index.js:2370` 同样是 `buildApp({ logger: true })`。因此 `pnpm start` 的实际生产 cookie 是 `session=…; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax`，**没有 `Secure`**，与 RFC-008 §2.6 和 D-1 的「属性仍完整：… `Secure`（仅生产）」不符。dev 下缺失是对的，生产下缺失是安全缺陷。
4. **B4 · 多条 AC 的测试「不会红」（TEST-1）**。AC-3 的测试根本没有断言 `GAME_STARTED.mode`（`tests/server/session.test.ts:76-92` 只断言 GET 200）；AC-13 的测试断言的是「释放后 `stateOf` 抛错」（`tests/server/store.test.ts:73-91`），与 AC 的「重新 `replay` 得到同一状态」相反；AC-14 只用 5 局（`store.test.ts:93-120`）而不是 100 局；AC-2 的「seed 与 `GAME_STARTED` 一致」、AC-8 的「action 成功」、AC-15 的 `404` 状态码、AC-7 的「不存在他人角色字段」都只有弱断言。反向探针 P2 / P4 / P6 / P7 / P3 全部保持绿色（见 §8）。
5. **B5 · 释放 / 会话上限与 §2.5、Q-008-3 不一致，且会跨会话破坏数据**。会话超过 20 局时 `gameIds.shift()` 把最旧一局从会话里删掉（`src/server/store/game-registry.ts:119-124`），于是 `GET /api/session` 只列 20 条（§2.5 要求「仍列出全部对局（含已释放的）」），该局返回 `404 GAME_NOT_FOUND` 而不是 §4 的 `410 GAME_EXPIRED`，若它还是 active 局则事件被直接清空、没有 snapshot（Q-008-3 要求「降级为仅保留 snapshot」）。另外 `enforceRetention()` 扫描的是全局 `game:` 键空间（`game-registry.ts:202-217`），**会话 B 打完 4 局会清掉会话 A 已终局一局的完整事件流**（实测 A 的 `events.length` 从非 0 变 0）。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `10e0374`，工作树 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK_EXIT=0

$ pnpm lint
> eslint .
LINT_EXIT=0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm test
 ✓ |unit| tests/server/session.test.ts (8 tests) 97ms
 ✓ |unit| tests/server/resume.test.ts (6 tests) 103ms
 ✓ |unit| tests/server/store.test.ts (5 tests) 14ms
 ...
 Test Files  58 passed (58)
      Tests  477 passed (477)
TEST_EXIT=0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
✓ 38 modules transformed.
dist/server/index.js  81.62 kB │ gzip: 27.46 kB
BUILD_EXIT=0
```

`pnpm test:e2e` 未跑：本 RFC 只改服务端路由 / 存储 / 共享类型，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位（`tests/meta/selfplay-placeholder.test.ts` 断言以退出码 1 结束），与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、可见性、安全、接口与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright。

**探针后的复跑**：所有变异探针从 `/tmp/howl-probe-backup/` 的文件备份恢复（**没有使用 `git checkout`**），临时测试文件已删除；随后全量 `pnpm test` 复跑 **58 files / 477 tests 全绿**，`git status --porcelain` 为空。

---

### 1. 用户要求核对的两点

#### 1.1 ① 手写 cookie 与 RFC 的契约

**结论：行为属性基本完整；生产路径的 `Secure` 没有落地，因此「属性仍完整」这条声明不成立。**

- 机制：RFC-008 §2.6 写的是「`@fastify/cookie` 下发 `session` cookie」，`package.json` 里没有该依赖，代码改用手写 `set-cookie` / 头解析。这是已记录偏离 **D-1**（`RFCs/RFC-008-session-store-and-resume.md:168`），所以「机制不同」本身不是未记录缺陷；但 D-1 没有按 `RULES DOC-1` 写「用户是否同意」，且 `RULES.md:60` 的依赖表仍列 `@fastify/cookie 11.1.5`，属于待同步的文档 / 依赖表冲突（登记为 C-63）。
- 属性：`src/server/session.ts:81-88` 串出的头是 `Path=/; Max-Age=604800; HttpOnly; SameSite=Lax`，生产再接 `Secure`。`HttpOnly` / `SameSite=Lax` / `Path=/` / `Max-Age` 都在，会话 id 为 `crypto.randomUUID()`（36 字符，`isSessionId` 要求 ≥32），`GET /api/session` 无 cookie 时建新会话并下发 cookie——这些与 §2.6 / AC-4 一致。
- **生产 `Secure`**：`buildApp` 的 `production` 参数只有测试能传；`src/server/index.ts:26` 的生产入口不传，`dist/server/index.js` 也证实了这一点。于是「生产环境 `Secure`」在真实启动路径上不存在。见 B3。
- 解析：`readSessionCookie`（`src/server/session.ts:44-53`）按 `;` 切分再按第一个 `=` 取值，UUID 值不含需要解码的字符，当前形态可用；非 UUID 但 ≥32 字符的 cookie 会被当成候选 id，查不到就新建会话，没有注入风险。`Secure` 缺失是唯一实质属性缺口。

#### 1.2 ② `GameRegistry` 不缓存可变状态、`GameState` 由 `replay(events)` 重建

**结论：当前代码与 RFC §2.1 / §2.5 / §4 及用户描述一致；但「不缓存」没有被测试锁住，AC-13 的证据是错的。**

- `GameRegistry` 只有 `store: MetaStore` 一个字段（`src/server/store/game-registry.ts:61-66`）；`stateOf()` 每次都 `replay(record.events)`（`:134-137`）；`createGame` / `submit` / GET 路由都经 `stateOf` 取状态，没有 `GameState` 缓存。模块级 `engine`（`:51-56`）只是一组无状态函数的配置，不是存储。`InMemoryMetaStore` 的 `Map`（`src/server/store/meta-store.ts:18`）是 MetaStore 的唯一实现，属于允许的存储本体。
- 行为探针：用真实 HTTP 路径跑完一整局（43 次 action，终局 `seq = 73`）后连续两次 GET，两次 200、`version` 73、`view` 深度相等、`phase = FINISHED`；再打完 3 局（共 4 局），最旧一局被 retention 清空 events 后 GET 返回 `410 GAME_EXPIRED`——没有「先缓存所以还能取到」的残留。
- **缺口**：AC-13 的「释放后再取该局，内部重新 replay 得到同一状态」没有任何测试。`tests/server/store.test.ts:73-91` 反而断言释放后 `stateOf` **抛错**；`RFCs/RFC-008...:200` 把它当作 AC-13 的 PASS 证据。反向探针 P5b 在 `GameRegistry` 里只对 `finished` 状态加一个普通对象缓存（release 时删除），`session + resume + store` 共 19 条测试仍全绿。也就是说，今天「没有缓存」是**代码阅读 + 人工探针**的结论，不是测试保护的结论。见 B4。

---

### 2. 逐条验收标准：哪个测试会红

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `tests/server/session.test.ts:27-54`：同一 cookie 建 3 局，`games` 长度 3 且是数组；测试引用了 `SessionResponse.games`，删字段会编译失败 | 删字段 → 编译失败（类型层成立） | **PASS** |
| 2 | `session.test.ts:56-74` 断言响应里的 `gameId` / `seed` / `playerSeat` / `version`；**没有**读 `GAME_STARTED.payload.seed` | P7 把 `GAME_STARTED.seed` 改成 `action.seed + 1`，session + resume 14/14 绿 | **FAIL（覆盖）** |
| 3 | `session.test.ts:76-92` 只断言 GET 200；**没有**断言 `GAME_STARTED.mode` | P2 把 `GAME_STARTED.mode` 硬编码为 `slaughter-side`，session 8/8 绿 | **FAIL** |
| 4 | `session.test.ts:94-111`：`HttpOnly` / `SameSite=Lax` / `Path=/`，id ≥32 | P1 删 `HttpOnly` → AC-4 用例红（1 failed / 7 passed） | **PASS**（`Secure` 属 §2.6，另见 B3） |
| 5 | `resume.test.ts:33-53`：两次独立 `inject` 的 `version` 相同、`view` 深度相等 | 改 `version` / `view` 会红 | **PASS** |
| 6 | 同 AC-5（两次独立 `inject`，不共享客户端内存） | 同 AC-5 | **PASS**（但同进程服务端缓存也能通过；见 AC-13） |
| 7 | `resume.test.ts:56-72`：对 9 个 `playerSeat` 各 GET 一次，数 `"role":` 出现 1 次 | P4 往响应里加 `allRoles: [...9 个角色]`，resume 6/6 绿 | **FAIL（覆盖）** |
| 8 | `resume.test.ts:75-99`：POST 后只断言 200 且 `version` 更大；不检查事件不是 `REJECTED` | P6 让 `WOLF_CHAT` 永远拒绝，resume 6/6 绿（`REJECTED` 也会推进 `seq`） | **FAIL** |
| 9 | `resume.test.ts:101-141`：重复 → `ALREADY_APPLIED`；旧版本换动作 → `VERSION_MISMATCH`；未来版本 → `VERSION_MISMATCH` | P8 删掉 `ALREADY_APPLIED` 分支 → 该用例红（正向控制有效） | **PASS** |
| 10 | `session.test.ts:114-155`：他人 id 与不存在 id 的 404 JSON 相等；自己的 200 | 改 404 为 403 / 换 message → 红 | **PASS** |
| 11 | `store.test.ts:37-47` 副本；`:49-58` 换 `MockStore` 只跑 registry 的 4 个方法 | 不覆盖「全部会话相关测试」；没有把 `session/resume` 路由测试跑在 MockStore 上 | **PARTIAL** |
| 12 | `store.test.ts:61-71`：扫 `src/server` 里 `new Map`，排除 `meta-store.ts` | 加 `new Map` → 红；但普通对象 / 数组缓存不在断言范围（P5b 这类缓存能逃） | **PASS（按 AC 字面）** |
| 13 | `store.test.ts:73-91`：`release()` 后 events 为空、`stateOf` 抛错；`RFC §8.4:200` 引用它 | AC 说的是 finished 后重新 replay 得同一状态，测试断言的是**相反**行为；P5b 的 finished-state 缓存全绿 | **FAIL** |
| 14 | `store.test.ts:93-120`：造 5 局 finished，跑 `enforceRetention`，只断言 `session.gameIds` 中保留 events 的局数 ≤3 | AC 要求 100 局；测试没跨过 20 局上限，没有 session 列表断言，没有 snapshot 断言 | **FAIL** |
| 15 | `session.test.ts:157-181`：`replay` 只断言错误 JSON、**不断言 404**；`stream` 断言 501 | P3 把 replay 的 404 改成 200，session 8/8 绿 | **FAIL（覆盖）** |
| 16 | `session.test.ts:189-208`：黑名单 7 个数据库驱动 | 新增别的驱动可逃（例：`pg-promise` / `@prisma/client`），但 AC 只要求「不存在数据库驱动」，当前依赖确实没有 | **PASS** |

统计：**PASS 8（1 / 4 / 5 / 6 / 9 / 10 / 12 / 16）**，**FAIL 7（2 / 3 / 7 / 8 / 13 / 14 / 15）**，**PARTIAL 1（11）**。AC-2/3/7/8/13/14/15 都没有「行为退化会红」的测试，违反 `RULES TEST-1`。

---

### 3. RFC ADHERENCE — NEEDS WORK

#### 3.1 已记录的偏离

| 项 | 结论 |
|---|---|
| D-1 手写 cookie | 记录存在，机制可接受（见 §1.1）；但缺「用户是否同意」，且生产 `Secure` 没落地（B3） |
| D-2 `Session.gameIds` + 独立 `game:<id>` | 理由成立：避免把 20 局的事件流塞进一份会话记录；与 `ARCH-10` 的一对多不冲突 |
| D-3 幂等键 `(gameId, expectedVersion, type, seat)` | 与 §2.3 一致；AC-9 有正向 / 反向探针 |
| D-4 `createGame` 把 `seed/mode/playerSeat` 传给 START | 代码与 `startHandler` 的校验一致；真实创建路径可用 |
| D-5 释放只清 events | 与 §2.5 的「更早对局只保留 snapshot」方向一致，但本 RFC 不生成 snapshot；会话上限删 id、跨会话清事件没有记录（B5） |

#### 3.2 未记录 / 不成立的契约

- **§2.2 的 `{ version, events }` 响应**被实现成「引擎产出的全部事件」，没有可见性过滤。RFC 没有写「返回全部 envelope」，而 `RULES SEC-5` 禁止把非投影数据发给客户端；按权威顺序 `RULES > RFC`，这里必须过滤（B1 / C-59）。
- **§2.2 的「请求与响应类型…并由 Zod 校验（API-1）」**：请求有 Zod（`src/shared/api.ts:16-20,44-52`），但 `CreateGameResponse` / `GameSummary` / `SessionResponse` / `ApiError` 都是纯 interface（`:23-41,30-35,65-71`），没有响应 schema。属于未记录的 API-1 偏离（非阻塞）。
- **§2.1 的 `snapshot?: ReplaySnapshot`** 在 `GameRecord` 里是 `snapshot?: unknown`（`game-registry.ts:32-33`）。RFC-014 还没实现，类型可延后，但应登记。
- **§2.5 的会话列表 / 上限降级**：见 B5。
- **§2.6 的 `@fastify/cookie`**：见 §1.1 / C-63。
- **§8.4 的 AC 证据**：AC-2 / AC-3 / AC-8 / AC-11 / AC-13 / AC-14 / AC-15 的措辞比测试实际断言强（例如 AC-13 把「释放后不能重建」写成「按需 replay 的前提」）。这不是代码缺陷本身，但会让下一轮把未覆盖的 AC 当作已覆盖（C-61 / C-64）。
- **§7 Q-008-2「7 天后清理」**：`SESSION_TTL_MS` 只用于 cookie 的 `Max-Age`（`session.ts:39`），服务端没有按 TTL 删除 session / game 的代码；进程不重启时数据永久保留。§8.1 的批准记录写「打完的局… 7 天后清理」，实现没有对应行为。见 N1 / C-64。

#### 3.3 额外实现 / 超出范围

`GameRecord.applied`（`game-registry.ts:34-35`）是实现幂等所需，D-3 只描述了键、没有描述该字段，属于必要的实现细节，不阻塞；但它随每次 action 线性增长，且 `release()` 不清（N2）。

---

### 4. RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `ARCH-7`（MetaStore 唯一出口） | **PASS**：路由只通过 `GameRegistry`，`GameRegistry` 只持有 `MetaStore` 接口；`InMemoryMetaStore` 的 Map 是存储本体 |
| `ARCH-9`（服务端持有状态） | **PARTIAL**：状态确实只在服务端，但动作路由不绑定玩家席位，客户端可以替 AI 行动（B2） |
| `ARCH-10`（会话一对多） | **PASS（结构）**：`gameIds` 列表；但 20 局后从列表删除，见 B5 |
| `API-1`（共享请求 / 响应类型 + Zod） | **PARTIAL**：请求有 Zod；响应只有 interface |
| `API-3`（幂等） | **PASS**：P8 正向 / 反向探针；重复同一 action 不重复推进 |
| `SEC-1` / `SEC-5` | **SEC-1 PASS**（无密钥路径）；**SEC-5 FAIL**：POST 返回未经可见性过滤的事件（B1） |
| `DATA-6`（释放） | **PARTIAL**：`release` 清 events；`applied` 不清、孤儿记录不删、无 7 天清理 |
| `DOC-1`（偏离记录 + 用户同意） | **PARTIAL**：D-1 缺「用户是否同意」；D-5 没覆盖会话上限 / 跨会话释放；AC-13 证据与 AC 相反 |
| `TEST-1`（每条 AC 有自动化测试） | **FAIL**：AC-2/3/7/8/13/14/15 无有效断言（B4） |
| `STYLE-*` | **PASS**：kebab-case 文件、具名导出、无 `any`、文件 <400 行；`as never` 是类型逃生口（N7），不是 `any` |

---

### 5. SECURITY — FAIL

#### 5.1 B1 · 响应泄漏 server-only 与其他席位私有事件

证据（临时探针，`playerSeat = 1`，seed `4_242_424`，角色 `1:witch 3/5/8:wolf 7:seer 9:hunter`）：

- 玩家（女巫）提交 `WITCH_ACT seat: 1` 后，`POST /actions` 的 200 响应包含：
  - `PHASE_CHANGED`，`visibleTo: "server"`，`{ from: "NIGHT_WITCH", to: "NIGHT_RESOLVE" }`
  - `PLAYER_DIED`，`visibleTo: "server"`，`{ seat: 1, cause: "wolf" }` ← **死因在真实规则里不公开**
  - `DAY_STARTED`，`visibleTo: "public"`，`{ diedLastNight: [1] }`
- 玩家（仍是女巫）提交 `WOLF_CHAT seat: 3` → 200，响应含 `WOLF_CHAT_POSTED`，`visibleTo: "wolves"`，原文可读。
- 提交 `WOLF_KILL seat: 3` → 200，响应含 `WOLF_KILL_CHOSEN`（`wolves`）。
- 提交 `SEER_CHECK seat: 7` → 200，响应含 `SEER_CHECKED { target: 3, result: "wolf" }`（`seer`）。

`src/server/routes/games.ts:132` 是唯一返回 `result.events` 的地方；`src/engine/phases/night.ts:76-81` 明确把 `PLAYER_DIED` 设为 `server` 以避免死因泄漏，`phaseChangedDraft` 在夜间也走 `server`。RFC-007 的 C-28 已经在投影层修掉了同一类泄漏，但 HTTP 响应绕过了投影。这直接违反 `SEC-5` 和产品「AI 不作弊」的可见性前提（虽然这里是玩家客户端，同样的数据也不该离开服务端）。

**修复方向**：返回前按 `isVisibleTo(event, record.playerSeat, stateAfterEvent)` 过滤，或只返回 `{ version }` 并让客户端重新 GET `project()`；补「女巫动作响应不含 `PLAYER_DIED` / `PHASE_CHANGED server`」「非狼提交狼动作拿不到 `WOLF_CHAT_POSTED`」的回归测试。

#### 5.2 B2 · 动作席位未绑定玩家席位

`src/server/routes/games.ts:101-123` 只做「session 拥有 gameId」的检查，从未校验 `('seat' in action ? action.seat : record.playerSeat) === record.playerSeat`。实测一个 `playerSeat = 1`（女巫）的会话可以成功替狼、预言家行动。即使过滤了响应事件，客户端仍可操纵状态、用「成功 / 失败」当 oracle 探身份，所以这是独立于 B1 的授权缺陷。

RFC-008 没有把「玩家只能提交自己席位的 action」写成 AC，RFC-011（编排层 / 输入通道）也没有对应 AC。需二选一：在 RFC-008 的公开路由立即绑定，或走 `/manage-changes` 把责任明确划给 RFC-011 并把该 AC 写进去；不能保持「谁都能替任何席位提交」的现状（C-60）。

#### 5.3 B3 · 生产 cookie 缺 `Secure`

见 §1.1。`buildApp({ production: true })` 能正确加 `Secure`（临时探针实测响应头 `...; HttpOnly; SameSite=Lax; Secure`），但生产入口 `src/server/index.ts:26` 与构建产物 `dist/server/index.js:2370` 都没有传 `production`。`RULES SEC-*` 没有直接点名 `Secure`，但 RFC §2.6 明确要求，且这是会话 id 作为唯一凭据时的实际传输风险。

**修复方向**：在 `src/server/index.ts` 用 `process.env.NODE_ENV === 'production'`（或显式 `APP_ENV`）传 `production`；补生产 / 开发两条 cookie 属性测试；同步 D-1 的「属性仍完整」声明。

#### 5.4 其余安全检查

- 无账号 / 无数据库 / 无密钥路径；`package.json` 没有数据库驱动（AC-16 测试）。
- 会话 id 随机（`randomUUID`）、HttpOnly、SameSite=Lax、Path=/；`GET /api/session` 生成新会话符合 §2.6。
- `GET /api/games/:id` 与 `POST /actions` 对他人 gameId 返回同一 404，不泄露存在性（AC-10 测试；实测 foreign/missing JSON 相等）。
- `GET` 视图确实来自 `project()`（`routes/games.ts:89-97`），未发现直接序列化完整状态。
- `/api/games/:id/replay` 未终局 404、`/stream` 501 不触达游戏内容。
- 错误响应不包含 LLM 原始响应 / 密钥（本 RFC 无 LLM 调用）。

---

### 6. PERFORMANCE — PASS（有非阻塞提示）

- `GET /api/games/:id` 每次 `stateOf`（O(events)）再 `project`（又一次 O(events) 折叠）；一局数百条事件，成本远低于 LLM 调用。没有缓存是 RFC 的有意选择，不按性能问题处理。
- `GET /api/session` 每个 gameId 一次 `store.get`，上限 20 次；可接受。
- `enforceRetention()` 每次终局扫描**全局** `game:` 键并逐条 `get`（`game-registry.ts:202-217`）；100 局探针下 100 条记录、20 条有 events。会话上限删 id 后，被删局的记录仍留在存储里，内存随总局数线性增长（F37 AC-3 的严格读法不成立）；没有 7 天清理（N1）。属于非阻塞的容量问题。
- 20 局上限把 active 局的最旧事件清空；这不是性能优化，是数据丢失（B5）。

---

### 7. MAINTAINABILITY — NEEDS WORK

- 新增文件都在 400 行以内（`game-registry.ts` 218、`session.test.ts` 209、`routes/games.ts` 148），命名与目录符合 STYLE-1/5。
- 测试问题（B4）本身就是可维护性缺陷：`session.test.ts:76-92` 的 AC-3 与 `store.test.ts:73-91` 的 AC-13 是「名字对、断言错」，比没有测试更容易骗过下一轮评审。
- `as never` 出现在 `game-registry.ts:136` 与 `routes/games.ts:121`，把 action / event 的类型不匹配藏起来；建议在边界做一次 `Action` / `GameEvent` 的运行时或类型守卫（STYLE-3 不禁止 `never`，但这是类型逃逸）。
- `GameRecord.applied` 无上限、`release` 不清；`snapshot?: unknown` 没有类型；`SESSION_TTL_MS` 只用于 cookie，函数名暗示的 7 天清理不存在。
- 文档漂移：`TEST-STRATEGY.md:33-37` 仍写 449 / 「其余 15 个 RFC 仍 proposed」；`:460` 的 changelog 写「458 → 477」；RFC-008 §8.4 的 AC-2 / 3 / 8 / 11 / 13 / 14 / 15 证据比实际测试强；`README.md` 的进度段在本轮前仍写「RFC-008 Implemented，等待评审」。见 N5。

---

### 8. 变异探针清单

所有注入都用精确字符串替换并断言目标存在；每个探针结束后从 `/tmp/howl-probe-backup/` 的原始文件恢复，`git status --porcelain` 为空，全量套件复跑 58/477 绿。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P1 | `session.ts` 删 `'HttpOnly'` | `session.test.ts` | **红**（1 failed / 7 passed） | AC-4 测试有效（正向控制） |
| P2 | `step.ts` 的 `GAME_STARTED.mode` 硬编码 `'slaughter-side'` | `session.test.ts` | **绿 8/8** | AC-3 无效 |
| P3 | `routes/games.ts` 的 replay 从 `404` 改 `200` | `session.test.ts` | **绿 8/8** | AC-15 的 404 未断言 |
| P4 | GET 响应加 `allRoles: [...9 个角色]`（不出现 `"role":` 字面量） | `resume.test.ts` | **绿 6/6** | AC-7 只数 `"role":`，漏掉 `allRoles` 泄漏 |
| P5b | `GameRegistry` 只对 `finished` 记录加普通对象状态缓存，`release` 删除 | `session + resume + store` | **绿 19/19** | AC-13「finished 后不缓存」无测试；同时说明 AC-12 的 Map 扫描挡不住对象缓存 |
| P6 | `wolf-chat.ts` 让所有 `WOLF_CHAT` 走拒绝分支 | `resume.test.ts` | **绿 6/6** | AC-8 不检查「成功」；`REJECTED` 也推进 version |
| P7 | `GAME_STARTED.seed = action.seed + 1` | `session + resume` | **绿 14/14** | AC-2 的「与 GAME_STARTED 一致」无测试 |
| P8 | `game-registry.ts` 永不返回 `ALREADY_APPLIED` | `resume.test.ts` | **红**（1 failed） | AC-9 测试有效（正向控制） |

### 9. 临时行为探针（文件已删除）

| # | 探针 | 观察 |
|---|---|---|
| T1 | 同一 cookie 连续创建 100 局 | `GET /api/session` 只列 **20**；store 里 100 条记录，20 条有 events（都是 active） |
| T2 | 创建第 21 局 | 第 1 局从会话消失；`GET /api/games/<第1局>` → **404 GAME_NOT_FOUND**；第 21 局 200 |
| T3 | 会话 A 完成 1 局；会话 B 完成 4 局并 `enforceRetention` | 会话 A 的 `events` 变成 **0**（跨会话清数据） |
| T4 | 真实 HTTP 路径跑完一整局（43 次 action，seed `4_242_424`，`playerSeat = 1`） | 到 `FINISHED` 时 `seq = 73`；GET 两次均 200、version 73、`view` 深度相等、`phase = FINISHED`；再打完 3 局后，最旧一局 GET → **410 GAME_EXPIRED**，`GET /api/session` 仍列出 4 局。`submit after finish` 返回 200 + `REJECTED` 并推进到 version 74（非 AC，但说明终局后事件流仍可增长） |
| T5 | `buildApp({ production: true })` | 响应头含 `Secure`；但生产入口不传 `production`（见 B3） |
| T6 | 并发两个不同 action 用同一 `expectedVersion` | 本次实跑 200 + 409（没有丢失更新）；不构成稳定回归锁，仅记录 |

---

### 10. 冲突登记（已写入 `RFCS.md` §8.20）

| # | 冲突 | 判定 |
|---|---|---|
| C-59 | RFC-008 §2.2 的 `{ events }` 响应 vs `RULES SEC-5`（任何客户端视图走 `project()`）；实测 server-only / 私有事件外泄 | **阻塞**：按 RULES 过滤响应事件或改返回契约 |
| C-60 | RFC-008 公开动作路由不绑定 `action.seat` 与 `record.playerSeat`；RFC-011 也没有对应 AC | **阻塞**：在 008 绑定，或 `/manage-changes` 明确划给 011 并补 AC |
| C-61 | RFC §5 AC-13 要求「finished 后释放 GameState、重新 replay 得同一状态」，§8.4 与 `store.test.ts:73-91` 却把「release 清 events 后 stateOf 抛错」当证据 | **阻塞（测试证据）**：重写 AC-13 用例，引用真实 finished 路径 |
| C-62 | RFC §2.5「GET /api/session 仍列出全部对局（含已释放的）」/ Q-008-3「最旧对局降级为仅保留 snapshot」vs 实现把第 21 局从 `gameIds` 删除、返回 404、未生成 snapshot；retention 还是全局而非按会话 | **阻塞（实现 / 契约）**：保留 id 并区分 released 状态，或改 §2.5 / Q-008-3 并记录 |
| C-63 | RFC §2.6「用 @fastify/cookie」/ `RULES.md:60` 列 11.1.5 vs 手写 cookie（D-1 已记录但无用户同意）；且生产入口不加 `Secure` | **非阻塞（文档 / 依赖表）**，但 B3 的生产 `Secure` 是阻塞代码缺陷 |
| C-64 | 文档漂移：TEST-STRATEGY 基线 449 vs 实际 477、RFC-008 的 `existing` / 证据行过强、Q-008-2 的 7 天清理未实现、D-1 缺用户同意 | **非阻塞** |

---

### 11. 最终判断

- **Overall Risk Level: High**
- **Summary**：存储边界与「事件流唯一权威」的主设计是对的：`MetaStore` 是唯一出口并返回副本，`GameRegistry` 不缓存 `GameState`，`stateOf` 一律 `replay`；AC-1 / 4 / 5 / 6 / 9 / 10 / 12 / 16 有能变红的测试。但 HTTP 层把引擎的 `server` / 其他席位私有事件原样回传，并且不限制动作席位，玩家可以替 AI 行动并读取狼聊 / 查验 / 死因；生产入口又没有启用 `Secure`。AC-2 / 3 / 7 / 8 / 13 / 14 / 15 的测试在对应行为退化时仍会绿；20 局上限与会话列表、跨会话 retention 还会静默丢数据。这些都在合并前必须修。
- **Blocking Issues**：
  1. **B1** 响应事件泄漏（`SEC-5` / C-28 回归）。
  2. **B2** 公开路由未绑定玩家席位。
  3. **B3** 生产 cookie 缺 `Secure`。
  4. **B4** AC-2 / 3 / 7 / 8 / 13 / 14 / 15 的测试不会红（`TEST-1`）。
  5. **B5** 会话上限 / 释放 / 全局 retention 与 §2.5、Q-008-3 不一致并跨会话丢数据。
- **Improvement Suggestions**（非阻塞）：
  1. N1：实现服务端 7 天清理（或把 Q-008-2 的「7 天」明确限定为 cookie 生命周期，并改 §8.1 的「清理」措辞）。
  2. N2：`applied` 随 action 无限增长、`release()` 不清；会话上限删除 id 后记录成为孤儿，F37 AC-3 的「100 局内存不线性增长」需要明确口径。
  3. N3：补响应 Zod schema（`CreateGameResponse` / `SessionResponse` / `ApiError`），或明确 `API-1` 只覆盖请求；把 `snapshot?: unknown` 在 RFC-014 前改成显式占位类型。
  4. N4：D-1 补「用户是否同意」；同步 `RULES.md` §2 的 `@fastify/cookie`（要么安装并使用，要么在依赖表注明 RFC-008 的 D-1 手写偏离）。
  5. N5：修正 TEST-STRATEGY 的 449 → 477 基线、§0.2 的「其余 15 个 RFC proposed」、RFC-008 §8.4 的 AC 证据行；`README.md` 的进度段随本轮状态更新。
  6. N6：AC-11 的第二个实现只在 `store.test.ts:49-58` 的 registry 层跑了 4 个方法，没有让 `session/resume` 路由测试整体跑在 `MockStore` 上；建议把 `makeApp` 的 store 参数化。
  7. N7：`POST /actions` 的 `REJECTED` 以 200 返回并计入 `applied` / `seq`（终局后提交也一样，实测 version 73 → 74），与「成功」边界模糊，也让终局事件流可被继续拉长；至少补一条「非法 / 终局后动作返回什么」的契约，或在 `submit` 里拒绝 `REJECTED` 事件后不推进版本。
  8. N8：`as never` 类型逃逸（`game-registry.ts:136`、`routes/games.ts:121`）建议在边界做 `Action` / `GameEvent` 守卫。

- **状态**：`RFCS.md` → **`Changes requested`**；`FEATURES.md` 没有 Status 列，未改。**本评审没有修改任何产品代码，也没有 `git commit`；所有探针改过的文件已从备份恢复，工作树 clean。**

---

## Round 2 -- 2026-11-19

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **分支 / HEAD**：`main` / `25bfa3a`（评审开始时 `git status --porcelain` 无输出）。
> **复核范围**：Round 1 的 B1 / B2 / B3 / B5 修复，以及用户特别提出的「B2 绑定后 B1 是否仍成立」。B4 / C-61 从未关闭，本轮按 AC 表复核，不是重查已关闭项。
> **结论**：**Changes requested**
> **整体风险**：**High**

### 0. STEP 0 · 门禁实跑（本轮 HEAD）

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `25bfa3a`，评审开始时工作树 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK_EXIT=0

$ pnpm lint
> eslint .
LINT_EXIT=0

$ pnpm format:check
> prettier --check .
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm test
 Test Files  58 passed (58)
      Tests  482 passed (482)
TEST_EXIT=0

$ pnpm build
✓ 14 modules transformed.
✓ 38 modules transformed.
dist/server/index.js  82.68 kB │ gzip: 27.84 kB
BUILD_EXIT=0
```

`pnpm test:e2e` 未跑：RFC-008 只改服务端路由 / 存储 / 共享类型，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位，与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、可见性、安全、接口与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright。

**探针后的复跑**：所有变异探针从 `/tmp/howl-probe-backup-round2-src/` 的文件备份恢复（**没有使用 `git checkout`**），临时测试文件已删除；随后全量 `pnpm test` 复跑 **58 files / 482 tests 全绿**，`git status --porcelain` 为空。

---

### 1. 用户指定复核的四项修复

#### 1.1 B1 · 动作响应过滤：**行为修复成立，但回归测试是空心的**

**实现成立。** `src/server/routes/games.ts:143-147` 现在返回
`registry.visibleEventsOf(result.record, record.playerSeat)`；
`src/server/store/game-registry.ts:149-159` 从头折叠完整事件流，逐条用 `isVisibleTo(event, seat, cursor)` 过滤。这个实现需要重新 replay 整局，但语义是对的。

**B2 绑定后 B1 仍必要，而且仍有效。** 旧复现路径「替别人提交」已失效（见 1.2），但**玩家自己的合法动作也会产生 `server` 事件**。用 seed `15`（座位 1 女巫、2/5/9 狼、8 预言家）走到 `NIGHT_WITCH`，玩家提交自己的 `WITCH_ACT`（`potion: 'none'`）后：

```
# 过滤后（当前实现）
PROBE_B1_WITCH 200 [["PHASE_CHANGED","public"],["DAY_STARTED","public"],["PHASE_CHANGED","public"]]

# 把路由改回 result.events 后（同一请求）
PROBE_B1_WITCH 200 [["PHASE_CHANGED","server"],["PLAYER_DIED","server"],
                    ["PHASE_CHANGED","public"],["DAY_STARTED","public"],["PHASE_CHANGED","public"]]
```

也就是说：`PLAYER_DIED`（`server`，含死因）与夜间 `PHASE_CHANGED`（`server`）确实会被玩家自己的动作生产出来，B1 的过滤仍然挡着它们。**B1 的防护仍然成立。**

**但测试没有把这个修复锁在 HTTP 层。** 把 `routes/games.ts:146` 改回 `events: result.events` 后：

```
$ pnpm exec vitest run --project unit tests/server/resume.test.ts tests/server/store.test.ts
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

原因：`tests/server/resume.test.ts:170-194` 只提交一条 `WOLF_CHAT`（且是狼队 3 条中的第一条），无论玩家是不是狼，这一条都不会产出 `server` 事件；它断言「响应里没有 `visibleTo: 'server'`」永远成立。真正能测出过滤的是 `tests/server/store.test.ts:124-183` 的 `visibleEventsOf` 单测——把 helper 的 `isVisibleTo` 去掉会红（P-R2-2），但它测不到路由有没有调用 helper。**这是本轮最重要的新发现：B1 代码修好了，B1 的 HTTP 回归测试却没有接线。**

#### 1.2 B2 · 席位绑定：**行为修复成立，反向探针会红**

`src/server/routes/games.ts:119-127` 现在校验 `action.seat === record.playerSeat`，否则 `403 NOT_YOUR_SEAT`。`tests/server/resume.test.ts:196-219` 覆盖了「替别人席位提交」。把校验改成永不命中后，该用例红（`expected 200 to be 403`），说明测试确实在守这条行为。

旧复现路径（女巫提交 `WOLF_CHAT seat: 3` / `SEER_CHECK seat: 7`）现在都在到达引擎前被 403 拦下。**B2 本身成立。**

一个非阻塞边界：`START` 是唯一没有 `seat` 的 action，路由的 `'seat' in action` 检查会跳过它。实测对局开始后提交 `START` 返回 `200` + `REJECTED / PHASE_MISMATCH`，版本从 1 推进到 2、阶段仍是 `NIGHT`，**不能重置对局**；但它说明公开路由仍接受一个服务端生命周期 action，可被用来反复推进 `seq` / 追加 `REJECTED`（无 rate limit）。当前无状态危害，登记为 N-R2-2，不阻塞。

#### 1.3 B3 · 生产入口 `Secure`：**成立（实际进程验证）**

`src/server/index.ts:20` 现在按 `process.env.NODE_ENV === 'production'` 传 `production`。本轮不是只读代码：构建后实际启动两个进程验证。

```
# NODE_ENV=production PORT=31888 node dist/server/index.js
set-cookie: session=...; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure

# NODE_ENV=development PORT=31889 node dist/server/index.js
set-cookie: session=...; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax
```

生产 `Secure` 已接线，dev 不误加。`tests/server/session.test.ts:247-259` 的 `production: true` 用例只是辅助，实际入口也验证过。**B3 关闭。**

#### 1.4 B5 · 超限释放与 retention：**原问题修了，但修复引入新缺口**

**已修的部分成立。** 把 `createGame` 改回 Round 1 的 `session.gameIds.shift()` 后，`tests/server/session.test.ts:211-245` 红（旧局从会话列表消失），说明「保留记录、GET 410」这条被测试锁住。

**新缺口 1：超限时反复释放同一局。** `src/server/store/game-registry.ts:121-129` 每次都释放 `session.gameIds[0]`，但 `gameIds` 从不缩短；第 22 局创建时 `[0]` 还是第 1 局，于是**第 2、3、4…局永远不会被释放**。24 局实测：

```
PROBE_B5_EVENT_COUNTS [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
PROBE_B5_GAME_IDS_LENGTH 24
```

按 Q-008-3「单会话 20 局上限，超出时最旧的对局降级」应为前 4 局都被释放。现在只有第 1 局被释放，第 2..4 局仍保留完整事件流；连续开 100 个未终局的对局会留下 99 份事件流，直接违背 F37 AC-3「连续开局 100 次后内存不随局数线性增长」的口径。**这是 Round 1 B5 修复引入的新代码缺陷，本轮列为阻塞。**

**新缺口 2：retention 的跨会话隔离没有回归测试。** `enforceRetention` 现在只遍历 `session.gameIds`（`game-registry.ts:225-240`），实现是对的；直接探针「会话 A 一局终局，会话 B 打完 4 局」后 A 的 `events.length` 仍是 1。但把它改回「扫全局 `game:` 键」后：

```
$ pnpm exec vitest run --project unit tests/server/session.test.ts tests/server/store.test.ts
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

现有测试没有覆盖双会话，这一条 Round 1 修复目前只靠代码阅读，不靠测试。登记为 C-68（非阻塞测试证据），建议补一条双会话用例。

---

### 2. 逐条验收标准：哪个测试会红

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `session.test.ts:27-54`，同一 cookie 三局、`games` 长度 3 且是数组 | 删类型字段会编译失败 | **PASS** |
| 2 | `session.test.ts:56-74` 只断言响应 `seed === 4_242_424`，**没有读 `GAME_STARTED.payload.seed`** | P-R2-6 把 `GAME_STARTED.seed` 改成 `action.seed + 1`，session + resume **18/18 绿** | **FAIL（覆盖）** |
| 3 | `session.test.ts:76-92` 只断言 GET 200，**没有断言 `GAME_STARTED.mode`** | P-R2-6 同时把 `GAME_STARTED.mode` 硬编码 `slaughter-side`，仍 **18/18 绿** | **FAIL** |
| 4 | `session.test.ts:94-111` 断言 `HttpOnly` / `SameSite=Lax` / `Path=/`、id ≥32；生产 `Secure` 见 1.3 | 删 `HttpOnly` 会红 | **PASS** |
| 5 | `resume.test.ts:33-53` 两次独立 `inject` 的 `version` 与 `view` 深相等 | 改任一值会红 | **PASS** |
| 6 | 同 AC-5（两次独立调用，不共享客户端内存） | 同 AC-5 | **PASS** |
| 7 | `resume.test.ts:55-71` 数响应里 `"role":` 出现 1 次 | P-R2-8 往响应加 `allRoles: [...9 个 role]`，resume **8/8 绿**（`allRoles` 不含 `"role":` 字面量） | **FAIL（覆盖）** |
| 8 | `resume.test.ts:74-99` 只断言 200 与 `version` 更大，不检查 `REJECTED` | P-R2-9 让所有 `WOLF_CHAT` 走拒绝分支，resume **8/8 绿**（`REJECTED` 也推进 `seq`） | **FAIL** |
| 9 | `resume.test.ts:101-141`：重复 → `ALREADY_APPLIED`；旧版本换动作 / 未来版本 → `VERSION_MISMATCH` | P-R2-12 去掉 `ALREADY_APPLIED` 分支 → 1 failed | **PASS** |
| 10 | `session.test.ts:114-155`：他人 id 与不存在 id 的 404 JSON 相等 | 改 404 为 403 / 换 message 会红 | **PASS** |
| 11 | `store.test.ts:49-58` 只让 registry 的 4 个方法跑在 `MockStore` 上；`session/resume` 路由仍用 `InMemoryMetaStore` | 没有「全部会话相关测试」跑在第二实现上 | **PARTIAL** |
| 12 | `store.test.ts:61-71` 扫 `src/server` 的 `new Map`，排除 `meta-store.ts` | 加 `new Map` 会红；普通对象缓存逃逸（见 AC-13） | **PASS（按 AC 字面）** |
| 13 | `store.test.ts:73-91` 仍断言 `release()` 后 `stateOf` **抛错**，与「重新 replay 得同一状态」相反；`RFC §8.4:200` 仍把它当 PASS | P-R2-11 给 `finished` 记录加对象缓存（release 时删除），session + resume + store **24/24 绿** | **FAIL** |
| 14 | `store.test.ts:93-121` 只造 5 局，且用常量自身做上界；没有 100 局 | P-R2-10 把 `KEEP_FULL_EVENTS` 从 3 改成 10，store **6/6 绿** | **FAIL** |
| 15 | `session.test.ts:157-181` 的 replay 只断言错误 JSON，**不断言 404 状态码** | P-R2-7 把 replay 的 404 改成 200，session **10/10 绿** | **FAIL（覆盖）** |
| 16 | `session.test.ts:189-208` 黑名单 7 个数据库驱动；当前依赖确实没有 | 新增别的驱动可逃，但 AC 只要求不存在数据库驱动 | **PASS** |

统计与 Round 1 相同：**PASS 8（1 / 4 / 5 / 6 / 9 / 10 / 12 / 16）**，**FAIL 7（2 / 3 / 7 / 8 / 13 / 14 / 15）**，**PARTIAL 1（11）**。Round 1 的 B4（AC 覆盖）**没有闭合**；`RFCs/RFC-008...:228` 说「AC-2 / AC-7 的加强留给 Round 2 前的收尾（见 §8.8）」，但该 RFC 文件没有 §8.8，且 AC-3 / 8 / 13 / 14 / 15 也不在「留给 §8.8」的范围内。`RFCS.md` 的 C-61 至今仍是 **Open（阻塞）**。

---

### 3. 变异探针清单

所有注入都用精确字符串替换并断言目标存在；每个探针结束后从 `/tmp/howl-probe-backup-round2-src/` 的原始文件恢复，`git status --porcelain` 为空，全量套件复跑 58/482 绿。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P-R2-1 | `routes/games.ts` 的响应改回 `result.events` | `resume + store` | **绿 14/14** | B1 的 HTTP 回归测试无效；同日用真实女巫探针证明 raw 响应会带 `PLAYER_DIED server` |
| P-R2-2 | `visibleEventsOf` 的 `isVisibleTo` 条件改为恒真 | `store.test.ts` | **红 1** | helper 单测有效（B1 的机制有锁，接线没有） |
| P-R2-3 | 席位校验条件改为永不命中 | `resume.test.ts` | **红 1**（200 ≠ 403） | B2 测试有效（正向控制） |
| P-R2-4 | 超限改回 `gameIds.shift()` + `release` | `session.test.ts` | **红 1** | 「保留记录 / GET 410」测试有效 |
| P-R2-5 | `enforceRetention` 改回扫全局 `game:` | `session + store` | **绿 16/16** | 跨会话隔离没有回归测试（C-68） |
| P-R2-6 | `GAME_STARTED.seed = action.seed + 1`、`mode = 'slaughter-side'` | `session + resume` | **绿 18/18** | AC-2 / AC-3 无效 |
| P-R2-7 | replay 的 `404` 改 `200` | `session.test.ts` | **绿 10/10** | AC-15 只断言 JSON、不断言状态码 |
| P-R2-8 | GET 响应加 `allRoles: [...9 个 role]` | `resume.test.ts` | **绿 8/8** | AC-7 只数 `"role":`，漏掉别名字段泄漏 |
| P-R2-9 | `WOLF_CHAT` 永远走拒绝分支 | `resume.test.ts` | **绿 8/8** | AC-8 不检查动作成功 |
| P-R2-10 | `KEEP_FULL_EVENTS = 3` 改 `10` | `store.test.ts` | **绿 6/6** | AC-14 的上界由被测常量自己决定，等于没锁 3 |
| P-R2-11 | `GameRegistry` 对 `finished` 记录加普通对象状态缓存（release 时删除） | `session + resume + store` | **绿 24/24** | AC-13 无缓存回归锁（与 Round 1 P5b 一致） |
| P-R2-12 | `sameAction ? 'ALREADY_APPLIED' : ...` 改成永远 `VERSION_MISMATCH` | `resume.test.ts` | **红 1** | AC-9 正向控制有效 |

### 4. 行为探针（临时文件已删除）

| # | 探针 | 观察 |
|---|---|---|
| T-R2-1 | seed `15`（1 女巫 / 2,5,9 狼 / 8 预言家），服务端推进到 `NIGHT_WITCH`，玩家从 HTTP 提交自己的 `WITCH_ACT` | 过滤后：`PHASE_CHANGED(public)` / `DAY_STARTED(public)` / `PHASE_CHANGED(public)`；路由改 raw 后：`PHASE_CHANGED(server)` / `PLAYER_DIED(server)` / 三条 public。**B1 行为成立，测试不设防** |
| T-R2-2 | 单会话连开 24 局 | `gameIds` 24 条；事件数 `[0,1,1,…]`，只有第 1 局被释放。**超限释放没有逐局接替** |
| T-R2-3 | A 一局终局；B 打完 4 局并 `enforceRetention(B)` | A 的 `events.length = 1`，跨会话隔离实现正确 |
| T-R2-4 | 真实 `dist/server/index.js`，`NODE_ENV=production` / `development` | 生产 cookie 含 `Secure`；开发不含 |
| T-R2-5 | 创建后提交无 `seat` 的 `START` | `200` + `REJECTED / PHASE_MISMATCH`，`version 1 → 2`，阶段仍 `NIGHT`；不能重置，但可推进版本 / 追加事件 |

---

### 5. 维度结论

#### 5.1 RFC ADHERENCE — NEEDS WORK

- D-1 / D-2 / D-3 / D-4 仍成立；D-5 的「超限只清 events」在语义上成立，但实现有 T-R2-2 的重复释放缺陷（C-66）。
- **§2.2 的 `{ version, events }` 契约**：实现返回的是**整局可见历史**，不是本次动作产出的事件。RFC 没有明确写「只回增量」，但这与 Round 1 的实现（`result.events`）不同，也未被记录为偏离；客户端若按「本次事件」消费会重复应用。建议明确契约或改为只返回增量。登记为 C-70（非阻塞）。
- **§2.5 / Q-008-3**：会话列表保留全部 id（已修），但 20 局上限没有逐局接替释放（C-66）；Q-008-3 的「降级为仅保留 snapshot」仍未实现（snapshot 属 RFC-014，可接受）。
- **§4 的 `410 GAME_EXPIRED`**：对已释放未终局对局成立；但对局列表仍显示 `status: 'active'`，没有 `released` 标记，客户端无法从列表区分「进行中」与「已过期」。建议在 `GameSummary` 增加明确状态或注明 410 即可（非阻塞）。
- **§8.4 的 AC 证据**：AC-2 / 3 / 8 / 11 / 13 / 14 / 15 的措辞仍强于测试实际断言；§8.7 引用的 §8.8 不存在。这是 DOC-1 文档问题（C-69）。

#### 5.2 RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `ARCH-7` | **PASS**：路由只经 `GameRegistry`，`MetaStore` 是唯一出口 |
| `ARCH-9` | **PASS**（本轮修复）：公开路由绑定玩家席位；但无 rate limit，`START` 可无 seat 提交（N-R2-2） |
| `ARCH-10` | **PASS（结构）**：`gameIds` 一对多；上限语义见 C-66 |
| `API-1` | **PARTIAL**：请求有 Zod；`CreateGameResponse` / `GameSummary` / `SessionResponse` / `ApiError` 仍是纯 interface |
| `API-3` | **PASS**：重复 action 不重复推进；AC-9 正向控制有效 |
| `SEC-1` | **PASS**：本 RFC 无密钥路径 |
| `SEC-5` | **PASS（行为）**：B1 过滤成立；**但回归测试不设防**（C-65） |
| `DATA-6` | **PARTIAL**：release 清 events；`applied` 不清、超限释放缺陷、无 7 天服务端清理 |
| `DOC-1` | **PARTIAL**：D-1 仍缺「用户是否同意」；§8.8 不存在；AC 证据过强 |
| `TEST-1` | **FAIL**：AC-2 / 3 / 7 / 8 / 13 / 14 / 15 无有效断言；AC-11 PARTIAL |
| `STYLE-*` | **PASS**：新增文件 <400 行、kebab-case、具名导出；`as never` 仍在（N-R2-4） |

#### 5.3 SECURITY — NEEDS WORK（仅测试证据；行为无新泄漏）

- **B1 行为 PASS**：T-R2-1 证明自己的动作产生的 `server` / 死因事件不会出现在过滤后的响应；B2 使「替别人提交」路径失效，但 B1 仍必要。
- **B1 测试 FAIL**：P-R2-1 / T-R2-1 证明路由回退时全套测试仍绿。这是 `SEC-5` 的回归锁缺口（C-65）。
- **B2 PASS**：403 `NOT_YOUR_SEAT` 生效；旧代提交路径不再可复现。
- **B3 PASS**：生产 `Secure` 实跑验证。
- `GET /api/games/:id` 仍由 `project()` 生成；他人 gameId 与不存在 id 的 404 相等；无账号 / 数据库 / 密钥路径；错误响应不含 LLM 原文。
- 新的非阻塞安全观察：`START` 无 seat 但被公开路由接受，返回 200 + `REJECTED` 并推进 `seq`（T-R2-5）；不能改状态，但可被用来刷版本 / 事件。建议在路由层拒绝 `START`（服务端内部使用）或至少不把 `REJECTED` 当成功推进（N-R2-2）。

#### 5.4 PERFORMANCE — PASS（有非阻塞提示）

- `POST /actions` 每次调用 `visibleEventsOf` 都会从空状态重放整局事件，再返回**整局可见历史**；一局几十到几百条事件，成本可接受，但响应大小随局长度增长。若客户端只需要增量，建议只过滤 `result.events`（C-70）。
- `enforceRetention` 每次终局扫描本会话；`gameIds` 目前可无限增长（C-66），100 局时会线性变慢。20 局上限修好后应回到有界。
- `GET /api/session` 每个 gameId 一次 `store.get`；当前列表无上限，随 C-66 恶化。
- 没有发现 N+1 级别的新问题。

#### 5.5 MAINTAINABILITY — NEEDS WORK

- 测试命名与断言不一致（AC-3「写进 GAME_STARTED」只 GET 200；AC-13「释放后按需重建」断言抛错）比没有测试更危险——下一轮会把未覆盖 AC 当成已覆盖。
- `RFCs/RFC-008...:228` 引用不存在的 §8.8；`§8.4` 的 AC-2 / 3 / 8 / 11 / 13 / 14 / 15 证据行需按实际测试重写。
- `snapshot?: unknown`（`game-registry.ts:35`）、`applied` 无上限且 `release` 不清、`SESSION_TTL_MS` 只用于 cookie 的 `Max-Age`、响应 schema 缺失、`as never` 类型逃逸：均为非阻塞的后续清理项。
- 文档漂移仍在：`TEST-STRATEGY.md:32-37` 仍写 449 / 「其余 15 个 RFC proposed」；`:460` 的 changelog 写 458 → 477，实际 482；`README.md` 仍写 RFC-008 Round 1 Changes requested。C-64 保持 Open（非阻塞）。

---

### 6. 冲突登记（已写入 `RFCS.md` §8.21）

| # | 冲突 | 判定 |
|---|---|---|
| C-65 | **B1 的 HTTP 回归测试无效**：路由改回 `result.events` 后 `resume + store` 14/14 绿；真实女巫响应会带 `PLAYER_DIED server` / `PHASE_CHANGED server`。`tests/server/resume.test.ts:170-194` 只提交首条 `WOLF_CHAT`，该动作不产生 server 事件 | **阻塞（SEC-5 / TEST-1 回归锁）**：用「女巫自己的 `WITCH_ACT` 产生 `PLAYER_DIED`」或等价的真实路径做 HTTP 断言；或只返回 `version` 让客户端重新 GET `project()` |
| C-66 | **B5 超限释放反复释放 `gameIds[0]`**：第 22 局创建后第 2 局仍保留 events；24 局探针 `[0,1,1,…]`，违反 Q-008-3 / F37 AC-3 | **阻塞**：释放「最旧的未释放局」（如 `gameIds[gameIds.length - MAX - 1]`）或维护 released 游标；补 22 / 100 局用例 |
| C-67 | **B4 / C-61 未闭合**：AC-2 / 3 / 7 / 8 / 13 / 14 / 15 的测试在行为退化时仍绿；AC-13 测试仍断言 `stateOf` 抛错；AC-11 只在 registry 层跑 MockStore | **阻塞（TEST-1）**：按 §8.4 重写为真实路径断言；在 `RFCS.md` 的 C-61 关闭前不能把 RFC 标为 Reviewed |
| C-68 | **retention 跨会话隔离没有回归测试**：实现正确（A 的 events 保持 1），但改回全局扫描后 16/16 绿 | **非阻塞（测试证据）**：补 A 终局 + B 四局的双会话用例 |
| C-69 | **文档漂移**：`RFC §8.7` 引用不存在的 `§8.8`；`§8.4` 的 AC-2 / 3 / 8 / 11 / 13 / 14 / 15 证据过强；D-1 仍缺用户同意；`SESSION_TTL_MS` 没有服务端 7 天清理；响应类型无 Zod；TEST-STRATEGY 基线 449 / 477、README 仍写 Round 1 | **非阻塞**：下一次 docs / 实现提交按实际测试重写 §8.4、补 §8.8 或删除引用、补 D-1 同意与清理口径 |
| C-70 | **`visibleEventsOf` 返回整局可见历史，不是本次动作增量**；RFC §2.2 的 `{ version, events }` 未明确是增量还是全量 | **非阻塞（契约 / 性能）**：明确契约，或只返回 `result.events` 的可见子集；补相应 HTTP 用例 |

---

### 7. 最终判断

- **Overall Risk Level: High**
- **Summary**：B1 / B2 / B3 的行为修复都成立，B5 的「保留记录 + 410」与 retention 作用域也成立；但 B1 的 HTTP 回归测试是空心的（路由回退仍全绿），B5 修复在超限时反复释放第 1 局（24 局探针只释放 1 局），而 Round 1 的 B4 / C-61 仍未闭合（AC-2 / 3 / 7 / 8 / 13 / 14 / 15 的变异仍绿，AC-13 测试仍断言相反行为）。因此本轮不能标为 Reviewed。
- **Blocking Issues**：
  1. **C-65** B1 的 HTTP 回归测试不设防（`SEC-5` / `TEST-1`）。
  2. **C-66** B5 超限释放只重复释放第 1 局（Q-008-3 / F37 AC-3）。
  3. **C-67** B4 / C-61：AC-2 / 3 / 7 / 8 / 13 / 14 / 15 仍无有效断言，AC-11 仅 PARTIAL。
- **Improvement Suggestions**（非阻塞）：
  1. N-R2-1：补 C-68 的双会话 retention 用例。
  2. N-R2-2：公开路由拒绝 `START`（服务端内部 action），或不把 `REJECTED` 当成功并推进 `version`；至少记录该契约。
  3. N-R2-3：`visibleEventsOf` 只返回本次动作的增量，或明确「全量可见历史」契约（C-70）。
  4. N-R2-4：清理 `snapshot?: unknown`、`applied` 无上限、`SESSION_TTL_MS` 的服务端清理、响应 Zod schema、`as never`。
  5. N-R2-5：按实际测试重写 RFC §8.4 的 AC 证据，删除或补齐 §8.8；同步 TEST-STRATEGY 基线（482）与 README 状态。

- **状态**：`RFCS.md` → **`Changes requested`**；`FEATURES.md` 没有 Status 列，未改。**本评审没有修改任何产品代码，也没有 `git commit`；所有探针改过的文件已从 `/tmp/howl-probe-backup-round2-src/` 恢复，临时测试文件已删除，工作树 clean。**
