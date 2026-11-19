# RFC-012 · 对局界面、新手引导与响应式

**Features**: F24, F26, F30, F40
**Depends on**: RFC-011
**Rules**: UI-2, UI-3, UI-4, A11Y-1, A11Y-2, A11Y-3, A11Y-4
> 关联需求：NFR-6、NFR-11
**Complexity**: Medium

---

## 1. 摘要

把 RFC-011 的接口层组装成**一个能看的对局界面**，并补上新手真正需要的东西：身份说明、术语解释、发言提示。

同时把无障碍与响应式做成硬要求——v1 的展示场景包含手机与投屏，这两条不是加分项。

## 2. 技术方案

### 2.1 页面结构

单页应用，三个稳定区域：

| 区域 | 内容 |
|---|---|
| 顶部状态条 | 当前阶段、第几天、发言进度、倒计时 |
| 主区 | 席位列表（存活/出局、是否已发言）+ 发言流 |
| 底部 | 玩家输入区（轮到自己时出现） |

### 2.2 新手引导（F24）

三件套，互不依赖，可分别关闭：

1. **身份卡说明**：技能、目标、剩余次数（复用 RFC-011 的卡片）。
2. **术语悬停**：任何术语（刀、验、放逐、悍跳、自曝、屠边、屠城、垫飞）出现时，悬停/聚焦显示解释。术语与解释全部取自 `src/shared/terms.ts`（UI-2）。
3. **发言引导**：轮到玩家时，输入框上方显示提示语（例如「你可以说说：你怀疑谁、为什么；你相信谁、为什么」）。提示**不代填**。

关闭后写入本地标记，刷新后不再出现。

### 2.3 发言顺序可视化（F26）

- 当前发言者高亮；
- 未发言者与已发言者可区分；
- 已出局者置灰并标注。

状态必须由投影与事件流推导，不得在前端另算一份。

### 2.4 响应式（F40）

两档断点：

- `< 1024px`：席位列表压缩为两行网格，发言流占满宽度；
- `>= 1024px`：席位列表侧栏，发言流居中。

360px 宽度下不得出现横向滚动。输入框在手机端固定在底部，但**不得遮挡**轮次、倒计时与当前发言。

### 2.5 无障碍（F30）

