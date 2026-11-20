# RFC-016 评审 · 浏览器兼容与首屏性能

> **评审会话**：独立 subagent（`agent-65`），全新上下文；本会话没有参与 RFC-016 的代码 / RFC / 测试写作。
> **日期**：2026-11-20（Round 1）
> **分支 / HEAD**：`main` / `5e06e49`
> **RFC 前置**：RFC-012 已 `Reviewed`（`RFCS.md:54`），前置满足。
> **结论**：**Changes requested**
> **整体风险**：**Medium**

## Round 1 -- 2026-11-20

**结论：Changes requested · Overall Risk Level: Medium**

四条阻塞：

1. **C-205 · AC-1 的 Chromium 主路径被跳过。** `playwright.config.ts:28` 给 Chromium 加了 `testIgnore: /browsers\.spec\.ts/`，而 Firefox / WebKit 才用 `testMatch` 跑这个文件（`:30-31`）。实测 14 条 e2e 的分布是 Chromium 10 + Firefox 2 + WebKit 2，**没有任何 `[chromium] › tests/e2e/browsers.spec.ts`**；Chromium 的 10 条全来自 `game.spec.ts`，走的是 `?seed=13` 自动开局（`:13` 等），不点「开始一局」。RFC §8.4 AC-1 与 `browsers.spec.ts:6-7` 的注释都声称「三引擎都跑」，与实际配置和输出相反。
2. **C-206 · AC-5 的测量不是「无缓存」，也不是「可点击」。** `tests/perf/first-paint.spec.ts:44-45` 注释写「直接 reload 并禁用缓存」，实际只 `page.goto('about:blank')`；同一个 context / page 的 5 次加载中，第 1 次冷、后 4 次复用 HTTP 缓存，中位数取到的是缓存命中样本。实测 warm 中位数约 30ms（`transferSize=300`，304 复用），新 context 的 cold 中位数约 172ms（`transferSize=224958`）。另外用 `waitFor({ state: 'visible' })`（`:41`）代替「按钮可点击」，`Date.now()`（`:39`）代替 RFC §4 指定的 `performance.now()`，且测的是测试专用 `/?home=1` 而不是默认 `/`。
3. **C-207 · 首屏仍会先打 `/api/session`，与用户批准的 A 方案「首屏不碰后端」冲突。** `src/client/main.tsx:28` 在决定首页之前无条件 `await fetch('/api/session')`；`?home=1` 的首页路径也走这里。实测打开 `/?home=1` 的首屏请求只有 `/api/session`；把 `/api/session` abort 后，首页不再渲染，body 变成「打不开对局 / Failed to fetch」。AC-8 的 e2e 只过滤 `/api/games`（`browsers.spec.ts:19`），所以它绿着，但 A 方案和 RFC §2.2.3「进入对局页前不发请求」没有成立；而且这条 e2e 也只跑在 Firefox / WebKit。
4. **C-209 · 新增 `pnpm test:perf` 没有登记到 RULES §3。** `RULES OPS-2` 明文要求「新增脚本需在本节登记」，`package.json` 加了 `test:perf`，`RULES.md:91-100` 的命令表没有它，RFC §8.3 的 FILES CHANGED 也没提到 RULES.md。规则违反，修法很小，但不能当作不存在。

**非阻塞（4 条）**：C-208（AC-7 断言只扫入口 chunk）、C-210（TEST-STRATEGY / README / Implementation Notes 的文档漂移）、C-211（默认 `/`、无 seed 开局、`?home=1` 与 `?game=` 优先级的测试缺口）、C-212（首页 / fallback 没有样式、错误文案夹英文）。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `5e06e49`，`git status --porcelain` 为空。

```
$ pnpm typecheck
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm format:check
All matched files use Prettier code style!
FORMAT_EXIT=0

$ pnpm test
 Test Files  89 passed (89)
      Tests  770 passed (770)
   Duration  45.38s
TEST_EXIT=0

$ pnpm test:e2e
14 passed (13.4s)
# [chromium] game.spec.ts × 10；[firefox] browsers.spec.ts × 2；[webkit] browsers.spec.ts × 2
# 没有 [chromium] › tests/e2e/browsers.spec.ts

$ pnpm test:perf
2 passed (2.3s)
```

`pnpm test:perf` 的两条是 `first-paint.spec.ts:13`（AC-6/7 打包断言）与 `:32`（AC-5 预算）；两条都绿。

