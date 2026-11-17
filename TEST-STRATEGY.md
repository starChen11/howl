# Howl · 测试计划（TEST-STRATEGY）

> 版本 v1.0 · 来源 `PRD.md` v0.4 / `FEATURES.md` v1.0 / `RULES.md` v1.1 / `RFCS.md` v2.2 · 生成日期 2026-11-17
> **按 RFC 分节**，标题格式 `## RFC-NNN: 标题` —— `/implement-rfc` 与 `/review-rfc` 靠它找到对应计划。不按测试类型分节。

---

## 0. STEP 0 · 基线

**当前不存在任何测试套件。** 实测输出：

```
$ ls package.json src tests
  ✗ 无 package.json
  ✗ 无 src/
  ✗ 无 tests/

$ pnpm test
ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND  No package.json (or package.yaml, or package.json5)
  was found in "/Users/chenxin/Desktop/project/dsh-project/howl".
```

因此本文件里 **`Exists?` 列全部是 `proposed`**，没有 `existing`。等 RFC-001 落地后出现第一批测试，后续更新应把已存在的标为 `existing: <文件>`。

覆盖统计：**16 个 RFC、222 条验收标准、0 条已实现**。

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
| RFC-001 工程骨架与共享契约 | 16 | 11 | 0 |
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

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/meta/commands.test.ts`：依次执行 5 条 `pnpm` 命令并断言退出码 0；`start` 用子进程起后请求 `/api/health` 再 SIGTERM。失败点：任一命令非 0 | integration | proposed | Must |
| 2、3、4 | `tests/meta/tsconfig.test.ts`：读取 `package.json` 与三份 tsconfig，断言 `packageManager`/`engines`/`type` 与四个严格开关；再临时写出关掉 `strict` 的配置跑 `tsc --noEmit` 断言报错 | unit | proposed | Must |
| 5、7 | `tests/shared/contracts.test.ts`：断言 `Phase` 取值集合恰为 14 个、`EventEnvelope` 的 `visibleTo`/`seq`/`gameId` 必填（用 `expectTypeOf` 或反例对象编译失败断言） | unit | proposed | Must |
| 6 | `tests/shared/effects.test.ts`：构造去掉 `target` 的 `Effect` 断言类型错误；断言 `ORDER` 常量三个分区边界为 0 / 100 / 900 | unit | proposed | Must |
| 8 | `tests/shared/terms.test.ts`：断言 `TERMS` 的键集合覆盖 PRD 术语表 13 条，`TermKey` 能穷举；`ROLE_LABELS` 含 5 个身份 | unit | proposed | Must |
| 9 | `tests/security/no-hardcoded-terms.test.ts`：扫描 `src/**/*.{ts,tsx}`（排除 `terms.ts`），断言不含五个身份名字面量。失败点：任何组件里写死「狼人」 | security | proposed | Must |
| 10、11 | `tests/meta/dependency-direction.test.ts`：解析各文件 import，断言 `shared` 不引用其它层、`engine` 只引用 `shared`、`client` 只引用 `shared`、`server` 只引用 `engine`+`shared`；断言 `shared` 除 `zod` 外无运行时依赖 | unit | proposed | Must |
| 12 | `tests/server/health.test.ts`：`fastify.inject()` 请求 `/api/health` 断言 200 与 `{ok:true}`；另用 Playwright 请求 `http://localhost:5173/api/health` 断言代理生效 | integration | proposed | Must |
| 13 | `tests/meta/build.test.ts`：跑 `pnpm build` 后断言 `dist/client/index.html` 与 `dist/server/index.js` 存在；递归读 `dist/client` 全部文件断言不含 `DEEPSEEK_API_KEY` | integration | proposed | Must |
| 14、15 | `tests/meta/lint.test.ts`：读取 ESLint 配置断言两条规则为 `error`；跑 `pnpm lint`、`pnpm format:check`、`pnpm test:e2e` 断言退出码 0 | integration | proposed | Must |
| 16 | `tests/meta/selfplay-placeholder.test.ts`：跑 `pnpm selfplay` 断言退出码 1 且 stderr 含 `RFC-015` | integration | proposed | Must |

