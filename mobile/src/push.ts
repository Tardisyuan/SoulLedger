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
import { soulApi } from "@soulledger/core/api/soul";
import { LOCALE_COOKIE, isLocale } from "@soulledger/core/config/locale";
import { platform } from "@soulledger/core/platform";

import type { NavigationProp } from "@react-navigation/native";

import type { AppStackParams, LifeFocus } from "./navTypes";
import { pushCore } from "./pushCore";
import { SENTENCE_PUSH_KINDS, type SentenceLanding, type SentencePushKind } from "./sentenceKinds";

export { easProjectId, installNotificationHandler, permission, type Permission, type Registration } from "./pushCore";

/** The Expo token this device last registered — what sign-out must unregister. */
export const PUSH_TOKEN_KEY = "soul_push_token";
/** The permission primer is offered once; "not now" does not call the system API. */
export const PRIMER_SEEN_KEY = "soul_push_primer_seen";

/**
 * The Android channel every soul push lands on; the backend names it on each message
 * (`backend/apps/soul_push/services.py::ANDROID_CHANNEL_ID`, keep the two equal).
 *
 * Not "default": Android lets a channel's lock-screen visibility be set only when the channel is created, so a
 * phone that made "default" before RBAC A9 kept showing content on the lock screen. A new id is a new channel,
 * created PRIVATE on every phone; the old one is deleted so the settings screen does not list a dead channel.
 */
export const ANDROID_CHANNEL_ID = "default-v2";

/**
 * Permission, registration (idempotent on the server: it runs on every sign-in, every cold start and every token
 * change) and sign-out's unregistration -- the shared core (`pushCore.ts`) with this app's key, channel and endpoints.
 */
export const { requestPermission, registerDevice, hasRegisteredDevice, unregisterDevice } = pushCore({
  tokenKey: PUSH_TOKEN_KEY,
  channel: { id: ANDROID_CHANNEL_ID, name: "SoulLedger", retired: ["default"] },
  register: (token, device) => soulApi.registerPushToken(token, device),
  unregister: (token) => soulApi.unregisterPushToken(token),
});

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
    // 第六十二批:超度之后枉死城那件事已办完,落在「已超度」那一行,不落审判那格(不洗底色)。
    if (kind === "wangsi_delivered") return { screen, focus: { delivered: true } };
    const focus: LifeFocus = {
      ...(typeof judgment === "string" && ID.test(judgment) ? { judgment } : {}),
      ...(typeof disposition === "string" && ID.test(disposition) ? { disposition } : {}),
      ...(RESIDENCE_KINDS.includes(kind) ? { residence: true } : {}),
    };
    return Object.keys(focus).length ? { screen, focus } : { screen };
  }
  return null;
}
