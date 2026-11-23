import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ReplayPage } from '@client/pages/ReplayPage';
import { Timeline } from '@client/components/Timeline';
import { ThoughtCard } from '@client/components/ThoughtCard';
import type { ReplaySnapshot } from '@shared/replay';

/**
 * RFC-014 §5 AC-2 / AC-9 ~ AC-11 / AC-14：复盘界面。
 */

afterEach(cleanup);

const snapshot: ReplaySnapshot = {
  gameId: 'g',
  seed: 1,
  finishedAt: 0,
  result: 'wolf',
  winCondition: '神职全部出局',
  timeline: [
    { seq: 1, day: 0, phase: 'LOBBY', text: '身份分配完成' },
    { seq: 2, day: 1, phase: 'NIGHT_WOLF_CHAT', text: '3 号夜聊' },
    { seq: 3, day: 1, phase: 'DAY_SPEECH', text: '3 号发言：我是预言家' },
  ],
  seats: [
    {
      seat: 1,
      role: 'wolf',
      roleLabel: '狼人',
      personaId: 'blunt',
      personaLabel: '直来直去',
      alive: true,
    },
    {
      seat: 3,
      role: 'seer',
      roleLabel: '预言家',
      personaId: null,
      personaLabel: null,
      alive: false,
    },
  ],
  thoughts: [
    { seq: 2, seat: 1, kind: 'speech', reason: '我要悍跳预言家', chose: '' },
    { seq: 3, seat: 3, kind: 'speech', reason: '3 号发言太急，像好人', chose: '' },
  ],
  degraded: [3],
};

describe('AC-2 · 复盘揭示全部身份', () => {
  it('显示角色与人格标签，含出局标记', () => {
    render(<ReplayPage snapshot={snapshot} onRestart={() => undefined} />);

    expect(screen.getByText(/1 号：狼人（直来直去）/)).toBeTruthy();
    expect(screen.getByText(/3 号：预言家/)).toBeTruthy();
    expect(screen.getByText(/已出局/)).toBeTruthy();
  });

  it('显示结果与胜负条件', () => {
    render(<ReplayPage snapshot={snapshot} onRestart={() => undefined} />);
    expect(screen.getByRole('status').textContent).toContain('狼人阵营胜利');
    expect(screen.getByRole('status').textContent).toContain('神职全部出局');
  });
});

describe('AC-9 ~ AC-11 · 视角筛选', () => {
  it('选中席位后只显示它的推理，时间线不变', async () => {
    const user = userEvent.setup();
    render(<ReplayPage snapshot={snapshot} onRestart={() => undefined} />);

    const timelineItems = () =>
      within(screen.getByLabelText('复盘时间线'))
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    const before = timelineItems();

    await user.click(screen.getByRole('button', { name: '1 号' }));

    expect(screen.getByText(/我要悍跳预言家/)).toBeTruthy();
    expect(screen.queryByText(/3 号发言太急/)).toBeNull();

    // 条数一样不够：文本必须逐条完全一致（C-160）
    expect(timelineItems()).toEqual(before);
  });

  it('切回「全部」恢复所有推理', async () => {
    const user = userEvent.setup();
    render(<ReplayPage snapshot={snapshot} onRestart={() => undefined} />);

    await user.click(screen.getByRole('button', { name: '3 号' }));
    expect(screen.queryByText(/我要悍跳预言家/)).toBeNull();

    await user.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByText(/我要悍跳预言家/)).toBeTruthy();
    expect(screen.getByText(/3 号发言太急/)).toBeTruthy();
  });
});

describe('AC-7 / AC-14 · 降级标注与再来一局', () => {
  it('时间线标出降级轮次；按钮可点', async () => {
    const user = userEvent.setup();
    let restarted = 0;
    render(<ReplayPage snapshot={snapshot} onRestart={() => (restarted += 1)} />);

    expect(screen.getAllByText('降级')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '再来一局' }));
    expect(restarted).toBe(1);
  });

  it('夜间条目显示「第 N 夜」，开局显示「开局」', () => {
    render(
      <Timeline
        entries={[
          { seq: 1, day: 0, phase: '开局', text: '身份分配完成' },
          { seq: 2, day: 1, phase: 'NIGHT_WOLF_CHAT', text: '夜聊' },
        ]}
        degraded={[]}
      />,
    );

    expect(screen.getByText('开局')).toBeTruthy();
    expect(screen.getByText('第 1 夜')).toBeTruthy();
  });

  it('时间线只渲染传入的条目，不自己补数据', () => {
    render(<Timeline entries={snapshot.timeline} degraded={snapshot.degraded} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('推理卡展示 reason 与 claim', () => {
    render(
      <ThoughtCard
        thought={{
          seq: 4,
          seat: 1,
          kind: 'speech',
          reason: '3 号在保 5 号',
          chose: '',
          claim: { role: 'seer', checks: [{ target: 2, result: 'wolf' }] },
        }}
      />,
    );

    expect(screen.getByText('3 号在保 5 号')).toBeTruthy();
    expect(screen.getByText(/2 号是狼/)).toBeTruthy();
  });
});

describe('AC-8 · 复盘页展示用量', () => {
  it('有 usage 时显示调用次数与 token', () => {
    const withUsage = {
      ...snapshot,
      usage: { calls: 12, inputTokens: 3400, outputTokens: 900, cachedTokens: 100 },
    };
    render(<ReplayPage snapshot={withUsage} onRestart={() => undefined} />);

    expect(screen.getByText(/模型调用 12 次/)).toBeTruthy();
    expect(screen.getByText(/输入 3400/)).toBeTruthy();
  });
});
