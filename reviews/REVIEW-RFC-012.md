# REVIEW · RFC-012 · Round 1

> 评审时间：2026-11-19 · 被评审提交：`8648a7d feat(rfc-012): 整局入口、对局界面与无障碍/响应式`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 结论：**Changes requested**

本轮按用户指定重点核对两件事，并把结果放在最前面：

1. **jsdom 组件测试与 Playwright 真浏览器两条路径，究竟哪些真的能打红、哪些是假绿。**
2. **AC-8 ~ AC-13 这些「只有真浏览器才能测」的条目，是否真的被验证过。**

简短回答：**两条路径都不是整体有牙。** jsdom 路径能对孤立组件的断点式回归打红（去掉
`aria-describedby`、去掉 `localStorage`、去掉焦点样式、把 `--muted` 改成低对比度都会红），
但它**从不渲染组装后的 `App`**，所以 TermHint 没接进界面、`boardAnnouncement` 没渲染、
发言提示被删掉这些集成缺陷全部是绿的。Playwright 路径里 AC-9 是唯一一条「真浏览器测试
确实能打红」的；AC-8 在加载屏上完成断言、AC-10 只比较状态条和计时器、AC-11 用
`box.focus()` 绕过 Tab 且没有投票、AC-12 / AC-13 根本没有 Playwright 用例。更严重的是
`pnpm test:e2e` 不会先构建，**改源码不重建也能绿**。AC-10 在真实页面里是实际失败：
390×700 下 footer（含输入区与新手提示）与状态条重叠 47.4px、把计时器整块 24px 盖住、
与当前发言席位重叠 42px；AC-11 的「发言 → 投票」在代码里没有投票入口，玩家的夜间动作
和投票由 AI 的 `decide` 代劳。

---

## 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `8648a7d` · 评审开始时工作树 clean。

```text
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm build
BUILD_EXIT=0

$ pnpm test
 Test Files  79 passed (79)
      Tests  671 passed (671)
   Duration  31.32s
FINAL_TEST_EXIT=0

$ pnpm exec vitest run --project unit --coverage
All files        |   96.46 |    92.85 |   97.38 |   96.96 |
COVERAGE_EXIT=0

$ pnpm test:e2e
Running 5 tests using 1 worker
  ✓  1 tests/e2e/game.spec.ts:12:3 › 整局界面 › 主路径：能开一局、看到状态条与席位、发言区可达 (398ms)
  ✓  2 tests/e2e/game.spec.ts:21:3 › 整局界面 › 360px 视口没有横向滚动 (271ms)
  ✓  3 tests/e2e/game.spec.ts:31:3 › 整局界面 › 1024px 视口采用桌面布局（席位在侧栏） (267ms)
  ✓  4 tests/e2e/game.spec.ts:45:3 › 整局界面 › 手机视口下输入区不遮挡状态条 (364ms)
  ✓  5 tests/e2e/game.spec.ts:60:3 › 整局界面 › 键盘：Tab 能到发言区，Enter 能提交 (347ms)
  5 passed (3.3s)
FINAL_E2E_EXIT=0
```

`pnpm test` 的 79 个文件包含 `tests/meta/*`（构建、五条命令、覆盖率门禁）；本轮最终重跑
为全绿。`pnpm test:e2e` 的 5/5 绿**不能**当作 AC-8 / AC-10 / AC-11 的证据，原因见 §2。

所有探针都从 `/tmp/howl-rfc012-probes/backup/` 的**文件备份**恢复，**未使用
`git checkout` / `git restore`**。探针后 `git diff --exit-code` 为空，工作树与 HEAD 一致；
没有 `git commit`。探针前六个文件的 SHA-256：

```text
748c0aac61f4f428d49e269cc7a95141174a9cb6437ed0cb5a04a4b172f3cff9  src/client/styles/global.css
c91fe39dd394b496045e423362559d7d9ea1311b7de1c4494f0948f6ace89731  src/client/components/SpeechInput.tsx
d3dabdfe6aa2b990ed6e5641b3bb1aa68773e2f9eef5dc092b054280f6039c74  src/client/components/TermHint.tsx
e163cc6b4fa3a1bea595305cd34a24f9715f5597ecae7a26d3e1c393a3e882db  src/client/components/OnboardingHints.tsx
35499acf8ff2cbbb43b5cde4004247d23478c74b4f177ea68c01a9b99cb6d36a  src/client/App.tsx
49601f826a543a2e9bad91ec3f198bef4fa564ea7c0abc2ad51d3f297e6c8017  src/client/game-state.ts
```

恢复后逐字相同；`src/client/components/StatusBar.tsx` 的探针也已按原样删除
（SHA-256 `1b1feb0e82013281424207b4ba7bb1467cedd4009daa3143dd3b622868920922`），
`git diff --exit-code` 为空。

---

## 1. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**。本轮按 game 的
「玩家是否真的在玩、状态机是否与投影一致」和 web app 的「语义、键盘、响应式、对比度、
真实浏览器」检查；不适用 mobile app / library / CLI / service 的检查，跳过。

---

## 2. 先回答用户点的两件事

### 2.1 jsdom 组件测试：能打红，但只对「孤立组件」

用定向变异跑了 `tests/client/{components,a11y}.test.tsx`：

