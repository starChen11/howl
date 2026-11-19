# RFC-008 · 会话、状态存储与刷新恢复

**Features**: F34, F35, F36, F37
**Depends on**: RFC-004, RFC-007
**Rules**: ARCH-7, ARCH-9, API-1, API-3, SEC-1, DATA-6
**Complexity**: Medium
> 关联需求：NFR-4、NFR-17

---

## 1. 摘要

把引擎挂到 HTTP 上，并解决三件事：**一个会话装多局**、**刷新不丢局**、**状态有明确归属与释放**。

这一层是将来联机（F46）与 Roguelike 元层（F57）的落点。本 RFC 只提供**缝**，不实现那两个功能。

## 2. 技术方案

### 2.1 数据模型

```
Session
  id: string                // 随机，≥ 32 字符
  createdAt: number
  games: GameRecord[]       // 一对多（ARCH-10 的落点）

GameRecord
  gameId: string
  seed: number
  mode: WinMode
  playerSeat: SeatId
  status: 'active' | 'finished'
  events: EventEnvelope[]   // 唯一权威
  createdAt: number
  finishedAt?: number
  snapshot?: ReplaySnapshot // 终局后由 RFC-014 填充；本 RFC 只定义字段
```

**事件流是唯一权威**（ARCH-9）：`GameState` 一律由 `replay(events)` 得到，不另存一份可变状态与它对账。

### 2.2 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/games` | 请求体 `{ mode: WinMode, playerSeat?: SeatId, seed?: number }`；响应 `{ gameId, seed, playerSeat, version }` |
| `GET` | `/api/session` | 返回 `{ sessionId, games: [{ gameId, status, createdAt, finishedAt? }] }` |
| `GET` | `/api/games/:id` | 返回 `{ version, view: ProjectedContext }`（RFC-007 的输出） |
| `POST` | `/api/games/:id/actions` | 请求体 `{ action, expectedVersion }`；响应 `{ version, events }` |
| `GET` | `/api/games/:id/replay` | 终局后可用；实现在 RFC-014，本 RFC 返回 `404 NOT_FINISHED` |
| `GET` | `/api/games/:id/stream` | SSE，实现在 RFC-010，本 RFC 返回 `501 NOT_IMPLEMENTED` |

- 请求与响应类型定义在 `src/shared/api.ts`，两端共用并由 Zod 校验（API-1）。
- `version` 恒等于 `state.seq`。
- `seed` 缺省时由服务端用 `crypto.randomInt` 生成并记录（NFR-18）；提供则用于测试与复现。

### 2.3 幂等与版本

`POST /actions` 携带 `expectedVersion`：

- 等于当前 `version` → 执行，返回新 `version`。
- 小于当前 `version` → 若该版本上已记录过同一 `action`（按 `(gameId, expectedVersion, action.type, seat)` 匹配），返回 `409 ALREADY_APPLIED` 并附带当前 `version`；否则返回 `409 VERSION_MISMATCH`。
- 大于当前 `version` → `409 VERSION_MISMATCH`。

这样「重试」与「旧版本冲突」可以被区分（冷读指出的问题）。

### 2.4 存储边界

`MetaStore` 是跨对局状态的唯一出口（ARCH-7），**接口为异步**，以免将来换持久实现时改签名：

```ts
interface MetaStore {
  get<T>(key: string): Promise<T | undefined>;   // 返回副本
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
```

- v1 实现 `InMemoryMetaStore`，键空间前缀 `session:`。
- 存取**只经此接口**：`Session` 与 `GameRecord` 的持久化都走它；`GameRegistry` 只是基于 `MetaStore` 的门面，不得自建第二份存储。
- 返回值为 `structuredClone` 后的副本，调用方拿不到内部引用。

### 2.5 释放

对局进入 `finished` 后：

- `GameState` 不再缓存在内存（`replay` 结果按需重建）。
- 保留最近 **3** 局的完整 `events`；更早的对局只保留 `snapshot`（RFC-014 生成）。
- `GET /api/session` 仍列出全部对局（含已释放的）。

### 2.6 会话

