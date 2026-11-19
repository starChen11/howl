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

---

## Round 3 -- 2026-11-19

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **分支 / HEAD**：`main` / `1f1c59d`（评审开始时 `git status --porcelain` 无输出）。
> **复核范围**：用户指定的 C-65 / C-66 / C-67，以及 C-67 声称已换掉的 AC-2 / 3 / 7 / 8 / 13 / 14 / 15 判据。C-65 / C-66 只做反向探针确认已关闭；Round 1 / 2 已关闭的 C-59 / C-60 / C-62 行为修复与 C-64 / C-69 / C-70 非阻塞文档项不重查。
> **结论**：**Changes requested**
> **整体风险**：**High**

### 0. STEP 0 · 门禁实跑（本轮 HEAD）

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `1f1c59d`，评审开始时工作树 clean。

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
 Test Files  59 passed (59)
      Tests  490 passed (490)
TEST_EXIT=0

$ pnpm build
✓ 14 modules transformed.
✓ 38 modules transformed.
dist/server/index.js  82.80 kB │ gzip: 27.86 kB
BUILD_EXIT=0
```

`pnpm test:e2e` 未跑：RFC-008 只改服务端路由 / 存储 / 共享类型，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位，与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、可见性、安全、接口与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright。

**探针后的复跑**：所有变异探针从 `/tmp/howl-probe-backup-round3-src/` 的文件备份恢复（**没有使用 `git checkout`**），没有新建临时测试文件；随后全量 `pnpm test` 复跑 **59 files / 490 tests 全绿**，`git status --porcelain` 为空。

---

### 1. 用户指定复核的三项

#### 1.1 C-65 · B1 的 HTTP 回归测试：**关闭**

反向探针把 `src/server/routes/games.ts:146` 改回 `events: result.events`，跑 `strengthen.test.ts + resume.test.ts`：

```
Test Files  1 failed | 1 passed (2)
     Tests  1 failed | 15 passed (16)
```

失败点正是新用例 `strengthen.test.ts:160-164`，diff 里出现：

```
+ PHASE_CHANGED  visibleTo: "server"  { from: "NIGHT_WITCH", to: "NIGHT_RESOLVE" }
+ PLAYER_DIED    visibleTo: "server"  { cause: "wolf", seat: 3 }
```

这说明 seed 15 / 座位 1 女巫这条路径确实经玩家自己的 `WITCH_ACT` 产生 server 事件，过滤接线被真实测到了。**C-65 关闭**；不是只测 helper 的单测。

#### 1.2 C-66 · 超限释放逐个来：**关闭**

把 `src/server/store/game-registry.ts:129-135` 改回「只释放 `session.gameIds[0]`」，跑 `strengthen.test.ts`：

```
× 开到上限 +2 局后，持有事件的局数不超过上限
AssertionError: expected 21 to be less than or equal to 20
```

新实现挑「最旧的、仍持有事件流的那一局」，22 局时前两局都释放。**C-66 关闭**，22 局用例有效。

#### 1.3 C-67 · 弱断言强化：**部分关闭**

已确认变红的三条：

| AC | 探针 | 结果 |
|---|---|---|
| 2 | `step.ts` 的 `GAME_STARTED.seed = action.seed + 1` | **红**：`expected 778 to be 777`（`strengthen.test.ts:35`） |
| 3（引擎层） | `GAME_STARTED.mode` 硬编码 `'slaughter-side'` | **红**：`Received: "slaughter-side"`（`strengthen.test.ts:36`） |
| 14 | `enforceRetention` 改成保留 `KEEP_FULL_EVENTS + 1` 局 | **红**：`expected 4 to be less than or equal to 3`（`strengthen.test.ts:215`） |
| 15 | replay 的 `404` 改 `200` | **红**：`expected 200 to be 404`（`strengthen.test.ts:238`） |

但仍有三条关键缺口：

**C-67-a · AC-3 的 HTTP 路径没有被测到。** `strengthen.test.ts:24-39` 直接调 `registry.createGame(session, { mode: 'slaughter-all', seed: 777 })`，绕过了 `POST /api/games`。把 `src/server/routes/games.ts:48` 改成：

```ts
const record = await registry.createGame(session, { ...parsed.data, mode: 'slaughter-side' });
```

`strengthen.test.ts + session.test.ts` 仍然 **18/18 全绿**。`session.test.ts:76-92` 的 AC-3 用例仍只断言 `GET` 返回 200，没有读 `GAME_STARTED.mode`。也就是说，「创建请求指定 mode → 事件里是它」这条 AC 的**请求入口**可以整段坏掉而不被发现。

**C-67-b · AC-8 仍不检查 action 是否成功。** `strengthen.test.ts:77-166` 只断言 `statusCode === 200`、`events.length > 0`、响应无 `server` 事件。把 `src/engine/phases/night.ts:200-202` 的 `'none'` 分支改成恒返回 `rejectionDraft`，跑 `strengthen.test.ts`：

```
Test Files  1 passed (1)
     Tests  8 passed (8)
```

`REJECTED` 也是 `200`、也非空、也不是 `server` 事件，所以「动作成功」没有被断言。这正是 Round 2 P-R2-9 的同类问题，只是换了动作。`resume.test.ts:74-99` 的 200 + `version` 更大同样不能区分「接受」与「拒绝」（`REJECTED` 也推进 `seq`）。

**C-67-c · AC-13 仍然没测 FINISHED / 释放。** `strengthen.test.ts:168-182` 用的是 `createGame` 刚创建出来的 **active** 记录，只证明两次 `stateOf` 深相等；没有 `finished` 状态，也没有 `release`。按 C-61 的原始验法，只给 finished 记录加一个普通对象缓存（`release` 不失效）：

```ts
private readonly stateCache: Record<string, ReturnType<typeof replay> | undefined> = {};
// stateOf: record.status === 'finished' 时读/写 stateCache；active 仍 replay
```

跑**全量** `pnpm test`：

```
Test Files  59 passed (59)
     Tests  490 passed (490)
