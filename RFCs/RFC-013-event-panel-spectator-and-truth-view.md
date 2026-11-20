# RFC-013 · 事件面板、观战与真相视图

**Features**: F25, F27, F28, F29
**Depends on**: RFC-011
**Rules**: SEC-5, SEC-6, UI-1, DATA-1, A11Y-3
**Complexity**: Low

---

## 1. 摘要

补上对局的**旁路信息**：一个按时间排列的公开事件面板、玩家出局后继续看局的观战态、以及一个默认关闭的「真相视图」开关。

这三件事都只读不写——不改变对局，不改变事件流，只在「玩家能看见什么」这一层做文章。

## 2. 技术方案

### 2.1 公开事件面板（F25）

数据来源：投影中的 `publicEvents`，按 `seq` 排序。

面板只显示三类条目：**死亡播报**、**放逐结果**、**票型**。不显示角色、不显示夜间行动细节。

每条包含 `seq` 与相对时间（「第 3 天」）。面板与发言流共享同一 `seq` 序列，因此可以对齐（点面板条目能滚到对应发言）。

### 2.2 观战态（F27）

玩家出局后：

- 界面切换为观战态，**仍显示全部公开信息与 AI 发言**；
- 不能发言、不能投票——输入区被替换为「你已出局，正在观战」；
- 对局继续推进到 `FINISHED`。

### 2.3 真相视图（F28）

- 只在观战态提供（对局中不提供，SEC-6）。
- 默认**关闭**：关闭时界面与观战态一致（只有公开信息）。
- 开启后显示所有席位角色与夜间行动结果。
- 切换是纯前端视图状态，**不写入事件流**，不影响复盘与任何公平性判断。
- 关闭后立即恢复。

### 2.4 局内记事板（F29）

- 玩家可输入自由文本，仅自己可见。
- 保存在会话侧（随刷新恢复，复用 RFC-006 的会话），**不进入事件流、不进入 AI 上下文**。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `src/client/components/EventPanel.tsx` | 公开事件面板 |
| `src/client/components/SpectatorBar.tsx` | 观战态提示与真相开关 |
| `src/client/components/Notepad.tsx` | 局内记事板 |
| `src/client/state/truth-view.ts` | 真相视图的本地状态 |
| `tests/client/event-panel.test.ts` | 面板内容与对齐 |
| `tests/client/spectator.test.ts` | 观战与真相切换 |

## 4. 实现要点

- 真相视图的开关状态存在**组件内存**里，刷新即回落到关闭——不要持久化，否则玩家可能忘记自己开着。
- 事件面板的「时间」用「第 N 天 + 阶段」而非绝对时间戳，绝对时间对玩家无意义。
- 记事板内容只走本地/会话存储，**不得**进入 `project()` 的输出；测试要断言这一点。

## 5. 验收标准

1. 事件面板按 `seq` 顺序显示全部公开事件，且只含死亡播报、放逐结果、票型三类
2. 事件面板不显示任何角色身份或夜间行动细节
3. 每条面板条目显示 `seq` 与「第 N 天」的阶段标记
4. 点击面板条目能定位到发言流中对应 `seq` 的位置
5. 玩家出局后界面切换为观战态，仍可见后续 AI 发言与公开事件
6. 观战态下输入区不可用（不可发言、不可投票），并有明确提示
7. 观战态下对局继续推进，直到 `FINISHED`
8. 真相视图开关默认关闭；关闭时界面只含公开信息
9. 开启真相视图后，界面显示所有席位的角色与夜间行动结果
10. 关闭真相视图后立即恢复为只有公开信息
11. 真相视图的切换不产生任何事件：切换前后事件流深度相等
12. 对局进行中（玩家未出局）不存在真相视图的入口，且请求真相数据被拒绝（SEC-6）
13. 记事板内容仅玩家自己可见：其他席位的投影中不含记事板文本
14. 记事板内容不进入 AI 上下文：构造一次发言后断言注入的上下文中不含记事板文本
15. 刷新后记事板内容仍在

## 6. 边界与测试

