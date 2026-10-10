/**
 * Push, the officer app's half (the server's is `backend/apps/officer_app/push.py`).
 *
 * The lock screen carries a count and nothing else -- 「有 N 件待你处理」 -- written by the server
 * from a fixed table; `data` is `{category: "officer_todo"}`. This app never puts a name, a case
 * or a soul on the lock screen, and neither does the server. Nothing here throws to a caller.
 */
import { officerAppApi } from "@soulledger/core/api/officer-app";
import { platform } from "@soulledger/core/platform";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { landingOf, type Landing } from "./rules";

/** The Expo token this device last registered -- what sign-out must unregister. */
export const PUSH_TOKEN_KEY = "officer_push_token";

export type Permission = "undetermined" | "denied" | "granted";
export type Registration =
  | { ok: true; token: string }
  | { ok: false; reason: "not_granted" | "no_project_id" | "token_failed" | "server_failed" };

export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === "string" && id ? id : null;
}

export async function permission(): Promise<Permission> {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    return status === "undetermined" || canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "SoulLedger Officers",
      importance: Notifications.AndroidImportance.DEFAULT,
      // The lock screen shows the generic count only, whatever the title/body say.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PRIVATE,
    }).catch(() => {});
  }
}

/** The system dialog. Called from the settings switch, never at launch. */
export async function requestPermission(): Promise<Permission> {
  await ensureAndroidChannel();
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Whatever the system now reports.
  }
  return permission();
}

const PLATFORM = Platform.OS === "ios" ? "IOS" : "ANDROID";

export async function registerDevice(): Promise<Registration> {
  if ((await permission()) !== "granted") return { ok: false, reason: "not_granted" };
  const projectId = easProjectId();
  if (!projectId) return { ok: false, reason: "no_project_id" };
  await ensureAndroidChannel();
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return { ok: false, reason: "token_failed" };
  }
  try {
    await officerAppApi.registerPush({ token, platform: PLATFORM });
  } catch {
    return { ok: false, reason: "server_failed" };
  }
  platform().persistent.set(PUSH_TOKEN_KEY, token);
  return { ok: true, token };
}

export function hasRegisteredDevice(): boolean {
  return !!platform().persistent.get(PUSH_TOKEN_KEY);
}

/** The Expo token this device registered, or undefined (never granted / no projectId): nothing to keep then. */
export function registeredToken(): string | undefined {
  return platform().persistent.get(PUSH_TOKEN_KEY) || undefined;
}

/** MUST run while the officer's tokens are still stored: the endpoint is authenticated. Never throws. */
export async function unregisterDevice(): Promise<void> {
  const token = platform().persistent.get(PUSH_TOKEN_KEY);
  if (!token) return;
  platform().persistent.remove(PUSH_TOKEN_KEY);
  await officerAppApi.unregisterPush(token).catch(() => {});
}

/** A notification arriving while the app is open still shows its banner (the text is the generic count). */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/**
 * Calls `onLand` for a tapped notification: one that opened the app (the last response) and every
 * later one. A response whose payload names nowhere is ignored.
 */
export function listenForLandings(onLand: (landing: Landing) => void): () => void {
  let alive = true;
  const handle = (data: unknown) => {
    const landing = landingOf(data);
    if (alive && landing) onLand(landing);
  };
  void Notifications.getLastNotificationResponseAsync()
    .then((last) => {
      if (last) {
        handle(last.notification.request.content.data);
        Notifications.clearLastNotificationResponse?.();
      }
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((response) => handle(response.notification.request.content.data));
  return () => {
    alive = false;
    sub.remove();
  };
}
