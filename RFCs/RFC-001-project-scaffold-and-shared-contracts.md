# RFC-001 · 工程骨架与共享契约

**Features**: F43
**Depends on**: none
**Rules**: OPS-1, OPS-2, OPS-4, OPS-5, STYLE-1, STYLE-2, STYLE-3, STYLE-5, ARCH-2, API-1, UI-2, DOC-2
**Complexity**: Low
> 关联需求：NFR-2、NFR-11

---

## 1. 摘要

建立可运行的工程骨架，并**把全部跨层类型收进 `src/shared/`**。

本 RFC 不实现任何游戏逻辑，但它是唯一有权定义「对局长什么样」的地方。后续 15 个 RFC 都从这里 import 类型；如果这些类型散落在各处，它们之间的接口就会各说各话——这正是冷读发现的最大问题。

## 2. 技术方案

### 2.1 包结构

单包，四个源码目录 + 一个测试目录：

```
src/
  shared/    纯类型、常量、Zod schema、术语表   ← 类型唯一归属
  engine/    规则引擎（只依赖 shared）
  server/    Fastify、LLM 客户端、会话（依赖 engine + shared）
  client/    React（依赖 shared）
tests/       跨模块测试与 Playwright 用例
```

依赖方向单向：`client → shared`、`server → engine → shared`。`client` 与 `server` 互不引用，`shared` 不引用任何层（ARCH-2）。

### 2.2 编译与模块

- 模块格式 **ESM**（`"type": "module"`），`moduleResolution: "bundler"`，`target: ES2022`。
- 路径别名 `@shared/*`、`@engine/*`、`@server/*`、`@client/*`，映射到 `src/*`；tsconfig 与 Vite 各配一份，必须一致。
- 三份 tsconfig 的边界：根 `tsconfig.json` 覆盖 `src/**` 与 `tests/**`（供 `pnpm typecheck`）；`tsconfig.server.json` 只含 `src/server`、`src/engine`、`src/shared`，`rootDir: src`、`outDir: dist`（因此产物是 `dist/server/index.js`，不是 `dist/server/server/index.js`）；`tsconfig.client.json` 只含 `src/client`、`src/shared`，供编辑器。
- 根配置开启：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`verbatimModuleSyntax`。

### 2.3 共享契约（本 RFC 的核心交付物）

所有跨层类型定义在 `src/shared/`，**只含类型与 `as const` 常量**，不含运行时逻辑。

#### `src/shared/domain.ts`

```ts
export type SeatId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Role = 'wolf' | 'seer' | 'witch' | 'hunter' | 'villager';
export type Faction = 'wolf' | 'good';
export type WinMode = 'slaughter-side' | 'slaughter-all';
export const FACTION_OF: Record<Role, Faction> = {
  wolf: 'wolf', seer: 'good', witch: 'good', hunter: 'good', villager: 'good',
} as const;

export type Phase =
  | 'LOBBY'
  | 'NIGHT_WOLF_CHAT' | 'NIGHT_WOLVES' | 'NIGHT_SEER' | 'NIGHT_WITCH'
  | 'NIGHT_RESOLVE' | 'NIGHT_HUNTER_SHOOT'
  | 'DAY_ANNOUNCE' | 'DAY_SPEECH' | 'DAY_VOTE' | 'DAY_VOTE_RUNOFF'
  | 'DAY_LYNCH' | 'DAY_HUNTER_SHOOT'
  | 'FINISHED';

export interface Seat {
  seat: SeatId;
  role: Role;
  alive: boolean;
  personaId?: string;   // 仅 AI 席位
  isPlayer: boolean;    // 引擎内不得据此改变规则行为；投影必须剥离（AI-8 / F17）
  diedSeq?: number;     // 出局事件的 seq；可见性判定需要（RFC-005）
}

/** 不透明：外部不得解释其内部结构 */
export interface RngState { readonly __rng: number }

export interface GameState {
  gameId: string;
  seed: number;
  mode: WinMode;
  rng: RngState;
  phase: Phase;
  day: number;            // 从 1 开始
  seats: Seat[];          // 恒 9 项，按 seat 升序
  seq: number;            // 已产生事件的最大 seq
  // 注：无 stalemateDays。RUL-10 已移除平局兜底（见 RULES.md §6）
}
```

#### `src/shared/actions.ts`

`Action` 是判别联合，`type` 为判别键。**每个 action 必带 `ts`**（引擎不读时钟，ARCH-4）。

