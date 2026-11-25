/**
 * 相位的中文名（RFC-014 复盘、RFC-013 状态条共用）。
 *
 * 界面上永远不该直接显示 `NIGHT_WOLVES` 这种枚举——那是给机器看的。
 */
import { ROLE_LABELS } from './terms';

export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'LOBBY':
      return '开局';
    case 'NIGHT':
      return '夜晚';
    case 'NIGHT_WOLF_CHAT':
      return '狼队讨论';
    case 'NIGHT_WOLVES':
      return '狼队袭击';
    case 'NIGHT_WOLF_RUNOFF':
      return '狼队重投';
    case 'NIGHT_SEER':
      return '查验';
    case 'NIGHT_WITCH':
      return '用药';
    case 'NIGHT_RESOLVE':
      return '夜间结算';
    case 'NIGHT_HUNTER_SHOOT':
      return `${ROLE_LABELS.hunter}开枪`;
    case 'DAY_SHERIFF_SIGNUP':
      return '上警';
    case 'DAY_SHERIFF_SPEECH':
      return '竞选发言';
    case 'DAY_SHERIFF_WITHDRAW':
      return '退水';
    case 'DAY_SHERIFF_VOTE':
      return '警下投票';
    case 'DAY_SHERIFF_PK':
      return '警长 PK 发言';
    case 'DAY_SHERIFF_RUNOFF':
      return '警长重投';
    case 'DAY_SHERIFF_RESULT':
      return '警长结果';
    case 'DAY_ANNOUNCE':
      return '天亮公布';
    case 'DAY_BADGE_TRANSFER':
      return '警徽移交';
    case 'DAY_SHERIFF_ORDER':
      return '警长定序';
    case 'DAY_SPEECH':
      return '轮流发言';
    case 'DAY_SHERIFF_FINAL_SPEECH':
      return '警长归票';
    case 'DAY_VOTE':
      return '投票';
    case 'DAY_PK_SPEECH':
      return 'PK 发言';
    case 'DAY_VOTE_RUNOFF':
      return '平票重投';
    case 'DAY_LYNCH':
      return '放逐';
    case 'DAY_HUNTER_SHOOT':
      return `${ROLE_LABELS.hunter}开枪`;
    case 'FINISHED':
      return '终局';
    default:
      return phase;
  }
}

/** 死因的中文名。 */
export function causeLabel(cause: string): string {
  switch (cause) {
    case 'wolf':
      return '被狼刀';
    case 'poison':
      return '被毒';
    case 'lynch':
      return '被放逐';
    case 'shoot':
      return '被枪杀';
    default:
      return cause;
  }
}

/** 胜负条件的中文名（引擎里是英文枚举，复盘要给人看）。 */
export function conditionLabel(condition: string): string {
  switch (condition) {
    case 'all-wolves-dead':
      return `${ROLE_LABELS.wolf}全部出局`;
    case 'all-gods-dead':
      return '神职全部出局';
    case 'all-villagers-dead':
      return `${ROLE_LABELS.villager}全部出局`;
    case 'all-good-dead':
      return '好人全部出局';
    default:
      return condition;
  }
}

/**
 * 「第 N 天」还是「第 N 夜」。
 *
 * 真实规则里首夜在第一天之前：夜 N 不算第 N 天。投影把夜间折叠成 `NIGHT`，
 * 所以这里同时接受真实相位（`NIGHT_*`）与投影相位（`NIGHT`）。
 */
export function dayLabel(day: number, phase: string | null | undefined): string {
  const night = typeof phase === 'string' && (phase === 'NIGHT' || phase.startsWith('NIGHT_'));
  return `第 ${day} ${night ? '夜' : '天'}`;
}
