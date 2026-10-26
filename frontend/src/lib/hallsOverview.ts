import type { HallOverviewRow } from "@soulledger/core/api";

export type HallSort = "code" | "todo";

/** 各殿概况的排序。默认按代号;「待办多的在前」按 `todo.total`,同数再按无人认领(第五十四批 O-1:多半是在找哪殿堵了)。 */
export function sortHalls(rows: HallOverviewRow[], sort: HallSort): HallOverviewRow[] {
  const out = [...rows];
  if (sort === "todo") {
    out.sort((a, b) => b.todo.total - a.todo.total || b.judgments.unclaimed - a.judgments.unclaimed || a.code.localeCompare(b.code));
  } else {
    out.sort((a, b) => a.code.localeCompare(b.code));
  }
  return out;
}
