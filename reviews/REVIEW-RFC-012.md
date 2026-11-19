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

---

## Round 2 -- 2026-11-19

> 评审方式：全新上下文 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 被评审提交：`3c26a27 fix(rfc-012): 真浏览器几何/焦点/对比度、投票与术语接线（Round 1）`。
> 评审开始时 HEAD `3c26a27`，工作树 clean。结论：**Changes requested**。
>
> 用户本轮点名的 C-116 ~ C-123 与 `RFCS.md` §8.41 的 C-116 ~ C-123 **编号不同**。本文按内容
> 复核，编号对应如下，避免下一轮看错行：
>
> | 用户消息 | 实际内容 | `RFCS.md` §8.41 |
> |---|---|---|
> | C-116 | e2e 等 `.app` 挂载后再量宽度 | C-123 第 ① 项 |
> | C-117 | 三段式 grid / 不重叠 / `elementFromPoint` | C-118 |
> | C-118 | `VoteInput` + `playerAction` 投票分支 + Enter | C-119 |
> | C-119 | e2e 焦点与对比度 | C-123 第 ②③ 项 |
> | C-120 | `TermHint` 接入 + `TERMS` 静态扫描 | C-116 |
> | C-121 | `spokenSeats` 只算最近 `DAY_STARTED` | C-117 |
> | C-122 | `onDraft` → `POST /input` | C-120 |
> | C-123 | `IdCard` / `boardAnnouncement` / `runGame(gameId)` | C-121 + C-122 |

---

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `3c26a27` · 评审开始时工作树 clean。

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
      Tests  674 passed (674)
    Duration  32.97s
TEST_EXIT=0

$ pnpm test:e2e
Running 7 tests using 1 worker
  ✓ 1 tests/e2e/game.spec.ts:12:3 › 主路径：能开一局、看到状态条与席位、发言区可达 (642ms)
  ✓ 2 tests/e2e/game.spec.ts:22:3 › 360px 视口没有横向滚动 (718ms)
  ✓ 3 tests/e2e/game.spec.ts:35:3 › 1024px 视口用桌面布局（席位在侧栏） (665ms)
  ✓ 4 tests/e2e/game.spec.ts:49:3 › 手机视口下输入区不遮挡状态条 (288ms)
  ✓ 5 tests/e2e/game.spec.ts:96:3 › 焦点可见：Tab 之后焦点元素有可见 outline (244ms)
  ✓ 6 tests/e2e/game.spec.ts:114:3 › 对比度：正文与次要文字达到 AA (297ms)
  ✓ 7 tests/e2e/game.spec.ts:155:3 › 键盘：Tab 能到发言区，Enter 能提交 (307ms)
  7 passed (4.8s)
