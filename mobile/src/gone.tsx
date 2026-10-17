/**
 * 「这条已经不在了」 in the soul app (Design 第四十批 O-c, shared with the officer app): a detail whose read answers
 * 404 or 403 (`fetchFailureOf` = `gone`) shows `GoneState` with 「回到{from}」, and the row that opened it is greyed
 * and does nothing once the soul is back on the list -- until the app restarts, as in the officer app.
 *
 * Keys are `<kind>:<id>` (`application:…`, `post:…`), so a list asks only about its own rows.
 */
import { useNavigation, type NavigationState } from "@react-navigation/native";
import { useEffect, useSyncExternalStore } from "react";

import { useI18n } from "./i18n";
import type { Landing } from "./push";
import { GoneState } from "./ui";

let gone: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function markGone(key: string) {
  if (gone.has(key)) return;
  gone = new Set(gone).add(key);
  listeners.forEach((fn) => fn());
}

/** The keys of every detail found gone so far; a new set on each change, so a list re-renders. */
export function useGone(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => gone,
    () => gone
  );
}

/** The gone key of where a notification lands, for the history row that would open it. */
export function landingGoneKey(landing: Landing | null): string | null {
  if (landing?.screen === "ApplicationDetail") return `application:${landing.id}`;
  if (landing?.screen === "CirclePost") return `post:${landing.id}`;
  return null;
}

/** Each list a gone detail can be opened from, by route (tabs by their screen title, as in navigation.tsx). */
const FROM_TITLES: Record<string, string> = {
  Life: "soul_app.tabs.life",
  Applications: "soul_app.tabs.applications",
  Letters: "soul_app.chat.title",
  Circle: "soul_app.circle.tab",
  CircleInbox: "soul_app.social.inbox_title",
  MyCircle: "soul_app.circle.me.title",
  CircleSearch: "soul_app.circle.search.title",
  NotificationHistory: "soul_app.history.title",
};

/** The route under this one; inside the tabs, the tab on show (Life before the tabs have a state of their own). */
export function fromRouteOf(state: Pick<NavigationState, "index" | "routes"> | undefined): string | null {
  const below = state ? state.routes[state.index - 1] : undefined;
  if (!below) return null;
  if (below.name !== "Tabs") return below.name;
  const tabs = below.state;
  return tabs?.routes[tabs.index ?? 0]?.name ?? "Life";
}

/**
 * The whole screen of a gone detail. `fallback` names the list when the screen below has no fixed title (a soul's
 * page is titled by its name): ponytail -- it says 「回到朋友圈」 there; pass the name through the route if Design asks.
 */
export function GoneScreen({ goneKey, fallback, testID }: { goneKey: string; fallback: string; testID?: string }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  // Read once: what is under this screen does not change while it shows.
  const from = fromRouteOf(navigation.getState?.());
  useEffect(() => markGone(goneKey), [goneKey]);
  return <GoneState testID={testID} from={t(FROM_TITLES[from ?? ""] ?? fallback)} onBack={navigation.goBack} />;
}

/** Tests only: each test starts with nothing gone (the set lives as long as the module). */
export function clearGone() {
  gone = new Set();
  listeners.forEach((fn) => fn());
}