| 探针 | 注入的改动 | 结果 | 说明 |
|---|---|---|---|
| **J1** | `TermHint` 把 `aria-describedby={open ? id : undefined}` 改成 `undefined` | **1 failed / 10 passed**（`components.test.tsx:91`，`expected null to be '_r_0_'`） | 孤立组件的 aria 断言有牙 |
| **J2** | `OnboardingHints` 删掉 `localStorage.setItem(ONBOARDING_KEY, '1')` | **1 failed / 10 passed**（`:108`，`expected null to be '1'`） | 关闭后持久化有牙 |
| **J4** | `global.css` 删掉整个 `:focus-visible` 块 | **1 failed / 6 passed**（`a11y.test.tsx:53`，`expect(match).not.toBeNull()`） | AC-12 的静态扫描有牙 |
| **J5** | `--muted: #b8c4ce` 改成 `#5b6670` | **1 failed / 6 passed**（`a11y.test.tsx:83`，`muted on bg: 3.16 < 4.5`） | AC-13 的静态扫描有牙 |
| **J6** | `SpeechInput` 删掉 `input__hint` 整段与 `aria-describedby="speech-hint"` | **18 passed**（components + a11y 全绿） | **这是关键反例**：AC-4 的发言提示没有任何 jsdom 测试；删掉它不会红 |

J6 不是偶然：`tests/client/components.test.tsx:95-113` 标着「AC-4 / AC-5 · 新手提示」，
但渲染的是 `OnboardingHints`，不是 `SpeechInput`；「提示语不代填」没有渲染 textarea，
自然也没有断言它的 `value` 为空。`src/client/components/SpeechInput.tsx:40-44` 的
`可以说说：…` 是 AC-4 的实现，但没有任何测试引用它（`grep` 只命中实现文件）。

更重要的是，**所有 client 测试都不渲染 `App`**。因此下面这些集成缺陷在 jsdom 路径里
完全不可见：

- `TermHint` 在 `src/client/` 里只有定义，没有任何 `<TermHint>` 使用点；`App` 的
  `SpeechFeed` 把 AI 发言当纯文本渲染，术语不可能悬停/聚焦。
- `boardAnnouncement` 只在 `src/client/game-state.ts:87` 定义，`App` 没有 import；
  测试直接调用这个纯函数，所以「函数有值」不等于「读屏能听到」。
- `App` 的 `remaining` 是本地 `setInterval` 倒计时（`App.tsx:22,45-48`），没有消费
  `GET /timer`；`grep -rn "/api/games/.*timer\|setDraft" src/client` 无命中。

### 2.2 Playwright 真浏览器：只有 AC-9 是真锁；AC-8 / AC-10 / AC-11 是假绿

| 探针 | 注入的改动 | 定向 e2e | 结果 | 证明 |
|---|---|---|---|---|
| **E1a** | `.app` 加 `min-width: 500px`，**不重建** `dist`，跑 360px 用例 | `-g "360px"` | **1 passed** | 源码改了但 e2e 跑的是旧 bundle；`pnpm test:e2e` 不会先 `pnpm build` |
| **E1b** | 同上，先 `pnpm build` 再跑 | 同上 | **1 passed** | 重建后仍绿；页面在断言时还是加载屏 |
| **E2** | `@media (min-width: 1024px)` 改成 `1200px`，重建后跑 1024px 用例 | `-g "1024px"` | **1 failed**（`expected 1 to be >= 2`，`game.spec.ts:42`） | AC-9 的真浏览器锁确实能红 |
| **E3** | `.app__footer { position: fixed; inset: 0; z-index: 999; }`，重建后跑「不遮挡」用例 | `-g "不遮挡"` | **1 passed** | 输入区整屏盖住页面，测试仍绿——它只比较状态条与计时器 |
| **E4** | `SpeechInput` 的 textarea 加 `tabIndex={-1}`，重建后跑键盘用例 | `-g "键盘"` | **1 passed** | 测试用 `box.focus()`，没有按 Tab；Tab 可达性没有被锁 |
| **E5** | 删掉 `:focus-visible`，重建后跑全部 5 条 | 全部 | **5 passed** | 没有真浏览器焦点测试（jsdom 的静态测试会红，但它不在 e2e 里） |
| **E6** | `--muted: #5b6670`（对比度 3.16:1），重建后跑全部 5 条 | 全部 | **5 passed** | 没有真浏览器对比度测试 |

E1 的根因不是「重建没生效」，而是**断言在加载屏上完成**。在 360px 视口、重建后的页面
上，用 Chrome 直接观察：

```text
t=0ms    root.text="正在准备对局…"   .app=null    scrollWidth=360  clientWidth=360
t=100ms  root.text="Howl 天数 第 1 天 …" .app=500px  scrollWidth=500  clientWidth=360
```

`game.spec.ts:21-29` 在 `page.goto()` 后立即 `page.evaluate`，正好落在第一行：`#root` 还
只有「正在准备对局…」，没有 `.app`，`scrollWidth <= clientWidth` 必然成立。也就是说：

- 即使布局真的横向溢出（探针注入的 500px 就是实证），这条 AC-8 也会绿；
- 如果 `App` 白屏 / API 失败 / 主路径完全坏掉，这条 AC-8 同样会绿。

AC-8 的实现本身在渲染后是成立的：360px 下 `scrollWidth=360`、`overflow=0`（见
§3 的实时测量）。但**测试没有验证它**。

### 2.3 AC-8 ~ AC-13 的真浏览器验证结论

| AC | 真浏览器证据 | 结论 |
|---|---|---|
| **AC-8** 360px 无横向滚动 | `game.spec.ts:21` 存在，但在加载屏上断言；E1b 在 500px 溢出下仍绿 | **未真实验证**（实现本身渲染后 pass） |
| **AC-9** ≥1024px 桌面布局 | `game.spec.ts:31`；E2 把断点改成 1200px → 1 failed | **真实验证** |
| **AC-10** 手机输入不遮挡轮次/倒计时/当前发言 | `game.spec.ts:45` 只比较 `banner` 与 `timer`，两者本来就在同一块；E3 全屏 footer 仍绿 | **未验证，且真实 UI 失败**（见 §3 / §4） |
| **AC-11** 纯键盘「发言 → 投票」 | `game.spec.ts:60` 用 `box.focus()`，未按 Tab；E4 `tabIndex=-1` 仍绿；代码里没有投票入口 | **未验证，且功能不成立** |
| **AC-12** 焦点可见 | 只有 jsdom 的 CSS 文本扫描（`a11y.test.tsx:40-56`）；E5 删掉焦点样式后 5/5 e2e 仍绿 | **实现 pass，真浏览器未验证** |
| **AC-13** 对比度 AA | 只有 jsdom 的 CSS 变量计算（`a11y.test.tsx:58-87`）；E6 低对比度后 5/5 e2e 仍绿 | **实现 pass，真浏览器未验证** |

