# RFC-005 评审 · 狼人自曝与夜间私聊

> **评审会话**：独立 subagent，全新上下文；本会话没有参与本仓库任何代码 / RFC / 测试的写作。
> **日期**：2026-11-18
> **分支 / HEAD**：`main` / `6c830d8`（评审开始时 `git status --porcelain` 无输出）
> **结论**：**Changes requested**
> **整体风险**：**High**

## Round 1 -- 2026-11-18

**结论：Changes requested · Overall Risk Level: High**

三条阻塞：

1. **B1 · 从白天结束时 `enterNight` 仍然跳过 `NIGHT_WOLF_CHAT`**。第二夜起狼队根本没有夜聊阶段，`WOLF_CHAT` 无法提交；`tests/engine/vote.test.ts` / `lynch.test.ts` 还把「跳过」写成断言，改回正确行为会让 5 条测试变红。这直接违反 RFC-005 §2.2 / §4 / AC-5，也与实现自述 §8.2 D-6、§8.5 相反。
2. **B2 · 自曝不取消已投出的票**。在 `DAY_VOTE` 已经有人投票后自曝，`state.votes` 会跨过夜晚进入下一天；若被投者在夜里出局，下一天会重演 `C-24` 同类的合法输入崩溃：`InvalidEventStreamError: PLAYER_DIED 重复`。违反 AC-10「当日投票被取消」。
3. **B3 · RFC-005 正文没有同步用户的可见性裁决**。§2.1 的 `wolves` 行、§2.4、§7 Q-005-1、§5 AC-3 仍写「死狼看不到死后事件」，与 §8.1 / §8.3 的用户裁决和 `src/shared/visibility.ts` 的 `wolves` 实现相反。用户明确要求核对 §2.1 与实现的一致性：**实现是对的，表是错的**。

---

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。评审开始时 HEAD `6c830d8`，工作树 clean。

```
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT:0

$ pnpm lint
> eslint .
EXIT:0

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT:0

$ pnpm build
vite v8.3.8 building client environment for production...
✓ 14 modules transformed.
dist/client/assets/index-DTkfWeVY.js  219.65 kB │ gzip: 68.71 kB
✓ built in 66ms
vite v8.3.8 building ssr environment for production...
✓ 3 modules transformed.
dist/server/index.js  1.25 kB │ gzip: 0.86 kB
✓ built in 9ms
EXIT:0

$ pnpm test
 Test Files  44 passed (44)
      Tests  366 passed (366)
EXIT:0

$ pnpm exec vitest run --project unit --coverage
 Test Files  37 passed (37)
      Tests  332 passed (332)
EXIT:0
-----------------|---------|----------|---------|---------|-------------------
All files        |   96.66 |    93.31 |   97.14 |   96.95 |
-----------------|---------|----------|---------|---------|-------------------
  self-expose.ts |     100 |      100 |      100 |     100 |
  visibility.ts  |     100 |      100 |      100 |     100 |
  wolf-chat.ts   |     100 |      100 |      100 |     100 |
-----------------|---------|----------|---------|---------|-------------------

$ pnpm test:e2e
skipped：tests/e2e/ 下没有用例（Playwright 要求从 RFC-012 起生效）
EXIT:0
```

`pnpm selfplay` 未跑：本 RFC 不涉及 headless 对局，且它仍是 RFC-015 的占位（`OPS-3` / C-5），与本 RFC 的验收无关。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本 RFC 只改引擎与 `src/shared/` 契约，没有 UI、网络、密钥或首屏改动。因此跳过 UI / A11Y / 浏览器兼容 / 首屏性能与 Playwright 的检查；引擎的规则、状态机、可见性与重放检查全部适用。`project()` 的端到端投影是 RFC-007 的范围，本评审只验证 `isVisibleTo` 层。

---

### 1. 逐条 AC：哪个测试会红？

