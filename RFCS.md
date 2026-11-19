# Howl · RFC 索引（RFCS）

> 版本 v2.51 · 来源 `PRD.md` v0.4 / `FEATURES.md` v1.0 / `RULES.md` v1.3 · 最后更新 2026-11-19
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

**关键路径**：`001 → 002 → 003 → 004 → 005 → 007 → 006 → 008 → 009 → 014`（006 依赖 007，010 从 006 分支）。

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
| [RFC-002](RFCs/RFC-002-engine-core-state-events-seed-effects.md) | 引擎内核：状态机、事件流、种子与效果管道 | F2, F7, F38, F44 | High | Reviewed |
| [RFC-003](RFCs/RFC-003-roles-night-phase-and-strict-rules.md) | 板子分配、夜晚阶段与严格规则 | F1, F3, F8 | Medium | Reviewed |
| [RFC-004](RFCs/RFC-004-day-speeches-votes-and-win-check.md) | 白天发言、投票与胜负判定 | F4, F5, F6 | Medium | Reviewed |
| [RFC-005](RFCs/RFC-005-wolf-self-expose-and-night-chat.md) | 狼人自曝与夜间私聊 | F9, F10 | Medium | Reviewed |
| [RFC-006](RFCs/RFC-006-llm-client-and-structured-decisions.md) | LLM 接入与结构化决策 | F11, F16, F17, F20 | High | Reviewed |
| [RFC-007](RFCs/RFC-007-context-projection-and-injection-guard.md) | 上下文投影与注入隔离 | F12, F13 | High | Reviewed |
| [RFC-008](RFCs/RFC-008-session-store-and-resume.md) | 会话、状态存储与刷新恢复 | F34, F35, F36, F37 | Medium | Changes requested |
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
| RFC-006 | 004, 007 | 010 |
| RFC-007 | 005 | 008, 009, 011, 014, 015 |
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
| C-6 | ~~RFC-004 §2.7 裁定「两阵营同时达成 → 平局」，`RULES.md` §6 未覆盖此情形~~ | **已关闭（结论不变：无平局）**：用户裁定「胜负先于死亡触发技能」，**死亡触发技能**造成的同时达成不会发生（狼胜成立瞬间对局已结束，猎人没有开枪机会），`draw` 分支与 RUL-10 均已移除。**但「同时达成」本身并未消失**：C-27 找到合法路径（同一批夜间死亡），由 **RUL-12「狼刀在先」**判 wolf 胜 | `changes/CHANGE-REQUEST-002.md`、`changes/CHANGE-REQUEST-006.md`、C-29 |
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
| C-22 | RFC-002 AC-13 要求「扫描 `src/engine/` 全部 `.ts`」，但 `tests/helpers/source-scan.ts:41` 把所有以 `.` 开头的条目（**包括隐藏 `.ts` 文件**）一并跳过；实测在 `src/engine/.hidden.ts` 放 `Math.random()` 后 `rng.test.ts` 仍 11/11 绿。Round 2 已作为小 nit 登记，Round 3 复核仍未修 | **按 AC-13 的字面修（非阻塞）**：把跳过条件收窄为隐藏**目录**（`entry.isDirectory() && entry.name.startsWith('.')`），并补一条隐藏 `.ts` 用例；当前 `src/engine` 没有隐藏 `.ts`，不影响已验收行为 | RFC-002 AC-13、`tests/helpers/source-scan.ts:41`；`reviews/REVIEW-RFC-002.md` Round 2 / Round 3 | **已修（Round 3 遗留清理）**：`toPosixPath` 与跳过条件收窄为「只跳过隐藏**目录**」，隐藏 `.ts` 文件现在会被扫到；`source-scan.test.ts` 有对应回归用例。

> C-13 / C-14 是 RULES 措辞与 RFC 契约的冲突，C-15 / C-16 是 RFC 内部代码块与正文的冲突，C-17 是跨 RFC 的 payload 形状冲突，C-18 是跨 RFC 的状态/事件推导契约缺口，C-19 是阶段命名冲突，C-20 是文档同步，C-21 是 modifier 注册表无法写入 `GAME_STARTED` 的缺口（v1 无 modifier，非阻塞），C-22 是 AC-13 的「全部 `.ts`」与隐藏文件跳过的实际缺口（**已修**）。**C-15 / C-16 / C-17 已在 RFC-001 的实现里修正**（C-17 由 `CHANGE-REQUEST-003` 裁决）；**C-18 / C-19 已由 `CHANGE-REQUEST-004` 裁决**（Round 4 复核通过）；C-20 是非阻塞文档同步，已在该轮修完；C-13 / C-14 的最终裁决仍归 `/manage-changes`；C-21 也待 `/manage-changes` 在引入 modifier 前裁决，C-22 待下一次 RFC-002 提交或独立修复时收口。

### 8.2 依赖中的开放问题（**阻塞实现，必须由用户确认**）

| # | 问题 | 阻塞哪些 RFC | 当前假设 | 不确认的后果 |
|---|---|---|---|---|
| ~~OQ-C6~~ | ~~两阵营同时达成胜利条件判谁赢~~ | — | **已关闭**：不再判平局；夜间同批死亡同时达成时按 **RUL-12** 判 wolf 胜 | 见 C-6 / C-27 |
| OQ-9（PRD） | 全思考模式下若单局超过 20 分钟，是否允许白天发言降级为非思考模式 | RFC-010、RFC-014 | 先按思考模式实测 | NFR-1 与 SM-5 可能无法同时满足，验收口径会反复 |
| OQ-10（PRD） | AI 失败/超时时玩家可见的降级行为 | RFC-010 | 重试 1 次 → 极短发言替代 → 复盘标注 | AC 判定标准会变 |
| OQ-11（PRD） | 玩家为狼时狼人私有频道的 UI 形态 | RFC-005、RFC-011 | 复用白天输入框，夜间仅狼可见 | 界面返工 |
| OQ-12（PRD） | 倒计时与字数上限的具体数值 | RFC-011、RFC-012 | 60 秒 / 300 字 | 手感与 AI 上下文体积变化 |
| OQ-5（PRD） | AI 上下文策略（全量 / 摘要 / 检索） | RFC-007 | 全量喂入 + 按轮次摘要 | 延迟与成本结构变化 |
| OQ-6（PRD） | DeepSeek 具体模型与版本 | RFC-006 | `deepseek-flash` | 延迟与质量基线变化 |
| OQ-R5（RULES） | `RUL-1` ~ `RUL-11` 由 RULES.md 裁决，用户未逐条确认 | RFC-003、RFC-004 | 按 RULES §6 执行 | 任一条被推翻都要改引擎分支与验收标准 |
| FE-AS-1 | 对局结束后释放 `GameState`，保留最近 3 局事件流 | RFC-008、RFC-014 | 立即释放 + 快照保留 | 内存策略与「历史对局可看范围」变化 |
| FE-AS-2 | 「再来一局」后上一局复盘仍可查看 | RFC-014 | 可查看（直到被释放） | 若要求永久保留，与 NFR-17 冲突 |
| D37 | 内容完全放开，不做安全过滤 | RFC-006、RFC-009 | 不过滤 | 公网部署需重新评估（PRD OQ-13） |

### 8.3 RFC-003 Round 1 评审登记的开放冲突（2026-11-18）

> 由 `/review-rfc 003` 登记。C-23 / C-24 阻塞 RFC-003 合并；C-25 非阻塞。**C-23 / C-24 在 Round 2 被重新打开，最新状态见 §8.5 —— 本节两行只保留那一轮的原始记录。**完整证据见 `reviews/REVIEW-RFC-003.md` Round 1。**Round 2 复核（2026-11-18）**：C-23 的 seer / witch 两条已修，hunter 路径仍泄漏；C-24 的代码行为已落地，但裁决未进 `RULES.md` §6，两者仍阻塞。见 §8.4。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-23** | RFC-003 D-1 把 `PHASE_CHANGED` 定为 `visibleTo: 'public'`。夜晚跳过 `NIGHT_SEER` / `NIGHT_WITCH` 会向所有观察者暴露「预言家 / 女巫已出局」；`NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 还会暴露猎人死于狼刀而非毒杀。这与 PRD User Journeys 第 4 步「玩家闭眼（只看到「天黑了」）」以及 `FR-9`（AI 只能使用自己有权知道的信息）冲突；RFC-007 §2.2 的 `publicEvents` 会包含全部 `visibleTo: 'public'` 事件，因此该泄漏会进入每个 AI 的上下文。D-3 为避免死因泄漏把 `PLAYER_DIED` 设为 `server`，但同一夜的公开相位又把身份存活状态与死因漏了回去 | **阻塞 RFC-003**，需用户确认后修正。按权威顺序 `PRD > FEATURES > RULES > RFC`，夜晚内部相位不应公开。候选：① 夜间 `PHASE_CHANGED` 改 `server`（或新增专用可见性），公共侧只保留 RFC-004 的 `DAY_STARTED`；② 若客户端需要「天黑了 / 天亮了」提示，由 `project()` 的 `phase` 字段或 RFC-004 的公开事件承担。修正后补「死预言家 / 死女巫 / 被毒猎人」三条「公开事件不泄漏」的回归测试 | **Open** · RFC-003 §8.2 D-1、`src/engine/phases/night.ts:76-77,101-108,120-128,357-361`、`src/engine/step.ts:126-133`、RFC-007 §2.2、`PRD.md` User Journeys 4 / FR-9、`reviews/REVIEW-RFC-003.md` B2 | **Round 1 记录为已修复；Round 2 复核推翻（仅 seer / witch 路径已修）**：`phaseVisibility()` 确实让这两条跳过路径变成 `server`，但 `finishNight` 的 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 仍硬编码 `public`，hunter 路径没有回归锁。见 §8.4 **已修复（Round 2）**：`NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 那条漏改的草稿也已改走 `phaseChangedDraft`；新增**真实路径**测试（狼刀 hunter → 查验 → 女巫 `none` → 进开枪），把修复改回去该测试会变红；`leaksOf` 白名单补上合法的 `HUNTER_SHOOT`；**Round 3 复核（事件通道）**：真实路径测试通过；把 `night.ts` 的 hunter 分支改回 `public` 会让 `night-visibility.test.ts` 1/6 红（实跑）。**事件通道关闭；投影通道仍未覆盖，见 C-28**（`ProjectedContext.phase` / `aliveSeats` / `deadSeats` 不在事件流里，`phaseVisibility` 修不到） ⚠️ **本行是 Round 1 的记录，状态已被下文 §8.5 的 Round 2 复核取代**（以那两行为准）
| **C-24** | `RULES.md` §6 未裁决「狼刀目标与毒药目标为同一席位时，猎人是否算作被毒杀（是否开枪）」。RFC-003 §2.3 的集合语义只要求该席位出局一次，但 `resolveNight` 产出两条 `Death`，`finishNight` 产出两条 `PLAYER_DIED`，而 `applyPlayerDied` 把重复出局当作数据损坏抛 `InvalidEventStreamError`。这是**合法 action**（女巫毒狼刀目标）触发的引擎崩溃；若该席位是猎人，还叠加「被狼刀 → 开枪 / 被毒 → 不开枪」的未裁决分支（ARCH-11）。`PLAYER_DIED` 重复不能被当作「事件流损坏」 | **阻塞 RFC-003**，需用户裁决：① 同一目标只记一次出局（按座位去重，这是实现必须做的，不是可选项）；② 若为猎人，死因按狼刀还是毒药（决定是否开枪）。裁决前至少应把这条路径变成显式的「未裁决规则」错误，而不是让合法输入撞上内部不变量错误；裁决后补 `killTarget === poisonTarget` 的测试 | **Open** · RFC-003 §2.3 第 3–6 步、`src/engine/resolve/deaths.ts:53-96`、`src/engine/phases/night.ts:80-99`、`src/engine/apply.ts:124-131`、RULES §6 / ARCH-11、FEATURES F8 AC-4、`reviews/REVIEW-RFC-003.md` B1 | **Round 1 记录为已修复；Round 2 复核：代码行为已实现，但裁决未进 `RULES.md` §6（见 §8.4）**：按座位归并死亡（同一目标只出局一次）；**毒药优先**——同一目标既被刀又被毒时死因记为 `poison`，猎人因此**不开枪**。补 `killTarget === poisonTarget` 的用例，含「目标是 hunter」的分支 **已落榜为规则**：`RULES.md` §6 新增 **RUL-11**（`CHANGE-REQUEST-005`）——同一席位只出局一次、死因记为毒药、hunter 不开枪。RFC 的 `## Implementation Notes` 不再作为裁决依据；**Round 3 复核通过**：`RULES.md` §6 的 RUL-11 存在（`CHANGE-REQUEST-005`），`src/engine/resolve/deaths.ts:69-86` 按座位归并 + 毒药优先，`tests/engine/death-resolve.test.ts:186-249` 覆盖同目标 / hunter / 跨座位顺序。RULES 文件头版本已在本轮同步为 v1.1（原 v1.0 是版本头没跟上，不影响 RUL-11 的权威性） ⚠️ **本行是 Round 1 的记录，状态已被下文 §8.5 的 Round 2 复核取代**（以那两行为准）
| **C-25** | `FEATURES.md` 把 F1 / F3 / F8 整体列在 RFC-003 下，但它们的验收标准包含 RFC-003 明确不做的部分：F1 AC-1（界面，RFC-012）与 AC-5（会话，RFC-008）；F3 AC-1 的「狼队内部先协商」依赖夜聊（RFC-005）；F8 AC-3 的「被放逐时可开枪」是 `DAY_HUNTER_SHOOT`（RFC-004）。RFC-003 §6 已显式划出范围，但功能归属 / 状态没有同步 | **非阻塞**，不是 RFC-003 代码缺陷。需要 `/manage-changes` 或更新 `RFCS.md` §2 / §5 的功能映射，避免 F1 / F3 / F8 在只完成 RFC-003 时被当成「已全部实现」 | **Open（非阻塞）** · `FEATURES.md` F1 / F3 / F8、RFC-003 §6、`RFCS.md` §2 / §5、`reviews/REVIEW-RFC-003.md` §3.5 |

