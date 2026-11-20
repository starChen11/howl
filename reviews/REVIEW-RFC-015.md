# REVIEW · RFC-015 · Round 1

> 评审时间：2026-11-20 · 被评审提交：`acb0967 feat(rfc-015): headless 批量自对弈` · HEAD `acb0967`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-015 的实现代码。
> 结论：**Changes requested** · Overall Risk Level: **High**

本轮用户点名五件事：**AC-5 单局失败隔离、AC-6 非法行动归为实现缺陷而不是模型失败、AC-8 占位行为被移除、AC-9 事件流 seq 连续且可重放、CLI 用例是否真的跑了子进程**。先给直接回答，再展开逐条 AC、主动找洞与工程维度。

| 用户点名项 | 结论 | 最短证据 |
|---|---|---|
| **AC-5 单局失败隔离** | **主路径成立，边界不成立** | 真中途抛错的假 LLM 被隔离：第 1 局 `kind=model`，第 2/3 局仍成局（P-4）。但 `onGame`（写盘）抛错会从 `catch` 里再次调 `onGame` 并逃逸，整批 `runSelfplay` reject；第一次成功 outcome 与第二次失败 outcome 还会重复（P-2、`runner.ts:159-175`）。 |
| **AC-6 非法行动归为实现缺陷** | **不成立** | 归类只在「没有 `GAME_ENDED`」的分支执行（`runner.ts:121-145`）；已结束的局即使含有被拒绝的玩家动作，也按成局记。官方两条 AC-6 用例都没有测到 runner 的归类：一条手工拼 `summarize` 输入，另一条只 `expect(outcomes).toHaveLength(1)`；把归类改成永远 `'model'`，`selfplay.test.ts` **8/8 仍绿**（M-2）。 |
| **AC-8 占位行为被移除** | **成立** | `pnpm selfplay --games=1 --seed=9` 退出 0、打印「跑完 1 局」；把入口临时改回「未实现」后 meta 用例 **1 failed**、unit 的 CLI 用例 **1 failed**（M-1）。 |
| **AC-9 seq 连续且可重放** | **行为成立，测试只锁了一半** | 3 局 CLI 输出 seq 均从 1 连续；100 个 `game-*.jsonl` 全部 `replay` 到 `FINISHED`（P-8）。但官方 AC-9 用例只断言 seq，没有调用 `replay`；把传给 `onGame` 的事件截掉最后一条（replay 落到 `NIGHT_RESOLVE`）后 `selfplay.test.ts` **8/8 仍绿**（M-4、P-6）。 |
| **CLI 用例是否跑子进程** | **是，但不是跨平台的** | `tests/server/selfplay.test.ts:192-225` 真的 `execFile('pnpm', ['exec','tsx','scripts/selfplay.ts', ...])`；入口改坏会红（M-1）。但它直接写死 `'pnpm'`，没有 meta helper 的 Windows 处理（`pnpm.cmd` + `shell`），Windows 上 `pnpm test` 会在这条用例上失败（C-189）。 |

---

## 0. STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `acb0967` · 评审开始时工作树 clean。

```text
$ pnpm typecheck            → exit 0
$ pnpm lint                 → exit 0
$ pnpm format:check         → All matched files use Prettier code style! → exit 0
$ pnpm build                → client 139 modules / server 65 modules → exit 0
$ pnpm test                 → Test Files 88 passed (88) / Tests 756 passed (756) → exit 0（43.26s）
$ pnpm test:e2e             → 10 passed (18.3s) → exit 0
$ pnpm exec vitest run --project unit --coverage
                            → 72 files / 641 tests；All files 行 96.96% / 分支 92.85% → exit 0
```

`pnpm test` 的 756 条包含 `tests/meta/*` 的构建、五条命令、覆盖率与 e2e 门禁；`pnpm test:e2e` 单独复跑也是 10/10，与 RFC §8.5 的声明一致。

runtime 实证：

```text
$ HOWL_FAKE_AI=1 pnpm selfplay --games=3 --seed=1 --out=/tmp/howl-rfc015-r1/out
  跑完 3 局：成 3 / 败 0；狼人胜率 100.0%；平均 67.7 条事件、0.0 秒
  exit 0；summary.json + game-1/2/3.jsonl；三个文件 GAME_STARTED.seed 分别为 1/2/3

$ HOWL_FAKE_AI=1 /usr/bin/time -p pnpm selfplay --games=100 --seed=1000 --out=...
  跑完 100 局：成 100 / 败 0；狼人胜率 73.0%；平均 78.5 条事件、0.0 秒
  real 1.67s；peak memory footprint 约 83 MB
  （`--games=10` 同样约 83 MB；10 与 100 局的峰值没有随局数增长）

$ pnpm selfplay --games=2 --seed=7（无 HOWL_FAKE_AI、无 key）
  跑完 2 局：成 0 / 败 2；两个失败各带 seed 7/8 与原因；写 summary.json；exit 1
```

本轮所有探针均从 `/tmp/howl-rfc015-r1/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。两个被改过的源码文件探针前后 SHA-256 一致：

```text
ed3a2f36964b8518640931168f2e6e62de23e79cfeddd82b7bf268315685e2da  scripts/selfplay.ts
0c02dbf66b68afe2beffc460ce89254580eacfe6e986946c60e423580130e020  src/server/selfplay/runner.ts
```

临时探针测试 `tests/server/__probe-rfc015.test.ts`、`tests/server/__probe-replay100.test.ts` 已删除；探针结束后 `git status --porcelain` 为空；没有 `git commit`。

---

## 1. 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**（`PRD.md:20-22`）。RFC-015 是验证工具而不是玩家可见界面：适用检查是 CLI 的可执行性、失败隔离、输出契约、可重放性与跨平台；不适用真实浏览器、响应式、键盘/读屏、首屏预算等 web app 检查，本 RFC 没有 UI 改动，`test:e2e` 仍全绿是回归证据而不是本 RFC 的验收手段。

---

## 2. 用户点名的五项

### 2.1 AC-5 · 单局失败不终止整批

**主路径成立。** 把 `decide` 换成「第 1 局第 5 次决策时抛错」的假 LLM，其余局照常跑完：

```text
PROBE-5 86 [{"seed":1,"ok":false,"kind":"model","events":0},
            {"seed":2,"ok":true,"events":69},
            {"seed":3,"ok":true,"events":83}]
```

`runner.ts:159-175` 的 `try/catch` 把单局 `runGame` 的异常收成一条 `GameFailure`，并 `continue` 到下一局，符合 AC-5 的主路径。官方用例（`tests/server/selfplay.test.ts:28-47`）通过 `beforeGame` 注入抛错，虽然注入点不是 RFC/测试计划写的「假 LLM 客户端」，但走的是同一段 catch；把 catch 改成 `throw cause` 后该用例 **1 failed**（M-3），说明它至少对隔离本身有牙。

**边界不成立：写盘失败会终止整批，并且会重复记一局。**

- 成功路径先 `outcomes.push(success)`，再 `await options.onGame(...)`（`runner.ts:149-158`）。`onGame` 抛错后进入 `catch`，又 push 一条同 seed 的 failure，然后再 `await options.onGame(..., [])`（`runner.ts:163-174`）。
- 第二次 `onGame` 仍在 `catch` 体内、没有任何外层保护；CLI 的 `writeAtomic` 若持续失败（磁盘满、权限、重名文件被占用），异常会从 `runSelfplay` 逃逸，整批中止、`summary.json` 不落盘。这直接违反 §2.4「单局抛错不终止整批」。
- 即使第二次写盘成功，同一局也会产生两条 outcome（一条 ok、一条 failed），`summary.games` 会大于用户请求的局数。

实证：把 `onGame` 改成抛 `Error('磁盘写入失败')` 后，`runSelfplay` 直接 reject（临时探针 P-2，测试进程报 `磁盘写入失败` 于 `runner.ts:174`）。这不是理论问题：`scripts/selfplay.ts:69-75` 的写盘就在这个回调里。

**结论：AC-5 主路径 PASS，失败隔离的边界 FAIL**（C-187）。

### 2.2 AC-6 · 非法行动归为「实现缺陷」而不是模型失败

**归类逻辑只覆盖「没有终局」的一半，且没有测试。**

`runner.ts:121-145` 只有在 `GAME_ENDED` 不存在时才检查 `REJECTED` 事件，并用最后一个拒绝的 `actionType` 猜是玩家侧还是模型侧：

```ts
const playerActionType =
  last?.actionType !== undefined &&
  ['SPEECH', 'SPEECH_SKIP', 'VOTE', 'SELF_EXPOSE'].includes(last.actionType);
