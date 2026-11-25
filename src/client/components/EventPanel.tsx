import type { ProjectedContext } from '@shared/project';
import { formatHalfVotes, tallyCountedVotes, type CountedVote } from '@shared/votes';

import { directionLabel, sheriffFailureReasonLabel } from '../game-state';

/**
 * 公开事件面板（RFC-013 §2.1 / RFC-022 §7）。
 *
 * 只显示**已经公开的事实**：死亡播报、放逐结果、票型，以及警长竞选 / 投票 / 移交。
 * 角色与夜间细节一律不进来——面板不是第二份真相。
 *
 * 每条还带 `anchor`：发言流里最近一条「此前已发生」的发言 `seq`。事件与发言是两套
 * 不同的 `seq`，直接用自己的 `seq` 去高亮永远匹配不到（评审 C-134）。
 * 竞选发言（`SHERIFF_SPEECH`）也是发言流里的条目，所以同样可以作为锚点。
 */

export interface PanelEntry {
  seq: number;
  day: number;
  kind: 'death' | 'banish' | 'vote' | 'sheriff';
  text: string;
  /** 发言流里可以定位到的 `seq`；没有对应发言时为 `null`。 */
  anchor: number | null;
}

/** 一张原始票的文案。 */
function ballotText(vote: { seat: number; target: number | 'abstain' }, weight?: number): string {
  const weightText =
    weight === undefined || weight === 2 ? '' : `（${formatHalfVotes(weight)} 票）`;
  return vote.target === 'abstain'
    ? `${vote.seat} 号弃权${weightText}`
    : `${vote.seat} 号投 ${vote.target} 号${weightText}`;
}

export function buildPanelEntries(ctx: ProjectedContext): PanelEntry[] {
  const entries: PanelEntry[] = [];
  let day = ctx.day;

  // 发言事件按 seq 递增，方便「找此前的最后一条」。
  const speeches = ctx.publicEvents
    .filter((event) => event.type === 'SPEECH' || event.type === 'SHERIFF_SPEECH')
    .map((event) => event.seq);

  const anchorFor = (seq: number): number | null => {
    let found: number | null = null;
    for (const speechSeq of speeches) {
      if (speechSeq <= seq) found = speechSeq;
      else break;
    }
    return found ?? speeches[0] ?? null;
  };

  for (const event of ctx.publicEvents) {
    if (event.type === 'DAY_STARTED') {
      const payload = event.payload as { day: number; diedLastNight: number[] };
      day = payload.day;
      // 夜间死亡在「天亮」时公布——这才是玩家看到的死亡播报（C-135）。
      for (const seat of payload.diedLastNight) {
        entries.push({
          seq: event.seq,
          day,
          kind: 'death',
          text: `${seat} 号出局`,
          anchor: anchorFor(event.seq),
        });
      }
      continue;
    }

    if (event.type === 'PLAYER_DIED') {
      const payload = event.payload as { seat: number; cause: string };
      // 夜间死亡已经由「天亮」那条播报过了；这里只补**放逐**与**枪杀**。
      if (payload.cause === 'lynch' || payload.cause === 'shoot') {
        entries.push({
          seq: event.seq,
          day,
          kind: payload.cause === 'lynch' ? 'banish' : 'death',
          text:
            payload.cause === 'lynch' ? `${payload.seat} 号被放逐` : `${payload.seat} 号被开枪带走`,
          anchor: anchorFor(event.seq),
        });
      }
      continue;
    }

    if (event.type === 'VOTE_REVEALED') {
      const payload = event.payload as {
        votes: { seat: number; target: number | 'abstain' }[];
        countedVotes?: CountedVote[];
      };
      const weights = new Map<number, number>();
      for (const counted of payload.countedVotes ?? [])
        weights.set(counted.seat, counted.halfVotes);

      const parts = payload.votes.map((vote) => ballotText(vote, weights.get(vote.seat)));
      let text = parts.join('，');
      if (payload.countedVotes !== undefined) {
        const totals = tallyCountedVotes(payload.countedVotes)
          .map(
            (entry) =>
              `${entry.target} 号 ${formatHalfVotes(entry.halfVotes)} 票（原始 ${entry.votes} 票）`,
          )
          .join('，');
        if (totals !== '') text = `${text}｜合计：${totals}`;
      }
      entries.push({
        seq: event.seq,
        day,
        kind: 'vote',
        text,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    /* ---- RFC-022 · 警长竞选与警徽 ---- */
    if (event.type === 'SHERIFF_CANDIDATES') {
      const candidates = (event.payload as { candidates: number[] }).candidates;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text:
          candidates.length === 0
            ? '无人上警'
            : `上警：${candidates.map((seat) => `${seat} 号`).join('、')}`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'SHERIFF_WITHDRAWN') {
      const payload = event.payload as { seat: number; withdraw: boolean };
      if (!payload.withdraw) continue;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `${payload.seat} 号退水`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'SHERIFF_VOTE_REVEALED') {
      const payload = event.payload as {
        votes: { seat: number; target: number | 'abstain' }[];
        round: 'initial' | 'runoff';
        tied?: number[];
      };
      const round = payload.round === 'runoff' ? '重投' : '首轮';
      const parts = payload.votes.map((vote) => ballotText(vote));
      const tied =
        payload.tied === undefined || payload.tied.length === 0
          ? ''
          : `｜平票：${payload.tied.map((seat) => `${seat} 号`).join('、')}`;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `警长投票（${round}）：${parts.join('，')}${tied}`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'SHERIFF_ELECTED') {
      const seat = (event.payload as { seat: number }).seat;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `${seat} 号当选警长`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'SHERIFF_ELECTION_FAILED') {
      const reason = (event.payload as { reason: string }).reason;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `本局无警长（${sheriffFailureReasonLabel(reason)}）`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'BADGE_TRANSFERRED') {
      const payload = event.payload as { from: number; to: number };
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `${payload.from} 号把警徽交给 ${payload.to} 号`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'BADGE_DESTROYED') {
      const seat = (event.payload as { seat: number }).seat;
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `${seat} 号撕掉警徽`,
        anchor: anchorFor(event.seq),
      });
      continue;
    }

    if (event.type === 'SHERIFF_ORDER_CHOSEN') {
      const payload = event.payload as {
        startSeat: number;
        direction: 'clockwise' | 'counterclockwise';
      };
      entries.push({
        seq: event.seq,
        day,
        kind: 'sheriff',
        text: `警长决定从 ${payload.startSeat} 号开始（${directionLabel(payload.direction)}）`,
        anchor: anchorFor(event.seq),
      });
    }
  }

  return entries;
}

export function EventPanel({
  entries,
  onJump,
}: {
  entries: PanelEntry[];
  onJump?: (seq: number) => void;
}) {
  return (
    <section className="panel" aria-label="公开事件">
      <h2>公开事件</h2>
      <ol className="panel__list">
        {entries.map((entry) => (
          <li key={`${entry.seq}-${entry.kind}-${entry.text}`} className="panel__item">
            <button
              type="button"
              className="panel__jump"
              onClick={() => {
                if (entry.anchor !== null) onJump?.(entry.anchor);
              }}
              disabled={entry.anchor === null}
              aria-label={`第 ${entry.day} 天，${entry.text}，跳到发言`}
            >
              第 {entry.day} 天 · #{entry.seq}
            </button>
            <span className="panel__text">{entry.text}</span>
          </li>
        ))}
        {entries.length === 0 ? <li className="panel__empty">还没有公开事件。</li> : null}
      </ol>
    </section>
  );
}