### 8.4 RFC-003 Round 2 复核登记的开放冲突（2026-11-18）

> 由第二轮 `/review-rfc 003` 登记；完整证据见 `reviews/REVIEW-RFC-003.md` Round 2。C-23 / C-24 仍阻塞 RFC-003；C-26 非阻塞。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-23** | Round 1 的「已裁决并修复」被本轮复核推翻一半：seer / witch 跳过路径确实改成了 `server`，但 `src/engine/phases/night.ts:102-109` 的 `NIGHT_RESOLVE → NIGHT_HUNTER_SHOOT` 仍是硬编码 `visibleTo: 'public'`。真实路径（狼刀 hunter → `SEER_CHECK` → `WITCH_ACT none`）会公开暴露「猎人死于狼刀而非毒杀」。`tests/engine/night-visibility.test.ts:115-122` 只断言 `phaseVisibility` 这个纯函数和一个 fixture，改对/改错 `night.ts` 都不红，等于没有接线回归锁；同测试的 `leaksOf` 还会把合法公开的 `HUNTER_SHOOT` 误报为泄漏 | **阻塞 RFC-003**。修法：`finishNight` 的中段改用 `phaseChangedDraft('NIGHT_RESOLVE', …)`；加一条真实路径的端到端测试（构造狼刀 hunter → seer → witch none，断言没有公开的 `→NIGHT_HUNTER_SHOOT`），并修正 `leaksOf` 白名单 | **Open** · `src/engine/phases/night.ts:102-109`、`src/engine/phases/visibility.ts:22-31`、`tests/engine/night-visibility.test.ts:25-32,115-122`、`reviews/REVIEW-RFC-003.md` Round 2 §2.2 |
| **C-24** | 代码已按「按座位归并 + 毒药优先」实现并测试，B1 的崩溃确实不再发生。但「毒药优先」的裁决只写在 RFC-003 §9.1 与 C-24 的痕迹里；`RULES.md` §6 的 RUL-1~RUL-10 没有这条，`RFCs/RFC-003...:143-148` 的批准记录也没有它。按 `RULES.md:136` 的 ARCH-11 与 `RULES.md:228` 的「§6 未覆盖的分支必须抛错」，以及 `FEATURES.md:69` 的 F8 AC-4，这条仍属「未裁决分支被代码静默选择」 | **阻塞 RFC-003（记录层面）**。若用户确实裁决了「毒药优先」，用 `/manage-changes` 把它写进 `RULES.md` §6（建议新增 RUL-11）并同步 RFC-003 / RFC-004 的引用；否则改成明确的未裁决错误。复核门槛：权威记录存在，或代码显式失败 | **Open** · `RULES.md:136,228`、`FEATURES.md:69`、`RFCs/RFC-003...:143-148,252`、`src/engine/resolve/deaths.ts:59-81`、`reviews/REVIEW-RFC-003.md` Round 2 §2.1 |
| **C-26** | `resolveNight` 在去重时顺手加了 `.sort((a, b) => a.seat - b.seat)`（`src/engine/resolve/deaths.ts:79-81`），改变了合法多死场景的 `PLAYER_DIED` 事件顺序：`resolveNight({ killTarget: 7, poisonTarget: 3 })` 返回 `[3(poison), 7(wolf)]`，而 RFC-003 §2.3 的步骤顺序是狼刀先、毒药后。RFC-004 §2.1 的 `DAY_STARTED.diedLastNight` 写「按死亡结算顺序」，`speechStartSeat` 取结算顺序第一位死者的下一位，因此这个排序可能改变首日发言起点。排序不是 B1 去重所必需，RFC-003 也没有记录这个选择 | **非阻塞**（不影响 B1 崩溃修复），但必须在 RFC-004 开工前裁决。删掉排序恢复 §2.3 顺序，或在 RFC-003 / RFC-004 显式写明「座位升序即结算顺序」并补跨座位用例 | **Open（非阻塞）** · `src/engine/resolve/deaths.ts:79-81`、RFC-003 §2.3、RFC-004 §2.1、`tests/engine/death-resolve.test.ts:240-245`、`reviews/REVIEW-RFC-003.md` Round 2 §2.1 / §9 | **已修复**：删掉 `.sort(seat)`，死亡顺序恢复为**结算顺序**（狼刀先、毒药后），归并用的 `Map` 保留首次插入位置；补一条 `resolveNight({killTarget:9, poisonTarget:3})` 返回 `[9,3]` 的用例；**Round 3 复核通过**：把 `.sort` 加回去会让 `death-resolve.test.ts` 1/16 红（实跑）

### 8.5 RFC-003 Round 3 评审登记的开放冲突（2026-11-18）

> 由第三轮 `/review-rfc 003` 登记；完整证据见 `reviews/REVIEW-RFC-003.md` Round 3。**C-27 阻塞 RFC-003**；C-28 非阻塞 RFC-003、阻塞 RFC-007（C-28 已于 RFC-007 Round 3 关闭，见 §8.15）。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-27** | 夜间**同一结算点**可以同时满足两个阵营的胜利条件：最后一个神被狼刀、最后一只狼被女巫毒杀（`makeNightState` 残局，两个 action 都合法）。`RULES.md` §6 的 RUL-1 与 `RFCS.md` C-6 的「同时达成不可能」只论证了**猎人开枪**这一种来源，没有覆盖**狼刀 + 女巫毒药**。`src/engine/win.ts:31-33,38-53` 先判「狼是否灭绝」→ 好人胜，注释自称「防御性」。这是合法输入上的**静默裁决**，违反 `ARCH-11` / `FEATURES.md` F8 AC-4 | **Closed（Round 4 复核）**（原为阻塞 RFC-003）。由用户裁决后写入 `RULES.md` §6（新 RUL 或修订 RUL-1）；裁决前至少让 `checkWin` 抛专用的「未裁决」错误，而不是静默选一个。补 `win.test.ts` / `death-resolve.test.ts` 的「两种屠边条件同时成立」用例（两种模式），并同步 RFC-003 §2.3、`TEST-STRATEGY` 与 `win.ts` 注释 | **Closed（Round 4 复核）** · `RULES.md:233`（RUL-1）、`RFCS.md` C-6、`src/engine/win.ts:31-33,38-53`、`src/engine/phases/night.ts:89-95`、`tests/engine/win.test.ts`（无同时条件用例）、`reviews/REVIEW-RFC-003.md` Round 3 §6 | **已落榜为规则（Round 3 修复）**：`RULES.md` §6 新增 **RUL-12「狼刀在先」**（`CHANGE-REQUEST-006`）——夜间同时满足两阵营胜利条件时判 wolf 胜；`checkWin` 的判定次序已反转，判定时机（RUL-1）不变。真实规则依据见 RFC-003 §11.1 的两条引用；**Round 4 复核：Closed**（复现 + 反向探针 M1 / M1b 见 §8.6）
| **C-28** | C-23 的事件通道已修，但**投影通道**仍暴露同样的隐藏信息：RFC-007 §2.2 的 `ProjectedContext` 直接输出 `phase: Phase`、`aliveSeats` / `deadSeats`。夜间 `state.phase` 是 `NIGHT_SEER` / `NIGHT_WITCH` / `NIGHT_HUNTER_SHOOT`（跳过或开枪阶段可直接推断身份存活 / 死因）；`state.seats` 在 `NIGHT_HUNTER_SHOOT` 时已含当夜全部死亡（探针：`deadSeats === [6,7]`）。RFC-003 §9.1 说「玩家端仍能看到天黑/天亮——它来自投影后的 `state.phase`」；按 RFC-007 的字段定义，玩家会看到内部子阶段，而不是「天黑」 | **非阻塞 RFC-003 的代码**（投影归 RFC-007），**但 RFC-007 开工前必须裁决**：把 `phase` 改成公共阶段（night / day / finished）或新增 `publicPhase`；`aliveSeats` / `deadSeats` 按公开事件（或上一次 `DAY_STARTED`）推导，夜间当夜死亡不进公共字段；RFC-007 的测试计划补死 seer / 死 witch / hunter 开枪夜三条；修正 RFC-003 §9.1 的表述 | **Closed（RFC-007 Round 3，2026-11-18；原非阻塞 RFC-003 / 阻塞 RFC-007）** · RFC-007 §2.2 `ProjectedContext`、RFC-003 §9.1、`src/engine/apply.ts:89-101`、`src/engine/phases/night.ts:97-106`、`reviews/REVIEW-RFC-003.md` Round 3 §7.2；**RFC-007 Round 1 复核（2026-11-18）**：仍 **Open**。真实路径探针（狼刀 hunter → 查验 → 女巫 `none`）得到普通观察者的 `phase=NIGHT_HUNTER_SHOOT`、`deadSeats=[5]`，此时 `publicEvents` 还没有 `DAY_STARTED`；死 seer / 死 witch 的夜分别得到 `NIGHT_SEER` / `NIGHT_WITCH`。`TEST-STRATEGY.md:262` 计划的 `tests/server/project/night-visibility.test.ts` 在仓库中不存在。**阻塞 RFC-007**。详见 `reviews/REVIEW-RFC-007.md` §2.1；**RFC-007 Round 2 复核（2026-11-18）**：phase 折叠与当夜 `deadSeats` 已验证（M1/M2 红），但 `aliveSeats` / `legalTargets` 无回归锁，且 `FINISHED` 夜间终局漏当夜死者——未闭环，见 §8.14 C-44；**RFC-007 Round 3 复核（2026-11-18）：Closed**——`phase` / `deadSeats` / `aliveSeats` / `legalTargets` 四条均有可红回归锁（Round 1/2 的 M1/M2 + Round 3 的 M3/M4/M4b/M7），真实种子 `4_242_424` 的夜间终局投影 `[1,2,3,4,6]` 与引擎一致。详见 `reviews/REVIEW-RFC-007.md` Round 3 §1.1-§1.3。 |

### 8.6 RFC-003 Round 4 复核登记的冲突（2026-11-18）

> 由第四轮 `/review-rfc 003` 登记；完整证据见 `reviews/REVIEW-RFC-003.md` Round 4。**C-27 已关闭**；C-29 原为「非阻塞 RFC-003、阻塞 RFC-004」，现已由 RFC-004 Round 1 复核关闭（见下）；C-30 非阻塞。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-27** | 夜间同一结算点同时满足两阵营胜利条件（详见 §8.5） | 用户裁决后落榜为 **RUL-12「狼刀在先」**；`checkWin` 先算 wolf 侧条件；RUL-1 的判定时机不变 | **Closed（Round 4）**：`RULES.md:244` 有 RUL-12；`src/engine/win.ts:48-62` 先算 wolf 侧；`tests/engine/win.test.ts:70-109` 与 `death-resolve.test.ts:253-287` 通过；反向探针 M1 / M1b（改回「先判狼全灭」）分别 3/15 与 1/20 变红，恢复后全绿 |
| **C-29** | RUL-12 落榜后，**旧的「同时达成不可能」表述没有同步**：`FEATURES.md:67`（F6 AC-4）说「因此两阵营不可能同时达成（RUL-1）」；`RULES.md:233` 的 RUL-1「依据」也说「这一条同时消除了两阵营同时达成的歧义」；`RFCS.md:166`（C-6）与 `:190`（OQ-C6）已关闭为「不可能」；`RFCs/RFC-004...:77-79` 的 §2.6 与 `:134` 的 Q-004-4 同样说「不存在」，且 RFC-004 的 `Rules` 头（`:5`）没有 RUL-12。这些都与 `PRD.md:101`（RA-1 明确说会出现该情形）和 `RULES.md:244`（RUL-12 判 wolf 胜）矛盾 | **按 PRD + RUL-12 判**：一个合法的夜间批次能同时满足两条件，RUL-12 是用户确认后的裁决；「不可能」是从 RUL-1 的猎人开枪场景外推出来的旧结论，不成立。**不要在本轮改 FEATURES / RULES / RFC-004**——由 `/manage-changes` 在同一个提交里同步：F6 AC-4、RUL-1 依据、C-6、OQ-C6、RFC-004 §2.6 / Q-004-4 / Rules 头。RFC-004 开工前必须完成 | **Closed（RFC-004 Round 1 复核，2026-11-18）**：`CHANGE-REQUEST-007`（v2.25）已同步全部五处——`RFCs/RFC-004...:5` 的 `Rules` 头含 RUL-12、§2.6（`:77-81`）与 Q-004-4（`:134`）已改、`FEATURES.md:67` 已改、`RULES.md:233` 已改、`RFCS.md:166,190` 已改。复核证据见 `reviews/REVIEW-RFC-004.md` §7.1；C-29 不再阻塞 RFC-004 |
| **C-30** | 文档漂移（非阻塞）：`README.md:11` 仍写 Round 3 `Changes requested` / 1 个 `Changes requested`，`:38-39` 仍写下一步 `/manage-changes`（C-27）→ `/implement-rfc 003`；`TEST-STRATEGY.md:3` 是 v1.11 / `RFCS.md v2.22`，同文件 `:450` 已是 v1.12；`src/engine/phases/visibility.ts:19-20` 仍说玩家从「投影后的 `state.phase`」看到天黑（C-28 已否定）；`RFCs/RFC-003:100` 仍说 `DAY_ANNOUNCE` 抛 `UnhandledTransitionError`（§8.3 / AC-16 已改为 `Rejected`）；`RFCs/RFC-003:201` 与 `TEST-STRATEGY.md:176` 把 AC-2 的 payload 断言归到 `deal.test.ts`，实际在 `events.test.ts:235-244` | 下一次 docs 提交同步；不阻塞 RFC-003。README 的状态叙述应以 `RFCS.md` 的 Status 列为准 | **Open（非阻塞）** · 上述文件与行 |

