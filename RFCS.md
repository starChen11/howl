# Howl · RFC 索引（RFCS）

> 版本 v2.14 · 来源 `PRD.md` v0.4 / `FEATURES.md` v1.0 / `RULES.md` v1.0 · 最后更新 2026-11-17
> **Status 列是唯一事实来源。** 由 `/implement-rfc`、`/review-rfc`、`/manage-changes` 维护。
> 每个 RFC 由 `/implement-rfc <id>` 实现，例如 `/implement-rfc 003`。不要另写实现提示词文件——那会与命令正文漂移。

---

## 1. 拆分思路

7 个层次，16 个 RFC，按**依赖**而非「功能重要性」排序：

1. **骨架与契约**（001）—— 目录、命令、以及**全部跨层类型的唯一归属** `src/shared/`。
2. **内核**（002）—— 纯函数 `step` / `reduce` / `replay`、事件流、种子、效果管道。全项目唯一不可替换的地基。
3. **一局能跑完**（003–005）—— 发牌与夜晚、白天与胜负、狼人自曝与夜聊。004 结束时引擎可在无 AI、无界面下跑完整局，**第一个真里程碑**。
4. **AI 可信**（006–007）—— LLM 客户端与结构化决策、上下文投影与注入隔离。**投影是卖点的技术兑现**。
5. **服务化**（008）—— 会话、多局、刷新恢复、状态释放。
6. **玩家体验与收尾**（009–016）—— 人格与打法、流式、通道与输入、界面、面板与观战、复盘、headless、浏览器与首屏。

**关键路径**：`001 → 002 → 003 → 004 → 006 → 007 → 008 → 009 → 014`。

### 1.1 v1.0 → v2.0 的结构修正

初版把「会话与存储」排在 006、「LLM」排 007、「投影」排 008，导致 **006 需要返回投影、而投影在 008**——依赖倒挂。所有 RFC 当时都还是 `Not started`，因此按 `generate-rfcs` 的规则重排：

| 原编号 | 新编号 | 内容 |
|---|---|---|
| RFC-006（会话） | **RFC-008** | 会话、存储与刷新恢复 |
| RFC-007（LLM） | **RFC-006** | LLM 接入与结构化决策 |
| RFC-008（投影） | **RFC-007** | 上下文投影与注入隔离 |

功能归属、标题与验收标准随文件一并迁移，没有内容丢失。

---

## 2. 状态总表

| RFC | 标题 | 功能 | 复杂度 | Status |
|---|---|---|---|---|
| [RFC-001](RFCs/RFC-001-project-scaffold-and-shared-contracts.md) | 工程骨架与共享契约 | F43 | Low | Reviewed |
| [RFC-002](RFCs/RFC-002-engine-core-state-events-seed-effects.md) | 引擎内核：状态机、事件流、种子与效果管道 | F2, F7, F38, F44 | High | Changes requested |
| [RFC-003](RFCs/RFC-003-roles-night-phase-and-strict-rules.md) | 板子分配、夜晚阶段与严格规则 | F1, F3, F8 | Medium | Not started |
| [RFC-004](RFCs/RFC-004-day-speeches-votes-and-win-check.md) | 白天发言、投票与胜负判定 | F4, F5, F6 | Medium | Not started |
| [RFC-005](RFCs/RFC-005-wolf-self-expose-and-night-chat.md) | 狼人自曝与夜间私聊 | F9, F10 | Medium | Not started |
| [RFC-006](RFCs/RFC-006-llm-client-and-structured-decisions.md) | LLM 接入与结构化决策 | F11, F16, F17, F20 | High | Not started |
| [RFC-007](RFCs/RFC-007-context-projection-and-injection-guard.md) | 上下文投影与注入隔离 | F12, F13 | High | Not started |
| [RFC-008](RFCs/RFC-008-session-store-and-resume.md) | 会话、状态存储与刷新恢复 | F34, F35, F36, F37 | Medium | Not started |
| [RFC-009](RFCs/RFC-009-ai-personas-and-advanced-play.md) | AI 人格与高级打法 | F14, F15 | High | Not started |
| [RFC-010](RFCs/RFC-010-streaming-thinking-indicator-and-degrade.md) | 流式发言、思考指示与降级 | F18, F19 | High | Not started |
| [RFC-011](RFCs/RFC-011-player-view-speech-input-and-channel.md) | 玩家视角、发言输入与通道抽象 | F21, F22, F23 | Medium | Not started |
| [RFC-012](RFCs/RFC-012-game-ui-onboarding-and-responsive.md) | 对局界面、新手引导与响应式 | F24, F26, F30, F40 | Medium | Not started |
| [RFC-013](RFCs/RFC-013-event-panel-spectator-and-truth-view.md) | 事件面板、观战与真相视图 | F25, F27, F28, F29 | Low | Not started |
| [RFC-014](RFCs/RFC-014-replay-and-restart.md) | 复盘与再来一局 | F31, F32, F33 | High | Not started |
| [RFC-015](RFCs/RFC-015-headless-selfplay.md) | headless 自动对局 | F39 | Medium | Not started |
| [RFC-016](RFCs/RFC-016-browser-support-and-first-paint.md) | 浏览器兼容与首屏性能 | F41, F42 | Low | Not started |