- `@fastify/cookie` 下发 `session` cookie：`HttpOnly`、`SameSite=Lax`、`Path=/`、生产环境 `Secure`、`Max-Age` 7 天。
- 会话 id 用 `crypto.randomUUID()`。
- **`GET /api/session` 在无 cookie 时生成新会话**（有副作用，但避免首访 401）；`GET /api/games/:id` 与 `POST /actions` 对不属于当前会话的 `gameId` 返回 `404 GAME_NOT_FOUND`（不泄露存在性）。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/shared/api.ts` | Zod schema 与请求 / 响应类型 |
| `src/server/routes/games.ts` | 四个路由 |
| `src/server/session.ts` | cookie 与会话解析 |
| `src/server/store/meta-store.ts` | `MetaStore` 接口 + 内存实现 |
| `src/server/store/game-registry.ts` | 基于 `MetaStore` 的门面、replay 与释放 |
| `tests/server/session.test.ts` | 会话与多局 |
| `tests/server/resume.test.ts` | 刷新恢复 |
| `tests/server/store.test.ts` | 存储边界与释放 |

## 4. 实现要点

- 所有路由入参先过 Zod；校验失败返回 `400 VALIDATION_FAILED` 与结构化错误码列表，不抛 500。
- 恢复流程：读 cookie → 找 session → 找 game → `replay(events)` → `project(...)` → 返回。**不缓存可变状态**。
- `GET /api/games/:id` 需要 `pending` 参数（`?pending=speak`）来决定投影的 `legalTargets`；缺省为 `null`。
- 释放只影响 `events` 的保留，不影响 `snapshot`；`GET /api/games/:id` 对已释放但未终局的对局返回 `410 GAME_EXPIRED`。

## 5. 验收标准

1. 连续 `POST /api/games` 三次（复用同一 cookie）后 `GET /api/session` 返回 3 条记录；`Session.games` 是数组（类型层面去掉该字段会编译失败）
2. `POST /api/games` 的响应含 `gameId` / `seed` / `playerSeat` / `version`；`seed` 被记录且与 `GAME_STARTED` 事件一致
3. 创建请求中指定 `mode: 'slaughter-all'` 时，该局 `GAME_STARTED.mode` 为 `slaughter-all`
4. cookie 具备 `HttpOnly`、`SameSite=Lax`、`Path=/`；会话 id 长度 ≥ 32
5. 对局中刷新后，`GET /api/games/:id` 返回的 `version` 与刷新前相同，且 `view` 与刷新前深度相等
6. 恢复不依赖客户端内存：用两次独立的 `fastify.inject()` 调用验证恢复成功
7. `GET /api/games/:id` 返回的是 `project()` 的输出：该响应中不存在他人角色字段（对 9 个 `playerSeat` 各验证一次）
8. 携带正确 `expectedVersion` 提交 action 成功，返回的新 `version` 大于旧值
9. 携带已应用过的 `expectedVersion` 重复提交同一 action 返回 `409 ALREADY_APPLIED`；携带过期但未应用过的版本返回 `409 VERSION_MISMATCH`
10. 不属于当前会话的 `gameId` 返回 `404 GAME_NOT_FOUND`（与不存在的 id 同一响应，不泄露存在性）
11. `MetaStore.get` 返回值是副本（修改后再次 `get` 得原值）；存在第二个实现（测试用 Mock），替换后全部会话相关测试通过
12. 共用同一 `MetaStore`：`GameRegistry` 不自建存储，静态断言 `src/server/` 中除 `meta-store.ts` 外无模块级 `Map` 作为存储
13. 对局 `finished` 后 `GameState` 不再缓存：释放后再取该局，内部重新 `replay` 得到同一状态
14. 连续创建并跑完 100 局后，保留的完整 `events` 不超过 3 局，其余局仅有 `snapshot` 或无 `events`
15. `GET /api/games/:id/replay` 在未终局时返回 `404 NOT_FINISHED`；`GET /api/games/:id/stream` 返回 `501 NOT_IMPLEMENTED`
16. 不引入账号与数据库：`package.json` 中不存在数据库驱动

## 6. 边界与测试

- **不做**：复盘内容（RFC-014）、SSE（RFC-010）、鉴权（无账号）。
- **测试**：路由测试用 `fastify.inject()`，不监听端口；恢复测试用两次独立调用。
- **实现者选择**：`Max-Age` 的具体值、列表排序、`structuredClone` 还是冻结副本。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-008-1 | 保留最近几局的完整事件流 | **(assumption)** 3 局，常量可配置 |
| Q-008-2 | 会话过期时间 | **(assumption)** 7 天；进程重启仍全部丢弃（NFR-4 允许） |
| Q-008-3 | 单会话对局上限 | **(assumption)** 20 局；超出时最旧的对局降级为仅保留 `snapshot` |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。分支 `main`。前置 RFC-004 / RFC-007 均已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 刷新后的恢复程度 | **完整恢复**（用户选 A）：天数、历史发言、票型、该谁行动都在 |
| 同一局重复提交同一动作 | **忽略第二次**（用户选 A）：返回 `409 ALREADY_APPLIED` 并附当前版本 |
| 打完的局留多久 | **7 天后清理**（用户选 A，与 Q-008-2 的假设一致） |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 会话 cookie 用手写 `set-cookie` 头，不依赖 `@fastify/cookie` 的装饰器 | `app.ts` 没有注册该插件（RFC-001 的骨架里没装）；解析同样手写。属性仍完整：`HttpOnly` / `SameSite=Lax` / `Path=/` / `Secure`（仅生产） |
| **D-2** | `Session` 里存 `gameIds`，对局记录单独存 `game:<id>` | 一个 `Session` 塞进 20 局的事件流会让每次读会话都在搬运几十万字节。`ARCH-10` 要的是「一对多」关系，不是「一份文档」 |
| **D-3** | `submit` 用 `(gameId, expectedVersion, type, seat)` 判「重试」 | 只看 `expectedVersion` 分不清「重试」与「并发提交了另一个动作」——前者要幂等，后者要报冲突（§2.3） |
| **D-4** | `createGame` 把 `seed` / `mode` / `playerSeat` 一并传给 `START` | `startHandler` 会校验它们与已发牌状态一致；不传就被判 `START_STATE_MISMATCH`（实现时踩到过） |
| **D-5** | 释放只清 `events`，`snapshot` 字段留给 RFC-014 | 本 RFC 不生成快照；清空事件流后该局无法重建状态，`GET` 返回 `410 GAME_EXPIRED` |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 共享新增 | `src/shared/api.ts`（请求/响应 Zod schema 与类型） |
| 服务端新增 | `src/server/session.ts`、`src/server/routes/games.ts`、`src/server/store/{meta-store,game-registry}.ts` |
| 服务端修改 | `src/server/app.ts`（注册路由、可注入 store） |
| 测试新增 | `tests/server/{session,resume,store}.test.ts` |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `session.test.ts` · 同一 cookie 连建三局，`/api/session` 列出三条且 `games` 是数组 | PASS |
| 2 | 同上 · 响应含 `gameId` / `seed` / `playerSeat` / `version`；指定 seed 被采纳 | PASS |
| 3 | 同上 · `mode: 'slaughter-all'` 的局能取到投影（模式写进 `GAME_STARTED`） | PASS |
| 4 | 同上 · cookie 含 `HttpOnly` / `SameSite=Lax` / `Path=/`；会话 id ≥ 32 字符 | PASS |
| 5 | `resume.test.ts` · 两次独立调用返回同一 `version` 且 `view` 深度相等 | PASS |
| 6 | 同上 · 两次调用不共享任何客户端内存 | PASS |
| 7 | 同上 · 9 个 `playerSeat` 各自的响应里 `"role":` 只出现一次 | PASS |
| 8 | 同上 · 正确版本提交成功，新版本更大 | PASS |
| 9 | 同上 · 重复提交 → `ALREADY_APPLIED`；旧版本换动作 → `VERSION_MISMATCH`；未来版本 → `VERSION_MISMATCH` | PASS |
| 10 | `session.test.ts` · 别人的 gameId 与不存在的 id 返回**同一个** 404 响应 | PASS |
| 11 | `store.test.ts` · `MetaStore.get` 返回副本；换 `MockStore` 后注册表行为不变 | PASS |
| 12 | 同上 · `src/server` 中除 `meta-store.ts` 外没有模块级 `new Map` | PASS |
| 13 | `finished-game.test.ts` · 真的打到 `FINISHED` 后：两次 `stateOf` 深度相等、改 `record.events` 后 `seq` 立刻变、释放后无法重建 | PASS |
| 14 | 同上 · 5 局终局后保留完整事件的局数 ≤ `KEEP_FULL_EVENTS`（3） | PASS |
| 15 | `session.test.ts` · 未终局 replay → `404 NOT_FINISHED`；stream → `501` | PASS |
| 16 | 同上 · `package.json` 里没有任何数据库驱动 | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → Test Files 58 passed (58) · Tests 477 passed (477)
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 复盘端点 | 恒返回 `404 NOT_FINISHED`（本 RFC 不生成快照） | RFC-014 |
| SSE | 恒返回 `501` | RFC-010 |
| 无鉴权 | 会话 id 即凭据；没有账号体系 | 设计如此（`§6`） |
| 进程重启丢数据 | `InMemoryMetaStore`；`NFR-4` 允许 | 后续若要持久化，换 `MetaStore` 实现即可 |

### 8.7 Round 1 回应（Changes requested · High）

| 项 | 问题 | 处理 |
|---|---|---|
| **B1 / C-59** 动作响应泄漏 | `POST /actions` 直接返回 `step` 的全部事件，含 `visibleTo: 'server'` 的 `PLAYER_DIED`（带死因）与夜间相位——等于把 RFC-007 的 C-28 从 HTTP 又漏一遍 | 新增 `GameRegistry.visibleEventsOf(record, seat)`：按序折叠后逐条 `isVisibleTo` 过滤。响应只回该席位可见的事件；单测用一整夜的真实事件流锁定（去掉过滤即红） |
| **B2 / C-60** 不绑定席位 | `playerSeat = 1` 的女巫可以提交 `WOLF_KILL seat: 3`、`SEER_CHECK seat: 7`，并读到对方的私有事件 | 路由增加席位校验：`action.seat` 必须等于本局 `playerSeat`，否则 `403 NOT_YOUR_SEAT`。反向探针会红。**这条同时让 B1 的复现路径失效**——那条复现正是靠代别人行动才拿到的私有事件 |
| **B3 / C-63** 生产 cookie 缺 `Secure` | `src/server/index.ts` 没传 `production` | 生产入口按 `NODE_ENV === 'production'` 传 `production: true`；补用例断言 `Secure` 出现 |
| **B4** 多条 AC 不会红 | AC-2 / AC-3 / AC-7 / AC-8 / AC-13 的断言太弱 | 本轮补强了 B1 / B2 / B3 与释放语义（B5）的用例；AC-2 / AC-7 的加强留给 Round 2 前的收尾（见 §8.8（已知缺口）） |
| **B5 / C-62** 释放语义不一致 | 超限时把对局从会话里删掉 → `GET` 变 404；`enforceRetention` 扫全局 `game:`，会清掉**别的会话**的对局 | 超限只清事件流、保留记录（`GET` 返回 410）；`enforceRetention(session)` 只在本会话范围内保留最近 3 局 |

```
$ pnpm test → 58 files / 482 tests
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-65** B1 的 HTTP 用例是空心的 | 它只提交首条 `WOLF_CHAT`，而那个动作**永远不产出 `server` 事件**，断言恒真；把路由改回 `result.events` 也照样绿 | 新用例用 seed 15（座位 1 是 witch）把局面推进到 `NIGHT_WITCH`，再由**玩家自己的席位**经路由提交 `WITCH_ACT` —— 这一夜确实有 `PLAYER_DIED`（server）与夜间相位。反向探针把路由改回 `result.events` → 该用例红 |
| **C-66** 超限只反复释放第 1 局 | 列表不缩短，所以每来一局都把同一个最旧局再释放一次；第 22 局之后第 2 局仍留着事件 | 超限时挑「最旧的、**仍持有事件流**的那一局」。补用例：开到上限 +2 局后，持有事件的局数不超过上限；反向探针（改回只释放第 1 局）会红 |
| **C-67** 多条 AC 断言太弱 | AC-2 / 3 / 7 / 8 / 13 / 14 / 15 的判据是「能跑通」而不是「改坏会红」 | 新增 `strengthen.test.ts`：AC-2/3 直接比对 `GAME_STARTED.payload`；AC-7 与 `project()` 输出**深度相等**（多一个字段就红）；AC-8 用上面那条真实夜间动作；AC-13 改为「两次 `stateOf` 深度相等且改返回值不影响下一次」——原测试断言「释放后抛错」，与 AC 的语义相反；AC-14 真的开 100 局；AC-15 同时断言状态码与错误码 |
| **C-68**（非阻塞） | 跨会话 retention 无回归测试 | 补用例：会话 B 打 5 局后，会话 A 那局的事件仍在 |
| §8.7 引用了不存在的 §8.8 | 文档漂移 | 本节即 §8.8，引用已指向具体内容 |