```

全套仍然绿。`store.test.ts:73-91` 也仍在断言「release 后 `stateOf` 抛错」，与 AC-13 的「重新 replay 得到同一状态」相反；RFC §8.4 仍把它当 AC-13 的 PASS 证据。**C-61 没有任何变化**，C-67 的 AC-13 部分没有闭合。

**AC-7 只做了部分强化（非阻塞）：** `strengthen.test.ts:41-75` 只对默认 `playerSeat = 1` 与 `project()` 深度相等；`resume.test.ts:55-72` 的 9 个席位仍只数 `"role":`。在路由里只对 `playerSeat === 2` 加 `allRoles: state.seats.map(s => s.role)`（值里没有 `"role":` 字面量），`strengthen + resume` **16/16 绿**。AC-7 字面要求「对 9 个 `playerSeat` 各验证一次」，目前只有一个席位是深度比较。

**AC-11 仍为 PARTIAL（非阻塞）：** `store.test.ts:49-58` 仍只让 `GameRegistry` 的 4 个方法跑在 `MockStore` 上；`session.test.ts` / `resume.test.ts` 的路由测试仍用 `InMemoryMetaStore`，没有做到 AC-11 的「替换后全部会话相关测试通过」。

---

### 2. 逐条验收标准：哪个测试会红

> C-59 / C-60 / C-62 的代码修复已在 Round 2 复核通过，C-65 / C-66 本轮已用反向探针确认关闭；下表对它们只做承接，不重复探针。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `session.test.ts:27-54`：同一 cookie 三局、`games` 长度 3 且是数组 | 删类型字段会编译失败 | **PASS**（承接） |
| 2 | `session.test.ts:56-74` 断言响应 seed；`strengthen.test.ts:24-39` 断言 `record.seed === GAME_STARTED.seed` | seed +1 探针 → 红 | **PASS** |
| 3 | `strengthen.test.ts:24-39` 用 registry 创建并断言 `GAME_STARTED.mode`；`session.test.ts:76-92` 仍只 GET 200 | 引擎改 mode → 红；**路由强写 mode → 18/18 绿** | **FAIL（入口未覆盖）** |
| 4 | `session.test.ts:94-111`：`HttpOnly` / `SameSite=Lax` / `Path=/`，id ≥32 | 删 `HttpOnly` → 红 | **PASS**（承接） |
| 5 | `resume.test.ts:33-53`：两次独立 `inject` 的 `version` 与 `view` 深相等 | 改任一值 → 红 | **PASS**（承接） |
| 6 | 同 AC-5（两次独立调用，不共享客户端内存） | 同 AC-5 | **PASS**（承接） |
| 7 | `strengthen.test.ts:41-75` 只深比 seat 1；`resume.test.ts:55-72` 对 9 席数 `"role":` | 通用泄漏（seat 1）→ 红；**seat 2 专属 `allRoles` → 16/16 绿** | **PARTIAL** |
| 8 | `strengthen.test.ts:77-166` 提交真实 `WITCH_ACT`，只断言 200 / 非空 / 无 server | **`WITCH_ACT` 恒拒绝 → 8/8 绿** | **FAIL** |
| 9 | `resume.test.ts:101-141`：重复 → `ALREADY_APPLIED`；旧版本换动作 / 未来版本 → `VERSION_MISMATCH` | 去掉 `ALREADY_APPLIED` → 红 | **PASS**（承接） |
| 10 | `session.test.ts:114-155`：他人 id 与不存在 id 的 404 JSON 相等 | 改 404 为 403 / 换 message → 红 | **PASS**（承接） |
| 11 | `store.test.ts:49-58` 只让 registry 的 4 个方法跑在 `MockStore` 上；路由测试仍用 `InMemoryMetaStore` | 没有「全部会话相关测试」跑在第二实现上 | **PARTIAL** |
| 12 | `store.test.ts:61-71` 扫 `src/server` 的模块级 `new Map`，排除 `meta-store.ts` | 加 `Map` → 红；对象缓存仍可逃（见 AC-13） | **PASS（按 AC 字面）** |
| 13 | `strengthen.test.ts:168-182` 用 **active** 记录做两次 `stateOf`；`store.test.ts:73-91` 仍断言 release 后抛错 | **finished 普通对象缓存（release 不失效）→ 全量 59/490 绿** | **FAIL** |
| 14 | `strengthen.test.ts:184-219` 真的开 100 局；`session.test.ts:183-186` 钉住 `KEEP_FULL_EVENTS === 3` | 保留 4 局 → 红（4 > 3）；改常量 → 常量用例红 | **PASS** |
| 15 | `strengthen.test.ts:221-241` 断言 replay `404` + `NOT_FINISHED`；`session.test.ts:157-181` 断言 stream `501` | replay 改 200 → 红 | **PASS** |
| 16 | `session.test.ts:189-208` 黑名单 7 个数据库驱动；当前依赖确实没有 | 新增别的驱动可逃，但 AC 只要求不存在数据库驱动 | **PASS**（承接） |

统计：**PASS 11（1 / 2 / 4 / 5 / 6 / 9 / 10 / 12 / 14 / 15 / 16）**，**FAIL 3（3 / 8 / 13）**，**PARTIAL 2（7 / 11）**。C-67 不能关闭。

---

### 3. 变异探针清单

所有注入都用精确字符串替换并断言目标存在；每个探针结束后从 `/tmp/howl-probe-backup-round3-src/` 的原始文件恢复（没有使用 `git checkout`），没有遗留临时文件；最终 `git status --porcelain` 为空，全量套件复跑 **59 files / 490 tests 全绿**。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P-R3-1 | `routes/games.ts:146` 改回 `events: result.events` | `strengthen + resume` | **红 1**（1 failed / 15 passed） | C-65 关闭 |
| P-R3-2 | 超限改回只释放 `gameIds[0]` | `strengthen.test.ts` | **红 1**（21 > 20） | C-66 关闭 |
| P-R3-3 | `enforceRetention` 改回扫全局 `game:` | `strengthen.test.ts` | **红 1**（C-68：A 的 events 变 0） | C-68 关闭 |
| P-R3-4 | `GAME_STARTED.seed = action.seed + 1` | `strengthen + session + resume` | **红 1**（778 ≠ 777） | AC-2 有效 |
| P-R3-5 | `GAME_STARTED.mode` 硬编码 `'slaughter-side'` | `strengthen + session` | **红 1**（mode 不符） | AC-3 引擎侧有效 |
| P-R3-6 | 路由创建时强写 `mode: 'slaughter-side'` | `strengthen + session` | **绿 18/18** | **AC-3 的 HTTP 入口无效** |
| P-R3-7 | 路由只对 `playerSeat === 2` 加 `allRoles` | `strengthen + resume` | **绿 16/16** | **AC-7 只有 seat 1 深度比较** |
| P-R3-8 | `WITCH_ACT` 的 `'none'` 分支恒拒绝 | `strengthen.test.ts` | **绿 8/8** | **AC-8 不检查动作成功** |
| P-R3-9 | finished 记录加普通对象状态缓存（release 不失效） | 全量 `pnpm test` | **绿 59/490** | **AC-13 无回归锁；C-61 仍 Open** |
| P-R3-10 | `enforceRetention` 保留 `KEEP_FULL_EVENTS + 1` | `strengthen + store` | **红 2**（4 > 3） | AC-14 有效 |
| P-R3-11 | replay 的 `404` 改 `200` | `strengthen + session` | **红 1**（200 ≠ 404） | AC-15 有效 |

### 4. 行为探针（只读，未留文件）

| # | 探针 | 观察 |
|---|---|---|
| T-R3-1 | 按 seed 15 推进到 `NIGHT_WITCH`，玩家座位 1（witch）经路由提交 `WITCH_ACT potion:'none'` | 过滤后只返回 public 事件；路由回退 raw 时出现 `PHASE_CHANGED(server)` 与 `PLAYER_DIED(server)`（死者 seat 3） |
| T-R3-2 | 单会话 22 局 | 前两局 events 为空，其余 20 局持有 events；`session.gameIds` 仍 22 条 |
| T-R3-3 | 会话 A 一局 finished；会话 B 5 局 finished 并逐次 `enforceRetention(B)` | A 的 events 仍 >0；把 retention 改回全局扫描后 A 变 0 |
| T-R3-4 | finished 记录加入普通对象缓存后跑全量 | 59 files / 490 tests 全绿，说明 AC-13 的「不缓存」没有测试保护 |

---

### 5. 维度结论

#### 5.1 RFC ADHERENCE — NEEDS WORK

- **正确修复**：C-65（B1 的 HTTP 回归锁）与 C-66（逐局释放）都成立，且反向探针会红；AC-14 / AC-15 的强化成立。
- **未闭合**：AC-3 只测到 registry 层，`POST /api/games` 的入口可以忽略 `mode` 而全绿；AC-8 的「成功」仍不可区分 `REJECTED`；AC-13 的 FINISHED / release 语义仍未测。AC-7 只对一个席位做深度比较；AC-11 仍是 PARTIAL。
- **文档与声明不一致**：RFC §8.8 说 AC-2/3/7/8/13/14/15「全部换成改坏会红」，实际 AC-3（入口）、AC-7（9 席深度）、AC-8（成功）、AC-13（FINISHED）四项不成立；§8.4 的 AC-13 证据行仍是旧的「释放后 stateOf 抛错」。属 DOC-1 / C-69 的延续。
- §2.2 的 `{ version, events }` 仍返回整局可见历史（C-70，非阻塞）；§2.5 的 20 局上限释放语义在本轮已按 C-66 修正。

#### 5.2 RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `ARCH-7` | **PASS**（承接）：路由只经 `GameRegistry`，`MetaStore` 是唯一出口 |
| `ARCH-9` | **PASS**（承接）：公开路由绑定玩家席位 |
| `ARCH-10` | **PASS（结构）**：`gameIds` 一对多；超限释放已逐个进行 |
| `API-1` | **PARTIAL**（承接）：请求有 Zod；响应类型仍是纯 interface |
| `API-3` | **PASS**（承接）：重复 action 不重复推进 |
| `SEC-1` | **PASS**：本 RFC 无密钥路径 |
| `SEC-5` | **PASS（行为 + 回归锁）**：B1 过滤成立；C-65 的 HTTP 用例本轮已能变红 |
| `DATA-6` | **PARTIAL**：release 清 events；`applied` 不清、finished 状态缓存无回归锁（C-73）、无 7 天服务端清理 |
| `DOC-1` | **PARTIAL**：§8.8 的「全部换成」与 §8.4 的旧 AC-13 证据过强；D-1 仍缺用户同意（承接） |
| `TEST-1` | **FAIL**：AC-3 / 8 / 13 无有效断言；AC-7 / 11 PARTIAL |
| `STYLE-*` | **PASS**：新文件 309 行 <400、kebab-case、具名导出；`as never` 仍在（承接） |

#### 5.3 SECURITY — PASS（行为；无新泄漏）

- B1 的过滤行为成立，且 C-65 关闭后 HTTP 层已有能变红的回归锁（P-R3-1 证明 raw 响应会带 `PLAYER_DIED(server)`）。
- B2 席位绑定、B3 生产 `Secure` 仍在（承接 Round 2，未重查）。
- 他人 `gameId` 与不存在 id 的 404 相等；`GET` 视图仍由 `project()` 生成；错误响应不含 LLM 原文；无账号 / 数据库 / 密钥路径。
- 非阻塞旧观察仍在：无 seat 的 `START` 可经公开路由提交并推进 `seq`（N-R2-2），本 RFC 未处理。

#### 5.4 PERFORMANCE — PASS（有非阻塞提示）

- `POST /actions` 的 `visibleEventsOf` 仍每次重放整局并返回整局可见历史（C-70）；单局几百条事件，成本可接受，但响应随局长度增长。
- C-66 的逐局释放每次创建最多扫描整个 `gameIds`（22 局场景可忽略；100 局探针 39ms）。`gameIds` 与 `applied` 仍随局数线性增长，属 F37 的已知口径问题。
- `GET /api/session` 每个 gameId 一次 `store.get`；当前列表无上限。没有发现新的 N+1 或热路径问题。

#### 5.5 MAINTAINABILITY — NEEDS WORK

- **测试命名与断言不一致**：`strengthen.test.ts:168-182` 名为「终局状态每次都重新 replay」，实际是 active 记录；`strengthen.test.ts:24-39` 名为「响应里的 seed 与 mode」，实际没有 HTTP 响应；`strengthen.test.ts:77-166` 同时承担 C-65 和 AC-8 两个目标，导致 AC-8 的成功断言被 C-65 的「无 server 事件」掩盖。
- **RFC / TEST-STRATEGY 漂移**：`TEST-STRATEGY.md:32-37` 仍写 `Tests 449` 与「其余 15 个 RFC proposed」；RFC-008 计划表写的 `tests/server/projection-leak.test.ts` / `tests/server/actions.test.ts` 不存在，实际文件是 `session/resume/store/strengthen`；`strengthen.test.ts` 未登记。C-69 保持 Open（非阻塞）。
- `snapshot?: unknown`、`applied` 无上限、响应 schema 缺失、`as never` 类型逃逸仍是承接项。

---

### 6. 冲突登记（已写入 `RFCS.md` §8.22）

| # | 冲突 | 判定 |
|---|---|---|
| C-71 | **AC-3 的 HTTP 入口无有效断言**：`strengthen.test.ts:24-39` 绕过路由；路由强写 `mode` 后 18/18 绿 | **阻塞（TEST-1）**：通过 `POST /api/games` 创建 `slaughter-all` 并断言记录的 `GAME_STARTED.mode` |
| C-72 | **AC-8 不检查动作成功**：`WITCH_ACT` 恒拒绝仍 8/8 绿；`REJECTED` 也是 200 + 非空 + 无 server | **阻塞（TEST-1）**：断言无 `REJECTED`，且出现接受后的具体事件 / 相位推进 |
| C-73 | **AC-13 仍未测 FINISHED / release**：finished 普通对象缓存下全量 59/490 绿；`store.test.ts:73-91` 仍断言相反行为 | **阻塞（TEST-1 / C-61）**：用真实 FINISHED 局面 + 释放后重建断言 |
| C-74 | **AC-7 只对 1 个席位做深度比较**：seat 2 专属 `allRoles` 下 16/16 绿；9 席仍是 `"role":` 计数 | **非阻塞（测试证据）**：把深度比较循环到 9 席 |
| C-75 | **AC-11 的第二实现仍只在 registry 层**：4 个方法跑 MockStore，路由测试仍用 InMemory | **非阻塞（Should）**：参数化路由测试或明确 AC-11 口径 |

---

### 7. 最终判断

- **Overall Risk Level: High**
- **Summary**：Round 2 修复的三个目标里，C-65 与 C-66 已真正关闭，AC-2 / 14 / 15 也换成了会变红的判据；但 C-67 只完成了一半：AC-3 的 HTTP 入口、AC-8 的动作成功、AC-13 的 FINISHED / 释放后重建仍可用变异探针全绿，其中 finished 状态缓存甚至让全量 490 个用例保持绿色。AC-7 只做了 1/9 席位的深度比较，AC-11 仍为 PARTIAL。因此 RFC-008 不能标为 Reviewed，C-61 也继续 Open。
- **Blocking Issues**：
  1. **C-61 / C-73** AC-13 的 FINISHED + release 无回归锁（全量套件对 finished 缓存不设防）。
  2. **C-67 / C-72** AC-8 不区分「动作成功」与 `REJECTED`。
  3. **C-67 / C-71** AC-3 的路由入口未覆盖。
- **Improvement Suggestions**（非阻塞）：
  1. N-R3-1：AC-7 的 `project()` 深度比较循环到 9 个 `playerSeat`，不要只测默认席位。
  2. N-R3-2：AC-11 把 `buildApp({ store })` 的路由测试参数化到 `MockStore`，闭合「全部会话相关测试」。
  3. N-R3-3：更新 RFC §8.4 / §8.8 与 TEST-STRATEGY（基线 490、`strengthen.test.ts`、实际测试文件）；C-69 保持非阻塞。
  4. N-R3-4：C-70（动作响应是全量可见历史）与 N-R2-2（无 seat 的 `START`）继续作为契约 / 防滥用项处理。
  5. N-R3-5：`snapshot?: unknown`、`applied` 无上限、响应 Zod schema、`as never` 继续承接。

- **状态**：`RFCS.md` → **`Changes requested`**；`FEATURES.md` 没有 Status 列，未改。**本评审没有修改任何产品代码，也没有 `git commit`；所有探针改过的文件已从 `/tmp/howl-probe-backup-round3-src/` 恢复（未用 `git checkout`）。`git status` 只显示本评审修改的 `reviews/REVIEW-RFC-008.md` 与 `RFCS.md`，产品代码无 diff。**

## Round 4 -- 2026-11-19

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **分支 / HEAD**：`main` / `a5b3cb8`（评审开始时 `git status --porcelain` 无输出）
> **复核范围**：用户指定的 C-71 / C-72 / C-73（阻塞）与 C-74 / C-75（非阻塞）。C-59 / C-60 / C-62 / C-65 / C-66 / C-68 等已关闭项按用户要求不重查；本轮只对它们做承接。
> **结论**：**Changes requested**
> **整体风险**：**High**

### 0. STEP 0 · 门禁实跑（本轮 HEAD）

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `a5b3cb8`，评审开始时工作树 clean。

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
 Test Files  59 passed (59)
      Tests  495 passed (495)
TEST_EXIT=0

$ pnpm build
✓ 14 modules transformed.
✓ 38 modules transformed.
dist/server/index.js  82.80 kB │ gzip: 27.86 kB
BUILD_EXIT=0
```