**依赖与夹具**：无前置。需要能起子进程的测试超时（建议 120s）。`tests/meta/` 下全部用 `execa` 或 `node:child_process`。

---

## RFC-002: 引擎内核：状态机、事件流、种子与效果管道

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2 | `tests/engine/step.test.ts`：参数化覆盖每种 `Action`；断言 `reduce(s,a)` 与 `step(s,a).state` 深相等；`Object.freeze(state)` 后调用不抛；连调两次结果相等 | unit | proposed | Must |
| 3 | `tests/engine/serialization.test.ts`：往返 JSON 断言深度相等；递归断言每个值原型为 `Object.prototype` 或 `Array`，无 `Date`/`Map`/`Set`/函数 | unit | proposed | Must |
| 4、5 | `tests/engine/replay.test.ts`：固定 `seed` 跑一段 action 序列得事件流，`replay` 后与最终状态深相等；同 seed 跑两次事件流逐条相等（忽略 `ts`） | unit | proposed | Must |
| 6、7 | `tests/engine/events.test.ts`：断言 `seq` 从 1 严格递增无跳号；首事件为 `GAME_STARTED` 且 payload 含 `seed`/`mode`/`playerSeat`/`roles`/`personas` | unit | proposed | Must |
| 8 | `tests/engine/reject.test.ts`：`PLAYERS` 阶段提交 `START` 以外的 action，断言产出 `REJECTED` 且 `code === 'PHASE_MISMATCH'`，除 `seq` 外状态不变 | unit | proposed | Must |
| 9 | `tests/engine/transitions.test.ts`：遍历 `transitions` 表每个 `(phase, action)` 允许对，断言存在 handler；对一个故意缺失 handler 的假表断言抛 `UnhandledTransitionError` | unit | proposed | Must |
| 10 | `tests/engine/effects.test.ts`：构造乱序 `Effect[]`，断言应用后按 `order` 升序、同级按 `id` 字典序；同数组两次应用结果相等 | unit | proposed | Must |
| 11 | `tests/engine/effects.test.ts`：注册假 modifier 到 `VOTE_RESOLVE` 注入「票无效」效果，断言最终状态因此改变；再断言不注册时结果与基线相等 | unit | proposed | Must |
| 12 | `tests/engine/rng.test.ts`：同 seed 两次抽序列相等；扫描 `src/engine/**.ts` 断言无 `Math.random(` | unit | proposed | Must |
| 13、14、16 | `tests/engine/coverage.test.ts` 由 `pnpm test` 的覆盖率报告断言阈值；引擎测试运行时把 `fetch` 换成抛错桩，全部通过 | integration | proposed | Must |
| 15 | `tests/engine/win.test.ts`：构造屠边/屠城局面各一，断言 `checkWin` 返回值与 `condition` 文案；断言调用不产生事件、不改状态 | unit | proposed | Must |

**依赖与夹具**：需要 RFC-001 的类型与 `isVisibleTo`。夹具 `tests/fixtures/states.ts` 提供「夜晚中」「投票中」「已终局」三个手写状态。

---

