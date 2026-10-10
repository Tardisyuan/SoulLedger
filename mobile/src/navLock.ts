/**
 * "Do not move the user" -- a count of screens that must not be navigated away from by anything but the
 * user's own hand: the recovery codes shown once (两步验证 step ③), where leaving loses them for good.
 *
 * The deep-link and push-tap bridges (navigation.tsx) read it and WAIT: a link stays in the inbox
 * (`createLinkInbox` holds it while nobody subscribes), a tapped notification stays pending, and both land
 * the moment the last hold is released -- nothing is dropped, nothing drags the soul off the page.
 */
import { useSyncExternalStore } from "react";

let holds = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Returns the release. Idempotent, so an unmount and a "done" press can both call it. */
export function holdNavigation(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

export function navigationHeld(): boolean {
  return holds > 0;
}

export function useNavigationHeld(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    navigationHeld,
    navigationHeld
  );
}
