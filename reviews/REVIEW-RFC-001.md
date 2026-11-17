# RFC-001 评审 · 工程骨架与共享契约

> **评审会话**：新会话（未参与 RFC-001 的实现）
> **日期**：2026-11-17
> **分支 / HEAD**：`rfc/001-project-scaffold-and-shared-contracts` / `c380a20`
> **结论**：**Changes requested**
> **整体风险**：**Medium**（当前可运行功能没有崩溃级缺陷；共享契约的静态约束有缺口，会被后续 15 个 RFC 继承）

---

## 0. STEP 0 · 实际执行结果

### 0.1 环境

```
$ node -v
v22.22.2
$ pnpm -v
10.33.0
```

### 0.2 四条门禁（真实输出）

```
$ pnpm typecheck
> howl@0.0.0 typecheck /Users/chenxin/Desktop/project/dsh-project/howl
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0  (3.27s)
```

```
$ pnpm lint
> howl@0.0.0 lint /Users/chenxin/Desktop/project/dsh-project/howl
> eslint .
EXIT 0  (0.85s，无诊断输出)
```

```
$ pnpm test
> howl@0.0.0 test /Users/chenxin/Desktop/project/dsh-project/howl
> vitest run

 RUN  v5.1.0 /Users/chenxin/Desktop/project/dsh-project/howl

 ✓ |unit| tests/security/no-hardcoded-terms.test.ts (2 tests) 4ms
 ✓ |unit| tests/shared/terms.test.ts (6 tests) 4ms
 ✓ |unit| tests/dependency-direction.test.ts (5 tests) 4ms
 ✓ |unit| tests/shared/effects.test.ts (5 tests) 5ms
 ✓ |unit| tests/shared/contracts.test.ts (9 tests) 7ms
 ✓ |unit| tests/server/health.test.ts (2 tests) 59ms
 ✓ |meta| tests/meta/commands.test.ts (5 tests) 6356ms
   ✓ AC-1 · 五条命令 (5)
     ✓ pnpm typecheck 退出 0 3140ms
     ✓ pnpm lint 退出 0 599ms
     ✓ pnpm test 的单元与集成部分退出 0 567ms
     ✓ pnpm build 退出 0 515ms
     ✓ pnpm start 起得来、能响应健康检查、能被关掉 1533ms
 ✓ |meta| tests/meta/dev-proxy.test.ts (1 test) 1802ms
   ✓ AC-12 · Vite 开发代理 (1)
     ✓ 直连 3000 与经 5173 代理都返回 200 与 {"ok":true} 1800ms
 ✓ |meta| tests/meta/tsconfig.test.ts (13 tests) 2496ms
   ✓ AC-4 · 五个严格开关 (6)
     ✓ strict 开启时夹具编译失败、关闭时通过 463ms
     ✓ noUncheckedIndexedAccess 开启时夹具编译失败、关闭时通过 498ms
     ✓ exactOptionalPropertyTypes 开启时夹具编译失败、关闭时通过 563ms
     ✓ noImplicitOverride 开启时夹具编译失败、关闭时通过 483ms
     ✓ verbatimModuleSyntax 开启时夹具编译失败、关闭时通过 485ms
 ✓ |meta| tests/meta/lint.test.ts (4 tests) 2215ms
   ✓ AC-14 · ESLint 规则等级 (2)
     ✓ pnpm lint 退出 0 1206ms
   ✓ AC-15 · 格式化与 e2e 门禁 (2)
     ✓ pnpm format:check 退出 0 568ms
 ✓ |meta| tests/meta/build.test.ts (4 tests) 538ms
   ✓ AC-13 · 构建产物 (4)
     ✓ pnpm build 退出 0 535ms
 ✓ |meta| tests/meta/selfplay-placeholder.test.ts (1 test) 348ms
   ✓ AC-16 · selfplay 占位 (1)
     ✓ 以退出码 1 结束，且提示指向 RFC-015 347ms

 Test Files  12 passed (12)
      Tests  57 passed (57)
   Duration  14.53s
EXIT 0
```

```
$ pnpm build
> howl@0.0.0 build /Users/chenxin/Desktop/project/dsh-project/howl
> vite build && vite build --config vite.server.config.ts

vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 74ms
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
✓ built in 9ms
EXIT 0  (0.46s)
```

复核：完成下面的变异探针后我又重跑了一次，四条命令仍是 `typecheck 0 / lint 0 / test 57 passed / build 0`，工作树干净。

### 0.3 其他验收相关命令

```
$ pnpm format:check
All matched files use Prettier code style!
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1

$ node scripts/verify-skills.mjs
OK：21 个固化技能与 lock 一致
EXIT 0
```

生产产物探活（独立于测试，端口 3998）：

```
$ PORT=3998 node dist/server/index.js
Server listening at http://127.0.0.1:3998
GET /api/health  -> 200  {"ok":true}
GET /             -> 200  <!doctype html>...
$ grep -c '@shared/' dist/server/index.js        -> 0
$ grep -rl DEEPSEEK_API_KEY dist/client | wc -l  -> 0
$ grep -rl '@fastify/static' dist/client | wc -l -> 0
```

### 0.4 未验证项

`pnpm install` 的“全新安装”没有在本会话重新验证：

```
$ pnpm install --frozen-lockfile --offline
ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY  Aborted removal of modules directory due to no TTY
EXIT 1
```

这说明 pnpm 在当前 `node_modules` 上要求先清理模块目录再装（原因未进一步诊断）；我**没有**强制清理，以免破坏评审用的可运行环境；因此“从零 `pnpm install` 后四条命令仍通过”这一点是 **unverified**。现有安装上的四条门禁是实际跑过的。

---

## 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-001 只交付工程骨架、共享类型与健康检查，没有任何游戏循环或 UI，因此：

| 适用 | 本 RFC 的检查 |
|---|---|
| 数据模型 / 契约 | 共享类型、Zod schema、依赖方向 |
| 安全 | 密钥不出现在客户端产物、输入校验契约 |
| 构建与运行 | 五条命令、产物、静态托管 |
| 测试 | 16 条 AC 的覆盖与门禁 |

**显式跳过**（本 RFC 无对应实现，跳过不是遗漏）：

| 跳过 | 理由 |
|---|---|
| 核心循环 / 难度 / 进度 | 无游戏逻辑，`reduce` 在 RFC-002 |
| 响应式 / 无障碍 / 浏览器矩阵 | 无用户可见功能，TEST-6 从 RFC-012 起 |
| 首屏性能预算 | 占位页，性能预算在 RFC-016 |
| 帧率 / 音视频 | 纯文字、回合制，PRD 已声明不适用 |

---

## 2. 16 条 AC：如果行为回退，哪个测试会红？

> 这一节不只读测试名。除逻辑推导外，我还做了 13 个临时变异探针（改文件 → 跑定向测试 → 恢复），探针结束后工作树为 clean。`✅` 表示探针或类型检查确实变红；`⚠️` 表示存在“改了也不会红”的路径。

| AC | 负责的测试 | 回退时会发生什么 | 结论 |
|---|---|---|---|
| 1 五条命令 | `tests/meta/commands.test.ts` 5 例 + 外层 `pnpm test` | 命令改为非 0 会让对应 case 红；`start` 起不来会让探活红 | ✅（`pnpm test` 内层只跑 `--project unit`，见 T-4） |
| 2 package 字段 | `tests/meta/tsconfig.test.ts` AC-2 | 删 `packageManager` / 改 `engines` / 改 `type` 都会红 | ✅ |
| 3 三份 tsconfig | 同上 AC-3 | 删文件、改根 `target` / `moduleResolution`、子配置覆盖这两个字段都会红 | ✅（“只覆盖 include/lib/types”只验证了两个字段，见 5.2） |
| 4 五个严格开关 | 同上 AC-4 + 5 份两向夹具 | 根配置关任一开关会红；夹具在开关关闭时会通过 | ✅（C-11 已批准该改写） |
| 5 Phase 恰 14、potion 恰 3 | `tests/shared/contracts.test.ts` | 运行时增删 `PHASES` / `WITCH_POTIONS` 会红；**但只改类型、不改数组不会红** | ⚠️ 探针 M1：给 `Phase` 联合再加一个类型成员后 `typecheck` 仍 0 |
| 6 Effect.target 必填、order 四分区 | `tests/shared/effects.test.ts` | 把 `target` 改可选会让 `@ts-expect-error` 变成未使用指令，`typecheck` 红（M3 证明机制）；**去掉 `as const` 不会红** | ⚠️ 探针 M2：删 `EFFECT_ORDER` 的 `as const` 后 `typecheck` 仍 0 |
| 7 EventEnvelope 三字段必填 | `tests/shared/contracts.test.ts` AC-7 | 把 `visibleTo` 改可选会让 `@ts-expect-error` 变未使用，`typecheck` 红（M3） | ✅ |
| 8 术语表 13 条、身份名 | `tests/shared/terms.test.ts` | 删/换键、改标签、空定义都会红；测试自己保存了 PRD 的副本，PRD 改了测试不会自动跟 | ✅（有“测试与 PRD 双份维护”风险，见 5.3） |
| 9 五个身份名不得硬编码 | `tests/security/no-hardcoded-terms.test.ts` | 在 `src/` 写 `'狼人'` 会让测试红 | ✅ 探针 M4 |
| 10 shared 无跨层 import、除 zod 无运行时依赖 | `tests/dependency-direction.test.ts` | 静态 `@server/*` alias 会让测试红（M6）；**动态 `import('@server/app')` 不会红** | ⚠️ 探针 M5：动态 import 通过全部 5 个断言 |
| 11 client/server/engine 方向 | 同上 | 静态 alias 方向会红；engine 当前不存在所以相关断言恒真；动态 import 同样绕过 | ⚠️ 探针 M7 证明 engine 文件一出现静态检查会红；M5 的动态绕过仍存在 |
| 12 health 直连与 Vite 代理 | `tests/server/health.test.ts` + `tests/meta/dev-proxy.test.ts` | 删代理后探针 M12 红；删 health 路由两处都红 | ✅ |
| 13 构建产物与密钥扫描 | `tests/meta/build.test.ts` | 产物缺失时探针 M13 红；客户端出现密钥字符串会红 | ✅ |
| 14 ESLint 两条规则 error + lint 通过 | `tests/meta/lint.test.ts` | 把规则降为 warn 会红；**配置只留 `**/*.ts`、去掉 `**/*.tsx` 不会红** | ⚠️ 探针 M8 |
| 15 format:check 与 e2e skipped | `tests/meta/lint.test.ts` AC-15 | format 失败会红；**把 `skipped` 文案改成 `done` 不会红**（测试只看退出码） | ⚠️ 探针 M9 |
| 16 selfplay 退出 1 且提示未实现 | `tests/meta/selfplay-placeholder.test.ts` | 退出 0 会红；**只留 `RFC-015`、删掉「未实现」不会红** | ⚠️ 探针 M10 |

**统计**：16 条中 9 条有“回退必红”的直接证据，7 条存在无法变红的路径（AC-5/6/10/11/14/15/16）。这不是说代码现在坏了，而是说“测试通过”不能推出“AC 被守住”。

### 2.1 变异探针明细

| 探针 | 改动 | 运行 | 结果 |
|---|---|---|---|
| M1 | `Phase` 类型加 `'EXTRA_PHASE'`，数组不变 | `pnpm typecheck` | **exit 0 → 缺口** |
| M2 | 删除 `EFFECT_ORDER` 的 `as const` | `pnpm typecheck` | **exit 0 → 缺口** |
| M3 | `EventEnvelope.visibleTo` 改可选 | `pnpm typecheck` | exit 2（未使用 `@ts-expect-error`）→ AC-7 有覆盖 |
| M4 | 新增 `src/__mutation_hardcoded.ts` 含 `'狼人'` | security test | exit 1 → AC-9 有覆盖 |
| M5 | 新增 `src/shared/__mutation_dynamic.ts` 动态 import `@server/app` | dependency test | **exit 0 → 缺口** |
| M6 | 新增 shared 静态 import `@server/app` | dependency test | exit 1 → AC-10 有覆盖 |
| M7 | 新建 `src/engine/__mutation_engine.ts` 静态 import `@server/app` | dependency test | exit 1 → AC-11 引擎部分有覆盖（一旦目录存在） |
| M8 | ESLint `files` 删掉 `**/*.tsx` | lint meta test | **exit 0 → 缺口** |
| M9 | `scripts/test-e2e.mjs` 的 `skipped` 改成 `done` | lint meta test | **exit 0 → 缺口** |
| M10 | `scripts/selfplay.ts` 只打印 `RFC-015` | selfplay test | **exit 0 → 缺口** |
| M11 | 新建 `EventEnvelope` 对象，`type: 'NOT_A_REAL_EVENT'` | `pnpm typecheck` | **exit 0 → 缺口** |
| M12 | 把 Vite proxy 的 `/api` 改成 `/api2` | dev-proxy test | exit 1（Vite 返回 HTML，JSON 断言失败）→ AC-12 有覆盖 |
| M13 | `vite.server.config.ts` 改 `outDir` 并删 `dist/server` | build test | exit 1（缺少 `dist/server/index.js`）→ AC-13 有覆盖 |