| AC | 测试 | 反向探针 | 判定 |
|---|---|---|---|
| 1 | `tests/engine/visibility.test.ts` AC-1 · 9 个观察者全真 | M3（`public` 改假）→ 1 红 | PASS |
| 2 | 同文件 AC-2 · 9 个观察者按阵营 | M17（狼事件提前到阵营判断前）→ AC-2 / AC-14 红 | PASS |
| 3 | 同文件 AC-3 · 死在事件前的狼仍可见 | M1（删掉 `wolves` 豁免）→ 1 红 | PASS（按 §8.3 裁决） |
| 4 | 同文件 AC-4 · `self:4` 恰好 1/9 可见、死前可见 / 死后不可见 | M2（删 `self` 死亡收窄）/ M16（删「仅本人」）→ 各 1 红 | PASS |
| 5 | `tests/engine/wolf-chat.test.ts` · 发牌后停在夜聊；未全提交前 `WOLF_KILL` → `PHASE_MISMATCH` | M12（`GAME_STARTED` 直接设 `NIGHT_WOLVES`）→ 5 红 | **FAIL（仅第一夜）**；第二夜起 `enterNight` 跳过夜聊（B1） |
| 6 | 同文件 · `WOLF_CHAT_POSTED` 的 `visibleTo === 'wolves'` 与 payload | M11（改 `public`）→ 1 红 | PASS（第一夜） |
| 7 | 同文件 · 全部提交 → `NIGHT_WOLVES`；未全提交前 `WOLF_KILL` 被拒 | M4（删推进）→ 1 红 | PASS（第一夜）；第二夜起没有可提交的夜聊（B1） |
| 8 | 同文件 · 空串也算提交并推进 | M5（空串改拒绝）→ 1 红 | PASS |
| 9 | 同文件 · 白天 `WOLF_CHAT` → `Rejected`，除 `seq` 外不变 | M10（把 `WOLF_CHAT` 加进 `DAY_SPEECH` 允许集）→ 1 红 | PASS |
| 10 | `tests/engine/self-expose.test.ts` · 两个白天阶段自曝 → 公开事件、进 `NIGHT_WOLF_CHAT` | M6（改去 `NIGHT_WOLVES`）→ 2 红 | **FAIL**：相位与公开事件对，但「当日投票被取消」没有实现（B2） |
| 11 | 同文件 · 自曝这一步不产出 `VOTE_CAST` / `VOTE_REVEALED` | 无单独可打红的探针；见下 | **PASS（字面）/ 覆盖不足**：测试只看 step 产出的本步事件，看不到 `state.votes` 残留（B2） |
| 12 | 同文件 · 好人 → `NOT_A_WOLF`；死狼 → `NOT_ALIVE` | M7 / M8 各 1 红 | PASS |
| 13 | 同文件 · 自曝前后存活计数不变 | M9（自曝顺带 `PLAYER_DIED`）→ 1 红 | PASS（存活计数）；`checkWin` 结论未测（非阻塞） |
| 14 | `tests/engine/visibility.test.ts` AC-14 · 9 个观察者过滤后只有狼能看到夜聊 | M17 → 3 红 | PASS |

**结论**：14 条 AC 中的测试大多真的会在行为退化时变红（上表 13 条有实跑探针）。但 AC-5 / AC-10 的边界没有被测试覆盖，而这两处正是 B1、B2 的真实缺陷。

---

### 2. 阻塞项

#### B1 · 第二夜起没有 `NIGHT_WOLF_CHAT`（C-35）

`src/engine/phases/vote.ts:82-88` 仍然这样进入下一夜：

```ts
export function enterNight(from: Phase): EventDraft[] {
  // `NIGHT_WOLF_CHAT` 归 RFC-005。本 RFC 与 START 一样跳过它：先进入该阶段…
  return [
    phaseChangedDraft(from, 'NIGHT_WOLF_CHAT'),
    phaseChangedDraft('NIGHT_WOLF_CHAT', 'NIGHT_WOLVES'),
  ];
}
```

结果是每一条「白天 → 夜晚」的路径（投票结算、平票、全员弃权、放逐、白天猎人开枪）都直接落在 `NIGHT_WOLVES`，`state.wolfChat` 在进入新夜时被清空，狼人没有机会提交 `WOLF_CHAT`。实测（固定种子 `20261117`，第一天全员弃权）：

```
after start NIGHT_WOLF_CHAT 1
after chat NIGHT_WOLVES 1
...
after all abstain NIGHT_WOLVES 2 wolfChat= undefined
alive wolves should chat now: [2,3,8]
```

`tests/engine/vote.test.ts:113-114`、`:199`、`:215` 与 `tests/engine/lynch.test.ts:44,160` 把「跳过」写成了期望值。把 `enterNight` 改成只发一条 `from → NIGHT_WOLF_CHAT` 后，现有套件有 5 条变红：

```
FAIL tests/engine/lynch.test.ts > 放逐好人后进入下一夜，day 递增
  expected 'NIGHT_WOLF_CHAT' to be 'NIGHT_WOLVES'
FAIL tests/engine/lynch.test.ts > 放弃开枪 → 进入下一夜
FAIL tests/engine/vote.test.ts > AC-7 · 唯一最高票者被放逐
FAIL tests/engine/vote.test.ts > AC-8 / RUL-2 · 重投仍并列
FAIL tests/engine/vote.test.ts > AC-9 · 全员弃权
  Tests  5 failed | 14 passed (19)
```

这与 RFC-005 §2.2（「阶段 `NIGHT_WOLF_CHAT`，位于 `NIGHT_WOLVES` 之前」）、§4（自曝后也必须先进它）、AC-5 / AC-7 冲突；也与 `RFCs/RFC-005...:134` 的 D-6「RFC-003 时代的「跳过夜聊」补丁随之删除」以及 `:151` 的「`vote.ts`（`enterNight` 只发一条相位事件）」直接矛盾。`src/engine/phases/night.ts:18` 仍写着「夜聊由 RFC-005 填，本 RFC 跳过」，属于同一处漏改。

**修法**：`enterNight` 只产出 `from → NIGHT_WOLF_CHAT`；更新 `vote.test.ts` / `lynch.test.ts` 的期望（它们应停在夜聊，或先过夜聊再断言 `NIGHT_WOLVES`）；补一条「第二天正常结束后仍必须停在 `NIGHT_WOLF_CHAT`」的回归用例。`full-game.test.ts` 已经能处理夜聊，修好后会自动覆盖后续夜晚。

#### B2 · `DAY_VOTE` 自曝不取消已投出的票（C-36）

