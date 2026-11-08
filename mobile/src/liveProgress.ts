/**
 * 锁屏实时进度 (live.*, V4Batch07 05 App「锁屏 · 实时活动」与「灵动岛三种状态」; user decision D13 2026-11-06:
 * native now). One content (`liveContent`, soulRoute.ts), two hosts:
 *
 *   iOS      a Live Activity (ActivityKit) through the local module `modules/soulledger-live`; the lock-screen and
 *            Dynamic Island views are the widget extension `plugins/withLiveActivity.js` adds to the project.
 *   Android  the equivalent: one ongoing notification on its own quiet channel, replaced in place on each change, posted
 *            by the same module's Kotlin side (`notify`). Not through expo-notifications: its builder never sets
 *            Notification.visibility (always PRIVATE), and Android resets an app-created channel's PUBLIC to
 *            NO_OVERRIDE, so nothing expo posts reaches the lock screen as PUBLIC; and its LOW channel is "silent",
 *            which Android 12 / EMUI keep off the lock screen altogether (华为 TAS-AL00, 2026-11-08). The expo path
 *            remains only where the module is absent (jest, Expo Go).
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
import { platform } from "@soulledger/core/platform";
import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { useI18n } from "./i18n";
import { PRIMER_SEEN_KEY, permission, registerDevice, requestPermission, type Permission } from "./push";
import { liveContent, type LiveContent, type SoulRoute } from "@soulledger/core/domain/soulRoute";
import { useTheme } from "./ui";

interface LiveNative {
  /** Starts the activity, or updates the running one (restarting it if the title or tint changed). false: not allowed. */
  show(title: string, tint: string, state: string): Promise<boolean>;
  end(): Promise<void>;
}

interface LiveNativeAndroid {
  /** Posts or replaces the ongoing notification on LIVE_CHANNEL, VISIBILITY_PUBLIC. false: notifications are off. */
  notify(channelName: string, title: string, body: string, progress: number): Promise<boolean>;
  end(): Promise<void>;
}

/** The Kotlin side's channel (DEFAULT importance, silenced); it deletes the old LOW `live-progress` on first use. */
export const LIVE_CHANNEL = "live-progress-v2";
export const LIVE_NOTIFICATION = "live-progress";
/** The expo-notifications fallback keeps the old id: a LOW channel made there must not squat on the v2 id. */
const EXPO_CHANNEL = "live-progress";

const ios = () => (Platform.OS === "ios" ? requireOptionalNativeModule<LiveNative>("SoulLedgerLive") : null);
const android = () => (Platform.OS === "android" ? requireOptionalNativeModule<LiveNativeAndroid>("SoulLedgerLive") : null);

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

/** Set once this device has shown the system's notification dialog for live progress: never asked again. */
export const LIVE_ASKED_KEY = "soul_live_permission_asked";

let asking: Promise<boolean> | null = null;

/** Set once the soul has answered the 「锁屏上看不到进度」 sheet, either button: never shown again. */
export const LIVE_HINT_SEEN_KEY = "soul_live_settings_hint_seen";

/**
 * Android 12 and below have no runtime notification dialog: when notifications are off for the app (EMUI's appop
 * "ignore", 华为 TAS-AL00 API 31, 2026-11-08) a request shows nothing and the lock screen stays empty without a word.
 * So, once, the app says so itself (用户 2026-11-08 决定). Android 13+ keeps its one system dialog and gets no hint.
 */
export function shouldOfferNotifySettings(o: { apiLevel: number; permission: Permission; seen: boolean }): boolean {
  return o.apiLevel < 33 && o.permission !== "granted" && !o.seen;
}

let hintDue = false;
const hintListeners = new Set<() => void>();
function setHintDue(due: boolean): void {
  if (hintDue === due) return;
  hintDue = due;
  hintListeners.forEach((fn) => fn());
}

/** True while the 「锁屏上看不到进度」 sheet is owed (see `shouldOfferNotifySettings`). */
export function useNotifySettingsHint(): boolean {
  return useSyncExternalStore(
    (fn) => {
      hintListeners.add(fn);
      return () => hintListeners.delete(fn);
    },
    () => hintDue,
    () => hintDue
  );
}

/** Either button of the sheet: marked seen for good. */
export function dismissNotifySettingsHint(): void {
  platform().persistent.set(LIVE_HINT_SEEN_KEY, "1");
  setHintDue(false);
}

/**
 * Android 13+ shows nothing until POST_NOTIFICATIONS is granted, and nothing else asks for it in a build without an EAS
 * project (the push primer is offered only with one) — 华为 TAS-AL00, 2026-11-06: the ongoing notification never showed.
 * So the first live progress asks, once, through the push path's own request (same channel first, same EMUI re-read).
 * A refusal is final here: no second dialog, no error. The push primer is marked seen, so the system dialog is not shown
 * twice from two places; a grant registers the device for push as a sign-in would. One request at a time.
 */
async function mayNotify(): Promise<boolean> {
  const now = await permission();
  if (now === "granted") return true;
  const apiLevel = Number(Platform.Version);
  if (shouldOfferNotifySettings({ apiLevel, permission: now, seen: !!platform().persistent.get(LIVE_HINT_SEEN_KEY) })) setHintDue(true);
  // Below 33 there is no dialog to show: the request would only poll for 3 s and come back as it went in.
  if (apiLevel < 33) return false;
  // An update that arrives while the dialog is up waits for its answer rather than asking again.
  if (asking) return asking;
  if (now === "denied" || platform().persistent.get(LIVE_ASKED_KEY)) return false;
  platform().persistent.set(LIVE_ASKED_KEY, "1");
  platform().persistent.set(PRIMER_SEEN_KEY, "1");
  const request = requestPermission().then((answer) => {
    if (answer === "granted") void registerDevice().catch(() => {});
    return answer === "granted";
  });
  asking = request;
  void request.finally(() => (asking = null));
  return request;
}

/** Starts or updates the lock screen's live progress (iOS: the Live Activity, which needs no permission). */
export async function showLiveProgress(c: LiveContent, tint: string): Promise<void> {
  if (Platform.OS === "ios") {
    await ios()?.show(c.title, tint, nativeState(c));
    return;
  }
  if (Platform.OS !== "android") return;
  if (!(await mayNotify())) return;
  const native = android();
  if (native) {
    const { title, body } = androidContent(c);
    await native.notify(c.title, title ?? c.title, body ?? "", c.progress);
    return;
  }
  await Notifications.setNotificationChannelAsync(EXPO_CHANNEL, liveChannel(c.title));
  await Notifications.scheduleNotificationAsync({ identifier: LIVE_NOTIFICATION, content: androidContent(c), trigger: { channelId: EXPO_CHANNEL } });
}

export async function endLiveProgress(): Promise<void> {
  if (Platform.OS === "ios") await ios()?.end();
  else if (Platform.OS === "android") {
    const native = android();
    if (native) await native.end();
    else await Notifications.dismissNotificationAsync(LIVE_NOTIFICATION);
  }
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
    else void showLiveProgress(now, tint).catch(() => {});
  }, [key]);
  // Leaving the signed-in tree (sign-out): the lock screen forgets the soul too.
  useEffect(() => () => void endLiveProgress().catch(() => {}), []);
}
