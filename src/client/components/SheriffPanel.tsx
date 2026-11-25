import type { SheriffElectionView } from '@shared/project';
import type { SpeechDirection } from '@shared/domain';

import type { SheriffOrderOption } from '../game-state';
import { directionLabel } from '../game-state';
import { VoteInput } from './VoteInput';

/**
 * RFC-022 §7 的警长竞选与警徽操作面板。
 *
 * 拆成几个小面板而不是一个巨型条件组件：每个面板只描述「这一阶段能做什么」，
 * 挂不挂由 `App` 按相位决定。所有面板都是普通 section（不是弹窗），
 * 键盘与读屏的行为与现有输入区一致。
 */

function seatNames(seats: readonly number[]): string {
  return seats.length === 0 ? '还没有人' : seats.map((seat) => `${seat} 号`).join('、');
}

/** `DAY_SHERIFF_SIGNUP`：上警 / 不上警。 */
export function SheriffSignup({
  election,
  selfSeat,
  onSignup,
}: {
  election: SheriffElectionView;
  selfSeat: number;
  onSignup: (run: boolean) => void;
}) {
  const own = election.signups.find((entry) => entry.seat === selfSeat);
  const runSeats = election.signups
    .filter((entry) => entry.run)
    .map((entry) => entry.seat)
    .sort((a, b) => a - b);
  const stayedSeats = election.signups
    .filter((entry) => !entry.run)
    .map((entry) => entry.seat)
    .sort((a, b) => a - b);

  return (
    <section className="sheriff" aria-label="上警表态">
      <h2>上警表态</h2>
      <p className="sheriff__hint">
        上警的人依次做竞选发言；没上警的人留在警下，负责投票选出警长。
      </p>
      {own === undefined ? (
        <div className="sheriff__actions">
          <button type="button" className="button button--primary" onClick={() => onSignup(true)}>
            上警
          </button>
          <button type="button" className="button" onClick={() => onSignup(false)}>
            不上警
          </button>
        </div>
      ) : (
        <p className="sheriff__status" role="status">
          你选择了{own.run ? '上警' : '不上警'}，等待其他人表态。
        </p>
      )}
      <dl className="sheriff__facts">
        <div>
          <dt>已表态</dt>
          <dd>{election.signups.length} 人</dd>
        </div>
        <div>
          <dt>警上</dt>
          <dd>{seatNames(runSeats)}</dd>
        </div>
        <div>
          <dt>警下</dt>
          <dd>{seatNames(stayedSeats)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** `DAY_SHERIFF_WITHDRAW`：退水 / 不退水（仅候选人）。 */
export function SheriffWithdraw({
  candidates,
  withdrawn,
  selfSeat,
  decided,
  onWithdraw,
}: {
  candidates: number[];
  withdrawn: number[];
  selfSeat: number;
  /** `true` 已退水、`false` 已明确不退水、`undefined` 还没表态。 */
  decided: boolean | undefined;
  onWithdraw: (withdraw: boolean) => void;
}) {
  const isCandidate = candidates.includes(selfSeat);
  const remaining = candidates.filter((seat) => !withdrawn.includes(seat)).sort((a, b) => a - b);
  const withdrawnSeats = [...withdrawn].sort((a, b) => a - b);

  return (
    <section className="sheriff" aria-label="退水表态">
      <h2>退水表态</h2>
      <p className="sheriff__hint">退水就是放弃竞选，退水的人也没有警长投票权。</p>
      {!isCandidate ? (
        <p className="sheriff__status">你没有上警，这一轮不用退水。</p>
      ) : decided !== undefined ? (
        <p className="sheriff__status" role="status">
          你选择了{decided ? '退水' : '不退水'}，等待其他人表态。
        </p>
      ) : (
        <div className="sheriff__actions">
          <button type="button" className="button button--primary" onClick={() => onWithdraw(true)}>
            退水
          </button>
          <button type="button" className="button" onClick={() => onWithdraw(false)}>
            不退水
          </button>
        </div>
      )}
      <dl className="sheriff__facts">
        <div>
          <dt>仍在警上</dt>
          <dd>{seatNames(remaining)}</dd>
        </div>
        <div>
          <dt>已退水</dt>
          <dd>{seatNames(withdrawnSeats)}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * `DAY_SHERIFF_VOTE` / `DAY_SHERIFF_RUNOFF`：警下投票。
 *
 * - 候选人（与已退水者）不在候选按钮里；
 * - 首轮可以弃权，重投只能投并列者且不能弃权。
 */
export function SheriffVoteInput({
  election,
  selfSeat,
  onVote,
}: {
  election: SheriffElectionView;
  selfSeat: number;
  onVote: (target: number) => void;
}) {
  const runoff = election.phase === 'runoff' || election.runoff.length > 0;
  const eligible = runoff
    ? election.runoff
    : election.candidates.filter((seat) => !election.withdrawn.includes(seat));
  const targets = eligible
    .filter((seat) => seat !== selfSeat)
    .slice()
    .sort((a, b) => a - b);

  return (
    <VoteInput
      title={runoff ? '警长重投' : '警下投票'}
      hint={
        runoff
          ? '平票重投：只能投并列者，且不能弃权。'
          : '只有没上警的玩家能投票；候选人不可投，也可以弃权。'
      }
      targets={targets}
      allowAbstain={!runoff}
      onVote={onVote}
    />
  );
}

/** `DAY_SHERIFF_ORDER`：警长决定今天的发言起点与方向。 */
export function SheriffOrderPicker({
  options,
  onChoose,
}: {
  options: SheriffOrderOption[];
  onChoose: (startSeat: number, direction: SpeechDirection) => void;
}) {
  return (
    <section className="sheriff" aria-label="警长定序">
      <h2>决定发言顺序</h2>
      <p className="sheriff__hint">
        你是警长：选今天从谁开始、按哪个方向轮。夜里死一个人就从死者旁边开始，平安夜或多死就从你旁边开始。
      </p>
      {options.length === 0 ? (
        <p className="sheriff__status">现在没有可选的发言顺序。</p>
      ) : (
        <ul className="order__list">
          {options.map((option) => (
            <li key={`${option.startSeat}-${option.direction}`}>
              <button
                type="button"
                className="button"
                onClick={() => onChoose(option.startSeat, option.direction)}
              >
                从 {option.startSeat} 号开始（{directionLabel(option.direction)}）
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `DAY_BADGE_TRANSFER`：死亡警长移交警徽 / 撕徽。 */
export function BadgeTransferPanel({
  targets,
  onTransfer,
}: {
  /** 可以接任的存活玩家（不含自己）。 */
  targets: number[];
  onTransfer: (target: number | 'tear') => void;
}) {
  return (
    <section className="sheriff badge-transfer" aria-label="移交警徽">
      <h2>移交警徽</h2>
      <p className="sheriff__hint">
        你作为警长已经出局。可以把警徽交给一名存活玩家，让他接任警长；也可以撕掉警徽，本局不再有警长。
      </p>
      <div className="sheriff__actions">
        {targets.map((seat) => (
          <button key={seat} type="button" className="button" onClick={() => onTransfer(seat)}>
            移交给 {seat} 号
          </button>
        ))}
        <button type="button" className="button button--danger" onClick={() => onTransfer('tear')}>
          撕掉警徽
        </button>
      </div>
    </section>
  );
}