```ts
export type Action =
  | { type: 'START'; ts: number; seed: number; mode: WinMode; playerSeat: SeatId }
  | { type: 'WOLF_CHAT'; ts: number; seat: SeatId; text: string }
  | { type: 'WOLF_KILL'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'SEER_CHECK'; ts: number; seat: SeatId; target: SeatId }
  | { type: 'WITCH_ACT'; ts: number; seat: SeatId; potion: 'heal' | 'poison' | 'none'; target?: SeatId }
  | { type: 'HUNTER_SHOOT'; ts: number; seat: SeatId; target?: SeatId }
  | { type: 'SPEECH'; ts: number; seat: SeatId; text: string }
  | { type: 'SPEECH_SKIP'; ts: number; seat: SeatId }
  | { type: 'VOTE'; ts: number; seat: SeatId; target: SeatId | 'abstain' }
  | { type: 'SELF_EXPOSE'; ts: number; seat: SeatId };
```

约束：`WITCH_ACT` 的 `potion: 'none'` 与 `target?: undefined` 配套；`HUNTER_SHOOT` 省略 `target` 表示放弃开枪；`VOTE.target: 'abstain'` 表示弃权。

#### `src/shared/events.ts`

```ts
export type Visibility =
  | 'public' | 'wolves' | 'seer' | 'witch' | 'hunter'
  | 'server'                 // 服务端专用：任何席位都不可见（如全员身份）
  | `self:${SeatId}`;

export interface EventEnvelope<T extends string = string, P = unknown> {
  gameId: string;
  seq: number;          // 单局内从 1 严格递增
  ts: number;
  type: T;
  visibleTo: Visibility;   // 必填，公开事件写 'public'
  rngAfter?: RngState;     // 产生该事件时若消耗了随机数，必须记录抽取后的生成器状态
  payload: P;
}
```

`seq` 的作用域是**单局**（不是会话），SSE 的 `id` 因此也按局唯一（API-2）。

事件 `type` 必须是下面这个联合的成员（DATA-2），payload 形状由 `GameEventMap` 约束。本 RFC 定义**全集与扩展规则**，各 RFC 只增加成员、不得改写既有成员的 payload：

```ts
export interface GameEventMap {
  GAME_STARTED: GameStartedPayload;      // RFC-002
  REJECTED: { actionType: string; code: string; message: string };  // RFC-002
  WOLF_KILL_CHOSEN: { target: SeatId };  // RFC-003
  SEER_CHECKED: { target: SeatId; result: 'wolf' | 'not-wolf' };
  WITCH_POTION_USED: { potion: 'heal' | 'poison'; target: SeatId };
  PLAYER_DIED: { seat: SeatId; cause: 'wolf' | 'poison' | 'lynch' | 'shoot' };
  HUNTER_SHOOT: { seat: SeatId; target: SeatId | null };
  DAY_STARTED: DayStartedPayload;        // RFC-004
  SPEECH: { seat: SeatId; text: string };
  SPEECH_SKIPPED: { seat: SeatId };
  VOTE_CAST: { seat: SeatId; target: SeatId | 'abstain' };
  VOTE_REVEALED: { votes: { seat: SeatId; target: SeatId | 'abstain' }[] };
  WOLF_CHAT_POSTED: { seat: SeatId; text: string; round: 'night-chat' };
  SELF_EXPOSE: { seat: SeatId };
  AI_THOUGHT: { reason: string; claim?: unknown; decisionSeq: number };
  GAME_ENDED: { result: 'wolf' | 'good'; condition: string };
  DEGRADED: { seat: SeatId };
}
export type GameEventType = keyof GameEventMap;
```

**Zod 归属**：`src/shared/schemas.ts` 为每个 payload 导出对应的 Zod schema，并导出 `EventSchema` / `ActionSchema`（API-1 / NFR-14）。服务端校验入站 action、校验出站事件与响应。

#### `src/shared/effects.ts`

```ts
export type EffectSource = 'role' | 'system' | 'extension';

export interface Effect {
  id: string;                       // 稳定唯一，供测试与日志引用
  source: EffectSource;
  type: string;                     // 受限枚举，由 RFC-003/004 扩充
  target: SeatId | null;            // F7 AC-1：target 必存
  payload: Record<string, unknown>; // 效果参数（如「无效的票」）
  order: number;
}
```

**`order` 的分配约定**（落实 RUL-1 / RUL-8 的结算次序）：

