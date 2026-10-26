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
import { LOCALE_COOKIE, isLocale } from "@soulledger/core/config/locale";
import { platform } from "@soulledger/core/platform";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { NavigationProp } from "@react-navigation/native";

import type { AppStackParams, LifeFocus } from "./screens/applications";
import { SENTENCE_PUSH_KINDS, type SentenceLanding, type SentencePushKind } from "./sentenceKinds";

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
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    // Android 13+ reports a never-asked app as "denied" (notifications are off until
    // granted); only canAskAgain tells it apart from a real refusal.
    return status === "undetermined" || canAskAgain ? "undetermined" : "denied";
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
  // Only a language this device was told about: with none stored, the account's
  // is adopted at sign-in (session.tsx) and writing the default here would erase it.
  const locale = platform().persistent.get(LOCALE_COOKIE);
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

export type Landing =
  | { screen: "ApplicationDetail"; id: string }
  | { screen: "Conversation"; id: string }
  | { screen: "CirclePost"; id: string; comment?: string }
  | { screen: "Life"; focus?: LifeFocus }
  | { screen: "Applications" }
  | { screen: "DataExport" }
  | { screen: "Mfa" }
  | { screen: "Sentence"; landing: SentenceLanding };

/**
 * Go where a landing points. The push bridge (a tapped notification) and the
 * notification history (a tapped row) both route through here, so a new kind
 * of landing is added once.
 */
export function landOn(navigate: NavigationProp<AppStackParams>["navigate"], landing: Landing): void {
  if (landing.screen === "ApplicationDetail") navigate("ApplicationDetail", { id: landing.id, landed: true });
  else if (landing.screen === "Conversation") navigate("Conversation", { id: landing.id, landed: true });
  // 被殿司警告: the post it was about (a comment's post). The author sees their own post even when hidden.
  // A comment / reply (第四十批 S-a): the post, scrolled to that comment and washed.
  else if (landing.screen === "CirclePost") navigate("CirclePost", landing.comment ? { id: landing.id, comment: landing.comment } : { id: landing.id });
  // 受刑 1d: completion lands on the life page's section (the new 「可申请转生」 row is there); the rest on the full list.
  else if (landing.screen === "Sentence" && landing.landing.kind === "sentence_completed")
    navigate("Tabs", { screen: "Life", params: { sentenceLanding: landing.landing } });
  else if (landing.screen === "Sentence") navigate("Sentence", { landing: landing.landing });
  // 缩短冷却的决定(cooldown_shortening_*)落在申请页;两条分支合并时这一支只进了 navigation.tsx 的旧写法。
  else if (landing.screen === "Applications") navigate("Tabs", { screen: "Applications", params: { landed: true } });
  // 「资料已准备好」: the page that holds the share button.
  else if (landing.screen === "DataExport") navigate("DataExport");
  // 官员替灵魂关了两步验证: the page that shows it is off (and turns it back on).
  else if (landing.screen === "Mfa") navigate("Mfa");
  // 第四十批 S-e: a judgment's result, a disposition carried out, a residence — that row on the life page, washed.
  else if (landing.screen === "Life" && landing.focus) navigate("Tabs", { screen: "Life", params: { lifeFocus: landing.focus } });
  else navigate("Tabs", { screen: "Life" });
}

/** The residence pushes land on the 「暂居 · 原属」 block (第四十批 S-e); returning ends it, so there is none to wash. */
const RESIDENCE_KINDS: readonly unknown[] = ["residence_approved", "residence_started"];

/** An application id as the server sends it (a UUID); anything else is not navigated to. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a tapped notification lands, from its `data` — or `null`: just open the app. */
export function landingOf(data: unknown): Landing | null {
  if (!data || typeof data !== "object") return null;
  const {
    screen,
    application_id: id,
    conversation_id: conversation,
    post_id: post,
    comment_id: comment,
    judgment_id: judgment,
    disposition_id: disposition,
    kind,
    node_ids: nodes,
  } = data as Record<string, unknown>;
  if (screen === "ApplicationDetail") return typeof id === "string" && ID.test(id) ? { screen, id } : { screen: "Life" };
  // Reserved: the server sends no chat push yet (no Synapse → push path; see the round's report).
  // A malformed id opens the app and no more — a letter is not worth guessing at.
  if (screen === "Conversation") return typeof conversation === "string" && ID.test(conversation) ? { screen, id: conversation } : null;
  // 被殿司警告: a malformed post id still lands on the life page, like an application's.
  // A comment / reply names its comment too; a malformed one still opens the post, just without the wash.
  if (screen === "CirclePost") {
    if (typeof post !== "string" || !ID.test(post)) return { screen: "Life" };
    return typeof comment === "string" && ID.test(comment) ? { screen, id: post, comment } : { screen, id: post };
  }
  // 缩短冷却申请的结果:状态在转生申请页的冷却块里。
  if (screen === "Applications") return { screen };
  if (screen === "DataExport" || screen === "Mfa") return { screen };
  if (screen === "Life") {
    // 受刑 1d: the four sentence pushes say `screen: Life` (an older app still lands there) and are
    // told apart by `kind`; `node_ids` names the stations to mark 「新」. A malformed id is dropped, not guessed at.
    if ((SENTENCE_PUSH_KINDS as readonly unknown[]).includes(kind)) {
      const nodeIds = Array.isArray(nodes) ? nodes.filter((n): n is string => typeof n === "string" && ID.test(n)) : [];
      return { screen: "Sentence", landing: { kind: kind as SentencePushKind, nodeIds } };
    }
    const focus: LifeFocus = {
      ...(typeof judgment === "string" && ID.test(judgment) ? { judgment } : {}),
      ...(typeof disposition === "string" && ID.test(disposition) ? { disposition } : {}),
      ...(RESIDENCE_KINDS.includes(kind) ? { residence: true } : {}),
    };
    return Object.keys(focus).length ? { screen, focus } : { screen };
  }
  return null;
}