---

### 1. 用户点名的 AC 复核

#### AC-1 · 三引擎「开始一局 → 发言 → 投票」——**FAIL（Chromium 被跳过）**

- 配置：`playwright.config.ts:24-31`。Chromium `testIgnore: /browsers\.spec\.ts/`；Firefox / WebKit `testMatch: /browsers\.spec\.ts/`。因此 `browsers.spec.ts` 只在 2 个引擎上跑。
- 实测输出（两次独立运行一致）：`14 passed`，其中 Chromium 的 10 条全部是 `tests/e2e/game.spec.ts`，且都从 `/?seed=13` 自动开局；`game.spec.ts:12-20` 的主路径不点「开始一局」。唯一点「开始一局」的用例是 `browsers.spec.ts:10`，只出现在 Firefox / WebKit。
- 「发言 → 投票」在 Chromium 上确实由 `game.spec.ts:179-211`（Tab → Enter 投票）覆盖；但「开始一局」这个新入口在 Chromium 上完全没有 e2e。AC-1 要求三个引擎上「开始一局 → 发言 → 投票」全部通过，当前是 2/3。
- `browsers.spec.ts:6-7` 的注释、RFC §8.4:120 的「三引擎跑」、以及 §8.5:134 的「Chromium 10 + Firefox 2 + WebKit 2」三处互相矛盾；后一个数字恰好暴露了问题。
- **修法**：Chromium 的 `testIgnore` 删掉（或改成只在 Firefox / WebKit 上 `testIgnore: /game\.spec\.ts/`），让 `browsers.spec.ts` 在三个 project 都跑；预期 16 条（Chromium 12 + Firefox 2 + WebKit 2）。同时修 RFC §8.4 / §8.5 与 commit message 的「三引擎」说法。

#### AC-2 · Edge——**PASS（取舍已记录）**

- 不单独跑 Edge，按 Chromium 引擎覆盖；D-4 已在 RFC §8.2:104 记录，符合 AC-2 与 Q-016-1 的假设。修 C-205 后 Chromium 仍走 `channel: 'chrome'`，Edge 的近似覆盖不变。

#### AC-3 · 能力兜底——**PASS（有牙，已用变异探针验证）**

- 单元：`tests/client/capabilities.test.ts:9-40` 覆盖三项能力齐全、缺 EventSource、全缺三种情况，中文提示与 `missing` 列表都断言。
- e2e：`browsers.spec.ts:41-54` 用 `addInitScript` 在页面脚本前把 `window.EventSource` 置 `undefined`，断言 `role=alert`、标题「这个浏览器暂时不能玩」、包含「实时消息」。
- **探针 P-R1-1**：把 `src/client/main.tsx:63` 的 `if (!capabilities.ok)` 改成 `if (false && !capabilities.ok)`，只跑 Firefox 的能力用例 → **1 failed**，失败点是 `getByRole('alert')` 等不到（`browsers.spec.ts:49`）。恢复后原用例绿。说明这条测试不是空转。
- 小缺口：由于 C-205，这条 e2e 也只在 Firefox / WebKit 上跑；Chromium 的 fallback 没有 e2e（单元探测本身与引擎无关）。修 C-205 后会自动补上。
- 「不白屏」的 `body` 非空断言（`:53`）偏弱（body 里还有 script），但 `role=alert` 的可见性断言已经足够；可顺手改成断言 `#root` 内的 fallback 文本。

#### AC-5 · 首屏可交互 ≤ 2 秒（本机、无缓存、5 次中位数）——**FAIL（测量口径不对）**

- `tests/perf/first-paint.spec.ts:32-51` 的 5 次样本全部在同一个 `page` / context 内，循环里只 `context.clearCookies()` 和 `goto('about:blank')`（`:36-45`）。**cookie 清空不等于缓存清空**；第 2~5 次复用了第 1 次下载的 `index-*.js`。实测：
  - 同页连续 5 次：`[114, 30, 26, 30, 25]ms`，中位数 **30ms**；入口 JS 的 `transferSize` 第 1 次 `224958`，后 4 次 `300`（304 复用）。
  - 每次新建 browser context 的 5 次：`[138, 172, 170, 152, 188]ms`，中位数 **172ms**；每次 `transferSize=224958`。
  - 测试取第 3 个样本作为中位数，正好落在 warm 区间；`comment:44` 的「直接 reload 并禁用缓存」是事实错误。