```

（`runner.ts:129-131`。）问题有三层：

1. **已经结束的局不检查 `REJECTED`。** 成功路径（`runner.ts:147-158`）只数事件、取 `GAME_ENDED`，从不看 `REJECTED`。引擎对一次非法玩家动作的处置是「发一条 `REJECTED` 事件、状态不变」，`runGame` 会继续问同一席位（`orchestrator.ts:215-222` 成功后继续循环）。脚本玩家下一次重新从投影的 `legalTargets` 里挑，完全可能挑到合法目标并把局打完。此时 AC-6 要求「该局被判为实现缺陷」，代码却记为成局——非法动作被静默吞掉。
2. **按 `actionType` 猜来源不可靠。** AI 席位也会产出 `SPEECH` / `VOTE`。P-5 用假 AI 在 `NIGHT_WOLVES` 反复刀队友，引擎实际拒绝（`WOLF_KILL_WOLF`），最后归类是 `model`——这是对的（是假 AI 的错），但它证明「有拒绝 ≠ 玩家缺陷」；反过来，AI 席位若产出 `VOTE` 被拒也会被误归为 `implementation`。AC-6 要的是「脚本化玩家」的来源，不是动作类型。
3. **验收证据不成立。** RFC §8.4 第 6 行写「引擎拒绝的玩家动作归为 `implementation`（关掉 sanitize 的用例）」，但：
   - `tests/server/selfplay.test.ts:49-74` 的「玩家侧动作被拒」用例先跑 `runSelfplay`，随后**手工拼一个 `summarize([{failure:{kind:'implementation'}}])`**（`:62-71`），只断言 `summarize` 会原样保留 `kind`；它没有测 runner 的归类。
   - `tests/server/selfplay.test.ts:167-190` 的「真的被引擎拒绝的玩家动作」用例只断言 `expect(outcomes).toHaveLength(1)`（`:188`）。它的假 decider 只在 `ctx.pending === 'kill'` 时返回非法狼刀；但一局从 `NIGHT_WOLF_CHAT` 开始，其它阶段返回 `{ action: undefined }`，`runGame` 在第一次夜聊就 `break` 了——P-1 实测 `events: 1`、`kind: 'model'`、`error: 'UNFINISHED：对局没有结束'`，根本没有走到「引擎拒绝」。
   - 变异探针：把 `runner.ts:139` 的 `kind` 固定为 `'model'`，`tests/server/selfplay.test.ts` **8/8 仍绿**（M-2）。这是 AC-6 的回归锁完全缺失的直接证据。

**结论：AC-6 FAIL**（C-184）。修法建议：无论是否终局，扫描 `finished.events` 中所有属于玩家席位（`record.playerSeat`）的 `REJECTED`，一旦出现就记 `implementation`；或者给 InputChannel 加一个可注入的玩家策略，让测试能真正制造非法玩家动作。测试应断言 `outcome.ok === false`、`failure.kind === 'implementation'`、`failure.seed`，并覆盖「一次拒绝后仍打完」的局。

### 2.3 AC-8 · RFC-001 的占位行为被移除

**成立，且反向探针有牙。**

- `scripts/selfplay.ts` 已替换占位入口；`tests/meta/selfplay-placeholder.test.ts` 已删除，替换为 `tests/meta/selfplay-entry.test.ts`（`git show --name-status HEAD` 可见）。
- `pnpm selfplay --games=1 --seed=9 --out=/tmp/howl-selfplay-meta`（`HOWL_FAKE_AI=1`）退出 0、stdout 含「跑完 1 局」、stderr 不含「未实现」；meta 用例 1/1 通过。
- M-1 把 `scripts/selfplay.ts` 临时改回 `console.error('pnpm selfplay 未实现（RFC-015）'); process.exit(1);`：
  - `tests/meta/selfplay-entry.test.ts` → **1 failed**（`result.code` 0 vs 1）；
  - `tests/server/selfplay.test.ts` 的 CLI 用例 → **1 failed**（`Command failed`，且 stdout 含「未实现」）。
- RFCS.md 的 C-5（RFC-001 占位偏离）在 RFC-015 完成后应视为消除；本轮据此把它标为已消除（见 §8.54）。

**结论：AC-8 PASS**。

### 2.4 AC-9 · seq 连续且可被 replay 重放

**行为成立，官方测试只覆盖 seq。**

- CLI 三局输出的 `game-1/2/3.jsonl`：首条 `seq=1`，逐条 +1，末条都是 `GAME_ENDED`（88 / 71 / 44 条）。
- 100 局输出的 100 个 `.jsonl` 全部逐条 +1，`replay(events)` 全部得到 `FINISHED`；截掉最后一条后 `replay` 落到 `NIGHT_RESOLVE`（P-6、P-8）。这证明「可重放」在当前实现里成立，并且 test plan 想要的断言是能区分退化的。
- 但官方用例 `tests/server/selfplay.test.ts:119-137` 只做两件事：`events.map(e => e.seq)`，断言从 1 开始逐条 +1；文件顶部没有 import `replay`。它没有调用 `replay`、没有断言末条是 `GAME_ENDED`、也没有断言 100 个文件全部可重放。
- 变异探针：把传给 `onGame` 的事件改成 `finished.events.slice(0, -1)`（最后一次 `GAME_ENDED` 被截掉），`tests/server/selfplay.test.ts` **8/8 仍绿**（M-4）。`TEST-STRATEGY.md:386` 计划的是「seq 连续且 replay 通过」，实际只落地了前半句。

**结论：AC-9 行为 PASS，验收测试 FAIL**（C-185）。修法：在 AC-9 用例的 `onGame` 回调里保存 events，逐局 `expect(replay(events).phase).toBe('FINISHED')`，并断言 `events.at(-1).type === 'GAME_ENDED'`；最好把 CLI 产出的文件也读回来重放一次。

### 2.5 CLI 用例是否真的跑了子进程

**是。** `tests/server/selfplay.test.ts:192-225` 用 `node:child_process.execFile` 起 `pnpm exec tsx scripts/selfplay.ts`，`env` 里显式注入 `HOWL_FAKE_AI=1`，超时 120s；`tests/meta/selfplay-entry.test.ts:16-25` 通过 `pnpm` helper 起真正的 `pnpm selfplay`。M-1 的占位还原让两条 CLI 用例都红，说明它们不是进程内 mock。

**但跨平台不成立（C-189）：** `tests/server/selfplay.test.ts:202-206` 直接 `execFile('pnpm', ...)`，没有传 `shell: true`，也没有像 `tests/meta/helpers/run.ts` 那样在 Windows 用 `pnpm.cmd`。Node 在 Windows 上不能直接 `execFile` 一个 `.cmd`（`pnpm` 的实现），因此 Windows 的 `pnpm test` 会在这一条用例上失败。AGENTS.md 明确要求 macOS 与 Windows 跑完同一套流程，而 meta helper 已经示范了正确写法；这条 CLI 用例应复用 `run` / `pnpm` helper，或至少复制 `process.platform === 'win32'` 分支。**说明：** 本机是 macOS，未在 Windows 实机执行；这个判定来自 Node 对 `.cmd` 的已知限制，以及仓库内 `tests/meta/helpers/run.ts` 已经为此写的分支，不是猜测。

---

## 3. 逐条 AC

| AC | 判定 | 会红 / 不会红 | 证据与说明 |
|---|---|---|---|
| 1 · 无浏览器跑 3 局、exit 0 | **PASS** | 会红（M-1；CLI 子进程） | 手工 `--games=3 --seed=1` exit 0；CLI 用例用 2 局，meta 用例 1 局，3 局的整批由 runner 单测覆盖。 |
| 2 · 第 N 局 seed + N | **PASS（测试偏弱）** | **不会红**（M-5） | 输出 `GAME_STARTED.seed` 实为 1/2/3；但用例只断言 `outcomes.map(o=>o.seed)` 与文件名，而这两个值都由 `outcome.seed` 派生。把 `createGame` 的实际 seed 改成常数 `options.seed` 后 AC-2 用例仍绿（M-5）→ C-190。 |
| 3 · 输出 summary + 每局事件流 | **PASS** | 会红（文件断言） | CLI 用例断言 `summary.json` 与 `game-3/4.jsonl`；失败局写空文件（P-2 的 CLI 行为）。原子写与「输出目录不存在时自动建」没有专门用例（非阻塞测试缺口）。 |
| 4 · summary 字段齐全 | **PASS** | 会红（report 单测） | `summarize` 单测断言 games/succeeded/failed/winDistribution/avgEvents/avgDurationMs/degradedCount/usage/wolfWinRate；CLI 的 summary 实跑含相同字段。失败局的 uses/degraded 不计入（C-191）。 |
| 5 · 单局失败不终止整批 | **PASS（边界 FAIL）** | 会红（M-3） | 中途抛错的假 LLM 被隔离（P-4）；但 `onGame` 写盘抛错会双记并让整批 reject（C-187）。 |
| 6 · 非法行动归类为实现缺陷 | **FAIL** | **不会红**（M-2） | 归类只在无 `GAME_ENDED` 时执行；两条官方 AC-6 用例都不测 runner 归类；固定 `kind='model'` 仍 8/8 绿（C-184）。 |
| 7 · 100 局不崩溃、内存不线性增长 | **PASS（手工）** | **不会红**（无测试） | 手工 100/100、real 1.67s、peak RSS 约 83 MB（10 局也 83 MB）；`TEST-STRATEGY.md:385` 计划的内存采样用例不存在（C-186）。 |
| 8 · 占位行为移除 | **PASS** | 会红（M-1） | 见 §2.3；C-5 偏离消除。 |
| 9 · seq 连续且可 replay | **PASS（测试只锁 seq）** | **不会红（replay 部分）**（M-4） | 100/100 可 replay；官方用例只断言 seq（C-185）。 |

---

## 4. 主动找 AC 覆盖不到的地方

### 4.1 随机源违反 DATA-5（C-188）

`scripted-player.ts:13,30,99` 的默认 RNG 是 `Math.random`；`runner.ts:36` 也把「默认 `Math.random`」写进注释。RFC-015 没有任何一处说明「为什么脚本策略不需要可复现」（`RULES DATA-5` 要求必须说明），§8.2 也没有登记。后果不只是规则问题：

同一命令 `HOWL_FAKE_AI=1 pnpm selfplay --games=100 --seed=1000` 连跑三次，狼人胜率分别是 **73.0% / 77.0% / 78.0%**（P-9，三个不同输出目录的 `summary.json`）。`--seed` 只固定了发牌，玩家策略的随机输入不在种子控制下；失败种子无法靠重跑复现，SM-1 的成功率与 `--seed` 的可核对性都因此变弱。修法：用 RFC-002/003 已有的 mulberry32/`RngState` 派生一个**独立于对局 rng** 的玩家 PRNG（`seed` 或 `seed + N`），把它注入 `runSelfplay`；或者在 RFC §8.2 明确登记「脚本策略接受不可复现，因此 DATA-5 不适用」并由用户确认。

### 4.2 `onGame` 写盘失败（C-187）

见 §2.1。除「整批中止」外，还有一个次级问题：异常局在 `catch` 里以 `[]` 调 `onGame`，所以中途失败的那一局只留下一个**空** `.jsonl`，已产生的事件全部丢失；排障时看不到失败前发生了什么。

### 4.3 `legalActionFor` 的 kill 兜底会把自己当目标（C-196）

`scripted-player.ts:122-126` 在合法目标为空时返回 `{ type:'WOLF_KILL', target: seat }`——狼刀自己。这个 helper 的契约是「保证合法」，但引擎对狼刀自己应当拒绝；一旦真的没有合法目标，默认 sanitize 反而会制造一个非法动作（随后被拒绝/空转）。返回 `undefined` 让编排层停住更诚实。当前路径很窄（只有极端残局），所以列为非阻塞。

### 4.4 失败记录缺「错误类型」（C-192）

RFC §2.4 要求记录「错误类型 + 消息 + 该局种子」；`GameFailure` 只有 `{ seed, kind, error }`（`report.ts:10-14`）。`catch` 只取 `cause.message`（`runner.ts:160-161`），丢掉了 `LlmError.code` / `Error.name`；`ended === undefined` 路径把引擎的 `code` 拼进 message（`runner.ts:140`），但结构化字段没有。另：summary 没有 `modelFailed` / `implementationFailed` 分项计数（只能从 `failures[].kind` 自行统计），CLI 只打印「成 / 败」。建议加 `type`（错误类名或 code）与 `failureKinds`。

### 4.5 文档与计划漂移（C-193 / C-195）

- RFC §8.4 第 6 行把 AC-6 写成 PASS，但证据不成立（见 §2.2）；第 9 行只写 seq，没有 replay；第 7 行是手工记录，与 `TEST-STRATEGY.md:385` 的自动内存用例不一致。
- RFC §2.1/§2.3 写每局 `events.jsonl`，实现是 `game-<seed>.jsonl`（用户已在任务说明中批准），但 §8.2 没有登记这条偏离；`beforeGame` 这个只给测试用的生产参数（`runner.ts:44-45,65`）也没有登记。
- `TEST-STRATEGY.md:32-33` 的「当前实测」仍是 88 files / **720 tests**（实为 756），`unit 68` 也与 88 的分项目录不符；:38 仍说 15 个 RFC 全是 `proposed`；:133 仍把已删除的 `selfplay-placeholder.test.ts` 标为 `existing`；RFC-015 小节（:377-386）仍是 `proposed`。
- `README.md:11,18` 仍写 720 个用例、八个 RFC 合入；:36-37 仍说「RFC-001 ~ 013 全部 Reviewed；剩余：014 / 015 / 016」，实际 RFC-014 已 Reviewed、RFC-015 已 Implemented。这些是文档同步问题，不改状态判定，但应在合并前一起修。

### 4.6 提交了生成物（C-194）

`git show --name-status HEAD` 显示 RFC-015 提交新增了 `reports/game-1.jsonl`（0 字节）与 `reports/summary.json`（内容是「缺少 DEEPSEEK_API_KEY」的失败运行）；`.gitignore` 没有忽略 `reports/`，而 CLI 默认 `--out=./reports`（`scripts/selfplay.ts:39`）。结果是：用户按 RFC 的示例跑一次 `pnpm selfplay` 就会修改仓库里已跟踪的两个文件，`git status` 变脏；失败的 summary 也会被误当成验收证据。建议把 `reports/` 加进 `.gitignore` 并从版本库移除这两个生成物；若要保留示例，用 `reports/README` 或固定夹具目录。

### 4.7 另一些非阻塞的实现细节

- `scripts/selfplay.ts:66` 的 `seq: () => 0` 让每次 LLM 决策的 `CallMeta.seq` 恒为 0。本 RFC 不消费该字段，但如果将来按 seq 归因调用，这里会丢轮次信息。
- `runner.ts:73` 在玩家输入循环里 `await import('../project')`，每个玩家动作一次动态导入；模块缓存后开销可忽略，但静态 import 更直白，也没有循环依赖的必要。
- `scripts/selfplay.ts:25-41` 的 `parseArgs` 没有单测；`--games=abc` 会静默回落到 1（`Number.isFinite`），与「非法参数应报错」的直觉不一致。这不属于 AC，但作为 CLI 入口建议补用例或在 `--help` 中说明。

---

## 5. 维度结论

### 5.1 RFC ADHERENCE — **NEEDS WORK**

- AC-1 / 3 / 4 / 8 的实现与输出契约成立；AC-2 的输出可核对（seed 出现在 `GAME_STARTED`），但测试偏弱。
- AC-5 主路径成立，写盘失败边界不成立；AC-6 不成立（已完成局里的玩家拒绝不被归类）、且没有测试；AC-7 只有手工证据；AC-9 行为成立、测试只锁 seq。
- §8.2 未登记 `game-<seed>.jsonl` 命名与 `beforeGame` 测试缝；§8.4 的 AC-6 PASS 与 AC-7「PASS（手工）」、AC-9 证据与实测不完全一致（DOC-1）。

### 5.2 RULES COMPLIANCE — **NEEDS WORK**

| 规则 | 判定 | 证据 |
|---|---|---|
| **DATA-5** | **FAIL** | `scripted-player.ts:30,99` 使用 `Math.random`；RFC 未说明为何不需要可复现；同 seed 三次跑出 73/77/78% 胜率（P-9）。 |
| **TEST-1** | **FAIL** | AC-6 归类无测试（M-2 绿）；AC-9 replay 无测试（M-4 绿）；AC-7 计划测试未落地（C-186）；AC-2 的测试不校验真实 seed（M-5 绿）。 |
| **DOC-1** | **NEEDS WORK** | AC-6 的 PASS 证据不成立；文件命名 / `beforeGame` 未登记；TEST-STRATEGY / README 落后（C-193 / C-195）。 |
| **OPS-3** | **PASS** | `pnpm selfplay` 无浏览器跑完指定局数并输出汇总；exit 0（全成）/ 1（有失败），见 §0。 |
| **ARCH-1** | **PASS** | `src/engine/` 未新增依赖；selfplay 在 `src/server/`，复用 `runGame`。 |
| **DATA-1 / DATA-3** | **PASS（行为）** | 每局 seq 从 1 连续；100/100 可 replay 到 FINISHED（P-8）。 |
| **STYLE-6 / STYLE-3 / STYLE-5** | **PASS** | 最大 179 行；未见 `any`（`as never` 只在既有边界）；具名导出。 |
| **跨平台（AGENTS.md）** | **FAIL** | `tests/server/selfplay.test.ts:202` 直接 `execFile('pnpm')`，Windows 无 `pnpm.cmd` / shell 处理（C-189）。 |

### 5.3 SECURITY — **PASS**

- selfplay 只在本地写文件，不启动 Fastify/Vite、不发网络请求（`HOWL_FAKE_AI=1` 全脚本；真实路径仍经 RFC-006 的单一客户端）。
- `summary.json` 不含 key；错误信息只含消息，LLM 错误已由 `client.ts` 脱敏（SEC-7 的既有实现）。
- 事件流 JSONL 含 `visibleTo: 'server'` 的 `GAME_STARTED`（全员角色）——这是 RFC-014 复盘/离线分析所需的完整事件流，且文件只在开发者本地；不是 SEC-5 的客户端投影泄漏。没有新的注入/XSS 面。
- 唯一需要留意的是 `reports/summary.json` 把失败原因写进仓库；它不含密钥，但属于生成物，见 C-194。

### 5.4 PERFORMANCE — **PASS（有 AC-7 测试缺口）**

- 100 局 real 1.67s；10 局与 100 局的峰值内存都约 83 MB（`/usr/bin/time -l` 的 peak memory footprint），没有随局数线性增长到不可接受的程度。
- 串行执行符合 RFC §6；每局新建 `InMemoryMetaStore` 后不再持有引用，旧局可被 GC。
- 仍有一个理论上的线性增长点：`src/server/llm/usage.ts` 的模块级 `Map` 按 gameId 永久累计（真实 LLM 路径每局一条）；100 局只有 100 条，量级可忽略，但没有清理入口。C-186 的内存用例落地时应把这一点显式纳入或说明。

### 5.5 MAINTAINABILITY — **NEEDS WORK**

- 代码组织清晰、注释解释了「为什么」，`runner` / `report` / `scripted-player` 职责分开。
- 测试质量是主要问题：AC-6 的手工 summary 与 `toHaveLength(1)`、AC-9 只测 seq、AC-2 只测派生字段——这些都是「断言了同一段簿记」而不是行为。M-2 / M-4 / M-5 是直接证据。
- `beforeGame` 是专为测试新增的生产参数；用假的 `decide` 抛错即可覆盖同一条 catch（P-4 已证明），建议删除该缝或至少登记。
- 提交生成物、README/TEST-STRATEGY 数字落后，见 C-194 / C-195。

---

## 6. 发现汇总

### 阻塞（必须修复后才能合并）

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-184** | AC-6 / TEST-1 / DOC-1 | 归类只在 `GAME_ENDED` 缺失时执行（`runner.ts:121-145`）；已结束局里的玩家拒绝被静默忽略。两条 AC-6 用例都不测 runner 归类（`:49-74` 手工拼 summary；`:167-190` 只 `toHaveLength(1)`，且 P-1 证明根本没走到拒绝）。固定 `kind='model'` → 8/8 绿（M-2）。§8.4 的 AC-6 PASS 与实测不符。 | 扫描 `finished.events` 中玩家席位的所有 `REJECTED`（无论是否终局）；补「一次非法玩家动作后仍打完」的用例，断言 `ok=false`、`kind=implementation`、`seed`；删掉手工 summary。 |
| **C-185** | AC-9 / TEST-1 | 官方用例只断言 seq（`selfplay.test.ts:119-137`），没有 `replay`；截掉最后一条事件后仍 8/8 绿（M-4）。行为本身成立（100/100 replay FINISHED，P-8），但 `TEST-STRATEGY.md:386` 计划的「replay 通过」没落地。 | 在 `onGame` 收集事件，逐局 `replay(events)` 断言 `FINISHED`、末条 `GAME_ENDED`；可加一条读回 CLI 文件再重放的用例。 |
| **C-186** | AC-7 / TEST-1 | `TEST-STRATEGY.md:385` 计划的 100 局内存采样用例不存在；RFC §8.4 只有「手工执行记录」，§8.6 没有说明为什么不可自动化。 | 在 `tests/server/selfplay.test.ts` 加 100 局（脚本 AI，约 2s），断言不崩溃 + 采样 `process.memoryUsage().heapUsed` 的峰值不随局数线性增长；若因稳定性不放进常规套件，需在 RFC 写明理由并纳入 meta 门禁。 |
| **C-187** | AC-5 / §2.4 | `onGame` 抛错会从 catch 再次调用并逃逸（`runner.ts:163-174`），整批 reject；第一次成功 outcome 与第二次失败 outcome 重复。P-2 实测。 | 把每局的 outcome 组装与 `onGame` 都包进单局 `try`；确保一局只 push 一次 outcome；`onGame` 失败记为该局失败、继续下一局；失败局用已产生的事件而不是 `[]` 落盘。 |
| **C-188** | DATA-5 / NFR-18 意图 | `scripted-player.ts:30,99` 使用 `Math.random`；RFC 未说明为何不需要可复现。同 seed 三次跑出 73/77/78% 胜率（P-9），失败 seed 无法复现。 | 从 `seed` / `seed+N` 派生独立 PRNG 注入玩家策略；或按 DATA-5 的「确需」在 §8.2 登记并由用户确认。 |
| **C-189** | AGENTS.md 跨平台 / TEST-1 | `tests/server/selfplay.test.ts:202` 直接 `execFile('pnpm', ...)`，无 Windows `.cmd` / `shell` 分支；`tests/meta/helpers/run.ts` 已有正确写法。Windows 的 `pnpm test` 会在这条用例上失败。 | 复用 `tests/meta/helpers/run.ts` 的 `pnpm()`，或在本地复制 `process.platform === 'win32'` 分支。 |

### 非阻塞（建议合并前一起修）

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-190** | AC-2 / TEST-1 | 用例只断言 `outcome.seed` 与文件名，二者都由 `seed + index` 派生；把 `createGame` 的实际 seed 改成常数仍绿（M-5）。当前输出里的 `GAME_STARTED.seed` 确实是 1/2/3。 | 在 AC-2 用例的 `onGame` 里断言第一帧事件 `GAME_STARTED.payload.seed === seed + index`。 |
| **C-191** | AC-4 | `summarize` 只累计成功局的 usage（`report.ts:77-80`）；失败局里已花的 token 不进合计。P-7 实测失败局记录 15 token，summary 仍为 0。 | 在失败 outcome 上也调用 `usageOf(record.gameId)`，并把所有 outcome 的 usage 相加；或明确在 summary 区分「成局 token / 总 token」。 |
| **C-192** | §2.4 / AC-4 | 失败记录缺「错误类型」（只有 kind + message）；summary 无 model/implementation 分项计数；CLI 只打印成/败。 | `GameFailure` 加 `type`（`Error.name` 或 `LlmError.code`）；summary 加 `failureKinds: { model, implementation }` 并在 stdout 打印。 |
| **C-193** | DOC-1 | `game-<seed>.jsonl`（RFC 写 `events.jsonl`）与 `beforeGame` 测试缝未登记；§8.4 AC-6/7/9 的证据表述与实测不一致；失败局写空文件未说明。 | 在 §8.2 补 D-6/D-7；§8.4 按实测改写；若文件命名是用户批准的，写明「用户同意」。 |
| **C-194** | 仓库卫生 | RFC-015 提交新增了 `reports/game-1.jsonl`（0 字节）与 `reports/summary.json`（缺 key 的失败运行），`.gitignore` 未忽略 `reports/`；默认 `--out=./reports` 会修改已跟踪文件。 | 删除生成物、把 `reports/` 加进 `.gitignore`；或把默认输出改到被忽略的目录。 |
| **C-195** | 文档漂移 | README `:11,18,36-37` 仍写 720 用例 / 八个 RFC / 剩余 014-016；TEST-STRATEGY `:32-33` 写 88 files/720 tests（实为 756），`:38` 写 15 个 proposed，`:133` 引用已删除的 placeholder 测试，RFC-015 小节仍 proposed。 | 合并前同步数字与状态；`TEST-STRATEGY` 的 RFC-015 行改为 `existing` 并登记实际测试文件。 |
| **C-196** | AC-6 防御 | `legalActionFor` 的 kill 兜底在无合法目标时返回「刀自己」（`scripted-player.ts:122-126`），它不是合法动作。 | 返回 `undefined`，让编排层停住；补一条空目标用例。 |

---

## 7. 探针记录

所有探针均使用文件备份恢复；没有使用 `git checkout` / `git restore`。

| 探针 | 变更 / 内容 | 结果 |
|---|---|---|
| **M-1** | `scripts/selfplay.ts` 改回「未实现（RFC-015）」+ `exit 1` | unit 的 CLI 用例 **1 failed / 7 passed**；meta AC-8 **1 failed** → 两个 CLI 用例都真的走子进程；恢复后 SHA-256 `ed3a…` |
| **M-2** | `runner.ts:139` 的 `kind` 固定为 `'model'` | `tests/server/selfplay.test.ts` **8/8 passed** → AC-6 归类没有回归锁 |
| **M-3** | `runner.ts:159` 的 catch 开头加 `throw cause` | AC-5 用例 **1 failed / 7 skipped** → 隔离 catch 有牙 |
| **M-4** | 成功/失败路径传给 `onGame` 的 `finished.events` 改成 `slice(0, -1)` | `selfplay.test.ts` **8/8 passed** → AC-9 replay 没有回归锁 |
| **M-5** | `createGame` 的 `seed` 改成常数 `options.seed` | AC-2 用例 **1 passed / 7 skipped** → AC-2 只校验簿记 |
| **P-1** | 复用 AC-6「sanitize off」场景，打印 outcome | `[{"seed":5,"ok":false,"events":1,"failure":{"kind":"model","error":"UNFINISHED…"}}]` → 根本没到狼刀拒绝 |
| **P-2** | `onGame` 抛 `磁盘写入失败` | `runSelfplay` reject（错误逃逸自 `runner.ts:174`）；若第二次写成功会产生重复 outcome |
| **P-3 / P-8** | 收集每局事件并 `replay` | 2/2、随后 100/100 都 `FINISHED`；100 个文件 seq 全部连续 |
| **P-4** | 假 LLM 在全局第 5 次决策抛错 | 第 1 局失败（model），第 2/3 局成局 → 单局 LLM 失败隔离成立 |
| **P-5** | 假 AI 在 `NIGHT_WOLVES` 反复刀队友 | 引擎拒绝 `WOLF_KILL_WOLF`，归类 `kind=model` → 有拒绝不等于玩家缺陷 |
| **P-6** | `replay(events.slice(0,-1))` | 得到 `NIGHT_RESOLVE` 而不是 `FINISHED` → 截断能被 replay 断言抓到 |
| **P-7** | 失败局里先 `recordUsage` 15 token 再抛错 | `summary.usage = {calls:0,...}` → 失败局 token 丢失 |
| **P-9** | 同 seed `--games=100` 连跑三次 | 狼人胜率 73.0% / 77.0% / 78.0% → `Math.random` 让批次不可复现 |

---

## 8. 结论

**Overall Risk Level: High。**

**Summary**：`pnpm selfplay` 已经能跑、能写 summary、能隔离中途抛错的假 LLM；AC-1/3/4/8 的行为与 AC-9 的当前输出都是成立的，100 局实测 1.67s、内存未见线性增长。问题集中在**验收标准被过度声明**：AC-6 的「实现缺陷」归类只在没有终局时执行，官方两条 AC-6 用例都没有测 runner 的归类（固定 `kind='model'` 仍全绿）；AC-9 只测了 seq、没有 replay；AC-7 只有手工记录、没有计划中的内存用例；AC-2 的测试也只断言簿记。另有两条直接违反硬规则/跨平台约定的问题：`Math.random` 违反 DATA-5（同 seed 三次跑出 73/77/78%），以及 CLI 用例在 Windows 上无法启动 `pnpm`。写盘回调 `onGame` 的二次调用还会在失败时把整批带走。

**Blocking Issues（必须修复后才能合并）**：C-184（AC-6）、C-185（AC-9 测试）、C-186（AC-7 测试）、C-187（`onGame` 失败隔离）、C-188（DATA-5）、C-189（Windows CLI 用例）。

**Improvement Suggestions（非阻塞）**：C-190 ~ C-196 见 §6；优先级最高的是 AC-2 补真实 seed 断言、失败局 usage 计入、失败记录补错误类型、清理提交的 `reports/` 生成物，并同步 README / TEST-STRATEGY 的数字与状态。

**状态**：`RFCS.md` 中 RFC-015 的 Status 置为 **`Changes requested`**；RFC-001 的 C-5 占位偏离已在 AC-8 实测与变异探针下消除。C-184 ~ C-196 已登记到 RFCS.md §8.54。本轮没有修改 `src/`、`RULES.md`、`PRD.md`、`FEATURES.md`、`TEST-STRATEGY.md`；没有 `git commit`；工作树 clean。

---

## Round 2 -- 2026-11-20

> 评审时间：2026-11-20 · 被评审提交：`9ee5cfb fix(rfc-015): 拒绝归属、确定性随机与写盘隔离（Round 1）` · HEAD `9ee5cfb`
> 评审方式：全新上下文的 subagent，只读仓库文件；本会话没有写过 RFC-015 的实现代码。
> 结论：**Changes requested** · Overall Risk Level: **High**

本轮按用户指定只复核 Round 1 的 C-184 ~ C-189 与「非阻塞项也已处理」的声明；Round 1 之前已关闭的条目（C-5 等）不重查。先给结论表，再展开。

### 2.0 结论表

| Round 1 项 | 本轮结论 | 最短证据 |
|---|---|---|
| **C-184** AC-6 归类 | **未闭合（阻塞）**：成局扫描的行为已修，但回归锁仍缺 | 新用例只测 `findPlayerRejection` 本身；把 `runner.ts:151` 的成局扫描关掉后 `selfplay.test.ts` **14/14 仍绿**（M-R2-1）。真实注入一票非法投票后，行为确实归为 `implementation`（P-R2-1），但没有任何官方用例走这条路径。 |
| **C-185** AC-9 replay | **闭合** | 新用例 `selfplay.test.ts:302-323`；把成功路径事件截掉最后一条后 **1 failed**（`DAY_LYNCH` vs `FINISHED`，M-R2-3）。 |
| **C-186** AC-7 内存 | **按指定口径闭合**；测试偏弱（C-197） | 30 局 / <96MB 用例存在（`selfplay.test.ts:291-300`）；但注入 2MB/局、30 局共 60MB 的线性泄漏仍通过（M-R2-5），它不能证明「不随局数线性增长」。 |
| **C-187** `onGame` 隔离 | **未闭合（阻塞）**：未终局路径仍绕过 `report()`，写盘失败会双记 | `runner.ts:146` 直接 `await options.onGame`；`maxSteps: 1`、2 局、`onGame` 必抛时得到 **4 条 outcome**（每局 `UNFINISHED` + `REPORT_FAILED` 各一条，P-R2-2），`summary.games` 会变成 4。 |
| **C-188** DATA-5 / 可复现 | **闭合** | 每局 `mulberry32(seed)`（`runner.ts:56-57`）；退回 `Math.random` 后 C-188 用例 **5/5 次 1 failed**（M-R2-2）；两次 CLI 同 seed 10 局，去掉 `gameId`/`ts` 后 10/10 事件流逐字节相同（P-R2-4）。 |
| **C-189** Windows CLI | **未闭合（阻塞）**：代码根本没改 | `tests/server/selfplay.test.ts:202-206` 仍直接 `execFile('pnpm', ...)`；没有 `pnpm.cmd` / `shell` 分支。fix commit 对该文件只追加了 6 条用例，CLI 块原样未动。 |
| **非阻塞** | 只有 C-194 真正闭合 | C-190 / C-191 / C-192 / C-193 / C-195 / C-196 仍 Open；详见 §2.9。 |

### 2.1 STEP 0 · 实跑门禁

环境：macOS · Node `v22.22.2` · pnpm `10.33.0` · HEAD `9ee5cfb` · 评审开始时 `git status --porcelain` 为空。全部探针从 `/tmp/howl-rfc015-r2/backup/` 的**文件备份**恢复，**未使用 `git checkout` / `git restore`**。

```text
$ pnpm typecheck            → exit 0
$ pnpm lint                 → exit 0
$ pnpm format:check         → All matched files use Prettier code style! → exit 0
$ pnpm build                → client 139 modules / server 65 modules → exit 0
$ pnpm test                 → Test Files 88 passed (88) / Tests 762 passed (762) → exit 0（44.11s）
$ pnpm test:e2e             → 10 passed (11.8s) → exit 0
$ pnpm exec vitest run --project unit --coverage
                            → All files 行 96.96% / 分支 92.85% → exit 0
