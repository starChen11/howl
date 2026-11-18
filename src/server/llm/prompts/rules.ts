/**
 * 规则书：给 AI 的固定说明（RFC-006 §2.4）。
 *
 * 单独一份，因为它会被反复改（措辞、强调点），而「每次怎么问」的逻辑不该跟着动。
 *
 * **禁止出现**（AI-8 / F17）：`human`、「真人」、「你是 AI」、「助手」、「玩家是用户」。
 * 9 个席位一视同仁地用「你」「其他玩家」「座位」——任何一处区分来源，模型就会推断
 * 「这个席位是人」，而那正是产品要避免的。
 */
import { ROLE_LABELS } from '@shared/terms';

const WOLF = ROLE_LABELS.wolf;
const SEER = ROLE_LABELS.seer;
const WITCH = ROLE_LABELS.witch;
const HUNTER = ROLE_LABELS.hunter;

/** 两种模式的胜利条件不同，必须按当前模式生成，不能写死。 */
export function winConditionText(mode: 'slaughter-side' | 'slaughter-all'): string {
  return mode === 'slaughter-side'
    ? `${WOLF}阵营获胜的条件是神职全部出局，或${ROLE_LABELS.villager}全部出局。`
    : `${WOLF}阵营获胜的条件是所有好人全部出局。`;
}

export const RULES_TEXT = [
  `这是一局 9 人身份推理对局：3 个${WOLF}、${SEER}、${WITCH}、${HUNTER}各 1 名、3 个${ROLE_LABELS.villager}。`,
  `${WOLF}每晚共同选择一名玩家袭击；${SEER}每晚查验一名玩家的阵营；${WITCH}有一瓶解药和一瓶毒药，每瓶整局只能用一次；${HUNTER}被杀或放逐时可以开枪带走一人（被毒杀时不能）。`,
  '白天所有存活玩家轮流发言，然后投票放逐一人；投票在公布前互相看不到。',
  '投票平票时只对并列者重投，重投不能弃权；再次平票则当日无人出局。',
  `白天可以弃权；${WOLF}在白天可以自曝，自曝后当日立即结束、直接进入夜晚。`,
  `${WOLF}每夜动手之前有一个简短的内部讨论环节，每人说一句。`,
  `好人阵营获胜的条件是${WOLF}全部出局。`,
  '你只能使用自己看到的信息。不要推测自己没有看到的内容，也不要假设自己知道别人的身份。',
  '你可以选择说谎、伪装身份，但必须基于自己看到的信息。',
].join('\n');
