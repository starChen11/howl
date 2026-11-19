import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { OnboardingHints, ONBOARDING_KEY } from '@client/components/OnboardingHints';
import { SeatGrid } from '@client/components/SeatGrid';
import { SpeechFeed } from '@client/components/SpeechFeed';
import { SpeechInput } from '@client/components/SpeechInput';
import { StatusBar } from '@client/components/StatusBar';
import { TermHint } from '@client/components/TermHint';

/**
 * RFC-012 §5 AC-1 / 2 / 4 / 5 / 6 / 11 / 14 / 15：组件与可访问性。
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AC-1 · 状态条', () => {
  it('天数、阶段、存活、轮次都以文字显示', () => {
    render(<StatusBar day={3} phase="DAY_SPEECH" aliveCount={5} remaining={42} speakingSeat={2} />);

    expect(screen.getByText('第 3 天')).toBeTruthy();
    expect(screen.getByText('轮流发言')).toBeTruthy();
    expect(screen.getByText('5 人')).toBeTruthy();
    expect(screen.getByText('2 号发言')).toBeTruthy();
    expect(screen.getByText(/42 秒/)).toBeTruthy();
  });

  it('倒计时用 role=timer 且 aria-live=polite', () => {
    render(<StatusBar day={1} phase="DAY_SPEECH" aliveCount={9} remaining={30} speakingSeat={1} />);

    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-live')).toBe('polite');
  });
});

describe('AC-6 · 席位状态', () => {
  const seats = [
    { seat: 1, alive: true, isSelf: true, hasSpoken: false, speaking: true },
    { seat: 2, alive: true, isSelf: false, hasSpoken: true, speaking: false },
    { seat: 3, alive: false, isSelf: false, hasSpoken: false, speaking: false },
  ];

  it('三种状态都有文字，不只靠颜色', () => {
    render(<SeatGrid seats={seats} />);

    expect(screen.getByText('正在发言')).toBeTruthy();
    expect(screen.getByText('已发言')).toBeTruthy();
    expect(screen.getByText('已出局')).toBeTruthy();
  });

  it('每个席位有可访问名称，含「你」的标记', () => {
    render(<SeatGrid seats={seats} />);

    expect(screen.getByLabelText('1 号：正在发言（你）')).toBeTruthy();
    expect(screen.getByLabelText('3 号：已出局')).toBeTruthy();
  });

  it('提供 onSelect 时按钮可用（键盘可达）', async () => {
    const user = userEvent.setup();
    let picked = 0;
    render(<SeatGrid seats={seats} onSelect={(seat) => (picked = seat)} />);

    const list = screen.getByRole('list');
    const first = within(list).getAllByRole('button')[0];
    if (first === undefined) throw new Error('没有席位按钮');
    first.focus();
    await user.keyboard('{Enter}');

    expect(picked).toBe(1);
  });
});

describe('AC-2 · 术语解释', () => {
  it('点击或聚焦时显示解释，且有 aria-describedby', async () => {
    const user = userEvent.setup();
    render(
      <TermHint termKey="knife">
        <span>刀</span>
      </TermHint>,
    );

    const trigger = screen.getByRole('button', { name: '刀' });
    await user.click(trigger);

    const hint = screen.getByRole('tooltip');
    expect(hint.textContent).toContain('狼人夜间击杀');
    expect(trigger.getAttribute('aria-describedby')).toBe(hint.id);
  });
});

describe('AC-4 / AC-5 · 新手提示', () => {
  it('显示身份说明，提示语不代填', () => {
    render(<OnboardingHints role="seer" goal="今晚挑一个人查验。" />);

    expect(screen.getByText(/你的身份是 预言家/)).toBeTruthy();
    expect(screen.getByText(/今晚挑一个人查验/)).toBeTruthy();
  });

  it('关闭后写入本地标记，重新挂载不再出现', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingHints role="seer" goal="查验" />);

    await user.click(screen.getByRole('button', { name: '知道了，不再提示' }));
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1');

    unmount();
    render(<OnboardingHints role="seer" goal="查验" />);
    expect(screen.queryByRole('heading', { name: '怎么看' })).toBeNull();
  });
});

describe('AC-11 · 输入区键盘可用', () => {
  it('300 字以上禁止提交并给出提示', async () => {
    const user = userEvent.setup();
    let submitted = '';
    render(
      <SpeechInput
        remaining={30}
        onSubmit={(text) => (submitted = text)}
        onSkip={() => undefined}
      />,
    );

    const box = screen.getByLabelText(/你的发言/);
    await user.click(box);
    await user.paste('字'.repeat(301));

    expect(screen.getByRole('alert').textContent).toContain('超过');
    expect((screen.getByRole('button', { name: '发言' }) as HTMLButtonElement).disabled).toBe(true);
    expect(submitted).toBe('');
  });

  it('空白输入按「过」处理', async () => {
    const user = userEvent.setup();
    let skipped = false;
    render(
      <SpeechInput
        remaining={30}
        onSubmit={() => undefined}
        onSkip={() => {
          skipped = true;
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '过' }));
    expect(skipped).toBe(true);
  });
});

describe('AC-1 · 发言流', () => {
  it('空状态有提示；有内容时按席位显示', () => {
    const { rerender } = render(<SpeechFeed lines={[]} />);
    expect(screen.getByText('还没有人发言。')).toBeTruthy();

    rerender(<SpeechFeed lines={[{ id: 1, seat: 2, text: '我觉得 3 号像' }]} />);
    expect(screen.getByText('2 号')).toBeTruthy();
    expect(screen.getByText('我觉得 3 号像')).toBeTruthy();
  });
});

describe('C-122 · 草稿同步', () => {
  it('输入变化会回调 onDraft', async () => {
    const user = userEvent.setup();
    const drafts: string[] = [];
    render(
      <SpeechInput
        remaining={30}
        onSubmit={() => undefined}
        onSkip={() => undefined}
        onDraft={(text) => drafts.push(text)}
      />,
    );

    await user.click(screen.getByLabelText('你的发言'));
    await user.paste('我怀疑 7 号。');

    expect(drafts.at(-1)).toBe('我怀疑 7 号。');
  });
});

describe('C-123 · 身份卡有技能与目标', () => {
  it('渲染技能、目标与身份标签', async () => {
    const { IdCard } = await import('@client/components/IdCard');
    const ctx = {
      self: { seat: 3, role: 'witch', alive: true, personaId: null },
      phase: 'NIGHT_WITCH',
      day: 1,
      aliveSeats: [1, 2, 3],
      deadSeats: [],
      publicEvents: [],
      privateEvents: [],
      knowledge: {
        teammates: [],
        checks: [],
        potions: { heal: 'available', poison: 'used' },
        canShoot: false,
        knownKillTarget: null,
      },
      legalTargets: [1, 2],
      pending: 'witch',
    } as never;

    render(<IdCard ctx={ctx} />);

    expect(screen.getByText(/女巫/)).toBeTruthy();
    expect(screen.getByText(/一瓶解药/)).toBeTruthy();
    expect(screen.getByText(/解药 1 次/)).toBeTruthy();
    expect(screen.getByText(/决定用不用解药/)).toBeTruthy();
  });
});