另外，`TEST-STRATEGY.md:337-342` 计划的是六个独立文件：`terms.spec.ts`、`onboarding.spec.ts`、
`order.spec.ts`、`responsive.spec.ts`、`keyboard.spec.ts`、`a11y.spec.ts`。仓库里
`tests/e2e/` 只有 `game.spec.ts`，这六个文件**一个都不存在**。这不是「文件名不同」：
每个文件对应的一组 AC 也没有在 `game.spec.ts` 里得到等价覆盖（见 §6）。

---

## 3. 验收标准逐条

| AC | 判定 | 一手证据 / 说明 |
|---|---|---|
| 1 页面三块区域，阶段与天数正确 | **PASS（证据 PARTIAL）** | `App.tsx:93-109` 有 `StatusBar` / `main` / `footer`；`StatusBar` 显示 `第 N 天` 与 `轮流发言`。jsdom 的 `components.test.tsx:20-28` 用手喂 props 验证值；e2e `game.spec.ts:12-18` 只验证 heading 存在，**没有断言天数/阶段的值**。 |
| 2 术语可悬停/聚焦查看 | **FAIL** | `src/client/` 只有 `TermHint.tsx` 定义，`grep -rn "<TermHint" src` 无使用点。实时页面里 0 个 `.term__trigger`；在真实输入中提交含「刀 / 验 / 放逐」的发言后，`SpeechFeed` 显示纯文本，`.term__trigger=0`、`[role="tooltip"]=0`（§4 P-LIVE）。组件测试只渲染 `knife` + 点击，不覆盖悬停/聚焦，也不覆盖集成。 |
| 3 术语来自 `terms.ts`，扫描 `src/client/` | **FAIL** | 现有 `tests/security/no-hardcoded-terms.test.ts` 只扫 `ROLE_LABELS`（身份名），不扫 `TERMS` 的 8 个标签。把 `["刀","验","放逐","悍跳","自曝","屠边","屠城","垫飞"]` 全部加进 `StatusBar.tsx` 后，该测试仍 **2/2 passed**（§4 P-AC3）。仓库没有任何测试能证明 AC-3。 |
| 4 玩家轮次显示引导提示、不代填 | **PARTIAL** | `SpeechInput.tsx:40-44` 有 `input__hint`，且只在 `myTurn` 时渲染（`App.tsx:107`），实现层面成立。但 J6 删掉整段提示后 client 测试仍 **18/18 绿**；`components.test.tsx:95-113` 的「AC-4」实际测的是 `OnboardingHints`，没有 `SpeechInput`、没有 textarea 的值为空断言。 |
| 5 引导可关闭，刷新后不再出现 | **PASS（证据 PARTIAL）** | `OnboardingHints.tsx:31-41` 写 `localStorage`；J2 删掉写标记会红。测试是 unmount + remount，不是真正的页面刷新；`localStorage` 是同一机制，实际刷新大概率成立，但没有 e2e 覆盖。另：§2.2 要求三件套「互不依赖，可分别关闭」，实现只有一个「知道了，不再提示」按钮，三件一起消失；这是未记录在 §8.2 的偏离。 |
| 6 三项发言状态与实际一致 | **FAIL** | 单日路径成立；**跨天失败**。`spokenSeats`（`game-state.ts:27-32`）读取全部 `publicEvents`，不按最近 `DAY_STARTED` 过滤。用「第 1 天 1/2/3 都发过言 + 第 2 天刚开始」的投影调用：`speakingSeat=null`，`buildBoard` 显示 1、3 都是 `hasSpoken:true`（§4 P-MULTIDAY）。真实第 2 天会显示「没有当前发言者 + 所有存活席位已发言」。 |
| 7 当前发言者由事件流推导 | **FAIL** | 纯函数用例（`game-state.test.ts:55-80`）只覆盖一天；`speakingSeat` 同样被上一日的 `SPEECH` 污染，跨天返回 `null`。`App` 的 `myTurn`（`App.tsx:72`）直接依赖它，第 2 天玩家不会再被提示输入。没有渲染 `App` 的测试，「界面显示与事件流一致」没有被证明。 |
| 8 360px 无横向滚动 | **PARTIAL（实现 PASS / 测试 FAIL）** | 真实渲染后 360px：`scrollWidth=360`、`overflow=0`（§4 P-RESP）。但 `game.spec.ts:21` 在加载屏上断言；E1b 在 `.app{min-width:500px}` 下仍绿（§2.2）。 |
| 9 ≥1024px 桌面布局 | **PASS** | 真实渲染 1024px：`.app__main` 为 `280px 708px`；1100px 为 `280px 784px`。E2 把断点改成 1200px 后 1024px 用例 1 failed。测试只断言「至少两列」，没有断言第一列是席位侧栏；这是弱断言，但不是假绿。 |
| 10 手机输入不遮挡轮次/倒计时/当前发言 | **FAIL** | 390×700、输入可见（玩家 1 号是第一位发言者）时：`header=12–162`、`timer=126–150`、`.app__footer=114.6–700`、`.seat--speaking=261.8–303.8`；footer 与 header 重叠 **47.4px**、把 timer **24px 全部盖住**、与当前发言席位重叠 **42px**（§4 P-GEOMETRY）。根因是 `.app__footer` 的 `position: sticky; bottom: 0`（`global.css:203-211`）加上 footer 里同时放输入框和新手提示，footer 高 585px，sticky 把它顶到页面上方。e2e 只比较 `banner` 与 `timer`，不涉及 `.input` / `.app__footer`；E3 全屏 footer 仍绿。 |
| 11 全部交互键盘 + 纯键盘「发言 → 投票」 | **FAIL** | 发言 textarea 在真实 Tab 顺序里可达（2 次 Tab，outline 3px），但：① `game.spec.ts:68` 用 `box.focus()`，不是 Tab；E4 加 `tabIndex={-1}` 后仍绿。② **没有投票 UI，也没有玩家投票的输入路径**：`orchestrator.ts:181-184` 只对 `DAY_SPEECH` 调 `playerAction`；`DAY_VOTE` 与所有夜间阶段都走 `decide`。探针 seed 3、playerSeat 1（狼）记录到 `decide({seat:1, phase:'NIGHT_WOLF_CHAT'})`（§4 P-PLAYERACTION），即玩家的狼人夜聊/刀人由 AI 代打。RFC §8.6 把「投票 UI」推给 RFC-013，但 RFC-013 是事件面板/观战/真相视图，没有投票；PRD FR-6 要求玩家与 AI 同时投票。 |
| 12 焦点可见 | **PARTIAL（实现 PASS / 测试静态）** | 真实 Chrome 按 Tab：textarea/button 的 `outline: solid 3px rgb(124,196,255)`（§4 P-FOCUS）；`global.css:286-289` 的 `:focus-visible` 有效。AC 文字允许「扫描 CSS」，jsdom 的 J4 也有牙；但 TEST-STRATEGY 计划的 `a11y.spec.ts` 不存在，E5 删掉焦点样式后 5/5 e2e 仍绿。没有真浏览器的焦点回归锁。 |
| 13 对比度 WCAG AA | **PARTIAL（实现 PASS / 测试静态）** | 实测调色板：`text` 13.28–16.91、`muted` 8.19–10.42、`accent` 7.75–9.87、`danger` 7.26–9.24、disabled 5.77；正文/次要文字都 ≥4.5。J5 把 `--muted` 改低会红。但测试只算 `--text` / `--muted` 对三个背景，不测 `accent` / `danger` / disabled / 实际合成背景；没有真浏览器计算样式断言；E6 低对比度后 5/5 e2e 仍绿。 |
| 14 倒计时/阵营/存活有文字 | **PARTIAL** | 倒计时 `countdownText`、席位「正在发言/已发言/已出局」有文字；`a11y.test.tsx:89-106` 只测这些。**阵营没有任何文字表达**：`StatusBar` 没有阵营，`boardAnnouncement` 也不含阵营，`OnboardingHints` 只显示原始 role id（`wolf`）。E2E 在 `DAY_SPEECH` 之外还会显示原始阶段串 `NIGHT` / `DAY_VOTE`（`StatusBar.tsx:38-46`），也未本地化。 |
| 15 屏幕阅读器读出身份/阶段/轮到谁 | **FAIL** | `boardAnnouncement`（`game-state.ts:87-93`）只在测试里被调用，`App` 没有渲染它。真实 `ariaSnapshot` 里有 banner 的「轮次 1 号发言」和 timer，但身份只出现在 `complementary` 的 `你的身份是 wolf`；点「知道了，不再提示」后 `你的身份` 与 `wolf` 都从 DOM/可访问树消失（§4 P-LIVE）。没有一条可访问名称同时含「身份 + 阶段 + 轮到谁」。RFC §8.4 把「`boardAnnouncement` 可访问名称 … PASS」当作证据，这是纯函数自证，不是界面证据。 |
| 15（整局入口） | **PARTIAL / 有阻塞缺陷** | `GameLoop` + `POST /play` + `src/server/index.ts` 的装配存在；`tests/server/game-loop.test.ts:24-90` 能跑到 `FINISHED`。但：① `runGame` 不看传入的 `gameId`，直接取 `session.gameIds[last]`（`orchestrator.ts:146-147`）；探针创建 A、B 两局后请求推进 A，实际推进的是 B（`advancedGame=B`、A 仍 1 条事件、B 2 条，§4 P-MULTIGAME）。② 只对 `DAY_SPEECH` 接输入通道，玩家夜间动作与投票由 AI 代打（见 AC-11）。③ 测试的 seed `20261117` 玩家 1 号是预言家，脚本 AI 会替玩家完成查验；`game-loop.test.ts` 没有断言玩家夜间输入被使用，所以「完整局」是 AI 替玩家打的。 |
| 16 入口与 `POST /actions` 不双写 | **PASS（行为），但证据引用不实** | `tests/server/channels.test.ts:637-805` 是真实 `buildApp` + `POST /actions` + `runGame` 的端到端用例，断言最终无 `REJECTED` 且该席位只有一条 `SPEECH`；Round 10 已用 M-R10-1/2/3 验证有牙。RFC §8.4 写「整局用例断言无 `REJECTED`」，但 `tests/server/game-loop.test.ts` 并没有这个断言；引用应改为 `channels.test.ts`。这不是行为缺陷，是文档错误。 |