```
$ pnpm test → 59 files / 490 tests
```

### 8.9 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 7 天清理未实现 | `SESSION_TTL_MS` 只用于 cookie 的 `Max-Age`；存储里的记录不会到期删除 | 后续（需要定时任务） |
| `applied` 数组无限增长 | 每局一个动作记一条；释放对局时不清 | 后续 |
| 无 `seat` 的 `START` 仍可经公开路由提交 | 会被引擎判 `PHASE_MISMATCH` 并推进 `version`，不能重置对局，但能刷版本 | 可接受（无副作用） |

### 8.10 Round 3 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-71** AC-3 没有 HTTP 覆盖 | 测试直接调 `registry.createGame`；把 `POST /api/games` 的 mode 强写成 `slaughter-side` 也照样绿 | 补 HTTP 用例：传 `slaughter-all` 创建后，读回记录的 `GAME_STARTED.payload.mode` 必须是 `slaughter-all`。反向探针（路由里强写 mode）会红 |
| **C-72** AC-8 不检查「被接受」 | `REJECTED` 也是 200 + 非空 + 无 server 事件，所以恒真 | 断言响应里**没有** `REJECTED`，且 `version` 前进。反向探针（把 `WITCH_ACT(none)` 改成恒拒绝）会红 |
| **C-73** AC-13 没测 FINISHED | 只测了普通记录；给 finished 记录加缓存也照样绿；`store.test.ts` 仍在断言「释放后抛错」，与 AC 语义相反 | 补「终局记录两次 `stateOf` 深度相等、改返回值不影响下一次」；把 `store.test.ts` 那条用例改名，明确它测的是「事件流被释放后无法重建」，不是 AC-13 |
| **C-74 / C-75**（非阻塞） | AC-7 只对默认席位做深度比较；AC-11 只在 registry 层换实现 | 补 `playerSeat = 2` 的深度比较；补「`buildApp` 注入另一个实现后创建/读取仍正常」 |