`pnpm test:e2e` 未跑：RFC-008 只改服务端路由 / 存储 / 共享类型，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位，与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、可见性、安全、接口与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright。

**探针后的复跑**：所有变异探针从 `/tmp/howl-round4-backup-src/` 的文件备份恢复（**没有使用 `git checkout`**），每个恢复点都用 `md5` 与备份比对；没有新建临时测试文件。恢复后全量 `pnpm test` 复跑 **59 files / 495 tests 全绿**，`git status --porcelain` 为空。

---

### 1. 用户指定复核的五项

#### 1.1 C-71 · AC-3 的 HTTP 入口：**关闭**

新用例 `tests/server/strengthen.test.ts:311-331` 走 `POST /api/games`（payload `mode: 'slaughter-all'`, `seed: 321`），再用同一个 `store` 读回记录，断言 `GAME_STARTED.payload.mode` 与 `record.mode` 都是 `slaughter-all`。

反向探针 P-R4-1 把路由 `src/server/routes/games.ts:48` 改成强写 `mode: 'slaughter-side'`：

```
× POST /api/games 传 slaughter-all → 事件的 payload.mode 也是 slaughter-all
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

请求入口到事件载荷的链路已被真实测到。**C-71 关闭。**（`session.test.ts:76-92` 的旧 AC-3 用例仍只断言 GET 200，但它已不是唯一证据，不阻塞。）

#### 1.2 C-72 · AC-8 的「动作被接受」：**关闭（有非阻塞残项）**

新用例 `tests/server/strengthen.test.ts:333-413` 用 seed 15 推进到 `NIGHT_WITCH`，由玩家座位 1 经 HTTP 提交 `WITCH_ACT potion:'none'`，断言 `statusCode === 200`、响应里没有 `REJECTED`、`version` 前进。把 `src/engine/phases/night.ts:200-202` 的 `'none'` 分支改成恒返回 `rejectionDraft`（P-R4-2）：

```
× WITCH_ACT(none) 的响应里没有 REJECTED，且 version 前进
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

原先「`REJECTED` 也是 200 + 非空 + 无 server 事件」的恒真问题已经消除。**C-72 关闭**，但残项登记为 N-R4-1：用例只证明「不是拒绝 + 版本推进」，没有断言动作被接受后的具体效果（相位进入 `NIGHT_RESOLVE`、或出现对应的公开事件）。探针 P-R4-2b 让 `WITCH_ACT(none)` 返回一条 `PHASE_CHANGED('NIGHT_WITCH' → 'NIGHT_WITCH')`——版本推进、没有 `REJECTED`、但动作实际是空转——该用例仍然绿：

```
✓ ... 没有 REJECTED ...
 Test Files  1 passed (1)
      Tests  1 passed | 12 skipped (13)
```

AC-8 的字面判据是「提交成功，返回的新 `version` 大于旧值」，所以这条不阻塞；但建议把「动作真的推进了相位」纳入断言。

#### 1.3 C-73 · AC-13 的 FINISHED / 不缓存：**未关闭（阻塞）**

用户说本轮补了「终局记录的 no-cache 用例」。新增用例确实存在（`tests/server/strengthen.test.ts:415-432`），但**没有构造任何终局对局，也没有释放**：

- `stored` 只是 `registry.getGame()` 从内存存储取出的副本，`:423` 把它的 `status` 字段改成 `'finished'`；该局的实际 `phase` 仍是 `NIGHT_WOLF_CHAT`，事件流没有任何终局事件；
- 没有第二次 HTTP `GET`，没有 `release()`，没有「缩短 / 清空 events 后 `stateOf` 必须反映」的检查。

按 Round 3 的原始验法，只给 finished 记录加普通对象缓存（release 不失效），跑 **P-R4-3**：

```
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ pnpm test
 Test Files  59 passed (59)
      Tests  495 passed (495)
```

全套仍然绿。**C-73 没有闭合，C-61 继续 Open（阻塞）。**

更具体地，`:430-431` 的「改返回值不影响下一次」断言在缓存实现下是空转的：

```ts
(registry.stateOf(stored) as { day: number }).day = 99;
expect(registry.stateOf(stored).day).toBe(first.day);
```

若 `stateOf` 对同一 `gameId` 返回同一个缓存对象，`first` 与 `registry.stateOf(stored)` 是**同一个引用**；`day = 99` 同时改掉了 `first.day`，于是 `99 === 99` 恒真。即使缓存返回克隆，该断言也无法区分「每次 replay」与「每次克隆缓存」。真正能锁定 AC-13 的只有两种证据之一：**改事件流后 `stateOf` 必须跟着变**，或**可计数的 replay 调用次数**。

另外，用户说「把 `store.test.ts` 那条改名以区分语义」，本轮提交**没有改这个文件**：

```
$ git diff 1f1c59d..a5b3cb8 -- tests/server/store.test.ts | wc -l
       0
$ git show a5b3cb8 --name-only --format=""
README.md
RFCS.md
RFCs/RFC-008-session-store-and-resume.md
tests/server/strengthen.test.ts
```

`tests/server/store.test.ts:73` 仍是 `describe('AC-13 · 释放后按需重建')`，`:89` 仍是 `expect(() => registry.stateOf(released)).toThrow()`；用例标题里的「重新放回事件则语义恢复」在正文没有对应操作。`RFCs/RFC-008-session-store-and-resume.md:263`（§8.10）声称「把 `store.test.ts` 那条用例改名」，与提交内容不符；同一文件 `:200`（§8.4）的 AC-13 证据仍是旧的「释放后 `stateOf` 无法重建」。这三处属于 DOC-1 的延续，登记在 C-69 / C-73 下。

建议的闭合方式（与 Round 3 相同）：

1. 用真实 `FINISHED` 局面（保留在最近 3 局内），两次独立 `GET /api/games/:id` 断言 `version` 与 `view` 深相等；
2. 在同一局上把 `events` 缩短 / 清空后，断言 `stateOf` 反映新事件流（或抛错），证明没有缓存；
3. 释放语义（清 events → 410）保持独立用例，不要当 AC-13 的证据；
4. 若认为 AC-13 原文与 §2.5 矛盾，走 `/manage-changes` 修订 AC 文字，而不是只在 §8.10 写说明。

#### 1.4 C-74 · AC-7 的非默认席位：**seat 2 已锁；AC-7 仍 PARTIAL（非阻塞）**

新用例 `tests/server/strengthen.test.ts:456-484` 用 `playerSeat: 2` 创建对局，把路由 `view` 与 `project()` 的输出深度比较。反向探针 P-R4-4 只在 `playerSeat === 2` 时往 `view` 里塞 `allRoles`：