### 3.1 功能追溯（FEATURES 在 RFC 之上）

- **F24（Must）AC-1「身份卡有技能与目标说明」未实现。** `src/client/components/IdCard.tsx`
  不存在（RFC-011 D-5 把身份卡顺延给 RFC-012；C-99 仍 Open）。`OnboardingHints` 显示
  `你的身份是 wolf。先听一两轮，再决定信谁。`——原始 role id，没有技能、没有剩余次数，
  也没有狼队友/查验史/药水/开枪条件。F21（Must）的「只显示自己的身份与技能结果」同样
  没有界面落点。这违反 UI-2（身份名只能来自 `terms.ts`；`ROLE_LABELS` 在 `src/client`
  中零使用）。
- **F24 AC-5「文案不出现未定义术语」**：`NIGHT`、`DAY_VOTE`、`wolf` 都是未本地化的内部
  id，不是中文术语。
- **F30 AC-3「对比度」** 的实现值通过，但测试只覆盖两个颜色变量（见 AC-13）。
- **F40 AC-3「手机端输入框不遮挡轮次与倒计时」**：真实失败（见 AC-10）。
- **F26 AC-2「与实际状态机一致」**：跨天失败（见 AC-6/7）。
- **F21 / F22 AC-3（超时自动提交已输入内容）**：真实失败（见 §4 P-TIMEOUT）。

