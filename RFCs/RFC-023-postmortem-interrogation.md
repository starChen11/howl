# RFC-023 · 赛后拷问与最大责任投票

**Features**: F58
**Depends on**: RFC-014, RFC-022
**Rules**: RUL-18（身份已公开后的赛后环节，不改变对局规则）
**Complexity**: Medium

---

## 1. 摘要

复盘页增加赛后拷问：9 人按座位轮流，每人可拷问一个或多个其他席位；
全部问完后 9 人投票选出最大责任人；最高票者发表感想，平票则并列者共同承担。

## 2. 流程

```
1 号拷问（可选多人）→ 2 号 → ... → 9 号
→ 全体责任投票（可投自己）
→ 最高票者发表感想；平票者共同承担
```

- 每轮可以只问一个、问多个，或直接结束；
- 被拷问者用真实模型回答；
- 所有提问与回答保留在页面上；
- 赛后环节不影响对局结果、复盘时间线或身份揭示。

## 3. 服务端

- `POST /api/games/:id/postmortem`，仅已结束对局；
- 请求类型：`questions` / `answer` / `vote` / `speech`；
- 服务端从复盘快照读取身份、时间线与 AI 推理，构造赛后提示；
- 返回纯文本或结构化座位/问题；
- 不写事件流、不修改对局记录。

## 4. 前端

- `PostmortemPanel` 挂在复盘页末尾；
- 玩家轮到时可多选目标、输入问题、重复提问，或结束回合；
- AI 回合自动请求问题与回答并推进；
- 投票阶段玩家可投任意座位（含自己）；
- 结果区显示票型、最大责任人、AI/玩家感想。

## 5. 验收

1. 9 个座位按 1→9 顺序进行；
2. 玩家可向多个目标提问，也可提前结束自己的回合；
3. AI 可问 0～2 个目标，回答由真实模型生成；
4. 全部结束后进入责任投票，9 人各一票，可投自己；
5. 最高票为最大责任人；平票并列者共同承担；
6. 最大责任人（或并列者）各发表感想，玩家本人用输入框；
7. 赛后环节不改变原对局结果；
8. 非终局/无权限返回错误；
9. 模型失败显示可见错误，不破坏复盘。

## 6. Implementation Notes

- 当前实现为**客户端驱动的赛后状态机 + 无状态服务端模型接口**，刷新页面后赛后对话不保留；
- 平票按用户选择「并列者共同承担」；
- AI 每轮最多问 2 个目标，玩家可问任意多个；
- 真实模型不可用时接口返回 503，页面显示错误，不影响复盘本身。

## 7. Implementation Notes（2026-11-26）

**Status**: Implemented（等待 /review-rfc）

- 新增 `src/shared/postmortem.ts`、`src/server/postmortem.ts`、
  `POST /api/games/:id/postmortem`；
- 服务端只读复盘快照，使用独立纯文本模型调用，不写事件流、不改对局；
- 新增 `PostmortemPanel`，挂载在复盘页末尾，玩家可多目标提问/提前结束；
- AI 按 1→9 自动拷问（每轮 0～2 个目标），全部结束后 9 人并发投票；
- 最高票者/并列最高票者发表感想；玩家本人用输入框，AI 用模型生成；
- **没有服务端持久化**：刷新复盘页会重置赛后对话，这是当前有意的轻量实现；
- 真实模型探测已验证问题/回答接口可用；
- 每类请求都把「当前座位 + 身份」和被问者身份单独写进 system prompt，避免模型只从全局身份表里猜自己是谁；
- 回答请求明确「你正在扮演被问者，不要用提问者身份回答」。

### 验证

- `typecheck / lint / format / build`：exit 0
- unit + client：99 文件 / 966 用例通过
- e2e：16 条通过
- 浏览器实跑：玩家提问→AI 回答→1～9 轮自动拷问→责任投票→结果；
  期间发现父组件每次轮询导致 `ask` 回调身份变化、感想请求被反复取消，已用 ref 稳定并加回归测试。

### 改动文件

```text
src/shared/postmortem.ts
src/server/postmortem.ts
src/server/routes/games.ts
src/server/llm/client.ts
src/client/api.ts
src/client/App.tsx
src/client/pages/ReplayPage.tsx
src/client/components/PostmortemPanel.tsx
PRD.md / FEATURES.md / RFCS.md / TEST-STRATEGY.md
changes/CHANGE-REQUEST-017.md
RFCs/RFC-023-postmortem-interrogation.md
tests/server/postmortem.test.ts
tests/client/postmortem.test.tsx
```