```
× playerSeat = 2 时，路由的 view 仍与 project() 深度相等（不是只对 1 号生效）
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 20 passed (21)
```

seat 2 的专属泄漏已被真实测到。**C-74 的修复成立**。但 AC-7 字面要求「对 9 个 `playerSeat` 各验证一次」，`tests/server/resume.test.ts:56-71` 的 9 席循环仍只数 `"role":` 的出现次数，没有逐席深度比较；`strengthen.test.ts` 只深度比较 seat 1 与 seat 2。剩余 7 席的专属字段泄漏仍无回归锁，按原判 **PARTIAL / 非阻塞**。

#### 1.5 C-75 · AC-11 的第二实现：**部分修复（非阻塞）**

新用例 `tests/server/strengthen.test.ts:436-453`：

- `class SecondStore extends InMemoryMetaStore {}` 只是内存实现的空子类，不是 `store.test.ts` 里那个真正独立的 `MockStore`（JSON 序列化、行为不同）；
- 用例名写「创建 + 读取 + **提交**都正常」，正文只做了创建与读取，**没有提交 action**。

反向探针 P-R4-5b 让 `src/server/app.ts` 完全忽略 `options.store`（恒用 `new InMemoryMetaStore()`），单独跑这条用例：

```
✓ |unit| tests/server/strengthen.test.ts (13 tests | 12 skipped)
 Test Files  1 passed (1)
      Tests  1 passed | 12 skipped (13)
```

也就是说，这条用例无法发现「注入被静默忽略」。同一次探针下 `strengthen` 的其他用例会红（它们断言的是同一个 `store`），所以「注入确实被使用」并非完全没有覆盖；但 C-75 想证明的「第二个实现替换后路由仍工作」仍不成立。**保持 PARTIAL / 非阻塞**；建议把 `session` / `resume` / `strengthen` 的路由测试参数化到 `MockStore`，或至少把这条用例改成真正使用 `MockStore` 并补一次提交。

---

### 2. 逐条验收标准：哪个测试会红

> C-59 / C-60 / C-62 / C-65 / C-66 / C-68 已在前轮关闭，本轮按要求不重查；下表对它们只做承接。AC-1 / 2 / 4 / 5 / 6 / 9 / 10 / 12 / 14 / 15 / 16 也沿用前轮证据，本轮没有改动。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `session.test.ts:27-54`：同一 cookie 三局、`games` 长度 3 且是数组 | 删类型字段会编译失败 | **PASS**（承接） |
| 2 | `session.test.ts:56-74` + `strengthen.test.ts:24-39`：响应 seed 与 `GAME_STARTED.payload.seed` 一致 | seed +1 探针 → 红 | **PASS**（承接） |
| 3 | `strengthen.test.ts:311-331`：`POST /api/games` 传 `slaughter-all`，读回事件与记录的 mode | 路由强写 mode → 红（P-R4-1） | **PASS**（本轮闭合） |
| 4 | `session.test.ts:94-111`：`HttpOnly` / `SameSite=Lax` / `Path=/`，id ≥32 | 删 `HttpOnly` → 红 | **PASS**（承接） |
| 5 | `resume.test.ts:33-53`：两次独立 `inject` 的 `version` 与 `view` 深相等 | 改任一值 → 红 | **PASS**（承接） |
| 6 | 同 AC-5（两次独立调用，不共享客户端内存） | 同 AC-5 | **PASS**（承接） |
| 7 | `strengthen.test.ts:41-75` / `:456-484` 深比 seat 1 / 2；`resume.test.ts:56-71` 对 9 席数 `"role":` | seat 1 / 2 专属泄漏 → 红；其余 7 席仍只计数 | **PARTIAL** |
| 8 | `strengthen.test.ts:333-413`：真实 `WITCH_ACT(none)`，无 `REJECTED` 且 `version` 前进 | 恒拒绝 → 红（P-R4-2）；空转但版本推进 → 绿（P-R4-2b） | **PASS**（残项 N-R4-1） |
| 9 | `resume.test.ts:101-141`：重复 → `ALREADY_APPLIED`；旧版本换动作 / 未来版本 → `VERSION_MISMATCH` | 去掉 `ALREADY_APPLIED` → 红 | **PASS**（承接） |
| 10 | `session.test.ts:114-155`：他人 id 与不存在 id 的 404 JSON 相等 | 改 404 为 403 / 换 message → 红 | **PASS**（承接） |
| 11 | `store.test.ts:49-58` 让 `MockStore` 跑 registry 的 4 个方法；`strengthen.test.ts:436-453` 只把空子类注入路由 | 注入被忽略时该用例仍绿（P-R4-5b） | **PARTIAL** |
| 12 | `store.test.ts:61-71` 扫 `src/server` 的模块级 `new Map`，排除 `meta-store.ts` | 加 `Map` → 红；对象缓存仍可逃（见 AC-13） | **PASS（按 AC 字面）** |
| 13 | `strengthen.test.ts:415-432` 只翻副本的 `status`，不产生 FINISHED、不 GET、不 release；`store.test.ts:73-89` 仍断言 release 后抛错 | **finished 普通对象缓存（release 不失效）→ 全量 59/495 绿（P-R4-3）** | **FAIL** |
| 14 | `strengthen.test.ts:184-219` 真的开 100 局；`session.test.ts:183-186` 钉住常量 | 保留 4 局 → 红 | **PASS**（承接） |
| 15 | `strengthen.test.ts:221-241` 断言 replay `404` + `NOT_FINISHED`；`session.test.ts:157-181` 断言 stream `501` | replay 改 200 → 红 | **PASS**（承接） |
| 16 | `session.test.ts:189-208` 黑名单 7 个数据库驱动 | 当前依赖确实没有 | **PASS**（承接） |

统计：**PASS 13（1 / 2 / 3 / 4 / 5 / 6 / 8 / 9 / 10 / 12 / 14 / 15 / 16）**，**PARTIAL 2（7 / 11）**，**FAIL 1（13）**。C-67 的 AC-3 / AC-8 部分本轮闭合；AC-13 仍未闭合。

---

### 3. 变异探针清单

所有注入都用精确字符串替换并断言目标存在；每个探针结束后从 `/tmp/howl-round4-backup-src/` 的原始文件恢复（**没有使用 `git checkout`**），没有遗留临时文件；最终 `git status --porcelain` 为空，全量套件复跑 **59 files / 495 tests 全绿**。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P-R4-1 | `routes/games.ts:48` 强写 `mode: 'slaughter-side'` | `strengthen.test.ts` | **红 1**（1 failed / 12 passed） | C-71 关闭 |
| P-R4-2 | `night.ts:201` 的 `WITCH_ACT(none)` 恒返回 `rejectionDraft` | `strengthen.test.ts` | **红 1**（1 failed / 12 passed） | C-72 关闭 |
| P-R4-2b | `WITCH_ACT(none)` 返回 `PHASE_CHANGED(NIGHT_WITCH → NIGHT_WITCH)`（空转但版本推进） | `strengthen.test.ts -t "没有 REJECTED"` | **绿 1/1** | C-72 残项：未断言具体接受事件 |
| P-R4-3 | finished 记录加普通对象缓存（release 不失效） | `strengthen.test.ts` → 13/13；再全量 | **绿 13/13；绿 59/495** | **C-73 未闭合；C-61 仍 Open** |
| P-R4-4 | 路由只对 `playerSeat === 2` 加 `allRoles` | `strengthen + resume` | **红 1**（1 failed / 20 passed） | C-74 的 seat 2 已锁 |
| P-R4-5 | `buildApp` 忽略 `options.store`，恒用 `new InMemoryMetaStore()` | `strengthen + session + resume + store` | **红 5**（5 failed / 32 passed） | 其他用例能发现注入被忽略 |
| P-R4-5b | 同上，只跑 C-75 那条 | `strengthen.test.ts -t "buildApp 注入第二个实现后"` | **绿 1/1** | C-75 这条用例本身不设防 |

补充证据（非变异）：

| # | 探针 | 观察 |
|---|---|---|
| T-R4-1 | `git show a5b3cb8 --name-only` | 只改了 README / RFCS / RFC / `strengthen.test.ts`，**没有 `store.test.ts`** |
| T-R4-2 | `git diff 1f1c59d..a5b3cb8 -- tests/server/store.test.ts` | 0 行；该文件最后一次修改是 `25bfa3a` |
| T-R4-3 | 阅读 `strengthen.test.ts:415-432` | `status` 翻在副本上，phase 仍 `NIGHT_WOLF_CHAT`，没有 FINISHED 事件、GET 或 release |
| T-R4-4 | 阅读 `strengthen.test.ts:436-453` | 名为「创建 + 读取 + 提交」，正文没有提交 |

---

### 4. 其他发现

#### 4.1 STYLE-6：`strengthen.test.ts` 超过 400 行（新引入，非阻塞）

本轮把 `tests/server/strengthen.test.ts` 从 `1f1c59d` 的 309 行增加到 **485 行**；`RULES.md:214` 的 `STYLE-6` 要求「单个文件不超过 400 行，超出必须拆分」。这是本轮修复**新引入**的规则违反（此前 309 行合规）。建议按目标拆成 `strengthen-http.test.ts` / `strengthen-retention.test.ts` 等，或把 C-71 ~ C-75 的用例放到独立文件。登记为 **C-76（非阻塞）**。

> 仓库里还有一个既有的 `tests/engine/death-resolve.test.ts`（443 行）也超过 400 行，但它不属于 RFC-008，且不是本轮引入，本轮不把它算作本 RFC 的阻塞项；建议后续 `/manage-changes` 或对应 RFC 一并处理。

#### 4.2 文档漂移没有收敛（C-69，非阻塞）