---

## 4. 变异与行为探针

除 §2 的 J1/J2/J4/J5/J6 与 E1–E6 外，本轮还做了以下真实浏览器 / 进程探针。

| 探针 | 方法 | 结果 | 证明 |
|---|---|---|---|
| **P-RESP** | Chrome（`channel:'chrome'`）打开 `/?seed=13`，等 `.seats` 渲染，360 / 390 / 1024 / 1100 四档测量 | 360：`scrollWidth=360`、`mainCols=336px`、`seatCols` 三列；1024：`mainCols=280px 708px`、`seatCols=256px` | AC-8 / AC-9 的**实现**在渲染后成立；但 360px 的席位是 **3 列 × 3 行**，不是 RFC §2.4 的「两行网格」 |
| **P-GEOMETRY** | 390×700、玩家 1 号轮次、输入框可见；`window.scrollTo(0,0)` 后测量 | `header 12–162`、`timer 126–150`、`footer 114.6–700`、`.input 114.6–378`、`.seat--speaking 261.8–303.8`；overlap header **47.4** / timer **24** / speaking **42**；等待期间页面被滚到 `scrollY=167` | AC-10 真实失败；footer 的 sticky + 新手提示高度是原因；`SpeechFeed` 的 `scrollIntoView` 还会把页面滚走 |
| **P-LIVE** | 在真实输入框输入「我觉得 2 号像狼，刀口在 3 号，验一下放逐。」并 Enter；读取 feed 与 aria snapshot；点关闭新手提示后再读 | feed 含「刀口」，`.term__trigger=0`、`[role="tooltip"]=0`；announcement 文本 `你是 …` 不存在；身份只在 `你的身份是 wolf`；关闭后 `你的身份`/`wolf` 都消失 | AC-2 / AC-15 失败；身份卡缺失 |
| **P-FOCUS** | 真实 Chrome 只用 Tab（从 body 起） | 第 1 个焦点是发言流 `<ol>`，第 2 个是 textarea；textarea / button 的 `outline: solid 3px rgb(124,196,255)` | 实现的 Tab 与焦点样式**成立**；但 e2e 不用 Tab，E4 证明测试无牙 |
| **P-MULTIDAY** | 用 `tsx` 直接调用 `speakingSeat` / `buildBoard`：第 1 天 1/2/3 都发言，随后 `DAY_STARTED`（第 2 天，`speechStartSeat=1`），`alive=[1,3]` | `speakingSeat=null`；`buildBoard` 的 1、3 都是 `hasSpoken:true`；`boardAnnouncement` 不含「轮到」 | AC-6 / AC-7 跨天失败；现有测试只覆盖一天 |
| **P-MULTIGAME** | 同一 session 创建 A、B 两局；`runGame` 传入 A 的 input，`maxSteps:1` | `requestedGame=A`、`lastSessionGame=B`、`advancedGame=B`；`aEvents=1`、`bEvents=2` | `/play` 可以推进错误的局；多局 session 下 `/play A` 启动的循环会推进 B |
| **P-PLAYERACTION** | seed 3、playerSeat 1（狼），`runGame` 注入记录 `decide` 的桩，`maxSteps:1` | `calls=[{seat:1, phase:'NIGHT_WOLF_CHAT'}]` | 玩家的夜间动作由 AI 的 `decide` 代打；AC-11 的「投票」也没有输入路径 |
| **P-TIMEOUT** | 真实 Chrome 在玩家轮输入 17 个字，等待 62 秒（服务端 `SPEECH_TIMEOUT_MS=60s`） | 输入框消失、timer 变「时间到」；事件流只有 `SPEECH_SKIPPED{seat:1}`；输入文本不在事件里（`TYPED_PRESENT_IN_EVENTS=false`） | **UI-4 / F22 AC-3 违反**：超时不提交已输入内容，静默丢弃；客户端从未调用 `/api/games/:id/input`（`grep src/client` 无命中），服务端草稿始终是空串 |
| **P-AC3** | 把 8 个术语标签加进 `StatusBar.tsx`，跑 `tests/security/no-hardcoded-terms.test.ts` | **2 passed** | 现有扫描只查身份名，AC-3 的「扫描 `src/client/` 术语字面量」不存在 |
| **P-FEED** | 真实页面等待一段 AI 发言完成 | feed 末尾同一条 9 号发言出现两次；`App.tsx:52-64` 把 committed `SPEECH` 与 `stream.phase==='done'` 的 live 行直接拼接，没有按 seq 去重 | 发言流重复行（非阻塞，但可见） |

### 4.1 其他直接观察

- `App` 每秒 `refresh()` 全量 `GET /api/games/:id`（`App.tsx:38`），同时开着 SSE；每个请求
  都重新 `project()` 折叠全部事件。对一局数百事件、9 席位来说不是正确性错误，但是不必要
  的轮询，且随局长度线性/平方增长。