E2E_EXIT=0
```

探针从 `/tmp/howl-rfc012-r2-probes/backup/` 的**文件备份**恢复（**未使用
`git checkout` / `git restore`**）；10 个源码文件 SHA-256 与探针前一致，`git status --porcelain`
为空；没有 `git commit`。恢复后最后一次全量重跑同为 79 files / 674 tests、7/7 e2e 全绿。

**探针文件 SHA-256（恢复后）**

```text
801f88ca459eaea1545c835448579bd300a84120cb2e471881a188f60e634786  src/client/styles/global.css
ad56b7504a2504376e73d8534606a3d4f4625e196154700ada056c1468a8a283  src/client/App.tsx
eb1dbebadd2590475993d8667c53ea9fc6c30a4ae8b6590dfac6d174f42b0d62  src/client/game-state.ts
9b27d20cc94937a98afb0bfc1e5cca4b9701f7eec3326f811a12fd5aa61a40b1  src/client/components/SpeechInput.tsx
10df1394944a0568dc4fff602563ff595f665fb5caf924b92fadafd1c4a758ac  src/client/components/VoteInput.tsx
6801e9e91c9ba74a47d3ba9ae784d43c2069caac83e44a563c29e04268bef531  src/client/components/IdCard.tsx
e163cc6b4fa3a1bea595305cd34a24f9715f5597ecae7a26d3e1c393a3e882db  src/client/components/OnboardingHints.tsx
1b1feb0e82013281424207b4ba7bb1467cedd4009daa3143dd3b622868920922  src/client/components/StatusBar.tsx
fbe71228518407f56030a7effc41518da8495c8a5bb6b87e6b2772c6ec454119  src/server/orchestrator.ts
6f6242b550ad02fdff821a8f3b67bb607e15068fa772bc0c9613865ae845916d  src/server/routes/games.ts
```

---

### 1. 八项复核结论（先看这张表）

| 用户项 | 本轮结论 | 一句话证据 |
|---|---|---|
| **C-116** e2e 等 `.app` | **Closed（测试有牙）** | 源码注入 `.app{min-width:500px}` 后**重建**再跑 360px：1 failed，`overflow=140`；不重建时仍绿，见 §2.1 的构建问题 |
| **C-117** 三段式布局 | **实现 Closed；测试未闭合** | 真实 Chrome 390×700 三段矩形不重叠、输入框真可点（§1.2）；但输入框可被单独 `position:fixed` 到顶部而 e2e 仍 7/7 绿，实测盖住 timer 24px（§2.2） |
| **C-118** 投票 | **Partial** | 真浏览器 Tab×2 → 「投 3 号」→ Enter 能完成投票（§1.3）；但 `DAY_VOTE_RUNOFF` 既不渲染也不走输入通道，玩家重投票由 AI 代打；删掉整个 `VoteInput` 后 7/7 e2e 仍绿 |
| **C-119** 焦点/对比度 | **对比度 Closed；焦点锁无效** | 调低 `--muted` → 对比度 1 failed（2.80 < 4.5）；删掉 `:focus-visible` 后焦点 e2e 仍 1 passed（Chrome UA 默认 outline） |
| **C-120** 术语 | **Partial** | 页面只有 3 个 trigger（投票/刀/悍跳），AC-2 要求 8 个术语里只有「刀」「悍跳」出现；把 `<span>放逐</span>` 写进组件，静态扫描仍 3/3 绿（§1.3a） |
| **C-121** 跨天发言 | **实现 Closed；测试缺失** | 跨天探针：第 2 天 `spoken=[]`、`speaking=1`（§1.5）；把 `spokenSeats` 回退成旧实现，client 40/40 仍绿 |
| **C-122** 草稿同步 | **实现 Closed；测试缺失** | 真实 60 秒超时把「草稿超时测试：我怀疑7号。」写成 `SPEECH`（§1.6）；删掉 `onDraft?.(...)` 后 client 40/40 仍绿 |
| **C-123** 身份卡/读屏/`gameId` | **未闭合** | `runGame({gameId:A})` 实际推进 B（§1.7）；`IdCard` 没有技能/目标；`OnboardingHints` 仍渲染 `wolf`；`role="status"` 每秒更新；删掉 IdCard 与 status 后 client 40/40 仍绿 |

### 1.1 C-116 / AC-8：等挂载的修复成立

`tests/e2e/game.spec.ts:27` 在量 `scrollWidth` 前等待 `.app` 可见。反向探针：

```text
源码 .app{min-width:500px}，不重建 → pnpm exec playwright test -g "360px" → 1 passed
执行 pnpm build 后再跑                  → 1 failed，overflow=140（期望 <= 0）
```

所以这条测试在 bundle 是当前源码时确实会红。**但它依赖人工先 build**：`scripts/test-e2e.mjs:42`
仍然直接 `spawn(PLAYWRIGHT_BIN, ['test', ...])`，没有 `pnpm build`；源码改了不重建时，360px
用例仍然 1 passed。这属于 §2.1 的证据链问题，不是 C-116 本身的挂载等待问题。

### 1.2 C-117 / AC-10：布局实现正确，e2e 漏测输入框本身

真浏览器（`channel:'chrome'`，390×700，玩家 1 号轮次，输入框可见，clean build）：

```text
banner  12    – 162
main    174   – 396
footer  408   – 688
input   408   – 671.6      elementFromPoint(输入框中心) = TEXTAREA.input__box
timer   126   – 150
speaking 425.6– 467.6（被 main 的 overflow 裁剪，未绘制到 footer 之上）
scrollWidth=390, clientWidth=390
```

三段矩形与输入框可点击都成立，Round 1 的 42px 重叠消失。**但测试只比较
`banner/footer` 与 `main/footer`，以及输入框中心点是否命中输入框**；它没有比较输入框自身的
矩形与 `banner` / `timer`。反向探针：

```css
.input { position: fixed; top: 0; left: 12px; right: 12px; z-index: 999; }
```

重建后 `-g "不遮挡"` → **1 passed**；同一页面实测：

```text
input 0 – 263.6，banner 12 – 162（重叠 150px），timer 126 – 150（重叠 24px）
elementFromPoint(timer 中心) = input__box
```

即：输入框可以把倒计时整块盖住，而 AC-10 的 e2e 仍绿。建议直接断言
`input`（不是 footer）与 `banner`、`timer` 的矩形不重叠，另保留 `elementFromPoint`。

### 1.3 C-118 / AC-11：投票可用，但重投与自动化证据缺位

**正向（真浏览器）**：在真实页面上等 `DAY_VOTE`，从 body 起按 Tab：

```text
Tab #1 → OL.feed__list（outline 3px）
Tab #2 → BUTTON "投 3 号"（outline 3px）
Enter  → phase 从 DAY_VOTE 推进到 FINISHED，无 app__error
```

点击「投 3 号」也走同一条路由并能推进。`playerAction` 的 `DAY_VOTE` 分支（`orchestrator.ts:233-244`）
与路由的 `channels.submit`（`routes/games.ts:262-267`）都在；路由通知这条有牙：
**删掉 `channels.submit(VOTE)` → `tests/server/channels.test.ts` B-R9-1 1 failed / 19 passed（5.0s 超时）**。

**但有三条实质缺口：**

1. **`DAY_VOTE_RUNOFF` 未接入玩家。** `App.tsx:141` 只判断 `ctx.phase === 'DAY_VOTE'`；
   `orchestrator.ts:183` 只把 `DAY_SPEECH` / `DAY_VOTE` 当玩家相位。引擎的 `vote` handler 同时
   支持 `DAY_VOTE_RUNOFF`（`src/engine/phases/vote.ts:122-135`），`legalTargets` 也为重投返回
   并列者（`src/server/project/targets.ts:28-29`）。一旦首轮平票，`nextActor` 会选中玩家，但
   `playerPhase` 为 false → 调用 `decide`（生产是 LLM/脚本 AI）替玩家投重投票，且界面没有
   投票按钮。这是 AC-11 / PRD FR-6 的规则对等性缺陷。
2. **没有 e2e 覆盖投票。** 删掉 `App.tsx` 的整个 `<VoteInput>` 并重建 → `pnpm exec playwright test`
   **7 passed**；`game.spec.ts:155-168` 仍是 `box.focus()`，不是 Tab；给 textarea 加 `tabIndex={-1}`
   并重建 → 键盘用例 **1 passed**（Round 1 的 E4 原样复现）。测试名「Tab 能到发言区」与实现不符。
3. **玩家投票分支本身没有锁。** 把 `playerPhase` 改成只认 `DAY_SPEECH`（即删掉 `DAY_VOTE` 分支）后，
   `tests/server/channels.test.ts` **20/20 passed**、`tests/server/game-loop.test.ts` **2/2 passed**。
   整局仍能因路由直写 VOTE 而结束——测试证明不了「玩家投票走输入通道」，只能证明路由能写票。

### 1.3a C-120 / AC-2、AC-3：术语接进了界面，但只接了 3 个，扫描也漏 JSX

**正向**：`TermHint` 不再是死代码，`App.tsx:147-152` 在提示区渲染了 3 个 trigger；真实
Chrome 里逐个 `focus()` 后 `aria-describedby` 与 tooltip 都出现：

```text
投票  → 票：投票，或指某人的得票
刀    → 刀：狼人夜间击杀
悍跳  → 悍跳：狼人冒充预言家
```

**但 AC-2 要求 8 个术语**（刀、验、放逐、悍跳、自曝、屠边、屠城、垫飞）。真实页面
`.term__trigger` 只有 3 个，其中「投票」不是 `TERMS` 的标签（`TERMS.vote.label === '票'`）；
8 个里实际出现的只有「刀」「悍跳」两个。发言流里的术语仍是纯文本，没有 hover/focus
落点，也没有 `terms.spec.ts`。

**AC-3 的扫描也有缺口**：`tests/security/no-hardcoded-terms.test.ts:57-72` 只匹配
`['"\`]标签['"\`]` 这种**字符串字面量**。把 `<span>放逐</span>` 直接写进 `StatusBar.tsx` 的
JSX 后：

```text
pnpm exec vitest run --project unit tests/security/no-hardcoded-terms.test.ts
→ 3 passed
```

也就是 JSX 文本节点里的术语逃过了扫描；`a11y.test.tsx:149-156` 又只是读取 `App.tsx` 源码，
断言「至少出现 `<TermHint` 且 termKey 是 knife|vote|fakeSeerClaim 之一」，删掉其中两个
也不会红。AC-3「术语文本全部来自 `terms.ts`」目前只有 tooltip 的解释文本成立，trigger 的
可见文字是 `App.tsx` 里硬编码的 children。

**建议**：给 8 个术语一个明确的出现位置（术语表/发言流 inline 渲染），补 hover + 键盘聚焦
的 e2e；把扫描扩展到 JSX 文本与 `TermHint` children，或让 `TermHint` 自己渲染
`TERMS[termKey].label`，从结构上消除硬编码。

### 1.4 C-119 / AC-12、AC-13：对比度有牙，焦点 e2e 测的是 UA 默认样式

**AC-13（通过）**：把 `--muted` 改成 `#5b6670` 并重建：

```text
对比度用例 1 failed
Expected: >= 4.5
Received:    2.8019217884072734
```

**AC-12（实现通过，e2e 弱）**：删掉整个 `:focus-visible` 块并重建：

```text
焦点用例 1 passed
```

原因是 Tab #1 落在 `OL.feed__list`（Chrome 对可滚动容器给的默认焦点），UA 自带
`outline: auto 1px`，不是应用自己的 3px `--accent`。这条 e2e 既没有聚焦 button/textarea，也
不能发现「应用焦点样式被删」。AC-12 仍由 `tests/client/a11y.test.tsx:40-55` 的 CSS 文本扫描锁住
（J4 会红），所以不是功能缺陷，但**不能把它当作真浏览器回归锁**。

### 1.5 C-121 / AC-6、AC-7：跨天实现正确，测试为零

用 `tsx` 直接调用纯函数，构造：

```text
第 1 天 DAY_STARTED + SPEECH 1/2/3
第 2 天 DAY_STARTED（speechStartSeat=1，alive=[1,3]）
```

结果：

```text
spokenSeats = []
speakingSeat = 1
buildBoard  → 1 号 speaking、hasSpoken=false；3 号 hasSpoken=false
```

实现与 Round 1 的 P-MULTIDAY 期望一致。**但把 `spokenSeats` 回退成旧的全量过滤后，
`pnpm exec vitest run --project client` 仍然 40/40 passed**：`tests/client/game-state.test.ts:44-85`
没有跨天用例，也没有任何测试渲染 `App`。这条修复目前是「代码对、锁没有」。

### 1.6 C-122 / UI-4：超时真的提交了草稿，但没有回归锁

真实浏览器、390×700、seed 13、玩家 1 号轮次：

```text
输入「草稿超时测试：我怀疑7号。」，不按 Enter
等待服务端 60 秒超时
→ timer 显示「时间到」，phase 变 DAY_VOTE
→ feed 出现「1 号 / 草稿超时测试：我怀疑7号。」
```

`/api/games/:id/input` 收到一次 200（`performance` 资源项）。**UI-4 的核心行为已兑现。**
反向探针：删掉 `SpeechInput.tsx:52-57` 的 `onDraft?.(...)` → client **40/40 passed**；
没有测试检查 `onDraft` 是否被调用、`POST /input` 是否发生、超时最终事件是否含文本。
另有非阻塞问题：App 没有防抖，每次 `onChange` 都 `void client.draft(...)`；`ApiClient.draft`
不检查 `response.ok`，失败静默。

### 1.7 C-123 / AC-15：`gameId` 仍是类型参数，身份卡不完整，读屏区每秒播报

**（a）`runGame` 仍忽略 `gameId`（阻塞，Round 1 C-122 原样复现）**

`orchestrator.ts:29` 加了可选 `gameId`，`game-loop.ts:62` 也传了；但 `orchestrator.ts:148` 仍取：

```ts
session.gameIds[session.gameIds.length - 1]
```

`deps.gameId` 在函数体内**从未被读取**。真实探针：同 session 创建 A、B 两局后：

```text
requested=A，lastInSession=B，advanced=B
aEvents=1，bEvents=1
```

即 `/play A` 仍推进 B。多标签页/刷新会不断追加 gameId，旧循环会推进最新一局；`GameLoop` 的
`running` 以 gameId 为键，A、B 两个循环还会同时推进 B。这不是「参数未使用」的整洁问题，是
Round 1 P-MULTIGAME 的功能缺陷未修。

**（b）IdCard 不满足 F24 AC-1 / F21 AC-2**

`IdCard.tsx:14-46` 只显示「N 号 · 角色名」+ 角色专属事实（查验史/药水/开枪/队友）。没有
**技能**、没有**目标**、没有通用**剩余次数**；村民角色连事实列表都是空的。服务端
`src/server/view/id-card.ts` 已有的 `skills` / `goal` / `remaining` 没有被客户端使用
（客户端也无法直接 import，但应在 shared 层复用）。这与 RFC §2.2「身份卡说明：技能、目标、
剩余次数（复用 RFC-011 的卡片）」不一致。

同时 `OnboardingHints.tsx:26` 仍渲染原始 role id：

```text
你的身份是 wolf。先听一两轮，再决定信谁。
```

IdCard 显示「狼人」、引导显示「wolf」，UI-2（身份名只能来自 `terms.ts`）仍被违反；
`StatusBar` 与 `boardAnnouncement` 对 `DAY_VOTE` / `FINISHED` 也直接显示枚举值，F24 AC-5
「文案不出现未定义术语」同样未满足。

**（c）`role="status"` 每秒更新，且公告不含身份**

`App.tsx:134-136` 把 `boardAnnouncement(ctx, remaining)` 放进 `role="status" aria-live="polite"`；
`remaining` 每秒减一，文本随之每秒变化。3.5 秒内 MutationObserver 记录到 **4 次**变化：

```text
你是 1 号，第 1 天，轮流发言，轮到 1 号发言，还剩 34 秒。
你是 1 号，第 1 天，轮流发言，轮到 1 号发言，还剩 33 秒。
……
```

RFC §4 明确要求「倒计时文字使用 aria-live，但不要每秒都播报——每 10 秒或最后 10 秒才更新」。
`StatusBar` 有 `announced` 节流，但新加的 status 区没有。并且公告文本只有「你是 1 号」
（席位），没有 role；`IdCard` 虽有 role，但动态播报本身不含身份。

**（d）没有 App 集成测试**：删掉 `<IdCard>` 与整个 `role="status"` 段后，client 仍
**40/40 passed**。AC-15 / F24 的界面证据仍只来自纯函数与源码文本扫描。

---

### 2. 证据链与流程问题

#### 2.1 `pnpm test:e2e` 仍不构建

`scripts/test-e2e.mjs:42` 只转交 Playwright；`scripts/e2e-server.ts` 在 `dist/client` 存在时托管
静态资源。实测：

```text
源码 .app{min-width:500px}，不重建 → -g "360px" → 1 passed（跑的是旧 bundle）
执行 pnpm build 后再跑              → 1 failed（overflow=140）
```

Round 1 的 E1a / B-8 没有关闭。干净检出时 `dist` 不存在，e2e 会 404（不是假绿），但只要
本地有过一次构建，之后所有 e2e 都可能跑旧代码。建议：`test:e2e` 先 `pnpm build`，或把
`dist/client` 缺失当作明确失败。

#### 2.2 测试计划仍全部 `proposed`

`TEST-STRATEGY.md:332-345` 的 RFC-012 小节仍然写 `tests/e2e/{terms,onboarding,order,responsive,
keyboard,a11y}.spec.ts`，六个文件一个都不存在；`tests/client/id-card.test.tsx` 也不存在。
`game.spec.ts` 确实合并了 responsive / keyboard / a11y 的一部分，但 terms、onboarding、order
没有等价覆盖，也没有在 `## Implementation Notes` 记录「合并覆盖」。TEST-1 / TEST-6 未满足。

#### 2.3 RFC 文档与实测不一致（DOC-1）

- RFC §8.6 仍写「投票 UI | 目前只有发言输入；投票走 API | RFC-013」，但 VoteInput 已在本 RFC；
- RFC §8.7 写「runGame 接受 gameId，同一 session 多局不再推进错局」——实测仍推进错局；
- RFC §8.7 写「e2e 断言…把投票纳进循环」——e2e 没有投票；只有 `channels.test.ts` 有服务端投票循环；
- §8.4 的 PASS 表没有回填本轮；`TEST-STRATEGY.md` 的 `Exists?` 没有回填；README 的训练数字
  只更新了 674，状态行仍与 RFCS 不一致。

#### 2.4 其他直接观察（非阻塞）

- **重复 feed 行**：真实页面在玩家发言后出现同一条 SPEECH 两次（committed + live `done`），
  Round 1 的 P-FEED 仍在；`App.tsx:63-76` 未按 seq 去重。
- **本地倒计时**：`remaining` 仍从挂载起固定递减，不读 `GET /timer`，FINISHED 后仍显示
  「时间到」；不是本轮八项，但会影响 UI-4 的观感。
- **VoteInput 条件**：`ctx.legalTargets.includes(ctx.self.seat) === false` 对投票阶段恒真
  （`legalTargetsOf` 明确排除 observer），所以只要 `DAY_VOTE` 就显示投票，包括已投票后、
  已出局时；点击会得到 `ALREADY_VOTED` / `NOT_YOUR_TURN` 的 alert。
- **`as never` 强转**：`App.vote` 的 `target` 与 `playerAction` 的 `target` 都用 `as never`
  绕过了类型检查；`Action` 的 `VOTE` 联合类型本可表达 `'abstain' | SeatId`。
- **草稿同步无节流**：每个字符一次 `POST /input`；`ApiClient.draft` 不检查响应。
- **IdCard 注释**写「只读投影推导出来的卡片（buildIdCard）」，但客户端没有调用
  `buildIdCard`，与服务端实现已经分叉。

---

### 3. 五个维度

#### 3.1 RFC ADHERENCE — **FAIL**

- 已成立：AC-1 结构、AC-5（持久化）、AC-8（等待挂载 + 有牙）、AC-9（已有）、AC-10 的**实现**
  （390×700 无重叠）、AC-12 的 CSS、AC-13 的调色板与真浏览器对比度、AC-16 的单写者行为、
  UI-4 的超时提交（实测）、AC-11 的 DAY_VOTE 投票路径（实测）。
- 未成立/未锁：AC-2 只覆盖 2/8 个术语；AC-3 的 JSX 字面量扫描缺口；AC-6/AC-7 无跨天测试；
  AC-10 的 e2e 不测输入框 vs timer；AC-11 的 RUNOFF 由 AI 代打且无 Tab→投票 e2e；
  AC-14 的阵营与阶段文案；AC-15 的公告每秒播报、不含 role、无 App 集成测试；
  AC-15 整局入口的 `gameId` 仍被忽略。
- 未记录偏离：`IdCard` 没有复用 RFC-011 的 `buildIdCard` 内容；`OnboardingHints` 仍显示原始
  role id；`boardAnnouncement` 的每秒播报没有在 §8.2 记录。

#### 3.2 RULES COMPLIANCE — **FAIL**

- **UI-1 / SEC-5**：通过。IdCard / SeatGrid / Feed 只消费投影；`VoteInput` 只提交 action。
- **UI-2**：**违反**。`OnboardingHints.tsx:26` 渲染 `wolf`；`StatusBar` / `boardAnnouncement`
  渲染 `DAY_VOTE` / `FINISHED`；术语 trigger 的可见文字（「投票」）不是 `TERMS` 标签。
- **UI-3**：通过（流式逐字；重复行是数据拼接问题，不是流式）。
- **UI-4**：实现通过（真实 60 秒探针），但无回归测试。
- **A11Y-1**：部分。Tab → 投票按钮在真实页面成立；RUNOFF 没有投票 UI；退役的 `SeatGrid`
  按钮仍全部 disabled（`onSelect` 未传），不影响投票但席位不可交互。
- **A11Y-2**：通过（静态扫描 + 真实 3px outline）；e2e 锁不敏感（见 §1.4）。
- **A11Y-3**：部分。倒计时/存活有文字；阵营仍无显式文字；`DAY_VOTE` / `FINISHED` 未本地化。
- **A11Y-4**：通过（`main` / `ul` / `ol` / `button`）。
- **TEST-1 / TEST-6**：**不通过**。`game.spec.ts` 没有 terms/onboarding/order 覆盖；跨天、草稿、
  IdCard、公告、RUNOFF、投票 UI 没有回归锁；`pnpm test:e2e` 不构建。
- **DOC-1**：**不通过**。§8.6 / §8.7 的不实陈述见 §2.3。
- **SEC-1 / SEC-4 / SEC-5**：通过。`/input` 仍然校验 300 字；`POST /actions` 校验席位；
  客户端只拿投影。`as never` 是类型问题，不是注入面。

#### 3.3 SECURITY — **PASS（非阻塞建议）**

- 对局视图仍由 `project(state, observer)` 生成；VoteInput 只提交自己的 seat；路由仍拒绝
  他人席位；`/input` 有 300 字上限。
- 非阻塞：`POST /play` 仍无频率限制；IdCard 的 `role`/知识来自投影，已按 SEC-5 裁剪；
  `console.error` 仍打印错误对象（未见密钥）。

#### 3.4 PERFORMANCE — **NEEDS WORK**

- `App` 每秒全量 `GET /api/games/:id` + `project()` 重放全部事件，与 SSE 并存（Round 1 C-126）。
- 草稿同步没有节流：每次按键一次 `POST /input`；建议 200–300ms debounce，并在 `ApiClient.draft`
  检查 `response.ok`。
- `SpeechFeed` 仍用 `scrollIntoView`（虽然现在最近的滚动容器多半是 `.app__main`）。

#### 3.5 MAINTAINABILITY — **NEEDS WORK**

- **没有 App 集成测试**：0 个测试渲染 `App`；TermHint、IdCard、status 区、投票 UI 的接线都
  只靠源码字符串扫描。
- **IdCard 重复实现**：服务端 `buildIdCard` 与客户端 `IdCard` 两套字段；客户端缺 skills/goal。
- **VoteInput 条件恒真**、dead/已投票仍显示；`as never` 绕过类型。
- **live region 文本**每秒变化；应复用 StatusBar 的 `announced`。
- **文档/测试计划**：RFC §8.6/§8.7、TEST-STRATEGY `Exists?`、README 与实现不一致。

---

### 4. 验收标准逐条（Round 2）

| AC | 判定 | 一手证据 |
|---|---|---|
| 1 三块区域、阶段与天数 | **PASS（证据 PARTIAL）** | `App.tsx:119-137`；真实 Chrome heading/status；e2e 主路径不验天数/阶段值（非阻塞） |
| 2 8 个术语悬停/聚焦 | **PARTIAL / OPEN** | 3 个 trigger（投票/刀/悍跳），8 个里只有 2 个；focus 可显示 tooltip；无 terms.spec |
| 3 术语来自 terms.ts、扫描 client | **PARTIAL / OPEN** | `no-hardcoded-terms.test.ts:57-72` 只拦字符串字面量；`<span>放逐</span>` 仍 3/3 绿；trigger 可见文字不经 TERMS |
| 4 发言提示不代填 | **PASS** | `SpeechInput.tsx:44-50`；`a11y.test.tsx:133-147` 新增了提示与 aria-describedby 的锁 |
| 5 引导可关闭、刷新不再出现 | **PASS（实现）** | localStorage + unmount/remount；e2e 仍未做真正刷新（非阻塞） |
| 6 三项发言状态 | **PASS（实现）** | 跨天探针（§1.5）；无跨天测试（OPEN） |
| 7 当前发言者由事件流推导 | **PASS（实现）** | 同上；`speakingSeat` 按最近 DAY_STARTED 起算 |
| 8 360px 无横向滚动 | **PASS** | e2e 等 `.app`；min-width 探针重建后 1 failed（140px） |
| 9 ≥1024px 桌面布局 | **PASS** | e2e `gridTemplateColumns` ≥2；仍只断言列数（非阻塞） |
| 10 输入不遮挡轮次/倒计时/当前发言 | **PASS（实现）/ OPEN（测试）** | 390×700 无重叠；fixed 输入框探针 e2e 仍绿且盖 timer 24px（§1.2） |
| 11 纯键盘「发言 → 投票」 | **PARTIAL / OPEN** | 真实 Chrome Tab×2 → 投 3 号 → Enter 可完成；e2e 仍 `.focus()`、无投票；RUNOFF 由 AI 代打 |
| 12 焦点可见 | **PASS** | CSS 3px + 真实 Chrome outline；e2e 对删 CSS 不敏感（§1.4） |
| 13 对比度 AA | **PASS** | 低 `--muted` 探针 2.80 → 1 failed |
| 14 倒计时/阵营/存活有文字 | **PARTIAL** | 倒计时/存活有；阵营无显式文字；`DAY_VOTE` / `FINISHED` 原始枚举 |
| 15 读屏身份/阶段/轮到谁 | **PARTIAL / OPEN** | IdCard 有 role；status 区有阶段/轮到谁但无 role、每秒播报；无 App 集成测试 |
| 15（整局入口） | **PARTIAL / OPEN** | `game-loop.test.ts` 能到 FINISHED；`runGame` 忽略 `gameId`（A/B 探针）；玩家夜间动作仍由 AI 代打；投票分支无锁 |
| 16 不双写 | **PASS（行为）** | `channels.test.ts` B-R9-1 无 REJECTED、单条 SPEECH；RFC §8.4 引用的 `game-loop.test.ts` 仍无此断言（非阻塞文档） |

---

### 5. 结论

**Overall Risk Level: High。**

本轮确实修好了几件真问题：AC-8 的等待挂载与 min-width 探针、AC-10 的三段式布局实现、
AC-13 的真浏览器对比度、超时草稿提交（真实 60 秒）、跨天发言推导、以及 DAY_VOTE 的投票
UI。这些都有真实浏览器/真实超时的正向证据。

但八项里仍有 **一项功能完全未修（`runGame` 的 `gameId`）、一项规则缺口（`DAY_VOTE_RUNOFF`
由 AI 替玩家投）、一项 Must 功能不完整（IdCard 无技能/目标、Onboarding 仍是 `wolf`）**；
其余多项是「代码修了、测试没锁」：跨天、草稿、投票 e2e、IdCard/公告。更严重的是两条新的
假绿——**输入框单独 `fixed` 盖住 timer 而 AC-10 e2e 仍绿**、**删掉整个 VoteInput 而 7/7 e2e
仍绿**——说明本轮新增的真浏览器用例还没有覆盖它们声称覆盖的行为。`pnpm test:e2e` 仍不构建，
使这些绿灯在源码变更后不可信。

**Blocking Issues（必须修复后才能合并）**

1. **C-122（Round 1 未修）· `runGame` 忽略显式 `gameId`。** A/B 同 session 探针
   `requested=A → advanced=B`；`orchestrator.ts:29` 只加了参数，`:148` 仍取
   `session.gameIds[last]`。多标签页/刷新/`/play A` 都会推进错的局。必须改成
   `deps.gameId ?? session.gameIds[last]`，并补 A/B 同 session 回归用例。
2. **C-127（新）· `DAY_VOTE_RUNOFF` 未接入玩家。** `orchestrator.ts:183` 与 `App.tsx:141`
   都只认 `DAY_VOTE`；首轮平票时玩家重投票由 `decide`（LLM/脚本 AI）代打，且没有投票 UI。
   必须把 `DAY_VOTE_RUNOFF` 纳入 `playerPhase` 与 VoteInput（只列 runoff 并列者、不可弃权），
   并补平票 → 重投的用例。
3. **C-118（Round 1 未闭合）· AC-10 的 e2e 不测输入框本身。** 反向探针：
   `.input{position:fixed;top:0;...}` 后 e2e 仍 1 passed，实测盖住 banner 150px、timer 24px。
   断言应改为 `input` 与 `banner`、`timer` 的矩形不重叠（并保留 `elementFromPoint`）。
4. **C-119（Round 1 未闭合）· AC-11 没有 Tab→投票 e2e，投票 UI 无回归锁。**
   删掉 `<VoteInput>` → 7/7 e2e 绿；`tabIndex={-1}` → 键盘用例仍绿；删掉 `DAY_VOTE`
   的 `playerPhase` → channels 20/20 + game-loop 2/2 绿。补一条真正 Tab → 输入 → Enter →
   投票的 Playwright 用例，并覆盖「发言后输入框消失、投票按钮出现」。
5. **C-116（Round 1 未闭合）· AC-2 / AC-3 的术语覆盖不足。** 页面只有 3 个 trigger，
   8 个术语里只有「刀」「悍跳」；`<span>放逐</span>` 这类 JSX 字面量逃过静态扫描。
   补全部 8 个术语的悬停 + 键盘聚焦覆盖，并把扫描扩展到 JSX 文本/children。
6. **C-117（Round 1 未闭合）· 跨天发言没有回归锁。** `spokenSeats` 回退成旧实现后 client
   40/40 仍绿。补第 1 天发言 + 第 2 天 DAY_STARTED 的纯函数用例与渲染 `App` 的用例。
7. **C-120（Round 1 未闭合）· 草稿同步没有回归锁。** 删掉 `onDraft` 后 client 40/40 仍绿。
   补「输入 → `/input` 调用 → 60 秒超时 → 事件含草稿文本」的可控时钟用例；同时加防抖。
8. **C-121 / C-123（Round 1 未闭合）· 身份卡与读屏证据不完整。** IdCard 缺技能/目标/
   剩余次数（F24 AC-1 / F21 AC-2）；`OnboardingHints` 仍显示 `wolf`；status 区每秒播报且
   不含 role；删掉 IdCard + status 区后 client 40/40 仍绿。补 App 集成测试与上述内容。
9. **C-130（新，证据链）· `pnpm test:e2e` 不构建。** Round 1 E1a 原样复现：源码
   `min-width:500px` 不重建仍 1 passed，重建后 1 failed。必须先 `pnpm build`（或把缺失
   `dist/client` 当失败），否则本轮所有 e2e 结论都可能是旧 bundle。

**Improvement Suggestions（非阻塞）**

1. `VoteInput` 只在玩家是当前投票者/未投票/存活时显示；把
   `ctx.legalTargets.includes(ctx.self.seat) === false` 换成明确的我的回合判定。
2. 去掉 `as never`：`VOTE` 的 `target` 用 `SeatId | 'abstain'` 类型，让编译器校验。
3. 草稿同步加 200–300ms debounce；`ApiClient.draft` 检查 `response.ok`；把失败暴露到
   `app__error`。
4. `role="status"` 复用 `StatusBar` 的 `announced`，并把 role 写进 `boardAnnouncement`。
5. 用 `ROLE_LABELS` / 阶段中文映射替换 `OnboardingHints`、`StatusBar` 的原始枚举。
6. 按 seq 去重 committed 与 live 行；`SpeechFeed` 只改自己的 `scrollTop`。
7. `remaining` 改为服务端 `/timer` 的派生值，按玩家轮次重置；FINISHED 后隐藏。
8. 补 `tests/client/id-card.test.tsx` 与一个渲染 `App` 的集成测试（假 ApiClient）。
9. 把 `TEST-STRATEGY.md:332-345` 的六个计划文件回填为实际文件，或在 Implementation Notes
   记录合并后的等价覆盖；同步 RFC §8.6/§8.7 与 README。
10. 记录 M-3（VoiceOver 实听）与 M-6（移动端真机）结果；当前 Implementation Notes 没有。

**状态**：RFC-012 → **`Changes requested`**。

本轮没有 `git commit`。所有探针源码已从 `/tmp/howl-rfc012-r2-probes/backup/` 的文件备份恢复
（**未使用 `git checkout` / `git restore`**），10 个文件 SHA-256 与探针前一致；
`git status --porcelain` 为空；临时探针脚本在 `/tmp`，仓库内无残留；最终
`pnpm test` 79 files / 674 tests、`pnpm test:e2e` 7/7、五条命令 exit 0。

---

## Round 3 -- 2026-11-19

> 评审方式：全新上下文 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 被评审提交：`1f97297 fix(rfc-012): runGame 目标局、重投投票与几何/术语回归锁（Round 2）`。
> 评审开始时 HEAD `1f97297`，工作树 clean。结论：**Changes requested**。
>
> 用户本轮点名的八项与 `RFCS.md` §8.42 的编号不同（用户把跨天与草稿都归到 C-120，
> 把身份卡/读屏归到 C-121/C-123）。按内容复核；映射如下，避免下一轮看错行：
>
> | 用户消息 | 实际内容 | `RFCS.md` §8.42 |
> |---|---|---|
> | C-122 | `runGame` 使用 `deps.gameId` | C-122 |
> | C-127 | `DAY_VOTE_RUNOFF` 走玩家输入 + `VoteInput` | C-127 |
> | C-118 | e2e 比较输入框自身与 banner/timer | C-118 |
> | C-119 | 「发言 → Tab → Enter 投票」e2e | C-119 |
> | C-116 | 引导里八个术语的词汇表 | C-116 |
> | C-120 | 跨天 + 草稿回归锁 | C-117 + C-120 |
> | C-121/C-123 | IdCard 补项 + 读屏公告节流 | C-121 + C-123 + C-128/C-129 |
> | C-130 | e2e 先 build | C-130 |

---

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `1f97297` · 评审开始时工作树 clean。

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
      Tests  678 passed (678)
    Duration  33.88s
TEST_EXIT=0

$ pnpm test:e2e
Running 8 tests using 1 worker
  ✓  1 tests/e2e/game.spec.ts:12:3 › 整局界面 › 主路径：能开一局、看到状态条与席位、发言区可达 (425ms)
  ✓  2 tests/e2e/game.spec.ts:22:3 › 整局界面 › 360px 视口没有横向滚动 (234ms)
  ✓  3 tests/e2e/game.spec.ts:35:3 › 整局界面 › 1024px 视口用桌面布局（席位在侧栏） (415ms)
  ✓  4 tests/e2e/game.spec.ts:49:3 › 整局界面 › 手机视口下输入区不遮挡状态条 (306ms)
  ✓  5 tests/e2e/game.spec.ts:113:3 › 整局界面 › 焦点可见：Tab 之后焦点元素有可见 outline (239ms)
  ✓  6 tests/e2e/game.spec.ts:131:3 › 整局界面 › 对比度：正文与次要文字达到 AA (376ms)
  ✓  7 tests/e2e/game.spec.ts:172:3 › 整局界面 › 键盘：Tab 能到投票按钮，Enter 能投票 (348ms)
  ✓  8 tests/e2e/game.spec.ts:193:3 › 整局界面 › 键盘：Tab 能到发言区，Enter 能提交 (249ms)
  8 passed (5.3s)
E2E_EXIT=0
```

绿色本身不是结论：下面用定向变异把「这八项声称锁住的行为」逐项打了一遍。所有探针从
`/tmp/howl-rfc012-r3-probes/backup/` 的文件备份恢复（**未使用 `git checkout` / `git restore`**），
恢复后 `git status --porcelain` 为空；探针文件 SHA-256 见 §7。

---

### 1. 八项复核结论（先看这张表）

| 用户项 | 本轮结论 | 一句话证据 |
|---|---|---|
| **C-122** `runGame` 用 `deps.gameId` | **Closed** | 把 `orchestrator.ts:148` 回退成取 `session.gameIds[last]`，C-122 用例 **1 failed**（`expected 1 to be greater than 1`，`game-loop.test.ts:162`） |
| **C-127** RUNOFF 走玩家 | **Open（阻塞，部分修复）** | 服务端与界面都接上了；但删掉 RUNOFF 分支后 server **233/233**、client **43/43** 仍绿；`VoteInput` 仍把全部存活席位+弃权交给重投，引擎只允许并列者 |
| **C-118** 输入框几何 | **Closed** | 把 `.input` 单独 `position:fixed; top:0` 后，手机用例 **1 failed**，输入框与 banner 重叠 **30.39px**（`game.spec.ts:98`） |
| **C-119** 发言 → Tab → 投票 | **Open（阻塞，部分修复）** | 用例确实锁住了 DAY_VOTE 的玩家投票路径（删 `playerPhase` 的 `DAY_VOTE` → 1 failed），但测试里是 `voteButton.focus()` 不是 Tab；给投票按钮加 `tabIndex={-1}` 后仍 **1 passed** |
| **C-116** 八个术语 | **Open（阻塞，部分修复）** | 引导里 8 个标签都在；但 `<span>放逐</span>` 写进 `StatusBar` 后静态扫描仍 **3/3 绿**；删掉 `TermHint` 的 `onMouseEnter` / `onFocus` 后 client **43/43 绿** |
| **C-120** 跨天 + 草稿 | **Open（阻塞，部分修复）** | 跨天回退 → `game-state.test.ts` **1 failed**；删 `onDraft?.()` → components **1 failed**；但删掉 `App` 的 `onDraft={syncDraft}` 后 client **43/43 绿**，`/input` 与 60 秒超时仍无锁 |
| **C-121/C-123** 身份卡 + 读屏 | **Open（阻塞，部分修复）** | IdCard 的技能/目标/剩余有组件测试（删掉会红）；但 live region 恒说「时间到」、不含 role、RUNOFF 显示原始枚举；删掉 `App` 里的 `<IdCard>` 与整个 status 区后 client **43/43 绿** |
| **C-130** e2e 先 build | **Closed（核心）** | 源码加 `.app{min-width:500px}`、不手动 build，360px 用例 **1 failed（overflow=140）**；`reuseExistingServer` 的残留见 §2.8（非阻塞） |

---

### 2. 逐项证据

#### 2.1 C-122 / AC-15 整局入口：`gameId` 子项真的修好了

`src/server/orchestrator.ts:148`：

```ts
const targetId = deps.gameId ?? session.gameIds[session.gameIds.length - 1] ?? '';
```

`GameLoop.run` 已经把 `gameId` 传进 `runGame`（`src/server/game-loop.ts:58-69`）。反向探针：

```text
源码改成 const targetId = session.gameIds[session.gameIds.length - 1] ?? '';
pnpm exec vitest run --project unit tests/server/game-loop.test.ts -t "C-122"
→ 1 failed / 2 skipped
  expected 1 to be greater than 1
  tests/server/game-loop.test.ts:162
```

即 A/B 两局同 session 时，回退实现会让第一局停在 1 条事件、第二局被推进，测试会红。
**C-122 的 `gameId` 子项 Closed。** 但 Round 2 同一条里还记了「玩家夜间动作由 AI 代打」；
本轮用户只声明了 `gameId`，这一半不在八项内，未重查（见 §5 的 AC-15 行）。

#### 2.2 C-127 / AC-11：RUNOFF 接上了，但选项集是错的，且没有回归锁

**接上的部分**：

- `orchestrator.ts:184-187` 的 `playerPhase` 包含 `DAY_VOTE_RUNOFF`；
- `orchestrator.ts:234-247` 的 `playerAction` 在两个投票阶段都读 `kind:'vote'`；
- `App.tsx:149-154` 在 `DAY_VOTE` 与 `DAY_VOTE_RUNOFF` 都渲染 `VoteInput`；
- `VoteInput` 的按钮是真实的 `button`，Enter 可以触发。

**但有两个实质问题。**

（a）**没有「平票 → 重投」用例。** 把 RUNOFF 从 `playerPhase` 删掉：

```text
pnpm exec vitest run --project unit tests/server
→ 26 files / 233 tests 全绿
```

把 RUNOFF 从 `App.tsx:149` 的条件里删掉：

```text
pnpm exec vitest run --project client
→ 4 files / 43 tests 全绿
```

Round 2 的 C-127 明确要求「补平票 → 重投的用例」；现在这两处删掉都没有测试会红。

（b）**`VoteInput` 在重投阶段给出非法选项。** `App.tsx:150-153` 传的是：

```tsx
aliveSeats={ctx.aliveSeats.filter((seat) => seat !== ctx.self.seat)}
```

而不是投影里的 `ctx.legalTargets`。`src/server/project/targets.ts:28-29` 写得很清楚：

```ts
// 重投阶段（DAY_VOTE_RUNOFF）只能投并列者，且不能弃权（RUL-2）。
return state.phase === 'DAY_VOTE_RUNOFF' ? [...(state.runoff ?? [])] : [...alive, 'abstain'];
```

用假 `ApiClient` 渲染 `App`（临时探针，已删除），投影是 `phase=DAY_VOTE_RUNOFF`、
`aliveSeats=[1..6]`、`legalTargets=[2,6]`、`self=1`，实测：

```text
RUNOFF_VOTE_BUTTONS=["投 2 号","投 3 号","投 4 号","投 5 号","投 6 号"]
RUNOFF_ABSTAIN=true
```

引擎的 `vote.ts:122-135` 对非并列者与弃权都返回 `INVALID_RUNOFF_TARGET`。路由
（`routes/games.ts` 的 `accepted` 分支）只在引擎接受后通知挂起的输入通道，所以：

- 点「投 3/4/5 号」或「弃权」：引擎写 `REJECTED`，路由 200 但不兑现通道；
- 编排层仍在 `input.read` 等这一票，60 秒后超时提交 `abstain`，再次被拒绝；
- `nextActor` 仍返回同一玩家，循环会一轮 60 秒地空转，直到 `maxSteps` 才停。

这不是「少一个测试」，而是重投路径上的功能缺陷。**C-127 仍 Open（阻塞）。**

#### 2.3 C-118 / AC-10：几何断言真的能打红

`tests/e2e/game.spec.ts:92-102` 现在直接取输入框自身的 `boundingBox()`，与
`banner`、`timer` 的矩形做重叠计算（另保留 `elementFromPoint`）。反向探针：

```css
.input { position: fixed; top: 0; left: 12px; right: 12px; z-index: 999; }
```

重建后跑 `-g "手机视口下输入区不遮挡状态条"`：

```text
1 failed
Expected: <= 0
Received:    30.390625
  tests/e2e/game.spec.ts:98:55
```

Round 2 的假绿已消失。**C-118 Closed。**

#### 2.4 C-119 / AC-11：投票路径有锁，但「Tab」是假的

`tests/e2e/game.spec.ts:172-191` 的标题是「Tab 能到投票按钮」，正文却是：

```ts
const voteButton = page.getByRole('button', { name: /投 \d+ 号/ }).first();
await expect(voteButton).toBeVisible({ timeout: 25_000 });
await voteButton.focus();
await page.keyboard.press('Enter');
```

`.focus()` 是程序聚焦，不是键盘 Tab；测试没有按过一次 `Tab`。反向探针：

```text
给 VoteInput 的每个按钮加 tabIndex={-1}
pnpm exec playwright test -g "键盘：Tab 能到投票按钮"
→ 1 passed (516ms)
```

如果 Tab 可达性被锁住，`tabIndex={-1}` 应该让这条红。**没有。**

正向的一半是存在的：把 `DAY_VOTE` 从 `playerPhase` 删掉后，同一用例
**1 failed**（25 秒内等不到投票按钮），说明它确实锁住了「玩家投票走输入通道」。
但 AC-11 要求「存在一条用纯键盘完成『发言 → 投票』的 Playwright 用例」，
当前用例不满足「纯键盘」；Round 2 的 C-119 也没有闭合。**C-119 仍 Open（阻塞）。**

#### 2.5 C-116 / AC-2、AC-3：八个词出现了，锁只锁了「出现」

**正向**：`OnboardingHints.tsx:14-22` 的 `GLOSSARY` 覆盖 8 个 `TermKey`，
`OnboardingHints.tsx:46-50` 用 `TERMS[key].label` 渲染（不是硬编码）。
`a11y.test.tsx:149-168` 断言八个标签都在，删掉一个会红。这一半成立。

**但 Round 2 的 C-116 还要求两件事，都没做：**

（a）**JSX 文本节点仍逃过扫描。** `tests/security/no-hardcoded-terms.test.ts:66`
只匹配字符串字面量：

```ts
const literal = new RegExp(`['"\`]\\s*${label}\\s*['"\`]`);
```

把 `<span>放逐</span>` 写进 `StatusBar.tsx` 后：

```text
pnpm exec vitest run --project unit tests/security/no-hardcoded-terms.test.ts
→ 3 passed
```

AC-3 要求「扫描 `src/client/` 断言不出现术语字面量」；JSX 文本是术语最自然的写法，
这个缺口就是 AC-3 的缺口。

（b）**八个术语的悬停 / 键盘聚焦没有测试。** 删掉 `TermHint.tsx:29,31` 的
`onMouseEnter` 与 `onFocus`（只留点击）：

```text
pnpm exec vitest run --project client
→ 4 files / 43 tests 全绿
```

现有只有 `components.test.tsx:77-93` 对 `knife` 的**点击**断言；没有八个词汇表的
hover/focus 用例，也没有 `tests/e2e/terms.spec.ts`。**C-116 仍 Open（阻塞）。**

#### 2.6 C-120 / AC-6、AC-7、UI-4：两条锁有牙，但 App 到 `/input` 的链路仍没锁

**跨天（C-117 部分）有牙。** 把 `spokenSeats` 回退成「统计全部 publicEvents」：

```text
pnpm exec vitest run --project client tests/client/game-state.test.ts
→ 1 failed / 8 passed
  expected [ 1, 2, 3 ] to deeply equal []
  tests/client/game-state.test.ts:141
```

**`onDraft` 回调有牙。** 删掉 `SpeechInput.tsx:57` 的 `onDraft?.(event.target.value)`：

```text
pnpm exec vitest run --project client tests/client/components.test.tsx
→ 1 failed / 12 passed
  expected undefined to be '我怀疑 7 号。'
  tests/client/components.test.tsx:182
```

**但 App 的接线仍没锁。** 删掉 `App.tsx:147` 的 `onDraft={syncDraft}`：

```text
pnpm exec vitest run --project client
→ 4 files / 43 tests 全绿
```

也就是说：组件会回调，但「App 把回调接到 `ApiClient.draft` / `POST /input`」这一层
仍然是裸的；Round 2 要求的「输入 → `/input` 调用 → 60 秒超时 → 事件含草稿文本」
没有落地（现有用例只到回调）。另外草稿仍无防抖、`ApiClient.draft` 不检查
`response.ok`（Round 2 非阻塞建议，未要求本轮修）。**C-120 仍 Open（阻塞，测试）。**

#### 2.7 C-121/C-123 / AC-15：身份卡补上了，读屏公告改出了一个新错误

**（a）IdCard 内容成立。** `IdCard.tsx:21-35` 增加了目标、技能、剩余次数；
`components.test.tsx:186-214` 对女巫断言了「一瓶解药」「解药 1 次」「决定用不用解药」。
删掉这三段后该用例 **1 failed**，说明组件级有牙。`OnboardingHints.tsx:41` 也改用了
`ROLE_LABELS`，不再显示 `wolf`。

**（b）live region 的文本是错的。** `App.tsx:62-69`：

```ts
const announcementKey = ...;
useEffect(() => {
  if (view === null) return;
  setAnnouncement(boardAnnouncement(view.view, 0));
}, [announcementKey]);
```

`boardAnnouncement` 总会拼上倒计时（`game-state.ts:95-101`），而 `countdownText(0)`
是「时间到」。实测（临时 App 探针，已删除）：

```text
SPEECH_STATUS=你是 1 号，第 2 天，轮流发言，轮到 1 号发言，时间到。
RUNOFF_STATUS=你是 1 号，第 2 天，DAY_VOTE_RUNOFF，时间到。
```

开局还有 60 秒，读屏却会播「时间到」；`DAY_VOTE_RUNOFF` 是原始枚举；文本里只有
「你是 1 号」（席位），没有 role。Round 2 的 C-121/C-123 要求「status 复用节流并含 role」，
现在节流有了（只在阶段/天数/轮次变化时更新），但内容和身份仍不对。**这是新错误，登记为
C-132。**

**（c）没有 App 集成测试。** 删掉 `App.tsx:137` 的 `<IdCard>` 和 `App.tsx:142-144`
整个 `role="status"` 区：

```text
pnpm exec vitest run --project client
→ 4 files / 43 tests 全绿
```

组件测试直接 import `IdCard`，所以它保护不了「App 是否渲染 IdCard / 公告」。Round 2
明确要求「补 App 集成测试」；仍缺。**C-121/C-123 仍 Open（阻塞）。**

#### 2.8 C-130 / TEST-1、TEST-6：e2e 现在会先 build；复用旧服务的旁路仍在

`playwright.config.ts` 的 `webServer.command` 已改为：

```text
pnpm build && pnpm exec tsx scripts/e2e-server.ts
```

**反向探针（不手动 build）**：给 `global.css` 加 `.app{min-width:500px}`，直接跑：

```text
E2E_PORT=4184 pnpm exec playwright test -g "360px"
→ 1 failed
  Expected: <= 0
  Received:    140
```

说明 webServer 真的先 build 了，360px 用例能发现源码变更。**C-130 的核心 Closed。**

**残留（非阻塞）**：`reuseExistingServer: !process.env.CI`。先手工起一个 4185 的服务，
再改源码、不 build，跑 `E2E_PORT=4185 pnpm exec playwright test -g "360px"`：

```text
→ 1 passed (436ms)
```

旧 bundle 被复用了。CI 设置 `CI=1` 时不会复用；本地只要没有手工服务，也不会触发。
建议把 `pnpm build` 放进 `scripts/test-e2e.mjs`，或本地也设 `reuseExistingServer: false`，
但这不是本轮阻塞项。

---

### 3. 变异探针汇总

| 探针 | 注入的改动 | 定向命令 | 结果 | 证明 |
|---|---|---|---|---|
| **M-R3-1** | `orchestrator.ts:148` 回退为 `session.gameIds[last]` | `vitest ... game-loop.test.ts -t "C-122"` | **1 failed**（`:162`） | C-122 有牙 |
| **M-R3-2** | `playerPhase` 删掉 RUNOFF | `vitest ... tests/server` | **233/233 passed** | RUNOFF 服务端路径无锁 |
| **M-R3-3** | `App` 的 VoteInput 条件删掉 RUNOFF | `vitest ... --project client` | **43/43 passed** | RUNOFF 界面无锁 |
| **M-R3-4** | `.input{position:fixed;top:0;...}` | `playwright -g "手机视口..."` | **1 failed**，重叠 **30.39px** | C-118 有牙 |
| **M-R3-5** | `VoteInput` 按钮加 `tabIndex={-1}` | `playwright -g "键盘：Tab 能到投票按钮"` | **1 passed** | C-119 的 Tab 无锁 |
| **M-R3-6** | `playerPhase` 删掉 DAY_VOTE | `playwright -g "键盘：Tab 能到投票按钮"` | **1 failed**（25s 无按钮） | 投票路径有锁 |
| **M-R3-7** | `StatusBar` 加 `<span>放逐</span>` | `vitest ... no-hardcoded-terms` | **3/3 passed** | AC-3 扫描漏 JSX |
| **M-R3-8** | `TermHint` 删 `onMouseEnter`/`onFocus` | `vitest ... --project client` | **43/43 passed** | 悬停/聚焦无锁 |
| **M-R3-9** | `spokenSeats` 回退为全天统计 | `vitest ... game-state.test.ts` | **1 failed**（`:141`） | 跨天有牙 |
| **M-R3-10** | `SpeechInput` 删 `onDraft?.()` | `vitest ... components.test.tsx` | **1 failed**（`:182`） | 回调有牙 |
| **M-R3-11** | `App` 删 `onDraft={syncDraft}` | `vitest ... --project client` | **43/43 passed** | App→/input 无锁 |
| **M-R3-12** | `IdCard` 删 goal/skills/remaining | `vitest ... components.test.tsx` | **1 failed**（`:211`） | IdCard 组件有牙 |
| **M-R3-13** | `App` 删 `<IdCard>` + status 区 | `vitest ... --project client` | **43/43 passed** | 无 App 集成测试 |
| **M-R3-14** | `.app{min-width:500px}`，不手动 build | `playwright -g "360px"`（E2E_PORT 4184） | **1 failed**，overflow **140** | C-130 核心有牙 |
| **M-R3-15** | 手工起 4185 服务后同源码改动 | 同上（E2E_PORT 4185） | **1 passed** | `reuseExistingServer` 旁路 |
| **M-R3-16** | 临时 App 探针：RUNOFF `legalTargets=[2,6]` | `vitest ... __probe-app` | 按钮 `2..6` + 弃权 | RUNOFF 选项集错误 |
| **M-R3-17** | 临时 App 探针：60 秒时的 live region | 同上 | 文本含「时间到」 | 读屏公告内容错误 |

---

### 4. 验收标准逐条（Round 3）

| AC | 判定 | 一手证据 |
|---|---|---|
| 1 三块区域、阶段与天数 | **PASS（沿用前轮，证据 PARTIAL）** | e2e 主路径只验 heading，不验天数/阶段值；非阻塞 |
| 2 8 个术语悬停/聚焦 | **NEEDS WORK / OPEN** | 8 个标签在词汇表里；无 hover/focus 用例，删 handlers 仍绿（M-R3-8） |
| 3 术语来自 terms.ts、扫描 client | **NEEDS WORK / OPEN** | `<span>放逐</span>` 逃过扫描（M-R3-7） |
| 4 发言提示不代填 | **PASS** | 沿用 Round 2 的 `a11y.test.tsx:133-147`，本轮未重查 |
| 5 引导可关闭、刷新不再出现 | **PASS（实现）** | 沿用 Round 2；仍是 unmount/remount，无真刷新 e2e（非阻塞） |
| 6 三项发言状态 | **PASS（实现）** | 跨天回退 → M-R3-9 红；无 App 渲染用例（C-117 的残项） |
| 7 当前发言者由事件流推导 | **PASS（实现）** | 同上；`spokenSeats` 锁有牙 |
| 8 360px 无横向滚动 | **PASS** | 沿用 Round 2；C-130 的自动 build 让这条不再跑旧包 |
| 9 ≥1024px 桌面布局 | **PASS** | 沿用 Round 2；仍只断言列数（非阻塞） |
| 10 输入不遮挡轮次/倒计时/当前发言 | **PASS** | M-R3-4 红，重叠 30.39px |
| 11 纯键盘「发言 → 投票」 | **NEEDS WORK / OPEN** | DAY_VOTE 路径有 e2e 锁（M-R3-6 红），但测试用 `.focus()` 不是 Tab（M-R3-5 绿）；RUNOFF 选项集错误（M-R3-16） |
| 12 焦点可见 | **PASS** | 沿用 Round 2；焦点 e2e 仍测 UA 默认 outline（已知，非本轮八项） |
| 13 对比度 AA | **PASS** | 沿用 Round 2 |
| 14 倒计时/阵营/存活有文字 | **PARTIAL** | 倒计时/存活有；阵营仍无显式文字，`StatusBar`/公告仍显示原始枚举（C-128 未关闭） |
| 15 读屏身份/阶段/轮到谁 | **NEEDS WORK / OPEN** | IdCard 有 role（组件测试有牙）；live region 恒「时间到」、无 role、RUNOFF 原始枚举；无 App 集成测试（M-R3-13） |
| 15（整局入口） | **PARTIAL** | `gameId` 子项 Closed（M-R3-1）；玩家夜间动作仍由 `decide` 代打（Round 2 遗留，未在本轮八项内） |
| 16 不双写 | **PASS（行为）** | 沿用 Round 2；本轮未改路由/编排的写入路径 |

**测试计划**：`TEST-STRATEGY.md:332-345` 的 RFC-012 小节仍全部 `proposed`，六个 e2e 文件
仍不存在；本轮新增的覆盖没有回填。RFC §8.8 写「发言 → Tab 到投票按钮 → Enter」，
与 `game.spec.ts:186` 的 `.focus()` 不符；RFC §8.6 仍写「投票 UI 归 RFC-013」。这些属于
C-124 / C-131 的文档漂移，非阻塞，但会误导下一轮评审。

---

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

- **已成立**：C-122 的 `gameId`（M-R3-1 红）、C-118 的输入框几何（M-R3-4 红）、
  C-130 的自动 build（M-R3-14 红）、跨天过滤（M-R3-9 红）、`onDraft` 回调（M-R3-10 红）、
  IdCard 技能/目标/剩余（M-R3-12 红）。
- **未成立 / 未锁**：C-116 的 AC-3 JSX 扫描与 hover/focus；C-119 的 Tab；C-127 的重投
  选项集与平票用例；C-120 的 App→`/input`→超时全链路；C-121/C-123 的 live region 内容
  与 App 集成。
- **新错误**：live region 在开局 60 秒时播「时间到」（C-132）。
- **未重查**：C-128 的原始枚举、C-122 的夜间动作、焦点 e2e 的 UA outline。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **UI-1 / SEC-5**：通过。IdCard、VoteInput、Feed 都只消费投影；没有直接序列化状态。
- **UI-2**：**部分违反**。`OnboardingHints` 已改 `ROLE_LABELS`；但 `boardAnnouncement`
  仍输出 `DAY_VOTE_RUNOFF`，`StatusBar` 仍输出 `NIGHT` / `DAY_VOTE`（C-128，未关闭）。
- **UI-3**：通过（流式渲染未改）。
- **UI-4**：实现成立（Round 2 真实 60 秒探针）；回归锁只到 `onDraft` 回调，App 接线
  仍可被删而不红（M-R3-11）。
- **A11Y-1**：部分。Tab→投票没有真键盘锁；RUNOFF 的非法选项会让键盘用户投出必然被拒的票。
- **A11Y-2**：通过（沿用 Round 2）。
- **A11Y-3**：部分。倒计时/存活有文字；阵营仍无；live region 的「时间到」是错误文字。
- **A11Y-4**：通过（语义标签未改）。
- **TEST-1 / TEST-6**：**不通过**。八个计划 spec 仍 `proposed`；Tab、术语扫描、App 集成、
  平票重投、草稿全链路都没有测试。
- **DOC-1**：**不通过**。RFC §8.8 的「Tab」与代码不符；§8.6 的投票归属过期；
  TEST-STRATEGY 未回填；README 状态行仍停在 RFC-008 的进度。

#### 5.3 SECURITY — **PASS**

- 本轮改动没有扩大数据面：IdCard 只读投影；VoteInput 只提交自己的 `seat`；路由仍校验
  席位与版本；`/input` 仍校验 300 字。
- `as never` 的投票 target 是类型问题（`'abstain' | SeatId` 本可表达），不是注入面。
- 非阻塞旧项：`POST /play` 无频率限制（C-126）。

#### 5.4 PERFORMANCE — **PASS（本轮）**

- 公告从每秒更新改为 key 变化时更新，减少了 live region 的写次数；方向正确。
- 草稿仍每个字符一次 `POST /input`（无防抖），但这是 Round 2 的非阻塞建议，不是本轮回归。
- 每秒全量 `GET /api/games/:id` 的旧问题（C-126）未动，不在八项内。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- **没有 App 集成测试**：删 IdCard、status 区、`onDraft` 接线都不红（M-R3-11 / M-R3-13）。
  这是本轮多个「组件有牙、界面没锁」的共同根因。
- **测试名与实现不符**：`键盘：Tab 能到投票按钮` 实际是 `.focus()`；下一轮读名字会误判。
- **RUNOFF 选项集**：`App` 手写 `aliveSeats.filter` 而不是用投影的 `legalTargets`，把
  「谁能被投」的规则复制到了客户端，违反「状态由投影推导」的方向。
- **IdCard 与 server `buildIdCard` 两套语义**：技能/目标在客户端手写，未复用 shared；
  长期会漂移。
- **新 CSS 类**：`.idcard__goal` / `.idcard__skills` / `.idcard__remaining` 没有样式，
  只有 `.idcard__extras` 被样式覆盖；功能不受影响，但观感与旁边的事实列表不一致。
- **文档漂移**：RFC §8.8、§8.6、TEST-STRATEGY、README 见 §5.2。

---

### 6. 结论

**Overall Risk Level: High。**

八项里 **3 项完全闭合**（C-122 的 `gameId`、C-118 的输入框几何、C-130 的自动 build），
**5 项只是部分修复**：C-127 的服务端/界面接线在，但重投选项集是错的且没有平票用例；
C-119 的投票路径有锁，但「Tab」是 `.focus()`；C-116 的八个词出现了，但扫描和 hover/focus
没锁；C-120 的跨天/回调有锁，但 App→`/input`→超时没锁；C-121/C-123 的身份卡内容有了，
但 live region 恒播「时间到」、缺 role、没有 App 集成测试。测试套件 79 files / 678 tests、
8/8 e2e 全绿，但这些绿灯没有覆盖上面这些退路——M-R3-2/3/5/7/8/11/13 都是「删掉行为仍然全绿」。

**Blocking Issues（必须修复后才能合并）**

1. **C-127（阻塞）· RUNOFF 的非法选项集与缺测试。** `App.tsx:150-153` 把
   `ctx.aliveSeats.filter(...)` 传给 VoteInput；重投阶段应传 `ctx.legalTargets`
   （只有并列者、无弃权）。当前会列出 3 个非法席位 + 弃权；点击后引擎 `INVALID_RUNOFF_TARGET`，
   路由不兑现通道，编排层 60 秒后再次提交弃权并继续空转。补「平票 → 玩家重投 → 只列并列者、
   无弃权」的用例。
2. **C-119（阻塞）· Tab→投票 e2e 不是 Tab。** `game.spec.ts:186` 用
   `voteButton.focus()`；M-R3-5 证明 `tabIndex={-1}` 仍绿。改成从发言框/页面起点按
   `Tab` 到投票按钮，再 `Enter`，并保留「投票后按钮消失」断言。
3. **C-116（阻塞）· AC-3 扫描与 AC-2 悬停/聚焦没锁。** 把 JSX 文本节点纳入
   `no-hardcoded-terms` 扫描；补八个词汇表 trigger 的 hover + focus tooltip 断言
   （或一条 `terms.spec.ts`），并让 M-R3-8 变红。
4. **C-132 / C-121 / C-123（阻塞）· live region 内容错误 + 无 App 集成测试。**
   `boardAnnouncement(view.view, 0)` 在 60 秒时播「时间到」；公告不含 role；RUNOFF 显示原始
   枚举。改成不含倒计时（或传节流后的真实 `remaining`）的中文公告，并把 role 放进文本；
   补一个用假 `ApiClient` 渲染 `App` 的集成测试，断言 IdCard、`role="status"` 的内容与
   节流（以及删除接线会红）。
5. **C-120（阻塞，测试）· App→`/input`→超时的全链路没有锁。** M-R3-11 删掉
   `onDraft={syncDraft}` 仍 43/43 绿。补 App 集成测试（假 `ApiClient` 断言 `draft()` 被调用）
   与服务端/可控制时钟的「超时后草稿文本进入 `SPEECH`」用例。

**Improvement Suggestions（非阻塞）**

1. `VoteInput` 只在「玩家是当前投票者、存活、未投票」时显示；用 `legalTargets` 而不是
   `aliveSeats`，并把「重投不可弃权」写进组件条件。
2. 去掉 `as never`：`VOTE.target` 用 `'abstain' | SeatId`，让编译器校验。
3. 草稿同步加 200–300ms debounce；`ApiClient.draft` 检查 `response.ok`，失败进 `app__error`。
4. 把 `boardAnnouncement` 的阶段文案统一走中文映射（`DAY_VOTE_RUNOFF` → 「重投」），
   `StatusBar` 同样处理；关闭 C-128。
5. IdCard 的技能/目标/剩余改为 shared 层的一份数据，客户端与服务端 `buildIdCard` 共用。
6. 给 `.idcard__goal` / `.idcard__skills` / `.idcard__remaining` 补上 `.idcard__facts`
   同款样式。
7. 把 `pnpm build` 放进 `scripts/test-e2e.mjs`，或本地也 `reuseExistingServer: false`，
   消除 M-R3-15 的旧 bundle 旁路。
8. 回填 `TEST-STRATEGY.md:332-345` 的 `Exists?` 与实际文件；修正 RFC §8.8 的「Tab」、
   §8.6 的投票归属；同步 README 状态行。
9. 修焦点 e2e：当前 Tab #1 落在 `.feed__list`，测的是 Chrome UA 的默认 outline；
   应聚焦 textarea/button 并断言应用自己的 3px `--accent`（Round 2 已记，未在本轮八项内）。

---

### 7. 探针恢复与最终门禁

探针前备份的 8 个文件与恢复后的 SHA-256（`git diff --exit-code` 为空）：

```text
b4db721a83d1b056b375bc0bc574585337d33aa8515ebf6dc4d4bb463798b9ca  src/server/orchestrator.ts
415d1de2d14da496b2fdec9fe471f712505c5dc6b1cf5fc12ba06a193f527983  src/client/App.tsx
10df1394944a0568dc4fff602563ff595f665fb5caf924b92fadafd1c4a758ac  src/client/components/VoteInput.tsx
1b1feb0e82013281424207b4ba7bb1467cedd4009daa3143dd3b622868920922  src/client/components/StatusBar.tsx
9b27d20cc94937a98afb0bfc1e5cca4b9701f7eec3326f811a12fd5aa61a40b1  src/client/components/SpeechInput.tsx
eb1dbebadd2590475993d8667c53ea9fc6c30a4ae8b6590dfac6d174f42b0d62  src/client/game-state.ts
801f88ca459eaea1545c835448579bd300a84120cb2e471881a188f60e634786  src/client/styles/global.css
d3dabdfe6aa2b990ed6e5641b3bb1aa68773e2f9eef5dc092b054280f6039c74  src/client/components/TermHint.tsx
01b6fdeb554cffd46351eecc9fa37f2f7747f213f572170136cfb404915e2acc  src/client/components/IdCard.tsx
```

`IdCard.tsx` 的探针在修改前漏做文件备份，已按原文逐字回填并用 `git diff --exit-code`
验证与 HEAD 一致（**未使用 `git checkout` / `git restore`**）；其余 8 个文件均从
`/tmp/howl-rfc012-r3-probes/backup/` 恢复。临时探针测试已删除；仓库内无残留；
`git status --porcelain` 为空；没有 `git commit`。

最终（恢复后）重跑：

```text
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 79 files / 678 tests 全绿
$ pnpm test:e2e → 8 passed
```

**状态**：RFC-012 → **`Changes requested`**。

## Round 4 -- 2026-11-19

> 评审方式：全新上下文 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 被评审提交：`0ce8b84 fix(rfc-012): 重投目标、默认 pending 与整页集成锁（Round 3）`。
> 评审开始时 HEAD `0ce8b84`，工作树 clean。结论：**Changes requested**。
>
> 本轮按用户点名的六组复核：C-127（重投 `VoteInput` + 用例）、投影默认 `pending`、
> C-119（真 Tab）、C-116（JSX 扫描 + 悬停/聚焦）、C-132（读屏公告 + `phaseLabel`）、
> C-121/C-123（整页集成测试）、C-120（草稿接线）。已关闭项（C-118 几何、C-122 的
> `gameId`、C-130 自动 build 等）不重查；但「修复引入的新回归」在本次复核范围内。
>
> **产品类型**：`PRD.md` §Product Type 为 **game（主）+ web app（交付形态）**。
> 本轮按该类型只做「对局 UI / 无障碍 / 真浏览器」相关检查；平台认证、帧预算、手柄、
> 账号、SEO、离线同步等显式跳过（见 `PRD.md` §Product Type 的不适用检查表），不另列
> N/A 行。

---

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `0ce8b84` · 评审开始时工作树 clean。

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
 Test Files  80 passed (80)
      Tests  684 passed (684)
    Duration  32.96s
TEST_EXIT=0

$ pnpm test:e2e
Running 8 tests using 1 worker
  ✓  1 tests/e2e/game.spec.ts:12:3 › 整局界面 › 主路径：能开一局、看到状态条与席位、发言区可达 (352ms)
  ✓  2 tests/e2e/game.spec.ts:22:3 › 整局界面 › 360px 视口没有横向滚动 (292ms)
  ✓  3 tests/e2e/game.spec.ts:35:3 › 整局界面 › 1024px 视口用桌面布局（席位在侧栏） (310ms)
  ✓  4 tests/e2e/game.spec.ts:49:3 › 整局界面 › 手机视口下输入区不遮挡状态条 (365ms)
  ✓  5 tests/e2e/game.spec.ts:113:3 › 整局界面 › 焦点可见：Tab 之后焦点元素有可见 outline (253ms)
  ✓  6 tests/e2e/game.spec.ts:131:3 › 整局界面 › 对比度：正文与次要文字达到 AA (248ms)
  ✓  7 tests/e2e/game.spec.ts:172:3 › 整局界面 › 键盘：Tab 能到投票按钮，Enter 能投票 (338ms)
  ✓  8 tests/e2e/game.spec.ts:199:3 › 整局界面 › 键盘：Tab 能到发言区，Enter 能提交 (310ms)
  8 passed (5.1s)
E2E_EXIT=0
```

绿色不是结论。下面用定向变异逐项验证「用户声称已锁住的行为」是否真的会红；探针全部从
`/tmp/howl-rfc012-r4-probes/backup/` 的文件备份恢复（**未使用 `git checkout` / `git restore`**），
恢复后 `git status --porcelain` 为空；最终重跑门禁仍为 **80 files / 684 tests**、**8/8 e2e**。

---

### 1. 六组复核结论（先看这张表）

| 用户项 | 本轮结论 | 一句话证据 |
|---|---|---|
| **C-127** UI 选项集与用例 | **Closed（UI 层）** | 把 `App` 改回 `aliveSeats` → app.test **1 failed**（`投 3 号`）；`allowAbstain={true}` → app.test **1 failed**（`弃权`） |
| **投影默认 `pending`** | **行为可用，但引入 C-133（阻塞）** | 删掉路由默认值 → e2e 投票用例 **1 failed**（25s 等不到按钮）；非预言家在 `NIGHT_SEER` 拿到 `pending:'check'`（P-R4-1） |
| **C-119** 真 Tab | **Closed** | 给 `VoteInput` 按钮加 `tabIndex={-1}` → e2e **1 failed**（`Tab 到不了投票按钮`） |
| **C-116** JSX 扫描 + 悬停/聚焦 | **Closed** | `<span>放逐</span>` → 扫描 **1 failed**；删 `onMouseEnter` / `onFocus` → components **1 failed** |
| **C-132** 读屏公告 + `phaseLabel` | **Closed（核心）**；role 为残留 | 公告追加「时间到」→ app.test **1 failed**；RUNOFF 返回原始枚举 → app.test + game-state **2 failed** |
| **C-121/C-123** 整页集成测试 | **Closed（App 挂载锁）** | 删 `<IdCard>` → app.test **3 failed**；删 `role="status"` 区 → **2 failed**；删 `onDraft` → **1 failed** |
| **C-120** 草稿链路 | **App 接线 Closed；服务端全链路仍 Open（阻塞，测试）** | 删 `App` 的 `onDraft` → app.test **1 failed**；删路由的 `channels.setDraft` → server **233/233 仍绿** |
| **C-127** 重投来源与服务端分支 | **Open（阻塞，测试）** | `targets.ts` 回退成全部存活 → server/engine **518/518** + app **4/4 仍绿**；`playerPhase` 删 RUNOFF → server **233/233 仍绿** |
| **C-133（新）** 夜间 `pending` 泄漏 | **Open（阻塞，安全）** | 非预言家、引擎 `NIGHT_SEER`、投影 `phase:'NIGHT'`，GET 却返回 `pending:'check'`、`legalTargets:[1,2,3,4,5,6,8,9]` |

---

### 2. 逐项证据

#### 2.1 C-127：`VoteInput` 真的只吃 `ctx.legalTargets`，且选项集有用例

`src/client/App.tsx:150-158` 已改为：

```tsx
{ctx.phase === 'DAY_VOTE' || ctx.phase === 'DAY_VOTE_RUNOFF' ? (
  <VoteInput
    targets={ctx.legalTargets
      .filter((target) => typeof target === 'number' && target !== ctx.self.seat)
      .map((target) => Number(target))}
    allowAbstain={ctx.phase === 'DAY_VOTE'}
    onVote={vote}
  />
) : null}
```

`src/client/components/VoteInput.tsx:20-33` 只在 `allowAbstain` 为真时渲染「弃权」。
`tests/client/app.test.tsx:86-96` 用 `phase:'DAY_VOTE_RUNOFF'`、`legalTargets:[2]` 渲染
`App`，断言「投 2 号」存在、「投 3 号」与「弃权」不存在。

反向探针（**M-R4-1**）：把 `App` 的 `targets` 换回 `ctx.aliveSeats.filter(...)`：

```text
$ pnpm exec vitest run --project client tests/client/app.test.tsx
→ 1 failed / 3 passed
  expected <button>投 3 号</button> to be null
  tests/client/app.test.tsx:93
```

反向探针（**M-R4-2**）：把 `allowAbstain={ctx.phase === 'DAY_VOTE'}` 改成 `true`：

```text
→ 1 failed / 3 passed
  expected <button>弃权</button> to be null
  tests/client/app.test.tsx:94
```

界面层修复成立。**但「只有并列者」这个事实并不只由 `VoteInput` 决定**：`App` 拿的是
`ctx.legalTargets`，而 `legalTargets` 由 `src/server/project/targets.ts:28-29` 计算。
`tests/client/app.test.tsx` 自己伪造了 `legalTargets:[2]`，所以它锁的是「组件如何使用
`legalTargets`」，不是「投影在 RUNOFF 只给并列者」。见 §2.3。

#### 2.2 投影默认 `pending`：功能成立，但在夜间泄漏了精确子阶段（新 C-133）

`src/server/routes/games.ts:90-103`：

```ts
const pendingParsed = PendingQuerySchema.safeParse(request.query);
...
const pending = (pendingParsed.data.pending ??
  pendingForPhase(state.phase)) as PendingDecision | null;
const view: ProjectedContext = project({
  state,
  events: record.events,
  observer: record.playerSeat,
  pending,
});
```

**正向**：删掉默认值（改回 `?? null`）后，`pnpm exec playwright test -g "键盘：Tab 能到投票按钮"`
在 25 秒内等不到任何「投 N 号」按钮，**1 failed**（`game.spec.ts:185`）。说明投票按钮
确实依赖这个默认值，e2e 也覆盖了该依赖。

**但 `pendingForPhase` 是「阶段 → 决策类型」的全局映射，不区分观察者是不是当前行动者。**
`project()` 的 `phase` 会把夜间折叠成 `NIGHT`（`src/server/project/index.ts:104`），
正是为了避免 `NIGHT_SEER` / `NIGHT_WITCH` / `NIGHT_HUNTER_SHOOT` 泄漏角色存活状态
（RFC-007 §8.5 的 C-28）；而 `pending` 原样返回，绕过了这层折叠。

临时探针（**P-R4-1**，已删除）用真实 `buildApp` + 真实 `GET /api/games/:id`，把一局推进到
`NIGHT_SEER`，玩家是 7 号村民：

```text
enginePhase=NIGHT_SEER
observer=7
observerRole=villager
projectedPhase=NIGHT
pending=check
legalTargets=[1,2,3,4,5,6,8,9]
```

即：一个不是预言家的玩家，在看投影时就能知道「现在是预言家阶段」——等价于知道预言家
还活着并且在行动；夜里刀到猎人时，`pending:'shoot'` 更直接暴露猎人当夜被刀。这正是
`ProjectedPhase` 折叠与 RFC-007 C-28 要防的信息，也违反 `PRD.md` FR-11「玩家只能看到
自己的身份与自己角色的技能结果」的边界。

**这是本轮修复引入的新回归（C-133，阻塞）。** 推荐修法：路由只在「观察者就是当前行动者」
时传 `pendingForPhase`（`seatToSpeak(state) ?? nextActor(state) === record.playerSeat`），
否则传 `null`；同时补一条真实路由用例：非预言家观察者在 `NIGHT_SEER` 的 GET 中
`pending === null`、`legalTargets` 不给出任何角色阶段信息。注意 `App` 的 `VoteInput`
也要改成按 `ctx.pending`/目标为空时不渲染，否则轮到自己之前会只剩一个空「投票」标题。

#### 2.3 C-127 的来源与服务端分支：界面用例没有锁住真正的规则

**（a）投影来源。** 把 `src/server/project/targets.ts:28-29` 的 RUNOFF 分支回退成：

```ts
return [...alive, 'abstain'];
```

也就是把 Round 3 的原始缺陷重新放回去（重投列出全部存活席位 + 弃权）。实测：

```text
$ pnpm exec vitest run --project unit tests/server tests/engine
→ 56 files / 518 tests 全绿

$ pnpm exec vitest run --project client tests/client/app.test.tsx
→ 4/4 全绿
```

`tests/client/app.test.tsx` 的 `legalTargets:[2]` 是手写的，所以 `targets.ts` 回归不会
影响它；`tests/server/project/night-visibility.test.ts:142-150` 只测了 `DAY_VOTE` 的
「存活 + 弃权」，没有测 `DAY_VOTE_RUNOFF` 的「只有并列者、没有弃权」。
**Round 3 的 C-127 缺陷在来源层仍然可以原样回归而全量绿。**

**（b）服务端玩家分支。** 把 `src/server/orchestrator.ts:184-188` 的 `playerPhase`
删掉 `DAY_VOTE_RUNOFF`：

```ts
const playerPhase = state.phase === 'DAY_SPEECH' || state.phase === 'DAY_VOTE';
```

实测：

```text
$ pnpm exec vitest run --project unit tests/server
→ 26 files / 233 tests 全绿
```

`tests/server/game-loop.test.ts` 只有整局与 C-122 多局用例，没有「平票 → 重投 → 玩家输入
被消费」的用例；`tests/client/app.test.tsx` 渲染的是假投影，不经过 `runGame`。
Round 3 的 M-R3-2（删 RUNOFF 仍绿）在本轮原样复现。

**结论：** C-127 的界面选项集已修，但「重投规则从投影到玩家输入」的回归锁仍缺两块：
`targets.ts` 的 RUNOFF 分支、`playerPhase` 的 RUNOFF 分支。二者都属于 Round 3 明确要求
的「平票 → 重投」用例，**阻塞（测试）**。

#### 2.4 C-119 / AC-11：e2e 这次是真的按 Tab

`tests/e2e/game.spec.ts:172-197` 已经从 `.focus()` 改为：

```ts
let reached = false;
for (let hop = 0; hop < 40 && !reached; hop += 1) {
  await page.keyboard.press('Tab');
  reached = await voteButton.evaluate((element) => element === document.activeElement);
}
expect(reached, 'Tab 到不了投票按钮').toBe(true);
await page.keyboard.press('Enter');
```

反向探针（**M-R4-3**）：给 `VoteInput` 的每个按钮加 `tabIndex={-1}`：

```text
$ E2E_PORT=4190 pnpm exec playwright test -g "键盘：Tab 能到投票按钮"
→ 1 failed
  Error: Tab 到不了投票按钮
  tests/e2e/game.spec.ts:192
```

`.focus()` 的假绿已消失。**C-119 的 Tab 子项 Closed。**

#### 2.5 C-116：JSX 文本扫描与悬停/聚焦都有牙

`tests/security/no-hardcoded-terms.test.ts:63-72` 现在同时匹配字符串字面量与 JSX 文本：

```ts
const literal = new RegExp(`['"\`]\\s*${label}\\s*['"\`]`);
const jsxText = new RegExp(`>\\s*${label}\\s*<`);
if (literal.test(file.source) || jsxText.test(file.source)) {
  offenders.push(`${file.relativePath}: ${label}`);
}
```

反向探针（**M-R4-4**）：在 `StatusBar.tsx` 加 `<span>放逐</span>`：

```text
$ pnpm exec vitest run --project unit tests/security/no-hardcoded-terms.test.ts
→ 1 failed / 2 passed
  [ "components/StatusBar.tsx: 放逐" ] not to equal []
```

`tests/client/components.test.tsx:217-233` 新增了词汇表的 hover → 移开 → focus：

```ts
await user.hover(trigger);
...
await user.unhover(trigger);
...
trigger.focus();
```

反向探针（**M-R4-5**）：删掉 `TermHint.tsx` 的 `onMouseEnter` 与 `onFocus`：

```text
$ pnpm exec vitest run --project client tests/client/components.test.tsx
→ 1 failed / 13 passed
  Unable to find role="tooltip"
  tests/client/components.test.tsx:225
```

**C-116 的 JSX 扫描与悬停/聚焦子项 Closed。**

#### 2.6 C-132：倒计时与 RUNOFF 枚举修好了；role 仍不在公告里

`src/client/game-state.ts:96-119` 新增 `phaseLabel`，`boardAnnouncement` 不再接收
`remaining`，也不再拼倒计时：

```ts
case 'DAY_VOTE_RUNOFF':
  return '平票重投';
...
return `你是 ${ctx.self.seat} 号，第 ${ctx.day} 天，${phaseLabel(ctx.phase)}${
  speaking === null ? '' : `，轮到 ${speaking} 号发言`
}。`;
```

反向探针（**M-R4-6**）：给公告末尾加「时间到」：

```text
$ pnpm exec vitest run --project client tests/client/app.test.tsx
→ 1 failed / 3 passed
  expected '…轮到 1 号发言，时间到。' not to contain '时间到'
  tests/client/app.test.tsx:74
```

反向探针（**M-R4-7**）：把 `DAY_VOTE_RUNOFF` 改回返回原始 `phase`：

```text
$ pnpm exec vitest run --project client tests/client/app.test.tsx tests/client/game-state.test.ts
→ 2 failed / 12 passed
  expected '…DAY_VOTE_RUNOFF。' to contain '平票重投'
  tests/client/game-state.test.ts:117
```

**C-132 的核心（不再伪造倒计时、RUNOFF 中文化）Closed。**
残留：Round 3 的阻塞项还要求「把 role 写进公告」，当前公告仍只有「你是 1 号」（席位），
没有「村民 / 预言家」。身份现在由 `IdCard`（`aria-label="你的身份"` + `ROLE_LABELS`）
承载，`tests/client/components.test.tsx:186-214` 对女巫断言了技能/目标/剩余，因此按
AC-15 的字面「屏幕阅读器可读出身份、阶段、轮到谁」可以由「IdCard + status」组合满足；
**本轮不把它单列为阻塞**，但建议下一轮把 role 补进公告，或在 §8.9 明确记录这个取舍。

#### 2.7 C-121 / C-123：整页集成测试真的锁住了挂载点

`tests/client/app.test.tsx:64-84` 用假 `ApiClient` 渲染整页，断言：

- `屏幕阅读器` 区存在，文本含「你是 1 号」「第 2 天」，且不含「时间到」；
- RUNOFF 时显示「平票重投」；
- `IdCard` 的「你的身份」标题存在。

`tests/client/app.test.tsx:98-111` 断言输入后 `client.draft` 收到「我怀疑 2 号。」。

反向探针：

| 探针 | 注入 | 结果 |
|---|---|---|
| **M-R4-8** | 删 `App.tsx:138` 的 `<IdCard>` | app.test **3 failed / 1 passed**（`findByRole('heading','你的身份')` 等） |
| **M-R4-9** | 删 `App.tsx:143-145` 整个 `role="status"` 区 | app.test **2 failed / 2 passed**（`getByRole('status')`） |
| **M-R4-10** | 删 `SpeechInput` 的 `onDraft={syncDraft}` | app.test **1 failed / 3 passed**（`client.draft` 未调用） |
| **M-R4-7** | `phaseLabel` RUNOFF 回退 | app.test + game-state **2 failed** |

删掉任一处都会红，Round 3 的 M-R3-11 / M-R3-13 已不复现。**C-121/C-123 的 App 挂载锁
Closed。** 但测试名有漂移：`describe('AC-13 · 重投只列并列者')` 中 AC-13 实际是
WCAG 对比度；`describe('AC-11 · 草稿同步真的接上')` 中 AC-11 实际是键盘。建议改成
「F24 / RUL-2」或「UI-4」，避免下一轮按 AC 编号找证据时误判（非阻塞）。

#### 2.8 C-120：App → `/input` 的客户端一半有锁，服务端全链路仍没有

`App.tsx:52-58` 的 `syncDraft` 调用 `client.draft(gameId, text)`，`tests/client/app.test.tsx:98-111`
删掉 `onDraft` 会红（M-R4-10）。这一半成立。

但 `src/server/routes/games.ts:145` 的 `channels.setDraft(record.gameId, text)` 没有任何
端到端用例：现有 `tests/server/channels.test.ts:309-318` 只测 `HttpInputChannel` 自身的
「有草稿 → timeout 文本」；`tests/server/orchestrator.test.ts:345-435` 用**假 input** 测
「timeout 文本 → `SPEECH`」；没有一条用例从 `POST /input` 写入草稿、再让 `runGame` 在
60 秒超时后消费它。反向探针（**M-R4-14**）：删掉 `channels.setDraft(...)`：

```text
$ pnpm exec vitest run --project unit tests/server
→ 26 files / 233 tests 全绿
```

也就是说，路由把草稿静默丢弃，客户端测试（只到 `client.draft` 被调用）与服务端测试
都不会红；Round 3 的 M-R3-11 只是从「App 接线」升级成了「ApiClient 被调用」，没有覆盖
`/input → 通道 → 超时 → SPEECH` 的完整链路。**C-120 仍 Open（阻塞，测试）。**

#### 2.9 非阻塞：文档与测试计划漂移

- `TEST-STRATEGY.md:332-345` 的 RFC-012 计划仍全部 `proposed`，六个 e2e 文件名
  （`terms.spec.ts` / `onboarding.spec.ts` / `order.spec.ts` / `responsive.spec.ts` /
  `keyboard.spec.ts` / `a11y.spec.ts`）仍不存在；实际覆盖被合并进 `game.spec.ts` 与
  client tests。按 `TEST-1` 建议回填 `Exists?` 或记录等价覆盖。
- `README.md:12` 仍写「7 个 Reviewed、0 个 Changes requested、8 个 Not started」，
  与 `RFCS.md` 状态表不一致；本轮把 RFC-012 设为 `Changes requested` 后更明显。
- `app.test.tsx` 的 AC 编号漂移见 §2.7；`phaseLabel` 上方重复了一行 doc comment
  （`game-state.ts:94-95`），不影响行为。
- `reuseExistingServer: !CI` 的旧 bundle 旁路（Round 3 的非阻塞项）仍在；`ApiClient.draft`
  仍不检查 `response.ok`、草稿仍无防抖（Round 2 的非阻塞项）。这些不在本轮六项内，未重查。

---

### 3. 变异探针汇总

| 探针 | 注入的改动 | 定向命令 | 结果 | 证明 |
|---|---|---|---|---|
| **M-R4-1** | `App` 的 `VoteInput` 改回 `ctx.aliveSeats.filter(...)` | `vitest --project client app.test.tsx` | **1 failed / 3 passed**（`:93`） | RUNOFF 选项集有牙 |
| **M-R4-2** | `allowAbstain={true}` | 同上 | **1 failed / 3 passed**（`:94`） | RUNOFF 不弃权有牙 |
| **M-R4-3** | `VoteInput` 按钮 `tabIndex={-1}` | `playwright -g "键盘：Tab 能到投票按钮"` | **1 failed**（`:192`） | C-119 真 Tab 有牙 |
| **M-R4-4** | `StatusBar` 加 `<span>放逐</span>` | `vitest --project unit no-hardcoded-terms` | **1 failed / 2 passed** | JSX 扫描有牙 |
| **M-R4-5** | `TermHint` 删 `onMouseEnter` / `onFocus` | `vitest --project client components.test.tsx` | **1 failed / 13 passed** | 悬停/聚焦有牙 |
| **M-R4-6** | 公告末尾加「时间到」 | `vitest --project client app.test.tsx` | **1 failed / 3 passed**（`:74`） | 读屏无倒计时有牙 |
| **M-R4-7** | `phaseLabel` 的 RUNOFF 回退成原始枚举 | `vitest --project client app.test.tsx game-state.test.ts` | **2 failed / 12 passed** | RUNOFF 中文化有牙 |
| **M-R4-8** | 删 `App` 的 `<IdCard>` | `vitest --project client app.test.tsx` | **3 failed / 1 passed** | IdCard 挂载有牙 |
| **M-R4-9** | 删 `role="status"` 区 | 同上 | **2 failed / 2 passed** | 读屏区挂载有牙 |
| **M-R4-10** | 删 `onDraft={syncDraft}` | 同上 | **1 failed / 3 passed**（`:110`） | 草稿 App 接线有牙 |
| **M-R4-11** | 路由删掉 `pendingForPhase` 默认 | `playwright -g "键盘：Tab 能到投票按钮"` | **1 failed**（25s 无按钮，`:185`） | 默认 pending 是必要的 |
| **M-R4-12** | `targets.ts` RUNOFF 回退为 `[...alive,'abstain']` | `vitest --project unit tests/server tests/engine` + client app | **518/518 + 4/4 全绿** | 重投来源无锁 |
| **M-R4-13** | `playerPhase` 删 `DAY_VOTE_RUNOFF` | `vitest --project unit tests/server` | **233/233 全绿** | 服务端重投分支无锁 |
| **M-R4-14** | 路由删 `channels.setDraft(...)` | 同上 | **233/233 全绿** | 草稿服务端全链路无锁 |
| **P-R4-1** | 临时路由探针：真实 GET 到 `NIGHT_SEER` | `vitest --project unit __probe-pending-leak` | `pending='check'`；观察者是村民 | C-133 夜间泄漏 |
| **P-R4-2** | 静态：`boardAnnouncement` 只读 `ctx.self.seat`，无 role | `read game-state.ts:114-119` | 公告无身份名 | C-132 role 残留 |

所有探针改动均已恢复；临时测试已删除。恢复后的 SHA-256 见 §7。

---

### 4. 验收标准逐条（Round 4）

| AC | 判定 | 一手证据 |
|---|---|---|
| 1 三块区域、阶段与天数 | **PASS（沿用前轮）** | e2e 主路径；本轮未改布局 |
| 2 8 个术语悬停/聚焦 | **PASS** | `components.test.tsx:217-233` + M-R4-5 |
| 3 术语来自 `terms.ts`、扫描 client | **PASS** | `no-hardcoded-terms.test.ts:63-72` + M-R4-4 |
| 4 发言提示不代填 | **PASS（沿用）** | `a11y.test.tsx`，本轮未重查 |
| 5 引导可关闭、刷新不再出现 | **PASS（实现，沿用）** | `components.test.tsx`；仍无真刷新 e2e（非阻塞） |
| 6 三项发言状态 | **PASS（沿用）** | `game-state.test.ts`，本轮未重查 |
| 7 当前发言者由事件流推导 | **PASS（沿用）** | 同上 |
| 8 360px 无横向滚动 | **PASS（沿用）** | e2e |
| 9 ≥1024px 桌面布局 | **PASS（沿用）** | e2e |
| 10 输入不遮挡 | **PASS（沿用）** | 本轮未改 |
| 11 纯键盘「发言 → 投票」 | **PASS（本轮真 Tab）**；重投服务端覆盖另见 C-127 | M-R4-3 红；e2e 8/8 |
| 12 焦点可见 | **PASS（沿用）** | `a11y.test.tsx` + e2e |
| 13 对比度 AA | **PASS（沿用）** | e2e 与 `a11y.test.tsx` |
| 14 倒计时/阵营/存活有文字 | **PARTIAL（沿用 Round 3）** | 倒计时/存活有；阵营仍无显式文字；不在本轮六项内 |
| 15 读屏身份/阶段/轮到谁 | **PASS（按 AC 字面）**；role 不在公告，见 §2.6 | App 集成 + IdCard 组件 + M-R4-6/7/8/9 |
| 15（整局入口） | **PARTIAL（沿用 Round 3）** | 玩家夜间动作仍由 `decide` 代打；本轮未重查 |
| 16 不双写 | **PASS（沿用）** | 本轮未改路由/编排写入路径 |

`TEST-STRATEGY.md:332-345` 的 Exists 仍未回填，见 §2.9（非阻塞，但 `TEST-1` 要求）。

---

### 5. 五个维度

#### 5.1 RFC ADHERENCE — **NEEDS WORK**

- **已成立**：C-127 的 UI 选项集（M-R4-1/2）、C-119 的真 Tab（M-R4-3）、C-116 的
  JSX 扫描与悬停/聚焦（M-R4-4/5）、C-132 的无倒计时与 RUNOFF 中文化（M-R4-6/7）、
  C-121/C-123 的 App 集成（M-R4-8/9/10）、C-120 的 App 草稿接线（M-R4-10）、
  默认 pending 的功能必要性（M-R4-11）。
- **未成立 / 未锁**：C-127 的 `targets.ts` 来源与 `playerPhase` 服务端分支（M-R4-12/13）；
  C-120 的 `/input → 通道 → 超时 → SPEECH` 全链路（M-R4-14）；C-132 的 role 进公告。
- **新回归**：C-133 夜间 `pending` 泄漏（P-R4-1）。
- **未重查**：C-128 的 `FINISHED` 原始枚举、C-122 的玩家夜间动作、焦点 e2e 的 UA outline
  （沿用 Round 3，非本轮六项）。

#### 5.2 RULES COMPLIANCE — **NEEDS WORK**

- **UI-1 / SEC-5**：字面通过——`IdCard`、`VoteInput`、`Feed` 都消费 `project()` 的输出，
  没有直接序列化 `GameState`。但 `pending` 的默认值把隐藏阶段传回客户端，违反
  `PRD.md` FR-11 的信息边界与 RFC-007 C-28 的「夜里只告诉观察者天黑了」。
- **UI-2**：通过。`TERMS` / `ROLE_LABELS` 单一来源；`phaseLabel` 把 RUNOFF 中文化；
  `StatusBar` 也改用 `phaseLabel`。
- **UI-3**：通过（未改流式渲染）。
- **UI-4**：实现上客户端已调用 `/input`，但 `RULES TEST-1` 要求的端到端回归锁仍缺
  （M-R4-14）；`ApiClient.draft` 不检查 `response.ok`（非阻塞旧项）。
- **A11Y-1**：通过（真 Tab e2e）。
- **A11Y-2**：通过（沿用）。
- **A11Y-3**：部分——倒计时/存活有文字；阵营仍无；公告不含 role（但 IdCard 有）。
- **A11Y-4**：通过（语义标签未改）。
- **TEST-1 / TEST-6**：**不通过**。C-127 的来源/服务端分支、C-120 的全链路缺测试；
  `TEST-STRATEGY.md` 的 RFC-012 小节仍全部 `proposed`。
- **DOC-1**：**不通过**。RFC §8.9 把「RUNOFF 用例」写成已完成，但它只覆盖 UI 组件；
  `TEST-STRATEGY` 与 README 状态行仍漂移；`app.test.tsx` 的 AC 编号错位。

#### 5.3 SECURITY — **FAIL**

- **C-133（新）**：`GET /api/games/:id` 在夜间把 `pendingForPhase(state.phase)` 原样
  返回给任意观察者。真实探针：村民观察者在 `NIGHT_SEER` 拿到 `pending:'check'`；
  当夜刀到猎人时会拿到 `pending:'shoot'`。这泄漏「预言家/女巫/猎人是否活着、是否正在
  行动」，正是 RFC-007 C-28 用 `projectedPhaseOf` 折叠掉的隐藏信息。
- 非阻塞旧项：`POST /play` 无频率限制（C-126）；`?pending=` 查询仍可被任意客户端指定
  （它不能证明真实阶段，但建议与 actor 校验一起收紧）。

#### 5.4 PERFORMANCE — **PASS（本轮）**

- 公告从每秒更新改为 key 变化时更新，写 live region 的次数没有增加。
- 默认 `pending` 在路由里多一次 `pendingForPhase` 与投影计算，可忽略；投影仍是每秒全量，
  这是 C-126 的旧问题，不在本轮六项内。

#### 5.5 MAINTAINABILITY — **NEEDS WORK**

- **测试名/AC 编号错位**：`app.test.tsx` 把重投用例标成 AC-13（实际对比度）、把草稿标成
  AC-11（实际键盘）；下一轮按 AC 编号找证据会误判。
- **测试只到接线层**：App 集成证明 `client.draft` 被调用，但服务端 `channels.setDraft`
  删除仍全绿；`VoteInput` 的 `legalTargets` 由 fake 提供，`targets.ts` 回退仍全绿。
- **`App` 的 `vote` 仍有 `as never`**：`VOTE.target` 本可表达 `'abstain' | SeatId`，
  类型检查没有覆盖这个分支（Round 2 的非阻塞建议）。
- **文档漂移**：`TEST-STRATEGY.md`、`README.md` 见 §2.9。
- **重复过滤**：`App` 再次过滤 `target !== ctx.self.seat`，而 `legalTargetsOf` 的
  `DAY_VOTE` 已排除自己；RUNOFF 分支没有排除（引擎允许投自己），客户端这层过滤会让
  「自己也是并列者」时少一个合法选项——是否允许自投需要按 RUL-2 明确（非阻塞）。

---

### 6. 结论

**Overall Risk Level: High。**

本轮六组改动里，**C-119、C-116、C-121/C-123、C-132 的核心、C-127 的 UI 层、C-120 的
App 接线都真的修好了**，并且各自的变异探针都能打红；这是相较 Round 3 的实质进步。
但仍有三处阻塞：

1. **C-133（新，安全，阻塞）**：默认 `pending` 在夜间泄漏精确子阶段。真实探针
   `enginePhase=NIGHT_SEER / observerRole=villager / projectedPhase=NIGHT / pending=check`。
   必须改成「只有当前行动者才拿到 pending」，并补非行动者/夜间路由用例。
2. **C-127（阻塞，测试）**：`targets.ts` 的 RUNOFF 分支回退后 518/518 + 4/4 仍绿；
   `playerPhase` 删 RUNOFF 后 233/233 仍绿。需要一条「平票 → 重投 → 投影只给并列者 →
   玩家输入被消费」的用例，最好同时覆盖投影与服务端分支。
3. **C-120（阻塞，测试）**：删 `channels.setDraft` 后 233/233 仍绿；需要
   `/input → 通道草稿 → 60 秒超时 → SPEECH` 的可控时钟用例。

**Blocking Issues（必须修复后才能合并）**

1. **C-133 · 夜间 pending 泄漏。** `src/server/routes/games.ts:97-98` 对所有观察者使用
   `pendingForPhase(state.phase)`，绕过 `projectedPhaseOf` 的夜间折叠；真实探针见 §2.2。
2. **C-127 · 重投来源与服务端分支无锁。** `src/server/project/targets.ts:28-29` 与
   `src/server/orchestrator.ts:184-188` 的 RUNOFF 分支回退均全量绿；补测试（§2.3）。
3. **C-120 · 草稿全链路无锁。** `src/server/routes/games.ts:145` 的 `setDraft` 删除后
   server 233/233 绿；补可控时钟的超时用例（§2.8）。

**Improvement Suggestions（非阻塞）**

1. C-132：把 role 写进 `boardAnnouncement`（或记录 §8.9 的取舍），让一条公告同时含
   「身份 + 阶段 + 轮到谁」；同时给 App 集成测试补 role 断言。
2. 修正 `app.test.tsx` 的 AC 编号（重投 → AC-11 / RUL-2；草稿 → UI-4）。
3. 回填 `TEST-STRATEGY.md:332-345` 的 `Exists?` 与实际文件；同步 `README.md:12` 的
   RFC 状态行。
4. `VoteInput` 只在「玩家是当前行动者且未投票」时渲染（用 `ctx.pending`），避免轮次
   之外出现无效按钮；若允许 RUNOFF 自投，不要在客户端再过滤 self。
5. 去掉 `App.vote` 的 `as never`，让 `VOTE.target` 的类型覆盖 `'abstain' | SeatId`。
6. `ApiClient.draft` 检查 `response.ok`，草稿同步加 200–300ms 防抖（Round 2 旧建议）。
7. 清理 `game-state.ts:94-95` 重复的 doc comment。
8. 关闭 `reuseExistingServer` 旧 bundle 旁路（Round 3 非阻塞项）。

---

### 7. 探针恢复与最终门禁

探针前备份的 8 个源码文件与恢复后的 SHA-256（`git status --porcelain` 为空，
`sha256sum -c` 全部 OK）：

```text
589af85fdfe18affa52f113b0ec2a9c04b620dcc0df5053737a45851e1748240  src/client/App.tsx
d0f77365e0d855d63758d1ca78faf616806b88c1420aab4fe3dc68ac1d6cede5  src/client/components/VoteInput.tsx
c212c6a92537628f5a6da9ba6dc003944401f489349cef8d07ac0410725a3ea2  src/client/components/StatusBar.tsx
d3dabdfe6aa2b990ed6e5641b3bb1aa68773e2f9eef5dc092b054280f6039c74  src/client/components/TermHint.tsx
0052e449c42c0da5f160c46ed675371a1f8d1f2408526bab4ab4437e60efbf96  src/client/game-state.ts
be1e7819f0267df324a8b31607a0ae3fe2e889cd44bf6d503ff4da09adbb7c41  src/server/routes/games.ts
b4db721a83d1b056b375bc0bc574585337d33aa8515ebf6dc4d4bb463798b9ca  src/server/orchestrator.ts
67a6cba74716288f9ef77216d2b1148f19cbf46682265fb6dd9e0d83b3681b5e  src/server/project/targets.ts
```

临时探针测试 `tests/server/__probe-pending-leak.test.ts` 已删除；仓库内无残留；
`git status --porcelain` 为空；没有 `git commit`。

最终（恢复后）重跑：

```text
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 80 files / 684 tests 全绿
$ pnpm test:e2e → 8 passed
```

**状态**：RFC-012 → **`Changes requested`**。

## Round 5 -- 2026-11-19

> 评审方式：全新上下文 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 被评审提交：`2b01d1e fix(rfc-012): 夜间 pending 只给行动者、RUNOFF 与草稿回归锁（Round 4）`。
> 评审开始时 HEAD `2b01d1e`，工作树 clean。结论：**Changes requested**。
>
> 本轮按用户指示只复核 Round 4 的三个阻塞项：**C-133（安全）**、**C-127（投影 + 服务端重投分支）**、
> **C-120（草稿全链路）**。已关闭项（C-116 / C-118 / C-119 / C-121·C-123 / C-132 等）不重查；
> RFC-011 侧不重查；C-128 / C-129 / C-131 等非阻塞旧项沿用前轮记录。
>
> **产品类型**：`PRD.md` §Product Type 为 **game（主）+ web app（交付形态）**，沿用 Round 1 ~ 4 的
> 检查口径；平台认证、帧预算、手柄、账号、SEO、离线同步等显式跳过，不另列 N/A 行。

---

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `2b01d1e` · 评审开始时工作树 clean。

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
 Test Files  80 passed (80)
      Tests  688 passed (688)
    Duration  31.47s
TEST_EXIT=0

$ pnpm test:e2e
Running 8 tests using 1 worker
  8 passed (5.2s)
E2E_EXIT=0
```

绿色不是结论。本轮用定向变异验证「Round 4 声称已锁住的行为」是否真的会红；探针全部从
`/tmp/howl-rfc012-r5-probes/backup/` 的文件备份恢复（**未使用 `git checkout` / `git restore`**），
恢复后 4 个文件 SHA-256 与探针前一致、`git status --porcelain` 为空；临时探针测试已删除；
最终重跑 **80 files / 688 tests**、**8/8 e2e** 全绿；没有 `git commit`。

> 附带核对：RFC §8.10 写「81 files / 688 tests」，实跑为 **80 files / 688 tests**（本轮新增的
> 用例都加在已有文件里，文件数不变）。这是文档数字漂移，非阻塞，但 `DOC-1` 要求改回 80。

---

### 1. 三项结论（先看这张表）

| 用户点名项 | 本轮结论 | 一句话证据 |
|---|---|---|
| **C-133** 夜间默认 `pending` 只给行动者 | **Closed（行为与回归锁）**；测试有非阻塞弱点 | 真实路由 `NIGHT_SEER` / 村民观察者 → `pending:null`、`legalTargets:[]`（P-R5-2）；回退成「所有人 pending」→ C-133 用例 **1 failed**（P-R5-1） |
| **C-127** 重投投影层 | **Open（阻塞，测试）** | 回退成 `[...alive,'abstain']` → 新用例 **1 failed**；回退成 `[...alive]`（**不含并列者过滤、也不含弃权**）→ 新用例仍 **1 passed**（M-R5-6）——「只含并列者」没有被锁住 |
| **C-127** 重投服务端玩家分支 | **Open（阻塞，测试）** | 删掉 `runGame` 里**活的** `DAY_VOTE_RUNOFF` 分支 → 27 files / **240 tests 全绿**、server+client **32/289 全绿**（M-R5-3）；`isPlayerPhase` 单测只锁住一个 `src/` 里**没有调用者**的 helper（M-R5-4） |
| **C-120** 草稿全链路 | **Closed** | 删路由 `channels.setDraft` → 新用例 **1 failed**（`{kind:'skip'}`，M-R5-5）；8 次重复运行 8/8 绿 |

**总判断**：三项里 **C-133 与 C-120 可以关闭**；**C-127 仍未修完**——不是行为坏了，而是 Round 4
要求的两把回归锁一把是「弱锁」（投影用例）、一把是「假锁」（只锁了死代码）。按 `AGENTS.md`
硬规则 3 / RULES `TEST-1`，这仍是阻塞。

---

### 2. 逐项证据

#### 2.1 C-133：安全行为确实修好了，回归锁也真的会红

**实现**（`src/server/routes/games.ts:94-101`）：

```ts
const actor = nextActor(state);
const defaultPending = actor === record.playerSeat ? pendingForPhase(state.phase) : null;
const pending = (pendingParsed.data.pending ?? defaultPending) as PendingDecision | null;
```

**正向**：临时探针 **P-R5-2** 用真实 `buildApp` + 真实 `GET /api/games/:id`，把一局推进到
`NIGHT_SEER`，玩家 3 号是村民：

```text
PROBE-C133-PLAYER {"playerSeat":3,"role":"villager"}
PROBE-C133-ENGINE-PHASE NIGHT_SEER
PROBE-C133-VIEW {"enginePhase":"NIGHT_SEER","projectedPhase":"NIGHT","pending":null,
                 "legalTargets":[],"observer":3,"observerRole":"villager"}
```

这正是 Round 4 的 P-R4-1 场景，泄漏已消失。

**回归锁**（M-R5-1）：把路由改回 `defaultPending = pendingForPhase(state.phase)`：

```text
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts -t "C-133"
→ 1 failed / 8 skipped
  AssertionError: expected [ 2, 3, 4, 5, 6, 7, 8, 9 ] to deeply equal []
  tests/server/strengthen.test.ts:342
```

同一变异下 P-R5-2 复现了 Round 4 的泄漏：

```text
PROBE-C133-VIEW {"enginePhase":"NIGHT_SEER","projectedPhase":"NIGHT","pending":"check",
                 "legalTargets":[1,2,4,5,6,7,8,9],"observer":3,"observerRole":"villager"}
```

**用户声明成立：「回退会给所有人 pending，探针会红」。** 行为与锁都通过。

**非阻塞弱点**（建议下一轮修，不改变本轮结论）：

1. **用例名说「不带 pending」，但一行 `pending` 断言都没有**。`tests/server/strengthen.test.ts:299-344`
   只断言 `legalTargets`，而且包在 `if (body.view.phase === 'NIGHT')` 里（`:341`）。现有夹具
   （seed 15 / playerSeat 1）落点是 `NIGHT_WOLVES`、玩家是**女巫**（P-R5-1），`pending:'kill'` 的
   `legalTargets` 非空，所以变异会红；但如果将来夜间顺序变化、夹具落到 `NIGHT_WOLF_CHAT`，
   `chat` 的 `legalTargets` 本来就是 `[]`，这条安全回归锁会**静默失效**。
   建议：把 `expect(body.view.phase).toBe('NIGHT')`、`expect(body.view.pending).toBeNull()` 移到
   `if` 外，并补 Round 4 建议的 **村民观察者 + `NIGHT_SEER`** 场景。
2. **`DAY_SPEECH` 的玩家拿不到默认 `pending:'speak'`**：`nextActor`（`orchestrator.ts:52-87`）没有
   `DAY_SPEECH` 分支，而 `runGame` 的当前行动者是 `seatToSpeak(state) ?? nextActor(state)`
   （`:188`）。当前没有消费者（`src/client` 不读 `ctx.pending`，发言框靠 `speakingSeat`），所以
   不影响行为；但 §8.10 的措辞「只有 `nextActor(state) === record.playerSeat`（即当前行动者本人）」
   与 `DAY_SPEECH` 的实际语义不一致。建议改成 `seatToSpeak(state) ?? nextActor(state)`。
3. `?pending=` 显式查询仍可被任意客户端指定（Round 4 的非阻塞旧项，未变）。它不是新泄漏
   （值由客户端自选，`legalTargetsOf` 只在 `vote` 时读 `state.phase`，`knownKillTargetOf` 只对
   女巫返回她自己的知识）；维持非阻塞。

#### 2.2 C-127：投影只锁了「不弃权」，服务端分支仍是一把假锁

Round 4 的要求是：「平票 → 重投 → 投影只给并列者 → 玩家输入被消费」。现在的新增覆盖是：

| 新增测试 | 位置 | 锁住了什么 |
|---|---|---|
| `legalTargetsOf(RUNOFF)` 只含并列者、不含弃权 | `tests/server/strengthen.test.ts:347-365` | 只锁住「不弃权」；**没锁住「只含并列者」** |
| `isPlayerPhase('DAY_VOTE_RUNOFF')` | `tests/server/orchestrator.test.ts:474-482` | **只锁住一个死代码 helper**；`runGame` 不使用它 |

**（a）投影用例的夹具让「只含并列者」没有被证明。**

夹具是 `runoff: [2,3]`、`aliveSeats: [1,2,3]`、观察者 1。于是「并列者」= `[2,3]`，「除观察者外
的所有存活席位」也正好是 `[2,3]`——两者在夹具里是同一个集合。

```text
# M-R5-2：RUNOFF 分支回退成 [...alive, 'abstain']
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts -t "C-127"
→ 1 failed / 8 skipped
  AssertionError: expected [ 2, 3, 'abstain' ] to deeply equal [ 2, 3 ]   # 有牙

# M-R5-6：RUNOFF 分支回退成 [...alive]（非并列者 + 不弃权）
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts -t "C-127"
→ 1 passed / 8 skipped                                                   # 假绿
```

M-R5-6 恰恰违反了 RUL-2 的核心「重投只能投并列者」，用例却全绿。修法很小：让夹具里有一个
**不在 runoff 的存活席位**，例如 `aliveSeats: [1,2,3,4]`、`runoff: [2,3]`、观察者 1，
期望 `[2,3]`；`[...alive]` 会得到 `[2,3,4]`，立刻红。

**（b）服务端重投分支仍然可以原样回归，且 `isPlayerPhase` 是死代码。**

`grep -rn "isPlayerPhase" src tests` 的结果：`src/` 只有定义（`orchestrator.ts:117-119`），
**没有任何调用者**；唯一引用是 `tests/server/orchestrator.test.ts:476`。`runGame` 仍在
`orchestrator.ts:193-196` 内联同一组相位判断：

```ts
const playerPhase =
  state.phase === 'DAY_SPEECH' ||
  state.phase === 'DAY_VOTE' ||
  state.phase === 'DAY_VOTE_RUNOFF';
```

所以「删掉 helper 里的 RUNOFF」会红，但「删掉真正生效的分支」不会：

```text
# M-R5-4：helper 删 RUNOFF（生产代码不用它）
$ pnpm exec vitest run --project unit tests/server/orchestrator.test.ts -t "C-127"
→ 1 failed / 9 skipped        # 只证明测试锁住了 helper

# M-R5-3：runGame 的内联分支删 RUNOFF（真正生效的代码）
$ pnpm exec vitest run --project unit tests/server
→ 27 files / 240 tests 全绿

$ pnpm exec vitest run tests/server tests/client
→ 32 files / 289 tests 全绿
```

这不是「少一个测试」而已。临时探针 **P-R5-3** 用真实引擎把一局推到
`DAY_VOTE_RUNOFF`（`runoff:[1,2]`、玩家 3 号存活），再跑真实 `runGame`：

```text
# 当前代码
PROBE-RUNOFF-STATE {"phase":"DAY_VOTE_RUNOFF","runoff":[1,2],"player":3,"playerAlive":true}
PROBE-RUNOFF-RESULT {"reads":["vote"],"decidedSeats":[1,2,4,5,7,8,9],
                     "playerVotes":[{"seat":3,"target":1}]}

# M-R5-3 之后（跑同一探针）
PROBE-RUNOFF-RESULT {"reads":[],"decidedSeats":[1,2,3,4,5,7,8,9], ...}
```

即：**当前行为是对的（玩家真的被问、真的投出 `VOTE_CAST`）；但删掉那个分支的瞬间，
`decide` 会替玩家投出重投票，而全量测试仍绿**。这正是 Round 4 的 C-127 回归，原样保留。

**结论：C-127 仍 Open（阻塞，测试）。** 修法二选一或都做：

1. 把 `runGame` 的内联判断换成 `isPlayerPhase(state.phase)`，让现有 helper 单测至少锁住调用点；
2. 补 P-R5-3 这样的 `runGame` 级用例：构造平票 → 断言 `input.read` 以 `kind:'vote'` 被调用、
   `decide` 没收到玩家席位、事件流里有玩家的 `VOTE_CAST`、没有 `INVALID_RUNOFF_TARGET` /
   `NOT_YOUR_TURN`。

#### 2.3 C-120：路由 → 通道 → 超时草稿现在有牙

新增 `tests/server/speech.test.ts:323-361`：

```ts
const pending = channels
  .forGame(gameId)
  .input.read({ seat: 1 as never, timeoutMs: 60, kind: 'speech' });

await app.inject({ method: 'POST', url: `/api/games/${gameId}/input`, ... });

expect(await pending).toEqual({ kind: 'timeout', text: '我怀疑 2 号。' });
```

反向探针（**M-R5-5**）删掉 `src/server/routes/games.ts:148` 的 `channels.setDraft(...)`：

```text
$ pnpm exec vitest run --project unit tests/server/speech.test.ts -t "C-120"
→ 1 failed / 14 skipped
  AssertionError: expected { kind: 'skip' } to deeply equal
                  { kind: 'timeout', text: '我怀疑 2 号。' }
```

这一次真实链路（路由 → 通道草稿 → 超时交回）被锁住了，反复 8 次运行 **8/8 通过**。
超时文本 → `SPEECH` 的后半段仍由既有的 C-110 用例覆盖
（`tests/server/orchestrator.test.ts:345-440`，「输入是 timeout 时，产出带该文本的 SPEECH」）；
两段合起来覆盖了 Round 4 要求的链路，因此 **C-120 可以关闭**。

非阻塞建议：

1. 60ms 是真实定时器，CI 高负载时有偶发超时先于 `POST` 到达的风险；用 fake timers 或注入
   `now` / `timeoutMs` 会更稳。
2. 若想一条用例看到 `SPEECH` 事件，可把 `runGame` 也接进这条链路（当前拆成两段，逻辑上等价，
   但下一轮按「全链路」找证据时要多跳一次文件）。

---

### 3. 变异与行为探针汇总

| 探针 | 注入的改动 | 定向命令 | 结果 | 证明 |
|---|---|---|---|---|
| **M-R5-1** | 路由默认 `pending` 改回对所有观察者 `pendingForPhase` | `vitest unit strengthen -t C-133` | **1 failed / 8 skipped**（`:342`，`[2..9] ≠ []`） | C-133 回归锁有牙 |
| **M-R5-2** | `targets.ts` RUNOFF → `[...alive,'abstain']` | `vitest unit strengthen -t C-127` | **1 failed / 8 skipped** | 投影锁住「不弃权」 |
| **M-R5-6** | `targets.ts` RUNOFF → `[...alive]`（非并列者、无弃权） | 同上 | **1 passed / 8 skipped** | **「只含并列者」没锁住** |
| **M-R5-3** | `runGame` 内联 `playerPhase` 删 `DAY_VOTE_RUNOFF`（生产分支） | `vitest unit tests/server` + `tests/server tests/client` | **27/240、32/289 全绿** | 服务端分支无锁 |
| **M-R5-4** | 只删 `isPlayerPhase` helper 的 RUNOFF（生产不用） | `vitest unit orchestrator -t C-127` | **1 failed / 9 skipped** | 单测只锁死代码 |
| **M-R5-5** | 路由删 `channels.setDraft(...)` | `vitest unit speech -t C-120` | **1 failed / 14 skipped** | C-120 有牙 |
| **P-R5-1** | 打印现有 C-133 用例落点 | `vitest unit __probe-r5` | `NIGHT_WOLVES` / 女巫 / `pending:null` / `legalTargets:[]` | 用例当前非空转，但未断言 `pending` |
| **P-R5-2** | 真实 GET 到 `NIGHT_SEER`，村民观察者 | 同上 | 修复后 `pending:null / legalTargets:[]`；M-R5-1 后 `pending:'check' / [1,2,4..9]` | C-133 行为正确 |
| **P-R5-3** | 真实平票 → RUNOFF → `runGame`，玩家 3 号 | 同上 | 修复后 `reads:['vote']`、玩家 `VOTE_CAST`；M-R5-3 后 `reads:[]`、`decide` 覆盖 3 号 | 行为正确但无锁 |

所有探针改动均已恢复；临时测试 `tests/server/__probe-r5.test.ts` 已删除。恢复后的 SHA-256 见 §6。

---

### 4. 五个维度

#### 4.1 RFC ADHERENCE — **NEEDS WORK**

- **C-133**：AC-11 / `PRD FR-11` / RFC-007 C-28 的信息边界现在成立；Round 4 的准确场景已实测。
- **C-120**：UI-4 / AC-6 的客户端到服务端草稿路径成立，且有回归锁。
- **C-127**：只完成了一半。投影来源的「只含并列者」没有被用例证明；`runGame` 的
  `DAY_VOTE_RUNOFF` 玩家分支仍无锁，且新 helper 未接入生产路径。§8.10 把「`isPlayerPhase`
  单测」当作服务端分支已锁的证据，不成立。
- 未重查（按用户指示）：C-116 / C-118 / C-119 / C-121·C-123 / C-132 等已关闭项。

#### 4.2 RULES COMPLIANCE — **NEEDS WORK**

- **TEST-1**：不通过。C-127 的两处（投影「只含并列者」、服务端玩家分支）仍是「改坏实现不红」。
- **TEST-6**：本轮无新增 e2e 需求；现有 8/8 绿，不重查。
- **DOC-1**：不通过。RFC §8.10 的「81 files」实为 80；「`isPlayerPhase('DAY_VOTE_RUNOFF')`
  单测」被写成服务端分支的锁，但 helper 没有调用者；`TEST-STRATEGY.md:332-345` 的 RFC-012
  小节仍全部 `proposed`（Round 4 非阻塞项，未重查，但 `TEST-1` 仍要求回填）。
- **UI-2 / UI-4 / SEC-5**：本轮三项涉及的路径通过；`project()` 仍是唯一输出口。

#### 4.3 SECURITY — **PASS（C-133 关闭）**

- 夜间默认 `pending` 的泄漏已修：真实路由探针 P-R5-2 在 `NIGHT_SEER`、村民观察者下
  `pending:null / legalTargets:[]`；回退探针（M-R5-1）会红。
- `?pending=` 显式查询仍是 Round 4 的非阻塞旧项，不构成新泄漏（客户端自选值；`vote` 只读
  `state.phase`，`knownKillTarget` 只对女巫返回她自己的知识）。
- 测试侧弱点（未断言 `pending`、`if` 包裹）记在 §2.1，属非阻塞加固。

#### 4.4 PERFORMANCE — **N/A（本轮无性能相关改动）**

- 路由每次 GET 多一次 `nextActor(state)`（纯内存扫描，O(席位)），可忽略。
- 每秒全量 `GET` + `project()` 是 C-126 的旧问题，不在本轮三项内，未重查。

#### 4.5 MAINTAINABILITY — **NEEDS WORK**

- **死代码 + 逻辑重复**：`isPlayerPhase`（`orchestrator.ts:117-119`）与 `runGame` 的内联条件
  （`:193-196`）是同一份规则的两份实现；单测锁住了死的那份，活的那份没有。这比单纯的
  「少一个测试」更危险：下一轮按测试名找证据会误判为已覆盖。
- **夹具鉴别力**：C-127 的投影用例把「并列者」取成了「除观察者外全部存活」，M-R5-6 证明
  它区分不了「只含并列者」与「全部存活」。
- **60ms 真实定时器**：C-120 用例有 CI 抖动风险（本轮 8/8 稳定）。
- **文档数字**：RFC §8.10 81 → 80；`README.md` 状态行的 CR 计数需要随本轮状态同步（见 §5）。

---

### 5. 结论

**Overall Risk Level: Medium。** 两个安全 / 数据完整性行为（C-133 夜间泄漏、C-120 草稿丢失）
已经真的修好并且有牙；剩余风险集中在**回归锁的鉴别力**：C-127 的投影用例锁不住「只含并列者」，
服务端玩家分支删掉后 289 条 server+client 用例仍全绿，且删掉后 AI 会替玩家投出重投票。

**Blocking Issues（必须修复后才能合并）**

1. **C-127（服务端分支）· 活代码无锁 + 死 helper 假锁。** `src/server/orchestrator.ts:193-196`
   的内联 `playerPhase` 删掉 `DAY_VOTE_RUNOFF` 后 27 files / 240 tests 全绿（M-R5-3）；
   `isPlayerPhase`（`:117-119`）在 `src/` 没有调用者，单测只锁住它（M-R5-4）。
   修法：`const playerPhase = isPlayerPhase(state.phase)`，并补 `runGame` 级平票 → 重投 →
   玩家 `VOTE_CAST` 用例。
2. **C-127（投影）· 夹具无法证明「只含并列者」。** M-R5-6（RUNOFF 返回 `[...alive]`）仍
   1 passed。修法：夹具加入一个不在 `runoff` 的存活席位（如 alive `[1,2,3,4]`、runoff
   `[2,3]`、观察者 1，期望 `[2,3]`）。

**Improvement Suggestions（非阻塞）**

1. **C-133 测试加固**：在 `tests/server/strengthen.test.ts:341` 的 `if` 外断言
   `view.phase === 'NIGHT'` 与 `view.pending === null`；补 Round 4 原场景（村民 / `NIGHT_SEER`），
   避免未来夜间顺序变化让锁静默失效。
2. **路由语义**：用 `seatToSpeak(state) ?? nextActor(state)` 作为默认 `pending` 的 actor 判定，
   让玩家自己的 `DAY_SPEECH` 轮也拿到 `pending:'speak'`（当前无消费者，纯一致性）。
3. **C-120 去抖**：用 fake timers 或注入 `timeoutMs`，避免 60ms 真实定时器在 CI 上偶发。
4. **删除或接线 `isPlayerPhase`**：不要留一个只有测试调用的导出。
5. **文档**：RFC §8.10 的 81 files → 80；README 状态行同步「1 个 Changes requested」；
   `TEST-STRATEGY.md:332-345` 的 `Exists?` 回填（Round 4 非阻塞项）。

---

### 6. 探针恢复与最终门禁

探针前备份的 4 个文件与恢复后的 SHA-256（`shasum -a 256 -c` 全部 OK，`git status --porcelain`
为空）：

```text
4296be7ef6ebcecb1209703b7436cf883b425cc915afddfd7c5b57c43df75670  src/server/orchestrator.ts
8887b7c3ea590b71da3e417ee96933ceb2647e6083386b45f0becf6a050e0c10  src/server/routes/games.ts
67a6cba74716288f9ef77216d2b1148f19cbf46682265fb6dd9e0d83b3681b5e  src/server/project/targets.ts
1eff6c8d4f4409a4a924583b269bb2c7e140b785c669952f323e41bba38ddbd1  tests/server/speech.test.ts
```

临时探针测试 `tests/server/__probe-r5.test.ts` 已删除；最终（恢复后）重跑：

```text
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 80 files / 688 tests 全绿
$ pnpm test:e2e → 8 passed
```

**状态**：RFC-012 → **`Changes requested`**（C-127 两项阻塞）。

## Round 6 -- 2026-11-19

> 评审方式：全新上下文 subagent，只读仓库文件；本会话没有写过 RFC-012 的实现代码。
> 被评审提交：`840916f fix(rfc-012): isPlayerPhase 接进 runGame、平票用例与夹具（Round 5）`。
> 评审开始时 HEAD `840916f`，工作树 clean。结论：**Reviewed**。
>
> 本轮按用户指示**只复核 Round 5 的两个阻塞项与一处加固**：**C-127(a)**（投影夹具加入不在
> runoff 的存活席位）、**C-127(b)**（`runGame` 调 `isPlayerPhase` + 平票重投的 runGame 级用例）、
> **C-133**（断言移出 `if` 并补 `pending === null`）。已关闭项（C-116 / C-118 / C-119 / C-120 /
> C-121·C-123 / C-130 / C-132 等）不重查；C-124 ~ C-126 等非阻塞项沿用前轮记录，本轮不重新验收。
>
> **产品类型**：`PRD.md` §Product Type 为 **game（主）+ web app（交付形态）**，沿用 Round 1 ~ 5
> 的检查口径；平台认证、帧预算、手柄、账号、SEO、离线同步等显式跳过，不另列 N/A 行。

---

### 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `840916f` · 评审开始时工作树 clean。

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
 Test Files  80 passed (80)
      Tests  689 passed (689)
   Duration  34.00s
TEST_EXIT=0

$ pnpm exec vitest run --project unit --coverage
 Test Files  68 passed (68)
      Tests  606 passed (606)
All files        |   96.46 |    92.85 |   97.38 |   96.96 |
COVERAGE_EXIT=0

$ E2E_PORT=4201 pnpm test:e2e
Running 8 tests using 1 worker
  ✓  1 tests/e2e/game.spec.ts:12:3 › 整局界面 › 主路径：能开一局、看到状态条与席位、发言区可达 (412ms)
  ✓  2 tests/e2e/game.spec.ts:22:3 › 整局界面 › 360px 视口没有横向滚动 (289ms)
  ✓  3 tests/e2e/game.spec.ts:35:3 › 整局界面 › 1024px 视口用桌面布局（席位在侧栏） (263ms)
  ✓  4 tests/e2e/game.spec.ts:49:3 › 整局界面 › 手机视口下输入区不遮挡状态条 (326ms)
  ✓  5 tests/e2e/game.spec.ts:113:3 › 整局界面 › 焦点可见：Tab 之后焦点元素有可见 outline (235ms)
  ✓  6 tests/e2e/game.spec.ts:131:3 › 整局界面 › 对比度：正文与次要文字达到 AA (268ms)
  ✓  7 tests/e2e/game.spec.ts:172:3 › 整局界面 › 键盘：Tab 能到投票按钮，Enter 能投票 (420ms)
  ✓  8 tests/e2e/game.spec.ts:199:3 › 整局界面 › 键盘：Tab 能到发言区，Enter 能提交 (310ms)

  8 passed (5.2s)
E2E_EXIT=0
```

绿色不是结论。本轮用定向变异验证「Round 5 声称已锁住的行为」是否真的会红；探针全部从
`/tmp/howl-rfc012-r6-probes/backup/` 的文件备份恢复（**未使用 `git checkout` / `git restore`**），
恢复后 5 个源码/测试文件 SHA-256 与探针前一致、`git status --porcelain` 为空；临时日志已
恢复；没有 `git commit`。最终重跑仍为 **80 files / 689 tests**、**8/8 e2e** 全绿。

---

### 1. 三项复核结论（先看这张表）

| 用户项 | 本轮结论 | 一句话证据 |
|---|---|---|
| **C-127(a)** 投影夹具加非并列存活席位 | **Closed** | 夹具 `alive [1,2,3,4]`、`runoff [2,3]`、观察者 1；回退成 `[...alive]` → 用例 **1 failed**（`[2,3,4] ≠ [2,3]`，M-R6-1）；回退成 `[...alive,'abstain']` → **1 failed**（M-R6-2） |
| **C-127(b)** `runGame` 调 `isPlayerPhase` + 真平票 runGame 用例 | **Closed** | 真实夹具落点 `DAY_VOTE_RUNOFF`、`runoff:[2,3]`、`playerSeat:2`；探针 `kinds:["vote"]`、`aiCoveredPlayer:false`；删 helper 的 RUNOFF → **1 failed**（M-R6-3）；把调用点换回无 RUNOFF 的内联判断 → **1 failed**（M-R6-4） |
| **C-133** 断言移出 `if` + `pending === null` | **Closed（加固成立）** | `strengthen.test.ts:342-344` 已无条件断言 `phase==='NIGHT'`、`pending===null`、`legalTargets===[]`；回退成对所有观察者给 `pendingForPhase` → **1 failed**（`null ≠ 'kill'`，M-R6-5） |

**总判断**：Round 5 的两项阻塞都已闭合，且不是「代码对了、锁没牙」：三处目标回归各自
都能打红；C-133 的断言也不再可能因夜间夹具漂移而静默失效。本轮改动没有生产行为变化
（`runGame` 只是从内联条件改为调用既有 helper），新增的 154 行均为测试。

---

### 2. 逐项证据

#### 2.1 C-127(a)：投影夹具现在能区分「并列者」与「全部存活」

`tests/server/strengthen.test.ts:348-367` 的夹具已改为：

```ts
seats: [
  { seat: 1, alive: true, role: 'villager' },
  { seat: 2, alive: true, role: 'villager' },
  { seat: 3, alive: true, role: 'villager' },
  { seat: 4, alive: true, role: 'villager' },   // 活着，但不在 runoff
],
runoff: [2, 3],
...
const targets = legalTargetsOf(state, 'vote', [1, 2, 3, 4] as never, 1 as never);
expect(targets).toEqual([2, 3]);
expect(targets).not.toContain('abstain');
```

`src/server/project/targets.ts:29` 的 RUNOFF 分支仍返回 `[...(state.runoff ?? [])]`。两个反向探针：

```text
# M-R6-1：RUNOFF 回退成 [...alive]
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts -t "C-127"
→ 1 failed | 8 skipped (9)
  AssertionError: expected [ 2, 3, 4 ] to deeply equal [ 2, 3 ]
  tests/server/strengthen.test.ts:365

# M-R6-2：RUNOFF 回退成 [...alive, 'abstain']
→ 1 failed | 8 skipped (9)
  AssertionError: expected [ 2, 3, 4, 'abstain' ] to deeply equal [ 2, 3 ]
```

Round 5 的 M-R5-6（`[...alive]` 仍 1 passed）已不再复现。**C-127(a) Closed。**
4 号这个「存活但不在 runoff」的席位正是鉴别力所在：它让「只含并列者」与「全部存活」
不再是同一个集合。

#### 2.2 C-127(b)：`runGame` 的 RUNOFF 分支现在真的被锁住了

生产代码（`src/server/orchestrator.ts:193`）已改为：

```ts
const playerPhase = isPlayerPhase(state.phase);
```

helper 本身（`:117-119`）包含 `DAY_VOTE_RUNOFF`；它在 `src/` 里再也不是死代码。新增用例
`tests/server/orchestrator.test.ts:485-636` 用真实 `GameRegistry` 把一局推到平票重投，再用
真实 `runGame` 推进。临时打印夹具与结果（已恢复）：

```text
PROBE-R6-FIXTURE {"phase":"DAY_VOTE_RUNOFF","runoff":[2,3],
                  "alive":[2,3,4,5,6,7,8,9],"playerSeat":2,"playerRole":"wolf"}
PROBE-R6-RESULT  {"kinds":["vote"],"aiCoveredPlayer":false,"playerSeat":2}
```

即：这是**真平票**（`runoff:[2,3]`），不是伪造的投影；玩家（2 号）是重投的第一个行动者；
`input.read` 确实以 `kind:'vote'` 被调用；`decide` 没有收到玩家席。

两个方向的变异：

```text
# M-R6-3：isPlayerPhase 删掉 DAY_VOTE_RUNOFF（helper 是生产路径）
$ pnpm exec vitest run --project unit tests/server/orchestrator.test.ts -t "平票重投"
→ 1 failed | 10 skipped (11)
  AssertionError: expected [] to include 'vote'
  tests/server/orchestrator.test.ts:634

# M-R6-4：把 runGame 的调用点换回「无 RUNOFF」的内联判断（helper 保持完整）
→ 1 failed | 10 skipped (11)
  AssertionError: expected [] to include 'vote'
```

M-R6-3 复现 Round 5 的 M-R5-3 场景：删掉生产路径的 RUNOFF 后，`input.read` 不再被调用，
`decide` 会接管玩家席；新用例在第一条断言就打红。M-R6-4 进一步证明 `runGame` 真的走了
helper，而不是另有一份内联实现。**C-127(b) Closed。**

补充说明：用例里的 `read` 对 `kind:'vote'` 返回 `{ kind:'speak', text:String(a) }`，
这不是错误——`src/shared/channels.ts:13-14` 的 `PlayerInput` 本来就没有 `vote` 变体，
投票目标约定放在 `text` 里，`playerAction` 也是这么解析的（`:243-253`）。

#### 2.3 C-133：断言已移出条件，且回退会红

`tests/server/strengthen.test.ts:342-344` 现在是：

```ts
expect(body.view.phase).toBe('NIGHT');
expect(body.view.pending).toBeNull();
expect(body.view.legalTargets).toEqual([]);
```

不再包在 `if (body.view.phase === 'NIGHT')` 里；如果夜间夹具漂移到别的相位，用例会明确失败，
而不是静默跳过。反向探针（M-R6-5）把 `src/server/routes/games.ts:100` 改回对所有观察者
`pendingForPhase(state.phase)`：

```text
$ pnpm exec vitest run --project unit tests/server/strengthen.test.ts -t "C-133"
→ 1 failed | 8 skipped (9)
  AssertionError: expected null but received "kill"
  tests/server/strengthen.test.ts:343
```

`pending` 断言本身有牙，且当前夹具（`NIGHT_WOLVES` / 玩家 1 号女巫）不再依赖
`legalTargets` 的非空性来间接证明泄漏。**C-133 的加固成立。**

#### 2.4 非阻塞观察（不改变 Reviewed 结论）

1. **`tests/server/orchestrator.test.ts:606-609` 的早期 `return` 仍可能静默跳过。**
   如果未来引擎/夹具变化使首轮投票不再并列，用例会直接 `return` 并以绿色结束。实测
   （M-R6-P2，仅改测试目标分配、不改生产代码）：把所有票集中投给 `a` 后，夹具相位变成
   `NIGHT_WOLF_CHAT`，用例仍 **1 passed**。建议把 `return` 换成
   `expect(afterVote.phase).toBe('DAY_VOTE_RUNOFF')` 或 `throw`，让夹具漂移可见。
   当前夹具确实是 `DAY_VOTE_RUNOFF`，所以这是**加固建议**，不是本轮的功能缺陷。
2. **注释与实际席位不符**：`tests/server/orchestrator.test.ts:490` 写「玩家坐 1 号」，
   探针实际 `playerSeat:2`（循环创建对局直到玩家是狼）。建议改成「玩家坐到任意狼席（当前为 2 号）」。
3. **新用例没有断言事件流**：它只断言 `read('vote')` 与 `decide` 不覆盖玩家席，没有断言
   玩家重投票产生了 `VOTE_CAST`、也没有断言无 `INVALID_RUNOFF_TARGET` / `NOT_YOUR_TURN`。
   Round 5 的建议里包含这些；它们不是本轮用户声明的判据，故记为非阻塞。
4. **`as never` 与 150 行夹具**：测试用大量 `as never` 和手工推进构造平票，类型检查帮不上忙；
   可抽一个 `driveToRunoff(playerSeat)` helper，降低后续维护成本。
5. **文档残项**：RFC §8.11 的「80 files / 689 tests」与实跑一致；但 §8.10 仍写
   「81 files / 688 tests」，`README.md:12` 的 RFC 计数仍是「11 Reviewed、1 Changes requested、
   4 Not started」，`TEST-STRATEGY.md:332-345` 的 RFC-012 行仍全部 `proposed`。这些是
   C-124 / C-131 的旧非阻塞项，不在本轮复核范围，但 RFC-012 转 `Reviewed` 后计数应同步为
   「12 Reviewed、0 Changes requested、4 Not started」。

---

### 3. 五个维度（按本轮改动范围）

#### 3.1 RFC ADHERENCE — **PASS**

- C-127 的两半（投影只含并列者、runGame 的 RUNOFF 玩家输入）都成立，且各自有变异探针证明；
- C-133 的夜间信息边界保持成立，断言加固后不再有静默失效的入口；
- 没有新增范围外功能；`runGame` 的改动是与原内联条件等价的重构，`git diff` 只改了这一行
  生产代码（`src/server/orchestrator.ts:193`）；
- 没有未记录的新偏离。RFC §8.11 的记录与实跑一致（80 files / 689 tests）。

#### 3.2 RULES COMPLIANCE — **PASS（本轮范围）**

- **TEST-1**：C-127(a) / C-127(b) 的回归锁都能打红；C-133 的 `pending` 断言也能打红。
  这是本轮的核心判据，通过。
- **TEST-6**：本轮没有新增用户可见功能；e2e 仍 8/8，不涉及新的 Must 主路径，N/A。
- **DOC-1**：§8.11 的验证数字正确；§8.10 的 81/688 与 §8.6 等旧文档残项仍是 C-124 的
  非阻塞范围，未被本轮引入。
- **SEC-5 / UI-1**：本轮没有改投影输出口；C-133 的默认 `pending` 仍只给当前行动者。

#### 3.3 SECURITY — **PASS**

- 夜间 `pending` 只给当前行动者（`routes/games.ts:99-100`）；M-R6-5 证明回退会红。
- 新测试只读/写测试内 registry；没有扩大 HTTP 面，也没有把完整状态暴露给客户端。
- `?pending=` 显式查询仍可由客户端指定（Round 4 / 5 的非阻塞旧项，未变），不构成本轮新风险。

#### 3.4 PERFORMANCE — **N/A**

- 本轮没有生产性能改动；`isPlayerPhase` 是 O(1) 字符串比较，`runGame` 的调用次数不变。
- C-126 的每秒全量 GET / `project()` 是旧非阻塞项，未在本轮范围内。

#### 3.5 MAINTAINABILITY — **NEEDS WORK（非阻塞）**

- 新用例的早期 `return` 是**可静默通过**的入口（§2.4 第 1 条），建议改成断言；
- 注释「玩家坐 1 号」与实际 2 号不符；
- 150 行手工构造 + 大量 `as never`，可读性和类型安全都有改进空间；
- 未断言玩家重投的事件流（`VOTE_CAST` / 无 `INVALID_RUNOFF_TARGET`）；
- 这些都是测试质量问题，不影响本轮「行为已锁住」的结论，故不阻塞 `Reviewed`。

---

### 4. 结论

**Overall Risk Level: Low（本轮改动范围）。** Round 5 的两项阻塞都是「测试锁没有鉴别力」
的问题，本轮已用夹具和非死代码调用点修复；三组反向变异全部打红，全量 80 files / 689 tests
与 8/8 e2e 全绿。生产代码只改了一行等价重构，没有可见行为变化。

**Blocking Issues（必须修复后才能合并）**

- 无。

**Improvement Suggestions（非阻塞）**

1. 把 `tests/server/orchestrator.test.ts:606-609` 的 `return` 换成
   `expect(afterVote.phase).toBe('DAY_VOTE_RUNOFF')`，避免夹具漂移时静默通过。
2. 修正 `:490` 的「玩家坐 1 号」注释（当前实际是 2 号），或改成从 `playerSeat` 动态生成。
3. 在 runGame 用例里补事件流断言：玩家重投产生 `VOTE_CAST`、无
   `INVALID_RUNOFF_TARGET` / `NOT_YOUR_TURN`，并断言 `runoff` 含玩家席。
4. 抽 `driveToRunoff` 夹具 helper，减少 150 行 setup 与 `as never`。
5. 顺手把 RFC §8.10 的「81 files / 688 tests」改成 80/689；RFC-012 转 Reviewed 后同步
   `README.md:12` 的「12 Reviewed、0 Changes requested、4 Not started」；
   `TEST-STRATEGY.md:332-345` 的 `Exists?` 回填仍是 C-131 的旧非阻塞项。
6. C-133 可再补一条 `NIGHT_SEER` / 村民观察者的真实路由用例（Round 5 建议），
   让「折叠后相位 + pending」在另一条夜间路径上也有锁；当前用例已足以证明行为。

---

### 5. 探针恢复与最终门禁

探针前备份的 5 个源码/测试文件与恢复后的 SHA-256（`shasum -a 256 -c` 全部 OK，
`git status --porcelain` 为空）：

```text
96f0224e4304a95dcd8166044adaa1deeeefda94bb031b8fd3dbc85f10331b76  src/server/orchestrator.ts
67a6cba74716288f9ef77216d2b1148f19cbf46682265fb6dd9e0d83b3681b5e  src/server/project/targets.ts
8887b7c3ea590b71da3e417ee96933ceb2647e6083386b45f0becf6a050e0c10  src/server/routes/games.ts
d71f3057a3f1ec76cab29fcbac17deb5684d645e624a977a629425190d6e3024  tests/server/strengthen.test.ts
e1048155aa71f796f9c168d4a00bfcb016e43875e2587e3b1e7ae2d036641880  tests/server/orchestrator.test.ts
```

本轮临时改动（含测试内的 `PROBE-R6-FIXTURE` / `PROBE-R6-RESULT` 日志、M-R6-P2 的投票目标
修改）全部从 `/tmp/howl-rfc012-r6-probes/backup/` 恢复；**没有使用 `git checkout` /
`git restore`**；临时探针测试没有写入仓库；没有 `git commit`。

最终（恢复后）重跑：

```text
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 80 files / 689 tests 全绿
$ pnpm test:e2e → 8 passed
```

**状态**：RFC-012 → **`Reviewed`**。