| 区间 | 阶段语义 | 例 |
|---|---|---|
| 0–99 | 抵消与保护 | 女巫解药（必须在击杀之前，RUL-8） |
| 100–199 | 死亡生效 | 狼刀、女巫毒药 |
| 200–299 | 死亡触发技能 | 猎人开枪（RUL-1：先于胜负判定） |
| 900–999 | 扩展（modifier） | 未来遗物；v1 无 |

同一 `order` 内按 `id` 字典序。效果是**结算过程中的中间产物，不写入事件流**；其结果以事件形式记录。

#### `src/shared/visibility.ts`

```ts
export function isVisibleTo(
  event: EventEnvelope,
  observer: SeatId,
  state: GameState,          // 事件发生「之后」的状态快照
): boolean;
```

判定：`public` 恒真；`server` 对**所有**席位恒假（只用于服务端重建状态，如 `GAME_STARTED` 的全员身份）；`wolves` 仅 `Role === 'wolf'` 的席位且 `seat.diedSeq` 未定义或 `> event.seq`；`seer`/`witch`/`hunter` 同理；`self:<n>` 仅席位 n。

**真相视图不走这个函数**：它是复盘/观战时的前端展示开关（RFC-013），数据来自复盘快照（RFC-014），不参与 `project()`，因此不会给 AI 开任何口子。

### 2.4 术语唯一来源

`src/shared/terms.ts` 导出冻结术语表，是 UI 文案的唯一来源（UI-2）。结构：

```ts
export interface Term { label: string; definition: string }
export const TERMS = { knife: {...}, check: {...}, ... } as const;
export type TermKey = keyof typeof TERMS;
export const ROLE_LABELS = { wolf: '狼人', ... } as const;
```

覆盖 PRD 术语表的**全部 13 个条目**（刀、验/查验、票、放逐、悍跳、悍跳事件、狼查杀狼事件、自曝事件、自曝、警长/警徽流、屠边、屠城、垫飞），其中「警长/警徽流」的定义注明 v1 不实现。身份名（狼人/预言家/女巫/猎人/村民）由 `ROLE_LABELS` 单独导出。

### 2.5 入口与端口

- 服务端入口 `src/server/index.ts`（监听端口、注册插件、启动），`src/server/app.ts` 只负责构建 Fastify 实例（便于测试注入）。
- 端口来自环境变量：`PORT`（Fastify，默认 3000）、`VITE_PORT`（Vite，默认 5173）。Vite 把 `/api` 代理到 `http://localhost:${PORT}`。
- 生产由 `@fastify/static` 托管 `dist/client`。

## 3. 交付物

| 文件 | 内容 |
|---|---|
| `package.json` | `packageManager: pnpm@10.33.0`、`engines.node: >=22.13.0`、RULES §3 的命令集合、`"type": "module"` |
| `tsconfig.json` / `tsconfig.server.json` / `tsconfig.client.json` | 三份，边界如 §2.2 |
| `vite.config.ts` | React 插件、别名、`/api` 代理 |
| `eslint.config.js` | flat config |
| `.prettierrc` | 格式化规则 |
| `src/shared/domain.ts` | 领域类型（§2.3） |
| `src/shared/actions.ts` | `Action` 联合 |
| `src/shared/events.ts` | `EventEnvelope`、`Visibility` |
| `src/shared/effects.ts` | `Effect`、`EffectSource` |
| `src/shared/visibility.ts` | `isVisibleTo`（唯一需要运行时逻辑的共享文件） |
| `src/shared/terms.ts` | 术语表与身份名 |
| `src/server/app.ts` | Fastify 实例与 `GET /api/health` |
| `src/server/index.ts` | 启动入口 |
| `src/client/main.tsx` | React 挂载点，占位页 |
| `tests/dependency-direction.test.ts` | 依赖方向断言 |
| `tests/shared/contracts.test.ts` | 共享契约断言 |

## 4. 实现要点

- `src/shared/visibility.ts` 是 shared 里唯一带逻辑的文件——它必须如此，因为客户端与服务端都要用它，且不能各写一份。除此之外 shared 只放类型与常量。
- `pnpm selfplay` 在本 RFC 阶段只打印「未实现（RFC-015）」并以退出码 1 结束。这是对 `OPS-3` 的**临时偏离**，已记入 `RFCS.md` 的 Open conflicts，由 RFC-015 消除。
- `pnpm test:e2e` 在无用例时退出码 0 并打印 skipped；`TEST-6` 的 Playwright 要求从 RFC-012（首个用户可见功能）起生效。
- 依赖方向测试读取各目录的 `import` 语句做断言，不依赖打包器解析。