- `remaining` 从挂载起固定减到 0（`App.tsx:22,45-48`），不随玩家轮次重置，也不读
  `GET /timer`。第一次玩家轮恰好接近 60 秒是对的；第二次玩家轮（或 AI 发言较慢时）会
  显示 0 / 时间到，而服务端仍在计时。这与 RFC-011 AC-13 的「倒计时以服务端为准」冲突。
- `SpeechFeed` 的 `scrollIntoView`（`SpeechFeed.tsx:20-31`）作用在 `<ol>` 之外的 end 元素上，
  会把整个页面滚下去；P-GEOMETRY 在输入出现后观察到 `scrollY=167`，状态条/计时器被滚出
  视口。这也属于 AC-10 的「倒计时必须可见」失败。
- `C-99`（身份卡顺延到 RFC-012 但没有承接）仍然 Open；本轮实现没有关闭它。

---

## 5. 五个维度

### 5.1 RFC ADHERENCE — **FAIL**

不重复 §3 的逐条表，概括：

- **实现与 AC 对齐的**：AC-1（结构）、AC-5（持久化）、AC-9、AC-12 的样式、AC-13 的调色板、
  AC-16 的单写者行为。
- **不成立的**：AC-2、AC-3、AC-6、AC-7、AC-10、AC-11、AC-14（阵营）、AC-15（读屏）。
- **部分成立**：AC-4（实现有、测试无）、AC-8（实现有、测试假绿）、AC-12/13（实现有、
  真浏览器无）、AC-15 整局入口（能到 FINISHED，但玩家只发言，夜间/投票 AI 代打；多局
  session 会推进错误的局）。
- **未记录偏离**：`OnboardingHints` 三件套合并且只有一个关闭按钮（RFC §2.2 要求三件
  互不依赖、可分别关闭）；移动端席位是 3 列 × 3 行而非「两行网格」；本地倒计时取代
  `/timer`；`runGame` 的 `gameId` 参数被忽略。

### 5.2 RULES COMPLIANCE — **FAIL**

- **UI-1**：通过。`App` 只消费 `project()` 的 `view`（`App.tsx:27,50`）；没有直接序列化完整状态。
- **UI-2**：**违反**。`OnboardingHints.tsx:26` 直接渲染 `role`（`wolf` / `seer` 等原始 id）；
  `src/client` 对 `ROLE_LABELS` 零引用；术语也没有从 `TERMS` 渲染到界面。
- **UI-3**：基本通过。`use-stream` 逐字累加，`SpeechFeed` 渲染 `stream.text`；但 committed
  与 live 的重复行是 UI-1 数据拼接问题，不是流式本身。
- **UI-4**：**违反**。P-TIMEOUT 实测超时丢弃输入并产出 `SPEECH_SKIPPED`；客户端从不
  调用 `/api/games/:id/input`，服务端 `HttpInputChannel` 的 `draft` 永远收不到。
- **A11Y-1**：部分。发言输入键盘可达（真实 Tab 2 次到 textarea），但 AC-11 要求的
  「发言 → 投票」没有投票侧；席位按钮在 `App` 里因 `onSelect` 未传而全部 `disabled`。
- **A11Y-2**：通过。`:focus-visible` 3px outline 在 Chrome 生效；`outline: none` 不存在。
- **A11Y-3**：部分。倒计时与存活有文字；阵营没有文字表达；`NIGHT` / `DAY_VOTE` 未本地化。
- **A11Y-4**：基本通过。`main` / `ul` / `ol` / `button` 语义存在；但 `SeatGrid` 的
  `aria-pressed={seat.speaking}` 把「状态」说成「按下」，且按钮全部 disabled，语义不准确。
- **SEC-4**：通过（服务端 300 字校验）。但客户端没有草稿同步，导致 UI-4 的另一半失效。
- **SEC-5 / ARCH-9**：通过（投影渲染、客户端不推进状态机）；`remaining` 是显示层本地
  计时，不是权威对局状态，但它没有从服务端投影/计时器派生，仍是第二个时间来源。
- **TEST-1 / TEST-6**：**不通过**。TEST-STRATEGY 计划的六个 e2e 文件缺失；AC-8/10/11
  是假绿；jsdom 不渲染 `App`；`pnpm test:e2e` 不构建。