`src/engine/apply.ts:118-126` 在进入 `NIGHT_WOLF_CHAT` 时清空 `night` / `pendingDeaths` / `wolfChat`，但没有清空 `votes`（也没有清 `speech` / `runoff` / `lynched`）。正常白天结束会先有 `VOTE_REVEALED` 把票箱清掉，所以平时看不见；但自曝的路径**没有** `VOTE_REVEALED`：

```
DAY_VOTE: 1 号投 4 号
  votes = [{ seat: 1, target: 4 }]
SELF_EXPOSE（狼 2 号）
  phase = NIGHT_WOLF_CHAT, day = 2
  votes = [{ seat: 1, target: 4 }]   ← 仍留着
夜里 4 号被刀
下一天 DAY_VOTE 开始时：votes 仍是 [{ seat: 1, target: 4 }]
全员弃权 → 旧票把已出局的 4 号算成最高票
DAY_LYNCH → PLAYER_DIED(4) → InvalidEventStreamError: 座位 4 已经出局，PLAYER_DIED 重复
```

这是合法 action 序列（`SELF_EXPOSE` 在 `DAY_VOTE` 明确允许，且不要求轮到该狼发言），却把状态机推进到内部不变量错误，和 `C-24` 同类。即使被投者没有死，旧票也会被下一天计入、让当天已投过票的人无法再投，属于静默错算。

`tests/engine/self-expose.test.ts:16-42` 只断言公开事件与相位；`:44-64` 只检查「自曝这一步的事件里没有 `VOTE_CAST` / `VOTE_REVEALED`」，两者都看不到 `state.votes`。反向验证：在 `applyPhaseChanged` 里加 `delete next.votes` 后，`self-expose.test.ts` 仍是 **7 passed**（M14），说明现有测试完全没锁住这条清理；同一修复下上面的崩溃脚本正常走完。

**修法**：进入 `NIGHT_WOLF_CHAT` 时清空 `votes`（同时清 `speech` / `runoff` / `lynched`，把「发言队列清空、投票取消」真正落到状态），补一条「`DAY_VOTE` 已有人投票 → 自曝 → 下一夜 / 下一天不再有旧票」的回归测试，覆盖「被投者在夜里出局」这一崩溃分支。

#### B3 · RFC 正文的可见性表与用户裁决相反（C-37）

用户裁决是「狼队频道不因成员出局中断」，已记录在 `RFCs/RFC-005...:121`（§8.1）和 `:136-140`（§8.3 AC-3 修正）。`src/shared/visibility.ts:42-46` 也正确实现了它：

```ts
if (self.role !== requiredRole) return false;
if (visibility === 'wolves') return true; // 不看死活
return self.diedSeq === undefined || self.diedSeq > event.seq;
```

但 RFC-005 的**正文**仍保留相反的说法：

- `:27` §2.1 表：`wolves` = 「角色为 wolf 的席位，且该席位的死亡事件不早于本事件（死狼看不到死后发生的事，见 §2.4）」
- `:56-60` §2.4「死狼的可见性收窄」：明确写「死亡之后的事件，该席位不可见——包括狼夜聊」
- `:84` §5 AC-3：仍是「事件前已出局的狼返回 true … 事件之前就死亡的狼返回 false」的自相矛盾原文
- `:107` §7 Q-005-1：仍是「(assumption) 不能；见 §2.4」

因此：**裁决在代码里正确实现，§2.1 的可见性表与 `src/shared/visibility.ts` 不一致**。按 `AGENTS.md` 权威顺序，用户裁决高于 RFC 初稿，且 §8 已记录批准；但 §2.1 是 RFC 的规范性表格，下游 RFC-011 / RFC-013 会读它，不能留成两种相反口径。§8.3 只修正了 AC-3 的解释，没有回写 §5 的 AC-3 原文，也没有回写 §2.1 / §2.4 / §7。