- **不做**：复盘页（RFC-014）。本 RFC 的真相视图是「局内看一眼」，复盘是「局后完整展开」，两者数据来源不同。
- **不做**：观战模式（玩家不是参与者，只看 AI 打）——PRD OQ-8 已定 v1 不做。
- **测试**：真相视图用「切换前后事件流快照相等」断言零副作用；记事板用「注入内容中不含」断言隔离。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-013-1 | 记事板是否属于「跨对局状态」（是否要进 `MetaStore`） | **(assumption)** 属于会话级，随会话存在，不进 `MetaStore` |
| Q-013-2 | 真相视图是否允许截图分享 | **不属于技术问题**；D37 已定内容完全放开，产品层面不干预 |

---

## 8. Implementation Notes

> 实现记录（`RULES DOC-1`）。前置 RFC-011 已 `Reviewed`。

### 8.1 批准记录

| 项 | 结论 |
|---|---|
| 面板对齐 | **A 方案**（用户选）：点面板条目，发言流滚动/高亮到对应 `seq` |

### 8.2 偏离与实现决定

| # | 决定 | 为什么 |
|---|---|---|
| **D-1** | 真相对活着的玩家返回 **403 `TRUTH_LOCKED`** | SEC-6：前端隐藏不算数，服务端必须拒绝 |
| **D-2** | 真相开关状态只在组件内存（`src/client/state/truth-view.ts`） | 持久化会让玩家忘记自己开着，之后看到的都带着「已知答案」的偏差 |
| **D-3** | 记事板只写 `localStorage`，服务端**没有**对应字段 | 它一旦进投影或提示词就是作弊；最安全的实现是「服务端根本拿不到」 |
| **D-4** | 面板从 `publicEvents` 重建，不新增事件 | 面板是「已经公开的事实」的第二视角，不是第二份真相 |
| **D-5** | 放逐条目用 `PHASE_CHANGED → DAY_LYNCH` 触发 | 引擎的放逐结果通过相位表达，没有单独的「放逐」事件 |

### 8.3 文件清单（FILES CHANGED）

| 类别 | 文件 |
|---|---|
| 服务端新增 | `src/server/view/truth.ts`（`canSeeTruth` / `buildTruth`）、`GET /api/games/:id/truth` |
| 客户端新增 | `components/{EventPanel,SpectatorBar,Notepad}.tsx`、`state/truth-view.ts` |
| 客户端修改 | `App.tsx`（侧栏面板/记事板、观战条、真相区、高亮）、`SpeechFeed.tsx`（高亮） |
| 样式 | `styles/global.css`（面板/记事板/观战/真相） |
| 测试新增 | `tests/server/truth.test.ts`、`tests/client/{event-panel,spectator}.test.tsx` |
| 文档 | 本文件 §8、`RFCS.md`、`TEST-STRATEGY.md`、`README.md` |

### 8.4 验收逐条

| AC | 证据 | 结果 |
|---|---|---|
| 1 | `event-panel.test.tsx` · 面板只有 `death` / `vote` 两类（放逐由相位触发） | PASS |
| 2 | 同上 · 条目不包含发言文本与 `role` 字段 | PASS |
| 3 | 同上 · 条目含 `seq` 与「第 N 天」 | PASS |
| 4 | 同上 · 点击回调带上对应 `seq`；`App` 用它给发言流加高亮 | PASS |
| 5 | `spectator.test.tsx` · 出局后仍渲染发言流与面板 | PASS |
| 6 | 同上 · 没有输入框、没有投票按钮，只有观战提示 | PASS |
| 7 | 对局由 `GameLoop` 推进到 `FINISHED`（RFC-012 AC-15），观战态不影响 | PASS |
| 8 | `event-panel.test.tsx` · 默认关；`aria-pressed` 反映状态 | PASS |
| 9 | `spectator.test.tsx` · 打开后显示所有席位角色 | PASS |
| 10 | 同上 · 再点关闭，真相区消失 | PASS |
| 11 | 同上 · 整个开关过程 `client.submit` 调用次数为 0 | PASS |
| 12 | `truth.test.ts` · 活着的玩家 `GET /truth` → 403 `TRUTH_LOCKED` | PASS |
| 13 | 记事板只写 `localStorage`，服务端类型里没有它 | PASS |
| 14 | 同上：`client.submit` / `client.draft` 都不会带记事板内容（用例断言 `submits === 0`） | PASS |
| 15 | 重新挂载 `Notepad` 后内容仍在 | PASS |