## RFC-003: 板子分配、夜晚阶段与严格规则

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3 | `tests/engine/deal.test.ts`：50 个固定种子逐个 `createInitialState`，断言角色计数恒为 3/1/1/1/3；同 seed 两次 `roles` 相同；统计玩家席位三类身份各出现 ≥1 次 | unit | proposed | Must |
| 4 | `tests/engine/night.test.ts`：`WOLF_KILL` 后断言产出 `WOLF_KILL_CHOSEN` 且 `visibleTo === 'wolves'` | unit | proposed | Must |
| 5 | 同上：指向已出局席位断言 `REJECTED` + `TARGET_NOT_ALIVE`，状态除 `seq` 外不变 | unit | proposed | Must |
| 6 | 同上：指向狼队友断言 `REJECTED` + `WOLF_KILL_WOLF` | unit | proposed | Must |
| 7 | `tests/engine/seer.test.ts`：三种目标（狼/神/民）各一次，断言 `SEER_CHECKED.visibleTo === 'seer'` 且 `result` 只取两值、与真实阵营一致 | unit | proposed | Must |
| 8、9、10 | `tests/engine/witch.test.ts`：自救 → `WITCH_SELF_SAVE`；同夜第二次提交 → `NOT_YOUR_TURN`；次夜复用已用药 → `POTION_ALREADY_USED`（药水位从事件流推导） | unit | proposed | Must |
| 11 | 同上：解药目标 === 刀口，断言当夜无 `PLAYER_DIED` 事件 | unit | proposed | Must |
| 12 | 同上：解药目标 ≠ 刀口，断言仅刀口出局 | unit | proposed | Must |
| 13、14、15 | `tests/engine/death-resolve.test.ts`：刀杀猎人 → 进 `NIGHT_HUNTER_SHOOT` 且 `HUNTER_SHOOT` 带 `source:'role'`；毒杀猎人 → 无该阶段、无事件；断言解药 `order` < 击杀 `order` < 开枪 `order` | unit | proposed | Must |
| 16 | `tests/engine/night.test.ts`：未分胜负时夜晚结束 `phase === 'DAY_ANNOUNCE'`，对该 phase 提交 action 抛 `UnhandledTransitionError`；刀杀的猎人正好是最后一个神时断言对局在第一次 `checkWin` 结束为狼胜且无 `HUNTER_SHOOT` | unit | proposed | Must |

**依赖与夹具**：RFC-002 的 `step`/`applyEvent`/`checkWin`。夹具需能构造「只剩一神」的残局。

---

## RFC-004: 白天发言、投票与胜负判定

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3、4 | `tests/engine/day.test.ts`：断言发言序列是单循环不重不漏；有死者时起点为死者下一位；无死者时起点取自 `DAY_STARTED.payload` 且同 seed 相同；起点是死者时跳至下一存活者 | unit | proposed | Must |
| 5、6 | `tests/engine/vote.test.ts`：断言 `VOTE_CAST.visibleTo === 'self:<seat>'`；结算前投影不含他人票型；结算后 `VOTE_REVEALED` 含全部投票与弃权标记 | unit | proposed | Must |
| 7 | 同上：唯一最高票者出局，`PLAYER_DIED.cause === 'lynch'` | unit | proposed | Must |
| 8、9 | 同上：并列 → 进重投，选项集仅并列者；提交 `abstain` 或非并列者 → `REJECTED` + `INVALID_RUNOFF_TARGET`；重投仍并列 → 当日无人出局进下一夜；首轮全员弃权 → 同上 | unit | proposed | Must |
| 10、11 | `tests/engine/win.test.ts`：屠边三种局面（狼死于刀/毒/放逐）与屠城两种局面各断言 `result` | unit | proposed | Must |
| 12、13 | 同上：猎人被刀且是最后一个神 → 狼胜且无 `HUNTER_SHOOT`；猎人被刀但好人仍存 → 开枪带走最后一狼后好人胜（第二次判定） | unit | proposed | Must |
| 14 | 同上：全部胜负用例断言 `result ∈ {'wolf','good'}`，事件流无 `'draw'`；类型层断言 `GameState` 无 `stalemateDays` | unit | proposed | Must |
| 15、16 | `tests/engine/full-game.test.ts`：固定 seed + 预置动作脚本跑到 `FINISHED`；`FINISHED` 后再提交断言 `REJECTED`+`PHASE_MISMATCH` 且除 `seq` 外不变；`replay` 得同一终局 | integration | proposed | Must |

**依赖与夹具**：RFC-003 的夜晚。夹具 `tests/fixtures/scripted-game.ts` 保存一份可复现的动作脚本。

---