$ pnpm exec vitest run --project unit tests/server/selfplay.test.ts
                            → 14 passed (1.16s) → exit 0
```

探针恢复后完整 `pnpm test` 再跑一遍仍是 **88 files / 762 tests**；`pnpm test:e2e` 10/10。被探针改过的三个文件备份在 `/tmp/howl-rfc015-r2/backup/`，恢复后 SHA-256 与探针前一致：

```text
e744510639658424cc623d8062dd5ffad62ae7710f1da586bea4c842fc73cefb  src/server/selfplay/runner.ts
46663d0869768dd5a70a1ef05bf819a58ca3d62fde1a8e853545dfed4a25e14e  src/server/selfplay/scripted-player.ts
66274333343efc5e2f1c766fe78e936c9b44c681ccd4dc3ebadae18f03e6926f  tests/server/selfplay.test.ts
```

临时探针 `tests/server/__probe-rfc015-r2.test.ts` 已删除；探针结束时 `git status --porcelain` 为空；没有 `git commit`。

runtime 实证：

```text
$ HOWL_FAKE_AI=1 pnpm selfplay --games=3 --seed=1 --out=/tmp/howl-rfc015-r2/out3
  跑完 3 局：成 3 / 败 0；狼人胜率 100.0%；平均 72.0 条事件
  exit 0；summary.json + game-1/2/3.jsonl；三局 GAME_STARTED.seed 分别为 1/2/3

