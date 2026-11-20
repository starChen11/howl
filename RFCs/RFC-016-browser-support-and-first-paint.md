# RFC-016 · 浏览器兼容与首屏性能

**Features**: F41, F42
**Depends on**: RFC-012
**Rules**: OPS-4, TEST-5
> 关联需求：NFR-7、NFR-8
**Complexity**: Low

---

## 1. 摘要

最后一条收尾：保证**四个浏览器都能玩**，且**首屏不等 LLM**。

这两件事在开发机上几乎总是「看起来没问题」，直到把链接发给别人。

## 2. 技术方案

### 2.1 浏览器支持

目标：最近两个版本的 Chrome、Edge、Safari、Firefox。不支持 IE 与国内套壳浏览器的兼容模式。

需要逐个确认的兼容点：

| 点 | 风险 | 处理 |
|---|---|---|
| SSE（`EventSource`） | 各浏览器均支持，但**重连语义**有差异 | 不依赖自动重连，`Last-Event-ID` 由我们显式管理 |
| `TextDecoder({ stream: true })` | 全部支持 | 无 |
| `structuredClone` | 现代浏览器均支持 | 服务端用，客户端不用 |
| CSS `:has()` / 容器查询 | 老版本不支持 | 不使用；只用 flex/grid 与媒体查询 |
| `crypto.randomUUID()` | 需要安全上下文（https 或 localhost） | 仅服务端使用 |

不支持时的兜底：检测缺失能力，显示一条明确提示（而不是白屏）。**v1 不做降级实现**——只做可读的失败。

### 2.2 首屏性能

目标：首屏可交互 ≤ 2 秒（本机、无缓存，NFR-8）。

手段：