## 5. 验收标准

1. `pnpm install` 后，`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm start` 五条命令全部以退出码 0 结束（`start` 启动后能响应健康检查再被测试关闭）
2. `package.json` 含 `"packageManager": "pnpm@10.33.0"`、`"engines": { "node": ">=22.13.0" }`、`"type": "module"`
3. 三份 tsconfig 存在，且 `pnpm typecheck` 的模式 `moduleResolution` 为 `bundler`、`target` 为 `ES2022`
4. `tsconfig.json` 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`verbatimModuleSyntax`，且五个选项的任一项被关闭时 `pnpm typecheck` 会报错（用一次反向验证证明）
5. `src/shared/domain.ts` 导出的 `Phase` 联合恰含 §2.3 列出的 **14** 个取值（`LOBBY`、6 个 `NIGHT_*`、`DAY_ANNOUNCE`/`DAY_SPEECH`/`DAY_VOTE`/`DAY_VOTE_RUNOFF`/`DAY_LYNCH`/`DAY_HUNTER_SHOOT`、`FINISHED`）；`WITCH_ACT` 的 `potion` 只允许三个取值
6. `src/shared/effects.ts` 的 `Effect` 中 `target` 为必填（类型层面：去掉该字段会编译失败），且 `order` 的分区常量（0/100/900）以 `as const` 导出
7. `src/shared/events.ts` 的 `EventEnvelope` 中 `visibleTo` 为必填，`seq` 与 `gameId` 均为必填
8. `src/shared/terms.ts` 导出 `TERMS` 与 `ROLE_LABELS`，`TERMS` 的键集合包含 PRD 术语表的 13 个条目对应的键；`TermKey` 能穷举这些键
9. 存在测试：扫描 `src/` 下除 `terms.ts` 之外的 `.ts`/`.tsx`，断言不出现「狼人」「预言家」「女巫」「猎人」「村民」五个身份名字面量
10. 存在测试：断言 `src/shared/` 内不存在指向 `src/engine/`、`src/server/`、`src/client/` 的 import，且 `shared` 除 `zod` 外无运行时依赖
11. 存在测试：`src/client/` 只 import `@shared/*`、`src/server/` 只 import `@engine/*` 与 `@shared/*`、`src/engine/` 只 import `@shared/*`
12. `pnpm dev` 启动后，`GET http://localhost:5173/api/health` 经 Vite 代理返回 200 且响应体含 `{"ok":true}`；`GET http://localhost:3000/api/health` 直连同样返回 200
13. `pnpm build` 产出 `dist/client/index.html` 与 `dist/server/index.js`；`dist/client` 下不存在字符串 `DEEPSEEK_API_KEY`
14. ESLint 把 `@typescript-eslint/no-explicit-any` 与 `@typescript-eslint/no-non-null-assertion` 设为 `error`；`pnpm lint` 通过（`STYLE-4` 的逃生方式为同行 `eslint-disable-next-line` 加理由注释）
15. `pnpm format:check` 与 `pnpm test:e2e`（无用例时打印 skipped）均以退出码 0 结束
16. `pnpm selfplay` 以退出码 1 结束并打印「未实现（RFC-015）」

## 6. 边界与测试

- **不做**：任何游戏逻辑。`GameState` 只有字段定义，`reduce` 在 RFC-002。
- **不做**：`isVisibleTo` 的完整测试矩阵——它只在这里定义，行为验收在 RFC-005。
- **实现者选择**：Prettier 规则细节、`TERMS` 的键名（只要覆盖 13 条）、Vite 插件选项、共享目录是否再分子目录。

## 7. Open Questions

| ID | 问题 | 假设 |
|---|---|---|
| Q-001-1 | 环境变量名 | **(assumption)** `PORT` / `VITE_PORT`，已写入 §2.5 与 AC-12 |
| Q-001-2 | `shared` 是否允许 `visibility.ts` 带逻辑 | **(assumption)** 允许，且仅此一个文件；理由是客户端与服务端必须共用同一判定 |
| Q-001-3 | `RngState` 是否要暴露字段 | **(assumption)** 不暴露，标为不透明，算法在 RFC-002 决定 |