**修法**：把 §2.1 的 `wolves` 行改为「角色为 wolf 的席位；成员出局不中断（用户裁决，见 §8.1 / §8.2 D-1）」；把 §2.4 改成记录裁决而不是旧假设；把 §7 Q-005-1 标为已关闭 / 能；把 §5 AC-3 改成 §8.3 的表述（或直接指向 §8.3）。同时把 §3 交付物表中的 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts` 改为实际路径（`src/shared/visibility.ts` 已由 §8.1 说明不新建；`self-expose.ts` 实际在 `src/engine/phases/`）。

---

### 3. 变异探针清单（实跑）

所有探针都先断言目标字符串存在、注入后跑定向测试、再用备份恢复。探针结束后 `git status --porcelain` 为空，随后全量 `pnpm test` 44 files / 366 tests 全绿。

| # | 改动 | 定向结果 | 结论 |
|---|---|---|---|
| M1 | `visibility.ts` 删除 `if (visibility === 'wolves') return true` | `visibility.test.ts` 1 failed | AC-3 会红 |
| M2 | `visibility.ts` 去掉 `self` 死亡比较 | `visibility.test.ts` 1 failed | AC-4 死亡时序会红 |
| M3 | `visibility.ts` 把 `public` 改成恒假 | `visibility.test.ts` 1 failed | AC-1 会红 |
| M4 | `wolf-chat.ts` 删掉推进到 `NIGHT_WOLVES` | `wolf-chat.test.ts` 1 failed | AC-7 会红 |
| M5 | `wolf-chat.ts` 拒绝空串 | `wolf-chat.test.ts` 1 failed | AC-8 会红 |
| M6 | `self-expose.ts` 改成进入 `NIGHT_WOLVES` | `self-expose.test.ts` 2 failed | AC-10 相位会红 |
| M7 | `self-expose.ts` 删除 `NOT_A_WOLF` 校验 | `self-expose.test.ts` 1 failed | AC-12 会红 |
| M8 | `self-expose.ts` 删除 `NOT_ALIVE` 校验 | `self-expose.test.ts` 1 failed | AC-12 会红 |
| M9 | `self-expose.ts` 额外产出 `PLAYER_DIED` | `self-expose.test.ts` 1 failed | AC-13 会红 |
| M10 | `transitions.ts` 允许 `DAY_SPEECH` 提交 `WOLF_CHAT` | `wolf-chat.test.ts` 1 failed | AC-9 会红 |
| M11 | `wolf-chat.ts` 把 `visibleTo` 改成 `public` | `wolf-chat.test.ts` 1 failed | AC-6 会红 |
| M12 | `apply.ts` 的 `GAME_STARTED` 直接设 `NIGHT_WOLVES` | `wolf-chat.test.ts` 5 failed | AC-5 开局路径会红 |
| M13 | **把 `enterNight` 改成只发一条相位事件（期望行为）** | `vote.test.ts` + `lynch.test.ts` 5 failed | 现有测试把 B1 的缺陷当成期望 |
| M14 | `apply.ts` 进入夜聊时加 `delete next.votes` | `self-expose.test.ts` 7 passed；崩溃脚本修复 | B2 没有任何测试保护 |
| M16 | `visibility.ts` 让所有 `self` 事件对全员可见 | `visibility.test.ts` 1 failed | AC-4 身份限定会红 |
| M17 | `visibility.ts` 把 `wolves` 返回提前到阵营判断之前 | `visibility.test.ts` 3 failed | AC-2 / AC-3 / AC-14 会红 |
| M18 | `wolf-chat.ts` 去掉 500 字截断 | 全 unit 332 passed | §4 的截断没有测试（非阻塞） |

---

### 4. Review Dimensions

#### 1. RFC ADHERENCE — **NEEDS WORK**

- **B1**：第二夜起缺少 `NIGHT_WOLF_CHAT`，违反 §2.2 / §4 / AC-5，且 §8.5 的文件清单自述不实（见 C-35）。
- **B2**：`SELF_EXPOSE` 在 `DAY_VOTE` 不取消已投票，违反 AC-10「当日投票被取消」（见 C-36）。
- **B3**：RFC 正文 §2.1 / §2.4 / §5 AC-3 / §7 Q-005-1 仍是旧假设，和用户裁决、§8.1 / §8.3、`src/shared/visibility.ts` 相反（见 C-37）。
- 已核对：AC-3 的用户裁决在代码中**正确**（`wolves` 不看死活，`seer` / `witch` / `hunter` / `self` 仍按死亡收窄）；M1 证明测试会为它变红。§2.1 的 `self:<n>` 行与实现一致，`wolves` 行不一致。
- 偏离记录：不新建 `src/engine/visibility.ts` 已在 §8.1 记录（用户同意）；`self-expose.ts` 落在 `phases/` 而非 §3 的 `actions/`，只在 §8.5 的文件表里出现，没有说明理由（非阻塞，C-38）。

#### 2. RULES COMPLIANCE — **NEEDS WORK**

- `ARCH-1`：`src/engine/` 没有 UI / 网络 / DOM import；现有 import-scan 测试通过。
- `ARCH-3` / `ARCH-4`：`GameState` 仍是纯数据；`step` 不读时钟、不写外部状态；`wolfChat` 由 `applyEvent` 折叠。
- `ARCH-11`：`isVisibleTo` 的未知 `visibleTo` 会抛错；但 B2 的旧票导致 `PLAYER_DIED 重复`，是合法输入撞内部不变量，与 `ARCH-11`「不得让合法输入走进未定义分支」的精神冲突（更接近 RFC-002 的错误处理约束）。
- `DATA-2` / `DATA-3`：两个新事件已进 `GAME_EVENT_TYPES` / `GameEventMap`，payload schema 已登记；`replay-parity` 通过。
- `DOC-1`：B1 / B3 是记录不实或未回写；`SELF_EXPOSE` 的路径偏差未说明。
- `TEST-1`：14 条 AC 都有测试，但 AC-5 的「第二夜起」、AC-10 的「投票取消」没有有效用例；按 TEST-1 仍算覆盖不完整。
- `TEST-2`：覆盖率 96.95 / 93.31，达标；三个新文件 100%。
- `STYLE`：无 `any`、无未注释的非空断言；文件长度、具名导出、kebab-case 均符合。

#### 3. SECURITY — **PASS（本 RFC 范围）**

本 RFC 不接触密钥、网络或 DOM；没有新增日志 / 错误响应暴露面。可见性判定是安全边界：M17 证明好人观察者看不到 `wolves` 事件，M1 证明死狼仍可见（用户裁决）。`project()` 还没实现，端到端「好人 AI 上下文不含夜聊」仍由 RFC-007 AC-9 验收（RFC-005 §8.8 已记录，不是本轮缺陷）。`SELF_EXPOSE` 公开是规则要求。`WOLF_CHAT` 文本在引擎侧截断到 500 字，但没有测试（M18，非阻塞）。

#### 4. PERFORMANCE — **PASS / N/A**

本 RFC 只有 9 席的线性扫描（`pendingChatters` / `wolfChat` 过滤）和每次一条事件追加；无 N+1、无无界循环。夜聊有界退出（每只存活狼一条）正是为了避免编排层等待。没有可测量的性能风险。

#### 5. MAINTAINABILITY — **NEEDS WORK**

- `vote.ts:83` 的注释仍说「本 RFC 与 START 一样跳过它」，与 RFC-005 和代码意图相反；`night.ts:18` 仍写「夜聊由 RFC-005 填，本 RFC 跳过」。
- `tests/engine/reject.test.ts:37` 的用例标题仍写「开局后（NIGHT_WOLF_CHAT）所有 action 都被拒」，但现在 `WOLF_CHAT` 是允许的；`tests/engine/transitions.test.ts:53` 的注释仍把夜聊列为「无 action 的阶段」。
- `tests/fixtures/night.ts:8,14-16` 从同一个 `./states` 重复 import；`passWolfChat` 在 `day.test.ts` / `witch.test.ts` / `replay-parity.test.ts` 各复制一份，建议收进 fixture。
- `selfExposeDraft` 只在本文件使用却导出；不影响行为，可收窄。
- 测试覆盖的「自我描述」偏乐观：§8.6 全部 PASS，但 AC-5 / AC-10 的实际边界没有测到；§8.5 声称改了 `vote.ts`，实际没有。

---

### 5. 非阻塞项与建议

1. **N1 · 500 字截断无测试**（M18：去掉截断后 unit 332 全绿）。RFC-005 §4 要求「写入事件前截断到 500 字」；补一条 501 字文本断言 payload 长度 500。非阻塞，但属于 RFC 明写的行为。
2. **N2 · AC-13 的 `checkWin` 断言被从测试计划里删掉**：`TEST-STRATEGY.md:229` 原计划「存活计数不变、`checkWin` 结论不变」，实现只断言了存活计数；改动没有记入 RFC 的 Implementation Notes。建议补一个 `checkWin` 前后相等断言，或明确记录为何不需要。
3. **N3 · 文档残留**：`TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.32`（RFCS 变更历史已到 v2.33，本轮会到 v2.34）；`README.md` 的「RFC-005 Implemented，等待评审」在评审后应更新；`RFCs/RFC-005...:67-69` 的交付物路径与 §8.5 的实际路径不一致。建议下一次 docs 提交一起同步。
4. **N4 · `SELF_EXPOSE` 的「发言队列清空」没有落到状态**：`state.speech` 在自曝后仍存在，只是下一次 `DAY_STARTED` 会重置；当前没有可观察的读取路径，但 §2.3 明写「发言队列清空」。建议和 B2 的 `votes` 清理一起做。
5. **N5 · `WOLF_CHAT` 的死亡 / 非狼拒绝码**：死狼提交 `WOLF_CHAT` 得到 `NOT_YOUR_TURN`，不是 `NOT_ALIVE`；RFC 没有规定，故不作为缺陷，但若下游 UI 要区分「死人不能操作」与「不是你的回合」，可考虑统一。
6. **N6 · `self-expose.ts` 的位置**：RFC §3 写 `src/engine/actions/self-expose.ts`，实现放在 `src/engine/phases/`；当前目录结构里没有 `actions/`，放在 `phases/` 与其它 handler 一致，建议在 §8 记录为有意偏差，而不是只列文件。

---

### 6. 最终判断

- **Overall Risk Level: High**
- **Summary**：可见性裁决本身实现正确，`isVisibleTo` 的 `wolves` 例外与 `self` 死亡收窄都有会变红的测试；但夜聊只在第一夜存在、`DAY_VOTE` 自曝会留下跨天旧票（可导致合法输入崩溃），且 RFC 正文没有回写用户裁决。核心功能的「每夜夜聊」和「自曝取消投票」两条都没有真正完成。
- **Blocking Issues**：B1（C-35）、B2（C-36）、B3（C-37）。
- **状态**：`RFCS.md` → `Changes requested`。

### 7. 探针后的工作树

```
$ git status --porcelain
（空）