## RFC-005: 狼人自曝与夜间私聊

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3、4 | `tests/engine/visibility.test.ts`：对 `public`/`wolves`/`self:<n>` 三类事件 × 9 观测者 × 死亡时序（事件前死/事件后死/存活）做全矩阵参数化 | unit | proposed | Must |
| 5、6 | `tests/engine/wolf-chat.test.ts`：断言 `NIGHT_WOLF_CHAT` 排在 `NIGHT_WOLVES` 前；每个存活狼提交后产出 `WOLF_CHAT_POSTED` 且 `visibleTo==='wolves'` | unit | proposed | Must |
| 7、8 | 同上：未全部提交前提交 `WOLF_KILL` → `REJECTED`+`PHASE_MISMATCH`；空串 `text` 也算提交并推进 | unit | proposed | Must |
| 9 | 同上：白天提交 `WOLF_CHAT` → `REJECTED`，除 `seq` 外不变 | unit | proposed | Must |
| 10、11 | `tests/engine/self-expose.test.ts`：`DAY_SPEECH` 与 `DAY_VOTE` 两个阶段各一次自曝，断言 `SELF_EXPOSE` 公开、`phase` 进 `NIGHT_WOLF_CHAT`、当日无 `VOTE_CAST`/`VOTE_REVEALED` | unit | proposed | Must |
| 12、13 | 同上：非狼 → `NOT_A_WOLF`；已出局狼 → `NOT_ALIVE`；自曝前后存活计数不变、`checkWin` 结论不变 | unit | proposed | Must |
| 14 | 同上：对 9 个好人观察者断言过滤后集合不含任何夜聊事件 | unit | proposed | Must |

---

## RFC-006: LLM 接入与结构化决策

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、3 | `tests/security/llm-isolation.test.ts`：扫描 `src/` 断言 `api.deepseek.com` 字面量只出现在 `client.ts`；断言 `DEEPSEEK_API_KEY` 只被 `config.ts` 读取；构造带敏感内容的 500 响应，断言错误 message 不含原文 | security | proposed | Must |
| 4、5 | `tests/server/llm/retry.test.ts`：假 `fetch` 依次返回超时/网络错误/429/5xx，断言各重试一次；4xx 不重试；环境变量覆盖生效 | unit | proposed | Must |
| 6 | 同上：同一 `(gameId, seat)` 同一决策轮次内，重试后只产生一个 action | unit | proposed | Must |
| 7、8 | `tests/server/llm/schema.test.ts`：缺 `reason` 被拒；校验失败后第二次请求消息中含首次错误文本 | unit | proposed | Must |
| 9、10 | `tests/server/llm/to-action.test.ts`：`vote`+合法 target → `VOTE`；非法 target → `{reject}`；`abstain` → `target:'abstain'`；`speak`+空文本 → `{reject}`；非猎人阶段 `shoot` → `{reject}` | unit | proposed | Must |
| 11 | `tests/security/prompt-identity.test.ts`：`buildSystemPrompt` 输出断言不含 `human`/`真人`/`你是 AI`/`助手`/`玩家是用户` | security | proposed | Must |
| 12、13 | `tests/server/llm/meta.test.ts`：断言 `CallMeta` 13 个字段齐全；`attempt` 在重试时递增；业务代码除 `config.ts` 外无 `'deepseek-flash'` 字面量 | unit | proposed | Must |
| 14 | 同上：假 `fetch` 返回固定 JSON，断言 `Decision` 被解析且 `CallMeta` 被写 | unit | proposed | Should |

---