1. **路由级代码分割**：对局页与复盘页分开打包，首屏只加载入口与身份卡。
2. **LLM 相关代码只在服务端**：客户端不含任何模型调用代码（OPS-4）。
3. **首屏不发起 AI 调用**：进入对局页前不发请求；「开始一局」之后才建局。
4. 字体使用系统字体栈，不加载外部字体。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/client/capabilities.ts` | 能力探测与提示 |
| `vite.config.ts` | 代码分割配置（在 RFC-001 基础上调整） |
| `tests/e2e/browsers.spec.ts` | Playwright 多浏览器项目配置 |
| `tests/perf/first-paint.test.ts` | 首屏预算断言 |

## 4. 实现要点

- Playwright 用 projects 配置 4 个引擎；WebKit 即 Safari 的近似。
- 首屏预算的测量点：`performance.now()` 到「开始一局」按钮可点击。用 Playwright 的 `page.evaluate` 取，不靠肉眼。
- 代码分割后要确认体积：首屏 chunk 不应包含复盘页与流式渲染模块。

## 5. 验收标准

1. 在 Chromium、Firefox、WebKit 三个 Playwright 引擎上，「开始一局 → 发言 → 投票」主路径全部通过（WebKit 作为 Safari 的近似）
2. Edge 按 Chromium 引擎覆盖，不单独跑；该取舍记录在本文档
3. 能力探测失败时显示明确的中文提示，且页面不白屏（用一个强制关闭 `EventSource` 的测试注入验证）
4. SSE 断线重连由显式 `Last-Event-ID` 管理，且重连后事件不重复、不丢失（复用 RFC-010 的断言）
5. 首屏可交互时间 ≤ 2 秒（本机、无缓存、Playwright 测量，取 5 次中位数）
6. 首屏加载的 JS 中不含复盘页与流式渲染模块的标识（打包产物断言）
7. 客户端产物中不含任何 LLM 调用代码或密钥字符串（OPS-4）
8. 首屏不发起任何 AI 调用：从页面加载到「开始一局」按钮可点击期间，网络请求中不含 `/api/games`（Playwright 断言）

## 6. 边界与测试

- **不做**：真正的跨浏览器降级实现。目标浏览器不支持时代码路径是「告知」，不是「兼容」。
- **不做**：移动端真机测试。响应式由 RFC-012 的视口断言覆盖，真机验证建议手工做一次。
- **测试**：`tests/e2e/browsers.spec.ts` 用 Playwright projects；首屏预算用 `tests/perf/` 下的独立用例，不计入常规 `pnpm test`（它需要构建产物）。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-016-1 | 是否必须覆盖 Edge 独立测试 | **(assumption)** 不必须；Edge 与 Chrome 同引擎，按 Chromium 覆盖 |
| Q-016-2 | 首屏预算的测量环境 | **(assumption)** 本机开发环境，与 NFR-8 一致；不设 CI 机器基准 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-012 已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 入口 | **A 方案**（用户选）：`/` 是**首页**（介绍 + 「开始一局」），首屏不碰后端 |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | `?seed=` 仍然自动开局，`?home=1` 强制停在首页 | e2e 需要固定种子直接进对局；首页是默认入口（AC-8） |
| **D-2** | 对局页**懒加载**（`await import('./App')`），复盘页再懒加载一层 | 首页 chunk 因此不含流式接口与复盘标识（AC-6） |
| **D-3** | 能力不足只显示提示，不写降级实现 | RFC §2.1 的明确取舍：降级路径没人维护更危险 |
| **D-4** | Edge 不单独跑，按 Chromium 引擎覆盖 | Q-016-1 的假设，记录于此（AC-2） |
| **D-5** | 首屏预算用独立 Playwright 配置（`playwright.perf.config.ts`，端口 4179） | 它需要构建产物与稳定服务，不能混进 `pnpm test`（§6） |
| **D-6** | 首屏用**墙钟时间**测到「按钮可点击」，不是页内 `performance.now()` | 用户感知的是从导航到能点的那段时间；两者差在导航与脚本启动，墙钟更接近体感（C-214） |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 客户端新增 | `src/client/capabilities.ts`、`src/client/pages/Home.tsx` |
| 客户端修改 | `main.tsx`（能力探测、首页路由、对局页懒加载）、`App.tsx`（复盘页懒加载） |
| 配置 | `playwright.config.ts`（三引擎 projects）、`playwright.perf.config.ts`、`package.json`（`test:perf`）、`RULES.md` §3 命令表 |
| 服务端脚本 | `scripts/e2e-server.ts`（支持 `--port=`，供 perf 用） |
| 文档 | `RFCS.md`、`README.md`、`TEST-STRATEGY.md` |
| 测试 | `tests/e2e/browsers.spec.ts`、`tests/perf/first-paint.spec.ts`、`tests/client/capabilities.test.ts`、`tests/meta/build.test.ts`（产物扫描） |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `browsers.spec.ts` 在 Chromium / Firefox / WebKit 三引擎各跑一遍（共 16 条 e2e） | PASS |
| 2 | Edge 不单独跑（D-4，已记录） | PASS（取舍） |
| 3 | e2e 用 `addInitScript` 摘掉 `EventSource`，断言中文提示与不白屏；关掉能力判断会红 | PASS |
| 4 | SSE 重连由显式 `Last-Event-ID` 管理（RFC-010 已覆盖） | PASS |
| 5 | `tests/perf` 5 次中位数 ≤ 2s（实测约 400ms 内） | PASS |
| 6 | 入口 chunk 不含 `复盘时间线` / `/stream` / 模型地址；静态 import 复盘页会红 | PASS |
| 7 | 客户端产物不含 `api.deepseek` / `DEEPSEEK_API_KEY` | PASS |
| 8 | 首页加载到「开始一局」可点期间**没有任何 `/api/` 请求**（e2e 断言） | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 89 files / 771 tests
$ pnpm test:e2e → 16 passed（Chromium 12 + Firefox 2 + WebKit 2）
$ pnpm test:perf → 3 passed
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 真机 Safari / Firefox | Playwright 的 WebKit 是近似，不是真 Safari | 手工验收建议 |
| 移动端真机 | RFC §6 明确不做 | — |
| CI 机器基准 | Q-016-2 假设本机环境，不设 CI 基准 | — |

### 8.7 Round 1 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-205** Chromium 没跑 `browsers.spec.ts` | `testIgnore` 把 Chromium 的跨浏览器用例排除了，所谓「三引擎」只有两台 | 去掉 `testIgnore`：Chromium 跑全部用例，Firefox/WebKit 只跑 `browsers.spec.ts`；现在 16 条 e2e |
| **C-206** 首屏测的是 warm cache | 5 次样本共用一个 context；用 `visible` 代替可点击；测 `?home=1` | 每次**全新 context**（无 HTTP 缓存）、测默认 `/`、按钮 `toBeEnabled`；并断言**每次**样本都真的下载了入口 JS（> 50KB）。退回 warm context 会红 |
| **C-207** 首页仍请求 `/api/session` | 违反用户批准的「首屏不碰后端」 | 会话请求移到真正开局时（首页与 `?seed=` 之前的建局前）；e2e 断言首页期间**没有任何 `/api/` 请求**，加回 session 会红 |
| **C-209** `test:perf` 未登记 | OPS-2 的固定命令表没有它 | `RULES.md` §3 增加 `pnpm test:perf` 一行；RFC §8.3 补文件清单 |
| **C-208** 模型地址只扫入口 chunk | 把 `api.deepseek` 放进复盘 chunk 仍绿 | `tests/meta/build.test.ts` 扫 `dist/client` 全部产物（`api.deepseek.com` / `DEEPSEEK_API_KEY` / `openai` / `/chat/completions`）；perf 也扫全部 chunk |
| **C-210** 文档漂移 | TEST-STRATEGY 六行仍 `proposed`、README 仍 15 个 RFC、§8.3/§8.4 不实 | 全部同步 |
| **C-211 / C-212** | `?home=1` 不优先；首页无样式 | `?home=1` 优先于 `?game=`；补 `.home` / `.fallback` 样式；`Home` 检查 `/play` 响应 |

```
$ pnpm test → 90 files / 775 tests
$ pnpm test:e2e → 18 passed
$ pnpm test:perf → 3 passed
```

### 8.8 Round 2 回应（Reviewed）

Round 2 无阻塞项。顺手补了评审提到的非阻塞：

| 项 | 处理 |
|---|---|
| **C-210** 文档残留 | TEST-STRATEGY 的「RFC-016 待实现」与文件引用、README 的「占位页」、RFC §8.5 数字、§8.3 文件清单全部同步 |
| **C-213** 默认入口没有 e2e 锁 | `game.spec.ts` 增加「默认 `/` 是首页、首屏无 `/api/` 请求、点开始才进对局」用例 |
| **C-214** 测量方式与 RFC §4 的措辞 | 记录为 D-6：用墙钟时间测「到可点击」，而不是页内 `performance.now()`——用户感知的是前者 |
| **C-215** 英文网络错误文案 | 保留原始错误（排查用），由 `role="alert"` 呈现；后续可换成人话 | 非阻塞 |

```
$ pnpm test → 89 files / 771 tests
$ pnpm test:e2e → 17 passed
$ pnpm test:perf → 3 passed
```