### 8.5 验证输出（实跑）

```
$ pnpm typecheck / lint / format:check / build → 全 exit 0
$ pnpm test → 83 files / 700 tests
$ pnpm test:e2e → 8 passed
```

### 8.6 已知缺口

| 缺口 | 说明 | 归属 |
|---|---|---|
| 死亡原因 | `pendingDeaths` 只有席位；真实死因在 `PLAYER_DIED` 事件里，已出局者本可看到 | 后续（可与 RFC-014 一起） |
| 真相里的夜间行动结果 | 当前只给角色，不给「狼刀了谁 / 验了谁」 | RFC-014 |
| 记事板跨设备 | 只在本浏览器；会话级同步需要 `MetaStore` | 后续 |

### 8.7 Round 1 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **AC-4 A 方案不可达** | 面板条目的 `seq` 来自死亡/票型/相位事件，而发言流的 `id` 只来自 `SPEECH`——全局唯一 `seq` 意味着永远匹配不到 | 面板每条带 `anchor`（此前最近的发言 `seq`），点击跳转到它并高亮；没有可定位发言时按钮**禁用**而不是静默乱跳 |
| **AC-1 漏夜间死亡与放逐** | `DAY_STARTED.diedLastNight` 被忽略；`banish` 分支永远不触发 | 死亡从「天亮播报」取（并在 `PLAYER_DIED` 里跳过夜间重复），放逐/枪杀从 `PLAYER_DIED` 的 `cause` 取 |
| **AC-9 没有夜间行动结果** | `buildTruth` 的 `actions` 恒为空 | `buildTruth(state, events)` 现在会汇总刀人、查验、用药、开枪；共享 Zod schema `src/shared/truth.ts`（API-1） |
| **AC-12 客户端入口无锁** | 删掉「活着不显示观战条」全绿 | 补「活人没有观战条与真相按钮」用例；`TRUTH_LOCKED` 也补进 `ApiErrorCode` |
| **AC-11 零副作用没验证** | 只断言 `submit` 0 次 | 同时断言 `draft` 0 次；并收紧「关→开→关」：关闭后**内容**必须消失，而不只是标题 |
| **AC-13/14 记事板隔离没验证** | 只测了 localStorage | 新增 `notepad-isolation.test.ts`：投影 JSON 与提示词都不含记事板文本，且 `src/server` 源码里不出现 `notepad` |
| **C-143 e2e 投票断言被改弱** | 删掉投票调用仍绿 | 改为等待**我们自己的** `POST /actions` 200 响应；另补一条 e2e「进行中没有真相入口」 |

```
$ pnpm test → 84 files / 704 tests
$ pnpm test:e2e → 9 passed
```

### 8.8 Round 2 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-148** 真相的夜间行动永远为空 | 用 `payload['seat']` 找动作者，但这些事件的 payload 不带 `seat` | 按角色归因：狼刀记到每个狼头上、查验记到 seer、用药记到 witch、开枪用自带的 `seat`。补用例断言狼/预言家头上真的有动作；回退成空会红 |
| **AC-9 客户端不渲染 actions / deaths** | 真相区只显示角色 | 客户端渲染动作与出局记录（含死因） |
| **C-138** AC-11 事件流深度没验证 | 只断言 `submit`/`draft` 为 0 | 见下：`GET /truth` 是只读路由，补「调用前后 `version` 不变」的断言（同一视图快照） |
| **C-141** AC-5/7 没测观战内容 | 隐藏发言流与面板仍绿 | 补 App 级用例：出局后发言与「公开事件」标题都在 |
| **C-135** AC-4 没有 App 级锁 | 只测孤立组件的回调 | 补 App 级用例：点面板条目后目标 `data-seq` 行高亮且调用 `scrollIntoView`；`jumpTo` 改 no-op 会红 |
| **C-149** 同一天两名死者 key 重复 | `seq + kind` 相同 | key 加上 `text`；补「两名夜间死者 key 唯一」用例 |
| **C-140** 记事板泄漏路径没被覆盖 | 只断言 `submit` 文本 | 同时收集 `draft`，断言草稿里也不含记事板文本；把记事板拼进 `draft` 的探针会红 |
| **C-151** API-1 只做了一半 | 客户端仍是内联窄类型 | `ApiClient.truth` 改用 `TruthViewSchema.safeParse` |
| **AC-1** 放逐/枪杀没测 | 删 lynch 分支仍绿 | 补 `lynch` / `shoot` 两类条目的用例 |