$ pnpm test
 Test Files  44 passed (44)
      Tests  366 passed (366)
EXIT:0
```

---

## Round 2 -- 2026-11-18

> **窄范围复核（用户指定）**：只复核 Round 1 修复的四项——**B1 / C-35** 第二夜起有 `NIGHT_WOLF_CHAT`、**B2 / C-36** 进入 `NIGHT_WOLF_CHAT` 时清空 `votes` / `runoff` / `lynched`、**B3 / C-37** §2.1 / §2.4 / Q-005-1 / AC-3 四处正文回写裁决、**C-38 ③** 500 字截断用例。Round 1 已关闭的 AC-1 ~ AC-4、AC-6 ~ AC-9、AC-12 ~ AC-14 与安全 / 性能维度**未重查**；本轮的 PASS 不重新认证它们。
> **HEAD**：`1cde90e`（Round 1 修复提交），分支 `main`。评审开始 / 结束时 `git status --porcelain` 均为空；四条变异探针与两个临时端到端探针的改动均已恢复，临时测试文件已删除。
> **结论**：**Reviewed**。四项全部成立，无新阻塞项；非阻塞残留登记为本轮 **C-39**。

### 0. STEP 0 · 门禁实跑

环境：macOS / Node `v22.22.2` / pnpm `10.33.0`。

```
$ pnpm typecheck    → EXIT:0
$ pnpm lint         → EXIT:0
$ pnpm format:check → All matched files use Prettier code style!  EXIT:0
$ pnpm build        → dist/client/index.html + dist/server/index.js  EXIT:0
$ pnpm test         → Test Files 44 passed (44) · Tests 369 passed (369)  EXIT:0
$ pnpm test:e2e     → skipped：tests/e2e/ 下没有用例（RFC-012 起生效） EXIT:0

