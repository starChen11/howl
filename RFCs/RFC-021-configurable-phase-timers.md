# RFC-021 · 可配置的阶段倒计时

**Features**: F5, F9
**Depends on**: RFC-012, RFC-018, RFC-019, RFC-020
**Rules**: RUL-14, RUL-15, RUL-17
**Complexity**: Small

---

## 1. 摘要

所有需要等待玩家/AI 的阶段时长由服务端统一配置，默认值翻倍；
服务端实际等待与前端倒计时共用同一份配置。

## 2. 设计

- `src/server/config/phase-timers.ts` 定义 `PhaseTimers` 与默认值；
- `loadPhaseTimers()` 从环境变量读取，非法值启动/取用时抛错；
- `timeoutForPhase()` 是相位 → 毫秒的唯一映射；自动相位返回 null；
- 编排层等待玩家输入、`GET /api/games/:id` 的 `timer` 字段都调用它。

## 3. 环境变量与默认值

| 变量 | 默认 |
|---|---|
| `HOWL_WOLF_CHAT_MS` | 100000 |
| `HOWL_WOLF_VOTE_MS` | 20000 |
| `HOWL_SEER_MS` | 120000 |
| `HOWL_WITCH_MS` | 120000 |
| `HOWL_HUNTER_SHOOT_MS` | 120000 |
| `HOWL_DAY_SPEECH_MS` | 120000 |
| `HOWL_PK_SPEECH_MS` | 120000 |
| `HOWL_DAY_VOTE_MS` | 120000 |
| `HOWL_DAY_VOTE_RUNOFF_MS` | 120000 |

## 4. 验收标准

1. 不设环境变量时使用表中默认值；
2. 设置任一变量后，实际等待与界面倒计时都变化；
3. 自动结算相位不显示倒计时；
4. 第一夜、后续夜晚、PK、重投都使用各自相位配置；
5. 非法环境变量会让启动明确失败，而不是静默回退。

## 5. Implementation Notes

- `phaseTimer()` 的起点取进入当前相位的事件，第一夜退回 `GAME_STARTED`；
- 前端不再本地假设 60 秒，夜间讨论面板也使用服务端剩余秒数。

### CHANGE-REQUEST-016 / RFC-022

CHANGE-REQUEST-016 / RFC-022：新增 9 个竞选/移交相位的倒计时配置。