$ HOWL_FAKE_AI=1 pnpm selfplay --games=100 --seed=1000 --out=/tmp/howl-rfc015-r2/out100b
  跑完 100 局：成 100 / 败 0；狼人胜率 74.0%；平均 76.3 条事件、0.0 秒
  real 1.66s；peak memory footprint 82,908,608 bytes（约 82.9 MB）
```

### 2.2 产品类型

`PRD.md` 的 **Product Type** 为 **game（主）+ web app（交付形态）**（`PRD.md:20-22`）。RFC-015 是验证工具而不是玩家界面：适用检查是 CLI 可执行性、失败隔离、输出契约、可重放性与跨平台；不适用浏览器、响应式、键盘/读屏等 web app 检查。本 RFC 没有 UI 改动，`test:e2e` 10/10 是回归证据，不是本 RFC 的验收手段。

### 2.3 C-184 · AC-6：行为已修，回归锁仍缺

**行为层面成立。** 用新加的 `playerInput` 钩子在 seed 3（玩家是狼、白天存活）注入一票投给死者的 `VOTE`，随后让玩家正常投票把局打完：

```text
P-R2-1  ended=true
  REJECTED { visibleTo: 'self:1',
             payload: { actionType: 'VOTE', code: 'TARGET_NOT_ALIVE',
                        message: '座位 2 已出局，不能投' } }
  outcome  { seed: 3, ok: false, events: 45,
             failure: { seed: 3, kind: 'implementation',
                        error: 'TARGET_NOT_ALIVE：座位 2 已出局，不能投' } }
