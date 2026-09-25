/**
 * 审判队列的快捷键表,凡是列出队列快捷键的地方(队列控制台的键盘图、欢迎页清单)都读这一份。
 *
 * Design(第三类 F 组答复,2026-09-26)定的是**恰好这六个**:1–4 落判、S 暂缓、W 并发审批流、
 * R 暂缓的放回队列、N 聚焦备注、? 帮助。U 随撤回窗口删净,不得再出现。Esc 与 H 仍然有效
 * (`JudgmentQueueConsole.tsx` 的 keydown),只是不列 —— 表是 Design 定的,不是键位的全集。
 * `queueShortcuts.test.tsx` 钉住这张表与两处渲染。
 */
export const QUEUE_SHORTCUTS: readonly { key: string; label: string }[] = [
  { key: "1–4", label: "judgment.queue.key_verdicts" },
  { key: "S", label: "judgment.queue.key_defer" },
  { key: "W", label: "judgment.queue.key_workflow" },
  { key: "R", label: "judgment.queue.key_restore" },
  { key: "N", label: "judgment.queue.key_notes" },
  { key: "?", label: "judgment.queue.key_help" },
];