- `TEST-STRATEGY.md:33` 仍写 `Tests 449 passed (449)`；计划里的 `tests/server/projection-leak.test.ts` / `tests/server/actions.test.ts` 仍不存在，`strengthen.test.ts` 未登记（`RFC-008` 小节仍写 `existing: tests/server/{session,resume,store}.test.ts`）。
- `RFCs/RFC-008-session-store-and-resume.md:200`（§8.4 AC-13）仍是旧证据；`:263`（§8.10）声称 `store.test.ts` 已改名，实际没有。
- D-1 仍缺 `DOC-1` 要求的「用户是否同意」；`RULES.md:60` 仍登记 `@fastify/cookie 11.1.5`，`package.json` 未安装（C-63）。
- `README.md:11` 在 HEAD 上写「7 个 `Reviewed`、1 个 `Changes requested`、8 个 `Not started`」，而 `RFCS.md` 当时把 RFC-008 标为 `Implemented`；本轮把 RFC-008 改回 `Changes requested` 后，README 的计数重新成立，所以不另立条目。

#### 4.3 C-70 / C-63 / C-64 保持非阻塞

- **C-70**：`POST /actions` 仍返回整局可见历史（`registry.visibleEventsOf(result.record, ...)` 从第一条事件开始过滤，`src/server/routes/games.ts:146`），不是本次动作的增量。没有私有事件泄漏，但响应随局长度增长；契约未在 §2.2 明确。
- **C-63**：手写 cookie 的 `Secure` 生产接线已在前轮修复；`@fastify/cookie` 依赖表与 D-1 用户同意仍是文档项。
- **C-64**：7 天清理仍只有 cookie `Max-Age`，服务端没有 TTL 清理；`snapshot?: unknown`、响应 Zod schema 仍是承接项。

---

### 5. 维度结论

#### 5.1 RFC ADHERENCE — NEEDS WORK

- **本轮真正闭合**：AC-3 的 HTTP 入口（C-71）与 AC-8 的拒绝区分（C-72）都有能变红的回归锁；C-74 的 seat 2 深度比较成立。
- **仍未闭合**：AC-13 的 FINISHED / 不缓存没有有效证据（C-73 / C-61）。新用例只是把副本的 `status` 翻成 `finished`，既没有终局事件也没有 release，finished-only 缓存下全量 59/495 仍绿。
- **部分**：AC-7 仍只有 seat 1 / seat 2 的深度比较；AC-11 的第二实现仍停在空子类 + 创建/读取，未覆盖提交。
- **文档与声明不一致**：§8.10 声称 `store.test.ts` 已改名，提交里没有；§8.4 的 AC-13 证据仍是旧文本。

#### 5.2 RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `ARCH-7` | **PASS**（承接）：路由只经 `GameRegistry`，`MetaStore` 是唯一出口 |
| `ARCH-9` / `ARCH-10` | **PASS**（承接）：公开路由绑定玩家席位；`gameIds` 一对多，超限释放逐个进行 |
| `API-1` | **PARTIAL**（承接）：请求有 Zod；响应类型仍是纯 interface |
| `API-3` | **PASS**（承接）：重复 action 不重复推进 |
| `SEC-1` / `SEC-5` | **PASS**（承接）：本轮无产品代码改动；B1 过滤与 B2 席位绑定未重查，也没有新泄漏路径 |
| `DATA-6` | **PARTIAL**（承接）：release 清 events；`applied` 不清、无 7 天服务端清理 |
| `DOC-1` | **PARTIAL**：§8.10 的「已改名」与提交不符；§8.4 AC-13 证据未回写；D-1 仍缺用户同意 |
| `TEST-1` | **FAIL**：AC-13 仍没有能变红的断言 |
| `STYLE-6` | **FAIL（新引入）**：`tests/server/strengthen.test.ts` 485 行 > 400 |
| `STYLE-1/2/5` | **PASS**：kebab-case、具名导出、无 `any`；`as never` 仍是类型逃生口（承接 N-R2-4） |

#### 5.3 SECURITY — PASS（行为承接，本轮未发现新问题）

- 本轮 `a5b3cb8` **没有修改 `src/`**，只改测试与文档；B1 / B2 / B3 的行为修复未重查，也没有新的攻击面。
- 动作响应仍经 `visibleEventsOf` 过滤；`GET` 视图仍由 `project()` 生成；他人 `gameId` 与不存在 id 的 404 仍相等。
- 非阻塞旧观察仍在：无 `seat` 的 `START` 可经公开路由提交并推进 `seq`（N-R2-2）；C-70 的整局可见历史仍是契约 / 体积问题，不是当前泄漏。

#### 5.4 PERFORMANCE — PASS（承接，有非阻塞提示）

- `visibleEventsOf` 每次动作重放整局并返回整局可见历史（C-70）；单局几百条事件，成本可接受，但响应随局长度增长。
- 100 局探针 21.11s / 全量 495 用例 25.07s，没有出现新的超时或不稳定。
- 没有新增 N+1 或热路径问题。

#### 5.5 MAINTAINABILITY — NEEDS WORK

- **C-73 的用例名与正文不符**：名字是「FINISHED 的对局每次都重新 replay，不缓存」，实际没有 FINISHED；`store.test.ts:73-89` 仍挂在 `AC-13` 下断言相反语义，标题里的「重新放回事件则语义恢复」没有实现。
- **C-75 的用例名与正文不符**：名字写「创建 + 读取 + 提交」，正文没有提交；`SecondStore` 是空子类，不是 AC-11 说的第二个实现。
- **`strengthen.test.ts` 485 行**超出 STYLE-6；本轮新增的 176 行把测试按主题拆开会更易维护。
- **TEST-STRATEGY 漂移**：基线 449 / 计划文件不存在 / `strengthen.test.ts` 未登记（C-69）。
- 承接：`snapshot?: unknown`、`applied` 无上限、响应 schema 缺失、`as never` 类型逃逸。

---

### 6. 冲突登记（已写入 `RFCS.md` §8.23）

| # | 冲突 | 判定 |
|---|---|---|
| C-71 | AC-3 的 HTTP 入口没有有效断言 | **Round 4：关闭**——P-R4-1 红 |
| C-72 | AC-8 不检查动作是否成功 | **Round 4：关闭**——P-R4-2 红；残项 N-R4-1（未断言具体接受事件）非阻塞 |
| C-73 | AC-13 未测 FINISHED / 不缓存 | **Round 4：仍 Open（阻塞）**——P-R4-3 全量 59/495 绿；用例名与正文不符；`store.test.ts` 未改名 |
| C-61 | AC-13 的验收证据与 AC 相反 | **仍 Open（阻塞）**——C-73 未闭合 |
| C-67 | B4 / C-61 未闭合 | **部分关闭**——AC-3 / AC-8 已锁；AC-13 仍开；AC-7 / AC-11 仍 PARTIAL（非阻塞） |
| C-74 | AC-7 只对 1 个席位做深度比较 | **Round 4：seat 2 已锁**；9 席深度比较仍缺（非阻塞） |
| C-75 | AC-11 的第二实现只在 registry 层 | **Round 4：仍 PARTIAL（非阻塞）**——空子类、无提交、注入被忽略时该用例仍绿 |
| C-76 | **新**：`tests/server/strengthen.test.ts` 485 行 > `STYLE-6` 的 400 行 | **Open（非阻塞）**，本轮修复新引入 |
| C-69 | 文档漂移 | **仍 Open（非阻塞）**——`TEST-STRATEGY` 449、计划文件缺失、§8.4 / §8.10 与提交不符 |
| C-63 / C-64 / C-70 | 手写 cookie / 文档基线 / 动作响应全量历史 | 保持 Open（非阻塞），本轮未重查 |

---

### 7. 最终判断

- **Overall Risk Level: High**
- **Summary**：C-71 / C-72 已真正闭合，C-74 的 seat 2 也锁住了；但 C-73 的「终局 no-cache」用例没有构造 FINISHED，也没有 release，仅把副本的 `status` 翻成 `finished`——finished-only 缓存下全量 59 files / 495 tests 仍绿，而且「改返回值不影响下一次」在共享缓存对象下是恒真断言。`store.test.ts` 也没有按用户说法改名。C-61 因此继续 Open，RFC-008 不能标为 Reviewed。
- **Blocking Issues**：
  1. **C-61 / C-73**：AC-13 的 FINISHED / 不缓存没有能变红的回归锁（P-R4-3 全量绿）。
  2. **文档与提交不符**：`RFC §8.10:263` 声称 `store.test.ts` 已改名，提交 `a5b3cb8` 未改该文件；§8.4:200 的 AC-13 证据仍是旧文本。
- **Improvement Suggestions**（非阻塞）：
  1. N-R4-1：C-72 补「相位推进 / 具体接受事件」断言，不要只停在 `version` 前进。
  2. N-R4-2：AC-7 的 `project()` 深度比较循环到 9 个 `playerSeat`。
  3. N-R4-3：AC-11 把路由测试参数化到真正的 `MockStore`，并补一次提交。
  4. N-R4-4：拆分 `strengthen.test.ts`，满足 `STYLE-6`。
  5. N-R4-5：更新 RFC §8.4 / §8.10 与 `TEST-STRATEGY.md`（基线 495、实际测试文件、`strengthen.test.ts`）。
  6. N-R4-6：C-70（动作响应是全量可见历史）、N-R2-2（无 seat 的 `START`）、`snapshot?: unknown`、`applied` 无上限、响应 Zod schema、`as never` 继续承接。

- **状态**：`RFCS.md` → **`Changes requested`**；`FEATURES.md` 没有 Status 列，未改。**本评审没有修改任何产品代码，也没有 `git commit`；所有探针改过的文件已从 `/tmp/howl-round4-backup-src/` 恢复（未用 `git checkout`）。`git status` 只显示本评审修改的 `reviews/REVIEW-RFC-008.md` 与 `RFCS.md`，产品代码无 diff。**

## Round 5 -- 2026-11-19

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **分支 / HEAD**：`main` / `28f59ec`（评审开始时 `git status --porcelain` 无输出）
> **复核范围**：用户指定的 C-73（阻塞）、C-76、AC-8 / N-R4-1、`store.test.ts` 改名、注入存储的用例。C-59 / C-60 / C-62 / C-65 / C-66 / C-68 / C-71 / C-72 / C-74 的 seat 2 等已关闭项按要求不重查，只做承接。
> **结论**：**Changes requested**
> **整体风险**：**Medium**