---

## 3. 评审维度

### 3.1 RFC 遵循 · **NEEDS WORK**

已批准的偏离 C-9 / C-10 / C-11 / C-12 都确实记在 RFC §8.2 与 `RFCS.md` §8.1，且理由成立：

- C-9（Vite SSR 打包）有实证：`dist/server/index.js` 中 `@shared/` 计数为 0，`pnpm start` 能起。
- C-10（`schemas.ts` 只做信封 + `ActionSchema`）是合理的范围收窄，但**没有覆盖“事件 type 必须是 `GameEventMap` 成员”这一条**。
- C-11（两向夹具）确实比原文的“关闭 → 报错”更强；测试日志里的五个夹具都实际跑过并通过，五个严格开关各自有“开启必失败、关闭必通过”的证据。
- C-12（四个 order 区间）正确，且测试断言了 0/100/200/900。

**F1（阻塞）· 事件类型/载荷没有静态绑定，DATA-2 实际未强制**

`src/shared/events.ts:23` 的 `EventEnvelope<T extends string = string, P = unknown>` 默认接受任意字符串与任意 payload；`src/shared/events.ts:71` 的 `GameEventMap` 与 `:91` 的 `GameEventType` 在 `src/`、`tests/` 里没有任何引用。`src/shared/schemas.ts:109-122` 的 `EventSchema` 也只校验 `type: z.string().min(1)`。结果是：

```ts
const bogus: EventEnvelope = {
  gameId: 'g', seq: 1, ts: 0,
  type: 'NOT_A_REAL_EVENT',   // 编译通过
  visibleTo: 'public', payload: {},
};
```

探针 M11 证明 `pnpm typecheck` 仍为 0。RFC §2.3 正文要求“事件 `type` 必须是下面这个联合的成员（DATA-2），payload 形状由 `GameEventMap` 约束”，但实现只满足了同一节代码块里的宽泛默认值。这是 RFC 内部“代码块 vs 正文”的矛盾（已登记为 `RFCS.md` C-15）；不能静默按代码块裁决。建议至少补：

```ts
export type GameEvent = {
  [K in GameEventType]: EventEnvelope<K, GameEventMap[K]>;
}[GameEventType];
```

并加一条 `@ts-expect-error`（未知 type / 错误 payload）夹具；如果 `EventSchema` 要承担出站校验，再补一个运行时可枚举的 type 列表。C-10 只批准“payload schema 延后”，没有批准“type 成员资格延后”。

**F2（阻塞）· `ActionSchema` 没有实现 §2.3 的 potion/target 约束**

`src/shared/schemas.ts:65-71` 把 `WITCH_ACT` 写成 `potion` 与可选 `target` 的扁平对象。以下都被接受：

```
WITCH_ACT potion=none target=2  => true   // §2.3 要求 none 与省略 target 配套
WITCH_ACT potion=heal 无 target => true   // heal 需要目标
WITCH_ACT potion=poison 无 target => true
```

`Action` 类型本身（`src/shared/actions.ts:24`）也没有把这两个分支区分开。`tests/shared/contracts.test.ts:138-146` 只测了非法 potion、非法座位、缺 ts，没有测 potion/target 组合。C-10 明确把 `ActionSchema` 纳入本 RFC，因此这是契约未完成，而不是“等引擎再管”。

**F3（阻塞）· AC-5 / AC-6 的类型层要求没有测试**

- M1 证明 `Phase` 加第 15 个类型成员后，运行时 14 项断言与 `@ts-expect-error 'NIGHT_MOON'` 都仍然通过。
- M2 证明删掉 `EFFECT_ORDER` 的 `as const` 后，四个数字断言仍然通过。

AC-5/AC-6 的要求是类型层的；当前测试主要是运行时数组断言。建议用 `expectTypeOf`（Vitest）或类型层夹具把 `Phase` 与 `(typeof EXPECTED_PHASES)[number]` 做等值断言，并对 `EFFECT_ORDER` 加“必须是字面量 0/100/200/900”的 `@ts-expect-error` 夹具。

**F4（阻塞）· AC-15 没有断言 `skipped` 文案**

`tests/meta/lint.test.ts:51-55` 只断言 `pnpm test:e2e` 退出 0。M9 把 `scripts/test-e2e.mjs:38` 的输出改成 `done` 后测试仍全绿。AC-15 的核心正是“零用例时打印 skipped，而不是静默成功”；应断言 stdout 含 `skipped`。

**F5（阻塞）· 依赖方向检查可被动态 import 绕过**

`tests/dependency-direction.test.ts:67-77` 只匹配 `from '…'` 和行首 `import '…'`，不匹配 `import('…')`。M5 在 `src/shared/` 放入 `return import('@server/app')` 后，5 个断言全部通过。ARCH-2 / AC-10/11 要求“静态检查断言依赖方向”，动态 import 仍是 import。建议用 TypeScript AST（或至少补 `import\s*\(` 与 `require\s*\(` 的扫描），并加一条夹具。

**F6（记录/流程，阻塞到 Reviewed 前）· ARCH-2 与 STYLE-2 的冲突没有登记到 `RFCS.md`**

- `RULES.md:127` 的 ARCH-2 说 `src/shared/` “只放类型与纯常量”，但 `src/shared/visibility.ts` 有运行时逻辑、`src/shared/schemas.ts` 还构造 Zod schema。RFC-001 的 Q-001-2 只对 `visibility.ts` 作了 assumption；`schemas.ts` 是第二处运行时逻辑，RFC §2.3/§4“唯一带逻辑的文件”这句话与实现不符。
- `RULES.md:210` 的 STYLE-2 要求常量 SCREAMING_SNAKE_CASE，而 RFC §2.3 指定 `TERMS` / `ROLE_LABELS` / `ActionSchema` / `EventSchema`。实现按 RFC 保留这些名字（这是正确的工程选择，本 RFC 的测试与实现都使用它们），但只写在 RFC §8.3，**没有登记到 `RFCS.md` 的 `## Open conflicts`**。
- **小事实错误**：RFC §8.3 的 `316` 行说“后 15 个 RFC 的正文都在引用它们”，实际只有 RFC-012 与 RFC-010 引用 `terms.ts`；没有任何 RFC 按名字引用 `ActionSchema` / `EventSchema` / `TERMS` / `ROLE_LABELS`。保留这四类名字的理由是“RFC 指定 + 本 RFC 测试使用”，不是“所有 RFC 都按名字引用”。Implementation Notes 应改正这句，否则是为命名偏离提供了一个不成立的论据。

按 `AGENTS.md` 硬规则 7，这两项必须在 `RFCS.md` 里登记，并说明“实现跟了哪个、另一个怎么修”。F6 的两项已补为 C-13 / C-14；F1 已补为 C-15。

**F7（非阻塞）· `GameEventMap` 之外的共享常量没有直接断言**

`FACTION_OF`（`src/shared/domain.ts:32-38`）、`SEAT_IDS`（`:12`）、`WIN_MODES`（`:23-24`）、`FACTIONS`（`:19-20`）、`EFFECT_SOURCES`（`src/shared/effects.ts:3-4`）、`SELF_VISIBILITY_PREFIX`（`src/shared/events.ts:21`）没有专门的断言。尤其 `FACTION_OF` 的 value 写错（例如 `seer: 'wolf'`）仍然满足 `satisfies Record<Role, Faction>`，当前没有测试会红。建议为这些契约常量各加一行断言。

**F8（非阻塞）· F43 的“全部术语”只守了 5 个身份名**

`tests/security/no-hardcoded-terms.test.ts:18-19` 的 `ROLE_WORDS` 只来自 `ROLE_LABELS`。`FEATURES.md` F43 要求“全部术语与 PRD 术语表一致”“术语表是唯一来源，代码中不重复定义字符串”；当前测试挡不住组件里硬编码“屠边”“悍跳”等 `TERMS` 的其余 13 个术语（以及 5 个身份名之外的文案）。RFC 的 AC-9 只要求五个身份名，所以这是 RFC 与更高层 FEATURES 的覆盖差，不是 AC-9 的字面失败。建议把扫描集合扩展为 `TERMS` 的 label + `ROLE_LABELS`（排除 `terms.ts`），或在 RFC-012 的 UI 落地前补上。

### 3.2 RULES 遵循 · **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| ARCH-1（engine 不 import UI/网络/DOM） | engine 尚不存在；`tsconfig.server.json` 的 `lib: ["ES2022"]` 会在 engine 出现后守住 DOM，依赖测试会守住 alias（M7）。**当前无法完全验证**，与 §8.6 一致 |
| ARCH-2（shared 只放类型/纯常量） | **冲突**，见 F6；`schemas.ts` 是运行时逻辑，`visibility.ts` 也是 |
| ARCH-3 / ARCH-4 | 本 RFC 不涉及状态转移；`GameState` 是纯数据接口；没有时钟读取。**N/A** |
| ARCH-5 ~ ARCH-11 | 规则引擎未实现，**N/A**（ARCH-8 的签名冲突已由 C-7 登记，另案） |
| AI-1 ~ AI-9 | 无 LLM 代码，**N/A** |
| SEC-1 | `DEEPSEEK_API_KEY` 不在源码/客户端产物；`dist/client` 扫描 0。**PASS** |
| SEC-2 | 只扫了密钥字符串与 `@fastify/static`；完整服务端模块泄漏检查按 §8.6 留给 RFC-016。**部分** |
| SEC-3 / SEC-4 | 无玩家输入端点；`ActionSchema` 的语义校验缺口见 F2。**N/A（当前表面）/ 契约需修** |
| SEC-5 / SEC-6 | 无对局视图、无真相视图，**N/A** |
| SEC-7 | 无 LLM 错误响应，**N/A** |
| DATA-1 / DATA-2 | `EventEnvelope` 有 `seq`/`ts`；DATA-2 未强制，见 F1。**FAIL（DATA-2）** |
| DATA-3 ~ DATA-6 | 重放、PRNG、释放均未实现，**N/A**（RFC-002 起） |
| API-1 | `ActionSchema` / `EventSchema` 存在，但 action 语义与 event type 未校验；见 F1/F2。**部分** |
| API-2 / API-3 | 无 SSE、无状态变更端点，**N/A** |
| UI-1 ~ UI-5 | 只有占位页，**N/A**（TEST-6 从 RFC-012 起） |
| A11Y-1 ~ A11Y-4 | 占位页有 `<main>`，但没有交互元素可测；**N/A** |
| TEST-1 | 7 条 AC 的测试存在“不会红”路径（§2），**部分** |
| TEST-2 | engine 未实现，覆盖率门槛尚不适用；**N/A** |
| TEST-3 ~ TEST-4 | engine 未实现；当前测试不发起模型网络请求，**N/A** |
| TEST-5 | 四条门禁实跑通过；**PASS** |
| TEST-6 | 从 RFC-012 起（T-1）；当前 `test:e2e` 正确 skipped；**按计划延后** |
| OPS-1 / OPS-2 / OPS-4 / OPS-5 | 包管理器、脚本名、生产构建、Node 版本均符合；OPS-4 的“完整服务端模块扫描”见 SEC-2 部分。**PASS（部分 OPS-4）** |
| OPS-3 | `selfplay` 仍以 1 退出，是已批准的 C-5 临时偏离；**待 RFC-015 消除** |
| STYLE-1 ~ STYLE-7 | 文件 kebab-case、无 `any` / 非空断言、无 TODO、文件均 < 400 行；`ActionSchema` 等命名与 STYLE-2 的冲突见 F6。**PASS（F6 例外）** |
| DOC-1 | C-9 ~ C-12 已记录；F1/F2/F6 的偏离/冲突没有完整记录。**部分** |
| DOC-2 | `package.json` 依赖与 RULES §2 的版本一致；未提前安装 `openai` / `@fastify/cookie` / `jsdom` 等，符合 RFC §8.3 的延后安排。**PASS** |

### 3.3 安全 · **PASS（当前表面）/ 契约有风险**