**复杂度分布**：High 6（002 / 006 / 007 / 009 / 010 / 014）、Medium 7、Low 3。

---

## 3. 依赖表

| RFC | 直接前置 | 直接后继 |
|---|---|---|
| RFC-001 | 无 | 002 |
| RFC-002 | 001 | 003 |
| RFC-003 | 002 | 004 |
| RFC-004 | 003 | 005, 006 |
| RFC-005 | 004 | 007, 011 |
| RFC-006 | 004 | 007, 010 |
| RFC-007 | 005, 006 | 008, 009, 011, 014, 015 |
| RFC-008 | 004, 007 | 014, 015 |
| RFC-009 | 007 | 014, 015 |
| RFC-010 | 006 | — |
| RFC-011 | 005, 007 | 012, 013, 015 |
| RFC-012 | 011 | 016 |
| RFC-013 | 011 | 014 |
| RFC-014 | 007, 008, 009, 013 | — |
| RFC-015 | 006, 007, 008, 009, 011 | — |
| RFC-016 | 012 | — |

**可并行分支**（顺序实现时无意义，多人协作有用）：

- 004 之后：`003→004→005` 与 `004→006` 两条线可同时推进
- 007 之后：`008`（会话）、`009`（人格）、`011`（玩家体验）三条线可并行
- 011 之后：`012`（界面）与 `013`（面板观战）可并行

---

## 4. 路线图

| 阶段 | RFC | 完成标志 |
|---|---|---|
| M1 地基 | 001, 002 | 状态可纯函数推进、事件流可重放、种子可复现 |
| M2 一局跑完 | 003, 004 | 无 AI、无界面能跑完整局（**第一个里程碑**） |
| M3 AI 可信 | 005, 006, 007 | AI 只看得见自己该看的（**卖点兑现**） |
| M4 服务化 | 008 | 经 HTTP 可多局、可刷新恢复 |
| M5 AI 好看 | 009, 010 | 有人格、会悍跳、说话不卡 |
| M6 能玩 | 011, 012, 013 | 桌面与手机都能完整玩一局 |
| M7 能展示 | 014 | 复盘可看，能当面向朋友演示（**v1 成功标准**，PRD D10） |
| M8 收尾 | 015, 016 | 可批量验证、四个浏览器可用 |

**建议实测节点**：M5 结束时实测「全部思考模式」下的单局墙钟时长与单轮延迟，据此更新 PRD 的 SM-5 与 OQ-9。此前 20 分钟只是假设。

---

## 5. 功能覆盖

| 范围 | 数量 | 落点 |
|---|---|---|
| Must 功能 | 31 | 全部分配到 16 个 RFC（脚本校验：无遗漏、无跨 RFC 拆分） |
| Should 功能 | 11 | 全部已分配 |
| Could 功能 | 3 | F29 → RFC-013、F32 → RFC-014；**F45 延后** |
| Won't 功能 | 12 | 不进入任何 RFC（见 §7） |

### 5.1 延后的功能

| 功能 | 内容 | 理由 | 重新考虑的触发条件 |
|---|---|---|---|
| F45 | 多套板子配置 | 优先级为 Could；是 RFC-003 的结构扩张而非新能力。v1 的 9 人板子已满足两条成功标准 | 出现「想换板子玩」的真实需求；或 RFC-003 实现时发现配置化几乎零成本 |

---

## 6. 与 PRD-REVIEW 的对照

10 项 High-impact 发现的落点：

| 发现 | 落点 |
|---|---|
| F-01 玩家发言无边界 | RFC-011（AC-4 ~ AC-7） |
| F-02 prompt injection | RFC-007（AC-12 ~ AC-16） |
| F-03 FR-9 不可验证 | RFC-007（AC-1、AC-10、AC-17） |
| F-04 FR-16 不可验证 | RFC-009（AC-6 ~ AC-10） |
| F-05 推理来源未定 | RFC-006（§2.2 `reason`）、RFC-007（§2.5 `AI_THOUGHT`）、RFC-014（AC-3、AC-4） |
| F-06 模型名与模式 | RFC-006（AC-4、AC-13） |
| F-07 无 headless | RFC-015 |
| F-17 玩家发言进上下文 | RFC-007（AC-12 ~ AC-14）、RFC-011（AC-8） |
| F-18 狼人交流 | RFC-005 |
| F-21 思考模式冲突 | RFC-010（AC-1、AC-3）；未决部分见 §8.2 `OQ-9` |

Medium / Low 发现中，属工程约束的落在 `RULES.md` 与 RFC-008 / RFC-010 / RFC-012；属项目管理范畴的（F-10 时间线、F-19 复查时点）已在 PRD 的 Timeline 注明，无功能承接。

---

## 7. 不在计划内（Won't）

F46 ~ F57 不进入任何 RFC：联机、AI 补位、语音通道、警长与警徽流、账号与存档与排行、分享回放、自选身份、原生 App、多语言、中途存档、内容安全过滤、Roguelike 元层。