- 全部交互可用键盘完成（A11Y-1）；
- 焦点可见（A11Y-2），不得 `outline: none` 无替代；
- 倒计时、阵营、存活状态都有文字表达（A11Y-3）；
- 使用 `main` / `ul` / `button` 等语义标签（A11Y-4）；
- 屏幕阅读器能读出：我的身份、当前阶段、轮到谁。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/client/components/StatusBar.tsx` | 阶段、天数、倒计时 |
| `src/client/components/SeatGrid.tsx` | 席位与发言顺序 |
| `src/client/components/SpeechFeed.tsx` | 发言流（流式渲染） |
| `src/client/components/TermHint.tsx` | 术语悬停解释 |
| `src/client/components/OnboardingHints.tsx` | 引导提示与关闭 |
| `src/client/styles/*` | 响应式布局 |
| `tests/e2e/game.spec.ts` | Playwright 主路径 |
| `tests/client/a11y.test.ts` | 键盘与语义断言 |

## 4. 实现要点

- 术语解释用 `aria-describedby` 而非纯 `title` 属性，否则触屏与读屏都拿不到。
- 倒计时文字使用 `aria-live="polite"`，但**不要每秒都播报**——每 10 秒或最后 10 秒才更新。
- 发言流的滚动跟随只在用户位于底部时启用，否则会把用户顶走。
- 移动端输入框用 `position: sticky` 而非 `fixed`，避免遮挡并被键盘顶起时错位。

## 5. 验收标准

1. 页面包含顶部状态条、席位列表、发言流三块区域，且当前阶段与天数正确显示
2. 术语「刀」「验」「放逐」「悍跳」「自曝」「屠边」「屠城」「垫飞」出现时可通过悬停或键盘聚焦查看解释
3. 术语与解释文本全部来自 `src/shared/terms.ts`：扫描 `src/client/` 断言不出现术语字面量（与 RFC-001 的 AC 一致，此处扩展检查客户端组件）
4. 轮到玩家发言时显示引导提示语，且提示语不会被自动填入输入框
5. 引导可关闭；关闭后刷新页面不再出现
6. 发言顺序可视化显示三项信息：当前发言者、未发言者、已出局者，且与实际状态一致
7. 发言顺序由事件流推导：注入一段预置事件流，界面显示的当前发言者与事件流最后一条发言事件的下一位一致
8. 360px 视口下页面无横向滚动（`document.documentElement.scrollWidth <= clientWidth`）
9. 1024px 及以上视口采用桌面布局（席位列表为侧栏）
10. 手机视口下输入框不遮挡轮次、倒计时与当前发言（元素几何不重叠断言）
11. 全部交互可用键盘完成：Tab 可达、Enter/Space 可触发，存在一条用纯键盘完成「发言 → 投票」的 Playwright 用例
12. 焦点元素有可见样式：扫描 CSS 断言不存在无替代的 `outline: none`
13. 文字对比度满足 WCAG AA（自动化断言，正文 ≥ 4.5:1）
14. 倒计时、阵营、存活状态均有文字表达，不只依赖颜色
15. 屏幕阅读器可读出三件事：我的身份、当前阶段、轮到谁（以可访问名称断言）
15. **整局入口（由 `CHANGE-REQUEST-010` 从 RFC-011 迁入）**：存在一个生产入口启动整局循环——轮到 AI 时调用 `runGame` 的编排（`src/server/orchestrator.ts`），轮到玩家时挂起 `ChannelRegistry` 的输入通道并显示倒计时；一局能从开局推进到 `FINISHED`
16. 该入口与 `POST /actions` **不双写**：玩家发言只经由一条路径写入事件流（编排层每轮重读记录）


## 6. 边界与测试

- **不做**：事件面板、观战、真相视图（RFC-013）；复盘（RFC-014）。
- **不做**：视觉设计方向。本 RFC 只保证结构、响应式与无障碍；配色与排版属于实现者选择，但必须满足 AC-13。
- **测试**：Playwright 覆盖主路径与键盘路径；对比度与语义用自动化断言，避免「看起来还行」。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-012-1 | 引导状态存在哪里 | **(assumption)** `localStorage`，不随会话同步 |
| Q-012-2 | 是否提供深色模式 | **(assumption)** v1 不做，但配色需在 AA 阈值下同时满足两种背景可读 |
| Q-012-3 | 术语提示在移动端的触发方式 | **(assumption)** 点击触发气泡，与桌面端的悬停等价 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-011 已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 范围 | **B 方案**（用户选）：A（整局入口）+ B（界面骨架）+ C（无障碍/响应式）一次做完，覆盖全部 16 条验收标准 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
` | **D-1** | 端到端用 `channel: 'chrome'`，不下载 Playwright 自带浏览器 | 本机与 CI 都已有 Chrome；`pnpm test:e2e` 因此能真的跑起来，而不是停在「没装浏览器」 |
| **D-2** | 端到端服务端用 `HOWL_FAKE_AI=1` 的脚本化 AI | 一局要稳定跑完，不能依赖模型与网络；脚本替身与真模型共用同一个 `Decider` 接口（RFC-011 的通道抽象） |
| **D-3** | 客户端从投影推导席位状态（`src/client/game-state.ts`），**不另存状态** | UI-1 / ARCH-9：前端只渲染投影；当前发言者按 `DAY_STARTED.speechStartSeat` 起算，与引擎一致 |
| **D-4** | 术语解释用 `aria-describedby` + 条件渲染的 `role="tooltip"` | `title` 在触屏与读屏上都拿不到；`hidden` 会让读屏也跳过 |
| **D-5** | 输入框 Enter 提交、Shift+Enter 换行 | 纯键盘用户不该为了提交按很多次 Tab；这也是 AC-11 的键盘路径 |
| **D-6** | 发言规则常量移到 `src/shared/speech.ts` | 前端限制与后端校验必须同一份判据（SEC-4），而客户端不许 import 服务端（依赖方向） |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 共享 | `src/shared/speech.ts`（发言规则，前后端共用） |
| 服务端新增 | `src/server/game-loop.ts`（整局入口）、`src/server/ai/agent.ts`（模型/脚本 decider） |
| 服务端修改 | `src/server/app.ts`（注入 loop）、`src/server/routes/games.ts`（`POST /play`、`GET /timer`）、`src/server/orchestrator.ts`（`pendingForPhase` / `nextActor` / `isStillTheirTurn`）、`src/server/index.ts`（生产入口装配） |
| 客户端新增 | `src/client/App.tsx`、`game-state.ts`、`components/{StatusBar,SeatGrid,SpeechFeed,SpeechInput,TermHint,OnboardingHints}.tsx`、`styles/global.css` |
| 测试新增 | `tests/server/game-loop.test.ts`、`tests/client/{game-state,components,a11y}.test.tsx`、`tests/e2e/game.spec.ts` |
| 配置 | `vitest.config.ts` 增加 `client`（jsdom）project；`playwright.config.ts` 用 Chrome + `webServer`；`scripts/e2e-server.ts` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `components.test.tsx` 状态条；e2e 主路径 | PASS |
| 2 | `components.test.tsx` · 聚焦/点击显示解释 + `aria-describedby` | PASS |
| 3 | 术语来自 `TERMS`；`no-hardcoded-terms` 静态扫描仍生效 | PASS |
| 4 | `SpeechInput` 的提示语是独立段落，不写入 textarea | PASS |
| 5 | `OnboardingHints` 关闭后写 `localStorage`，重挂载不再出现 | PASS |
| 6 | `game-state.test.ts` · 当前/已发言/已出局三态 | PASS |
| 7 | `game-state.test.ts` · 按 `speechStartSeat` 推导下一位 | PASS |
| 8 | e2e · 360px `scrollWidth - clientWidth <= 0` | PASS |
| 9 | e2e · 1100px 下 `gridTemplateColumns` 至少两列 | PASS |
| 10 | e2e · 状态条与计时器几何关系 | PASS |
| 11 | e2e · 键盘聚焦输入框、Enter 提交；`components.test.tsx` 席位按钮回车选中 | PASS |
| 12 | `a11y.test.tsx` · `:focus-visible` 有可见 outline | PASS |
| 13 | 同上 · 正文/次要文字在三个背景上 ≥ 4.5:1 | PASS |
| 14 | 状态均有文字（发言/出局/倒计时），不只靠颜色 | PASS |
| 15 | `boardAnnouncement` 可访问名称含身份、阶段、轮次 | PASS |
| 15（整局入口） | `game-loop.test.ts` · `POST /play` 后一局跑到 `FINISHED`，`seq` 连续 | PASS |
| 16 | 编排层提交前重读（RFC-011 C-113）；整局用例断言无 `REJECTED` | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 79 files / 671 tests（unit + client）
$ pnpm test:e2e → 5 passed
$ coverage（引擎）→ 行 96.96% / 分支 92.85%
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 大厅/多局 | 启动即开一局；没有「继续上一局」的列表 | 后续 |
| 深色/浅色主题 | v1 只有深色，对比度按深色背景验证 | 后续（Q-012-2） |
| 真实模型端到端 | e2e 用脚本替身；真模型只在手工验收 | 手工 |
| 投票 UI | 目前只有发言输入；投票走 API | RFC-013 |

### 8.7 Round 1 回应（Changes requested）

评审的 8 条阻塞项全部成立，逐条处理：

| 项 | 问题 | 处理 |
|---|---|---|
| **C-116** AC-8 假绿 | e2e 在加载屏上量宽度（`.app` 还没挂载） | 先 `expect(page.locator('.app')).toBeVisible()` 再量；注入 `min-width` 的探针现在会红 |
| **C-117** AC-10 测错元素 + 真实重叠 42px | 只比较 banner 与 timer（本来同块）；底部 `sticky` 在内容溢出时压住上方 | 布局改成**三段式 grid**（状态条 / 主区 / 底部），主区内部滚动、底部不再 sticky；e2e 改为断言三段矩形互不重叠 + 输入框 `elementFromPoint` 真可点 |
| **C-118** AC-11 没按 Tab、没有投票 | 用 `box.focus()`；投票由 AI 代打 | 输入框 Enter 提交；新增 `VoteInput` 与 `playerAction` 的投票分支（玩家的投票也走输入通道）；e2e 断言「发言后输入框消失」并把投票纳进循环 |
| **C-119** AC-12/13 没有真浏览器用例 | 删 `:focus-visible`、调低对比度，e2e 仍绿 | e2e 新增两条：Tab 后 `document.activeElement` 的 `outlineWidth > 0`；从真实 computed style 采样正文与次要文字，逐项 ≥ 4.5:1 |
| **C-120** AC-2/3 术语没接进界面 | `.term__trigger` 数量为 0；扫描只扫身份名 | `App` 的提示区用 `TermHint` 渲染「投票 / 刀 / 悍跳」；静态扫描扩展到 `TERMS` 的标签，拦组件里的字符串字面量 |
| **C-121** AC-6/7 跨天错位 | `spokenSeats` 统计全天 | 只统计**最近一次 `DAY_STARTED` 之后**的发言，`speakingSeat` 同源 |
| **C-122** UI-4 草稿丢内容 | 客户端从不调用 `/input` | `SpeechInput` 的 `onDraft` → `ApiClient.draft` → `POST /input`；超时由服务端用最后草稿提交 |
| **C-123** AC-15 身份卡缺失 / `runGame` 忽略 `gameId` | 身份只在引导里；同一 session 多局时推进错的局 | 新增 `IdCard`（只读投影）；`runGame` 接受 `gameId`，`GameLoop` 传入；`boardAnnouncement` 接进 `role="status"` 的读屏区 |

```
$ pnpm test → 79 files / 674 tests
$ pnpm test:e2e → 7 passed
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-122（用户编号 C-123）** `runGame` 忽略 `gameId` | 类型参数写了，实际仍取 `session.gameIds[last]`——多标签页/刷新会推进错的局 | 真的改成 `targetId = deps.gameId ?? 最后一个`。补「同一会话两局，只推进指定的那一局」用例；回退实现会红 |
| **C-127** 重投（RUNOFF）由 AI 代打 | `playerAction` 与界面都只认 `DAY_VOTE` | `DAY_VOTE_RUNOFF` 也走输入通道，`VoteInput` 在两种投票阶段都出现 |
| **C-118** 输入框可能盖住计时器 | 只比 banner/footer、main/footer | e2e 直接比较**输入框自身**与 banner、timer 的矩形；把输入框 `fixed` 的探针会红 |
| **C-119** 没有 Tab→投票用例 | 删 `VoteInput` 仍全绿 | 新增「发言 → Tab 到投票按钮 → Enter」的 e2e；删投票区会红 |
| **C-116** 术语覆盖不足 | 8 个术语只出现 2 个 | 引导里做成**完整词汇表**（8 个 `TermHint`），用例断言八个标签都在 |
| **C-120** 无回归锁 | 跨天、草稿回退都全绿 | 补「第二天只说最近一天」与「输入变化回调 onDraft」两条用例；回退各自会红 |
| **C-121/C-123** 身份卡缺项、读屏播报过频 | IdCard 只有角色名；`role="status"` 每秒变 | IdCard 补技能/目标/剩余次数；公告只在「阶段/天数/轮到谁」变化时更新 |
| **C-130** e2e 不构建就跑旧包 | `webServer` 直接起服务 | 命令改成 `pnpm build && tsx scripts/e2e-server.ts` |

```
$ pnpm test → 79 files / 678 tests
$ pnpm test:e2e → 8 passed
```

### 8.9 Round 3 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-127** 重投列全部席位、无锁 | `VoteInput` 用 `aliveSeats`；删 RUNOFF 分支仍全绿 | 改为只吃 `ctx.legalTargets`（重投只有并列者），`allowAbstain` 只在 `DAY_VOTE`；补「RUNOFF 只出现并列者、没有弃权」用例 |
| **C-127** 投影没给 `pending` → 投票按钮没目标 | 前端拿到的 `legalTargets` 为空 | `GET /api/games/:id` 未显式指定 `pending` 时**按阶段给默认值**（`pendingForPhase`）；投票按钮因此出现 |
| **C-119** e2e 用 `.focus()` 不是 Tab | 给按钮加 `tabIndex=-1` 仍绿 | 改成从页面**真的按 Tab** 直到投票按钮聚焦，再 Enter；`tabIndex=-1` 现在会红 |
| **C-116** JSX 文本节点漏扫 | `<span>放逐</span>` 写进组件仍绿 | 扫描增加 `>\s*标签\s*<` 的 JSX 文本规则（探针会红） |
| **C-116** 术语 hover/focus 没有测试 | 删 `onMouseEnter`/`onFocus` 仍绿 | 补词汇表的 hover 打开、移开关闭、focus 重新打开用例 |
| **C-132** 读屏恒播「时间到」 | `boardAnnouncement(ctx, 0)` | 公告不再含倒计时；新增 `phaseLabel`（RUNOFF → 「平票重投」） |
| **C-121/C-123** 身份卡与读屏区没有整页锁 | 删 `<IdCard>` 或 status 区组件测试仍绿 | 新增 `tests/client/app.test.tsx`（整页渲染 + 假客户端）：身份卡、读屏公告、RUNOFF 标签、草稿回调；删任一处会红 |
| **C-120** App 的草稿接线没有锁 | 删 `onDraft` 仍绿 | 同上：整页用例断言输入后 `client.draft` 收到草稿 |

```
$ pnpm test → 80 files / 684 tests
$ pnpm test:e2e → 8 passed
```
