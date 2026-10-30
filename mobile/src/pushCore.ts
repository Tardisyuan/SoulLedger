/**
 * The push plumbing both apps share (cq-apps 2026-10-30 #6): permission, the Android channel, the
 * Expo token, registration and sign-out unregistration. Each app's `push.ts` supplies only what
 * differs -- where the token is kept, its channel, and its two endpoints -- and keeps its own
 * landings. The two copies had drifted: the officer's channel read `AndroidNotificationVisibility?.PRIVATE`
 * (only because its jest double lacked the enum) and the two unregistered in opposite orders.
 *
 * A leaf: no session, no screen, so the officer app can import it (`sharedClosure.test.ts`).
 * Nothing here throws to a caller.
 */
import { platform } from "@soulledger/core/platform";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type Permission = "undetermined" | "denied" | "granted";

export type Registration =
  | { ok: true; token: string }
  | { ok: false; reason: "not_granted" | "no_project_id" | "token_failed" | "server_failed" };

export type DevicePlatform = "IOS" | "ANDROID";

/** The EAS project this build belongs to; `null` in a development build that has none. */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === "string" && id ? id : null;
}

export async function permission(): Promise<Permission> {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    // Android 13+ reports a never-asked app as "denied" (notifications are off until
    // granted); only canAskAgain tells it apart from a real refusal.
    return status === "undetermined" || canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * EMUI (Android 12, phone QA 10-29b): `requestPermissionsAsync` can come back before the user has answered its
 * dialog, and the status read then is still "undetermined" -- which is not a refusal. So an undetermined answer is
 * read again a few times, a moment apart, before it is returned; the caller says "not answered yet", never "denied".
 */
const RECHECKS = 6;
const RECHECK_MS = 500;
async function answered(): Promise<Permission> {
  // ponytail: a fixed 3 s of polling; an AppState wait if a phone turns out to need longer.
  for (let i = 0; i < RECHECKS; i++) {
    const now = await permission();
    if (now !== "undetermined") return now;
    await new Promise((r) => setTimeout(r, RECHECK_MS));
  }
  return permission();
}

/** A notification arriving while the app is open still shows its banner. */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

const PLATFORM: DevicePlatform = Platform.OS === "ios" ? "IOS" : "ANDROID";

export interface PushConfig {
  /** Where this device's registered Expo token is kept -- what sign-out must unregister. */
  tokenKey: string;
  /** The Android channel; `retired` ids are deleted so the system settings list no dead channel. */
  channel: { id: string; name: string; retired?: readonly string[] };
  register: (token: string, platform: DevicePlatform) => Promise<unknown>;
  unregister: (token: string) => Promise<unknown>;
}

export function pushCore({ tokenKey, channel, register, unregister }: PushConfig) {
  /** Registrations that reached the server, so an unregister can tell a sign-in that happened under it. */
  let registrations = 0;

  async function ensureAndroidChannel(): Promise<void> {
    // Android 13+ shows the permission dialog only once a channel exists.
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance.DEFAULT,
      // The lock screen says only that something came (RBAC A9), whatever the title / body say.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => {});
    for (const id of channel.retired ?? []) await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
  }

  return {
    /** The system dialog. Only ever called from an explicit "yes" (a primer, a settings switch), never at launch. */
    async requestPermission(): Promise<Permission> {
      // The channel first: Android 13+ shows the dialog only once one exists.
      await ensureAndroidChannel();
      try {
        await Notifications.requestPermissionsAsync();
      } catch {
        // Treated as whatever the system now reports.
      }
      return answered();
    },

    /** Register this device for the signed-in account, if it can be. Idempotent on the server. */
    async registerDevice(): Promise<Registration> {
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
        await register(token, PLATFORM);
      } catch {
        return { ok: false, reason: "server_failed" };
      }
      registrations += 1;
      platform().persistent.set(tokenKey, token);
      return { ok: true, token };
    },

    hasRegisteredDevice(): boolean {
      return !!platform().persistent.get(tokenKey);
    },

    /** The Expo token this device registered, or undefined (never granted / no projectId). */
    registeredToken(): string | undefined {
      return platform().persistent.get(tokenKey) || undefined;
    },

    /**
     * Stop pushes to this device. MUST run while the account's tokens are still stored -- the endpoint is
     * authenticated. Never throws. The server is asked FIRST and the local copy cleared after (officer A16),
     * so the token is still there while the request is out; a failed request is not retried (forgotten either
     * way). If a sign-in registered again while the request was out, the local copy is that registration's
     * and stays -- clearing it would leave the next sign-out with nothing to unregister.
     */
    async unregisterDevice(): Promise<void> {
      const token = platform().persistent.get(tokenKey);
      if (!token) return;
      const seen = registrations;
      await unregister(token).catch(() => {});
      if (registrations === seen) platform().persistent.remove(tokenKey);
    },
  };
}