- 测量点也不是「可点击」：`:41` 用 `waitFor({ state: 'visible' })`。当前 `Home` 的按钮初始 `disabled={busy}` 为 false，所以行为暂时没问题；但把按钮改成「等 session 回来才 enabled」这类回归，visible 仍然通过。`click({ trial: true })` 或 `expect(button).toBeEnabled()` 才是「可点击」。
- `Date.now()`（`:39`）而不是 RFC §4:58 指定的 `performance.now()`；计时起点在 `page.goto` 之前，包含 Playwright IPC，偏严格但不是 RFC 口径。
- 测的是 `/?home=1`（`:40`），不是默认 `/`。`?home=1` 是测试专用分支；默认首页路径没有被 perf 测到（见 C-211）。
- **探针 P-R1-5**：在 `main.tsx` 的 home 分支前注入 1600ms 延迟，官方 AC-5 用例仍然 **1 passed**（warm 中位数约 1.83s）；1600ms 下用新 context 的 cold 中位数约 1.92s，只剩 80ms 余量。这个数字不是「1.6s 回归仍合规」的漏洞（1.83s 确实 < 2s），而是说明 warm 口径的余量与真实冷启动不同；再大一点的资产 / 更慢的网络就会出现 warm 过、cold 不过 2s 的假绿。
- **修法**：每个样本新建 browser context（或 Chromium CDP `Network.setCacheDisabled(true)`）以测无缓存；用 `click({ trial: true })` / `toBeEnabled` 测可点击；`performance.now()`；测默认 `/`；把 5 个样本打出来（失败时已经有，成功时也 log 一行便于趋势）。若仍想保留 5 次同页，至少把第 1 次单独算作 cold，并明确写「warm 中位数」不能代表 AC-5。

#### AC-6 · 首屏 JS 不含复盘页 / 流式模块标识——**PASS（有牙）**

- `first-paint.spec.ts:13-30` 取 `dist/client/assets/index-*.js` 作为入口 chunk，断言不含 `复盘时间线`、`/stream`；再断言存在独立的 `ReplayPage-*.js` 且其中含 `复盘时间线`。
- 产物实测：入口 `index-DlkU3s7b.js` 不含三者；`App-ErRDS-r9.js` 含 `/stream`；`ReplayPage-DBylymGM.js` 含 `复盘时间线`；`dist/client/index.html` 只加载入口脚本，没有 `modulepreload` App / ReplayPage。
- **探针 P-R1-2**：把 `src/client/App.tsx:12-14` 的 `lazy(() => import('./pages/ReplayPage'))` 改成静态 `import { ReplayPage }` → perf 打包用例 **1 failed**，失败点 `expect(replay).toBeDefined()`（`first-paint.spec.ts:26`），因为 `ReplayPage-*.js` 不再单独产出。恢复后绿。说明「静态 import 复盘页会红」成立。
- 残余小缺口：断言只看入口 chunk；如果将来 Vite 引入 vendor split 或额外的首屏 chunk，需要把「首屏实际加载的 chunk 集合」显式列出。当前 `index.html` 只有一个 script，所以不是问题。

#### AC-7 · 客户端产物不含 LLM 调用代码或密钥——**PARTIAL：行为 PASS，回归锁 NEEDS WORK**

- 行为：入口 / App / ReplayPage 三个 chunk 都不含 `api.deepseek`、`DEEPSEEK_API_KEY`、`openai`；`tests/meta/build.test.ts:45-55` 会扫描**全部** `dist/client` 的 `DEEPSEEK_API_KEY`，`:57-68` 扫描 `@fastify/static`（服务端代码标记）。当前客户端是干净的。
- 回归锁：`first-paint.spec.ts:18-22` 只读入口 chunk 的 `api.deepseek` / `DEEPSEEK_API_KEY`，没有扫 App / ReplayPage。**探针 P-R1-3**：在 `ReplayPage.tsx` 的根 `<div>` 加 `data-probe-model="https://api.deepseek.com/chat/completions"`，构建后 `ReplayPage-*.js` 含 `api.deepseek`，入口不含；打包用例仍然 **1 passed**。也就是说，把模型地址（乃至一段手写 LLM 调用代码）放进懒加载 chunk，AC-7 的断言不会红；`build.test.ts` 只兜住 `DEEPSEEK_API_KEY` 和 `@fastify/static` 两个字符串。
- **修法**：把 `api.deepseek` / `openai` / `chat/completions` / 服务端 LLM 模块标识的扫描扩展到 `dist/client/**/*.js`（放进 `tests/meta/build.test.ts` 更划算，它已经在 `pnpm test` 里跑 `pnpm build`），而不是只看入口。这样 AC-6/7 也能进常规门禁，而不是只在 `pnpm test:perf` 里。