### 8.7 RFC-004 Round 1 评审登记的冲突（2026-11-18）

> 由 `/review-rfc 004` 登记；完整证据见 `reviews/REVIEW-RFC-004.md` Round 1 / 2 / 3。**C-31 已于 Round 3 关闭**；C-32 已于 Round 2 关闭；C-33 非阻塞。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-31** | **公开的 `DAY_STARTED.diedLastNight` 顺序泄漏死因。** RFC-004 §2.1 / AC-2 规定 `diedLastNight`「按死亡结算顺序」，且 `speechStartSeat` 取「结算顺序第一位死者」的下一位；而 RFC-003 §2.3 / `src/engine/resolve/deaths.ts:69-86` 的结算顺序固定为「先狼刀、后毒药」。于是两人同夜出局时，任何观察者（含 RFC-007 会喂给 AI 的 `publicEvents`）都能从公开顺序断定哪一个是狼刀、哪一个是女巫毒——即「女巫今晚毒了谁」这条**他人夜间行动**。RFC-003 D-3 为了让死因不公开，专门把夜间 `PLAYER_DIED` 设为 `server`（`RFCs/RFC-003...:159`、§9.4 `:284` 明确写「payload 只有天数与死者、没有死因」）；`PRD.md:153`（FR-9）也禁止注入「他人夜间行动」。RFC-003 的 B2 / C-23 修的正是同一类泄漏 | **阻塞 RFC-004**，需用户裁决（不能由实现者顺手改规格）：① `diedLastNight` 改成与死因无关的顺序（座位升序）；② `speechStartSeat` 改成与死因无关的规则（座位最小死者的下一位 / 每天抽一次），并同步 `PRD.md:149`（FR-5「首个死者」）的解释；③ 补回归：交换两名死者的座位后，公开 payload 的顺序与起点都不得随死因变化。按权威顺序 `PRD > RFC`，取 PRD FR-9 | **Closed（Round 3 复核，2026-11-18）** · `src/engine/phases/day.ts:47,67`、`src/engine/apply.ts:237`、`src/engine/resolve/deaths.ts:69-86`、`RFCs/RFC-004...:24,31,107`、`PRD.md:149,153`；`reviews/REVIEW-RFC-004.md` Round 1 §4.1 / B1、Round 2 §R2.2、Round 3 §R3.2。**Round 1 修复**：公告按座位升序、发言起点取座位最小死者的下一位（`CHANGE-REQUEST-008`）。**Round 2 复核**：起点用例在死者为 1/9 时是空断言（三种候选实现得到同一个起点），M2 / M3 改坏实现后全套 342 用例仍全绿，C-31 未关闭。**Round 3 修复与复核**：夹具改为「wolf 刀村民 6 + witch 毒 wolf 2」，公开 payload 为 `{"diedLastNight":[2,6],"speechStartSeat":3}`（结算顺序是 `[6,2]`）；起点改为对 `dayAnnounceEntry` 的直接断言（`pendingDeaths` 为 `[7,3]` / `[3,7]` 都必须得到 4）；M1（去掉 sort）2 红、M2（`deaths[0]`）1 红、M3（最大死者）1 红，均实跑，探针后 342 用例全绿 |
| **C-32** | `FEATURES.md:66`（F5 AC-4）写「平票重投…选项集为并列者 **+ 弃权**」，与 `RULES.md:234`（RUL-2「不能弃权」）、RFC-004 AC-8、`src/engine/phases/vote.ts:128` 冲突。`changes/CHANGE-REQUEST-002.md:28` 的 R-2 影响面只列「RULES、RFC-001、RFC-004」，漏了 FEATURES | **按 RUL-2 判（非阻塞 RFC-004 代码）**：`PRD.md:102`（RA-2）是开放歧义，`PRD.md:349`（D40）把 RA-2 的裁决权委托给 `RULES.md`，用户在 CR-002 已拍板「只能投并列者」；FEATURES 是漏改的派生文档。由 `/manage-changes` 把 F5 AC-4 改为「并列者本身」，不改代码 | **Closed（Round 2 复核）** · `FEATURES.md:66`、`RULES.md:234`、`RFCs/RFC-004...:113`、`src/engine/phases/vote.ts:128`、`PRD.md:102,349`、`changes/CHANGE-REQUEST-002.md:28,61-66`；`reviews/REVIEW-RFC-004.md` §4.5 / C-32；**Round 1 修复**：`FEATURES.md` F5 AC-4 同步为「选项集仅为并列者本身、不能弃权」（`CHANGE-REQUEST-008`）；Round 2 复核 `FEATURES.md:66` 已是「仅为并列者本身、不能弃权」 |
| **C-33** | **F7 的效果插入点在真实结算上没有接线。** `FEATURES.md:68`（F7 AC-1）要求「每个结算点（夜间行动 / 投票 / 出局 / 胜负判定）产出有序效果列表」，AC-3 要求用「该玩家本日投票无效」这类假效果证明插入点能改变结算结果。但 `VOTE_RESOLVE` / `DEATH_RESOLVE` / `WIN_CHECK` 三个 `ResolutionPoint` 在 `src/` 里没有任何调用点；`step(state, action, modifiers)` 只把 `modifiers` 放进 `HandlerContext`，`night.ts:84,324` 与 `lynch.ts:34` 直接调 `applyEffects`，`vote` 结算根本不产出效果。现有测试（`effects.test.ts:91-108`、`step.test.ts:91`）只证明 `applyModifiers` 本身与「自定义 handler + step」的合成链路，没有走真实 handler——RFC-002 评审 N9 当时就点明「RFC-003/004 第一次写结算时若忘记接线，现有测试不会红」 | **非阻塞 v1**（`C-21` 同款：不注册任何 modifier，无可观察行为差异），但必须在 RFC-002 的 `C-21` 关闭前一起决定：要么在 RFC-004 的 `settle` / `lynchEntry` / `checkWin` 调用点接 `applyModifiers` 并补真实路径测试，要么由 `/manage-changes` 收窄 F7 的可观察面。不要把它留成「代码里有个 `modifiers` 参数就算实现」 | **Open（非阻塞）** · `src/engine/step.ts:231,238-246`、`src/engine/phases/night.ts:84,324`、`src/engine/phases/lynch.ts:34`、`src/engine/phases/vote.ts:92-118`、`FEATURES.md:68`、`RFCs/RFC-002...` §2.4、`reviews/REVIEW-RFC-002.md` N9；`reviews/REVIEW-RFC-004.md` §3 PROBE-C / C-33（`seen: []`） |

### 8.8 RFC-003 Round 5 窄范围复核（2026-11-18）

> 由第五轮 `/review-rfc 003` 登记（用户指定只复核 AC-16 与 RFC-004 自动阶段、RFC-002 AC-8 的关系）。完整证据见 `reviews/REVIEW-RFC-003.md` Round 5。**三个复核点均通过**，AC-16 的改动成立；本表只留一条非阻塞文档残留。RFC-003 Status：`Spec changed` → **`Reviewed`**。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-34** | **AC-16 的连带文档残留（非阻塞）**：① `RFCs/RFC-003...:59` 的 §2.3 第 8 步仍是「未结束则进入 `DAY_ANNOUNCE`」，**没有**「由 RFC-004 取代」的加注——而 `RFCs/RFC-004...:172`（§8.3）称「§2.3 第 8 步已更新，并注明」；`git log -S` 显示 `d435add` 只改了 AC-16。② `TEST-STRATEGY.md:190` 的 AC-16 测试计划仍写「夜晚结束进 `DAY_ANNOUNCE`」。③ `tests/engine/death-resolve.test.ts:58` 的用例名仍写「推进到 `DAY_ANNOUNCE`」，断言却是 `DAY_SPEECH`（`:67`）。④ AC-16 字面第二句「对该阶段的非法 action…」只在 `DAY_ANNOUNCE` 上有直接用例（`tests/engine/night.test.ts:138-156`），`DAY_SPEECH` 没有永久用例（临时探针已证明行为正确：`REJECTED / PHASE_MISMATCH`、phase 不变、除 `seq` 外状态深度相等） | **不阻塞 RFC-003**。代码与 AC-16 的主断言都对；`§2.3` 的「进入 `DAY_ANNOUNCE`」本身不假（确实进入、随后由自动阶段接手）。下一次 docs 提交补 §2.3 的一句注、把 TEST-STRATEGY 的 AC-16 行改成 `DAY_SPEECH`、改掉 `death-resolve.test.ts:58` 的用例名；可选补一条 `DAY_SPEECH` 拒绝用例 | **Open（非阻塞）** · `RFCs/RFC-003...:59`、`RFCs/RFC-004...:172`、`TEST-STRATEGY.md:190`、`tests/engine/death-resolve.test.ts:58,67`、`tests/engine/night.test.ts:138-156`、`reviews/REVIEW-RFC-003.md` Round 5 |

### 8.9 RFC-005 Round 1 评审登记的冲突（2026-11-18）

> 由 `/review-rfc 005` 登记；完整证据见 `reviews/REVIEW-RFC-005.md` Round 1。**C-35 / C-36 / C-37 阻塞 RFC-005**；C-38 非阻塞。评审时 HEAD `6c830d8`，工作树 clean；门禁 `pnpm typecheck` / `lint` / `format:check` / `build` / `test`（44 files / 366 tests）全绿，覆盖率行 96.95% / 分支 93.31%。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-35** | **第二夜起没有 `NIGHT_WOLF_CHAT`。** `src/engine/phases/vote.ts:82-88` 的 `enterNight` 仍一次发两条相位事件 `from → NIGHT_WOLF_CHAT → NIGHT_WOLVES`；投票结算、平票、全员弃权、放逐、白天开枪之后的夜晚都直接落在 `NIGHT_WOLVES`，`state.wolfChat` 被清空，狼人无法提交 `WOLF_CHAT`。这与 RFC-005 §2.2 / §4 / AC-5 冲突，也与 §8.2 D-6「跳过夜聊补丁随之删除」和 §8.5「`vote.ts`（`enterNight` 只发一条相位事件）」相反；`tests/engine/vote.test.ts:113-114,199,215` 与 `tests/engine/lynch.test.ts:44,160` 还把「跳过」写成期望值。实测固定种子：第一天全员弃权后 `phase === 'NIGHT_WOLVES'`、`wolfChat === undefined`；把 `enterNight` 改成只发一条后，`vote.test.ts` + `lynch.test.ts` 5 红（M13） | **阻塞 RFC-005**。`enterNight` 只发 `from → NIGHT_WOLF_CHAT`；更新 `vote.test.ts` / `lynch.test.ts` 的期望；补「第二天正常结束后仍停在 `NIGHT_WOLF_CHAT`」的回归测试；同步 `vote.ts:83` 与 `night.ts:18` 的过时注释 | **Open（阻塞）** · `src/engine/phases/vote.ts:82-88`、`src/engine/phases/night.ts:18`、`tests/engine/vote.test.ts:113-114,199,215`、`tests/engine/lynch.test.ts:44,160`、`reviews/REVIEW-RFC-005.md` §B1 / M13 | **已关闭（Round 2 复核通过）**：`enterNight` 只发一条相位事件；5 条把「跳过夜聊」当预期的断言改为 `NIGHT_WOLF_CHAT`，并新增第二夜用例（M-R2-1 改回两条 → 6 红；另做端到端探针确认第二夜夜聊可走完并接上狼刀）
| **C-36** | **`DAY_VOTE` 自曝不取消已投出的票。** `src/engine/apply.ts:118-126` 进入 `NIGHT_WOLF_CHAT` 时清空 `night` / `pendingDeaths` / `wolfChat`，但不清 `votes`（也不清 `speech` / `runoff` / `lynched`）。正常白天结束有 `VOTE_REVEALED` 清票箱，自曝路径没有。实测：DAY_VOTE 1 号投 4 号 → 狼 2 号自曝 → `NIGHT_WOLF_CHAT` 仍保留 `votes [{seat:1,target:4}]` → 夜里 4 号被刀 → 下一天全员弃权 → 旧票把已出局的 4 号算成最高票 → `DAY_LYNCH` 产出 `PLAYER_DIED(4)` → `InvalidEventStreamError: 座位 4 已经出局，PLAYER_DIED 重复`。这是合法 action 序列，违反 AC-10「当日投票被取消」，并与 `C-24` 同类。现有 `self-expose.test.ts` 只查本步事件，M14 加 `delete next.votes` 后仍 7 passed，证明测试完全没锁住这条清理 | **阻塞 RFC-005**。进入 `NIGHT_WOLF_CHAT` 时清空 `votes`（并一并清 `speech` / `runoff` / `lynched`）；补「DAY_VOTE 已有人投票 → 自曝 → 下一夜 / 下一天无旧票、不崩溃」的回归测试，覆盖「被投者夜里出局」分支 | **Open（阻塞）** · `src/engine/apply.ts:118-126`、`src/engine/phases/self-expose.ts:46-49`、`tests/engine/self-expose.test.ts:16-64`、`reviews/REVIEW-RFC-005.md` §B2 / M14 | **已关闭（Round 2 复核通过）**：进入 `NIGHT_WOLF_CHAT` 时清空 `votes` / `runoff` / `lynched`；新增「先投票再自曝」用例（M-R2-2 删 `delete next.votes` → 1 红；完整序列「自曝 + 被投者夜死 + 次日弃权」不再崩）
| **C-37** | **RFC-005 正文未回写用户关于可见性的裁决。** 用户裁决「狼队频道不因成员出局中断」已记录在 §8.1（`:121`）与 §8.3（`:136-140`），`src/shared/visibility.ts:42-46` 也正确实现（`wolves` 不看死活；`seer` / `witch` / `hunter` / `self` 仍按死亡收窄）。但 §2.1 的 `wolves` 行（`:27`）、§2.4（`:56-60`）、§5 AC-3（`:84`）、§7 Q-005-1（`:107`）仍写「死狼看不到死后事件」，与裁决和实现相反。§2.1 是规范性表格，下游 RFC-011 / RFC-013 会读；AC-3 原文仍然自相矛盾 | **阻塞 RFC-005（文档）**。按用户裁决 + §8.1 / §8.3 更新 §2.1 / §2.4 / §7 / §5 AC-3；把 §3 交付物表的 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts` 改为实际路径（`src/shared/visibility.ts` 不新建已由 §8.1 记录；实际文件是 `src/engine/phases/self-expose.ts`） | **Open（阻塞）** · `RFCs/RFC-005...:27,56-60,84,107,121,135-139`、`src/shared/visibility.ts:42-46`、`RFCs/RFC-001...:231`、`reviews/REVIEW-RFC-005.md` §B3 | **已关闭（Round 2 复核通过）**：§2.1 的 `wolves` 行、§2.4、Q-005-1、AC-3 四处全部回写裁决，与 `src/shared/visibility.ts` 逐条一致；规范性段落无「死狼看不到」残留
| **C-38** | **非阻塞的文档 / 测试计划残留**：① RFC-005 §3 的交付物路径仍写 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts`（见 C-37）；② `TEST-STRATEGY.md:229` 原计划 AC-13「存活计数不变、`checkWin` 结论不变」，实现只测了存活计数，且改动没有记入 Implementation Notes；③ RFC-005 §4 的「500 字截断」没有测试——M18 去掉截断后 unit 332 全绿；④ `tests/engine/reject.test.ts:37` 的标题仍说「开局后所有 action 都被拒」（现在 `WOLF_CHAT` 允许）、`tests/engine/transitions.test.ts:53` 仍把夜聊列为无 action 阶段、`tests/fixtures/night.ts:8,14-16` 重复 import；⑤ `TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.32`，`README.md` 的状态仍是「RFC-005 Implemented，等待评审」 | 下一次 docs / 修复提交同步；不阻塞代码，但 N1 / N2 应至少补一条断言或记录理由 | **Open（非阻塞）** · `RFCs/RFC-005...:67-69,151`、`TEST-STRATEGY.md:3,229`、`README.md:13,38-40`、`tests/engine/reject.test.ts:37`、`tests/engine/transitions.test.ts:53`、`tests/fixtures/night.ts:8,14-16`、`reviews/REVIEW-RFC-005.md` §5 | **部分关闭（Round 2）**：③ 500 字截断已补测并通过反向探针（M-R2-4 删截断 → 1 红）；① / ② / ④ 与 ⑤ 的 TEST-STRATEGY 版本引用仍开放（非阻塞，见 §8.10 C-39）；⑤ 的 README 状态已在本轮同步为 `Reviewed`