## RFC-007: 上下文投影与注入隔离

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/server/project/purity.test.ts`：同输入两次深相等、不改入参；不构造 LLM 客户端即可调用 | unit | proposed | Must |
| 2 | `tests/server/project/property.test.ts`：固定种子生成 1000 个合法局面 × 9 观察者，断言 `self.role` 恰为自己、输出无他人角色字段 | unit | proposed | Must |
| 3、4、5 | `tests/server/project/knowledge.test.ts`：狼/预言家/女巫三者断言 `teammates`/`checks`/`potions`；好人侧断言空值形态（`[]`、`'used'`） | unit | proposed | Must |
| 6、7 | 同上：猎人仅开枪阶段 `canShoot===true`；女巫在 `pending==='witch'` 时 `knownKillTarget` 等于刀口，其余为 `null` | unit | proposed | Must |
| 8、9 | `tests/server/project/partition.test.ts`：对 9 观察者断言并集等于按序折叠判定的可见集合、无交集；非狼观察者不含 `wolves` 事件 | unit | proposed | Must |
| 10 | `tests/server/project/serialization.test.ts`：输出 JSON 往返深相等 | unit | proposed | Must |
| 11 | `tests/server/inject/wrap.test.ts`：文本只出现在标签内且 `<>` 被转义；系统提示含 `INJECTION_NOTICE`（逐字） | unit | proposed | Must |
| 12、13 | 同上：同一文本玩家/AI 封装输出逐字相同；301 字符被拒绝并返回错误码 | unit | proposed | Must |
| 14、15 | `tests/security/red-team.test.ts`：20 种对抗样本（含「忽略以上指令」、伪造闭合标签、JSON 块、代码块）后 `events`/`state` 深不变；`AI_THOUGHT` 只出现在该席位 `privateEvents`，对 8 个他人不可见 | security | proposed | Must |
| 16 | `tests/server/inject/current-speech.test.ts`：传 `excludeSeq` 后该 `SPEECH` 不在 `publicEvents`，封装槽位使用其文本 | unit | proposed | Must |

## RFC-008: 会话、状态存储与刷新恢复

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1 | `tests/server/session.test.ts`：同一 cookie 连发三次 `POST /api/games`，`GET /api/session` 返回 3 条；`Session.games` 为数组（类型断言） | integration | proposed | Must |
| 2、3 | 同上：创建响应含 `gameId`/`seed`/`playerSeat`/`version`，`seed` 与 `GAME_STARTED` 一致；指定 `mode` 生效 | integration | proposed | Must |
| 4 | 同上：断言 `Set-Cookie` 含 `HttpOnly`、`SameSite=Lax`、`Path=/`，会话 id ≥32 | integration | proposed | Must |
| 5、6 | `tests/server/resume.test.ts`：两次独立 `inject`（不复用响应对象）取同一局，断言 `version` 与 `view` 深相等 | integration | proposed | Must |
| 7 | `tests/server/projection-leak.test.ts`：对 9 个 `playerSeat` 各请求一次，断言响应中无他人角色字段 | security | proposed | Must |
| 8、9、10 | `tests/server/actions.test.ts`：正确版本推进；重复旧版本 → `ALREADY_APPLIED`；过期未应用版本 → `VERSION_MISMATCH`；他人 `gameId` → `404 GAME_NOT_FOUND` | integration | proposed | Must |
| 11、12 | `tests/server/store.test.ts`：`MetaStore.get` 返回值修改后不影响存储；换 Mock 实现后全部测试通过；静态断言 `src/server/` 除 `meta-store.ts` 外无模块级 `Map` 作存储 | integration | proposed | Should |
| 13、14 | 同上：终局后不再缓存 `GameState`，再取时重新 `replay` 得同一状态；跑完 100 局后完整 `events` 不超过 3 局 | integration | proposed | Should |
| 15、16 | 同上：未终局 `replay` 端点 `404 NOT_FINISHED`、`stream` 端点 `501 NOT_IMPLEMENTED`；`package.json` 无数据库驱动 | integration | proposed | Should |

## RFC-009: AI 人格与高级打法

| Criterion | Test | Level | Exists? | Priority |
|---|---|---|---|---|
| 1、2、11 | `tests/engine/personas.test.ts`：断言整局人格 id 不变、同局不重复、同 seed 分配可复现 | unit | proposed | Must |
| 3、4 | 同上：1000 局统计「人格 × 阵营」交叉表断言无显著相关（固定种子集合，不用随机失败阈值）；同局内至少 3 个 AI 的句长或攻击性比例极差超阈值 | integration | proposed | Must |
| 5 | `tests/engine/annotate.test.ts`：复盘数据中人格标签与席位一一对应 | unit | proposed | Must |
| 6、7 | 同上：构造满足/不满足条件的决策各一组，断言悍跳与狼查杀狼判定为真/假 | unit | proposed | Must |
| 8 | 同上：替换 `speech` 措辞（含/不含「预言家」字样）后判定结果不变 | unit | proposed | Must |
| 9 | `tests/engine/scenarios/advanced-play.test.ts`：固定种子 + 预置决策序列，断言三类事件各触发 ≥3 次 | integration | proposed | Must |
| 10 | `tests/engine/personas.test.ts`：改变人格后非法 action 仍非法 | unit | proposed | Must |

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

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-17 | v1.0 | 初次生成：16 个 RFC 小节、222 条验收标准的逐条落表、126 条计划测试、6 项人工检查 |