```

`runner.ts:150-167` 在成局后调用 `findPlayerRejection(finished.events, record.playerSeat)`，按 `visibleTo === 'self:1'` 归属，确实把「玩家动作被拒」的成局判为 `implementation`。这一半与 Round 1 的要求一致。

**但验收测试仍没有覆盖 runner 的归类（阻塞）。**

- 新用例 `tests/server/selfplay.test.ts:259-289` 只做两件事：直接调用 `findPlayerRejection` 的三组夹具（玩家 / 他人 / 夜间），以及跑 2 局正常对局后断言没有 `implementation`。它没有断言「一次非法玩家动作后仍打完」的结局、`kind`、`seed` 或事件数。
- 新增的 `playerInput` 生产接口（`runner.ts:42-43,84`）在全仓库**没有任何测试使用**；`grep playerInput` 只命中声明与 runner 自身。这正是本应写 AC-6 端到端用例的缝。
- 旧的两条 AC-6 用例原样保留：`:49-74` 仍然手工拼 `summarize([{failure:{kind:'implementation'}}])`；`:167-190` 仍然只断言 `expect(outcomes).toHaveLength(1)`，Round 1 的 P-1 已证明那局 `events:1`、根本没走到拒绝。
- **M-R2-1**：把 `runner.ts:152` 的 `if (playerRejected !== undefined)` 改成 `if (playerRejected !== undefined && false)`（即关闭成局扫描），`tests/server/selfplay.test.ts` **14/14 仍绿**。删除 `runner.ts:150-167` 整段也一样。这是 AC-6 回归锁缺失的直接证据。

**另一个小的 AC-6 边界（非阻塞 C-200）：** 注入 `VOTE target=999` 时，引擎在 `isAlive` 里抛 `InvalidEventStreamError('座位 999 不在本局座位表中')`，runner 的 catch 用 message 正则 `/INVALID_|非法|NOT_YOUR_TURN|RULE_/` 判断，匹配不上，于是记成 `kind:'model'`：

```text
P-R2-1b { seed: 3, ok: false, events: 0,
          failure: { seed: 3, kind: 'model',
                     error: '座位 999 不在本局座位表中',
                     errorType: 'InvalidEventStreamError' } }
