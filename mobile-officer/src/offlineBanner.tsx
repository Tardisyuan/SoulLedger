/**
 * The bar under the identity band (Design batch 28 O3).
 *
 * Offline: dark, 「没有网络 · 显示的是 HH:MM 的内容」 -- the time is when the content on screen was fetched
 * (readCache.ts `useShownAt`). Back online: light, 「✓ 已恢复网络 · 发出了 N 封回信」, folding away after
 * FOLD_MS unless a queued reply failed (then it stays while a failure is on the list). It also runs the
 * outbox: once on mount and on every return of the network, so the count it shows is the count it sent.
 *
 * The soul app's own bar (mobile/src/network.tsx) is off here (`<NetworkProvider bar={false}>`): it says
 * "offline" and nothing about cached content, which is the opposite of what this app promises.
 */
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { flushOutbox, useOutbox } from "./outbox";
import { useShownAt } from "./readCache";
import { Txt, space, useI18n, useOnline, useTheme } from "./shared";

export const FOLD_MS = 3000;

const hhmm = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

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

  useEffect(() => {
    if (!shownRestored || failed) return;
    const id = setTimeout(() => setRestored(null), FOLD_MS);
    return () => clearTimeout(id);
  }, [shownRestored, failed]);

  if (!offline && !shownRestored) return null;
  const dark = offline;
  const text = offline ? <ContentTime /> : `✓ ${shownRestored!.sent > 0 ? t("officer_app.offline.restored_sent", { n: String(shownRestored!.sent) }) : t("officer_app.offline.restored")}`;
  return (
    <View
      testID={dark ? "offline-banner" : "restored-banner"}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: space[5], paddingVertical: space[2], backgroundColor: dark ? theme.ink : theme.s2 }}
    >
      <Txt variant="caption" style={{ color: dark ? theme.s0 : theme.ink }}>
        {text}
      </Txt>
    </View>
  );
}

/**
 * Its own component so that only the offline bar listens for the time: online, a screen finishing its load
 * must not re-render the banner for a time nobody sees.
 */
function ContentTime() {
  const { t } = useI18n();
  const shownAt = useShownAt();
  const [openedAt] = useState(() => Date.now());
  return <>{t("officer_app.offline.banner", { time: hhmm(shownAt ?? openedAt) })}</>;
}