### 0. STEP 0 · 门禁实跑（本轮 HEAD）

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。HEAD `28f59ec`，评审开始时工作树 clean。

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
 Test Files  61 passed (61)
      Tests  497 passed (497)
TEST_EXIT=0

$ pnpm build
✓ 14 modules transformed.
✓ 38 modules transformed.
dist/server/index.js  82.80 kB │ gzip: 27.86 kB
BUILD_EXIT=0
```

`pnpm test:e2e` 未跑：RFC-008 只改服务端路由 / 存储 / 共享类型与测试，没有 UI、浏览器或首屏改动；`TEST-6` 的 Playwright 要求从 RFC-012 起生效。`pnpm selfplay` 未跑：它仍是 RFC-015 的占位，与本 RFC 无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮适用游戏状态、可见性、安全、接口与纯函数检查；显式跳过 UI / A11Y / 浏览器兼容 / 首屏性能 / Playwright。

**探针后的复跑**：所有变异探针从 `/tmp/howl-round5-backup/` 的文件备份恢复（**没有使用 `git checkout`**），`game-registry.ts` / `app.ts` / `night.ts` 三个恢复点都用 `md5` 与备份比对一致；没有新建任何临时测试文件。恢复后全量 `pnpm test` 复跑 **61 files / 497 tests 全绿**，`pnpm typecheck` exit 0，`git status --porcelain` 为空。没有 `git commit`。

---

### 1. 用户指定复核的五项

#### 1.1 C-73 · AC-13 的 FINISHED / 不缓存：**部分闭合，仍 Open（阻塞）；C-61 继续 Open**

**已经成立的部分**

1. `tests/server/finished-game.test.ts:16-103` 的 `playToFinish` 确实是脚本打完整局：逐阶段提交 `WOLF_CHAT` / `WOLF_KILL` / `SEER_CHECK` / `WITCH_ACT` / `SPEECH_SKIP` / `VOTE`，并把记录推进到下一次 `submit`；`:111` 直接断言 `registry.stateOf(record).phase === 'FINISHED'`。单独运行该文件 2/2 绿（8ms），不是翻副本的 `status`。
2. `:121-132` 的释放用例是真的 `release()` → `getGame()` → `events` 为空 → `stateOf` 抛错，释放语义与 AC-13 的 no-cache 已分开。
3. **P-R5-1**：只给 `status === 'finished'` 的记录加缓存（`Map`）、且 `release()` 不失效，`finished-game.test.ts` 的释放用例变红：

```
× 释放后该局取不到状态（事件流是唯一权威），GET 返回 410
AssertionError: expected [Function] to throw an error
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

也就是说，Round 4 的 P-R4-3（finished-only 缓存、release 不失效）这次确实被锁住了。

4. `store.test.ts` 的改名属实：`git show 28f59ec -- tests/server/store.test.ts` 显示 `describe('AC-13 · 释放后按需重建')` 已改为 `describe('释放语义 · 事件流被清空后无法重建（AC-13 的 no-cache 见 finished-game.test.ts）')`，`toThrow` 断言保留在释放语义用例里。**用户这条说法成立。**

**仍未成立的部分（阻塞原因）**

`:113-118` 的「改返回值不影响下一次」在缓存实现下是恒真的，和 Round 4 指出的问题完全一样：

```ts
const first = registry.stateOf(record);
const second = registry.stateOf(record);
expect(second).toEqual(first);

(registry.stateOf(record) as { day: number }).day = 99;
expect(registry.stateOf(record).day).toBe(first.day);
```

- 若 `stateOf` 对同一 `gameId` 返回**同一个缓存对象**，`first` 与 `second` 是同一引用，`day = 99` 同时改掉 `first.day`，`99 === 99` 恒真；
- 若缓存返回**克隆**，改的是第三个克隆，下一次读取仍是缓存原值，也恒真。

因此这段断言**在任何缓存实现下都绿**，不能证明「每次从 events 重建」。这也正是 Round 4 所说的「无法区分每次 replay 与每次克隆缓存」。

**P-R5-2b**：换成一个更自然的实现——按 `gameId` 的普通对象缓存 `status === 'finished'` 的状态，`release()` 时删除缓存项（即「终局后缓存、释放时失效」），全量套件：

```
 Test Files  61 passed (61)
      Tests  497 passed (497)
```

仍然全绿。这个实现让 `finished` 但未释放的对局一直持有 `GameState`，直接违反 §2.5「对局进入 finished 后 GameState 不再缓存」与 AC-13 的第一句，却没有任何测试会红。**C-73 的验收证据仍不完整，C-61 继续 Open（阻塞）。**

另外三点：

- Round 4 指出的假 FINISHED 用例并没有删除，只是跟着拆分搬到了 `tests/server/release-and-entry.test.ts:150-167`：它仍然只把 `getGame()` 副本的 `status` 翻成 `finished`，没有终局事件、没有 release、没有第二次 GET；`:168` 的标题却仍写「FINISHED 的对局每次都重新 replay，不缓存」。`tests/server/strengthen.test.ts:168-182` 的 active 记录版本也还在。现在同一个 AC-13 有三个 describe、其中两个名不副实。
- 新用例也没有做 Round 4 建议的两次 HTTP `GET` / `version` 与 `view` 深比较；它用的是 `stateOf` 两次，这对 AC-13 可以接受，但「证明每次都重建」这一半仍然缺失。
- `:121` 的标题写「GET 返回 410」，正文没有 HTTP 调用；真正的 410 在 `tests/server/session.test.ts:211-243`。标题与正文不符，属于同一类问题。

**建议的最小闭合方式**（不需要引入新依赖）：在 FINISHED 且**未释放**的记录上，先 `stateOf(record)`，再对**同一 record** 的 `events` 做一次可见变化（例如 `copy.events = []`，或 `copy.events = copy.events.slice(0, -1)`），断言 `stateOf(copy)` 抛错 / `seq` 变化；或注入可计数的 replay。这个断言会同时打红「同对象缓存」「克隆缓存」「按 gameId 缓存」，且不依赖 `release()` 的失效逻辑，正好补上 P-R5-2b 的口子。加上 `expect(second).not.toBe(first)` 可以额外锁住同对象缓存。

#### 1.2 C-76 · `strengthen.test.ts` 超过 400 行：**关闭**

```
$ wc -l tests/server/strengthen.test.ts tests/server/release-and-entry.test.ts
     289 tests/server/strengthen.test.ts
     220 tests/server/release-and-entry.test.ts
```

两个文件都低于 `RULES.md:214` 的 `STYLE-6` 400 行上限。拆分不是删测试：`git show a5b3cb8:tests/server/strengthen.test.ts` 的 13 条用例名与本轮两个文件合并后的集合逐个比对，**13 = 7 + 6，集合完全一致，没有遗漏也没有新增**（脚本输出 `old 13 new 13 / same set: True`）。

RFC §8.11 写 `release-and-entry.test.ts` 为 218 行，实际 220 行，是无关紧要的数字漂移；不影响 `STYLE-6`。

#### 1.3 AC-8 / N-R4-1 · 「必须产出 DAY_STARTED」：**关闭**

`tests/server/release-and-entry.test.ts:145` 已追加：

```ts
expect(body.events.some((event) => event.type === 'DAY_STARTED')).toBe(true);
```

**P-R5-3** 把 `src/engine/phases/night.ts` 的 `WITCH_ACT(none)` 改成空转：返回 `PHASE_CHANGED('NIGHT_WITCH' → 'NIGHT_WITCH')`，`version` 前进、没有 `REJECTED`、也没有 `DAY_STARTED`。只跑这条用例：

```
× WITCH_ACT(none) 的响应里没有 REJECTED，且 version 前进
AssertionError: expected false to be true
 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
```

Round 4 的 P-R4-2b（空转但版本推进仍绿）这次会红。**N-R4-1 关闭，AC-8 的「动作确实被接受」已有可红断言。**

#### 1.4 「注入存储的用例改用同一个实例读回记录」：**不成立（非阻塞；C-75 仍 PARTIAL）**

`tests/server/release-and-entry.test.ts:171-189` 仍然是：

```ts
class SecondStore extends InMemoryMetaStore {}
const app = buildApp({ store: new SecondStore() });
// POST /api/games → GET /api/games/:id → 200
```

- `new SecondStore()` 没有赋给变量，**没有用同一个实例建 `GameRegistry` 读回记录**；
- 用例名仍写「创建 + 读取 + **提交**都正常」，正文**没有提交 action**；
- 用例仍然只断言 `view.statusCode === 200`。

**P-R5-4** 让 `buildApp` 完全忽略 `options.store`（恒用 `new InMemoryMetaStore()`），单跑这条用例：

```
✓ buildApp 注入第二个实现后，创建 + 读取 + 提交都正常
 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
```

该用例本身仍然不设防；同一次探针下全量有 5 条其他用例变红（C-71、C-72、C-74 的 seat 2、AC-7 深度比较、C-65 的过滤用例），所以「注入被使用」并非完全没有覆盖，但 **C-75 想证明的「第二个实现替换后路由仍工作」仍不成立**。提交信息与 RFC §8.11 第 279 行声称的「用同一个注入实例建注册表读回记录；忽略注入时该用例变红」与代码不符，属于 `DOC-1` 的复发。**C-75 保持 PARTIAL（非阻塞）。**

#### 1.5 `store.test.ts` 的 describe 改名：**属实**

已在 1.1 中给出 `git show` 证据。补充：`tests/server/store.test.ts:74` 的 `it` 标题仍是「释放 events 后再取状态会抛错（无事件流）；**重新放回事件则语义恢复**」，正文没有「重新放回事件」的操作；标题后半句应当删掉或补实现。非阻塞。

---

### 2. 逐条验收标准：哪个测试会红

> C-59 / C-60 / C-62 / C-65 / C-66 / C-68 / C-71 / C-72 / C-74 的 seat 2 等已在前轮关闭，本轮按要求不重查；AC-1 / 2 / 4 / 5 / 6 / 9 / 10 / 12 / 14 / 15 / 16 也沿用前轮证据。本轮实际重跑的是 AC-8 / AC-13 的新证据，并复核 C-76。