- 密钥：源码与 `dist/client` 均无 `DEEPSEEK_API_KEY`；SEC-1 当前通过。
- 静态托管：`@fastify/static` 只托管 `dist/client`，`GET /` 返回 index.html，未见路径穿越配置错误；本 RFC 只有健康检查，未暴露对局状态。
- 输入校验：没有 HTTP action 端点，所以没有当前可利用面；但 `ActionSchema` 的语义缺口（F2）会让未来的入站校验接受 `potion:'none'` 带目标、`heal` 无目标。按 SEC-4 / AI-4 的意图，应在契约层拒掉。
- 数据泄露：健康检查只返回 `{ok:true}`；无 LLM、无日志中的密钥。SEC-7 仍 N/A。
- 依赖：`pnpm-lock.yaml` 存在，版本与 RULES §2 对齐；未做 `pnpm audit`（不在本次要求内）。

**结论**：当前可运行表面没有安全漏洞；F2 是契约层安全/校验风险，已在 3.1 标为阻塞。

### 3.4 性能 · **PASS / 大部分 N/A**

本 RFC 没有游戏循环、没有 LLM、没有数据查询。可测量的只有构建与启动：

- `pnpm build` 0.46s；客户端 219.65 kB（gzip 68.71 kB）；服务端 1.25 kB。
- 生产 `start` 后健康检查 200；静态首页 200。
- 没有缓存、N+1、无界抓取等可评审代码。

**结论**：PASS；游戏延迟与首屏预算分别在 RFC-010/012/016 验收。

### 3.5 可维护性 · **NEEDS WORK**

**做得好的地方**：

- 共享类型集中、命名清楚，`as const satisfies` 的用法正确。
- 文件都在 400 行以内；无 `any`、无非空断言、无被注释掉的代码。
- 测试组织成 `unit` / `meta` 两个 project，递归问题（T-4）有意识地被隔离。
- 构建配置有单一 alias 来源（`configs/alias.ts`），C-9 的 Vite SSR 方案有实证。

**问题**：

1. **`configs/alias.ts:10-11` 的注释不实**：它说 `tests/meta/tsconfig.test.ts` 会断言 alias 与 tsconfig `paths` 一致；实际没有任何测试做这件事。§8.6 也承认这是手工核对。当前两边值确实一致（我逐项比对过 `@shared/@engine/@server/@client`），但注释会误导后来者。**非阻塞，修注释或补一行测试。**
2. **`playwright.config.ts:13` 的 `baseURL` 用 `127.0.0.1`，而 `tests/meta/dev-proxy.test.ts:16-19` 明确记录 Vite 在 macOS 上默认只监听 `::1`，所以本仓库自己的代理测试用 `localhost`。RFC-012 一旦加 Playwright 用例，`127.0.0.1:5173` 可能连不上。建议统一为 `localhost`，或在 `vite.config.ts` 设 `host: '127.0.0.1'`。**非阻塞（RFC-001），但会在 RFC-012 爆。**
3. **`TEST-STRATEGY.md` 已明显滞后**：§0 仍写“当前不存在任何测试套件”“0 条已实现”，RFC-001 小节所有 `Exists?` 仍是 `proposed`；该小节的 AC-4 仍写“关闭 strict 断言报错”（C-11 已推翻）、AC-6 仍写“三个分区”（C-12 改为四个）、AC-10/11 仍写 `tests/meta/dependency-direction.test.ts`（T-6 改为 `tests/`）、AC-12 仍写 Playwright（T-5 改为 HTTP）。实现 Notes 说“TEST-STRATEGY §7 T-4~T-7”已更新，但表格本身没有回填。**非阻塞文档缺口，但会误导下一次实现。**
4. **`tests/meta/tsconfig.test.ts:162` 的用例名“子配置只覆盖 include / lib / types”过强**：它只检查 `extends`、`moduleResolution` / `target` 未覆盖、`lib` / `types` 的取值，**`include` 根本没有断言**，也没有检查子配置不能覆盖 `strict` 等。由于根 `tsconfig.json` 包含 `src/**`，实际门禁仍由根配置守住；但测试名与 RFC §8.5 AC-3 的“子配置只覆盖 include/lib/types”都让读者以为边界被完整验证。**非阻塞。**
5. **注释小错**：`tests/meta/commands.test.ts:9` 把递归问题写成 `TEST-STRATEGY.md §7 T-2`（实际是 T-4）；同段说“完整套件的结果由实现会话在 VERIFICATION 里贴”，仓库里没有 `VERIFICATION` 段，实际在 RFC §8.5。`playwright.config.ts:4` 说 e2e 用 `--passWithNoTests` 退出 0，但真正无用例路径是 `scripts/test-e2e.mjs` 直接打印 skipped，未调用 Playwright。**非阻塞，建议一起清掉。**
6. **`README.md:11,36` 的状态在评审后过期**：它原写 “RFC-001 `Implemented`，等待评审” 与“下一步 /review-rfc 001”。评审把 RFC 状态改为 `Changes requested` 后，README 已同步更新，否则下一个人看到的是旧状态。

---

## 4. RFC §8.6 作者列出的已知缺口：逐条判断

| §8.6 缺口 | 判断 | 理由 / 残留风险 |
|---|---|---|
| **别名一致性无自动化断言** | **可接受（非阻塞），但必须修注释** | 当前 `tsconfig.json` 的 `paths` 与 `configs/alias.ts` 的四个键逐项一致（我实际比对过）。缺测试的风险是“改一处忘另一处”；`pnpm build` / `typecheck` 在使用到别名时会暴露大部分漂移，未使用的别名漂移无影响。`configs/alias.ts:10-11` 的注释却声称有测试，必须改成“手工核对/待补测试”，否则是错误信息。建议在 RFC-002 前补一条 3 行断言。 |
| **`src/engine/` 尚不存在** | **可接受** | 目录由 RFC-002 创建；M7 证明一旦有 engine 文件，现有依赖测试会立刻检查 `engine → server` 并变红。AC-11 的 engine 部分当前恒真是 RFC 范围的合理结果，不是隐瞒。 |
| **`isVisibleTo` 行为矩阵在 RFC-005** | **可接受（按 RFC §6），但风险最高的一条** | RFC-001 §6 明确只定义/实现，行为验收在 RFC-005。当前 `isVisibleTo` 没有任何 RFC-001 测试；我用一次手动探针验证了 public/server/wolves/seer/self/diedSeq 的主路径，结果符合 §2.3。风险是这 57 个用例全绿并不代表这个共享函数正确；好在 RFC-005 会补矩阵，且它是纯函数、没有 IO。可接受，但建议 RFC-005 的第一个提交就补矩阵，不要拖到集成阶段。 |
| **TEST-6 的 Playwright 从 RFC-012 起** | **可接受** | RFC-001 没有任何用户可见功能，当前 `test:e2e` 的 skipped 行为正确（AC-15 的文案断言问题见 F4，是测试质量问题，不是这条缺口本身）。T-1 已解释。 |
| **SEC-2 完整产物扫描在 RFC-016** | **可接受（本 RFC 范围）** | AC-13 只要求 `DEEPSEEK_API_KEY`；实现额外扫了 `@fastify/static`。完整服务端模块泄漏检查确实需要 RFC-016 的产物清单。当前 `dist/client` 无密钥、无 fastify 静态模块，符合本 RFC 的最小保证。 |
| **zod 输出与 `Action` 的类型桥接在 RFC-011** | **可接受（但 F2 不在此豁免）** | C-10 / §8.6 允许暂不做“schema 输出类型 = `Action`”的静态桥接，理由是 `exactOptionalPropertyTypes` 与 `.optional()` 的冲突；这个理由成立，且 `@ts-expect-error` 夹具证明了 `Action` 的严格性。**但“potion 与 target 的语义约束”不是输出类型桥接问题，不能用这条缺口豁免**；见 F2。 |

**结论**：六条已知缺口没有一条本身构成阻塞；F1~F6 是作者没有列进 §8.6 的新发现，其中 F1/F2/F5 直接关系共享契约的强度。

---

## 5. 总体结论

### 5.1 风险与摘要

**Overall Risk: Medium。** 工程骨架能装、能跑、能构建、能启动；16 条 AC 的运行时主路径大多有真实测试，C-9 ~ C-12 的偏离也都记录且理由成立。问题集中在两处：**共享契约的静态约束没有闭合**（事件 type/payload、action 语义、依赖方向的动态 import），以及**若干 AC 的测试只验证了较弱的版本**（Phase 类型、`as const`、skipped 文案、`.tsx` 规则）。这些不是“代码跑不起来”，而是“以后改坏了可能没人发现”，对 foundation RFC 来说值得在合并前修。

### 5.2 阻塞项（合并前必须处理）

1. **F1 · 事件类型/载荷没有绑定到 `GameEventMap`**：补 `GameEvent` 映射类型（或等价静态绑定），加负向类型夹具；`EventSchema` 至少不应接受任意 type，或把“type 成员校验”明确登记为带 owner 的偏离。对应 DATA-2、RFC §2.3 正文。
2. **F2 · `ActionSchema` 未实现 `WITCH_ACT` 的 potion/target 约束**：`none` 不得带 target；`heal`/`poison` 必须带 target。类型与 Zod 至少一处要能拒绝，测试要覆盖三种非法组合。
3. **F3 · AC-5 / AC-6 的类型层测试**：M1/M2 证明当前会漏；加 `expectTypeOf` 或 `@ts-expect-error` 夹具，确保 `Phase` 恰好 14 个成员、`EFFECT_ORDER` 保持字面量。
4. **F4 · AC-15 断言 `skipped`**：M9 证明当前只看退出码；断言 stdout 含 `skipped`（以及无 spec 时不调用 Playwright 的事实）。
5. **F5 · 依赖方向测试补动态 import**：M5 证明 `import('@server/app')` 能穿过 shared/engine 边界；补扫描与夹具。
6. **F6 · 登记 ARCH-2 / STYLE-2 冲突并修正 RFC 正文**：已在 `RFCS.md` 补 C-13 / C-14；RFC §2.3/§4 中“`visibility.ts` 是 shared 唯一带逻辑的文件”与 `schemas.ts` 的存在不符，需要改正（或在 §8.3 明确 `schemas.ts` 也是受批准的运行时例外）。§8.3 的“后 15 个 RFC 的正文都在引用它们”也不成立，应改成“RFC 指定 + 本 RFC 测试使用”。若用户认为 ARCH-2 的 zod 子句已经隐含允许 `schemas.ts`，也应把这条解释写进 `RFCS.md`，而不是只留在实现者脑子里。

### 5.3 非阻塞改进

- **F8**：把 `no-hardcoded-terms` 的扫描集合扩展到 `TERMS` 的全部 label（F43）。
- **AC-14 `.tsx`**：在 `tests/meta/lint.test.ts` 对 `src/client/main.tsx` 也调用 `calculateConfigForFile`，防止配置只覆盖 `.ts`（M8）。
- **AC-16 文案**：断言 stderr 含「未实现」或完整「未实现（RFC-015）」（M10）。
- **`playwright.config.ts` 的 baseURL**：改 `localhost` 或固定 Vite host，避免 RFC-012 的 `127.0.0.1` 连不上 `::1`。
- **`TEST-STRATEGY.md` 回填**：§0 的“0 条已实现”、RFC-001 的 `proposed`、AC-4/6/10/12 的旧描述都要按 C-11/C-12/T-5/T-6 更新。
- **`configs/alias.ts` 注释**：删掉“测试会断言”的假声明，或补上断言。
- **`FACTION_OF` / `SEAT_IDS` / `WIN_MODES`**：各补一行契约断言。
- **注释小错**：`commands.test.ts` 的 T-2 → T-4、`VERIFICATION` → RFC §8.5；`playwright.config.ts` 的 `--passWithNoTests` 描述。
- **`README` 状态**：本次评审已同步为 `Changes requested`。
- **`pnpm install` 可复现性**：`--frozen-lockfile --offline` 因 pnpm 的 purge 提示没有执行成功；本会话的结论基于现有 `node_modules`。建议在 CI 或干净目录里补一次 `CI=true pnpm install --frozen-lockfile` 验证。

---

## 6. 没有发现问题的部分（避免只列负面）

- C-9 的 Vite SSR 方案是正确取舍：`tsc` + `paths` + `node dist/server/index.js` 三者确实不能共存；产物中 `@shared/` 为 0 是硬证据。
- C-11 的两向夹具比原文更强；每个严格开关都有“开启必失败、关闭必通过”的实证。
- `src/shared/visibility.ts` 的 `isVisibleTo` 主路径与 §2.3 一致（手动探针：public 真、server 对所有席位假、wolves 只对狼真、seer 只对预言家真、`self:<n>` 只对本人真、`diedSeq <= event.seq` 后不可见）。
- 构建产物、健康检查、Vite 代理、静态托管、`pnpm start` 的端到端链路都实际跑通。
- 引擎/共享契约测试没有联网、没有读真实时钟；`tests/meta/` 的门禁测试只把真实时钟用于子进程与端口等待，不进入规则引擎。`selfplay` 明确失败而不是假装成功；这两点符合项目基调。