### 8.10 RFC-005 Round 2 复核（2026-11-18）

> 由第二轮 `/review-rfc 005` 登记；完整证据见 [`reviews/REVIEW-RFC-005.md`](reviews/REVIEW-RFC-005.md) Round 2。**四项复核全部通过，无阻塞**；HEAD `1cde90e`，工作树 clean；门禁 44 files / 369 tests、覆盖率行 96.96% / 分支 93.31%。C-35 / C-36 / C-37 关闭，C-38 仅 ③ 关闭。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-39** | **Round 2 复核发现的非阻塞残留**：① RFC-005 §8.9 的「本轮实跑」仍写 366 tests / 96.95%（实际 369 / 96.96）；② 过时注释——`tests/engine/vote.test.ts:113` 仍写「`NIGHT_WOLF_CHAT` 被跳过」、`src/engine/phases/night.ts:15` 仍写「本 RFC 跳过」、`tests/engine/reject.test.ts:37` 标题「所有 action 都被拒」、`tests/engine/transitions.test.ts:52` 注释把夜聊列为无 action 阶段、`tests/fixtures/night.ts:12,16` 重复 import；③ RFC-005 §3 交付物路径仍是 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts`（C-38 ①）；④ `runoff` / `lynched` 的夜聊入口清理无独立断言（M-R2-3 全绿）；⑤ `TEST-STRATEGY.md:3` 仍引用 RFCS v2.32，C-38 ② 的 `checkWin` 计划在 `6c830d8` 被静默删掉且未记录理由；⑥ 500 字用例只断言长度 | 不阻塞合并；建议下一次 docs / 修复提交一并处理 | **Open（非阻塞）** · `RFCs/RFC-005...:67-69,206`、`tests/engine/vote.test.ts:113`、`src/engine/phases/night.ts:15`、`tests/engine/reject.test.ts:37`、`tests/engine/transitions.test.ts:52`、`tests/fixtures/night.ts:12,16`、`TEST-STRATEGY.md:3`、`reviews/REVIEW-RFC-005.md` Round 2 §7 |

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

### 8.12 RFC-006 / RFC-007 的依赖声明写反了（C-40）

> 由用户裁决触发：他在 RFC-006 的开工计划里选择「先做投影（007），再做 LLM（006）」。

| # | 冲突 | 处理 | 状态与痕迹 |
|---|---|---|---|
| **C-40** | 索引表与两份 RFC 的抬头都写「007 依赖 006」。但按正文，**实际是 006 依赖 007**：RFC-006 §2.4 的 `buildUserMessage(ctx: ProjectedContext)` 要用 RFC-007 的类型；RFC-007 的 `INJECTION_NOTICE` 常量由 006 的 `buildSystemPrompt` 引入；连「AI 发言超长由谁截断」也写在 006。RFC-007 自身是纯函数，不调 LLM、不依赖 006 的任何东西 | 按用户裁决改顺序：**RFC-007 只依赖 RFC-005；RFC-006 依赖 RFC-004 + RFC-007**。同步改 `RFCS.md` §1 的依赖图与 §3 的依赖表 | **已修（RFC-007 Round 1 复核补全）** · `RFCs/RFC-006` 抬头、`RFCs/RFC-007` 抬头、`RFCS.md` §1/§3；评审时发现 §3 依赖表、§1 关键路径与 §1.1 映射表仍是错的，已同步修正。`RFCs/RFC-006` §1 的「此时还没有上下文投影」也已去掉。证据见 `reviews/REVIEW-RFC-007.md` §1.2 |

### 8.13 RFC-007 Round 1 评审登记的冲突（2026-11-18）

> 由第一轮 `/review-rfc 007` 登记；完整证据见 `reviews/REVIEW-RFC-007.md`。C-41 阻塞 RFC-007 / RFC-006（已于 Round 3 关闭，见 §8.15）；C-42 / C-43 非阻塞 RFC-007。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-41** | `AI_THOUGHT` 是 RFC-007 §2.5 定义的私有事件，要求进事件流并可重放；但 `applyEvent` 没有折叠它，`default` 抛 `UnknownEventError`。`project()` 对每条事件都调用 `applyEvent`，因此事件流里一出现 `AI_THOUGHT`，投影就抛错。`tests/engine/replay.test.ts:288-301` 还把 `AI_THOUGHT` 当作「未实现事件」断言抛错，与 RFC-007 AC-15 直接冲突 | **阻塞 RFC-007 / RFC-006**。按 RFC-007 实现：给 `AI_THOUGHT` 加 no-op 折叠（不写 state，只推进 `seq`），把 RFC-002 的「未实现事件」用例换成真正未知的类型，补 `project()` 的 AC-15 用例（本人 `privateEvents` 有、其余 8 人没有） | **Closed（RFC-007 Round 3，2026-11-18）** · `src/shared/events.ts:132`、`src/engine/apply.ts:95-97`、`src/server/project/index.ts:35`、`tests/engine/replay.test.ts:288-301`、`RFCs/RFC-007...:97-107,172-173,242`、`reviews/REVIEW-RFC-007.md` §2.2；**RFC-007 Round 2 复核（2026-11-18）**：`AI_THOUGHT` 空折叠正确，但 AC-15 仍无投影用例；删除折叠后 48 files / 400 tests 全绿——未闭环，见 §8.14 C-45；**RFC-007 Round 3 复核（2026-11-18）：Closed**——`tests/server/project/thought.test.ts` 的 4 条用例在 M5（删除 `applyEvent` 的 `AI_THOUGHT` 分支）下全部变红；`replay.test.ts` 改用 `DEGRADED` 作为未实现事件样本。详见 `reviews/REVIEW-RFC-007.md` Round 3 §1.5。 |
| **C-42** | RFC-007 §3 的交付物写 `src/server/llm/inject.ts`，实现落在 `src/server/project/inject.ts`（D-1 已记录）；但 `escapeAngleBrackets` 被放进 `src/shared/injection.ts`，使 `src/shared/` 出现第三处运行时逻辑。`ARCH-2` 只允许类型与纯常量，C-13 的例外只列了 `visibility.ts` 与 `schemas.ts`；D-2 的「纯函数符合 ARCH-2」理由不成立 | **非阻塞 RFC-007，阻塞一次规则同步**：把 `escapeAngleBrackets` 移到 `src/server/project/inject.ts`，或由 `/manage-changes` 把 C-13 的例外扩为「类型、纯常量、`visibility.ts`、`schemas.ts`、`injection.ts`」 | **Open（非阻塞）** · `src/shared/injection.ts:20-22,31-42`、`src/server/project/inject.ts:1-14`、`RULES.md:127`、`RFCS.md` C-13、`RFCs/RFC-007...:210`、`reviews/REVIEW-RFC-007.md` §2.4 / §7 N1；**RFC-006 Round 3 复核（2026-11-18）**：C-54 的修复把 `wrapPublicUtterance` 也移入该文件，冲突范围扩大，见 §8.18 C-57 |
| **C-43** | RFC-007 §2.6 把 `wrapPublicUtterance` 的签名写成 `: string`，但 AC-13 又要求超长输入「返回错误码」；实现返回 `{ ok: true; text } \| { ok: false; code }`。两者不能同时成立，§8 的 Implementation Notes 也没有记录这个偏离 | **非阻塞**：按 AC-13 的可用性要求改 §2.6 的签名为 `WrapResult`，并在 §8.2 记一条；不要改成抛异常或截断 | **Open（非阻塞）** · `RFCs/RFC-007...:112,169-174`、`src/server/project/inject.ts:12-28`、`reviews/REVIEW-RFC-007.md` §2.4 / §7 N2 |

### 8.14 RFC-007 Round 2 复核登记的冲突（2026-11-18）

> 由第二轮 `/review-rfc 007` 登记；完整证据见 `reviews/REVIEW-RFC-007.md` Round 2。**C-44 / C-45 / C-46 已由 §8.15 的 Round 3 复核关闭。**

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-44** | C-28 的 Round 2 复核未闭环：`aliveSeats` / `legalTargets` 两条修复腿没有回归锁（M3 / M4 全绿）；`FINISHED` 夜间直接终局时 `deadSeats` / `aliveSeats` 漏当夜死者（固定种子 `4_242_424`：引擎 `[1,2,3,4,6]` vs 投影 `[1,2,3,4]`） | **阻塞 RFC-007**。补 `aliveSeats` / `legalTargets` 断言；明确 `FINISHED` 的「已公布」边界（建议终局用引擎真值，或由 `GAME_ENDED` 携带最终死者）并补真实路径用例 | **Closed（RFC-007 Round 3，2026-11-18）** · `src/server/project/index.ts:64-82`、`src/server/project/targets.ts:10-37`、`tests/server/project/night-visibility.test.ts:85-109`、`TEST-STRATEGY.md:262`、`reviews/REVIEW-RFC-007.md` Round 2 §1.2 / §1.3；**Round 3 复核**：真实种子 `4_242_424` 的 `FINISHED` 投影死者 `[1,2,3,4,6]` 与引擎一致；M3 / M4 / M4b / M7 分别 2 / 1 / 2 / 1 红。新增用例的夹具是手工终态而非真实路径，已列为非阻塞建议。 |
| **C-45** | C-41 的 `applyEvent` 空折叠正确，但 RFC-007 AC-15 仍没有 `AI_THOUGHT` 投影用例；删除空折叠后 48 files / 400 tests 全绿。`tests/server/inject/injection.test.ts:57-68` 的 `AC-15` 实际断言的是 `INJECTION_NOTICE`（AC-11） | **阻塞 RFC-007**。补「真实 `GAME_STARTED` + 合成 `AI_THOUGHT`」的 `replay` / `project` 用例（本人 `privateEvents` 有、其余 8 人没有）；把 `injection.test.ts` 的 AC-15 标题改回 AC-11；同步 RFC §8.4 | **Closed（RFC-007 Round 3，2026-11-18）** · `src/engine/apply.ts:84-87`、`tests/engine/replay.test.ts:288-302`、`tests/server/inject/injection.test.ts:57-68`、`RFCs/RFC-007...:242`、`reviews/REVIEW-RFC-007.md` Round 2 §1.4；**Round 3 复核**：`thought.test.ts` 4 条；M5 删除 `AI_THOUGHT` 折叠后 4 红。`injection.test.ts:57` 的 AC-15 错标仍未改，已列为非阻塞。 |
| **C-46** | B3 的 AC-8 / AC-9 测试仍是同义反复：`knowledge.test.ts:256-268` 只查重与互斥，没有按 §2.3 独立折叠出期望集合；`project.test.ts:206-220` 比较的是两个输出集合与自己；探针把 `GAME_STARTED`（含全员 `roles`）塞进 `privateEvents`，31/31 仍绿 | **阻塞 RFC-007**。新增 `partition.test.ts`（或等价测试）：按序折叠 + `isVisibleTo` 独立得到期望集合，断言 `publicEvents ∪ privateEvents` 的 `seq` 集合与它相等（扣除 `excludeSeq`）、不含任何 `visibleTo === 'server'` 事件；补 AC-2 的 1000 局面属性测试 | **Closed（RFC-007 Round 3，2026-11-18）** · `tests/server/project/knowledge.test.ts:256-268`、`tests/server/project/project.test.ts:206-220`、`TEST-STRATEGY.md:256`、`reviews/REVIEW-RFC-007.md` Round 2 §1.5 / §4 M6b；**Round 3 复核**：`partition.test.ts` 在测试内独立折叠 + 断言不含 server 事件；M6b（把 `GAME_STARTED` 塞进每个 `privateEvents`）2 红。AC-2 的 1000 局面属性测试仍缺，已列为非阻塞。 |

### 8.15 RFC-007 Round 3 复核（2026-11-18）

> 由第三轮 `/review-rfc 007` 登记；完整证据见 `reviews/REVIEW-RFC-007.md` Round 3。**C-28 / C-41 / C-44 / C-45 / C-46 关闭；RFC-007 Status → `Reviewed`。**

| # | 复核项 | 证据 | 状态 |
|---|---|---|---|
| C-44 | 终局揭示、`aliveSeats` / `legalTargets` 回归锁 | 真实种子 `4_242_424` 的 `FINISHED`：引擎死者 `[1,2,3,4,6]` = 投影；M3 / M4 / M4b / M7 分别 2 / 1 / 2 / 1 红 | **Closed** |
| C-45 | `AI_THOUGHT` 投影 / replay / 空折叠 | `thought.test.ts` 4 条；删掉 `applyEvent` 分支 → 4 红（M5） | **Closed** |
| C-46 | AC-8/9 独立折叠 + 不含 server 事件 | `partition.test.ts` 3 条；把 `GAME_STARTED` 塞进 `privateEvents` → 2 红（M6b） | **Closed** |
| C-28 | 投影通道（`phase` / `deadSeats` / `aliveSeats` / `legalTargets`） | Round 1/2 的 M1 / M2 仍成立；Round 3 的 M3 / M4 / M7 实跑；`FINISHED` 真实路径一致 | **Closed** |
| C-41 | `AI_THOUGHT` 空折叠 | Round 2 的 P2 仍成立；M5 已能打红 | **Closed** |

Round 3 的非阻塞发现（不阻塞 `Reviewed`）：

1. `aliveSeats` / `legalTargets` 只锁了「夜间未公开死者不得消失」这个危险方向；反方向（天亮 / 放逐后已知死者必须移出）无锁——M8 / M9 把两者改成「全部座位」仍 43/43 全绿。
2. `src/server/project/targets.ts:29` 的 `DAY_VOTE_RUNOFF` 分支没有排除观察者自己（真实路径 observer=2、`runoff=[2,3]` 时 `legalTargets` 仍含 2）；引擎允许自投，所以是口径不一致而不是崩溃 / 泄漏。
3. 观察者自己是夜间死者（hunter）时，`self.alive=false` 但 `aliveSeats` 含自己、`deadSeats` 为空；不向他人泄漏，但上下文自相矛盾。
4. `night-visibility.test.ts:154-169` 的终局用例是手工改 `FINISHED`，不是 `4_242_424` 的真实路径；建议替换 / 补充（真实路径本评审已临时验证）。
5. `injection.test.ts:57` 的 AC-15 标题、`night-visibility.test.ts:142` 的「投票阶段」标题未同步；AC-2 的 1000 局面属性测试仍缺；RFC §8.4 / §8.5 与 `TEST-STRATEGY` 的 `existing` 标记仍有漂移。

### 8.16 RFC-006 Round 1 评审登记的冲突（2026-11-18）

> 由第一轮 `/review-rfc 006` 登记；完整证据见 [`reviews/REVIEW-RFC-006.md`](reviews/REVIEW-RFC-006.md)。**C-47 ~ C-52 当时阻塞 RFC-006；C-53 非阻塞。** Round 4 后 C-47 / C-48 / C-49 / C-50 已关闭，C-51 / C-52 关闭；C-53 仍 Open（非阻塞，`Exists?` 已回填，Test 列 / FEATURES `claimedRole` 仍待收尾）。
> 评审时 HEAD `b9e0a76`，工作树 clean；门禁 54 files / 438 tests 全绿（覆盖率行 96.69% / 分支 93.33%）。所有探针从文件备份恢复，没有 `git commit`。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-47** | **AC-6（重试不重复 action）没有实现也没有归属。** RFC-006 §2.3 把去重交给调用方，§8.5 写「RFC-008 / 后续」；但 AC-6 仍是本 RFC 的 Must 验收项，`FEATURES.md:79` F11 AC-2（Must）只出现在 RFC-006 的 Features 头里。RFC-008 的 Features 是 F34–F37（其幂等是玩家提交 action 的 `expectedVersion`），RFC-011 才拥有编排层但前置只有 005 / 007。`TEST-STRATEGY.md:239` 仍把 AC-6 列为 Must 的 `proposed` 测试，仓库里没有任何对应用例。**且 §2.3 的键 `(gameId, seat, action.type)` 不足以满足 AC-6**：重试后 `vote` → `abstain` 时 `action.type` 不同，按该键两个 action 都会被放行；AC-6 要的是 `(gameId, seq, seat)` 级别的至多一个（§8.5 自己也写成了 `(gameId, seq, seat)`，同一份 RFC 两个版本）。 | **阻塞 RFC-006**。二选一：① 在 `src/server/llm/` 交付按 `(gameId, seq, seat)` 去重的最小接缝（例如 `DecisionGate` / `emitOnce`）并补「同一决策轮次重试两次只产出一个 action」的测试；② 走 `/manage-changes` 把 AC-6 / F11 AC-2 正式移到 RFC-011，把 006 加入 RFC-011 前置，并同步 `FEATURES.md`、`TEST-STRATEGY.md`、`RFCS.md` §3。不能只把「RFC-008 / 后续」留在 §8.5。 | **Closed（Round 2 复核）** · `RFCs/RFC-006...:92,158,240`、`FEATURES.md:79`、`TEST-STRATEGY.md:239`、`src/server/llm/to-action.ts`、`reviews/REVIEW-RFC-006.md` §5 / B1 |
| **C-48** | **`AI_THOUGHT` 的产出被静默丢掉。** RFC-007 §8.6 明确「本 RFC 定义了它的可见性与归属，产出在 RFC-006」；`FEATURES.md:84` F16 AC-3 要求「`reason` 写入事件流」。但 `grep -rn AI_THOUGHT src/server src/client` 零命中，`src/server/llm/` 没有构造该事件的代码或测试，RFC-006 §8.5 也没有把它列为缺口。`decide()` 返回的 `Decision.reason` / `claim` 因此没有持久化路径。 | **阻塞 RFC-006**。在 006 提供一个纯事件构造器（`visibleTo: 'self:<seat>'`，`payload: { reason, claim, decisionSeq: meta.seq }`）并测试 `claim` 原样嵌套、`reason` 保留；或由 `/manage-changes` 改派给 RFC-011，并同步 RFC-007 §8.6、FEATURES F16、TEST-STRATEGY。 | **Closed（Round 2 复核）** · `RFCs/RFC-007...:258`、`RFCs/RFC-006...:57`、`FEATURES.md:84`、`src/server/llm/schema.ts:25`、`reviews/REVIEW-RFC-006.md` B2 |
| **C-49** | **投影的 `ProjectedPhase` 与决策的 `Phase` 是两套口径。** `ProjectedContext.phase` 在夜间折成 `'NIGHT'`（`src/shared/project.ts:34`、`src/server/project/index.ts:104-106`），而 `DecisionContext.phase` 是 14 值的 `Phase`（`to-action.ts:16-22`）；`client.ts:92` 用 `as CallMeta['phase']` 把投影 phase 塞进 `CallMeta`，探针实跑 `meta.phase = NIGHT`，`'NIGHT'` 不在 `PHASES` 里。`DecisionContext.pending` 被加了却从未被读取，`buildUserMessage` 也不读 `pending`。 | **阻塞 RFC-006**。统一口径：① 推荐 `DecisionContext` 改用 `ProjectedPhase` + `pending` 判定，`CallMeta.phase` 也改为 `ProjectedPhase`（或另加 `enginePhase: Phase`）；或 ② `DecideInput` 显式接收引擎 `state.phase`，投影 phase 只用于提示。删掉 `as` 与未用的 `pending`，补「投影 → toAction」的端到端用例。 | **Closed（Round 2 复核）** · `src/server/llm/client.ts:92`、`src/server/llm/to-action.ts:16-22`、`src/shared/project.ts:34,49`、`src/server/project/index.ts:104-106`、`reviews/REVIEW-RFC-006.md` B5 |
| **C-50** | **提示组装没有把对局内容与决策契约交给模型。** `buildUserMessage` 只渲染 `- ${event.type}`（`src/server/llm/prompts/base.ts:56-61`）：发言原文、票型、死者、`pending`、女巫药水 / 刀口、猎人 `canShoot`、狼队夜聊都没有进入提示；系统提示也没有列出 12 个合法 `action` 或 `speech` / `claim` 字段。RFC-007 的 `wrapPublicUtterance`（`src/server/project/inject.ts:19-27`）从未被使用，防注入层在真实提示里没有数据可包。`rules.ts:21` 还把胜利条件写死为屠边，`GameState.mode` 的屠城局会收到错误规则。 | **阻塞 RFC-006（或正式划给 RFC-011）**。若留在 006：渲染上述字段，发言走 `wrapPublicUtterance`，系统提示列出 action / speech / claim（或改用 JSON Output + `DecisionSchema`），并把 mode 传入规则书；若交给 RFC-011：把「提示内容与注入槽位」写进 RFC-011 AC，把 006 加进其前置，并同步 RFC-007 §2.6 的消费说明。 | **Closed（Round 4 复核）** · `RFCs/RFC-006...:94-107`、`src/server/llm/prompts/base.ts:23-26,30-87`、`src/server/llm/prompts/rules.ts:17-34`、`RFCs/RFC-011...:96` AC-8、`reviews/REVIEW-RFC-006.md` B3 / C-56 / Round 4 §1；内容已渲染（发言 / 票型 / 死者 / 药水 / 刀口 / 可选动作），私有狼聊经 `<wolf_chat>` 封装（C-56 关闭），输出契约补 `speech` / `claim` / `reason`（N-R2）。 |
| **C-51** | **`speech` 的 300 字上限与 RFC 相反。** RFC-006 §2.2 与 D-6 写「超长截断而非拒绝」；`schema.ts:26` 的 `z.string().max(300)` 直接拒绝，仓库里没有任何截断代码（`grep` 无 `slice` / `substring` / `truncate`）。探针：301 字 → `success: false`、`too_big`，整条决策被丢弃并重试。 | **阻塞 RFC-006**。在校验前或 `toAction` 前截断到 300 字（例如 `speech.slice(0, 300)` / `.transform`），补 301 → 300 的测试，并修正 D-6 与 `to-action.ts:86` 的注释。 | **Closed（Round 3 复核）** · `RFCs/RFC-006...:59,206`、`src/server/llm/schema.ts:26-28`、`src/server/llm/to-action.ts:92-96`、`reviews/REVIEW-RFC-006.md` B4 / M4 / M5；schema 不限长，`toAction` 截断到 300；301 字经 `decide` → `toAction` 端到端为 300。 |
| **C-52** | **AC-1 / AC-2 / AC-13 的静态扫描有可复现盲区。** ① AC-1 说端点字面量只在 `client.ts`，实现放在 `config.ts:28`，`llm-isolation.test.ts:26` 却把 `config.ts` 与 `client.ts` 都列为允许；② `collectTypeScriptFiles` 只收 `.ts`（`tests/helpers/source-scan.ts:36-60`），`src/client/main.tsx` 不在扫描范围——把 `DEEPSEEK_API_KEY` 与 `api.deepseek.com` 写进 `main.tsx` 后 AC-2 仍绿；③ AC-13 的 needle 带单引号 `"'deepseek-flash'"`，双引号字面量可绕过。 | **阻塞 RFC-006（测试证据不足）**。AC-1 要么把端点移回 `client.ts`，要么在 RFC / 测试里正式把 `config.ts` 列为唯一配置源并改 AC 措辞；source-scan 扩到 `.tsx`（或安全扫描专用收集器）；needle 去掉引号；补 `.tsx` 与双引号的回归探针。 | **Closed（Round 3 复核）** · `RFCs/RFC-006...:153-154,165`、`src/server/llm/client.ts:24,87`、`tests/security/llm-isolation.test.ts:20-53`、`tests/helpers/source-scan.ts:36-60`、`reviews/REVIEW-RFC-006.md` B6 / M1 / M2 / M3；端点只在 `client.ts`；AC-13 不依赖引号；`.tsx` 已入扫描。真实超时分类另见 §8.18 C-55。 |
| **C-53** | **非阻塞文档漂移。** ① `TEST-STRATEGY.md:233-244` 的 RFC-006 行仍全部 `proposed`，且计划文件名 `retry.test.ts` / `schema.test.ts` / `meta.test.ts` / `prompt-identity.test.ts` 与实际落地的 `client.test.ts` / `to-action.test.ts` / `prompts.test.ts` / `llm-isolation.test.ts` 不一致；② `FEATURES.md:83-84` 的 F15 / F16 仍写 `claimedRole`，与 CR-003 C3 的嵌套 `claim` 不一致。 | **不阻塞 RFC-006 代码**。TEST-STRATEGY 按实际文件回填 `Exists?` 并补 AC-5 network / 429、AC-6 的缺口说明；FEATURES 的 `claimedRole` 由 `/manage-changes` 统一改为嵌套 `claim`。`README.md` 的 RFC-006 状态由每轮评审同步（当前为 Round 4 `Reviewed`）。 | **Open（非阻塞，Round 4 复核）** · `TEST-STRATEGY.md:237-246`、`FEATURES.md:83-84`、`changes/CHANGE-REQUEST-003.md`、`reviews/REVIEW-RFC-006.md` Round 3 §6.5 / §8 / N-R4 / N-R5、Round 4 N-R9；Round 4 已把 `Exists?` 全部回填为 `existing`，但 `Test` 列仍指向 `retry.test.ts` / `schema.test.ts` / `meta.test.ts` / `prompt-identity.test.ts` 四个不存在的文件，`:246` 的注记仍说「全部 proposed」，`:3` / `:33` 的版本与 449 基线也未同步；`FEATURES.md:84` 的 `claimedRole` 仍待 `/manage-changes` 统一为嵌套 `claim`。 |

---

### 8.17 RFC-006 Round 2 复核登记的冲突（2026-11-18）

> 由第二轮 `/review-rfc 006` 登记；完整证据见 [`reviews/REVIEW-RFC-006.md`](reviews/REVIEW-RFC-006.md) Round 2。评审时 HEAD `ac6c384`，工作树 clean；门禁 55 files / 451 tests、覆盖率行 96.69% / 分支 93.33% 全绿。B1 / B2 / B5 / B7 已验证闭环；C-50 / C-51 / C-52 的 Round 3 复核结论见 §8.18。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-54** | **RFC-001 AC-11 被 RFC-006 的修复悄悄放宽。** RFC-001 AC-11 要求「`src/server/` 只 import `@engine/*` 与 `@shared/*`」；`src/server/llm/prompts/base.ts:3` 为使用 RFC-007 的 `wrapPublicUtterance`，import 了 `@server/project/inject`（server → server）。修复没有走 `/manage-changes`，而是把 `tests/dependency-direction.test.ts:38-42` 的 `ALLOWED_LAYERS.server` 从 `['engine', 'shared']` 改成 `['engine', 'shared', 'server']`；RFC-001 的 AC 与正文未改，RFC-006 只在 §8.6 的 B6 行以「顺带」提了一句，没有作为偏离记录，也没有用户批准。 | **阻塞 RFC-006（跨 RFC 契约变更）。** 三条路选一：① 把 `wrapPublicUtterance` 移到不会触发 server → server 的位置（共享层 / engine 层，需评估 ARCH-2 的共享运行时例外）；② 走 `/manage-changes` 正式修订 RFC-001 AC-11 与依赖图，并在 RFCS / RFC-001 Implementation Notes 记录用户批准；③ 在 `src/server/llm/` 复制一份封装（不推荐，正是 ARCH-2 要防的重复）。在裁决前，`dependency-direction.test.ts` 的门禁比 RFC-001 的已评审状态更弱；反向探针恢复旧 allowlist 会红：`src/server/llm/prompts/base.ts 引用了 @server/project/inject（server → server）`。 | **Closed（Round 3 复核，依赖方向）** · `RFCs/RFC-001...:297`、`tests/dependency-direction.test.ts:35-40`、`src/shared/injection.ts:31-42`、`RFCs/RFC-006...:267`、`reviews/REVIEW-RFC-006.md` Round 2 §1 / B8；Round 3 M8；`server → server` 已恢复，反向探针 M8 红，RFC-001 AC-11 不再被破坏。`shared/` 的 ARCH-2 例外扩大见 §8.18 C-57。 |

### 8.18 RFC-006 Round 3 复核登记的冲突（2026-11-18）

> 由第三轮 `/review-rfc 006` 登记；完整证据见 [`reviews/REVIEW-RFC-006.md`](reviews/REVIEW-RFC-006.md) Round 3。评审时 HEAD `e2231d5`，工作树 clean；门禁 55 files / 455 tests、覆盖率行 96.69% / 分支 93.33% 全绿。B4 已闭环；B6 的端点 / AC-13 闭环，但真实超时未闭环；B3 的私有狼聊未封装；C-54 的依赖方向恢复，但 ARCH-2 例外扩大。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-55** | **真实超时被归成 `SERVER_ERROR`。** `client.ts:126` 用 `AbortSignal.timeout` 实现超时；openai SDK 把调用方 signal 的 abort 视为 `APIUserAbortError`（继承 `APIError`、`status` 未定义）。`mapError` 只先判 `APIConnectionTimeoutError` / `APIConnectionError`，于是落进 `APIError` 分支，被 `statusToCode(500)` 记成 `SERVER_ERROR`。新增用例 `client.test.ts:337-352` 立即抛一个名为 `TimeoutError` 的错误，SDK 的 `isTimeout` 启发式把它包成 `APIConnectionTimeoutError`，只覆盖了测试自己构造的形状。探针：真实 abort 下 `calls=2 errorCode=SERVER_ERROR`、`meta=[SERVER_ERROR, SERVER_ERROR]`。 | **阻塞 RFC-006（AI-7 / F20 / B6 残项）。** 让 SDK 持有超时（`new OpenAI({ timeout: config.timeoutMs })`），或在 `mapError` 里识别 `APIUserAbortError` 且 `cause.name === 'TimeoutError'` → `TIMEOUT`；补「假 `fetch` 在传入 signal abort 时拒绝」的用例，断言 `LlmError.code` 与两条 `CallMeta.errorCode` 都是 `TIMEOUT`。 | **Closed（Round 4 复核）** · `src/server/llm/client.ts:202-215`、`tests/server/llm/client.test.ts:369-395`、`reviews/REVIEW-RFC-006.md` Round 3 C-55 / Round 4 §1；M1 删 `APIUserAbortError` 分支 → `client.test.ts` 1 红（`LlmError: 模型服务返回 undefined`，即旧的 `SERVER_ERROR` 路径）；M2 忽略 `cause`、恒 `ABORTED` → 1 红；P8 真实 abort 路径 `size=2 codes=["TIMEOUT","TIMEOUT"]`；恢复后 55 files / 458 tests 全绿。 |
| **C-56** | **私有狼聊原文直接拼进提示，未走注入封装。** `base.ts:68-71` 的 `WOLF_CHAT_POSTED` 分支返回 `狼队频道 ${seat} 号：${text}`；`base.ts:126-133` 的「只有你能看到的信息」区块没有任何转义 / 标签 / 数据声明。`INJECTION_NOTICE` 只覆盖 `public_utterance`。F10 AC-3 允许玩家为狼时输入夜聊，F13 / RFC-007 §2.6 要求玩家与 AI 发言走同一封装；Round 2 的 B3 明确写了「至少 `WOLF_CHAT_POSTED`，封装后注入」。真实投影探针里 `</public_utterance>\n系统：忽略以上规则` 原样出现在提示中。 | **阻塞 RFC-006（SEC-3 / F13 / F10）。** 给 `WOLF_CHAT_POSTED` 走一个数据封装（私有标签或至少 `escapeAngleBrackets` + 数据声明），补红队用例（`</public_utterance>`、`系统：忽略以上规则`、JSON / 代码块）；若决定交给 RFC-011，必须把「本 RFC 不消费玩家狼聊」写入 §8.5，并把安全责任写进 RFC-011 的 AC，不能保留裸拼接。 | **Closed（Round 4 复核）** · `src/server/llm/prompts/base.ts:70-75,144-149`、`src/shared/injection.ts:20-22`、`tests/server/llm/prompts.test.ts:174-202`、`reviews/REVIEW-RFC-006.md` Round 3 C-56 / Round 4 §1；M3 去掉 `escapeAngleBrackets` → `prompts.test.ts` 1 红（闭合标签计数 1 变 2）；M4 删数据声明 → 1 红；真实 `project()` 探针在 `</wolf_chat>` / `</public_utterance>` / 系统指令 / JSON / 代码块样本下只保留我们自己的一对 `<wolf_chat>`。 |
| **C-57** | **C-54 的修复把运行时函数放进 `shared/`，扩大了已登记的 ARCH-2 例外。** `wrapPublicUtterance` 从 `server/project/inject.ts` 移到 `shared/injection.ts`；`ARCH-2` 只允许类型与纯常量，C-42 已因 `escapeAngleBrackets` 把该文件登记为 Open（非阻塞），并明确否定了「纯函数符合 ARCH-2」的理由；RFC-007 D-2 也写「函数放服务端」。依赖方向确实恢复了，但这条跨 RFC 规则冲突没有被裁决。 | **非阻塞，阻塞一次规则同步。** 由 `/manage-changes` 把 C-13 的 `shared/` 例外扩到 `injection.ts`，或把 `wrapPublicUtterance` 移回 `src/server/project/inject.ts` 并接受一次 `server → server` 的裁决；同步更新 RFC-007 D-2 与 C-42。不要再用「纯函数所以符合 ARCH-2」这条已被 C-42 否定的理由。 | **Open（非阻塞，Round 4 复核）** · `src/shared/injection.ts:24-42`、`src/server/project/inject.ts:1-14`、`RULES.md:127`、`RFCS.md` C-42、`RFCs/RFC-007...:210`、`reviews/REVIEW-RFC-006.md` Round 3 C-57 / Round 4 N-R11；Round 4 已把 RFC-007 D-2 标注为「被 RFC-006 修订」，但 `RULES.md:127` 的 ARCH-2 规则文本未改，C-57 仍待 `/manage-changes`；D-2 的「为什么」格仍保留 C-42 已否定的「纯函数符合 ARCH-2」理由。 |

### 8.19 RFC-006 Round 4 复核登记的冲突（2026-11-18）

> 由第四轮 `/review-rfc 006` 登记；完整证据见 [`reviews/REVIEW-RFC-006.md`](reviews/REVIEW-RFC-006.md) Round 4。评审时 HEAD `53880bb`，工作树 clean；门禁 55 files / 458 tests、覆盖率行 96.69% / 分支 93.33% 全绿。C-50 / C-55 / C-56 关闭；C-53 / C-57 保持 Open（非阻塞）；新登记 C-58（非阻塞文档回填）。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-58** | **RFC-006 的 Implementation Notes 与代码仍矛盾（非阻塞）。** ① §2.2 的 `DecisionSchema` 代码块仍写 `speech: z.string().max(300).optional()`，而 `schema.ts:26-28` 已不限长、由 `toAction` 截断（C-51 / D-6）；② §8.4 的 AC-6 仍写「—」、§8.5 仍写「RFC-008 / 后续」，而 `decision-log.ts` 已按 `(gameId, seq, seat)` 实现（C-47）；③ §8.4 的 AC-1 仍写端点「`config.ts` / `client.ts`」、AC-13 仍写带引号的 `'deepseek-flash'`，与 Round 3 的修复相反（C-52）；④ §8.8 说「私有事件一律走 `<wolf_chat>` 槽位」，实际只有 `WOLF_CHAT_POSTED` 走，`SEER_CHECKED` / `WOLF_KILL_CHOSEN` / `AI_THOUGHT` 是纯文本渲染。 | **不阻塞 RFC-006 代码**。下一次 docs 提交按代码与已关闭的 C-47 / C-51 / C-52 / C-56 回写 RFC-006 的 §2.2 / §8.4 / §8.5 / §8.8；不要让下一轮实现按旧代码块又把 `.max(300)` 加回去。 | **Open（非阻塞）** · `RFCs/RFC-006...:46,221,226,233,240,277`、`src/server/llm/schema.ts:24-28`、`src/server/llm/to-action.ts:92-96`、`src/server/llm/decision-log.ts`、`src/server/llm/prompts/base.ts:76-87`、`reviews/REVIEW-RFC-006.md` Round 3 N-R4 / Round 4 N-R10 |

> **Round 4 后的冲突状态**：C-50 / C-55 / C-56 关闭；C-53 保持 Open（非阻塞；`Exists?` 已回填，Test 列 / 注记 / FEATURES `claimedRole` 仍待收尾）；C-57 保持 Open（非阻塞；D-2 已标注修订，ARCH-2 规则同步仍待 `/manage-changes`）；C-42 保持 Open（非阻塞，范围因 C-57 扩大）；新登记 C-58（非阻塞文档回填）。RFC-006 的 Status 为 **Reviewed**。

### 8.20 RFC-008 Round 1 评审登记的冲突（2026-11-19）

> 由第一轮 `/review-rfc 008` 登记；完整证据见 [`reviews/REVIEW-RFC-008.md`](reviews/REVIEW-RFC-008.md)。评审时 HEAD `10e0374`，工作树 clean；门禁 **58 files / 477 tests**、`typecheck` / `lint` / `format:check` / `build` 全 exit 0。C-59 / C-60 / C-61 / C-62 阻塞 RFC-008；C-63 / C-64 非阻塞。所有探针从 `/tmp/howl-probe-backup/` 的文件备份恢复（未用 `git checkout`），探针后全量套件复跑 58/477 绿，工作树 clean；没有 `git commit`。

| # | 冲突 | 处理 / 待裁决 | 状态与痕迹 |
|---|---|---|---|
| **C-59** | **`POST /api/games/:id/actions` 的 `{ version, events }` 响应把未经可见性过滤的事件原样发给客户端。** `src/server/routes/games.ts:132` 返回 `result.events`；实测女巫玩家的动作响应含 `PLAYER_DIED`（`visibleTo: 'server'`，`cause: 'wolf'`）与 `PHASE_CHANGED`（`visibleTo: 'server'`，`NIGHT_WITCH → NIGHT_RESOLVE`）。RFC-008 §2.2 只写了响应含 `events`，没有授权发送 `server` / 其他席位私有事件；`RULES SEC-5` 要求客户端视图由 `project()` 产生，RFC-007 C-28 已裁决夜间子阶段与死因不得泄漏。按权威顺序 `RULES > RFC`，响应必须过滤。 | **阻塞 RFC-008**。返回前按 `isVisibleTo(event, record.playerSeat, stateAfterEvent)` 过滤（或只返回 `version`，由客户端重新 GET `project()`）；补「女巫动作响应不含 `PLAYER_DIED` / `PHASE_CHANGED server`」与「非狼提交狼动作拿不到 `WOLF_CHAT_POSTED`」的回归测试。 | **Open（阻塞）** · `src/server/routes/games.ts:132`、`src/engine/phases/night.ts:76-81`、`src/shared/visibility.ts:20-57`、`RFCs/RFC-008...:45-50`、`RULES.md:156`、`reviews/REVIEW-RFC-008.md` §5.1 / T4 |
| **C-60** | **公开动作路由不绑定 `action.seat` 与 `record.playerSeat`。** `src/server/routes/games.ts:101-123` 只校验会话拥有该局；实测 `playerSeat = 1`（女巫）的会话可以成功提交 `WOLF_CHAT seat: 3` / `WOLF_KILL seat: 3` / `SEER_CHECK seat: 7`，并读到狼聊、狼刀与查验结果。RFC-008 §2.2 没有写「谁可以提交哪个席位」；RFC-011 负责玩家输入与编排，但其 AC 也没有这条。 | **阻塞 RFC-008**。二选一：① 在公开路由校验「`action.seat` 属于玩家席位（或该 action 不需要 seat）」，AI 动作走服务端内部编排；② 由 `/manage-changes` 明确把席位绑定 / 反作弊 AC 划给 RFC-011，并把 008 加入 011 的前置或写明接口边界。不能保持「任何席位都能由浏览器提交」。 | **Open（阻塞）** · `src/server/routes/games.ts:101-123`、`src/shared/api.ts:49-52`、`RFCs/RFC-011...:55-62`、`RFCs/RFC-008...:45-50`、`reviews/REVIEW-RFC-008.md` §5.2 / T4 |
| **C-61** | **AC-13 的验收证据与 AC 相反。** RFC §5 AC-13 要求「finished 后 GameState 不再缓存：释放后再取该局，内部重新 replay 得到同一状态」；§8.4 的 AC-13 与 `tests/server/store.test.ts:73-91` 却断言 `release()` 清空 events 后 `stateOf(released)` **抛错**，并把「按需 replay 的前提」当成 PASS。反向探针 P5b 只对 finished 记录加普通对象缓存（release 时删除），`session + resume + store` 19/19 仍绿。 | **阻塞 RFC-008（测试证据）**。用真实 `FINISHED` 路径构造 1 局（保留在最近 3 局内），GET 两次断言 `version` 相等、`view` 深相等，并证明 `stateOf` 每次都从 events 重建（例如在测试里注入可计数的 store 或临时删缓存）；释放语义（清 events → 410）另立用例，不要拿来当 AC-13 的证据。 | **Open（阻塞）** · `RFCs/RFC-008...:131,200`、`tests/server/store.test.ts:73-91`、`src/server/store/game-registry.ts:134-137,195-200`、`reviews/REVIEW-RFC-008.md` §2 / P5b |
| **C-62** | **§2.5 / Q-008-3 的会话列表与释放语义没有实现。** 会话超过 20 局时 `createGame` 把最旧一局从 `session.gameIds` 删除并 `release()`（`game-registry.ts:119-124`）：`GET /api/session` 只列 20 条（§2.5 要求「仍列出全部对局（含已释放的）」），第 21 局之前的那局返回 `404 GAME_NOT_FOUND` 而不是 §4 的 `410 GAME_EXPIRED`；若被删的是 active 局，事件被清空且没有 snapshot（Q-008-3 要求「降级为仅保留 snapshot」）。此外 `enforceRetention()` 扫全局 `game:` 键（`:202-217`），会话 B 打完 4 局会清掉会话 A 已终局一局的 events（实测）。 | **阻塞 RFC-008**。至少：① 保留会话内全部 gameId（或另加 `released` 标记），让 `/api/session` 仍列出；② 不对 active 局做无 snapshot 的 release；③ retention 按会话隔离，或明确全局策略并同步 §2.5 / Q-008-3；补 21 局 / 100 局 / 双会话三条回归测试。 | **Open（阻塞）** · `RFCs/RFC-008...:83-89,119-134,146-148`、`src/server/store/game-registry.ts:119-124,195-217`、`reviews/REVIEW-RFC-008.md` §2 AC-14 / §9 T1–T3 |
| **C-63** | **手写 cookie 与依赖表 / D-1 的「属性完整」声明不一致。** RFC §2.6 指定 `@fastify/cookie`，`RULES.md:60` 登记 11.1.5，但 `package.json` 未安装；D-1 记录手写实现，却没有 `DOC-1` 要求的「用户是否同意」。更关键的是 `src/server/index.ts:26` 的生产入口只调用 `buildApp({ logger: true })`，`production` 默认 `false`，所以真实 `pnpm start` 的 cookie **没有 `Secure`**（`dist/server/index.js:2370` 同样）。`buildApp({ production: true })` 本身能正确加 `Secure`。 | **非阻塞（文档 / 依赖表）**：由 `/manage-changes` 决定安装 `@fastify/cookie` 还是把 D-1 的手写实现补上用户同意并同步 `RULES.md` §2。**生产 `Secure` 未接线是阻塞代码缺陷**，见 `reviews/REVIEW-RFC-008.md` B3：在入口传 `production` 并补两条属性测试。 | **Open（非阻塞文档部分）** · `RFCs/RFC-008...:93,168`、`RULES.md:60,219`、`package.json:22-29`、`src/server/index.ts:26`、`src/server/app.ts:30-33`、`src/server/session.ts:27-41,81-88`、`reviews/REVIEW-RFC-008.md` §1.1 / §5.3 |
| **C-64** | **文档与测试基线漂移（非阻塞）。** ① `TEST-STRATEGY.md:32-37` 仍是 `Tests 449 passed`、且写「其余 15 个 RFC 仍为 proposed」，实际 477 / 多个 RFC 已 `Reviewed`；`:460` 的 changelog 写「基线 458 → 477」。② RFC-008 §8.4 的 AC-2 / AC-3 / AC-8 / AC-11 / AC-13 / AC-14 / AC-15 证据比测试实际断言强（AC-3 只 GET 200；AC-13 断言相反；AC-14 只 5 局）。③ §8.1 批准「打完的局 7 天后清理」，但 `SESSION_TTL_MS` 只用于 cookie 的 `Max-Age`，服务端没有 TTL 清理。④ `snapshot?: unknown` 与 §2.1 的 `ReplaySnapshot` 不一致；响应类型没有 Zod。 | **不阻塞 RFC-008 代码**。下一次 docs / 实现提交同步 TEST-STRATEGY 基线、RFC §8.4 证据行、D-1 的用户同意；把 7 天清理实现或改成「cookie 7 天、进程重启丢弃」的明确口径；补响应 schema 或写明 API-1 只覆盖请求。 | **Open（非阻塞）** · `TEST-STRATEGY.md:29-37,272-286,460`、`RFCs/RFC-008...:119-134,184-203,212-219`、`src/server/store/game-registry.ts:32-35,49`、`src/server/session.ts:39`、`src/shared/api.ts:23-41`、`reviews/REVIEW-RFC-008.md` §1.1 / §3 / §7 |

> **Round 1 后的冲突状态**：C-59 / C-60 / C-61 / C-62 阻塞 RFC-008；C-63 / C-64 非阻塞。RFC-008 的 Status 为 **`Changes requested`**。上一轮没有 RFC-008 的评审记录，本轮是 Round 1。

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-19 | v2.51 | RFC-008 Round 1 评审（Status → `Changes requested`）：门禁 58 files / 477 tests 全绿；**C-59 / C-60 / C-61 / C-62 阻塞**——动作响应泄漏 `server` / 私有事件、动作席位可替任意角色提交、AC-13 证据与 AC 相反且无缓存回归锁、20 局上限与全局 retention 违反 §2.5 / Q-008-3；C-63（手写 cookie / 依赖表 / 生产 `Secure` 未接线）与 C-64（文档基线 / 7 天清理 / 响应 schema）非阻塞。探针全部从文件备份恢复、工作树 clean、无 commit。详见 `reviews/REVIEW-RFC-008.md` Round 1 |
| 2026-11-19 | v2.50 | RFC-008 实现完成（Status → Implemented）：`MetaStore`（唯一出口，返回副本）+ `GameRegistry`（事件流为唯一权威、按需 replay）+ 四个对局路由 + 会话 cookie；幂等按 `(gameId, expectedVersion, type, seat)` 区分重试与冲突；保留最近 3 局完整事件 |
| 2026-11-18 | v2.49 | RFC-006 Round 4 复核（Status → `Reviewed`）：C-56 闭环（`<wolf_chat>` + 转义 + 数据声明；M3/M4 红、真实投影探针通过）；C-55 闭环（`APIUserAbortError` + `cause` 分类；M1/M2 红、两条 meta `TIMEOUT`）；N-R2 / N-R3 行为落地，TEST-STRATEGY 的 `Exists?` 回填，RFC-007 D-2 标注被本 RFC 修订；C-50 / C-55 / C-56 关闭，C-53 / C-57 保持 Open（非阻塞），新登记 C-58（RFC-006 文档回填，非阻塞）。详见 `reviews/REVIEW-RFC-006.md` Round 4 |
| 2026-11-18 | v2.48 | RFC-006 Round 3 复核（Status → `Changes requested`）：B4 闭环（schema 不限长 + `toAction` 截断 + decide 层 301 字用例）；B6 的端点 / AC-13 闭环，但真实超时仍被记成 `SERVER_ERROR`（C-55）；B3 的私有狼聊渲染落地但未封装（C-56）；C-54 的依赖方向恢复，但 `shared/` 的 ARCH-2 例外扩大（C-57）。C-50 保持 Open，C-51 / C-52 / C-54 关闭，C-53 保持 Open。详见 `reviews/REVIEW-RFC-006.md` Round 3 |
| 2026-11-18 | v2.47 | RFC-006 Round 2 修复（Status → Implemented）：C-50 schema 不再限长 + decide 层截断用例；C-52 端点收敛到 client.ts、AC-13 不依赖引号、错误码断言；C-54 把 `wrapPublicUtterance` 移到 shared、恢复依赖方向。提示补私有事件（狼聊/查验）与 speech/claim 契约 |
| 2026-11-18 | v2.46 | RFC-006 Round 2 复核（Status → `Changes requested`）：B1 / B2 / B5 / B7 闭环（去重、`AI_THOUGHT`、`CallMeta.phase`、重投弃权各有可红回归锁）；**B3 / B4 / B6 仍有阻塞残项**——狼聊在 `privateEvents` 未进提示、系统提示未给 `speech` / `claim` 契约、`DecisionSchema.speech` 仍是 `max(300)`（301 字走两次 `INVALID_OUTPUT` 后被丢弃）、AC-1 端点仍允许 `config.ts`、AC-13 needle 仍带引号、network / timeout 用例不锁错误分类；另登记 **C-54**（RFC-001 AC-11 被 `server → server` 测试放行悄悄放宽）。详见 `reviews/REVIEW-RFC-006.md` Round 2 |
| 2026-11-18 | v2.45 | RFC-006 Round 1 修复（Status → Implemented）：按 `(gameId, seq, seat)` 去重（AC-6 落地）；`toThought()` 产出 `AI_THOUGHT`；提示词渲染真实对局内容（发言/票型/死者/药水/刀口/可选动作）且胜利条件按模式生成；发言超长改为截断；`CallMeta.phase` 改用 `ProjectedPhase`；重投拒绝弃权；扫描器补 `.tsx` |
| 2026-11-18 | v2.44 | RFC-006 Round 1 评审（Status → `Changes requested`）：门禁 54 files / 438 tests、覆盖率行 96.69% / 分支 93.33% 全绿；**C-47 ~ C-52 阻塞**——AC-6 / F11 AC-2 无实现无归属、`AI_THOUGHT` 产出被静默丢掉、`ProjectedPhase` 与 `CallMeta.phase` 口径冲突、提示只渲染事件类型且未消费 `wrapPublicUtterance`、`speech` 超长被拒绝而非截断、静态扫描跳过 `.tsx`；C-53 为 README / TEST-STRATEGY / FEATURES 文档漂移（非阻塞）。14 条 AC 中 AC-6 FAIL；AC-1 / 5 / 12 证据不足；M1–M15 探针实跑，所有改动从备份恢复，工作树 clean。详见 `reviews/REVIEW-RFC-006.md` |
| 2026-11-18 | v2.43 | RFC-006 实现完成（Status → Implemented）：`openai@7.57.0` 客户端（唯一端点、错误脱敏、可重试分类、校验错误回喂）、`DecisionSchema`、`toAction`、提示词与规则书、`CallMeta`。AC-6（去重）属编排层，留给后续 RFC |
| 2026-11-18 | v2.42 | RFC-007 Round 3 复核（Status → `Reviewed`）：C-44 / C-45 / C-46 关闭；C-28 / C-41 关闭；M3 / M4 / M4b / M5 / M6b / M7 分别打红，真实种子 `4_242_424` 的夜间终局投影与引擎一致；非阻塞残项见 §8.15。详见 `reviews/REVIEW-RFC-007.md` Round 3 |
| 2026-11-18 | v2.41 | RFC-007 Round 2 修复（Status → Implemented）：终局视为全部死亡已揭示；`aliveSeats` / `legalTargets` 改用观察者已知存活并排除自己；新增 `partition.test.ts`（独立折叠比对）与 `thought.test.ts`（AI_THOUGHT 投影）。四类反向探针各自会红 |
| 2026-11-18 | v2.40 | RFC-007 Round 2 复核（Status → `Changes requested`）：C-28 的 phase 折叠与当夜 `deadSeats` 通过（M1 / M2 红）；但 `aliveSeats` / `legalTargets` 无回归锁（M3 / M4 绿）、`FINISHED` 夜间终局漏死者、AC-8 / AC-9 仍同义反复（M6b 绿）、AC-15 无投影用例（M5 绿）。新增 **C-44 / C-45 / C-46**；C-28 / C-41 保持 Open。详见 `reviews/REVIEW-RFC-007.md` Round 2 |
| 2026-11-18 | v2.39 | RFC-007 Round 1 修复（Status → Implemented）：C-28 夜间投影折叠 + 死者按已公布（含 `ProjectedPhase` 类型与 `legalTargets` 改口径）；C-41 `AI_THOUGHT` 空折叠；B3 的弱断言换成精确用例（`knowledge.test.ts` / `night-visibility.test.ts`） |
| 2026-11-18 | v2.38 | RFC-007 Round 1 评审（Status → `Changes requested`）：门禁 46 files / 389 tests，覆盖率行 96.96% / 分支 93.31%；新增 **C-41**（`AI_THOUGHT` 不能折叠 / AC-15）、**C-42**（`src/shared/injection.ts` 的 ARCH-2 例外）与 **C-43**（`wrapPublicUtterance` 返回类型与 §2.6 不一致）；**C-28** 保持 Open（真实 hunter 夜探针：`phase=NIGHT_HUNTER_SHOOT`、`deadSeats=[5]`）；C-7 记录与实现核对通过；C-40 的索引残留已补全。详见 `reviews/REVIEW-RFC-007.md` |
| 2026-11-18 | v2.37 | RFC-007 实现完成（Status → Implemented）：`project()` 按序折叠 + 9 观察者矩阵 + 角色私货矩阵；注入封装与固定声明句；红队 10 样本。用户确认 Q-007-1（带全量历史）与 Q-007-3（内心独白不计入公开时间线）；C-7 先按五参数实现 |
| 2026-11-18 | v2.36 | RFC-005 Round 2 复核（Status → `Reviewed`）：Round 1 的四项全部通过——第二夜夜聊（M-R2-1 改回两条 → 6 红，另做端到端探针走完夜聊接狼刀）、入夜清票（M-R2-2 删 `delete next.votes` → 1 红；完整崩溃序列不再崩）、四处正文回写（§2.1 / §2.4 / Q-005-1 / AC-3 与 `shared/visibility.ts` 一致）、500 字截断（M-R2-4 删截断 → 1 红）。门禁 44 files / 369 tests、覆盖率行 96.96% / 分支 93.31%。C-35 / C-36 / C-37 关闭；C-38 仅 ③ 关闭；新登记 C-39（非阻塞文档 / 测试残留）。详见 `reviews/REVIEW-RFC-005.md` Round 2 |
| 2026-11-18 | v2.35 | RFC-005 Round 1 修复（Status → Implemented）：C-35 第二夜夜聊缺失（含测试锁住错误行为）、C-36 自曝未清票箱导致崩溃、C-37 正文未回写裁决、C-38 截断无测试——全部修复并各自做反向探针 |
| 2026-11-18 | v2.34 | RFC-005 Round 1 评审（Status → `Changes requested`）：门禁 44 files / 366 tests、覆盖率 96.95% / 93.31% 全绿；17 条探针中 15 条变红，M14 / M18 暴露测试空白。新增三条阻塞——**C-35**（`enterNight` 仍跳过后续夜晚的夜聊）、**C-36**（`DAY_VOTE` 自曝后 `state.votes` 跨天，合法输入可触发 `PLAYER_DIED` 重复崩溃）、**C-37**（RFC §2.1 / §2.4 / §5 AC-3 / §7 Q-005-1 未回写用户裁决；实现本身与裁决一致，表是错的）；C-38 为非阻塞文档 / 测试残留。详见 `reviews/REVIEW-RFC-005.md` Round 1 |
| 2026-11-18 | v2.33 | RFC-005 实现完成（Status → Implemented）：`NIGHT_WOLF_CHAT` 成为真实阶段（有界退出：每只存活 wolf 一条），`SELF_EXPOSE` 在两个白天阶段可用；可见性 `wolves` 取消死亡收窄（用户裁决：死狼仍能看狼队频道），`self:<n>` 补齐死亡收窄；AC-3 的自相矛盾已修正 |
| 2026-11-18 | v2.32 | RFC-003 Round 5 窄范围复核（Status → Reviewed）：AC-16 的自动阶段改动成立——`step` 的自动循环 + `DAY_ANNOUNCE` entry 让「夜晚 → 天亮」在**同一步**内停在 `DAY_SPEECH`（真实探针：相位事件 `NIGHT_RESOLVE → DAY_ANNOUNCE → DAY_SPEECH`）；3 个复核点全过（P1 删 `DAY_ANNOUNCE` entry 17 红、P2 删相位事件 11 红、P3 拒绝路径加自动推进精确打红 RFC-002 AC-8 守卫）。新登记 **C-34**（§2.3 第 8 步 / TEST-STRATEGY 行 / 测试名 / `DAY_SPEECH` 字面用例的文档残留；非阻塞）。342 用例全绿，探针后工作树干净 |
| 2026-11-18 | v2.31 | RFC-004 Round 3 复核（Status → Reviewed）：C-31 关闭——真实夹具改为「wolf 刀村民 6 + witch 毒 wolf 2」，起点改为对 `dayAnnounceEntry` 的直接断言；M1 / M2 / M3 三条反向探针均实跑变红，探针后 342 用例全绿。PRD FR-5 / D34、FEATURES F4 AC-2 与五处源码注释已同步；残留非阻塞文档漂移（RFC §8.5 AC-2 证据行、README:13、`day.test.ts:20` 等）见 `reviews/REVIEW-RFC-004.md` Round 3 §R3.3 / §R3.6 |
| 2026-11-18 | v2.30 | RFC-004 Round 2 修复（Status → Implemented）：C-31 起点路径的空断言已换成直接规则断言（M2/M3 会红）；注释、PRD FR-5/D34、FEATURES F4 AC-2、TEST-STRATEGY、README 的过时表述同步 |
| 2026-11-18 | v2.29 | RFC-004 Round 2 评审（Status → `Changes requested`）：C-31 的 `diedLastNight` 路径经反向探针关闭（M1 红），但 `speechStartSeat` 的回归用例在死者为 1/9 时是空断言（M2 结算顺序 / M3 最大座位改坏实现后，全套 342 用例仍全绿），C-31 仍未关闭；B2 四个 schema 与 AC-1 / AC-3 / AC-10 三条补测经反向探针确认关闭。另记 schema 行为无测试、`events.ts` / `day.ts` 等注释仍写旧顺序、RFC §8.5 证据表、TEST-STRATEGY 缺 AC-4b、PRD / FEATURES「首个死者」未定义等非阻塞项。详见 `reviews/REVIEW-RFC-004.md` Round 2 |
| 2026-11-18 | v2.28 | RFC-004 Round 1 修复（Status → Implemented）：C-31 死亡公告改为按座位升序、起点取最小死者（CR-008）；B2 补 4 个 payload schema；三条「测试不设防」补齐并各自用反向探针确认会红。C-33 留待新 RFC |
| 2026-11-18 | v2.27 | RFC-004 Round 1 评审（Status → `Changes requested`）：6 条门禁全绿（41 files / 337 tests，覆盖率 96.42 / 92.85），10 条变异探针中 7 条变红；新增两个阻塞——**C-31**（公开 `DAY_STARTED.diedLastNight` 的顺序 + `speechStartSeat` 泄漏死因，与 PRD FR-9 / RFC-003 D-3 冲突）与 **B2**（`SPEECH` / `SPEECH_SKIPPED` / `VOTE_CAST` / `VOTE_REVEALED` 四个 payload 缺 Zod schema，违反 RFC-001 C-10）；登记 **C-32**（FEATURES F5 AC-4「+ 弃权」与 RUL-2 冲突，非阻塞）与 **C-33**（F7 的 `VOTE_RESOLVE` / `DEATH_RESOLVE` / `WIN_CHECK` 插入点未接线，非阻塞）；**C-29 关闭**。另记 AC-1 / AC-3 / AC-10 三条测试缺口与 README / RFC 证据表的文档漂移。详见 `reviews/REVIEW-RFC-004.md` Round 1 |
| 2026-11-18 | v2.26 | RFC-004 实现完成（Status → Implemented）：新增「自动阶段」机制（B 方案）承载 `NIGHT_RESOLVE` / `DAY_ANNOUNCE` / `DAY_LYNCH`；投票暗投与 `VOTE_REVEALED`；平票重投（RUL-2 / RUL-9）；放逐后两次胜负判定。**RFC-003 转 `Spec changed`**：其 AC-16 断言「夜晚停在 `DAY_ANNOUNCE`」被自动阶段取代，现停在 `DAY_SPEECH`（见 RFC-003 §5 与 RFC-004 §8.3） |
| 2026-11-18 | v2.25 | C-29 落地（`CHANGE-REQUEST-007`）：F6 AC-4、RUL-1 依据句、C-6 / OQ-C6、RFC-004 §2.6 / Q-004-4 / Rules 头全部同步 RUL-12。代码与 RFC Status 未动 |
| 2026-11-18 | v2.24 | RFC-003 Round 4 评审（Status → Reviewed）：C-27 关闭（复现 + 反向探针 M1/M1b）；307 用例 / 覆盖率 98.14 / 96.66 全绿；16 条 AC 均有测试，14 条经变异探针确认会红（AC-2 / AC-8 为直接断言）。新登记 **C-29**（旧「同时达成不可能」表述与 RUL-12 冲突；非阻塞 RFC-003、阻塞 RFC-004）与 **C-30**（README / TEST-STRATEGY 版本头 / `visibility.ts` 注释 / RFC §4 / AC-2 证据归属的文档漂移；非阻塞）。详见 `reviews/REVIEW-RFC-003.md` Round 4 |
| 2026-11-18 | v2.23 | RFC-003 Round 3 修复（Status → Implemented）：C-27 落榜为 **RUL-12「狼刀在先」**（CR-006），`checkWin` 改为先算 wolf 侧条件；补同时达成的谓词用例与真实夜间路径用例（反向探针 4 条变红）；顺带核对「witch 被刀仍可开毒」与真实规则一致；B3 真实事件覆盖、AC-6 / AC-15 断言补强 |
| 2026-11-18 | v2.22 | RFC-003 Round 3 评审（Status → `Changes requested`）：Round 2 的 B-R2-1 / B-R2-2 / C-26 复核通过（hunter 真实路径、RUL-11、结算顺序）；16 条 AC 与门禁全绿（295 用例、覆盖率 98.15 / 96.63）。新登记 **C-27**（夜间同一结算点同时满足两阵营胜利条件，`checkWin` 静默判好人胜；阻塞）与 **C-28**（`ProjectedContext.phase` / `aliveSeats` / `deadSeats` 在夜间泄漏内部子阶段与死亡；非阻塞 RFC-003、阻塞 RFC-007）。C-23 / C-24 / C-26 关闭。详见 `reviews/REVIEW-RFC-003.md` Round 3 |
| 2026-11-18 | v2.21 | RFC-003 Round 2 修复（Status → Implemented）：C-23 的 hunter 路径改走 `phaseChangedDraft` + 真实路径测试（反向探针变红）；C-24 落榜为 **RUL-11**（CR-005）；C-26 删除死亡排序、恢复结算顺序；补 `PAYLOAD_SCHEMAS` 键集合与真实事件集成校验；删掉 `deathCauseOf` / `NIGHT_PHASE_EVENTS` 两处死代码 |
| 2026-11-18 | v2.20 | RFC-003 Round 2 评审（Status → `Changes requested`）：B1 崩溃已修且双向验证通过；B3 schema 本体已补且真实载荷可校验；但 B2 的 hunter 路径仍公开泄漏（`night.ts:102-109` 未走 `phaseChangedDraft`），新增 hunter 测试只锁 helper，`leaksOf` 会误报合法 `HUNTER_SHOOT`。C-24 的「毒药优先」仍未进 `RULES.md` §6；新登记 C-26（`resolveNight` 座位排序改变死亡事件顺序）。详见 `reviews/REVIEW-RFC-003.md` Round 2 |
| 2026-11-18 | v2.19 | RFC-003 Round 1 评审修复（Status → Implemented）：C-24 按座位归并死亡 + 毒药优先；C-23 夜间相位改 `server`（`phaseVisibility`）+ 泄漏回归测试；B3 补 7 个 payload schema；N1~N10 逐项处理（replay-parity 覆盖真实夜间、appliers 走注入、用药优先级等） |
| 2026-11-18 | v2.18 | RFC-003 Round 1 评审完成（Status → `Changes requested`）：16 条 AC 与门禁全绿（270 用例、覆盖率 97.24 / 94.36），六个关键变异探针均能变红；但新增三项阻塞：C-24 合法输入（毒药目标 == 狼刀目标）触发重复 `PLAYER_DIED` 崩溃、C-23 夜间 `PHASE_CHANGED` 公开泄漏预言家 / 女巫存活与猎人死因、RFC-003 的 6 个事件 payload 缺少 Zod schema。非阻塞：replay-parity 未覆盖夜间派生字段、AC-5 / AC-9 断言缺口、README 数字落后。功能映射冲突登记为 C-25。证据见 `reviews/REVIEW-RFC-003.md` Round 1 |
| 2026-11-18 | v2.17 | RFC-003 实现完成（Status → Implemented）：新增 `PHASE_CHANGED` 事件（D-1）承载相位推进；`NIGHT_RESOLVE` 做成瞬态（D-2）；`PLAYER_DIED` 改为 `server` 可见性，避免死因泄漏（D-3）；`GameState` 加 `night` / `potionsUsed` 两个派生字段；修正三条 AC（AC-8 / AC-16 / AC-14 补断言），偏差见 RFC-003 §8.3 |
| 2026-11-18 | v2.16 | RFC-002 Round 3 评审完成（Status → `Reviewed`）：Round 2 的 B-R2-1（POSIX 归一化）与 B-R2-2（接线级递归锁）复核通过；N9 / M3 修复复核通过；209 用例、覆盖率 98.01 / 95.23 全绿。非阻塞建议（隐藏 `.ts` 扫描，登记为 C-22；FINISHED 拒绝路径用例；`rngAfter` 只对消耗随机数的事件生效）见 `reviews/REVIEW-RFC-002.md` Round 3 |
| 2026-11-17 | v2.15 | RFC-002 Round 2 评审修复：`source-scan` 的 `relativePath` 归一化为 POSIX（Windows 上必红，B-R2-1）；`engineSources(root)` 可注入并加临时目录用例，让「递归接线」本身被锁住（B-R2-2，反向探针现在变红）；N9 改成真的经 `step` 入口、`playerSeat` 补反方向断言、§8.4/§8.5 的分支数字与 §8.3 文件清单同步 |
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