#### AC-8 · 首屏到按钮可点期间没有 `/api/games`——**字面 PASS，A 方案 FAIL**

- 字面：`browsers.spec.ts:14-20` 在 `goto('/?home=1&seed=13')` 后收集请求，断言 `/api/games` 为空；这条在 Firefox / WebKit 都绿。我在 Chromium 上做同样的 probe，也只看到 `/api/session`，没有 `/api/games`。
- **但用户批准的 A 方案写的是「`/` 是首页（介绍 + 开始一局），首屏不碰后端」**（RFC §8.1:95），RFC §2.2.3 也写「进入对局页前不发请求」。`main.tsx:28` 在首页渲染前 `await fetch('/api/session')`，这就是后端请求，且首页的渲染依赖它。
- 行为证据（P-R1-6）：
  - `goto('/?home=1')` 的首屏网络：`["http://127.0.0.1:4180/api/session"]`。
  - 用 `page.route('**/api/session', route => route.abort())` 后：首页不出现，body 是 `"打不开对局\n\nFailed to fetch"`。也就是说后端不可用时，用户连介绍页都看不到——这正是 A 方案要避免的。
  - 该请求还会为每个首次访问者创建一个 7 天 cookie 的会话（`resolveSession`），即使他从不点「开始一局」；内存 store 没有 TTL 清理（只把 TTL 写进 cookie），属于额外副作用。
- AC-8 的测试过滤条件只有 `/api/games`（`:19`），所以它无法发现 `/api/session`；这条测试又只在 Firefox / WebKit 上跑。**修法**：把 `await fetch('/api/session')` 从 home 分支移走（放到 `?seed` 自动开局分支，或 `Home.start` 的 POST 之前）；首页直接渲染 `Home`。然后把 AC-8 的断言加宽为「按钮可点之前没有任何 `/api/*`（至少没有 `/api/session` 和 `/api/games`）」，并让它在 Chromium 上也跑；再加一条「`/api/session` abort 时首页仍然可见」的兜底用例。
- 说明：AC-8 的字面文本只禁 `/api/games`，所以「字面 PASS」是按测试而言；但按用户批准的 A 方案和 §2.2.3，C-207 是真实缺陷。这个口径冲突已在 §6 登记。

#### AC-4 · SSE 重连——**N/A（复用 RFC-010，未重查）**

- `RFC-010` 已 `Reviewed`（`RFCS.md:53`），其 `tests/server/stream.test.ts` 有 `Last-Event-ID` 的重连断言。按用户「已关闭项不要重查」，本轮不重新裁决客户端重连细节；RFC §8.4:123 的「RFC-010 已覆盖」作为证据接受。

---

### 2. 其他发现

#### C-208 · AC-7 的扫描范围（非阻塞，但建议本轮修）

见上。修复成本低，且能把 AC-6/7 从 `test:perf` 挪进 `pnpm test` 的门禁。

#### C-210 · 文档与测试计划的漂移（非阻塞）

- `TEST-STRATEGY.md:38` 仍写「RFC-016 待实现」；`:391-400` 的 RFC-016 小节 6 行全部 `proposed`，且文件名 `capabilities.spec.ts`、`first-paint.test.ts`、`bundle.test.ts`、`e2e/first-paint.spec.ts` 在仓库中不存在；实际是 `browsers.spec.ts`、`first-paint.spec.ts`、`meta/build.test.ts` 的组合。`/implement-rfc` 的规则是「计划错了要记录为 deviation」，RFC §8 没有记录这处改动。
- `README.md:11` 仍写「16 个 RFC（15 个 Reviewed、0 个 Changes requested、1 个 Not started）」「十五个 RFC 的代码已合入 main（001–015）」；RFC-016 已实现（现在还要因本评审变成 `Changes requested`），这两句都过期。
- `RFCs/RFC-016...:107-114` 的 FILES CHANGED 漏了 `scripts/e2e-server.ts`（为 perf 加的 `--port`）、`README.md`、`TEST-STRATEGY.md`（只改了用例数）与 `RFCS.md`；`§8.4:120` 的 AC-1 证据与 `§8.5:134` 的分布矛盾；`§8.4:126` AC-7 的「客户端产物不含 api.deepseek」只对入口成立（见 C-208）。
- 这些不影响代码行为，但 `DOC-1` 要求偏离记录在案；建议和 C-205 / C-206 / C-207 的修复同一轮更新。