```

脚本玩家正常不会产生越界目标，所以列为非阻塞；但 AC-6 的「非法玩家动作 → 实现缺陷」在抛错路径上并不完整，且 catch 的分类依赖文案正则，容易随错误文案漂移。

**结论：AC-6 行为 PASS，验收测试仍 FAIL；C-184 以「回归锁」理由保持阻塞。**

### 2.4 C-185 · AC-9：replay 已闭合

新用例在 `onGame` 回调里保存每局事件，逐局 `replay(events)` 断言 `phase === 'FINISHED'`，并断言最后一条是 `GAME_ENDED`（`tests/server/selfplay.test.ts:302-323`）。反向探针：

- **M-R2-3**：把成功路径传给 `onGame` 的事件改成 `finished.events.slice(0, -1)`，该用例 **1 failed**，`replay` 得到 `DAY_LYNCH` 而不是 `FINISHED`。这条用例现在能区分「截断事件流」的退化。

**仍有一个非阻塞的测试质量点（C-199）：** 如果 `onGame` 一次都没有被调用，`streams` 为空，`for` 循环零次，这条用例会空真通过。建议加 `expect(streams).toHaveLength(2)`（或 `expect(streams.length).toBeGreaterThan(0)`）作为前置断言。

**结论：C-185 闭合。**

### 2.5 C-186 · AC-7：用例已落地，但不能证明「不随局数线性增长」

新用例（`tests/server/selfplay.test.ts:291-300`）读取 `process.memoryUsage().heapUsed`，跑 30 局，断言 `after - before < 96 * 1024 * 1024`。它满足用户指定的「30 局堆增长 < 96MB」口径，且 100 局实测 1.66s、峰值约 82.9MB，行为层面没有观察到线性增长。

**但这条用例的灵敏度很低。** 96MB / 30 局 = 3.2MB/局；只要每局泄漏低于这个数，它就绿。**M-R2-5** 在每局开头 `push` 一个 2MB 的字符串（30 局共 60MB，全部被模块级数组持有），C-186 用例**仍 1 passed**（322ms）。它也不能比较 10 局与 30 局的增长斜率，只测了一个端点。

**结论：C-186 按指定口径闭合；「不随局数线性增长」的证据仍弱，登记为 C-197（非阻塞）。**

### 2.6 C-187 · `onGame` 隔离：完成路径已修，未终局路径仍双记

**完成路径成立。** 官方用例（`tests/server/selfplay.test.ts:241-257`）在第二局 `onGame` 抛 `磁盘满`，断言 `outcomes` 仍为 3 条、第二局 `failure.error` 含 `REPORT_FAILED`、第三局仍成局；`runner.ts:209-222` 的 `report()` 把写盘异常收在该局，不终止整批。这一半符合 Round 1 的要求。

**未终局路径没有走 `report()`（阻塞）。** `runner.ts:146` 仍是：

```ts
await options.onGame?.(outcomes[outcomes.length - 1] as GameOutcome, finished.events);
```

它直接调用 `onGame`，没有经过 `report()` 的 try/catch。于是：

1. 该局先 push 一条 `UNFINISHED` 的 outcome；
2. `onGame` 抛错，被外层 `catch (cause)` 接住；
3. catch 再 push 一条同 seed 的 failure（并调用 `report`，若再抛则记 `REPORT_FAILED`）。

**P-R2-2** 用 `games: 2, seed: 3, maxSteps: 1`（两局都不会出现 `GAME_ENDED`）且 `onGame` 恒抛 `磁盘满`，得到 **4 条 outcome**：

```text
[
  { seed: 3, ok: false, events: 2, failure: { kind: 'model', error: 'UNFINISHED：对局没有结束' } },
  { seed: 3, ok: false, events: 0, failure: { kind: 'model', error: 'REPORT_FAILED：磁盘满' } },
  { seed: 4, ok: false, events: 2, failure: { kind: 'model', error: 'UNFINISHED：对局没有结束' } },
  { seed: 4, ok: false, events: 0, failure: { kind: 'model', error: 'REPORT_FAILED：磁盘满' } }
]
```

`summary.games` 因此会从用户请求的 2 变成 4，`failed` 也翻倍；同一局既算「未完成」又算「报告失败」。它没有终止整批，但破坏了 AC-4 的「总局数」与「一局只 push 一次 outcome」的汇总正确性。修法很小：把 `runner.ts:146` 也换成 `await report(options, outcomes[outcomes.length - 1] as GameOutcome, finished.events);`，并补一条 `maxSteps: 1` + `onGame` 抛错的用例，断言 `outcomes` 仍为请求局数、每局只有一条 `REPORT_FAILED`。

**结论：C-187 主路径 PASS，未终局路径 FAIL；以「双记 / summary.games 失真」理由保持阻塞。**

### 2.7 C-188 · DATA-5：确定性随机已闭合

`runner.ts:56-57` 每局用 `options.rng ?? mulberry32(seed)`，同一个 `rng` 同时给 `scriptedPlayerAction` 与 `legalActionFor` 的兜底（`runner.ts:57,86,117`）。`scripted-player.ts:16-29` 的 `mulberry32` 与引擎 `src/engine/rng.ts` 的 `nextRandom` 位级一致。

- **M-R2-2**：把 `runner.ts:57` 的 `mulberry32(seed)` 改成 `Math.random`，C-188 用例连续 5 次都是 **1 failed**（事件数两次不一致）。
- **P-R2-4**：`HOWL_FAKE_AI=1 pnpm selfplay --games=10 --seed=77` 跑两次，去掉 `gameId`（UUID）与 `ts`（时钟）后，10/10 局的事件流逐字节相同；两次 summary 的胜负分布与平均事件数也一致（70.0% / 82.3）。

**结论：C-188 闭合。**

### 2.8 C-189 · Windows CLI 用例：完全未修

Round 1 的阻塞项指的是 `tests/server/selfplay.test.ts:192-225` 这条**真的起子进程**的 CLI 用例。当前代码仍：

```ts
const result = await run(
  'pnpm',
  ['exec', 'tsx', 'scripts/selfplay.ts', '--games=2', '--seed=3', `--out=${out}`],
  { env: { ...process.env, HOWL_FAKE_AI: '1' }, timeout: 120_000 },
);
```

（`:202-206`。）没有 `process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'`，没有 `shell: true`，也没有复用 `tests/meta/helpers/run.ts` 的 `pnpm()`——后者已经在 `tests/meta/helpers/run.ts:8,37` 处理了 `PNPM_BIN` 与 `shell`。`git diff 368fa9b..9ee5cfb -- tests/server/selfplay.test.ts` 的改动从文件末尾 224 行才开始，CLI 块**完全没有被碰过**。RFC §8.7 写「按平台选 `pnpm.cmd`」，与代码不符。

Node 在 Windows 上不能用 `execFile` 直接启动 `.cmd`；`tests/meta/selfplay-entry.test.ts` 已经用 `pnpm()` helper 示范了正确写法。这不是本机可复现的问题（本机是 macOS），但 AGENTS.md 明确要求 macOS 与 Windows 跑完同一套流程；Windows 的 `pnpm test` 会在这一条上失败。

**结论：C-189 仍 Open（阻塞）。**

### 2.9 非阻塞项的声明核查

用户消息称「非阻塞项也已处理」。逐条对照如下：