| AC | 证据 | 变异后会红吗 | 判定 |
|---|---|---|---|
| 1 | `session.test.ts:27-54`：同一 cookie 三局、`games` 长度 3 且是数组 | 删类型字段会编译失败 | **PASS**（承接） |
| 2 | `session.test.ts:56-74` + `strengthen.test.ts:24-39`：响应 seed 与 `GAME_STARTED.payload.seed` 一致 | seed +1 探针 → 红 | **PASS**（承接） |
| 3 | `release-and-entry.test.ts:44-64`：`POST /api/games` 传 `slaughter-all`，同一 `store` 读回事件与记录的 mode | 路由强写 mode → 红（Round 4 P-R4-1） | **PASS**（承接） |
| 4 | `session.test.ts:94-111`：`HttpOnly` / `SameSite=Lax` / `Path=/`，id ≥32 | 删 `HttpOnly` → 红 | **PASS**（承接） |
| 5 | `resume.test.ts:33-53`：两次独立 `inject` 的 `version` 与 `view` 深相等 | 改任一值 → 红 | **PASS**（承接） |
| 6 | 同 AC-5（两次独立调用，不共享客户端内存） | 同 AC-5 | **PASS**（承接） |
| 7 | `strengthen.test.ts:41-75` 与 `release-and-entry.test.ts:191-219` 深比 seat 1 / 2；`resume.test.ts:56-71` 对 9 席数 `"role":` | seat 1 / 2 专属泄漏 → 红；其余 7 席仍只计数 | **PARTIAL**（承接） |
| 8 | `release-and-entry.test.ts:130-147`：真实 `WITCH_ACT(none)`，无 `REJECTED`、有 `DAY_STARTED`、`version` 前进 | 恒拒绝 → 红；空转但版本推进 → 红（P-R5-3） | **PASS**（本轮闭合 N-R4-1） |
| 9 | `resume.test.ts:101-141`：重复 → `ALREADY_APPLIED`；旧版本换动作 / 未来版本 → `VERSION_MISMATCH` | 去掉 `ALREADY_APPLIED` → 红 | **PASS**（承接） |
| 10 | `session.test.ts:114-155`：他人 id 与不存在 id 的 404 JSON 相等 | 改 404 为 403 / 换 message → 红 | **PASS**（承接） |
| 11 | `store.test.ts:49-58` 让 `MockStore` 跑 registry 的 4 个方法；`release-and-entry.test.ts:171-189` 只把空子类注入路由 | 注入被忽略时该用例仍绿（P-R5-4）；名称里的「提交」未实现 | **PARTIAL** |
| 12 | `store.test.ts:61-71` 扫 `src/server` 的模块级 `new Map`，排除 `meta-store.ts` | 加 `new Map` → 红（P-R5-2 的 Map 缓存把 AC-12 / meta 命令测试打红） | **PASS**（按 AC 字面） |
| 13 | `finished-game.test.ts:106-119` 真的 FINISHED、两次 `stateOf` 深相等、改返回值不影响（**该断言恒真**）；`:121-132` release 后无法重建；`release-and-entry.test.ts:150-167` 仍是只翻副本 `status` 的旧用例 | release 不失效的缓存 → 红（P-R5-1）；**release 时失效的 finished 缓存 → 全量 61/497 绿（P-R5-2b）** | **FAIL** |
| 14 | `strengthen.test.ts:184-219` 真的开 100 局；`session.test.ts:183-186` 钉住常量 | 保留 4 局 → 红 | **PASS**（承接） |
| 15 | `strengthen.test.ts:221-241` 断言 replay `404` + `NOT_FINISHED`；`session.test.ts:157-181` 断言 stream `501` | replay 改 200 → 红 | **PASS**（承接） |
| 16 | `session.test.ts:189-208` 黑名单 7 个数据库驱动 | 当前依赖确实没有 | **PASS**（承接） |

统计：**PASS 13（1 / 2 / 3 / 4 / 5 / 6 / 8 / 9 / 10 / 12 / 14 / 15 / 16）**，**PARTIAL 2（7 / 11）**，**FAIL 1（13）**。AC-8 的残项本轮闭合；AC-13 的「FINISHED + release」前进了一步，但「不缓存」仍没有可红断言。

---

### 3. 变异探针清单

所有注入都用精确字符串替换并断言目标存在；每个探针结束后从 `/tmp/howl-round5-backup/` 的原始文件恢复（**没有使用 `git checkout`**），恢复后用 `md5` 校验，没有遗留临时测试文件；最终 `git status --porcelain` 为空，全量套件复跑 **61 files / 497 tests 全绿**。

| # | 注入 | 跑什么 | 结果 | 说明 |
|---|---|---|---|---|
| P-R5-1 | `stateOf` 对 `status === 'finished'` 的记录按 `gameId` 缓存状态（`Map`）；`release()` 不失效 | `finished-game.test.ts` | **红 1**（1 failed / 1 passed） | 释放用例变红；Round 4 的 P-R4-3 这次被锁住 |
| P-R5-2 | 同上（`Map` 缓存）；`release()` 时 `delete` 缓存项 | 全量 | **红 4**（3 files failed / 493 passed） | 不是 AC-13 的反例：`new Map` 触发 AC-12 的静态扫描与 meta 命令 / 覆盖率递归测试；说明 Map 形态的缓存会被 AC-12 顺带打红，但普通对象不会 |
| P-R5-2b | `stateOf` 对 `status === 'finished'` 的记录按 `gameId` 缓存**普通对象**；`release()` 时删除缓存项 | 全量 | **绿 61 / 497** | **C-73 未闭合**：finished 但未释放的记录一直持有 `GameState`，没有测试会红 |
| P-R5-3 | `night.ts` 的 `WITCH_ACT(none)` 返回 `PHASE_CHANGED('NIGHT_WITCH' → 'NIGHT_WITCH')`（空转但 `version` 前进、无 `DAY_STARTED`） | `release-and-entry.test.ts -t REJECTED` | **红 1**（1 failed / 5 skipped） | N-R4-1 关闭；AC-8 不再只靠 `version` 前进 |
| P-R5-4 | `buildApp` 忽略 `options.store`，恒用 `new InMemoryMetaStore()` | `release-and-entry.test.ts -t "buildApp 注入第二个实现"` | **绿 1**（1 passed / 5 skipped） | C-75 的用例本身仍不设防；同探针下全量另有 5 条红（其他用例能发现注入被忽略） |

补充证据（非变异）：

| # | 探针 | 观察 |
|---|---|---|
| T-R5-1 | `git show 28f59ec -- tests/server/store.test.ts` | `describe('AC-13 · 释放后按需重建')` → `describe('释放语义 · 事件流被清空后无法重建（AC-13 的 no-cache 见 finished-game.test.ts）')`；改名属实 |
| T-R5-2 | `git show 28f59ec --name-status` | 新增 `finished-game.test.ts` 与 `release-and-entry.test.ts`；`strengthen.test.ts` 只删不减（13 条用例名全部保留） |
| T-R5-3 | 阅读 `finished-game.test.ts:113-118` | 两次 `stateOf` 返回同一缓存对象时 `first` 同时被改，`99 === 99` 恒真；克隆缓存也恒真 |
| T-R5-4 | 阅读 `release-and-entry.test.ts:171-189` | `new SecondStore()` 未赋变量、没有 registry 读回、没有提交；RFC §8.11 第 279 行的「同一注入实例读回」不成立 |
| T-R5-5 | 阅读 `release-and-entry.test.ts:150-167` | 旧假 FINISHED 用例仍在：只翻 `getGame()` 副本的 `status`，无终局事件 / GET / release |

---

### 4. 其他发现

#### 4.1 三个 AC-13 describe 并存（重复用例，非阻塞）

- `finished-game.test.ts:105-133`：真的打到 FINISHED（有效）；
- `release-and-entry.test.ts:150-168`：只翻副本 `status`（Round 4 的假用例，搬了个位置）；
- `strengthen.test.ts:168-182`：active 记录，只证明两次 `stateOf` 深相等。

后两个的标题都在声称「终局 / 不缓存」，正文与标题不符。既然已经有 `finished-game.test.ts`，应删除或改名为「释放语义」并去掉不实描述；否则下一轮读者会误以为 AC-13 有三个独立证据。

#### 4.2 文档漂移没有收敛（C-69，非阻塞）

- `TEST-STRATEGY.md:32-33` 现在是 `Test Files 61 passed (61)` / `Tests 449 passed (449)`——文件数更新了，用例数仍是 449，实际 497；同一文件 `:37` 仍写「其余 15 个 RFC 仍为 proposed」。
- `TEST-STRATEGY.md:272-284` 的 RFC-008 小节仍把 `existing` 指向 `tests/server/{session,resume,store}.test.ts`，没有登记 `strengthen.test.ts` / `release-and-entry.test.ts` / `finished-game.test.ts`；计划里的 `projection-leak.test.ts` / `actions.test.ts` 仍不存在。
- 评审前 `RFCS.md` 的 C-73 / C-75 单元格同时存在「**Open（...）**」与追加的「**已修复（Round 4）**」，互相矛盾；顶部状态列被改成 `Implemented`，而 C-73 / C-61 仍标阻塞。本轮已在 §8.24 统一登记，并把状态列改回 `Changes requested`。
- `RFCs/RFC-008...:200`（§8.4 AC-13）仍是旧证据「释放后 `events` 为空，`stateOf` 无法重建（按需 replay 的前提）」；`:270` 的 AC-13 与 §2.5 矛盾仍只靠一句说明，没有走 `/manage-changes`。
- `RFCs/RFC-008...:276` 说「400 次内」，`finished-game.test.ts:25` 的 guard 是 800；`:277` 说 `release-and-entry.test.ts` 为 218 行，实际 220；`:279` 的 C-75「同一注入实例读回」不成立。
- `README.md:11` 已同步 497 个用例（正确），但 `README.md:37` 仍写「RFC-008 Changes requested（Round 1，...）」，Round 号已过期。
- `finished-game.test.ts:121` 标题写「GET 返回 410」，正文没有 HTTP GET；真正的 410 在 `session.test.ts:211-243`。