#### C-211 · 默认 `/`、无 seed 开局、`?home=1` 与 `?game=` 的优先级（非阻塞）

- 仓库里所有首页 e2e 都用 `/?home=1`（`browsers.spec.ts:14`、`first-paint.spec.ts:40`），默认 `/` 只在能力失败用例里出现（`browsers.spec.ts:47`，此时 boot 不执行）。用户真实入口 `/` → 首页 → 「开始一局」（无 seed、随机局）没有被 e2e 覆盖；`Home.start` 的 `seed === null` 分支（`Home.tsx:21-24`）也没有测试。
- `main.tsx:20-21` 先处理 `?game=`，`:26` 才计算 `forceHome`；因此 `/?game=xxx&home=1` 会进对局，不是「强制停在首页」。D-1 的「强制」应改为「首页优先」或在代码里让 `home=1` 覆盖 `game`。
- 建议：加一条默认 `/` 的首页 + 无 seed 开局的 e2e；把 `?home=1` 的优先级用一条单测或 e2e 锁住。

#### C-212 · 首页 / fallback 的样式与错误文案（非阻塞，低）

- `Home.tsx` 用了 `home` / `home__title` / `home__lead` / `home__points` / `home__start` / `home__error`，`main.tsx:67` 的 fallback 用了 `fallback`；`src/client/styles/global.css` 里没有这些类（只有 `.button` / `.button--primary`）。首页能用、按钮有样式，但介绍区是浏览器默认排版，`.home` / `.fallback` 这两个 class 实际是空钩子。至少要么补样式，要么删掉空 class。
- `boot()` 的 catch（`main.tsx:85-91`）直接把 `cause.message` 显示给用户；P-R1-6 的 abort 场景显示的是英文 `Failed to fetch`，与 F43 / UI-2 的「中文术语」不一致。建议映射成中文，并只保留技术错误码/日志。
- `Home.start` 没有检查 `/play` 的响应（`Home.tsx:31-35`），失败也会 `window.location.search = ?game=...`；低概率下会进入一个没有推进的对局。可顺手加 `if (!played.ok) throw ...`。

#### 观察 · 创建 / 开局逻辑重复（非阻塞）

- `main.tsx:34-50`（`?seed` 自动开局）与 `Home.tsx:17-35`（按钮开局）各写了一遍 `POST /api/games` + `POST /play`。Home 的版本不传 `playerSeat`，boot 的版本支持 `?seat=`；两条路径的差异没有测试锁住。可以抽一个 `createAndPlayGame({ seed, playerSeat })`，同时让首页的入口 chunk 不 import `ApiClient`（当前直接 fetch 是为了避免把 `api.ts` 的 `/stream` 带进入口，这是对的）。

---

### 3. 五个审查维度

#### 3.0 Product Type 与范围

`PRD.md:20-48` 把产品定义为 **game（主）+ web app（交付形态）**。本轮适用：浏览器主路径、首屏预算、代码分割、安全扫描、键盘 / 对比度（RFC-012 已覆盖）。显式跳过：账号 / 认证、数据库 / 迁移、帧预算 / 目标硬件、真机移动端、SEO / 离线、商店 / 支付——PRD `Product Type` 的「不适用检查」明确排除，RFC §6 也写明不做移动真机。本轮没有重跑完整的 a11y 套件：RFC-016 改的是首页、启动与 Playwright 配置，对局 UI 的键盘 / 焦点 / 对比度由 RFC-012 的 `game.spec.ts:120-177` 覆盖；首页自身用 `main` / `h1` / `ul` / `button` / `role=alert`，语义已核对。

#### 3.1 RFC ADHERENCE —— **FAIL**