$ pnpm exec vitest run --project unit --coverage
 Test Files  37 passed (37)
      Tests  335 passed (335)
 All files | % Stmts 96.68 | % Branch 93.31 | % Funcs 97.14 | % Lines 96.96
  self-expose.ts 100/100 · wolf-chat.ts 100/100 · visibility.ts 100/100
```

`pnpm selfplay` 未直接运行：它仍是 RFC-015 的占位（`OPS-3` / C-5），与本轮四项无关；`pnpm test` 里的 meta 占位用例已覆盖「退出码 1 + 指向 RFC-015」的既有预期。

**Product Type**：`PRD.md` 的类型是 **game（主）+ web app（交付形态）**。本轮改动只在引擎的状态清理、相位推进、注释与测试，不涉及 UI / HTTP / 密钥 / 首屏，因此跳过 web app 的界面、A11y、浏览器兼容与 Playwright 检查；game 维度只验证 Round 1 的四个阻塞项及其回归锁。

**说明**：Round 1 已把 `pnpm test` 的转录写成 44 files / 366 tests；本轮实跑是 **369**（新增 3 条用例：第二夜 1 条、清票 1 条、截断 1 条）。这不是新发现的行为问题，是 Round 1 修复提交里 §8.9 那段「本轮实跑」转录没有同步；按 DOC-1 的准确性要求登记为 C-39，不影响本轮结论。

---

### 1. 复核点 1（B1 / C-35）：第二夜起确实有夜聊 — PASS

`src/engine/phases/vote.ts:82-86` 现在只产出一条相位事件：

```ts
export function enterNight(from: Phase): EventDraft[] {
  // 只发一条：进入 `NIGHT_WOLF_CHAT` 后由狼队夜聊推进到 `NIGHT_WOLVES`（RFC-005）。
  return [phaseChangedDraft(from, 'NIGHT_WOLF_CHAT')];
}
```

调用方覆盖全部入夜路径：投票结算 / 平票 / 全员弃权（`vote.ts:103,109`）、放逐（`lynch.ts:61`）、白天开枪（`night.ts:334`）。`START` 仍由 `GAME_STARTED` 直接设 `NIGHT_WOLF_CHAT`（`apply.ts:286`）；`grep NIGHT_WOLVES src/` 只剩 `wolf-chat.ts:68` 的「全部提交后推进」，没有第二条跳过路径。

测试：

- `tests/engine/wolf-chat.test.ts:99-116` 新增「放逐之后进入的是 `NIGHT_WOLF_CHAT`」用例：断言相位、`wolfChat` 为空、`pendingChatters > 0`。
- `tests/engine/vote.test.ts:114,199,215`、`tests/engine/lynch.test.ts:44,160` 的 5 条断言从 `NIGHT_WOLVES` 改为 `NIGHT_WOLF_CHAT`。
- `tests/engine/full-game.test.ts:28-36` 的整局脚本原本就会在 `NIGHT_WOLF_CHAT` 提交空串；修复后第二夜起会被真实走到，整局跑到 `FINISHED` 且 `replay` 一致。

**反向探针 M-R2-1（实跑）**：把 `enterNight` 改回两条相位事件 → `vote.test.ts` + `lynch.test.ts` + `wolf-chat.test.ts` **6 failed / 22 passed (28)**，新用例在 `wolf-chat.test.ts:111` 精确变红（收到 `NIGHT_WOLVES`）。恢复后 `git diff` 为空。

**额外端到端探针 P-R2-1（临时测试，已删）**：真实路径 `reachDay → 发言 → 全员投票放逐 → NIGHT_WOLF_CHAT → 全部 wolf 提交 WOLF_CHAT → NIGHT_WOLVES → WOLF_KILL`，2 tests passed，`WOLF_KILL` 不产出 `REJECTED`。这证明第二夜不只「停在夜聊」，还能走完协商进入狼刀。

### 2. 复核点 2（B2 / C-36）：进入夜聊时清空投票状态 — PASS

`src/engine/apply.ts:118-132` 在 `payload.to === 'NIGHT_WOLF_CHAT'` 时清空：

```ts
delete next.votes;
delete next.runoff;
delete next.lynched;
```

`tests/engine/self-expose.test.ts:79-102` 新增「投票阶段先投两票 → 自曝 → 入夜后 `votes` 为空」用例；`tests/engine/wolf-chat.test.ts:112-113` 同时断言第二夜 `wolfChat` 为空。

**反向探针 M-R2-2（实跑）**：只删掉 `delete next.votes` → `self-expose.test.ts` **1 failed / 7 passed**，失败点正是新用例的 `expect(state.votes).toBeUndefined()`（收到两票）。

**反向探针 M-R2-3（实跑）**：删掉 `delete next.runoff` 与 `delete next.lynched` → unit **335 passed**，没有用例变红。这两个字段在合法的 `SELF_EXPOSE` 路径上本来就不会有值：`SELF_EXPOSE` 只允许 `DAY_SPEECH` / `DAY_VOTE`（`transitions.ts:34-35`），`runoff` 只在 `DAY_VOTE_RUNOFF` 有值、`lynched` 只在 `VOTE_REVEALED` 之后有值。因此这是**防御性清理**，不是 Round 1 崩溃路径的一部分；清理本身正确，但没有独立断言。登记为 C-39（非阻塞）。

**额外端到端探针 P-R2-2（临时测试，已删）**：`DAY_VOTE` 先投两票 → wolf 自曝 → 夜间刀掉被投者 → 次日全员弃权。Round 1 记录的旧实现会在这里 `PLAYER_DIED` 重复崩溃；现在正常推进到 `NIGHT_WOLF_CHAT`（day 3），`votes` 为空，无异常。2 tests passed。

**结论**：Round 1 复现的崩溃路径已关闭，根因（旧票跨天）有会变红的用例锁住。

### 3. 复核点 3（B3 / C-37）：四处正文已回写 — PASS

| 位置 | 现在的内容 | 与 `src/shared/visibility.ts` 一致？ |
|---|---|---|
| §2.1 `wolves` 行（`:27`） | 「角色为 `wolf` 的席位，**不看死活**——狼队频道在成员出局后继续（用户裁决，见 §8.1）」 | 一致（`:41-45`：`self.role !== 'wolf'` 拒绝，`wolves` 直接 `true`） |
| §2.4（`:56-62`） | 标题改为「死狼仍然看得到狼队频道」；说明 `wolves` 只校验角色，个人频道仍按死亡时间收窄 | 一致 |
| §5 AC-3（`:86`） | 「只要是 wolf 就返回 `true`，与死亡时间无关」；个人频道「死前可见、死后不可见」 | 一致 |
| §7 Q-005-1（`:109`） | 「**已裁决：能**（用户裁定，与初稿假设相反）」 | 一致 |

`grep '死狼看不到' RFCs/RFC-005...` 现在只命中 §2.4 开头对初稿假设的引述（`:58`）与 §8.9 的 Round 1 历史记录（`:200`），规范性结论没有残留；AC-2（存活狼 true / 存活好人 false）与 §2.1 的 `seer` / `witch` / `hunter` / `self:<n>` 行也未被改坏。

**未关闭的邻近项（非阻塞）**：§3 交付物表（`:67-69`）仍写 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts`，而实际实现是 `src/shared/visibility.ts` / `src/engine/phases/self-expose.ts`。C-37 的修法里列过这一条，Round 1 修复只回写了四处正文，没有改交付物表。归入 C-38 ① / 本轮 C-39。