#### 4.3 C-70 / C-63 / C-64 保持非阻塞

- **C-70**：`POST /actions` 仍返回整局可见历史（`visibleEventsOf(result.record, ...)`），不是本次动作的增量。
- **C-63**：手写 cookie 的 `Secure` 生产接线已在前轮修复；`@fastify/cookie` 依赖表与 D-1 用户同意仍是文档项。
- **C-64**：7 天清理仍只有 cookie `Max-Age`；`snapshot?: unknown`、响应 Zod schema 仍是承接项。

---

### 5. 维度结论

#### 5.1 RFC ADHERENCE — NEEDS WORK

- **本轮闭合**：AC-8 的「动作被接受」有了 `DAY_STARTED` 断言（P-R5-3 红）；C-76 的文件拆分完成且没有丢用例；`store.test.ts` 的 describe 真的改名。
- **仍未闭合**：AC-13 的「finished 后不再缓存」仍没有可红断言。新用例真的打到 FINISHED，也锁住了「release 后缓存不失效」这一种退化，但 P-R5-2b（finished 缓存 + release 时失效）下全量 61/497 仍绿；`:117-118` 的断言在缓存下恒真，不能证明每次 replay。C-61 因此继续 Open（阻塞）。
- **部分**：AC-7 仍只有 seat 1 / seat 2 的深度比较（其余 7 席只有 `"role":` 计数）；AC-11 的第二实现仍停在空子类 + 创建/读取，未覆盖提交（C-75）。
- **文档**：旧的假 AC-13 用例没有删除；§8.4 AC-13 证据未回写；§8.11 的 C-75 声明与代码不符。

#### 5.2 RULES COMPLIANCE — NEEDS WORK

| 规则 | 结论 |
|---|---|
| `ARCH-7` | **PASS**（承接）：路由只经 `GameRegistry`，`MetaStore` 是唯一出口 |
| `ARCH-9` / `ARCH-10` | **PASS**（承接）：公开路由绑定玩家席位；`gameIds` 一对多，超限释放逐个进行 |
| `API-1` | **PARTIAL**（承接）：请求有 Zod；响应类型仍是纯 interface |
| `API-3` | **PASS**（承接）：重复 action 不重复推进 |
| `SEC-1` / `SEC-5` | **PASS**（承接）：本轮无产品代码改动；B1 过滤与 B2 席位绑定未重查，也没有新泄漏路径 |
| `DATA-6` | **PARTIAL**（承接）：release 清 events；`applied` 不清、无 7 天服务端清理 |
| `DOC-1` | **PARTIAL**：`store.test.ts` 改名这一条属实；但 §8.11 的 C-75「同一注入实例读回」不成立，§8.4 AC-13 证据仍旧，评审前 RFCS 的 C-73 / C-75 单元格状态矛盾（本轮已在 §8.24 统一） |
| `TEST-1` | **FAIL**：AC-13 的 no-cache 仍没有能变红的断言（P-R5-2b 全量绿） |
| `STYLE-6` | **PASS**：`strengthen.test.ts` 289 行、`release-and-entry.test.ts` 220 行，均 < 400 |
| `STYLE-1/2/5` | **PASS**：kebab-case、具名导出、无 `any`；`as never` 仍是类型逃生口（承接 N-R2-4） |

#### 5.3 SECURITY — PASS（行为承接，本轮未发现新问题）

- 本轮 `28f59ec` **没有修改 `src/`**，只改测试与文档；B1 / B2 / B3 的行为修复未重查，也没有新的攻击面。
- 动作响应仍经 `visibleEventsOf` 过滤；`GET` 视图仍由 `project()` 生成；他人 `gameId` 与不存在 id 的 404 仍相等。
- 非阻塞旧观察仍在：无 `seat` 的 `START` 可经公开路由提交并推进 `seq`（N-R2-2）；C-70 的整局可见历史仍是契约 / 体积问题，不是当前泄漏。

#### 5.4 PERFORMANCE — PASS（承接，有非阻塞提示）

- 新 `finished-game.test.ts` 单独运行 2 个用例 8ms；它最多 replay 800 次，没有出现超时。
- `visibleEventsOf` 每次动作重放整局并返回整局可见历史（C-70）；单局几百条事件，成本可接受，但响应随局长度增长。
- 全量 497 用例 22.05s，没有出现新的超时或不稳定；没有新增 N+1 或热路径问题。

#### 5.5 MAINTAINABILITY — NEEDS WORK

- **AC-13 的断言名不副实**：`:117-118` 在任何缓存实现下都绿；用例名说「每次都重新 replay」，正文没有证明。
- **三个 AC-13 describe 并存**，其中两个是旧假用例 / active 用例；`release-and-entry.test.ts:150-167` 正是 Round 4 指出的那一个，只是换了文件。
- **C-75 的用例名仍写「提交」但正文没有提交**，且「同一注入实例读回」没有落地。
- **文档漂移**：TEST-STRATEGY 449 / 497、计划文件不存在、新文件未登记；RFC §8.4 / §8.11 与代码不符（C-69）。
- 承接：`snapshot?: unknown`、`applied` 无上限、响应 schema 缺失、`as never` 类型逃逸。

---

### 6. 冲突登记（已写入 `RFCS.md` §8.24）

| # | 冲突 | 判定 |
|---|---|---|
| C-73 | AC-13 未测 FINISHED / 不缓存 | **Round 5：部分闭合，仍 Open（阻塞）**——真的 FINISHED + release 断言成立，P-R5-1 红；但 P-R5-2b（finished 缓存 + release 失效）全量 61/497 绿，`:117-118` 恒真；旧假用例仍在 `release-and-entry.test.ts:150-167` |
| C-61 | AC-13 的验收证据与 AC 相反 | **仍 Open（阻塞）**——C-73 未闭合；AC-13 原文与 §2.5 的矛盾仍只在 §8.10:270 说明，没有走 `/manage-changes` |
| C-67 | B4 / C-61 未闭合 | **Round 5：部分关闭**——AC-3 / AC-8 已锁；AC-13 仍阻塞；AC-7 / AC-11 仍 PARTIAL（非阻塞） |
| C-75 | AC-11 的第二实现只在 registry 层 | **Round 5：仍 PARTIAL（非阻塞）**——声称的「同一注入实例读回」不存在；P-R5-4 下该用例仍绿 |
| C-76 | `strengthen.test.ts` 485 行 > 400 | **Round 5：关闭**——289 + 220 行，13 条用例名全部保留 |
| N-R4-1 | AC-8 只断言「非 REJECTED + version 前进」 | **Round 5：关闭**——P-R5-3（空转但版本推进）红 |
| C-69 | 文档漂移 | **仍 Open（非阻塞）**——TEST-STRATEGY 61/449、计划文件缺失、新文件未登记、§8.4 / §8.11 与代码不符、RFCS 单元格状态矛盾 |
| C-70 / C-63 / C-64 | 动作响应全量历史 / 手写 cookie / 文档基线 | 保持 Open（非阻塞），本轮未重查 |

---

### 7. 最终判断

- **Overall Risk Level: Medium**
- **Summary**：本轮确实完成了两件实事——`finished-game.test.ts` 用脚本真的打到了 FINISHED，且 `release()` 后无法重建的断言能打红「缓存不失效」这一种退化；AC-8 的 `DAY_STARTED` 断言与 C-76 的拆分也都成立。但 AC-13 的核心「finished 后不再缓存」仍没有被锁住：`:117-118` 的改返回值断言在缓存下恒真，P-R5-2b 的「finished 缓存 + release 时失效」实现下全量 61 files / 497 tests 仍绿；旧的假 FINISHED 用例也仍留在 `release-and-entry.test.ts`。C-73 / C-61 因此不能关闭，RFC-008 不能标为 Reviewed。
- **Blocking Issues**：
  1. **C-73 / C-61**：AC-13 的「finished 后不再缓存」没有可红断言。补一条「对同一 FINISHED 记录的 `events` 做可见变化后 `stateOf` 必须变化 / 抛错」或可计数的 replay；并删除 / 改名 `release-and-entry.test.ts:150-167` 与 `strengthen.test.ts:168-182` 两个名不副实的用例。
  2. **AC-13 原文与 §2.5 的矛盾**仍未通过 `/manage-changes` 解决，§8.4:200 仍把「释放后无法重建」当成 AC-13 的 PASS 证据；至少把 §8.4 的证据行改成新用例，并决定 AC 文字的去留。
- **Improvement Suggestions**（非阻塞）：
  1. C-75：保留 `const store = new SecondStore()`，创建后用同一个实例 `getGame()` 读回，并通过 HTTP 提交一次 action 断言 `version` 前进；或把路由测试参数化到真正的 `MockStore`。
  2. 同步 `TEST-STRATEGY.md` 基线到 61 files / 497 tests，登记 `finished-game.test.ts` / `release-and-entry.test.ts` / `strengthen.test.ts`，删掉不存在的 `projection-leak.test.ts` / `actions.test.ts` 计划（或补实现）。
  3. 更新 RFC §8.4:200、§8.11 的 C-75 / 行数 / 800 次说法；统一 RFCS 单元格状态；`finished-game.test.ts:121` 的标题删掉「GET 返回 410」或补 HTTP 断言。
  4. AC-7 的 `project()` 深度比较循环到 9 个 `playerSeat`；AC-11 的路由测试参数化到 `MockStore` 并补一次提交。
  5. C-70（动作响应是全量可见历史）、N-R2-2（无 seat 的 `START`）、`snapshot?: unknown`、`applied` 无上限、响应 Zod schema、`as never` 继续承接。

- **状态**：`RFCS.md` → **`Changes requested`**；`FEATURES.md` 没有 Status 列，未改。**本评审没有修改任何产品代码，也没有 `git commit`；所有探针改过的 `src/server/store/game-registry.ts` / `src/server/app.ts` / `src/engine/phases/night.ts` 已从 `/tmp/howl-round5-backup/` 恢复（未用 `git checkout`），`md5` 与备份一致。`git status` 只显示本评审修改的 `reviews/REVIEW-RFC-008.md` 与 `RFCS.md`，产品代码无 diff。**