---

## 7. 评审结论

**Changes requested。** 工程骨架本身可用，C-9 ~ C-12 的偏离有据；但共享契约的 DATA-2 / action 语义没有闭合，且 7 条 AC 的测试存在“回退不会红”的路径。修完 5.2 的六项后，建议在新一轮评审里重点复跑 M1/M2/M5/M8/M9/M10/M11 的对照，确认缺口真的被补上。

---

## Round 2 -- 2026-11-17

> **评审会话**：新会话（未参与 RFC-001 的实现或 Round 1 评审）
> **分支 / HEAD**：`rfc/001-project-scaffold-and-shared-contracts` / `83928f7`
> **结论**：**Changes requested**
> **整体风险**：**Medium**。代码可运行、门禁全绿，Round 1 的 F2/F3/F4/F5 已真正闭合；但共享契约与三个下游 RFC 的 payload 形状不一致，F1 的 `EventEnvelope` 收紧没有回归夹具，F6 的 RFC 正文仍未改完。

### 0. STEP 0 · 实际执行结果

环境：Node `v22.22.2`、pnpm `10.33.0`、HEAD `83928f7`。以下命令在评审会话的工作树执行，命令结束后的工作树为 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0

$ pnpm lint
> eslint .
EXIT 0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT 0

$ pnpm test
 Test Files  13 passed (13)
      Tests  78 passed (78)
   Duration  12.94s
EXIT 0

$ pnpm build
vite v8.3.8 building client environment for production...
dist/client/index.html                  0.42 kB │ gzip: 0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
vite v8.3.8 building ssr environment for production...
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1
```

生产产物探活（独立于测试，`PORT=3998`）：

```
GET /api/health -> 200  {'ok':true}
GET /              -> 200  index.html
grep -c '@shared/' dist/server/index.js        -> 0
grep -rl DEEPSEEK_API_KEY dist/client | wc -l  -> 0
```

干净检出验证（不是只验证锁文件）：

```
$ D=$(mktemp -d /tmp/howl-clean-XXXXXX)
$ git archive HEAD | tar -x -C "$D" && cd "$D"
$ CI=true pnpm install --frozen-lockfile
Done in 1.2s using pnpm v10.33.0
$ pnpm typecheck -> 0
$ pnpm lint      -> 0
$ pnpm build     -> 0
$ pnpm test      -> 13 passed / 78 passed / 0
```

**未验证**：Windows 上的门禁实跑。仓库的 `run.ts`、`test-e2e.mjs`、alias 测试都写了平台分支，静态阅读未发现必然失败点，但本会话没有 Windows 环境；这一点在 `AGENTS.md` 的跨平台要求下仍是 unverified，而不是“应当没问题”。

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-001 只交付工程骨架、共享类型、健康检查与构建链，没有游戏循环，也没有用户可见功能。因此本轮：

| 检查 | 本 RFC 的落点 |
|---|---|
| 数据模型 / 契约 | `src/shared/` 的 7 个文件、`GameEventMap`、`ActionSchema` / `EventSchema`、依赖方向 |
| 安全 | 密钥不进客户端产物、服务端校验契约、静态托管 |
| 构建与运行 | 五条命令、开发代理、生产产物、干净安装 |
| 测试 | 16 条 AC 的回退敏感性、门禁是否真的会失败 |

**显式跳过**（本 RFC 没有对应实现，不是遗漏）：

| 跳过 | 理由 |
|---|---|
| 核心循环 / 胜负 / 夜间行动 | 没有游戏逻辑，`reduce` / `step` 从 RFC-002 开始 |
| 难度 / 进度 / 新手引导 | 只有占位页，无进度系统 |
| 响应式 / 无障碍 / 浏览器矩阵 | 无用户可见交互，TEST-6 从 RFC-012 起 |
| 首屏性能预算 / 帧预算 | 占位页的 2 秒预算在 RFC-016；无实时渲染 |
| 平台认证 / 账号 / SEO / 离线 / 存档 | PRD 已声明不适用，RFC-001 也没有对应表面 |
| 按资源的授权 | 单人对局，本 RFC 无对局资源端点 |

### 2. 16 条 AC：行为回退时哪个测试会红

除阅读测试外，本轮又做了 24 个临时探针（含变异与当前行为探针；改文件 → 跑定向命令 → 用 `git`/备份恢复）。探针结束后 `git status --porcelain` 为空。下表的“会红”只指**真实的变异探针**或直接的代码推导；没有探针的部分明确标出。

| AC | 负责测试 | 本轮证据 | 结论 |
|---|---|---|---|
| 1 五条命令 | `tests/meta/commands.test.ts` 5 例 + 全量 `pnpm test` | 5 条命令均实跑 0；`start` 用 3999 端口探活后关闭 | **PASS**（`pnpm test` 内层只跑 `--project unit`，T-4 已记录） |
| 2 package 字段 | `tests/meta/tsconfig.test.ts` AC-2 | `packageManager` / `engines.node` / `type` 三个断言 | **PASS** |
| 3 三份 tsconfig | 同上 AC-3 + 别名单一来源 | 改 `paths` 的 `@shared` 目标 → 测试红（P16）；include / lib / types 有断言 | **PASS** |
| 4 五个严格开关 | 同上 AC-4 + 五份两向夹具 | 五个夹具在开启时失败、关闭时通过；根配置五项全开 | **PASS（根配置）/ 子配置有缺口 N1** |
| 5 Phase 恰 14、potion 恰 3 | `tests/shared/contracts.test.ts` | 加第 15 个 `PHASES` 成员 → 测试红（P10）；`expectTypeOf<Phase>()` 做双向等值 | **PASS** |
| 6 Effect.target / order | `tests/shared/effects.test.ts` | 删 `EFFECT_ORDER` 的 `as const` → typecheck 红（P9）；省略 `target` 的夹具编译失败 | **PASS** |
| 7 EventEnvelope 三字段必填 | `tests/shared/contracts.test.ts` AC-7 | 三个字段各有一份 `@ts-expect-error` 夹具；Round 1 的 M3 已证明会红 | **PASS** |
| 8 术语表 13 条 / 身份名 | `tests/shared/terms.test.ts` | 改「悍跳」的 label → 测试红（P11）；键、顺序、定义非空 | **PASS** |
| 9 五个身份名不得硬编码 | `tests/security/no-hardcoded-terms.test.ts` | 在 `src/` 写 `'狼人'` → 测试红（P12） | **PASS**（F43 全量术语仍延后，见 §5） |
| 10 shared 无跨层 import | `tests/dependency-direction.test.ts` | `shared` 里 `import('@server/app')` → 测试红（P5）；静态 import 也会红 | **PASS** |
| 11 三层依赖方向 | 同上 | 白名单方向、相对路径跨层、外部依赖、`node:*` 限制都有断言；`engine` 尚不存在是已知缺口 | **PASS（engine 部分恒真）** |
| 12 health 直连与 Vite 代理 | `tests/server/health.test.ts` + `tests/meta/dev-proxy.test.ts` | 删 health 路由 → 红（P13）；把代理 `/api` 改成 `/api2` → 红（P17） | **PASS** |
| 13 构建产物与密钥扫描 | `tests/meta/build.test.ts` | 干净工作树/干净检出下会红；但改 `vite.server.config.ts` 的 `outDir` 后，旧 `dist/server/index.js` 仍让测试绿（P18） | **PASS（干净树）/ 有陈旧产物缺口 N2** |
| 14 ESLint 两条规则 error | `tests/meta/lint.test.ts` | 删 `**/*.tsx` → 红（P8）；把 `no-explicit-any` 降为 warn → 红（P15） | **PASS** |
| 15 format:check + e2e skipped | 同上 AC-15 | 把 `skipped` 改成 `done` → 红（P6） | **PASS** |
| 16 selfplay 退出 1 + 文案 | `tests/meta/selfplay-placeholder.test.ts` | 只留 `RFC-015`、删掉「未实现」→ 红（P7） | **PASS** |

**统计**：16 条中 11 条在本轮有直接的变异证据（AC-3/5/6/8/9/10/11/12/14/15/16）；AC-7 有 Round 1 的 M3 证据；AC-1/2/4 本轮只做了代码与命令核对，没有变异。AC-4 / AC-13 的**主路径**有测试，但各留了一条未被覆盖的回退路径（N1 / N2）。AC-1 的 `pnpm test` 证据只覆盖 unit project，这是 T-4 的已知递归取舍，不是本轮新发现。

`TEST-STRATEGY.md` 的 RFC-001 小节列出的测试映射全部能在仓库里找到，没有“计划了但仓库里不存在”的项；B3 / N1 / N2 是计划外的新增覆盖，不是已计划却缺失。

#### 2.1 Round 1 探针复跑

| 探针 | Round 1 结果 | Round 2 结果 |
|---|---|---|
| M1 · `Phase` 只加类型成员 | 漏 | **已闭合**：`Phase` 由 `PHASES` 派生，加第 15 个数组项 → P10 红；类型层 `expectTypeOf` 也在 |
| M2 · 删 `EFFECT_ORDER` 的 `as const` | 漏 | **已闭合**：P9 → typecheck 红 |
| M5 · `shared` 里动态 import `@server` | 漏 | **已闭合**：P5 → dependency test 红 |
| M8 · ESLint 配置只留 `**/*.ts` | 漏 | **已闭合**：P8 → lint meta test 红 |
| M9 · `test:e2e` 的 `skipped` 改成 `done` | 漏 | **已闭合**：P6 → lint meta test 红 |
| M10 · selfplay 只留 `RFC-015` | 漏 | **已闭合**：P7 → selfplay test 红 |
| M11 · 直接用 `EventEnvelope` 写假 type | 漏 | **当前行为已闭合**：P0 → typecheck 红（`Type 'NOT_A_REAL_EVENT' is not assignable to keyof GameEventMap`） |
| M11 的回归保护 | — | **仍有缺口**：把默认类型改回 `T extends string = string` 后，P0 仍红是因为夹具用了 `GameEvent`；整套测试与 typecheck **全绿**（P1）。见 B3 |

### 3. Round 1 六个阻塞项的复核

| 项 | 结论 | 证据 |
|---|---|---|
| **F1** 事件 type/payload 绑定 | **代码行为已修，回归测试不完整** | `GameEvent` 映射、`GAME_EVENT_TYPES`、`EventSchema` 枚举都正确；P0 证明 `EventEnvelope` 假 type 现在编译失败。但 P1 证明把默认类型改回 `string` 不会被任何测试发现。另：`EventEnvelope` 的默认 `payload` 仍是 `unknown`，用已知 type + 错误 payload 构造仍可编译（P19），只能靠“构造时必须用 `GameEvent`”的约定；没有静态约束 |
| **F2** `WITCH_ACT` 的 potion/target | **已闭合** | 类型两条分支 + `ActionSchema.refine`；P3 放松 none 分支 → typecheck 红；P4 删 refine → contracts test 红 |
| **F3** AC-5 / AC-6 类型层测试 | **已闭合** | P9 / P10 分别让 `EFFECT_ORDER` 与 `PHASES` 的回归变红；`expectTypeOf` 在 typecheck 中生效 |
| **F4** AC-15 断言 `skipped` | **已闭合** | P6 红 |
| **F5** 动态 import 绕过 | **已闭合** | P5 红；扫描器自身有静态/副作用/动态/`require` 的 6 条回归测试 |
| **F6** ARCH-2 / STYLE-2 冲突与 RFC 正文 | **仍未完全闭合** | C-13 / C-14 已登记，这部分合格；但 `RFCs/RFC-001...:43` 仍写 shared「只含类型与 `as const` 常量，不含运行时逻辑」，与 §3:241「两处运行时逻辑之一」、§4 的「两处」、C-13 和实现直接矛盾。§8.7:437 声称改正了 §2.3，实际没有。`src/shared/visibility.ts:8` 仍写「唯一带运行时逻辑的文件」，`src/shared/events.ts:131` 仍写默认类型是 `type: string` |

### 4. 新发现（Round 2 阻塞项）

#### B1（阻塞，契约）· `GameEventMap` 与下游 RFC 的 payload 不一致

这不是代码跑不起来，而是**共享契约不能被下游按现有 RFC 使用**。三个可以复现的探针：

| 事件 | RFC-001 的 map | 下游 RFC | 探针 |
|---|---|---|---|
| `REJECTED` | `actionType: string`（`src/shared/events.ts:80`） | RFC-002 §2.3 `actionType: Action['type']`（`RFCs/RFC-002...:85-87`） | P21：`actionType: 'NOT_AN_ACTION'` 可编译、exit 0，map 比 RFC-002 宽 |
| `AI_THOUGHT` | `{ reason: string; claim?: unknown; decisionSeq: number }`（`:93`） | RFC-007 §2.5 要求顶层 `{ reason, claimedRole?, claimedChecks?, accuses?, decisionSeq }`（`RFCs/RFC-007...:97-101`）；RFC-006 §2.2 又定义嵌套 `claim: { role?, checks?, accuses? }`（`RFCs/RFC-006...:39-51`）；RFC-009 §2.2 / RFC-014 §2.3 按顶层字段消费 | P22：按 RFC-007 的顶层字段构造 `GameEvent` → typecheck 红（`claimedRole` 不在 map 里） |
| `VOTE_CAST` | `{ seat: SeatId; target: SeatId \| 'abstain' }`（`:89`） | RFC-004 §2.3 写 `payload { target }`（`RFCs/RFC-004...:45`） | P23：按 `{ target: 2 }` 构造 → typecheck 红（缺 `seat`） |

`AI_THOUGHT` 的 `claim?: unknown` 尤其危险：它既不是 RFC-006 的嵌套形状，也不是 RFC-007/009/014 的顶层形状，等于给下游留了**第三种**形状；而 RFC-001 §2.3 明文规定「各 RFC 只增加成员、不得改写既有成员的 payload」，下游无法在不改 RFC-001 的情况下修好。按 `AGENTS.md` 硬规则 7，这必须进 `RFCS.md` 的 `## Open conflicts`，并由 `/manage-changes` 在 RFC-002 开工前统一为一种形状；本轮已登记为 C-17。