其中语音的架构入口由 RFC-011 的通道抽象预留；元层入口由 RFC-008（多局与存储）、RFC-002（效果管道与种子）预留。**预留的是缝，不是功能**——实现任一 Won't 项都需要新 RFC 与 `/manage-changes`。

---

## 8. Open conflicts

> 按 `AGENTS.md` 硬规则 7：冲突不许静默裁决。`/implement-rfc` 在写代码前必须把 §8.2 逐条摆到用户面前。

### 8.1 已解决或已登记的冲突

| # | 冲突 | 处理 | 痕迹 |
|---|---|---|---|
| C-1 | RFC-011 初稿把编排层放客户端，违反 `ARCH-9`（服务端持有状态） | 按 RULES 走：编排层在 `src/server/orchestrator.ts`，浏览器只渲染与提交 | RFC-011 §2.3、AC-10 |
| C-2 | RFC-008 的 `GET /api/games/:id` 曾计划在投影未完成前返回完整状态，违反 `SEC-5` | 通过重排让投影（RFC-007）成为会话（RFC-008）的**前置**，临时实现不再需要 | RFC-008 Depends on、§2.2 |
| C-3 | `NFR-1` 在 PRD v0.3 改了数字，而 `FR-20/FR-21` 仍写旧值 | PRD v0.4 已改为引用 NFR-1；RFC-010 只实现一套口径 | PRD 变更记录 v0.4 |
| C-4 | `F10` 的验收要求「好人 AI 的上下文不含夜聊」，但投影在 RFC-007 | 可见性判定放 `src/shared/visibility.ts`（RFC-001），`isVisibleTo` 行为在 RFC-005 验收，投影集成在 RFC-007 AC-9 验收 | RFC-001 §2.3、RFC-005、RFC-007 |
| C-5 | RFC-001 的 `pnpm selfplay` 占位以退出码 1 结束，**违反 `OPS-3`** | 接受为**临时偏离**：脚本名先立住，行为由 RFC-015 补齐。RFC-015 完成时该偏离消除 | RFC-001 §4、AC-16 |
| C-6 | ~~RFC-004 §2.7 裁定「两阵营同时达成 → 平局」，`RULES.md` §6 未覆盖此情形~~ | **已关闭**：用户裁定「胜负先于死亡触发技能」，狼胜条件成立时对局已结束、猎人无开枪机会，**同时达成不可能发生**。RUL-1 已反转，`draw` 分支与 RUL-10 均已移除 | `changes/CHANGE-REQUEST-002.md` |
| C-7 | `RULES ARCH-8` 把投影签名写作 `project(state, observerId)`，但 `GameState` 按 `ARCH-3` 不含事件流，投影必须读事件 | **按 RFC 实现**（对象签名 `{ state, events, observer, pending, excludeSeq }`），`ARCH-8` 的签名描述待 `/manage-changes` 修正。理由：把事件塞进 `GameState` 会让状态与事件流形成两份权威，与 `DATA-3` 冲突 | RFC-007 §2.1 |
| C-8 | 复盘需要 AI 的 `reason`，但它对投影不可见（`self:`），单靠 `project()` 拿不到 | `AI_THOUGHT` 事件进事件流；**复盘（RFC-014）直接读事件流，不经过投影**——它发生在对局结束、身份揭示之后（SEC-6 / F28 的时间边界） | RFC-007 §2.5、RFC-014 |
| C-9 | RFC-001 §2.2 同时要求「路径别名全覆盖」+「`tsc` 编译到 `dist/server/index.js`」+「`pnpm start` 能起来」，三者**不可共存**：`tsc` 不重写 `paths`，产物里留着 `@shared/*` 说明符，Node 直接 `ERR_MODULE_NOT_FOUND` | **服务端改用 `vite build --ssr`**（`vite.server.config.ts`），产物仍是 `dist/server/index.js`（单文件，依赖保持 external）。零新增依赖、别名保持单一来源。实证 `grep -c '@shared/' dist/server/index.js` → `0` | RFC-001 §8.2、§8.5 |
| C-10 | RFC-001 §2.3 要求 `schemas.ts` 为**每个** payload 导出 Zod schema，但 §3 交付物表没列该文件、16 条 AC 无一条覆盖它，而 `GameStartedPayload`（RFC-002）/ `DayStartedPayload`（RFC-004）此刻不存在 | **本 RFC 只做信封 + `ActionSchema`**（十个 action 已在本 RFC 完整定义）；事件 payload 的 schema 由拥有该 payload 的 RFC 追加。补测了 `ActionSchema` / `EventSchema`，不让校验器变成未测表面 | RFC-001 §8.2、§8.5 |
| C-11 | RFC-001 AC-4 要求「五个严格开关**任一项**被关闭时 `pnpm typecheck` 会报错」 | **该断言方向是反的**：严格开关关闭只会减少错误。实测 TS 6.0.3：`strict: true` + 另四个全关 → 退出 0；五个全关 → 退出 0。改为**两向夹具**：每个开关一份「只在开启时违规」的夹具，开启必失败、关闭必通过。比原文更强 | RFC-001 §8.2、§8.5 |
| C-12 | RFC-001 §2.3 的效果 `order` 是**四个**区间（0/100/200/900），AC-6 只点了**三个**（0/100/900），漏掉的 200–299 正是承载 RUL-1 的死亡触发技能区 | `EFFECT_ORDER` 导出四个起点，测试断言四个；AC-6 点的三个是其子集 | RFC-001 §8.2、§8.5 |
| C-13 | `RULES ARCH-2` 说 `src/shared/` “只放类型与纯常量”，但 `RULES API-1` 要求共享请求/响应类型由 Zod 校验，RFC-001 §2.3 又要求 `schemas.ts` 导出 Zod schema；`visibility.ts` 也带运行时逻辑。规则内部与 RFC 之间口径不一致 | **按 RFC / API-1 实现**：`visibility.ts` 与 `schemas.ts` 留在 `shared/`；`ARCH-2` 的“只放类型与纯常量”待 `/manage-changes` 修正为“类型、纯常量、`visibility.ts` 与 Zod schema 例外”。评审记录见 `reviews/REVIEW-RFC-001.md` | RFC-001 §2.3/§8.3、RULES ARCH-2/API-1；待规则修正 |
| C-14 | `RULES STYLE-2` 要求常量 SCREAMING_SNAKE_CASE，RFC-001 §2.3 却点名 `TERMS` / `ROLE_LABELS` / `ActionSchema` / `EventSchema`；本 RFC 的实现、测试与 RFC-012 的 `terms.ts` 引用依赖这些名字 | **按 RFC 保留契约名**；`STYLE-2` 的常量规则应明确排除这些跨层契约标识符（或把它们定义为契约导出例外），待 `/manage-changes` 修正。注：RFC §8.3 说“后 15 个 RFC 的正文都在引用它们”并不成立，只有 RFC-012/RFC-010 引用 `terms.ts`；保留名字的理由是 RFC 指定 + 本 RFC 测试使用，不是“所有 RFC 都按名字引用” | RFC-001 §8.3、RULES STYLE-2；待规则修正 |
| C-15 | RFC-001 §2.3 的代码块把 `EventEnvelope` 的 `type` 默认成 `string`、payload 默认成 `unknown`，同一节正文却要求 `type` 必须是 `GameEventMap` 的成员、payload 由 map 约束；实现只满足代码块，`GameEventMap` / `GameEventType` 未被任何代码引用，`EventSchema` 接受任意非空 type | **已修**：新增 `GameEvent` 映射类型把 `type` 与 `payload` 静态绑定到 `GameEventMap`；`EventEnvelope` 的默认 `type` 由 `string` 收紧为 `GameEventType`（连「只知道是事件」的位置也写不出假类型）；`EventSchema` 的 `type` 改为 `z.enum(GAME_EVENT_TYPES)`；`GAME_EVENT_TYPES` 与 `keyof GameEventMap` 用 `toEqualTypeOf` 双向锁定。评审的 M11 探针现在编译失败 | RFC-001 §2.3、§8.7、RULES DATA-2 |
| C-16 | RFC-001 §2.3 的 `Action` 代码块把 `WITCH_ACT` 写成 `potion: 'heal' \| 'poison' \| 'none'; target?: SeatId`，同一节的约束句却要求「`potion: 'none'` 与省略 `target` 配套」——一条可选字段表达不出这个语义，评审 F2 证明实现两侧都没拒绝（`none` 带 target、`heal` 无 target 都能通过） | **按约束句实现，改写 §2.3 的代码块**：`Action` 拆成两条分支（`potion: 'none'` 无 `target`；`'heal'` / `'poison'` 必须有 `target`），`ActionSchema` 用 `.refine` 表达同一语义，类型与 Zod 两侧都拒绝非法组合 | RFC-001 §2.3、§8.7；`reviews/REVIEW-RFC-001.md` F2 |
| C-17 | RFC-001 §2.3 的 `GameEventMap` 与下游 RFC 的 payload 不一致：`REJECTED.actionType` 是 `string`（RFC-002 §2.3 要求 `Action['type']`）；`VOTE_CAST` 含 `seat`（RFC-004 §2.3 写 `{ target }`）；`AI_THOUGHT` 是 `{ reason; claim?: unknown; decisionSeq }`（RFC-007 §2.5 要求顶层 `claimedRole?` / `claimedChecks?` / `accuses?`，RFC-006 §2.2 的 `claim` 又是嵌套 `{ role?, checks?, accuses? }`，RFC-009 §2.2 / RFC-014 §2.3 按顶层字段消费） | **按 RFC-001 实现**：本 RFC 的代码与测试只依赖当前 map；这是跨 RFC 契约冲突，必须在 RFC-002 开工前由 `/manage-changes` 统一为一种 payload 形状，不能由下游各自改写既有成员（RFC-001 §2.3 明文禁止）。评审证据：`REJECTED.actionType: 'NOT_AN_ACTION'` 可编译（P21）；RFC-007 的 `AI_THOUGHT` 顶层字段被 `GameEvent` 拒绝（P22）；RFC-004 的 `VOTE_CAST { target }` 被拒绝（P23）。**已由 `CHANGE-REQUEST-003` 裁决并落地**：C1 `REJECTED.actionType` 按 RFC-002 收窄为 `Action['type']`；C2 `VOTE_CAST` 按 RFC-001 保留 `{ seat, target }`、改 RFC-004 的简写；C3 `AI_THOUGHT` 统一为**嵌套** `claim`（改 RFC-007/009/014 的字段路径，RFC-006 不动形状）。下游 RFC 全部 `Not started`，无需置 `Spec changed` | RFC-001 §2.3、RFC-002 §2.3、RFC-004 §2.3、RFC-006 §2.2、RFC-007 §2.5、RFC-009 §2.2、RFC-014 §2.3、`changes/CHANGE-REQUEST-003.md`；`reviews/REVIEW-RFC-001.md` Round 2 B1 |
| C-18 | RFC-002 §2.1 的 `step(state, action)` 不接收事件，但 RFC-003 §2.4 / AC-9、RFC-004 §2.2 / §3、RFC-005 §2.2 都要求药水位、发言 cursor、票箱、夜聊提交由事件流推导；RFC-001 §2.3 的 `GameState` 只有 8 个字段，没有这些派生状态 | **按 RFC-001 实现**：`GameState` 保持 RFC 定义的 8 个字段；这是 RFC-002 与 RFC-003/004/005 的契约缺口，不是 RFC-001 的代码缺陷。**阻塞 RFC-002 开工**，必须由 `/manage-changes` 二选一：① 允许后续 RFC 给 `GameState` 增加由 `applyEvent` 折叠出的派生字段，并在 RFC-001 §2.3 写明「可增加字段、但必须可由事件重建、不得成为第二权威」；② 改 `step` 接收事件历史，并同步修改 `RULES ARCH-4`。两种方案都要补「replay 后 step 判定一致」的测试 | RFC-001 §2.3、RFC-002 §2.1、RFC-003 §2.4/AC-9、RFC-004 §2.2/§3、RFC-005 §2.2；`reviews/REVIEW-RFC-001.md` Round 3 F3 | **已由 `CHANGE-REQUEST-004` 裁决（方案 A）**：`GameState` 允许派生字段，但只能由 `applyEvent` 从事件折叠、必须可完整重建，与事件冲突时以事件流为准；规则写进 RFC-001 §2.3，唯一写入口写进 RFC-002 §2.1，RFC-003/004 的「不在 state 里另存」改为「不另存**不可重建**的副本」，并在 TEST-STRATEGY 的 RFC-002 小节加一条 `replay` 一致性测试。未改 `ARCH-4`、未改 `step` 签名。
| C-19 | RFC-004 §2.3 写「全部提交后进入 `DAY_VOTE_RESOLVE`」，但 RFC-001 §2.3 的 `Phase` 14 个取值里没有它；RFC-002 §2.4 的 `ResolutionPoint` 叫 `VOTE_RESOLVE`，不是 `DAY_VOTE_RESOLVE` | **按 RFC-001 的 `Phase` 实现**：`DAY_VOTE_RESOLVE` 不是阶段，应改成 `VOTE_RESOLVE` 结算点或 `DAY_VOTE` 内部步骤；RFC-004 是 `Not started`，改措辞即可，不需要动 RFC-001 的代码 | RFC-001 §2.3、RFC-002 §2.4、RFC-004 §2.3；RFC-004 开工前修正；`reviews/REVIEW-RFC-001.md` Round 3 F4 | **已由 `CHANGE-REQUEST-004` 裁决**：它是 `DAY_VOTE` 阶段内部的结算点 `VOTE_RESOLVE`（RFC-002 §2.4 的 `ResolutionPoint`），不是 `Phase`；`Phase` 保持 AC-5 的 14 个。
| C-20 | 文档同步落后于实现与状态列：`TEST-STRATEGY.md:3` 仍引用 `RFCS.md` v2.7（现 v2.10）、`:33` 的基线是 86 个用例（实际 87）；RFC-001 §2.2 仍说 `tsconfig.server.json` 以 `rootDir: src` / `outDir: dist` 由 tsc 产出 `dist/server/index.js`，实际由 `vite.server.config.ts` 打包（C-9），配置中没有这两个字段；§8.4 的文件清单重复 `tests/shared/terms.test.ts`、漏 `tests/helpers/import-scan.ts` 与 `import-scan.test.ts`，文档列的 C 编号停在 C-9~C-12 | **以实测输出与 C-9 为准**：不影响代码、16 条 AC 或跨 RFC 契约。随 RFC-002 开工或独立 docs 提交时同步，不改验收口径 | `TEST-STRATEGY.md:3/33`、`RFCs/RFC-001-project-scaffold-and-shared-contracts.md` §2.2 / §8.4；`reviews/REVIEW-RFC-001.md` Round 4 | **Round 4 评审登记（非阻塞）** | **已修（本轮）**：`TEST-STRATEGY.md` 的用例数与 `RFCS.md` 版本引用已更新；RFC §2.2 按 C-9 改写为「tsconfig 只做类型检查，产物由 vite.ssr 打包」；§8.4 去掉重复的 `terms.test.ts`、补上 `import-scan.ts` / `import-scan.test.ts`、C 编号补到 C-20。
| C-21 | RFC-002 §2.4 要求「modifier 注册表随 run 配置写入 `GAME_STARTED`」以便 `replay` 重建同一组 modifier；但 §2.2 的 `GameStartedPayload`（与 RFC-001 §2.3 的同一类型）没有承载该配置的字段，且 modifier 是函数、按 `ARCH-3` 不能写入状态或 JSON | **按实现现状（v1 不注册任何 modifier）**：`step` 接受 `modifiers` 参数并经 `HandlerContext` 传给 handler，但 `GAME_STARTED` 不记录注册表，`replay` 无法重建带 modifier 的结算。v1 无可观察影响，不阻塞 RFC-002；在引入第一个 modifier 前需由 `/manage-changes` 决定「把可序列化的 modifier id / 配置写进 `GAME_STARTED`」或「扩展效果不参与 replay」 | RFC-002 §2.2 / §2.4、RFC-001 §2.3 `GameStartedPayload`、`src/engine/step.ts:38-41, 233-236`、`src/engine/effects.ts:76-87`；`reviews/REVIEW-RFC-002.md` Round 1 |