- **DOC-1**：**不通过**。RFC §8.2 的表格首行是 `| # | 决定 | 为什么 |` 后接一个以
  `` ` `` 开头的残行；§8.4 有两条编号 15 和一条 16；§8.4 的多条 PASS 与实测不符
  （AC-2/3/4/6/7/10/11/15）。`TEST-STRATEGY.md:337-342` 仍全部 `proposed`；README 仍写
  「7 Reviewed / 0 Changes requested / 8 Not started」，与实际状态不一致。

### 5.3 SECURITY — **PASS（有非阻塞建议）**

- 客户端只拿 `project()` 的输出；`GET /api/games/:id` 的观察者是 `record.playerSeat`，
  没有把完整 `GameState` 或 `server` 事件发给浏览器。
- `POST /actions` 校验席位（403）与发言长度（400）；`/input` 也校验 300 字（RFC-011 已修）。
- React 文本插值，无 `dangerouslySetInnerHTML`；`localStorage` 只存 onboarding 标记。
- 非阻塞：`POST /play` 没有频率限制，任何会话可以反复创建/启动多局；`console.error` 在
  失败时打印错误对象（未见密钥，但错误文本是否脱敏应继续由 SEC-7 约束）。
- 非阻塞：`main.tsx` 的 `boot()` 失败没有错误分支，页面会停在「正在准备对局…」；
  这不是泄漏，但会让用户无法判断是网络还是服务端问题。

### 5.4 PERFORMANCE — **NEEDS WORK**

- 每秒全量 `GET /api/games/:id` + `project()` 重放全部事件（`App.tsx:38`），与 SSE 并存；
  长局下是无意义的重复计算。建议状态变化走 SSE，投影只在初始/重连时拉。
- `GET /api/games/:id/timer` 已存在（`routes/games.ts:148`）但客户端不用，反而本地
  `setInterval` 递减；既浪费了服务端权威，也产生漂移。
- `SpeechFeed` 每次行数变化都 `scrollIntoView`，会把页面滚走并触发布局；建议只改
  `container.scrollTop`，且只在用户位于底部时。
- `runGame` 的 `maxSteps=500` 没有让出事件循环（每步都有 await，问题不大）；`decide`
  每次新建 OpenAI client 属于生产侧（RFC-012 之外），不计入本轮。

### 5.5 MAINTAINABILITY — **NEEDS WORK**

- **死代码**：`TermHint` 与 `boardAnnouncement` 只被测试引用，没有任何生产调用者；这是
  AC-2/AC-15 失败的根因，也是「测试绿但功能不在」的教科书案例。
- **没有 `App` 集成测试**：`tests/client/` 全部是组件/纯函数级。缺少一个用假 `ApiClient`
  渲染 `App` 的测试，导致 TermHint、announcement、发言提示、跨天推导这些集成缺陷
  都不可见。
- **重复的 live 行**：`App.tsx:52-64` 把 committed 与 live 直接拼接；应在 committed
  中出现同 seq 时去掉 live。
- **本地计时**：`remaining` 与 `view` 无关联；建议改成服务端 timer 的派生值或删除。
- **阶段/角色文案**：`StatusBar` 对非 `DAY_SPEECH` 直接渲染枚举；`OnboardingHints` 渲染
  原始 role id；应统一走 `terms.ts` / 中文映射。
- **文档与测试计划**：RFC §8.4 的 PASS 表需要按实际证据重写；TEST-STRATEGY 的
  `Exists?` 与 e2e 文件名单需要回填；README 状态需要更新；M-3（VoiceOver 实听）与
  M-6（移动端真机）没有记录在 `## Implementation Notes`，按 TEST-STRATEGY 的要求等于
  没做。

---

## 6. 测试计划与证据链

`TEST-STRATEGY.md:332-345` 的计划 vs 仓库实际：

| 计划 | 实际 | 判定 |
|---|---|---|
| `tests/e2e/terms.spec.ts`（悬停 + 键盘聚焦 + 扫描 `src/client` 无术语字面量） | 不存在；只有 `components.test.tsx:77-93` 的 `knife` + 点击 | **缺失** |
| `tests/e2e/onboarding.spec.ts`（不代填 + 关闭后刷新） | 不存在；`components.test.tsx:95-113` 是 `OnboardingHints` 的 unmount/remount，不是输入框，也不是刷新 | **缺失 / 错位** |
| `tests/e2e/order.spec.ts`（三项状态 + 预置事件流） | 不存在；`game-state.test.ts` 只测一天 | **缺失** |
| `tests/e2e/responsive.spec.ts`（360 无横滚 / 1024 侧栏 / 几何不重叠） | 只有 `game.spec.ts` 的三条，且 360 在加载屏、几何只比 banner/timer | **假绿** |
| `tests/e2e/keyboard.spec.ts`（纯键盘「发言 → 投票」） | 只有 `game.spec.ts:60`，`.focus()` + Enter，无 Tab、无投票 | **假绿 / 功能未实现** |
| `tests/e2e/a11y.spec.ts`（outline / 对比度 / 文字表达） | 不存在；只有 `tests/client/a11y.test.tsx` 的 CSS 文本扫描 | **缺失** |
| `tests/client/id-card.test.tsx`（RFC-011 顺延） | 不存在；没有 `IdCard.tsx` | **缺失（C-99）** |
| `## Implementation Notes` 的手工检查（VoiceOver、真机） | §8.6 只有「已知缺口」，没有 M-3 / M-6 结果 | **未记录** |

`pnpm test:e2e` 的流程问题也属于证据链：

- `scripts/test-e2e.mjs` 只转交 Playwright，不执行 `pnpm build`；`scripts/e2e-server.ts`
  只在 `dist/client` 存在时托管静态资源。干净检出后直接跑 `pnpm test:e2e` 会 404；
  改了源码不重建则跑旧 bundle（E1a 实证）。
- `playwright.config.ts` 的 `webServer.command` 用 `tsx` 跑一个**独立装配**的
  `scripts/e2e-server.ts`，不是 `src/server/index.ts`。因此「生产入口启动整局循环」
  这个 AC 没有被 e2e 真正覆盖；`tests/meta/commands.test.ts` 只对生产入口做健康检查。
- `reuseExistingServer: !process.env.CI` 在本地会复用 4180 上的旧进程；如果上一次 e2e
  的 webServer 没有退出（或手工起过），测试可能打到旧代码。本轮用 `E2E_PORT=4181` 规避，
  但配置本身没有防止这一点。

---

## 7. 结论

**Overall Risk Level: High。**

这不是「实现基本完成、补几个测试」的状态：多条 Must 级验收标准在真实界面里不成立
（AC-2/3/6/7/10/11/14/15），其中 AC-10 是移动端实际遮挡计时器与当前发言，AC-11 是
「发言 → 投票」根本不存在，UI-4 是超时静默丢弃玩家输入。两条测试路径的绿灯很大程度上
来自「测试没有打到真实界面」：jsdom 不渲染 `App`，Playwright 的 AC-8 在加载屏上断言、
AC-10 比较错了元素、AC-11 用程序聚焦绕过 Tab；AC-12/13 只有 CSS 文本扫描。唯一在
真浏览器里能打红的 AC-9 说明 Playwright 本身可用，问题不在工具，在用例设计。