**为什么算阻塞**：RFC-001 的交付物就是这 17 个事件的共享形状。它可以被 16 条 AC 全部通过，却仍然不能支撑 RFC-002/004/007 的实现；等下游开工再改，成本远高于现在。

#### B2（阻塞，文档）· F6 的 RFC 正文与代码注释仍有不实陈述

- `RFCs/RFC-001...:43`：「`src/shared/` … 只含类型与 `as const` 常量，不含运行时逻辑。」这与同文件 §3:241、§4 的「两处运行时逻辑」以及 `src/shared/visibility.ts` / `src/shared/schemas.ts` 的实际情况矛盾。C-13 已登记冲突，但**正文没有按 C-13 修正**；`§8.7:437` 又声称已经改正，形成“评审记录说改了、文件里没改”的第二重不实。
- `src/shared/visibility.ts:8`：「这是 `src/shared/` 里唯一带运行时逻辑的文件。」`schemas.ts` 也是。
- `src/shared/events.ts:131`：「默认类型参数（`type: string` / `payload: unknown`）」；实际默认 `type` 已是 `GameEventType`。
- `tests/shared/contracts.test.ts:224` 的注释也仍写「默认参数（`type: string` / `payload: unknown`）」，与当前代码不符。

这些不是功能性 bug，但 RFC 是后续 15 个 RFC 的规范来源；规范自己说“shared 不含运行时逻辑”而实现有两处，正是 Round 1 F6 要求消掉的东西。修法很小：§2.3 改成「类型、`as const` 常量、`visibility.ts` 与 `schemas.ts` 两处受 C-13 覆盖的运行时逻辑」，同步改三处注释。

#### B3（阻塞，测试）· `EventEnvelope` 默认类型的回归没有夹具

Round 1 的 M11 探针是「直接用 `EventEnvelope` 写假 type」。当前代码确实会让它编译失败（P0），但现有测试只对 `GameEvent` 做负向夹具（`tests/shared/contracts.test.ts:258-282`），没有对 `EventEnvelope` 做。P1 把 `EventEnvelope` 的默认参数改回 `T extends string = string` 后，`pnpm typecheck` **exit 0**、整套测试 **78/78 通过**——Round 1 的 F1 修复可以被静默回退。

最小修法（三行）：

```ts
const bogusEnvelope: EventEnvelope = {
  gameId: 'g', seq: 1, ts: 0,
  // @ts-expect-error EventEnvelope 的默认 type 也必须是 GameEventMap 成员
  type: 'NOT_A_REAL_EVENT',
  visibleTo: 'public', payload: {},
};
```

如果接受「构造用 `GameEvent`、`EventEnvelope` 只做读侧」的约定，也应至少把这条约定变成测试；否则 `EventEnvelope` 的错误 payload（P19）同样可以静默通过。

### 5. 非阻塞问题与改进建议

| # | 问题 | 建议 |
|---|---|---|
| N1 | `tests/meta/tsconfig.test.ts:163-172` 只断言子配置不覆盖 `strict`，没有断言另外四个严格开关。P14 给 `tsconfig.client.json` 加 `noUncheckedIndexedAccess: false` 后，`pnpm typecheck` 与 tsconfig meta test 都 exit 0 | 对 `STRICT_FLAGS` 的五个键都断言 `undefined`；否则 server/client 可以静默丢掉 `noUncheckedIndexedAccess` 等检查 |
| N2 | `tests/meta/build.test.ts:29-38` 先跑 `pnpm build`，再断言固定路径存在，但没有清理 `dist`。P18 把 server `outDir` 改成 `dist/server2` 后，旧的 `dist/server/index.js` 让测试绿 | 测试开始时清理 `dist/server` 与 `dist/client`，或断言 `pnpm build` 的输出路径/`emptyOutDir` 行为；否则脏工作树会掩盖构建回归 |
| N3 | `EFFECT_SOURCES`（`src/shared/effects.ts:3`）与 `SELF_VISIBILITY_PREFIX`（`src/shared/events.ts:21`）没有直接断言；F7 只补了 `SEAT_IDS` / `FACTION_OF` / `FACTIONS` / `WIN_MODES` | 各加一行取值断言，尤其是 `EFFECT_SOURCES` 的 `role/system/extension` 三值和 `self:` 前缀 |
| N4 | `RFCS.md` 的 C-16 行前有一个空行，Markdown 会把 C-16 挤出 C-1 ~ C-15 的表格；C-16 是本轮 F2 的裁决，读不到会误导 | 删掉空行，把 C-16 与 C-17 放回同一张表（本轮已修表格空行并登记 C-17） |
| N5 | `ActionSchema` / `EventSchema` 没有 `.strict()`，未知键会被 Zod 静默剥离；`SPEECH.text` 没有长度上限。当前没有 action 端点，所以不是可利用面，但 RFC-011 一旦把 `ActionSchema` 当成服务端校验器，SEC-4 的“长度与类型必须在服务端校验”就会漏 | 在 RFC-011 前决定：`.strict()` 是否作为入站策略；玩家发言上限用 `.max(300)` 还是单独 schema；把决定写进对应 RFC |
| N6 | AC-1 的 `pnpm test` 内层是 `vitest --project unit`，meta 测试本身不会在这个断言里跑 | 保持 T-4 的递归取舍，但 CI 必须真的跑完整 `pnpm test`；本轮已实跑 13/78，说明当前没有隐藏失败 |
| N7 | `TEST-STRATEGY.md` 的 RFC-001 F1 行只写 `GameEvent` 负向夹具，没有写 `EventEnvelope` 直接夹具；本轮 B3 补测后同步回填 | 修 B3 时把 F1 行改成「`GameEvent` + `EventEnvelope` 两份负向夹具」 |
| N8 | FEATURES F43 的「全部术语」仍只守住 5 个身份名（`ROLE_LABELS`）；`TERMS` 的 13 条 label / definition 没有硬编码扫描，按 §8.6 延后到 RFC-012 | 这是已记录的延后，不是本轮阻塞；RFC-012 落地 UI 前必须补，否则 F43 AC-3 会以“只扫身份名”通过 |

### 6. 评审维度

#### 6.1 RFC 遵循 · **NEEDS WORK**

16 条 AC 的代码与主路径测试都在；C-9 ~ C-12 的偏离记录完整、理由成立；干净安装与生产探活都实际通过。问题在**共享契约的下游可用性**：B1 的三个 payload 与 RFC-002/004/006/007/009/014 不一致，且 RFC-001 明文禁止下游改写既有 payload；B2 的 RFC 正文与代码注释仍与实现矛盾。这两项不修，RFC-001 作为“类型唯一归属”的交付物就不完整。

#### 6.2 RULES 遵循 · **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| ARCH-1（engine 不 import UI/网络/DOM） | engine 尚不存在；`ALLOWED_EXTERNALS.engine = ['zod']` 会在目录出现后守住；**当前 N/A** |
| ARCH-2（shared 只放类型/纯常量） | **冲突**：`visibility.ts` / `schemas.ts` 有运行时逻辑；C-13 已登记，但 RFC §2.3 正文仍写“不含运行时逻辑”（B2） |
| ARCH-3 ~ ARCH-11 | 规则引擎未实现，**N/A**（ARCH-11 只在 `isVisibleTo` 的未知可见性分支有一处实现） |
| AI-1 ~ AI-9 | 无 LLM 代码，**N/A** |
| SEC-1 / SEC-2 | 密钥不在源码/客户端产物；生产日志无密钥。SEC-2 的完整产物扫描仍按 §8.6 留给 RFC-016 |
| SEC-3 / SEC-4 | 无玩家输入端点；`ActionSchema` 的 potion/seat/ts 校验已补；长度上限与 `.strict()` 见 N5 |
| SEC-5 ~ SEC-7 | 无对局视图、无真相视图、无 LLM 错误响应，**N/A** |
| DATA-1 / DATA-2 | `seq` / `ts` 字段在；事件 type 是联合枚举，`GameEvent` 绑定 payload；但 `REJECTED.actionType` 仍是 `string`（B1），`AI_THOUGHT.claim` 是 `unknown`（B1） |
| DATA-3 ~ DATA-6 | 重放/PRNG/释放均未实现，**N/A**（RFC-002 起） |
| API-1 | `ActionSchema` / `EventSchema` 存在并测试；但 schema 输出与 `Action` 的类型桥接按 §8.3 延后，payload schema 按 C-10 延后 |
| API-2 / API-3 | 无 SSE、无状态变更端点，**N/A** |
| UI-1 ~ UI-5 / A11Y-1 ~ A11Y-4 | 占位页，无交互；TEST-6 从 RFC-012 起，**N/A** |
| TEST-1 | 16 条 AC 都有测试；AC-4 / AC-13 各有一条回退路径未覆盖（N1/N2）；B3 是 F1 的回归缺口 |
| TEST-2 / TEST-3 / TEST-4 | engine 未实现，覆盖率/确定性/网络桩均未到；**N/A** |
| TEST-5 | 本轮实跑 `typecheck` / `lint` / `test` 全 0；**PASS** |
| TEST-6 | 从 RFC-012 起（T-1）；当前 `test:e2e` 正确 skipped；**按计划延后** |
| OPS-1 / OPS-2 / OPS-4 / OPS-5 | pnpm、脚本名、构建、Node 版本符合；OPS-4 的完整扫描见 §8.6；**PASS（部分）** |
| OPS-3 | selfplay 仍退出 1，是 C-5 的临时偏离；**待 RFC-015 消除** |
| STYLE-1 ~ STYLE-7 | 文件 kebab-case、无 `any` / 非空断言 / TODO、文件均 < 400 行；`TERMS` / `ROLE_LABELS` / `ActionSchema` / `EventSchema` 的命名与 STYLE-2 的冲突见 C-14；**PASS（C-14 例外）** |
| DOC-1 | C-9 ~ C-12、C-15、C-16 已记录；F6 的 §2.3 修改声明不实（B2），属于 DOC-1 的反例 |
| DOC-2 | 依赖版本与 RULES §2 一致；未提前安装 `openai` / `@fastify/cookie` / `jsdom` 等；**PASS** |

#### 6.3 安全 · **PASS（当前表面）**

- `DEEPSEEK_API_KEY` 不在源码、不在 `dist/client`、不在生产启动日志；`dist/client` 里也没有 `@fastify/static` 服务端模块。
- 生产 `start` 的 `/api/health` 只返回 `{'ok':true}`；静态托管 root 固定为 `dist/client`，未见路径穿越配置。
- `ActionSchema` 现在拒绝非法 potion、非法座位、缺 `ts`；`WITCH_ACT` 的 `none` + target 与 `heal`/`poison` 缺 target 两侧都拒绝（P3/P4）。`EventSchema` 用 `GAME_EVENT_TYPES` 枚举，`self:` 只接受 1..9。
- 当前没有 action 端点，所以没有可发的 CSRF/XSS/注入面；`EventSchema` 的 payload 仍是 `unknown`（C-10 的范围），未来加端点时不能把它当成 payload 校验器（N5）。
- 未做 `pnpm audit`，不在本 RFC 的验收范围内；依赖版本已按 RULES §2 核对过注册表。