> C-13 / C-14 是 RULES 措辞与 RFC 契约的冲突，C-15 / C-16 是 RFC 内部代码块与正文的冲突，C-17 是跨 RFC 的 payload 形状冲突，C-18 是跨 RFC 的状态/事件推导契约缺口，C-19 是阶段命名冲突，C-20 是文档同步，C-21 是 modifier 注册表无法写入 `GAME_STARTED` 的缺口（v1 无 modifier，非阻塞）。**C-15 / C-16 / C-17 已在 RFC-001 的实现里修正**（C-17 由 `CHANGE-REQUEST-003` 裁决）；**C-18 / C-19 已由 `CHANGE-REQUEST-004` 裁决**（Round 4 复核通过）；C-20 是非阻塞文档同步，已在本轮修完；C-13 / C-14 的最终裁决仍归 `/manage-changes`；C-21 也待 `/manage-changes` 在引入 modifier 前裁决。

### 8.2 依赖中的开放问题（**阻塞实现，必须由用户确认**）

| # | 问题 | 阻塞哪些 RFC | 当前假设 | 不确认的后果 |
|---|---|---|---|---|
| ~~OQ-C6~~ | ~~两阵营同时达成胜利条件判谁赢~~ | — | **已关闭**（见 C-6） | 不再存在该情形 |
| OQ-9（PRD） | 全思考模式下若单局超过 20 分钟，是否允许白天发言降级为非思考模式 | RFC-010、RFC-014 | 先按思考模式实测 | NFR-1 与 SM-5 可能无法同时满足，验收口径会反复 |
| OQ-10（PRD） | AI 失败/超时时玩家可见的降级行为 | RFC-010 | 重试 1 次 → 极短发言替代 → 复盘标注 | AC 判定标准会变 |
| OQ-11（PRD） | 玩家为狼时狼人私有频道的 UI 形态 | RFC-005、RFC-011 | 复用白天输入框，夜间仅狼可见 | 界面返工 |
| OQ-12（PRD） | 倒计时与字数上限的具体数值 | RFC-011、RFC-012 | 60 秒 / 300 字 | 手感与 AI 上下文体积变化 |
| OQ-5（PRD） | AI 上下文策略（全量 / 摘要 / 检索） | RFC-007 | 全量喂入 + 按轮次摘要 | 延迟与成本结构变化 |
| OQ-6（PRD） | DeepSeek 具体模型与版本 | RFC-006 | `deepseek-flash` | 延迟与质量基线变化 |
| OQ-R5（RULES） | `RUL-1` ~ `RUL-10` 由 RULES.md 裁决，用户未逐条确认 | RFC-003、RFC-004 | 按 RULES §6 执行 | 任一条被推翻都要改引擎分支与验收标准 |
| FE-AS-1 | 对局结束后释放 `GameState`，保留最近 3 局事件流 | RFC-008、RFC-014 | 立即释放 + 快照保留 | 内存策略与「历史对局可看范围」变化 |
| FE-AS-2 | 「再来一局」后上一局复盘仍可查看 | RFC-014 | 可查看（直到被释放） | 若要求永久保留，与 NFR-17 冲突 |
| D37 | 内容完全放开，不做安全过滤 | RFC-006、RFC-009 | 不过滤 | 公网部署需重新评估（PRD OQ-13） |

