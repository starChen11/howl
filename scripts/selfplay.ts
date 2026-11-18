/**
 * `pnpm selfplay` 的占位实现。
 *
 * `OPS-3` 要求 `pnpm selfplay` 能在无浏览器环境下跑完指定局数并输出汇总，但那需要
 * 引擎（RFC-002~004）、AI（RFC-006~007）与 headless 驱动（RFC-015）全部就位。
 * 本阶段先把**脚本名与失败信号**立住，避免它在 RFC-015 之前静默成功、让人误以为
 * 批量对局已经可用。
 *
 * 这是对 `OPS-3` 的临时偏离，已登记为 `RFCS.md` 的 C-5，由 RFC-015 消除。
 */
console.error('pnpm selfplay 未实现（RFC-015）');
process.exitCode = 1;