#### 6.4 性能 · **PASS / 大部分 N/A**

本 RFC 没有游戏循环、LLM、数据库或数据抓取。可测的只有构建与启动：

- 客户端产物 219.65 kB（gzip 68.71 kB），服务端 1.25 kB；构建 62ms / 8ms，`start` 后健康检查 200。
- 没有 N+1、无界抓取、缓存缺失等可评审代码；首屏与 LLM 延迟分别在 RFC-016 / RFC-010 验收。

#### 6.5 可维护性 · **NEEDS WORK**

做得好的地方：共享类型集中、`as const` 与 `satisfies` 用法正确；测试分成 `unit` / `meta` 两个 project，递归问题被隔离；无 `any`、无非空断言、无 TODO；`import-scan.ts` 的扫描器自身有回归测试；干净安装可复现。问题：

1. B1 的三种 `AI_THOUGHT` 形状会让下一个实现者必须先猜哪个才是权威，这正是共享契约最不该出现的东西。
2. B2 / B3 的注释与测试缺口；N1 / N2 的测试盲区。
3. `RFCS.md` 的 C-16 表格断行（N4）会让人漏读 F2 的裁决。
4. `visibility.ts` 的行为矩阵仍未测（RFC-005 负责）；这是已记录的延后，但它是安全卖点的核心函数，建议 RFC-005 的第一个提交就补矩阵，不要拖到集成。
5. `tests/shared/contracts.test.ts` 已经 317 行，接近 STYLE-6 的 400 行；本轮再补 B3 时注意不要再把事件/action/schema 三组断言堆在同一文件，必要时拆成 `events.test.ts` / `schema.test.ts`。

### 7. 总体结论

**Overall Risk: Medium。**

工程骨架能装、能跑、能构建、能启动；Round 1 的 F2/F3/F4/F5 已真正闭合，F1 的当前行为也已修好。但作为“全部跨层类型的唯一归属”，`GameEventMap` 与 RFC-002/004/006/007/009/014 的 payload 不一致（B1），F6 的 RFC 正文仍说 shared 不含运行时逻辑（B2），F1 的 `EventEnvelope` 默认类型没有回归夹具（B3）。这三项都不影响当前的 78 个用例，却会在下游 RFC 开工时变成真实的接口错误或返工。

**Blocking（按优先级）**

1. **B1 · 统一 `GameEventMap` 的 payload 形状**：`REJECTED.actionType`（RFC-002）、`AI_THOUGHT`（RFC-006/007/009/014）、`VOTE_CAST`（RFC-004）。走 `/manage-changes`，选一种形状写进 RFC-001，再同步下游 RFC；不能靠下游各自改写既有成员。
2. **B2 · 修正 F6 的残留文档**：RFC §2.3、`src/shared/visibility.ts:8`、`src/shared/events.ts:131`、`tests/shared/contracts.test.ts:224`；§8.7:437 的“已改正”要么成真，要么删掉。
3. **B3 · 给 `EventEnvelope` 默认类型加负向夹具**：P1 证明当前可以静默回退；三行 `@ts-expect-error` 即可。

**Non-blocking（建议同批修）**

- N1 子配置五个严格开关全覆盖；N2 构建前清理 `dist`；N3 `EFFECT_SOURCES` / `SELF_VISIBILITY_PREFIX` 断言；N4 RFCS C-16 表格断行；N5 `.strict()` / 长度上限的决定；N7 TEST-STRATEGY 的 F1 行回填。
- F8 的全量术语扫描仍按 §8.6 延后到 RFC-012；这是已记录的取舍，不作为本轮阻塞。

### 8. Round 3 重跑清单

1. 重新跑五条门禁 + `pnpm test:e2e` + `pnpm selfplay`，并在干净检出上重跑 `CI=true pnpm install --frozen-lockfile`。
2. 复跑 P1（`EventEnvelope` 默认 `string`）、P14（子配置 `noUncheckedIndexedAccess: false`）、P18（改 server `outDir` + 旧 `dist`）、P21/P22/P23（三种 payload 形状）；B1 解决前，P22/P23 的“红”是预期，不是失败。
3. 确认 C-17 已由 `/manage-changes` 处理，或至少在下游 RFC 的 `## Implementation Notes` 里写明采用哪种形状。
4. 确认 §2.3 与三处注释已改，§8.7 的声明与实际一致。
5. 确认 B3 的 `@ts-expect-error` 在 `pnpm typecheck` 中生效，并在 `TEST-STRATEGY` 的 F1 行回填。

## Round 3 -- 2026-11-17

> **评审会话**：新会话（未参与 RFC-001 的实现或 Round 1/2 评审）
> **分支 / HEAD**：`rfc/001-project-scaffold-and-shared-contracts` / `cd579ec`
> **结论**：**Changes requested**
> **整体风险**：**Medium**。16 条 AC 与 86 个用例全部通过，Round 2 的 B1 / B3 已真正闭合；剩余阻塞全部在文档与跨 RFC 契约登记上，不改代码逻辑。C-18 是需要在下游开工前裁决的契约缺口，单独列出。

### 0. STEP 0 · 实际执行结果

#### 0.1 环境

```
$ node -v
v22.22.2
$ pnpm -v
10.33.0
$ git rev-parse --short HEAD
cd579ec
$ git status --porcelain
（空）
```

#### 0.2 门禁（真实输出）

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT 0

$ pnpm lint
> eslint .
EXIT 0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT 0

$ pnpm test
 Test Files  15 passed (15)
      Tests  86 passed (86)
   Duration  14.32s
EXIT 0

$ pnpm build
dist/client/index.html                  0.42 kB │ gzip:  0.31 kB
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
dist/server/index.js                    1.25 kB │ gzip:  0.86 kB
EXIT 0

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT 0

$ pnpm selfplay
[stderr] pnpm selfplay 未实现（RFC-015）
EXIT 1

$ node scripts/verify-skills.mjs
OK：21 个固化技能与 lock 一致
EXIT 0
```

生产产物独立探活（`PORT=3997 node dist/server/index.js`）：

```
GET /api/health -> HTTP 200 {"ok":true}
GET /           -> HTTP 200
grep -c '@shared/' dist/server/index.js        -> 0
grep -rl DEEPSEEK_API_KEY dist/client | wc -l  -> 0
```

干净检出（不是只验证锁文件）：

```
$ D=$(mktemp -d /tmp/howl-clean-XXXXXX)
$ git archive HEAD | tar -x -C "$D" && cd "$D"
$ CI=true pnpm install --frozen-lockfile
Done in 1.4s using pnpm v10.33.0
$ pnpm typecheck -> EXIT 0
$ pnpm test      -> Test Files 15 passed (15) · Tests 86 passed (86) · EXIT 0
```

#### 0.3 未验证项

- **Windows 门禁未实跑**：`run.ts`、`test-e2e.mjs`、`configs/alias.ts` 都写了平台分支，静态阅读未发现必然失败点，但本会话没有 Windows 环境。按 `AGENTS.md` 的跨平台要求，这一项仍是 **unverified**，不是“应当没问题”。
- **浏览器 / Playwright**：`tests/e2e/` 仍为空；按 TEST-STRATEGY T-1，TEST-6 从 RFC-012 起生效，本 RFC 不适用。

---

### 1. Product Type 与检查范围

`PRD.md` 的 **Product Type** 是 **game（主）+ web app（交付形态）**。RFC-001 只交付工程骨架、共享类型、健康检查与构建链，没有游戏循环，也没有用户可见功能，因此本轮只应用以下检查：

| 适用 | 本 RFC 的落点 |
|---|---|
| 数据模型 / 契约 | `src/shared/` 的 7 个文件、`GameEventMap`、`ActionSchema` / `EventSchema`、依赖方向 |
| 安全 | 密钥不进客户端产物、服务端静态托管、输入校验契约 |
| 构建与运行 | 五条命令、开发代理、生产产物、干净安装 |
| 测试 | 16 条 AC 的回退敏感性、门禁是否真的会失败 |
| 可维护性 | 共享契约的单一来源、测试组织、文档与代码是否一致 |

**显式跳过**（本 RFC 没有对应实现，跳过不是遗漏）：

| 跳过 | 理由 |
|---|---|
| 核心循环 / 胜负 / 夜间行动 | 没有游戏逻辑，`reduce` / `step` 从 RFC-002 开始 |
| 难度 / 进度 / 新手引导 | 只有占位页，无进度系统 |
| 响应式 / 无障碍 / 浏览器矩阵 | 无用户可见交互，TEST-6 从 RFC-012 起 |
| 首屏性能预算 / 帧预算 | 占位页的 2 秒预算在 RFC-016；无实时渲染 |
| 平台认证 / 账号 / SEO / 离线 / 存档 | PRD 已声明不适用，RFC-001 也没有对应表面 |
| 按资源的授权 | 单人对局，本 RFC 无对局资源端点 |

---

### 2. 16 条 AC：行为回退时哪个测试会红

本轮做了 17 个临时探针（改文件 → 跑定向命令 → `git checkout` 恢复），探针结束后 `git status --porcelain` 为空。下表“会红”只指真实探针或直接的命令证据；没有探针的部分明确标出。

| AC | 负责测试 | 本轮证据 | 结论 |
|---|---|---|---|
| 1 五条命令 | `tests/meta/commands.test.ts`（5 例）+ 全量套件 | 5 条命令实跑 0；`start` 用 3999 端口探活后关闭；全量 86/86 | **PASS**（内层 `pnpm test` 只跑 `--project unit` 是 T-4 的已知取舍） |
| 2 package 字段 | `tests/meta/tsconfig.test.ts` | **P-ac2** 把 `packageManager` 改成 `pnpm@10.0.0` → 测试红 | **PASS** |
| 3 三份 tsconfig | 同上 + 别名单一来源 | **P-ac3** 把根 `target` 改成 `ES2020` → 红；P16 式的 paths 改动在 Round 2 已验 | **PASS** |
| 4 五个严格开关 | 同上 + 五份两向夹具 | **P-ac4** 关掉根 `strict`（连带两个依赖项）→ 红；**P14** 给 client 加 `noUncheckedIndexedAccess: false` → 红 | **PASS** |
| 5 Phase 恰 14、potion 恰 3 | `tests/shared/domain.test.ts` + `actions.test.ts` | **P-ac5** 给 `PHASES` 加第 15 项 → 红；`expectTypeOf<Phase>()` 双向等值 | **PASS** |
| 6 Effect.target / order | `tests/shared/effects.test.ts` | **P-ac6** 删 `EFFECT_ORDER` 的 `as const` → typecheck 红；省略 `target` 的夹具编译失败 | **PASS** |
| 7 EventEnvelope 三字段必填 | `tests/shared/events.test.ts` | **P-ac7** 把 `visibleTo` 改成可选 → typecheck 红（未使用指令） | **PASS** |
| 8 术语表 13 条 / 身份名 | `tests/shared/terms.test.ts` | **P-ac8** 把「刀」改成「刀X」→ 红；键、顺序、定义、警长注记都有断言 | **PASS** |
| 9 五个身份名不得硬编码 | `tests/security/no-hardcoded-terms.test.ts` | **P-ac9** 在 `src/` 写 `'狼人'` → 红 | **PASS** |
| 10 shared 无跨层 import | `tests/dependency-direction.test.ts` + `import-scan.ts` | **P-ac10** 在 `src/shared/` 写 `import('@server/app')` → 红 | **PASS** |
| 11 三层依赖方向 | 同上 | **P-ac11** 新建 `src/engine/` 并 import `@server/app` → 红；engine 目录当前不存在，相关断言在无文件时恒真（已知缺口） | **PASS（engine 部分恒真）** |
| 12 health 直连与 Vite 代理 | `tests/server/health.test.ts` + `tests/meta/dev-proxy.test.ts` | **P-ac12** 把 `HEALTH_PATH` 改成 `/api/health2`：unit 测试仍绿（它 import 同一个常量），dev-proxy 测试红。AC-12 的字面路径由 meta 测试守住 | **PASS（unit 用例有自指弱点，见 §4 F5）** |
| 13 构建产物与密钥扫描 | `tests/meta/build.test.ts` | **P18** 改 server `outDir` 并保留旧 `dist/server/index.js` → 红；构建前清理 `dist` 已生效 | **PASS** |
| 14 ESLint 两条规则 error | `tests/meta/lint.test.ts` | **P-ac14** 把 `no-explicit-any` 降为 `warn` → 红；`.tsx` 生效等级有断言 | **PASS** |
| 15 format:check + e2e skipped | 同上 AC-15 | **P-ac15** 把 `skipped` 改成 `done` → 红；断言含 `skipped` 且不含 `Running ` | **PASS** |
| 16 selfplay 退出 1 + 文案 | `tests/meta/selfplay-placeholder.test.ts` | **P-ac16** 删掉「未实现」→ 红；退出码与两个片段都有断言 | **PASS** |

**统计**：16 条中 15 条在本轮有直接变异证据（AC-1 为命令实跑 + 全量套件；AC-13 由 P18 覆盖）；没有“计划了但仓库里不存在”的测试。`TEST-STRATEGY.md` RFC-001 小节的 16 条映射全部能在仓库里找到，且 `Exists?` 均为 `existing`。

---

### 3. Round 2 三个阻塞项的复核

| 项 | 结论 | 证据 |
|---|---|---|
| **B1 / C-17** `GameEventMap` 与下游 payload 不一致 | **PASS** | `REJECTED.actionType` 已是 `Action['type']`；`AI_THOUGHT.claim` 已是 `Claim` 嵌套形状；`VOTE_CAST` 已带 `seat`。`tests/shared/events.test.ts` 的 P21 / P22 / P23 三份 `@ts-expect-error` 处于生效状态（`pnpm typecheck` 0 即证明它们没有被“未使用指令”报错）。RFC-002 §2.3、RFC-004 §2.3、RFC-006 §2.2、RFC-007 §2.5、RFC-009 §2.2、RFC-014 §2.3 已同步；`changes/CHANGE-REQUEST-003.md` 的 12 项落地清单可逐条对上。 |
| **B2** RFC 正文与注释不实 | **NEEDS WORK（未完全闭合）** | RFC §2.3、`src/shared/visibility.ts:8`、`src/shared/events.ts:27` 已改；但 **`src/shared/events.ts:160` 仍写「默认类型参数（`type: string` / `payload: unknown`）」**，实际默认 `type` 是 `GameEventType`。同文件 `:134` 与 `src/shared/schemas.ts:18` 仍引用已被删除的 `tests/shared/contracts.test.ts`。Round 2 的 B2 点名的就是这处注释，本轮没有真正修完。 |
| **B3** `EventEnvelope` 默认类型缺回归夹具 | **PASS** | **P1** 把默认参数改回 `T extends string = string` 后 `pnpm typecheck` 报 `tests/shared/events.test.ts(79,7): error TS2578: Unused '@ts-expect-error' directive.`，退出码 2。夹具真的守住了。 |
| **N1** 子配置五个严格开关 | **PASS** | **P14** 给 `tsconfig.client.json` 加 `noUncheckedIndexedAccess: false` → tsconfig meta test 1 failed / 14 passed。 |
| **N2** 构建前清 `dist` | **PASS** | **P18** 改 `vite.server.config.ts` 的 `outDir` 为 `dist/server2` 并保留旧产物 → build meta test 1 failed / 3 passed。 |
| **N3** `EFFECT_SOURCES` / `SELF_VISIBILITY_PREFIX` | **PASS** | `tests/shared/effects.test.ts` 断言三值；`tests/shared/events.test.ts` 断言 `self:`。 |
| **N4** `RFCS.md` 表格断行 | **PASS** | C-16 / C-17 都在同一张表内，没有空行把行挤出表格。 |
| **N5** `.strict()` / 长度上限 | **PASS（已登记延后）** | §8.6 最后一行明确指到 RFC-011，并写明“不能默认沿用当前宽 schema”。 |
| **N7** TEST-STRATEGY 的 F1 行 | **PASS** | 已回填为「`GameEvent` + `EventEnvelope` 两份夹具」，并新增 CR-003 一行。 |

---

### 4. 本轮新发现

#### F1（阻塞，文档）· B2 的残留：`EventEnvelope` 的默认类型注释仍是 `string`

`src/shared/events.ts:160`：

```
 * `EventEnvelope` 的默认类型参数（`type: string` / `payload: unknown`）只用于「只能确定
 * 是一条事件」的位置，例如可见性判定的入参。
