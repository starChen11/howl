# RFC-020 · 放逐平票的 PK 发言

**Features**: F5, F6
**Depends on**: RFC-004
**Rules**: RUL-2, RUL-9, RUL-16
**Complexity**: Medium

---

## 1. 摘要

放逐投票首轮平票时，并列者先依次做一轮 PK 发言（说明为什么自己不是狼），
然后进入重投；重投仍平票则当日无人出局、直接入夜。

## 2. 设计

- 新增相位 `DAY_PK_SPEECH`：只有 `runoff`（并列者）能发言，各一次；
- 首轮 `DAY_VOTE` 平票 → `DAY_PK_SPEECH`；所有人说完 → `DAY_VOTE_RUNOFF`；
- 重投仍平票 → 入夜（RUL-9 不变）；
- PK 阶段允许自曝（与白天发言一致）；
- 投影 `pending='speak'`，`seatToSpeak` 把发言顺序限制在并列者内。

## 3. 验收标准

1. 首轮平票进入 `DAY_PK_SPEECH`，不是直接重投；
2. 只有并列者能发言，非并列者提交被拒；
3. 并列者各说完后进入 `DAY_VOTE_RUNOFF`；
4. 重投只有并列者、不能弃权；仍平票则入夜无人出局；
5. 玩家是并列者时能亲自 PK 发言。

## 4. Implementation Notes

- 相位标签「PK 发言」；状态条、复盘时间线自动复用；
- 脚本 AI 在 PK 阶段说一句自证；玩家输入走 `SPEECH`/`SPEECH_SKIP`；
- 测试：`tests/engine/vote.test.ts` 的 PK 用例、编排/全流程驱动已适配。