### 4. 复核点 4（C-38 ③）：500 字截断用例 — PASS

`src/engine/phases/wolf-chat.ts:16,60` 使用 `WOLF_CHAT_LIMIT = 500` 与 `action.text.slice(0, WOLF_CHAT_LIMIT)`。

`tests/engine/wolf-chat.test.ts:118-135`：600 个 `x` 输入 → `WOLF_CHAT_POSTED.payload.text` 长度恰为 500。

**反向探针 M-R2-4（实跑）**：删掉 `.slice(0, WOLF_CHAT_LIMIT)` → `wolf-chat.test.ts` **1 failed / 8 passed**，失败信息 `expected ... to have a length of 500 but got 600`。

可选加强（非阻塞，C-39）：用例只断言长度；若实现改成 `.slice(-500)`（保留末尾）也会通过。当前实现保留的是**前** 500 字，行为正确；用带位置标记的字符串（如 `a…a` 到 500、`b` 到 600）可以把「保留前 500 字」也锁住。

---

### 5. 变异探针汇总（本轮实跑，全部已恢复）

| # | 改动 | 定向结果 | 结论 |
|---|---|---|---|
| M-R2-1 | `vote.ts` 的 `enterNight` 改回两条相位事件 | 3 files / **6 failed / 22 passed** | B1 回归锁有效；新用例精确变红 |
| M-R2-2 | `apply.ts` 删 `delete next.votes` | self-expose **1 failed / 7 passed** | B2 主崩溃路径有回归锁 |
| M-R2-3 | `apply.ts` 删 `delete next.runoff` + `delete next.lynched` | unit **335 passed** | 防御性清理无独立断言（C-39，非阻塞） |
| M-R2-4 | `wolf-chat.ts` 删 500 字截断 | wolf-chat **1 failed / 8 passed** | C-38 ③ 回归锁有效 |
| P-R2-1 | 临时：第二夜夜聊 → `NIGHT_WOLVES` → `WOLF_KILL` | **2 passed** | 第二夜可走完，不只是停在夜聊 |
| P-R2-2 | 临时：自曝 + 被投者夜死 + 次日弃权 | **2 passed** | Round 1 的完整崩溃序列不再崩 |

