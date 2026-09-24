/**
 * 规范 v1 §1.8「四种文明 · 保留编号法，撤销文明色」: a civilization is told
 * apart by its numbering string and a shape mark, never by colour.
 *
 * `NUMBERING_SAMPLE` is an illustration of each civilization's numbering law,
 * shown where an operator picks a civilization (e.g. the dispatch form), copied
 * verbatim from the spec. It is NOT a number the frontend composes for a soul —
 * those come from the backend and are shown as-is.
 */
export const NUMBERING_SAMPLE: Record<string, string> = {
  CHINESE: "救濟門 · 十七",
  EUROPEAN: "IX · XXVI",
  EGYPTIAN: "§ 27 / 42",
  GREEK: "523a",
};

/** Chart / legend mark per civilization (■ 方 · ● 圆 · ▲ 三角 · ◆ 菱). */
export const CIVILIZATION_MARK: Record<string, string> = {
  CHINESE: "■",
  EUROPEAN: "●",
  EGYPTIAN: "▲",
  GREEK: "◆",
};
