/**
 * Push notifications, the app's half (the server's is `backend/apps/soul_push`).
 *
 * Nothing here throws to a caller: a push that cannot be set up is a state the
 * settings page reports ("推送暂未启用" / "系统已关闭通知"), never an error
 * screen. In particular, without an EAS `projectId` there is no Expo push token
 * to get — that is the development build's normal state, not a failure.
 *
 * The lock screen carries a title and a body the SERVER wrote from a fixed
 * table; `data` carries only `{screen, application_id?, kind}`. The app routes
 * by `screen` alone, so a `kind` it has never heard of (another branch adds
 * kinds) lands exactly where its `screen` says, and an unknown `screen` lands
 * nowhere — the app simply opens.
 */
import { soulApi, type PushPlatform } from "@soulledger/core/api/soul";
import { isLocale } from "@soulledger/core/config/locale";
import { getLocale, platform } from "@soulledger/core/platform";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** The Expo token this device last registered — what sign-out must unregister. */
export const PUSH_TOKEN_KEY = "soul_push_token";
/** The permission primer is offered once; "not now" does not call the system API. */
export const PRIMER_SEEN_KEY = "soul_push_primer_seen";

export type Permission = "undetermined" | "denied" | "granted";

export type Registration =
  | { ok: true; token: string }
  | { ok: false; reason: "not_granted" | "no_project_id" | "token_failed" | "server_failed" };

/** The EAS project this build belongs to; `null` in a development build that has none. */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === "string" && id ? id : null;
}

export async function permission(): Promise<Permission> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted" ? "granted" : status === "undetermined" ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

async function ensureAndroidChannel(): Promise<void> {
  // Android 13+ shows the permission dialog only once a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "SoulLedger",
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
}

/** The system dialog. Only ever called from the primer's "yes". */
export async function requestPermission(): Promise<Permission> {
  await ensureAndroidChannel();
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Treated as whatever the system now reports.
  }
  return permission();
}

const PLATFORM: PushPlatform = Platform.OS === "ios" ? "IOS" : "ANDROID";

/**
 * Register this device for the signed-in soul, if it can be. Idempotent on the
 * server, so it runs on every sign-in, every cold start and every token change.
 */
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
    await soulApi.registerPushToken(token, PLATFORM);
  } catch {
    return { ok: false, reason: "server_failed" };
  }
  platform().persistent.set(PUSH_TOKEN_KEY, token);
  return { ok: true, token };
}

export function hasRegisteredDevice(): boolean {
  return !!platform().persistent.get(PUSH_TOKEN_KEY);
}

/**
 * Stop pushes to this device for this soul. MUST run while the soul's tokens
 * are still stored — the endpoint is authenticated. Never throws.
 */
export async function unregisterDevice(): Promise<void> {
  const token = platform().persistent.get(PUSH_TOKEN_KEY);
  if (!token) return;
  platform().persistent.remove(PUSH_TOKEN_KEY);
  await soulApi.unregisterPushToken(token).catch(() => {});
}

/**
 * The server writes the lock-screen text in the account's `locale`; keep it
 * the interface language this device shows. Runs at sign-in (the language may
 * have been picked on the login screen); the settings page saves its own
 * changes. Never throws.
 */
export async function syncPushLocale(): Promise<void> {
  const locale = getLocale();
  if (!isLocale(locale)) return;
  try {
    const settings = await soulApi.notificationSettings();
    if (settings.locale !== locale) await soulApi.updateNotificationSettings({ locale });
  } catch {
    // Retried at the next sign-in or language change.
  }
}

/** A notification arriving while the app is open still shows its banner. */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export type Landing = { screen: "ApplicationDetail"; id: string } | { screen: "Life" };

/** An application id as the server sends it (a UUID); anything else is not navigated to. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a tapped notification lands, from its `data` — or `null`: just open the app. */
export function landingOf(data: unknown): Landing | null {
  if (!data || typeof data !== "object") return null;
  const { screen, application_id: id } = data as Record<string, unknown>;
  if (screen === "ApplicationDetail") return typeof id === "string" && ID.test(id) ? { screen, id } : { screen: "Life" };
  if (screen === "Life") return { screen };
  return null;
}