探针结束后：

```
$ git status --porcelain
（空）
$ pnpm test
 Test Files  44 passed (44)
      Tests  369 passed (369)
EXIT:0
```

---

### 6. Review Dimensions

#### 1. RFC ADHERENCE — **PASS**

Round 1 的三条阻塞与 500 字测试缺口全部关闭：B1 的第二夜夜聊有真实端到端证据，B2 的清票有会变红的根因用例，B3 的四处正文逐字核对与实现一致，C-38 ③ 有反向探针。未发现新增的越界功能或缺失交付。§3 交付物路径与 §8.9 数字是文档残留，不改变验收结论。

#### 2. RULES COMPLIANCE — **PASS**

- `ARCH-1` / `ARCH-3` / `ARCH-4`：本轮 diff 没有新增 import、时钟或外部状态；`wolfChat` / `votes` 仍由 `applyEvent` 折叠。
- `ARCH-11`：合法 action 序列不再撞内部不变量（P-R2-2）；M-R2-1 / M-R2-2 / M-R2-4 按预期变红，M-R2-3 作为防御性清理保持全绿（C-39）。
- `DATA-2`：两个新事件仍走联合类型；`replay-parity` 全绿。
- `TEST-1`：四项复核都有自动化测试；新增 3 条用例。
- `TEST-2`：行 96.96% / 分支 93.31%，达标；三个相关文件 100%。
- `DOC-1`：行为偏离没有新增；但 §8.9 的「本轮实跑」数字未同步（C-39，非阻塞）。

#### 3. SECURITY — **PASS（本轮范围未触及）**

本轮 diff 不涉及密钥、网络、DOM 或服务端响应；`src/shared/visibility.ts` 的判定未被修改，Round 1 的 M1 / M17（死狼可见、好人不可见）结论仍然有效。`WOLF_CHAT` 的截断是防事件流膨胀，不涉及注入或数据暴露。

#### 4. PERFORMANCE — **N/A**

没有新的循环、查询或缓存路径。相反，`enterNight` 从两条相位事件降为一条，`applyPhaseChanged` 只做常数次字段删除；不存在可测量的性能影响。

#### 5. MAINTAINABILITY — **PASS（有非阻塞 nit）**

代码路径清晰，四条修复都有针对性用例；`WOLF_CHAT_LIMIT` 抽成常量。残留的过时注释、§3 路径、§8.9 数字与两处无独立断言的防御性清理登记为 C-39，不影响合并。

---

### 7. 非阻塞残留（登记为 C-39）

1. `RFCs/RFC-005...:206` 的 §8.9「本轮实跑」仍写 `44 files / 366 tests`、`行 96.95% / 分支 93.31%`；实际是 **369 tests / 行 96.96% / 分支 93.31%**。§8.7 `:182` 的 366 是 Round 1 修复前的历史输出，可以保留。
2. 过时注释：`tests/engine/vote.test.ts:113` 仍写「`NIGHT_WOLF_CHAT` 被跳过，与 START 一致」（下一行断言已改为 `NIGHT_WOLF_CHAT`）；`src/engine/phases/night.ts:15` 仍写「夜聊由 RFC-005 填，本 RFC 跳过」；`tests/engine/reject.test.ts:37` 标题仍说「开局后所有 action 都被拒」（现在 `WOLF_CHAT` 允许）；`tests/engine/transitions.test.ts:52` 注释仍把夜聊列为「无 action 的阶段」；`tests/fixtures/night.ts:12,16` 从 `./states` 重复 import。
3. `RFCs/RFC-005...:67-69` 的交付物路径仍是 `src/engine/visibility.ts` / `src/engine/actions/self-expose.ts`（C-38 ①）。
4. `runoff` / `lynched` 的清理无独立断言（M-R2-3 全绿）；行为正确，但若未来有人删掉这两行，测试不会发现。
5. `TEST-STRATEGY.md:3` 仍引用 `RFCS.md v2.32`；C-38 ② 的 `checkWin` 计划在实现提交 `6c830d8` 里被静默删掉，未在 Implementation Notes 记录理由。
6. 500 字用例只断言长度（见 §4 的可选加强）。

以上均不需要在合并前修；建议下一次 docs / 修复提交一并处理。

---

### 8. 最终判断

- **Overall Risk Level: Low**
- **Summary**：Round 1 的三条阻塞与 500 字截断缺口全部关闭。四项复核的主断言都有会变红的回归锁（B2 的 `runoff` / `lynched` 防御性清理没有独立断言，见 C-39）；额外端到端探针确认第二夜夜聊可以走完并接上狼刀、自曝后的完整崩溃序列不再崩溃。没有发现新的阻塞项，只剩注释、文档与一处防御性清理的测试空白。
- **Blocking Issues**：无。
- **状态**：`RFCS.md` → `Reviewed`；C-35 / C-36 / C-37 关闭，C-38 的 ③ 关闭。
