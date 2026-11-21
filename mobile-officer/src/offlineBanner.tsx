/**
 * The bar under the identity band (Design batch 28 O3).
 *
 * Offline: dark, 「没有网络 · 显示的是 HH:MM 的内容」 -- the time is when the content on screen was fetched
 * (readCache.ts `useShownAt`). Back online: light, 「✓ 已恢复网络 · 发出了 N 封回信」, folding away after
 * FOLD_MS unless a queued reply failed (then it stays while a failure is on the list). It also runs the
 * outbox: once on mount and on every return of the network, so the count it shows is the count it sent.
 * It opens over 160 and folds away over 160, the soul app's bar and the web's alike (第五十八批 M13): the restored line
 * stands its 3 s, then folds. Reduce motion: in and out at once.
 *
 * The soul app's own bar (packages/mobile-ui/src/network.tsx) is off here (`<NetworkProvider bar={false}>`): it says
 * "offline" and nothing about cached content, which is the opposite of what this app promises.
 */
import { hhmm } from "@soulledger/core/domain/dates";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";

import { flushOutbox, useOutbox } from "./outbox";
import { useShownAt } from "./readCache";
import { Grow, Txt, space, useI18n, useOnline, useReducedMotionDurations, useTheme } from "./shared";

export const FOLD_MS = 3000;

export function OfflineBanner() {
  const { t } = useI18n();
  const theme = useTheme();
  const { offline, back } = useOnline();
  const failed = useOutbox().some((e) => e.state === "failed");
  // Tagged with the return it belongs to, so an older one never shows again after the next outage.
  const [restored, setRestored] = useState<{ sent: number; back: number } | null>(null);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      return;
    }
    const returned = wasOffline.current;
    wasOffline.current = false;
    let live = true;
    void flushOutbox().then((sent) => {
      if (live && returned) setRestored({ sent, back });
    });
    return () => {
      live = false;
    };
  }, [offline, back]);

  const shownRestored = restored && restored.back === back ? restored : null;
  const { offlineBar } = useReducedMotionDurations();
  const open = offline || !!shownRestored;
  // Mounted from the moment it opens until its fold has played; the last thing it said stays while it folds.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const [said, setSaid] = useState<{ dark: boolean; text: ReactNode } | null>(null);

  useEffect(() => {
    if (!shownRestored || failed) return;
    const id = setTimeout(() => setRestored(null), FOLD_MS);
    return () => clearTimeout(id);
  }, [shownRestored, failed]);

  const now = open
    ? {
        dark: offline,
        text: offline ? <ContentTime /> : `✓ ${shownRestored!.sent > 0 ? t("officer_app.offline.restored_sent", { n: String(shownRestored!.sent) }) : t("officer_app.offline.restored")}`,
      }
    : null;
  const nowKey = now ? `${now.dark}:${typeof now.text === "string" ? now.text : "time"}` : null;
  const saidKey = said ? `${said.dark}:${typeof said.text === "string" ? said.text : "time"}` : null;
  if (now && nowKey !== saidKey) setSaid(now);
  if (!mounted) return null;
  const { dark, text } = now ?? said ?? { dark: false, text: "" };
  return (
    <Grow ms={offlineBar} open={open} onClosed={() => setMounted(false)}>
      <View
        testID={open ? (dark ? "offline-banner" : "restored-banner") : "offline-folding"}
        accessibilityRole={open ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={{ paddingHorizontal: space[5], paddingVertical: space[2], backgroundColor: dark ? theme.ink : theme.s2 }}
      >
        <Txt variant="caption" style={{ color: dark ? theme.s0 : theme.ink }}>
          {text}
        </Txt>
      </View>
    </Grow>
  );
}

/**
 * Its own component so that only the offline bar listens for the time: online, a screen finishing its load
 * must not re-render the banner for a time nobody sees.
 */
function ContentTime() {
  const { t } = useI18n();
  const shownAt = useShownAt();
  // Nothing fetched on the screen in front (「没取到」, or nothing loaded yet): say only that the network is gone.
  return <>{shownAt === null ? t("officer_app.offline.banner_bare") : t("officer_app.offline.banner", { time: hhmm(new Date(shownAt)) })}</>;
}