| 项 | 声明 | 实际 | 结论 |
|---|---|---|---|
| **C-190** AC-2 真 seed | 未在消息里单列 | 用例仍只断言 `outcome.seed` 与文件名（`selfplay.test.ts:14-26`）；**M-R2-4** 把 `createGame` 的 seed 改成常数 `options.seed` 后，AC-2 用例 **1 passed / 13 skipped**。 | **仍 Open（非阻塞）** |
| **C-191** 失败局 usage | 「失败局 usage 计入汇总」 | `report.ts:79-82` 仍只累加 `succeeded`；`report.ts` 的 diff 只加了 `errorType` 字段。**P-R2-3**：失败局 outcome 带 `usage {calls:1,inputTokens:100,outputTokens:40,cachedTokens:10}`，`summarize().usage` 仍是 `{calls:0,...}`。 | **仍 Open（非阻塞）** |
| **C-192** errorType | 「失败记录加 `errorType`」 | 只有 catch 路径写了 `errorType`（`runner.ts:195`）；未终局路径（`:140-144`）、成局但玩家被拒路径（`:159-163`）、`REPORT_FAILED`（`:219`）都没有；summary 仍无 `failureKinds`；CLI 现在打印 `（kind）`，但不打印 `errorType`。 | **部分；仍 Open（非阻塞）** |
| **C-193** DOC-1 | 「文档同步」 | `RFCs/RFC-015` §8.2 仍只有 D-1 ~ D-5，没有登记 `game-<seed>.jsonl` 命名、`beforeGame` 或新增的 `playerInput` 测试缝；§8.4 仍写 AC-6「关掉 sanitize 的用例」、AC-7「手工」、AC-9 只写 seq；§8.5 仍是 756 tests，§8.7 才是 762。 | **仍 Open（非阻塞）** |
| **C-194** `reports/` 生成物 | 「移出仓库并加 `.gitignore`」 | `git ls-files reports` 为空；`.gitignore` 含 `reports/`；fix commit 删除了 `reports/game-1.jsonl` 与 `reports/summary.json`。 | **已闭合** |
| **C-195** 文档漂移 | 「文档同步」 | `README.md:11,18,36-37` 仍写 720 用例 / 八个 RFC / 剩余 014-016；`TEST-STRATEGY.md:32-33` 仍写 88 files / 720 tests，`:38` 仍称其余 15 个 RFC 为 `proposed`，`:133` 仍引用已删除的 `tests/meta/selfplay-placeholder.test.ts`，RFC-015 小节（`:379-385`）仍全部 `proposed`。fix commit 没有修改这两个文件。 | **仍 Open（非阻塞）** |
| **C-196** kill 兜底 | 未在消息里单列 | `scripted-player.ts:140-145` 在无合法目标时仍返回 `{ type:'WOLF_KILL', target: seat }`（刀自己）。 | **仍 Open（非阻塞）** |

结论：**「非阻塞项也已处理」只对 C-194 成立**；其余仍是 Round 1 的状态，且 C-191 的「失败局 usage 计入汇总」在代码与实测上都不成立。这不改变阻塞判定，但说明文档/声明与仓库仍有漂移。

### 2.10 逐条 AC

| AC | 判定 | 会红 / 不会红 | 证据与说明 |
|---|---|---|---|
| 1 · 无浏览器跑 3 局、exit 0 | **PASS** | 会红（CLI 子进程） | 实跑 `--games=3 --seed=1` exit 0；CLI 用例用 2 局，meta 用例 1 局。 |
| 2 · 第 N 局 seed + N | **PASS（测试偏弱）** | **不会红**（M-R2-4） | 输出 `GAME_STARTED.seed` 实为 1/2/3；用例只断言派生字段，C-190 仍 Open。 |
| 3 · 输出 summary + 每局事件流 | **PASS** | 会红（文件断言） | CLI 用例断言 `summary.json` 与 `game-3/4.jsonl`；原子写与「输出目录不存在自动建」仍无专门用例（非阻塞）。 |
| 4 · summary 字段齐全 | **PASS** | 会红（report 单测） | `summarize` 单测覆盖 games/succeeded/failed/winDistribution/avgEvents/avgDurationMs/degradedCount/usage/wolfWinRate；失败局 usage 仍不计（C-191）。 |
| 5 · 单局失败不终止整批 | **PASS（边界 FAIL）** | 会红（M-3） | 假 LLM 中途抛错被隔离；`onGame` 写盘失败的完成路径已隔离，但未终局路径会双记（C-187）。 |
| 6 · 非法行动归为「实现缺陷」 | **FAIL（验收测试）** | **不会红**（M-R2-1） | 行为已修（P-R2-1），但成局扫描没有测试；关闭扫描后 14/14 绿。 |
| 7 · 100 局不崩溃、内存不线性增长 | **PASS（行为）/ 测试偏弱** | **不会红（60MB 泄漏）**（M-R2-5） | 100 局 real 1.66s、峰值 82.9MB；30 局用例的 96MB 阈值不能证明非线形（C-197）。 |
| 8 · 占位行为移除 | **PASS** | 会红（M-1） | `pnpm selfplay` 正常跑完；meta 用例 `tests/meta/selfplay-entry.test.ts` 用 `pnpm()` helper。 |
| 9 · seq 连续且 replay | **PASS** | 会红（M-R2-3） | C-185 用例已调用 `replay`，并断言末条 `GAME_ENDED`；截断事件流会红。 |

### 2.11 维度结论

#### 2.11.1 RFC ADHERENCE — **NEEDS WORK**

- AC-1 / 3 / 4 / 8 / 9 的行为与主要断言成立；AC-2 输出可核对但测试偏弱（C-190）。
- AC-5 主路径成立，C-187 的未终局写盘路径仍双记（阻塞）。
- AC-6 行为成立，但验收测试没有覆盖 runner 归类（阻塞，C-184）。
- AC-7 行为成立，30 局用例存在但强度不足（C-197）。
- §8.2 / §8.4 / §8.5 没有按 Round 1 的要求更新；§8.7 新增的「失败局 usage 计入汇总」「CLI 跨平台」与代码不符（C-193 / C-195）。

#### 2.11.2 RULES COMPLIANCE — **NEEDS WORK**

| 规则 | 判定 | 证据 |
|---|---|---|
| **DATA-5** | **PASS** | `scripted-player.ts:16-29` 的 `mulberry32` 由 seed 派生；`runner.ts:56-57` 每局一个；M-R2-2 证明退回 `Math.random` 会红。 |
| **TEST-1** | **FAIL** | AC-6 的 runner 归类无测试（M-R2-1 绿）；AC-7 的 30 局阈值不能证明非线性（M-R2-5 绿）。 |
| **DOC-1** | **NEEDS WORK** | C-193 / C-195；§8.4 的 AC-6 / AC-7 / AC-9 证据仍与实测不一致；README / TEST-STRATEGY 未同步。 |
| **OPS-3** | **PASS** | `pnpm selfplay --games=3 --seed=1` 无浏览器、无 Vite、无 DOM，exit 0；100 局 1.66s。 |
| **ARCH-1** | **PASS** | `src/engine/` 未新增依赖；selfplay 在 `src/server/` 复用 `runGame`。 |
| **DATA-1 / DATA-3** | **PASS** | 每局 `seq` 从 1 连续；C-185 用例 replay 到 `FINISHED`（M-R2-3 会红）。 |
| **跨平台（AGENTS.md）** | **FAIL** | `tests/server/selfplay.test.ts:202-206` 仍写死 `execFile('pnpm', ...)`（C-189）。 |
| **STYLE** | **PASS（有重复）** | 未见 `any`；`mulberry32` 与 `src/engine/rng.ts:nextRandom` 重复实现（非阻塞，见 C-201）。 |

#### 2.11.3 SECURITY — **PASS**

- selfplay 只在本地写文件，不启动 Fastify / Vite，不发网络请求；`HOWL_FAKE_AI=1` 路径零 API 费用。
- `summary.json` 不含 key；错误消息经既有 `client.ts` 脱敏；`reports/` 已从索引移除并被 `.gitignore` 忽略（C-194）。
- 事件流 JSONL 含 `visibleTo: 'server'` 的 `GAME_STARTED` 全身份，这是 RFC-014 离线复盘所需，且只在开发者本地；不是 SEC-5 的客户端投影泄漏。
- 没有新增注入 / XSS 面。

#### 2.11.4 PERFORMANCE — **PASS（测试强度见 C-197）**

- 100 局 real 1.66s；`/usr/bin/time -l` 的 peak memory footprint 82.9MB；10 局与 100 局量级相同，未观察到随局数线性增长。
- 串行执行符合 RFC §6；每局新建 `InMemoryMetaStore` 后不保留引用，旧局可被 GC。
- 仍有一个理论上的线性增长点：`src/server/llm/usage.ts` 的模块级 `Map` 按 gameId 永久累计；100 局只有 100 条，量级可忽略，C-197 的改进测试可顺带覆盖。

#### 2.11.5 MAINTAINABILITY — **NEEDS WORK**

- `runner.ts` / `report.ts` / `scripted-player.ts` 职责分开，注释解释了「为什么」，整体可读。
- `report()` 的收口不完整：三个 `onGame` 调用点里有一个绕过它（C-187）；`report()` 还会把原始 failure 覆盖成 `kind:'model'` / `REPORT_FAILED`，丢掉 `errorType` 与原来的分类（C-198）。
- 新增的 `playerInput` 是生产接口但只用于测试、且没有测试使用；`beforeGame` 仍在 `SelfplayOptions`；`runner.ts:36` 的 JSDoc 还写「默认 `Math.random`」，与 `mulberry32(seed)` 不符。
- 测试质量是主要问题：C-185 可以在 `streams` 为空时空真通过；C-188 可以在 `runSelfplay` 返回空数组时空真通过；C-186 对 2MB/局的泄漏无感（C-199）。这些都是「断言了同一段簿记」而不是行为。
- `mulberry32` 在 `scripted-player.ts` 与 `src/engine/rng.ts` 各有一份；C-188 的测试只锁「同 seed 两次一致」，不锁具体序列，未来两份实现漂移不会被发现。

### 2.12 发现汇总