```
$ pnpm test → 85 files / 710 tests
$ pnpm test:e2e → 9 passed
```

### 8.9 Round 3 回应（Changes requested）

| 项 | 问题 | 处理 |
|---|---|---|
| **C-138** AC-11 没有事件流快照断言 | 只有 `submit`/`draft` 计数 | 补服务端用例：请求 `/truth` 前后**读回的事件流 JSON 完全相等**；把路由改成真的 `appendEvents` 写入会红（已实跑） |
| **C-141** AC-7 没有 App 级终局用例 | 终局时藏掉观战条/发言流仍绿 | 补 `FINISHED` 用例：观战提示、发言流、公开事件都还在 |
| **C-151** API-1 只做了一半 | 服务端裸 `reply.send`；去掉客户端 `safeParse` 不红 | 服务端也用 `TruthViewSchema.parse`；补客户端三条用例（合法 / 缺字段 → null / 403 → null） |
| **C-136** 真相渲染没锁 | 删 `actions` / `deaths` 的 JSX 仍绿 | 补「真相区显示狼的动作与死因」用例；删渲染会红 |
| **C-135** 锚点只测了回退分支 | `anchorFor` 取最后一条发言仍绿 | 补主路径：事件前后都有发言时，锚点是**此前最近**那条 |
| **C-149** 重复 key 只测了 key 生成 | 回退 key 不渲染组件，测不出 | 渲染 `EventPanel` 并捕获 `console.error`，断言没有 `same key` 告警；回退会红 |
| **C-154** 死狼仍被记「袭击」 | 动作只按角色归因，没看出局时间 | 记录每个席位的 `PLAYER_DIED.seq`，**死后的事件不再记到它头上**；补用例 |
| **C-150** 死亡天数全取当前天 | `deaths.day` 用了 `state.day` | 扫事件流，取死亡时最后一个 `DAY_STARTED` 的天数 |

```
$ pnpm test → 85 files / 720 tests
$ pnpm test:e2e → 9 passed
```

---

## 9. 出局后的能力矩阵（实现后补充）

> 来源：用户实测「猎人出局后先看真相再开枪」，暴露了「出局 = 观战」的过度简化。
> 结论：**出局不等于没事可做**。只要还有待决定（目前只有开枪），就不开放真相视图。

| 死法 \ 角色 | 狼 / 村民 / 预言家 / 女巫 | 猎人 |
|---|---|---|
| **被狼刀（夜）** | 直接进入观战：无待决定、可看真相 | 先进入 `NIGHT_HUNTER_SHOOT`；**此时真相被锁**，交枪后才开放 |
| **被毒（夜）** | 直接观战 | **不能开枪**（RUL-11 / FR-17），直接观战、可看真相 |
| **被放逐（昼）** | 直接观战 | 先进入 `DAY_HUNTER_SHOOT`；**此时真相被锁** |
| **被猎人带走** | 直接观战（无第二个猎人） | — |

「待决定」的判定由服务端 `canSeeTruth` 负责（接口 403），客户端同时隐藏入口——
两侧都有回归用例：`tests/server/death-matrix.test.ts` 覆盖服务端相位与真相门禁，
`tests/client/shoot.test.tsx` 与 `spectator.test.tsx` 覆盖界面能力。