---

## 9. 冷读记录

按 `generate-rfcs` 的要求，16 个 RFC 全部做过一次冷读（每个 RFC 一个独立上下文的读者，只读 PRD / FEATURES / RULES / 该 RFC 及其传递前置）。

| 轮次 | 日期 | 结果 |
|---|---|---|
| 第 1 轮（全部 16 个） | 2026-11-17 | **16/16 NEEDS-FIX**。共性根因三条：共享契约无单一归属、依赖声明漏引、验收标准超出本 RFC 范围 |
| 修复 | 2026-11-17 | 重排 006/007/008 修依赖倒挂；把全部跨层类型收进 RFC-001 的 `src/shared/`；`project()` 改为接收事件流；RFC-003/004 的私有信息改为事件驱动；拒绝语义统一为 `Rejected` 事件；补齐 action/event/effect 契约 |
| 第 2 轮（001 / 002 / 007） | 2026-11-17 | 见 §9.1 |

### 9.1 第 2 轮冷读

三个「契约型」RFC 重新送冷读：RFC-001（类型归属）、RFC-002（状态机与重放）、RFC-007（投影与注入）。

**结论**：

| RFC | 第 2 轮结论 | 处理 |
|---|---|---|
| RFC-007 | NEEDS-FIX | 已修：签名偏差登记为 `C-7`；分区改为按序折叠 `applyEvent` 后逐条判定；补 `excludeSeq` 与 `legalTargets` 的 `'abstain'`；`canShoot` 改为仅开枪阶段为真；样本量对齐 1000；注入声明句收归 `src/shared/injection.ts` 单一来源；`AI_THOUGHT` 的复盘读取路径写入 `C-8` |
| RFC-001 | NEEDS-FIX | 已修：`order` 分区重排为「抵消 → 死亡 → 死亡触发技能 → 扩展」，使升序应用满足 RUL-8；`Phase` 数量对齐 14；`START` 补 `seed`/`mode`/`playerSeat`；`Seat` 补 `diedSeq`；新增 `FACTION_OF`、`GameEventMap` 与 `src/shared/schemas.ts` 的 Zod 归属；新增 `'server'` 可见性与 `rngAfter` 信封字段；修正 tsconfig 产物路径 |
| RFC-002 | NEEDS-FIX | 已修：`replay` 通过事件上的 `rngAfter` 精确重建生成器；`GAME_STARTED` 标 `server` 可见性并确立「事件即权威」的发牌语义；`step` 增加 `modifiers` 入口且要求 modifier 由状态决定；拒绝/抛错改为机械判据；明确本 RFC 的验收边界 |