#### 阻塞（必须修复后才能合并）

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-184（仍阻塞）** | AC-6 / TEST-1 | 成局扫描行为已修（P-R2-1），但官方用例只测 `findPlayerRejection` 夹具与正常局；关闭 `runner.ts:150-167` 后 14/14 仍绿（M-R2-1）。`playerInput` 测试缝无人使用。 | 用 `playerInput` 在 seed 3 注入一票投给死者的 `VOTE`，随后正常投票打完；断言 `outcome.ok === false`、`failure.kind === 'implementation'`、`failure.seed === 3`、事件流含 `GAME_ENDED` 与 `REJECTED`。再留一条「关闭扫描 → 该用例红」的反向锁。 |
| **C-187（仍阻塞）** | AC-5 / AC-4 | `runner.ts:146` 未终局路径直接 `onGame`，写盘失败会先 push 一条 `UNFINISHED`，再由 catch push 一条 `REPORT_FAILED`；P-R2-2 用 2 局得到 4 条 outcome，`summary.games` 失真。 | 把 `runner.ts:146` 改成 `await report(...)`；补 `maxSteps: 1` + `onGame` 恒抛的用例，断言 outcomes 仍为请求局数、每局只有一条 `REPORT_FAILED`。 |
| **C-189（仍阻塞）** | AGENTS.md 跨平台 / TEST-1 | `tests/server/selfplay.test.ts:202-206` 仍 `execFile('pnpm', ...)`；无 `pnpm.cmd` / `shell`；fix commit 未改该块。 | 复用 `tests/meta/helpers/run.ts` 的 `pnpm()`，或在本地加 `process.platform === 'win32'` 分支并传 `shell: true`；Windows 上应能跑完这条 CLI 用例。 |

#### 非阻塞（建议合并前一起修）

| # | AC / 规则 | 发现 | 建议 |
|---|---|---|---|
| **C-190** | AC-2 / TEST-1 | 用例只断言 `outcome.seed` 与文件名；M-R2-4 把实际 `createGame` 的 seed 改成常数后仍绿。 | 在 `onGame` 里断言首条 `GAME_STARTED.payload.seed === seed + index`。 |
| **C-191** | AC-4 | 失败局 usage 不进 summary；P-R2-3 的 100 token 被丢掉。 | 在 `summarize` 里把所有 outcome 的 usage 相加，或分别输出「成局 / 总用量」。 |
| **C-192** | §2.4 / AC-4 | `errorType` 只写在 catch 路径；未终局、玩家被拒、REPORT_FAILED 都没有；summary 无 `failureKinds`。 | 统一构造 failure（`newFailure()`），所有路径带 `errorType`；summary 加 `failureKinds: { model, implementation }`，CLI 打印。 |
| **C-193** | DOC-1 | `game-<seed>.jsonl`、`beforeGame`、`playerInput` 未登记；§8.4 的 AC-6/7/9 证据仍是旧说法；§8.5 与 §8.7 的 test 数 756/762 并存。 | 在 §8.2 补 D-6/D-7/D-8；§8.4 按实测改写；§8.5 更新到 762。 |
| **C-195** | 文档漂移 | README 720 / 八 RFC / 剩余 014-016；TEST-STRATEGY 720 / 15 proposed / 引用已删除 placeholder / RFC-015 全 proposed。 | 合并前同步数字、状态与测试文件名。 |
| **C-196** | AC-6 防御 | `scripted-player.ts:140-145` 无合法目标时仍返回「刀自己」。 | 返回 `undefined`，让编排层停住；补一条空目标用例。 |
| **C-197（新）** | AC-7 / TEST-1 | C-186 的 96MB 阈值对低于 3.2MB/局的线性泄漏无感；M-R2-5 的 60MB 泄漏仍绿；只测一个端点。 | 采样 10 局与 30 局的 heap 增长并断言增长比；或 `--expose-gc` 后按局采样，断言斜率低于阈值。 |
| **C-198（新）** | 可维护性 | `report()` 覆盖原始 failure：写盘失败时把 `implementation` 改成 `model`，并丢掉 `errorType` 与原错误。 | failure 增加 `reportError?: string` 字段，保留原 `kind` / `errorType`；或至少在覆盖时保留原分类。 |
| **C-199（新）** | TEST-1 | C-185 在 `streams` 为空时空真通过；C-188 在 `runSelfplay` 返回空数组时空真通过；C-186 不校验实际跑了几局。 | 加 `expect(streams).toHaveLength(2)`、`expect(first).toHaveLength(6)`、`expect(outcomes).toHaveLength(30)` 一类前置断言。 |
| **C-200（新）** | AC-6 | 越界玩家目标触发 `InvalidEventStreamError`，catch 的文案正则匹配不上，归为 `model`（P-R2-1b）。 | 按 `cause.name` / `errorType` 归类 `InvalidEventStreamError` 为实现缺陷，或从 reject/action 的席位显式归因。 |
| **C-201（新）** | 可维护性 | `mulberry32` 与 `src/engine/rng.ts:nextRandom` 重复；`runner.ts:36` 的 JSDoc 仍写默认 `Math.random`；`playerInput` 无测试使用。 | 复用引擎的 `nextRandom` 包装（保留状态语义）；更新注释；删除或补测 `playerInput`。 |

### 2.13 探针记录

所有探针均使用 `/tmp/howl-rfc015-r2/backup/` 的文件备份恢复；没有使用 `git checkout` / `git restore`。

| 探针 | 变更 / 内容 | 结果 |
|---|---|---|
| **M-R2-1** | `runner.ts` 的 `if (playerRejected !== undefined)` 加 `&& false`（关闭成局扫描） | `tests/server/selfplay.test.ts` **14/14 passed** → AC-6 回归锁仍缺 |
| **M-R2-2** | `runner.ts:57` 的 `mulberry32(seed)` 改成 `Math.random` | C-188 用例 **1 failed**（连续 5 次）→ 确定性测试有牙 |
| **M-R2-3** | 成功路径传给 `onGame` 的 `finished.events` 改成 `slice(0, -1)` | C-185 用例 **1 failed**（`DAY_LYNCH` vs `FINISHED`）→ replay 测试有牙 |
| **M-R2-4** | `createGame` 的 `seed` 改成常数 `options.seed` | AC-2 用例 **1 passed / 13 skipped** → AC-2 仍只校验簿记 |
| **M-R2-5** | 每局开头 `push` 一个 2MB 字符串（30 局 60MB，被模块级数组持有） | C-186 用例 **1 passed** → 96MB 阈值对 2MB/局泄漏无感 |
| **P-R2-1** | `playerInput` 在 seed 3 注入一票投给死者的 `VOTE`，随后正常投票 | 成局；`REJECTED self:1 VOTE TARGET_NOT_ALIVE`；outcome `kind:'implementation'`、`events:45` |
| **P-R2-1b** | `playerInput` 注入 `VOTE target=999` | 引擎抛 `InvalidEventStreamError`；outcome `kind:'model'`（AC-6 边界） |
| **P-R2-2** | `games:2, maxSteps:1, onGame` 恒抛 `磁盘满` | **4 条 outcome**（每局 `UNFINISHED` + `REPORT_FAILED`）→ 未终局路径双记 |
| **P-R2-3** | 失败局 `recordUsage(100/40/10)` 后抛错 | outcome 带 usage；`summarize().usage` 仍为 0 → C-191 仍 Open |
| **P-R2-4** | 同 seed `--games=10` 跑两次，去 `gameId`/`ts` 比较 | 10/10 局事件流逐字节相同；summary 胜负分布与平均事件数一致 |

### 2.14 结论

**Overall Risk Level: High。**

**Summary**：Round 1 的 C-185（replay）、C-188（确定性）与 C-194（生成物）已经真正闭合，C-186 也按用户指定的 30 局口径补了用例；`pnpm selfplay` 仍能无浏览器跑完 100 局（1.66s、峰值约 82.9MB）。但 **C-184 的成局扫描仍然没有回归锁**（关闭后 14/14 绿），**C-187 的未终局路径仍绕过 `report()`**（写盘失败会把一局记成两条），**C-189 的 Windows CLI 用例完全没有改**（仍 `execFile('pnpm')`）。另外，C-190 / C-191 / C-192 / C-193 / C-195 / C-196 的「已处理」声明与仓库不符，C-191 的失败局 usage 在实测中仍为 0。

**Blocking Issues（必须修复后才能合并）**：C-184（AC-6 回归锁）、C-187（未终局 `onGame` 双记）、C-189（Windows CLI 用例）。

**Improvement Suggestions（非阻塞）**：C-190 ~ C-193、C-195 ~ C-201；优先级最高的是 AC-2 补真实 seed 断言、失败局 usage 计入、C-186 改成增长比/斜率断言、`report()` 保留原始 failure 分类，以及同步 README / TEST-STRATEGY / RFC §8.2 / §8.4。

**状态**：`RFCS.md` 中 RFC-015 的 Status 置为 **`Changes requested`**；Round 1 的 C-185 / C-186 / C-188 / C-194 标记为 Closed，C-184 / C-187 / C-189 保持 Open（阻塞），C-190 ~ C-193、C-195 ~ C-196 保持 Open（非阻塞），新增 C-197 ~ C-201 为非阻塞。本轮探针从 `/tmp/howl-rfc015-r2/backup/` 文件备份恢复，三个文件 SHA-256 一致；临时探针已删除；没有 `git commit`；除本评审记录与 `RFCS.md` 外，工作树 clean。
