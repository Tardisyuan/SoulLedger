/**
 * 审判队列的快捷键表,凡是列出队列快捷键的地方(队列控制台的键盘图、欢迎页清单)都读这一份。
 *
 * Design(第三类 F 组答复,2026-09-26)定的是**恰好这六个**:1–4 落判、S 暂缓、W 并发审批流、
 * R 暂缓的放回队列、N 聚焦备注、? 帮助。U 随撤回窗口删净,不得再出现。Esc 与 H 仍然有效
 * (`JudgmentQueueConsole.tsx` 的 keydown),只是不列 —— 表是 Design 定的,不是键位的全集。
 * `JudgmentQueueConsole.test.tsx` 钉住这张表与渲染。
 *
 * 2026-09-30 加第七个 C「认领当前这一件」:改派、C 键认领、「我认领的」分组是 Design 在
 * B9 里列为「新功能待定」、用户随后拍板要做的三项(动效沿用交互与动效第三节 2c,Design
 * 说不另出稿)。改派没有键 —— 它要开弹层选人,不是一次按键的决定。
 */
export const QUEUE_SHORTCUTS: readonly { key: string; label: string }[] = [
  { key: "1–4", label: "judgment.queue.key_verdicts" },
  { key: "C", label: "judgment.queue.key_claim" },
  { key: "S", label: "judgment.queue.key_defer" },
  { key: "W", label: "judgment.queue.key_workflow" },
  { key: "R", label: "judgment.queue.key_restore" },
  { key: "N", label: "judgment.queue.key_notes" },
  { key: "?", label: "judgment.queue.key_help" },
];
