/**
 * 锁屏实时进度 (live.*, V4Batch07 05 App「锁屏 · 实时活动」与「灵动岛三种状态」; user decision D13 2026-11-06:
 * native now). One content (`liveContent`, soulRoute.ts), two hosts:
 *
 *   iOS      a Live Activity (ActivityKit) through the local module `modules/soulledger-live`; the lock-screen and
 *            Dynamic Island views are the widget extension `plugins/withLiveActivity.js` adds to the project.
 *   Android  the equivalent: one ongoing notification on its own quiet channel, replaced in place on each change.
 *
 * Shown while the soul is on a road (`soulRoute` has a place) and the app has been opened since; updated whenever the
 * 本世 page re-reads the profile or the plan; ended when the route is gone or the session ends (the tabs unmount on
 * sign-out). Updated only from the app: no push updates the activity while the app is closed (that needs an
 * ActivityKit push token the server does not have).
 *
 * The lock screen shows the soul's name and station on both platforms, as the draft draws it (用户 2026-11-06 决定):
 * RBAC A9 (「锁屏只说来了东西」) does not apply to live progress. Every other notification — 书信 and the server's
 * pushes, pushCore.ts's channel — keeps A9 (PRIVATE); only this channel is PUBLIC.
 */
import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useI18n } from "./i18n";
import { liveContent, type LiveContent, type SoulRoute } from "@soulledger/core/domain/soulRoute";
import { useTheme } from "./ui";

interface LiveNative {
  /** Starts the activity, or updates the running one (restarting it if the title or tint changed). false: not allowed. */
  show(title: string, tint: string, state: string): Promise<boolean>;
  end(): Promise<void>;
}

export const LIVE_CHANNEL = "live-progress";
export const LIVE_NOTIFICATION = "live-progress";

const ios = () => (Platform.OS === "ios" ? requireOptionalNativeModule<LiveNative>("SoulLedgerLive") : null);

/** What the native activity's ContentState decodes (modules/soulledger-live/ios/SoulLedgerLiveAttributes.swift). */
export function nativeState(c: LiveContent): string {
  const { tag, headline, count, compact, place, island, first, current, last, progress, ended } = c;
  return JSON.stringify({ tag, headline, count, compact, place, island, first, current, last, progress, ended });
}

/** The Android notification's two lines: the title (with the road's name) and the headline over start → here → end. */
export function androidContent(c: LiveContent): Notifications.NotificationContentInput {
  return {
    title: c.tag ? `${c.title} · ${c.tag}` : c.title,
    body: `${c.headline} · ${c.count}\n${c.first} → ${c.current} → ${c.last}`,
    sticky: true,
    autoDismiss: false,
    data: { screen: "Life" },
  };
}

/**
 * The Android channel. Quiet: no sound, no heads-up, no badge — it is a status, not news. PUBLIC on the lock screen,
 * like the iOS Live Activity (用户 2026-11-06 决定: A9 does not apply to live progress; other channels stay PRIVATE).
 */
export function liveChannel(name: string): Notifications.NotificationChannelInput {
  return {
    name,
    importance: Notifications.AndroidImportance.LOW,
    showBadge: false,
    enableVibrate: false,
    sound: null,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  };
}

async function show(c: LiveContent, tint: string): Promise<void> {
  if (Platform.OS === "ios") {
    await ios()?.show(c.title, tint, nativeState(c));
    return;
  }
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(LIVE_CHANNEL, liveChannel(c.title));
  await Notifications.scheduleNotificationAsync({ identifier: LIVE_NOTIFICATION, content: androidContent(c), trigger: { channelId: LIVE_CHANNEL } });
}

export async function endLiveProgress(): Promise<void> {
  if (Platform.OS === "ios") await ios()?.end();
  else if (Platform.OS === "android") await Notifications.dismissNotificationAsync(LIVE_NOTIFICATION);
}

/** Keeps the lock screen in step with `route` (null: none) for the soul named `soul`. */
export function useLiveProgress(route: SoulRoute | null, soul: string): void {
  const { t } = useI18n();
  const { glow } = useTheme();
  const content = route ? liveContent(route, soul, t) : null;
  // One key per distinct content: a re-render with the same place does not touch the native side.
  const key = content ? `${glow}|${nativeState(content)}` : "";
  const latest = useRef({ content, glow });
  // Runs before the effect below in the same commit, so that one reads this render's content.
  useEffect(() => {
    latest.current = { content, glow };
  });
  useEffect(() => {
    const { content: now, glow: tint } = latest.current;
    if (!now) void endLiveProgress().catch(() => {});
    else void show(now, tint).catch(() => {});
  }, [key]);
  // Leaving the signed-in tree (sign-out): the lock screen forgets the soul too.
  useEffect(() => () => void endLiveProgress().catch(() => {}), []);
}
