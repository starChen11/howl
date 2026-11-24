# CHANGE-REQUEST-015 · 阶段倒计时全部可配置并翻倍

**日期**：2026-11-24
**提出者**：用户
**状态**：Accepted（已实现）

## 变更

1. 每个阶段的倒计时都可通过环境变量配置：
   `HOWL_WOLF_CHAT_MS`、`HOWL_WOLF_VOTE_MS`、`HOWL_SEER_MS`、
   `HOWL_WITCH_MS`、`HOWL_HUNTER_SHOOT_MS`、`HOWL_DAY_SPEECH_MS`、
   `HOWL_PK_SPEECH_MS`、`HOWL_DAY_VOTE_MS`、`HOWL_DAY_VOTE_RUNOFF_MS`。
2. 所有默认值调整为原来的两倍：
   狼聊 100 秒、狼票 20 秒、其余 120 秒。
3. 服务端实际等待与前端倒计时使用同一份配置。

## 影响

- 规则登记为 RUL-17；RUL-14/15 中的旧秒数由 RUL-17 覆盖，流程不变；
- 自动结算相位仍然没有倒计时；
- `.env.example` 列出全部变量。