- **AC-1 FAIL**：Chromium 没跑 `browsers.spec.ts`（C-205）。
- **AC-2 PASS**：D-4 记录了 Edge 取舍。
- **AC-3 PASS**：单元 + e2e，变异探针打红。
- **AC-4 N/A**：RFC-010 `Reviewed`，按用户要求不重查。
- **AC-5 FAIL**：测量不是无缓存、不是可点击、不是默认入口（C-206）。
- **AC-6 PASS**：入口 chunk 干净，静态 import 复盘页会被打红。
- **AC-7 PARTIAL**：实际产物干净，但非入口 chunk 的模型地址 / LLM 代码不会被断言发现（C-208）。
- **AC-8 PARTIAL**：字面无 `/api/games`；A 方案和 §2.2.3 的「首屏不碰后端」被 `/api/session` 破坏（C-207），且该 e2e 只在 2 个引擎跑。
- Implementation Notes 的 AC-1 证据（§8.4:120）与实测不一致；AC-7（§8.4:126）把入口 chunk 的断言写成「客户端产物」；`§8.5:134` 的分布恰好证明 Chromium 没跑。属 DOC-1 问题。

#### 3.2 RULES COMPLIANCE —— **FAIL**

- **OPS-2 FAIL**：`test:perf` 是新脚本，未在 `RULES.md:91-100` 登记（C-209）。
- **TEST-1 PARTIAL**：AC-1 的测试没有覆盖 Chromium；AC-7 的回归锁不完整。
- **DOC-1 FAIL**：TEST-STRATEGY 的计划偏差、FILES CHANGED 漏文件、AC-1 的错误证据（C-210）。
- **OPS-4 / SEC-2 PASS（行为）**：`dist/client` 无密钥、无服务端代码；`tests/meta/build.test.ts` 全量扫描 `DEEPSEEK_API_KEY` 与 `@fastify/static`。AC-7 的回归锁缺口见 C-208。
- **UI-2 / F43 PARTIAL**：首页错误路径可能显示英文 `Failed to fetch`（C-212）。
- 其余 UI 规则（A11Y-1/2/4）由 RFC-012 的 e2e（焦点、对比度、键盘）覆盖，本 RFC 没有改动对局 UI；首页自身用 `main` / `h1` / `ul` / `button` / `role=alert`，语义正确。

#### 3.3 SECURITY —— **PASS（附测试加固建议）**

- 无注入 / XSS 面：首页只有静态文本和一个按钮，React 转义；`Home.start` 的输入只有 URL 参数 `seed` / `seat`，由服务端 schema 校验（既有 RFC）。
- 密钥 / LLM 代码：客户端产物实测无 `DEEPSEEK_API_KEY`、`api.deepseek`、`openai`；`tests/meta/build.test.ts` 全量扫描密钥与服务端标记。`/api/session` 是 same-origin + HttpOnly cookie，没有新的凭据泄漏。
- 错误信息：`boot()` 把原始 `Error.message` 显示给用户，当前只是 `Failed to fetch`，不含服务端响应体；风险低，但建议中文映射（C-212）。
- 未发现需要阻塞的安全性漏洞。

#### 3.4 PERFORMANCE —— **NEEDS WORK**

- AC-5 的测量口径问题（C-206）是主要问题：测的是 warm cache，且用 visible 代替 clickable。
- `/api/session` 在首页渲染前阻塞（C-207）：本地约几十毫秒，但把静态首页的可用性绑在后端上；后端慢/挂时首屏直接失败。这是 NFR-8 的结构性风险，不是本地数字能掩盖的。
- 入口 chunk：`index-*.js` 约 224.65 kB / gzip 70.84 kB，包含 React + Home + 能力探测；App（112 kB）与 ReplayPage（4.65 kB）已拆出。体积本身对 2s 预算没有压力，拆分有效。
- 每个首页访客创建一个 session 的副作用：`InMemoryMetaStore` 没有按 TTL 清理，`SESSION_TTL_MS` 只进了 cookie；如果保留 `/api/session`，需要补清理或把它移到点「开始一局」之后。
- 字体：系统字体栈，无外部字体；符合 §2.2.4。

#### 3.5 MAINTAINABILITY —— **NEEDS WORK**

- 重复的 create + play 逻辑（`main.tsx:34-50` vs `Home.tsx:17-35`），且 Home 版本不支持 `?seat=`；建议抽取。
- `boot()` 返回的 `seed`（`main.tsx:17,31`）没有被使用，`main.tsx:74` 又重新读了一遍 `seedParam`；可删掉一半。
- `Home` 没有组件级单测；首页的无 seed 分支、错误分支、重复点击保护都没有测试（C-211）。
- `.home` / `.fallback` 是空样式钩子（C-212）。
- 测试计划与实际文件名的漂移（C-210）；`TEST-STRATEGY` 的 `proposed` 会让下一次 `/generate-rfcs` 或其他会话误判 RFC-016 还没有测试。
- 代码组织：`capabilities.ts` 小而清晰；`Home.tsx` 结构简单；`main.tsx` 的 boot 分支可读，但 session 调用位置是架构问题（C-207）。