```

实际类型是 `EventEnvelope<T extends GameEventType = GameEventType, P = unknown>`。同一文件 `:27` 已正确写「默认类型参数刻意收紧：`type` 只能是 `GameEventMap` 的成员」，两条注释互相矛盾。Round 2 的 B2 明确点名了这处注释；`cd579ec` 的提交说明称 B2 已修完，但这一行没有变。

同时，拆文件后留下的两处失效引用：

- `src/shared/events.ts:134`：`tests/shared/contracts.test.ts` 已被删除；
- `src/shared/schemas.ts:18`：同上。

**建议**：把 `:160` 改成「默认 `type` 是 `GameEventType`、默认 `payload` 仍是 `unknown`」；两处引用改成 `tests/shared/events.test.ts` / `tests/shared/actions.test.ts`。这是一处 3 行的文档修复，但要改在**契约文件本身**，不是只改 RFC。

#### F2（阻塞，文档）· README 与 RFC §8.5 的仓库状态落后于实际

- `README.md:11` 仍写：「RFC-001 Round 2 评审结论为 `Changes requested`，代码与 78 个用例仍全绿……1 个 `Changes requested`、15 个 `Not started`」。实际 RFC-001 在 `RFCS.md` 里是 `Implemented`，套件是 86 个用例。
- `README.md:36-39` 的进度块仍停在「评审 Round 2 → 下一步：先 /manage-changes 统一 C-17 的 payload 形状，并修掉 B2 / B3，再开 Round 3」。C-17 已由 CR-003 关闭，B2 / B3 已处理，Round 3 就是本轮。
- `RFCs/RFC-001...:393-422` 的「全量输出」仍写 `Test Files 12 passed / Tests 57 passed`，「全新安装验证」仍写 `git archive b5285a0` 与 `13 passed / 78 passed`。当前是 15 个文件 / 86 个用例，干净检出验证的是 `HEAD` 而不是 `b5285a0`。同一节 `:371` 的 AC-3 仍写「子配置不覆盖 `moduleResolution`/`target`/`strict`」，实际测试已扩到五个严格开关（N1）。

这些不是代码缺陷，但 `README` 是仓库入口、RFC §8.5 是实现记录；它们与 `RFCS.md` 的“Status 列是唯一事实来源”直接冲突。Round 1 的评审已经因为同一类 README 过期问题提过一次，本轮又出现，说明“修代码时同步文档”仍未进入实现流程。

> 评审会话已把 `README.md` 的状态与进度块同步到 Round 3（见本次评审的 diff），因此本项剩余待修的是 **RFC §8.5 的验证块与 AC-3 描述**；README 不再列为待修。

**建议**：在本轮修复时一并更新 README 状态/进度，并把 RFC §8.5 的验证块换成当前证据（或明确标注为“Round 1 历史输出，最终验证见 §8.8”），避免下一次会话读到旧数字。

#### F3（阻塞 RFC-002，跨 RFC 契约）· `GameState` / `step` 与 RFC-003/004/005 的“事件流推导”不闭合

这是本轮最重要的发现，已登记为 `RFCS.md` C-18。

RFC-002 §2.1 的签名是：

```ts
function step(state: GameState, action: Action): { state: GameState; events: EventEnvelope[] };
```

它只接收 `state` 与 `action`，不接收事件历史。但：

- RFC-003 §4 / AC-9：药水位**由事件流推导**，并明确「不在 `state` 里加布尔位」；
- RFC-004 §2.2：`DAY_SPEECH` 的 `cursor` 记录下一位发言者；§3：票箱从 `VOTE_CAST` 事件推导，不在 `state` 里另存可变 `Map`；
- RFC-005 §2.2：已提交夜聊的席位记录在状态里，由 `WOLF_CHAT_POSTED` 事件推导。

而 RFC-001 §2.3 的 `GameState` 只有 `gameId / seed / mode / rng / phase / day / seats / seq` 八个字段，没有 `cursor`、票箱、药水位、夜聊提交集合。`step` 又看不到事件流，因此在当前契约下**无法在 `step` 内判定**「这瓶药是否已用」「这个人是否已发言/投票/夜聊」「当前该谁发言」。这不是实现者可以自己补的实现细节，它决定了 `GameState` 是否要扩展、或 `step` 是否要改签名。

**建议（必须走 `/manage-changes`，在 RFC-002 开工前裁决）**：

1. **方案 A（推荐）**：允许后续 RFC 给 `GameState` 增加由 `applyEvent` 折叠出的派生字段（例如 `day: { cursor, votes, spoken }` / `night: { killTarget, potionsUsed }` / `chatSubmitted`）。需要在 RFC-001 §2.3 写明「后续 RFC 可以增加字段，但字段必须由 `applyEvent` 从事件重建，不得成为第二权威」；RFC-003/004/005 的「不在 state 里另存”改成“不在 state 里另存**不可重建**的副本”。
2. **方案 B**：把 `step` 改成接收事件历史（`step(state, events, action)`）。这会与 `RULES ARCH-4` 的 `reduce(state, action)` 字面签名冲突，需要同时改 RULES，成本更高，且削弱 `step` 的纯函数验收标准。
3. 无论选哪个，都要补一条测试：**同一事件流 replay 后，`step` 用重建状态做出的判定与原始运行一致**。

**为什么算阻塞**：RFC-001 的交付物就是“对局长什么样”。一个在 16 条 AC 下全绿、却无法支撑 RFC-002 的 `GameState`，与 Round 2 B1 是同一类问题（当时是 payload 形状，这次是状态形状）。RFC-002 是下一个开工的 RFC，现在不裁决，返工成本会从“改类型”变成“改引擎 + 改重放”。

#### F4（非阻塞，跨 RFC）· `DAY_VOTE_RESOLVE` 不在 `Phase` 里

RFC-004 §2.3 写「全部提交后进入 `DAY_VOTE_RESOLVE`」，但 RFC-001 的 `Phase` 14 个取值里没有它；RFC-002 §2.4 的 `ResolutionPoint` 叫 `VOTE_RESOLVE`，不是 `DAY_VOTE_RESOLVE`。已登记为 `RFCS.md` C-19。

这不是 RFC-001 的代码问题（`Phase` 是 AC-5 明确列出的 14 个），但 RFC-004 是 `Not started`，应在它开工前改成 `VOTE_RESOLVE`（结算点）或 `DAY_VOTE` 内部步骤，避免实现时又多出一个未裁决的阶段名。

#### F5（非阻塞）· `tests/server/health.test.ts` 的路径是自指的

该测试 import `HEALTH_PATH`，再用同一个常量请求。把 `HEALTH_PATH` 改成 `/api/health2` 后它仍然全绿（**P-ac12** 实证）。AC-12 的**字面路径**由 `tests/meta/dev-proxy.test.ts` 的硬编码 `http://localhost:3000/api/health` 守住，所以不是覆盖缺失；但 unit 用例本身不能证明“健康检查在 `/api/health`”，只证明了“在 `HEALTH_PATH` 所指的路径”。建议把 unit 用例的 URL 写死为 `/api/health`（或额外断言 `HEALTH_PATH === '/api/health'`）。

#### F6（非阻塞，已记录延后）· `isVisibleTo` 的行为矩阵仍没有 RFC-001 测试

`src/shared/visibility.ts` 是“AI 不作弊”卖点的核心函数，本 RFC 只定义与实现，行为验收在 RFC-005（§6 已声明）。当前 86 个用例里没有一条直接测它。建议 RFC-005 的第一个提交就补 public / server / wolves / seer / self / diedSeq 的完整矩阵，不要拖到集成阶段。这是 Round 1/2 就记录的风险，本轮不新增阻塞。

#### F7（非阻塞，已记录延后）· F43 的全量术语扫描仍只覆盖 5 个身份名

`tests/security/no-hardcoded-terms.test.ts` 只扫 `ROLE_LABELS` 的 5 个值；`TERMS` 的 13 条 label / definition 没有硬编码扫描。AC-9 只要求身份名，`FEATURES F43` 的“全部术语”按 §8.6 延后到 RFC-012。这是已登记的取舍，不是本轮新阻塞；RFC-012 落地 UI 前必须补，否则 F43 会以“只扫身份名”的方式通过。

---

### 5. 评审维度

#### 5.1 RFC 遵循 · **NEEDS WORK**