其余 13 个 RFC 的第 1 轮发现按「影响外部接口的修、纯实现细节留给实现者」的原则处理，**未做第二轮冷读**——这一限制在此显式记录，不假装已覆盖。

---

## 10. 交付给实现阶段的约束

- **测试计划先行**：`TEST-STRATEGY.md` 已就绪，每个 RFC 都有测试小节（`AGENTS.md` 硬规则 3 的前置条件已满足）。
- **一条 RFC 一个分支**：`rfc/<id>-<slug>`，评审通过后才合并（`WORKFLOW.md` §7）。
- **状态由命令维护**，不要手工改 Status 列。
- **偏离必须记录**：写入该 RFC 的 `## Implementation Notes`（`RULES DOC-1`）。RFC-001 的 §8 是第一个范例。

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-17 | v2.14 | RFC-002 Round 2 评审完成（Status → `Changes requested`）：Round 1 的 B1/B2 在运行时已修好，P4（重新发牌）/ P13（嵌套 `Math.random()`）/ P19（删掉 `mode` 分支）本轮均实红，206 用例全绿；但新增测试在 Windows 上因 `/` vs `\` 必红（B-R2-1），且 AC-13 的递归锁只测 helper、没锁 `rng.test.ts` 的 wiring——一层扫描 + 嵌套违规仍 11/11 绿（B-R2-2）。证据见 `reviews/REVIEW-RFC-002.md` Round 2 |
| 2026-11-17 | v2.13 | RFC-002 Round 1 评审修复：AC-13 的 `Math.random` 扫描与 TEST-2 的忽略注释扫描改为**递归**（抽 `tests/helpers/source-scan.ts`，并用临时目录自测）；AC-4 补合成 `GAME_STARTED` 用例锁住「事件是唯一权威」（P4 现在变红）；D-15~D-17 记录 `nextInt` 签名、额外导出与封闭 `WinCondition`；N1/N2/N3/N5/N8/N9/N10/N11/N12 逐项补测 |
| 2026-11-17 | v2.12 | RFC-002 Round 1 评审完成（Status → `Changes requested`）：16 条 AC 的运行时主路径大多有真实测试，但 AC-13 的 `src/engine/` 扫描不递归（RFC-003 计划新增的子目录会静默逃逸），AC-4 / §2.2 的「`GAME_STARTED.roles` 是唯一权威」没有被测试锁住（重新发牌的实现也能全绿）；另有 D-12 的 `mode` 分支、post-START `phase`/`day` 等未测或未记录。新增 C-21（modifier 注册表与 `GAME_STARTED` payload 的冲突，v1 无 modifier，非阻塞）。证据见 `reviews/REVIEW-RFC-002.md` Round 1 |
| 2026-11-17 | v2.11 | RFC-002 实现完成（Status → Implemented）：三个纯函数 + 事件草稿盖章 + 效果管道 + `checkWin` + `replay`；C-18 的验收手段 `tests/engine/replay-parity.test.ts` 落地；覆盖率门禁 98.01% / 94.04%。偏离与决定见 RFC-002 §8.2 |
| 2026-11-17 | v2.10 | RFC-001 Round 4 评审完成（Status → `Reviewed`）：16 条 AC 与 21 个变异探针全部通过，干净检出 87 用例全绿；C-18 / C-19 复核通过；新增 C-20（`TEST-STRATEGY` 基线、RFC §2.2 构建描述、§8.4 文件清单的文档同步，非阻塞），并同步 RFC-001 状态与 `README.md`。证据见 `reviews/REVIEW-RFC-001.md` Round 4。 |
| 2026-11-17 | v2.9 | RFC-001 Round 3 评审修复：`CHANGE-REQUEST-004` 裁决 C-18（派生字段只由 `applyEvent` 写、加 replay 一致性测试）与 C-19（`DAY_VOTE_RESOLVE` → 结算点 `VOTE_RESOLVE`）；补 B2 残留的三处注释/引用、§8.5 的验证数字、health 单测的自指断言 |
| 2026-11-17 | v2.8 | RFC-001 Round 3 评审完成（Status → `Changes requested`）：B1 / B3 复核通过；B2 仍有 `src/shared/events.ts:160` 的 `type: string` 不实注释与两处 `contracts.test.ts` 失效引用；README 与 RFC §8.5 的验证数字落后于 86 个用例；新增 C-18（`GameState` / `step` 与 RFC-003/004/005 的事件推导缺口，阻塞 RFC-002）与 C-19（`DAY_VOTE_RESOLVE` 不在 `Phase` 中）。证据见 `reviews/REVIEW-RFC-001.md` Round 3。 |
| 2026-11-17 | v2.7 | RFC-001 Round 2 评审修复：`CHANGE-REQUEST-003` 统一三个 payload 形状（C-17 关闭）；补 `EventEnvelope` 默认类型的回归夹具（B3）、修正 RFC 正文与注释的不实陈述（B2）、子配置五个严格开关全覆盖（N1）、构建前清 `dist`（N2）、`EFFECT_SOURCES` / `SELF_VISIBILITY_PREFIX` 断言（N3）；`tests/shared/contracts.test.ts` 拆成 domain / actions / events 三个文件 |
| 2026-11-17 | v2.6 | RFC-001 Round 2 评审完成（Status → `Changes requested`）：新增 C-17（`GameEventMap` 与 RFC-002/004/006/007/009/014 的 payload 形状不一致）；F2/F3/F4/F5 复核通过，F1 缺 `EventEnvelope` 默认类型的回归夹具，F6 的 §2.3 与代码注释仍不实。证据见 `reviews/REVIEW-RFC-001.md` Round 2 的 B1 / B2 / B3。 |
| 2026-11-17 | v2.5 | RFC-001 按评审修复完成（Status → Implemented）：关掉 C-15（`GameEvent` / `GAME_EVENT_TYPES` / `EventEnvelope` 收紧 / `EventSchema` 枚举）并新增 C-16（`WITCH_ACT` 拆分支 + `.refine`）；补 AC-5/6 的类型层断言、AC-15 的 `skipped` 文案、动态 `import()` 扫描、`.tsx` 规则等级、别名一致性测试。评审的 M1/M2/M5/M8/M9/M10/M11 探针现在全部变红 |
| 2026-11-17 | v2.4 | RFC-001 评审完成（Status → Changes requested，见 `reviews/REVIEW-RFC-001.md`）：发现 DATA-2 未强制（C-15）、`ActionSchema` 的 potion/target 语义约束缺失、AC-5/6/10/11/14/15/16 存在“回退不会红”的测试缺口、动态 `import()` 可绕过依赖方向检查；登记 C-13（ARCH-2 与 shared 运行时逻辑的冲突）、C-14（STYLE-2 与契约名的冲突）。 |
| 2026-11-17 | v2.3 | RFC-001 实现完成（Status → Implemented）。新增 C-9（服务端构建改 Vite SSR）、C-10（`schemas.ts` 范围收窄）、C-11（AC-4 改为两向夹具）、C-12（`order` 四区间）；§10 的前置条件已满足 |
| 2026-11-17 | v2.2 | 按 `CHANGE-REQUEST-002` 修订规则裁决：RUL-1 反转为「胜负先于死亡触发技能」（关闭 C-6 / OQ-C6）；RUL-2 收窄为重投仅可投并列者；RUL-10 移除。同步改 RULES、FEATURES F6、RFC-001~004 |
| 2026-11-17 | v2.1 | 第 2 轮冷读（001 / 002 / 007）后的修订：修 `order` 分区违反 RUL-8 的 bug；补 `rngAfter` 使重放精确；`GAME_STARTED` 改为 `server` 可见性；补 `GameEventMap` / Zod 归属 / `diedSeq` / `FACTION_OF`；新增 C-7（`ARCH-8` 签名偏差）与 C-8（复盘直读事件流）；合并超限的验收标准 |
| 2026-11-17 | v2.0 | 第 1 轮冷读（16/16 NEEDS-FIX）后的修订：重排 006/007/008 修依赖倒挂；补齐共享契约、拒绝语义、事件驱动的私有信息、`project()` 签名；新增 C-5 / C-6 / OQ-C6；记录冷读轮次与未覆盖范围 |
| 2026-11-17 | v1.0 | 初次拆分：16 个 RFC，覆盖 31 个 Must 功能；F45 延后 |