---

### 4. 变异探针与恢复

| 探针 | 改了什么 | 结果 | 恢复 |
|---|---|---|---|
| **P-R1-1** | `main.tsx:63` `if (!capabilities.ok)` → `if (false && !capabilities.ok)` | Firefox 能力用例 **1 failed**（`getByRole('alert')` 不可见） | `cp /tmp/howl-rfc016-r1/backup/main.tsx`；MD5 `eedc2e89e84e710a27c5246ff596132e` 与备份一致 |
| **P-R1-2** | `App.tsx:12-14` 的 lazy ReplayPage → 静态 import | perf 打包用例 **1 failed**（`ReplayPage-*.js` 不存在） | `cp .../backup/App.tsx`；MD5 `f04f9d4a985eb9422ae124650d8be967` 一致 |
| **P-R1-3** | `ReplayPage.tsx` 根 div 加 `data-probe-model="https://api.deepseek.com/chat/completions"` | perf AC-6/7 用例 **1 passed**；`ReplayPage-*.js` 含 `api.deepseek`，入口不含 | `cp .../backup/ReplayPage.tsx`；MD5 `7e9785a2f2a19e622ba00f0c2e74225a` 一致 |
| **P-R1-4** | 不改源码；probe 在 warm（同页 5 次）与 cold（每次新 context）下各测 5 次 | warm `[114,30,26,30,25]` 中位 30ms / `transferSize=300`；cold `[138,172,170,152,188]` 中位 172ms / `transferSize=224958` | 临时 `tests/perf/_probe.spec.ts` 已删除 |
| **P-R1-5** | `main.tsx` 的 home 分支前加 1600ms / 1900ms `setTimeout` | 1600ms：官方 AC-5 **1 passed**（warm 中位约 1.83s）；1900ms：**1 failed**，样本 `2319 / 2323 / 2330 / 2357 / 2548ms` | `cp .../backup/main.tsx`；MD5 一致 |
| **P-R1-6** | 不改源码；probe 记录 `/?home=1` 请求，并 abort `/api/session` | 首屏只有 `/api/session`；abort 后 body `"打不开对局\n\nFailed to fetch"` | 临时 `tests/e2e/_probe.spec.ts` 已删除 |

恢复证明：

- `src/client/main.tsx`、`src/client/App.tsx`、`src/client/pages/ReplayPage.tsx` 三个文件的 MD5 与 `/tmp/howl-rfc016-r1/backup/` 完全一致（见上表）。
- 临时探针 `tests/e2e/_probe.spec.ts`、`tests/perf/_probe.spec.ts` 已删除；`git status --porcelain` 为空；`git diff --stat` 为空。
- 没有 `git commit`；没有使用 `git checkout` / `git restore`；恢复后重新 `pnpm build`，并复跑 `pnpm test:perf`（2 passed）、`pnpm test:e2e`（14 passed）、`pnpm test`（89 files / 770 tests）、`typecheck` / `lint` / `format:check`（全 exit 0）。

---

### 5. 结论

- **Overall Risk Level: Medium**。产品代码的主体（首页、懒加载、能力探测）是好的；风险集中在「测试证据是否真的覆盖了 AC」和「首页仍被 `/api/session` 绑住」这两件事，而不是一个会立刻崩溃的运行时 bug。
- **Summary**：入口 chunk 拆分/能力兜底/打包断言的实现方向正确，AC-3 与 AC-6 的测试经变异探针验证有牙；但 AC-1 的 Chromium 被 `testIgnore` 跳过，AC-5 用的是 warm cache + visible 的测量口径，AC-8 只测 `/api/games` 而首页仍在 await `/api/session`，加上 `test:perf` 未登记到 RULES，四条阻塞必须先修。文档（TEST-STRATEGY / README / Implementation Notes）也需要和实现对齐。
- **Blocking Issues**：
  1. **C-205**：Chromium 不跑 `browsers.spec.ts`；AC-1 只完成了 Firefox / WebKit。
  2. **C-206**：AC-5 的 5 次样本是 warm cache，且用 visible 代替 clickable；不是 AC 要求的「无缓存、可点击」。
  3. **C-207**：首页渲染前 `await fetch('/api/session')`；违反 A 方案「首屏不碰后端」与 §2.2.3，后端不可用时首页直接变成「打不开对局」。AC-8 的过滤条件只查 `/api/games`，抓不到它。
  4. **C-209**：`test:perf` 未在 RULES §3 登记，违反 OPS-2。
