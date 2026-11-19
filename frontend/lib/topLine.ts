import { useSyncExternalStore } from "react";

/**
 * The page head's top line runs once (第五十八批 M8) only for a refresh someone is waiting on (第六十批 P2): a manual
 * refresh, and the whole-page refresh after a reconnect or a version update. A first load has its own line (`loading`).
 * A timed poll or a push's invalidation does not run it -- nobody is waiting, and a line every few seconds reads as the
 * page being in trouble; a changed row says so with its row-changed highlight. So it is asked for by name, here, and
 * no longer inferred from "some query with data is fetching" (which every poll and push satisfied).
 * The apps have the same port: mobile/src/ui.tsx `runTopline`.
 */
let runs = 0;
const listeners = new Set<() => void>();

export function runTopLine(): void {
  runs++;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A counter that goes up on every `runTopLine()`. */
export function useTopLineRuns(): number {
  return useSyncExternalStore(subscribe, () => runs, () => 0);
}