16 条 AC 的代码与主路径测试都在；C-9 ~ C-12 的偏离记录完整、理由成立；C-17 的三个 payload 已统一且下游 RFC 同步。问题在：

- B2 的残留（F1）让 RFC §8.5 的“已改正”与代码不一致；
- C-18（F3）说明共享 `GameState` 还不足以支撑 RFC-002/003/004/005 的“事件流推导”，这是 RFC-001 作为契约交付物的完整性缺口；
- README / RFC §8.5 的状态数字（F2）与 `RFCS.md` 冲突。

**Suggestions**：先修 F1 的三处注释/引用；把 C-18 的裁决写进 RFC-001 §2.3 与 RFC-002 §2.1；同步 README 与 RFC §8.5 的验证块。

#### 5.2 RULES 遵循 · **NEEDS WORK**

| 规则 | 结论 |
|---|---|
| ARCH-1（engine 不 import UI/网络/DOM） | engine 尚不存在；`ALLOWED_EXTERNALS.engine = ['zod']` 与 `tsconfig.server.json` 的 `lib: ["ES2022"]` 会在 engine 出现后守住；**当前 N/A** |
| ARCH-2（shared 只放类型/纯常量） | `visibility.ts` / `schemas.ts` 两处运行时逻辑已登记为 C-13 的例外；C-13 的最终措辞仍待 `/manage-changes`，**已登记，按 RFC 实现** |
| ARCH-3（状态是纯数据） | `GameState` / `Seat` / `Effect` 都是纯数据，无 Map/Set/Date/类实例；但 C-18 的“派生字段放哪”会直接影响 ARCH-3，需在裁决时一起看 |
| ARCH-4（`reduce(state, action) => state`） | 本 RFC 无 `reduce`；RFC-002 的 `step(state, action)` 与 ARCH-4 同时成立的设计已在 RFC-002 说明；C-18 若选方案 B 会触碰这条规则 |
| ARCH-5 ~ ARCH-11 | 规则引擎未实现，**N/A**（ARCH-11 只在 `isVisibleTo` 的未知可见性分支有一处实现） |
| AI-1 ~ AI-9 | 无 LLM 代码，**N/A** |
| SEC-1 / SEC-2 | `DEEPSEEK_API_KEY` 不在源码/客户端产物/生产日志；`dist/client` 无 `@fastify/static`。SEC-2 的完整产物扫描仍按 §8.6 留给 RFC-016；**PASS（部分）** |
| SEC-3 / SEC-4 | 无玩家输入端点；`ActionSchema` 的 potion/seat/ts 校验已补；`.strict()` 与长度上限按 §8.6 延后到 RFC-011；**N/A（当前表面）/ 契约有已知风险** |
| SEC-5 ~ SEC-7 | 无对局视图、无真相视图、无 LLM 错误响应，**N/A** |
| DATA-1 / DATA-2 | `seq` / `ts` / `visibleTo` 在；事件 type 是 `GameEventType`，`GameEvent` 绑定 payload；`REJECTED.actionType` 已收窄；**PASS** |
| DATA-3 ~ DATA-6 | 重放/PRNG/释放均未实现，**N/A**（RFC-002 起） |
| API-1 | `ActionSchema` / `EventSchema` 存在并测试；schema 输出与 `Action` 的类型桥接、payload schema 按 C-10 延后；**PASS（范围内）** |
| API-2 / API-3 | 无 SSE、无状态变更端点，**N/A** |
| UI-1 ~ UI-5 / A11Y-1 ~ A11Y-4 | 占位页，无交互；TEST-6 从 RFC-012 起，**N/A** |
| TEST-1 | 16 条 AC 都有对应的自动化测试，15 条有本轮变异证据；`isVisibleTo` 的行为矩阵按 RFC §6 明确留给 RFC-005；**PASS（本 RFC 范围）** |
| TEST-2 / TEST-3 / TEST-4 | engine 未实现，覆盖率/确定性/网络桩均未到；**N/A** |
| TEST-5 | 本轮实跑 `typecheck` / `lint` / `test` 全 0；**PASS** |
| TEST-6 | 从 RFC-012 起（T-1）；当前 `test:e2e` 正确 skipped；**按计划延后** |
| OPS-1 / OPS-2 / OPS-4 / OPS-5 | pnpm、脚本名、构建、Node 版本符合；OPS-4 的完整扫描见 SEC-2 部分；**PASS（部分）** |
| OPS-3 | selfplay 仍退出 1，是 C-5 的临时偏离；**待 RFC-015 消除** |
| STYLE-1 ~ STYLE-7 | 文件 kebab-case、无 `any` / 非空断言 / TODO、文件均 < 400 行；`TERMS` / `ROLE_LABELS` / `ActionSchema` / `EventSchema` 的命名与 C-14 的冲突已登记；**PASS（C-14 例外）** |
| DOC-1 | C-9 ~ C-12、C-15、C-16、C-17 已记录；B2 的残留与 README / §8.5 的状态落后属于 DOC-1 的反例；**NEEDS WORK** |
| DOC-2 | 依赖版本与 RULES §2 一致；未提前安装 `openai` / `@fastify/cookie` / `jsdom` 等；**PASS** |

**Suggestions**：DOC-1 的反例按 F1 / F2 修；C-13 / C-14 由 `/manage-changes` 收口；C-18 若选方案 B，同步修改 `RULES ARCH-4`。

#### 5.3 安全 · **PASS（当前表面）**

- 密钥：源码、`dist/client`、生产启动日志都没有 `DEEPSEEK_API_KEY`；生产产物的 `grep` 计数为 0。
- 静态托管：`@fastify/static` 的 `root` 固定为 `dist/client`，未发现可配置的路径穿越；`GET /` 返回 index.html。
- 输入校验：当前没有 HTTP action 端点，因此没有可利用的 inbound 面。`ActionSchema` 的 potion/target 配对、座位、`ts` 都已拒绝；`EventSchema` 的 type 枚举、`self:1..9`、`seq > 0` 都有测试。`.strict()` 与 `SPEECH.text` 上限按 §8.6 延后到 RFC-011，不能把当前宽 schema 直接当服务端校验器。
- 依赖：`pnpm-lock.yaml` 存在，版本与 RULES §2 对齐；未做 `pnpm audit`（不在本 RFC 范围内）。
- 可见性：`isVisibleTo` 的未知可见性分支抛错（ARCH-11），`server` 对所有席位返回 false；行为矩阵待 RFC-005 补测。

**结论**：当前可运行表面没有安全漏洞；C-18 是状态契约问题，不是安全漏洞。F5 / F6 是测试质量问题。

**Suggestions**：RFC-011 开工前决定 `.strict()` 与发言长度上限；RFC-016 补完整的服务端模块泄漏扫描。

#### 5.4 性能 · **PASS / 大部分 N/A**

本 RFC 没有游戏循环、LLM、数据库或数据抓取。可测的只有构建与启动：

- 客户端产物 219.65 kB（gzip 68.71 kB），服务端 1.25 kB；构建约 0.1s / 15ms；生产健康检查 8ms（本机探活）。
- 没有 N+1、无界抓取、缓存缺失等可评审代码；首屏与 LLM 延迟分别在 RFC-016 / RFC-010 验收。

**Suggestions**：无；本 RFC 没有可优化的数据/网络路径。

#### 5.5 可维护性 · **NEEDS WORK**

做得好的地方：共享类型集中、`as const` 与 `satisfies` 用法正确；测试按 domain / actions / events / effects / terms 拆分，单文件都远低于 400 行；`import-scan.ts` 有 6 条自测；干净检出可复现；C-9 的 Vite SSR 方案有实证。

问题：

1. **F1**：契约文件里仍有一处与代码矛盾的默认类型注释，以及两处指向已删除测试文件的引用。
2. **F2**：RFC §8.5 的状态数字/命令输出落后于当前 86 个用例；README 已由评审会话同步到 Round 3。
3. **F5**：health unit 测试自指 `HEALTH_PATH`，不能单独证明 AC-12 的字面路径；meta 测试补上了，但 unit 用例的名字给了过强的暗示。
4. **F6**：`isVisibleTo` 这个安全卖点的核心函数在 RFC-001 里没有行为矩阵；按 RFC §6 延后到 RFC-005，可接受，但建议 RFC-005 第一个提交就补。
5. **C-18**：`GameState` / `step` 的契约缺口会让下一个实现者先做一次架构裁决；越早裁决越省事。

---

### 6. 总体结论

**Overall Risk: Medium。**

工程骨架在功能上已经可交付：五条命令、干净安装、生产产物、Vite 代理、共享契约、依赖方向、密钥扫描都实跑通过；16 条 AC 都有会变红的测试（本轮 14 个 AC 探针 + P1/P14/P18 + 命令证据），Round 2 的 B1 / B3 已真正闭合。剩余阻塞集中在三处：

1. **B2 残留**：`src/shared/events.ts:160` 的默认类型注释仍写 `type: string`，且 `events.ts:134` / `schemas.ts:18` 指向已删除的 `contracts.test.ts`。这是 Round 2 明确点名的项，提交说明称已修完，实际没有。
2. **仓库状态漂移**：评审开始时 README 仍说 RFC-001 是 `Changes requested`、78 个用例、下一步做 C-17；评审会话已同步 README，但 RFC §8.5 的“全量输出”仍是 57 / 78 个用例与 `b5285a0` 的干净检出。当前是 `Implemented`、86 个用例、`HEAD` 的干净检出。
3. **C-18**：`GameState` 的八个字段 + `step(state, action)` 无法支撑 RFC-003/004/005 的“药水位 / cursor / 票箱 / 夜聊提交由事件流推导”。这是跨 RFC 的状态契约缺口，必须在 RFC-002 开工前由 `/manage-changes` 裁决（扩展 `GameState` 并登记派生规则，或改 `step` 签名并同步改 ARCH-4）。RFC-001 的代码本身不需要因此改动；但契约记录需要补。

C-19（`DAY_VOTE_RESOLVE`）是 RFC-004 的措辞问题，不阻塞 RFC-001；F5 / F6 / F7 是非阻塞的测试与延后项。

### 6.1 Blocking（合并前必须处理）

1. **F1 / B2 残留**：修正 `src/shared/events.ts:160` 的 `type: string`，把 `events.ts:134` 与 `schemas.ts:18` 的 `contracts.test.ts` 引用改成当前测试文件。
2. **F2 / 仓库状态**：`README.md` 已由评审会话同步到 Round 3；仍需把 RFC §8.5 的验证块换成 `HEAD` 的 86 个用例输出，或明确标注“Round 1 历史输出，最终验证见 §8.8”，并修正 AC-3 的“只覆盖 strict”描述。
3. **F3 / C-18**：由 `/manage-changes` 在 RFC-002 开工前裁决 `GameState` 与 `step` 的状态来源；把裁决写进 RFC-001 §2.3 / RFC-002 §2.1，并把 C-18 标记为已解决。RFC-001 的代码可以保持现状。

### 6.2 Non-blocking（建议同批或随后处理）

- **F4 / C-19**：RFC-004 的 `DAY_VOTE_RESOLVE` 改成 `VOTE_RESOLVE` 或 `DAY_VOTE` 内部步骤（RFC-004 开工前）。
- **F5**：`tests/server/health.test.ts` 的 URL 写死 `/api/health`，或额外断言 `HEALTH_PATH === '/api/health'`。
- **F6**：RFC-005 的第一个提交补 `isVisibleTo` 的完整行为矩阵。
- **F7**：RFC-012 落地 UI 前补 F43 的全量术语扫描。
- **C-13 / C-14**：RULES 的 ARCH-2 / STYLE-2 措辞仍待 `/manage-changes`，已登记，不是本轮新问题。

### 7. Round 4 重跑清单

1. 修 F1 的三处注释/引用，跑 `pnpm format:check` + `pnpm typecheck`。
2. 确认 README 已同步（本轮评审已改）；更新 RFC §8.5 的数字与 AC-3 描述，确认 `RFCS.md` / README / RFC 三处状态一致。
3. 走 `/manage-changes` 裁决 C-18，写进 RFC-001 §2.3 与 RFC-002 §2.1；C-19 在 RFC-004 开工前处理。
4. 重跑五条门禁 + `pnpm test:e2e` + `pnpm selfplay` + 干净检出 `CI=true pnpm install --frozen-lockfile`。
5. 复跑 P1 / P14 / P18，确认本轮修复没有回退它们的红色信号。
6. 如果 C-18 选方案 A，补一条“replay 后 step 判定一致”的测试计划到 RFC-002 的 TEST-STRATEGY 小节；如果选方案 B，同步改 RULES ARCH-4。
