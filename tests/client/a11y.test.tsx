import { readFileSync } from 'node:fs';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SeatGrid } from '@client/components/SeatGrid';
import { StatusBar } from '@client/components/StatusBar';
import { buildBoard, boardAnnouncement } from '@client/game-state';
import type { ProjectedContext } from '@shared/project';

/**
 * RFC-012 §5 AC-12 / AC-13 / AC-14 / AC-15：无障碍的静态与语义断言。
 */

const CSS = readFileSync('src/client/styles/global.css', 'utf8');

afterEach(() => cleanup());

function ctx(): ProjectedContext {
  return {
    self: { seat: 1, role: 'villager', alive: true, personaId: null },
    phase: 'DAY_SPEECH',
    day: 1,
    aliveSeats: [1, 2, 3],
    deadSeats: [],
    publicEvents: [],
    privateEvents: [],
    knowledge: {
      teammates: [],
      checks: [],
      potions: { heal: 'used', poison: 'used' },
      canShoot: false,
      knownKillTarget: null,
    },
    legalTargets: [],
    pending: 'speak',
  } as ProjectedContext;
}

describe('AC-12 · 焦点可见', () => {
  it('CSS 里没有「无替代的 outline: none」', () => {
    const offenders = CSS.split('\n')
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => /outline\s*:\s*none/.test(line));

    // 允许存在，但必须同时有 :focus-visible 的可见替代
    expect(CSS).toContain(':focus-visible');
    expect(offenders.every(({ line }) => line.includes(':focus-visible'))).toBe(true);
  });

  it('焦点样式给出可见的 outline 宽度', () => {
    const match = /:focus-visible\s*\{([^}]*)\}/.exec(CSS);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/outline\s*:\s*\d+px/);
  });
});

describe('AC-13 · 对比度（WCAG AA）', () => {
  /** 相对亮度（WCAG 2.1 定义）。 */
  function luminance(hex: string): number {
    const value = hex.replace('#', '');
    const rgb = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
    const linear = rgb.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  }

  function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  }

  function varOf(name: string): string {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
    if (match?.[1] === undefined) throw new Error(`找不到 --${name}`);
    return match[1];
  }

  it('正文与次要文字在两个背景上都 ≥ 4.5:1', () => {
    for (const fg of ['text', 'muted']) {
      for (const bg of ['bg', 'surface', 'surface-2']) {
        expect(contrast(varOf(fg), varOf(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('AC-14 · 状态有文字，不只靠颜色', () => {
  it('席位与状态条都不依赖颜色传达信息', () => {
    render(
      <>
        <StatusBar day={1} phase="DAY_SPEECH" aliveCount={3} remaining={30} speakingSeat={1} />
        <SeatGrid
          seats={[
            { seat: 1, alive: true, isSelf: true, hasSpoken: false, speaking: true },
            { seat: 2, alive: false, isSelf: false, hasSpoken: false, speaking: false },
          ]}
        />
      </>,
    );

    expect(screen.getByText('正在发言')).toBeTruthy();
    expect(screen.getByText('已出局')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toMatch(/秒/);
  });
});

describe('AC-15 · 读屏能读出身份、阶段与轮到谁', () => {
  it('公告文本包含三件事', () => {
    const text = boardAnnouncement(ctx(), 30);
    expect(text).toContain('1 号');
    expect(text).toContain('轮流发言');
    expect(text).toContain('轮到');
  });

  it('席位列表用 list/listitem 语义', () => {
    render(
      <SeatGrid
        seats={[{ seat: 1, alive: true, isSelf: true, hasSpoken: false, speaking: true }]}
      />,
    );
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('board 的推导与公告一致', () => {
    const board = buildBoard(ctx());
    expect(board.speakingSeat).toBe(1);
  });
});