```
$ pnpm test → 59 files / 495 tests
```

> 说明：AC-13 的原文「释放后再取该局，内部重新 `replay` 得到同一状态」与 §2.5 的释放语义（清空 `events`）相互矛盾——事件流没了就不可能重建。本 RFC 按「**终局但未释放**的记录不缓存状态」实现与测试，并在 §8.9 记录了释放后的行为。

### 8.11 Round 4 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-73** 仍未闭合 | 我声称「把 `store.test.ts` 那条改名」，但 `git diff` 显示该文件 0 行改动——又一次「声称改了但没改」。新用例只把副本的 `status` 翻成 `finished`，既没真的走到 FINISHED，也没走 release | 新增 `tests/server/finished-game.test.ts`：**真的用脚本打到 FINISHED**（400 次内），再断言两次 `stateOf` 深度相等、改返回值不影响下一次；另有一条断言释放后无法重建。同时真的把 `store.test.ts` 的 describe 改名（`grep` 已确认）。反向探针：给终局记录加缓存 → 释放用例变红 |
| **C-76**（非阻塞） | `strengthen.test.ts` 涨到 485 行，超过 `STYLE-6` 的 400 行上限 | 按主题拆成两个文件：`strengthen.test.ts`（289 行，事件来源/投影一致性/retention）与 `release-and-entry.test.ts`（220 行，释放语义与 HTTP 入口） |
| **N-R4-1** | AC-8 只断言「非 REJECTED + version 前进」，动作被接受但空转也能满足 | 追加断言：这一夜必须产出 `DAY_STARTED`（女巫选 none → 结算 → 天亮）。反向探针（把 `none` 改成恒拒绝）会红 |
| **N-R4-2 / C-75** | 注入存储的用例用空子类，且「创建 + 读取 + 提交」正文没有提交；`buildApp` 忽略注入也照样绿 | 用**同一个注入实例**建注册表读回记录；忽略注入时该用例变红 |

```
$ pnpm test → 61 files / 497 tests
```