**Blocking Issues（必须修复后才能合并）**

1. **B-1 · AC-2 / AC-3 / UI-2**：把 `TermHint` 接进发言流（或明确的术语出现位置），
   覆盖全部 8 个术语的悬停 + 键盘聚焦；新增扫描 `src/client/` 术语字面量的测试。
   当前实时页面 0 个 trigger、0 个 tooltip，提交含术语的发言后仍是纯文本。
2. **B-2 · AC-10 / F40 AC-3**：修复移动端 footer 遮挡。把新手提示移出 sticky footer
   或让 footer 只 sticky 输入框；同时修 `SpeechFeed.scrollIntoView` 导致页面滚走。
   补真实几何断言：`input` / `footer` 与 `banner`、`timer`、`.seat--speaking` 都不重叠。
   当前 390×700 下重叠 47.4 / 24 / 42px；E3 全屏 footer 仍绿。
3. **B-3 · AC-11 / PRD FR-6**：补玩家投票（以及夜间目标选择，若本 RFC 承接）的输入
   路径与 UI；至少让 `runGame` 在 `DAY_VOTE` 对玩家席位走 `InputChannel`。补一条真正
   「Tab → 输入 → Enter → 投票」的 Playwright 用例；当前 E4 证明 `tabIndex=-1` 也能绿，
   且 `playerAction` 只覆盖 `DAY_SPEECH`。
4. **B-4 · UI-4 / F22 AC-3**：客户端把 textarea 内容同步到新的 `/input` 端点（防抖），
   或让客户端在倒计时归零时主动 `POST /actions` 提交当前文本；补 60 秒真实/虚拟时钟
   用例。当前 P-TIMEOUT 实测输入文本被丢弃并记成 `SPEECH_SKIPPED`。
5. **B-5 · AC-15（读屏）/ F21 / F24**：把身份卡/公告真正渲染出来（`boardAnnouncement`
   或等价 live region），用 `ROLE_LABELS` 中文化身份，显示技能/目标/剩余次数；关闭新手
   提示后身份仍要可读。当前 `boardAnnouncement` 是死代码，身份在关闭后消失。
6. **B-6 · AC-6 / AC-7**：`spokenSeats` 只统计最近一次 `DAY_STARTED` 之后的发言；
   补跨天纯函数用例与一条渲染 `App` 的用例，断言第 2 天的当前发言者/已发言/已出局。
   当前第 2 天 `speakingSeat=null`、所有存活席位「已发言」。
7. **B-7 · AC-15 整局入口**：`runGame` 必须推进传入的 `gameId`（例如把 `gameId` 放进
   `OrchestratorDeps`），不能取 `session.gameIds[last]`；补 A/B 两局同 session 的用例。
   当前 `/play A` 会推进 B，多局 session 下会等错通道。
8. **B-8 · TEST-1 / TEST-6 证据链**：`pnpm test:e2e` 先构建（或把 `dist` 缺失作为明确
   失败）；AC-8 在断言前等待 `席位` heading 渲染；AC-10 改为真实的 footer/input 几何；
   AC-11 用 Tab 并包含投票；补 `terms/onboarding/order/responsive/keyboard/a11y`
   六个 spec 或明确记录合并后的等价覆盖。当前六个计划文件全部不存在。

**Improvement Suggestions（非阻塞）**

1. 去重 `App.tsx:52-64` 的 live 行与 committed `SPEECH`（按 seq），P-FEED 可见重复。
2. `SpeechFeed` 只改 `container.scrollTop`，不要 `scrollIntoView` 整个页面。
3. `remaining` 改为服务端 `/timer` 的派生值（或删掉本地倒计时），按玩家轮次重置。
4. `StatusBar` 的 `NIGHT` / `DAY_VOTE` 本地化；`OnboardingHints` 用 `ROLE_LABELS`，
   显示技能、剩余次数；三件套提供独立关闭。
5. `SeatGrid` 的席位改用非交互列表 + 明确状态文本，避免「disabled button + aria-pressed」
   把状态说成开关。
6. 移动端席位从 3 列改为 RFC 的「两行」网格；360px 下 9 席 3 行不是规格。
7. `runGame` 的 mode / persona / seq：生产入口把 `CreateGameBody.mode` 传给 decider；
   `seq: () => 0` 和未注入 `DecisionLog` 会让 AI 决策元数据与去重失去意义。
8. `App` 的 1 秒全量轮询改为 SSE 驱动 + 初始拉取；`GET /timer` 只在需要时拉。
9. RFC §8.2 的残行、§8.4 的两条 AC-15 / 一条 AC-16、以及不实的 PASS 逐条修正；
   TEST-STRATEGY 的 `Exists?` 回填；README 状态行同步。
10. 记录 M-3（VoiceOver 实听）与 M-6（移动端真机）的结果；当前 Implementation Notes 没有。

**状态**：RFC-012 → **`Changes requested`**。

本轮没有 `git commit`。所有探针源码已从 `/tmp/howl-rfc012-probes/backup/` 的文件备份恢复
（**未用 `git checkout` / `git restore`**），六个文件 SHA-256 与探针前一致；
`src/client/components/StatusBar.tsx` 的临时探针已删除；`git diff --exit-code` 为空；
临时探针脚本已删除；最终 `pnpm test` 79 files / 671 tests、`pnpm test:e2e` 5/5 绿。

**Non-blocking**：AC-1 的 e2e 只验 heading、不验天数/阶段值；AC-5 用 remount 代替刷新；
AC-12/13 只有 CSS 文本扫描；`pnpm test:e2e` 不构建；`runGame` 的 mode/seq；本地倒计时；
重复 feed 行；页面自动滚走；`README` / `TEST-STRATEGY` / RFC §8.2/§8.4 文档漂移；
M-3 / M-6 手工检查未记录。