- **Improvement Suggestions**：
  1. **C-208**：AC-7 的扫描扩展到 `dist/client/**/*.js`（`api.deepseek` / `openai` / `chat/completions` / 服务端模块标识），并放进 `tests/meta/build.test.ts` 的常规门禁。
  2. **C-210**：把 TEST-STRATEGY 的 RFC-016 行改成 `existing` 并写实际文件名；修 README 的 RFC 状态；补 RFC §8.3 的 FILES CHANGED、§8.4 的 AC-1/AC-7 证据、记录测试计划偏差。
  3. **C-211**：补默认 `/` + 无 seed 开局的 e2e；用测试锁住 `?home=1` 与 `?game=` 的优先级。
  4. **C-212**：给 `.home` / `.fallback` 补样式或删空 class；把 `boot()` 的 raw error 映射成中文；Home 的 `/play` 响应加 `ok` 检查。
  5. 抽取 `createAndPlayGame`，消除 `main.tsx` 与 `Home.tsx` 的重复；删掉 `boot()` 未使用的 `seed` 字段和重新读取的 `seedParam`。
- **Suggested status**：**`Changes requested`**。

---

### 6. Open conflicts

按权威顺序（`PRD > FEATURES > RULES > RFC > 生成计划`）本轮遇到并显式登记以下冲突，未静默裁决：

| # | 冲突 | 本轮的处理与理由 | 需要修哪一边 |
|---|---|---|---|
| **O-1** | 用户批准的 A 方案 / RFC §2.2.3「首屏不碰后端、进入对局页前不发请求」 vs RFC §5 AC-8 只写「不含 `/api/games`」 | 按用户批准 + §2.2.3 判：`main.tsx:28` 的 `/api/session` 是缺陷，AC-8 的测试口径太窄。AC-8 的字面测试仍然 PASS，但不能据此判 C-207 通过 | 代码去掉 home 的 session 请求；AC-8 的断言扩到 `/api/*`（至少 `/api/session`） |
| **O-2** | `RULES OPS-2`「新增脚本需在 §3 登记」 vs `package.json` 新增 `test:perf` | 按 RULES 判：脚本必须先登记；当前是违规 | 在 `RULES.md` §3 加 `pnpm test:perf` 一行，并更新版本/变更记录 |
| **O-3** | `TEST-STRATEGY.md:391-400` 的计划文件名 / `proposed` vs 实际 `browsers.spec.ts` / `first-paint.spec.ts` / `meta/build.test.ts` | 按 RFC 的 FILES CHANGED + 实际落地产物判：测试已存在，计划需要回填；`/implement-rfc` 要求把这种改动记录为 deviation，RFC §8 没有记录 | 更新 TEST-STRATEGY 的 RFC-016 小节（`existing` + 实际文件名），并在 RFC §8.2 记录计划偏差 |
| **O-4** | `README.md:11` 的 RFC 状态 / 用例数与 `RFCS.md` 的实际状态 | 按 `RFCS.md` 的 Status 列判：README 过期；本评审后 RFC-016 是 `Changes requested` | 修 README 的「15 Reviewed / 1 Not started / 001–015」 |

> **Round 1 后的状态**：C-205 / C-206 / C-207 / C-209 为阻塞；C-208 / C-210 / C-211 / C-212 为非阻塞。RFC-016 的 Status = **`Changes requested`**。下一轮复核时，已关闭项与用户未点名项不重查。

---

## 变更历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-20 | v1.0 | Round 1 评审：门禁 89 files / 770 tests、14/14 e2e、2/2 perf；四条阻塞（AC-1 Chromium 跳过、AC-5 warm-cache 测量、AC-8/A 方案的 `/api/session`、OPS-2 未登记 `test:perf`）与四条非阻塞（AC-7 扫描范围、文档漂移、默认 `/` / 无 seed 测试缺口、首页样式/英文错误）。探针从文件备份恢复，工作树 clean，无 commit。 |
