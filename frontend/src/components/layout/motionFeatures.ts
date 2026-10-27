// The animation features `<LazyMotion>` in AppLayout loads after first paint, not in every route's first-load JS
// (perf review 2026-10-27 #13). domMax because QueueMinePanel's `m` rows animate layout (LayoutGroup).
export { domMax as default } from "motion/react";
