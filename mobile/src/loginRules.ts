/**
 * The decisions behind the sign-in page, without the drawing (第二十批): what a soul-code box does with what is
 * typed, which of the four 「失效」 notices a refusal means, whether the system prompt opens by itself, whether the
 * 「下次用面容登录？」 question is due, and how a failed read of the stored credential is told apart.
 */
import { SOUL_CODE_LENGTH, acceptSoulCodeInput, type SoulCodeInputResult, type SoulCodeProblem } from "@soulledger/core/domain/soulCode";

// ── the soul-code box ────────────────────────────────────────────────────

/**
 * The box's text arrives as the whole new value (the hidden TextInput holds the 10 raw characters). Work out what
 * was typed: appended text is the typing; a shorter value that is a prefix is a deletion (no problem); anything
 * else (a paste over a selection, a replace) is read as a paste into an empty box.
 */
export function soulCodeStep(prev: string, next: string): SoulCodeInputResult {
  // Compared without case: the box holds capitals, but a hardware keyboard (or a keyboard that ignores
  // autoCapitalize) sends the field's own lower-case text back, and one wrong letter then read as a paste.
  const [was, now] = [prev.toUpperCase(), next.toUpperCase()];
  if (now.startsWith(was)) return acceptSoulCodeInput(prev, next.slice(prev.length));
  if (was.startsWith(now)) return { value: prev.slice(0, next.length), problem: null };
  const replaced = acceptSoulCodeInput("", next);
  // A refused replacement leaves the box as it was.
  return replaced.problem ? { value: prev, problem: replaced.problem } : replaced;
}

/** The key of the first line of a refused character; `bad_char` also has a second line and a `{{c}}`. */
export const SOUL_CODE_PROBLEM_KEY: Record<SoulCodeProblem, string> = {
  bad_char: "soul_app.login.bad_char",
  bad_symbol: "soul_app.login.bad_symbol",
  bad_paste: "soul_app.login.bad_paste",
};

export const soulCodeComplete = (code: string) => code.length === SOUL_CODE_LENGTH;

/** 「登录」 is pressable with a full code and a password, and not while a request is out. */
export const canSubmitLogin = (code: string, password: string, busy: boolean) =>
  soulCodeComplete(code) && password.length > 0 && !busy;

/** How long 「这不是灵魂簿交付单上的码」 stays up after the last bad scan. */
export const INVALID_BANNER_MS = 4000;

// ── 失效 ─────────────────────────────────────────────────────────────────

export type Lapse = "pw_changed" | "reset" | "reborn" | "bio_changed";

/**
 * `device_login_revoked`'s reason → the notice. `turned_off` (this phone's credential was closed from somewhere
 * else) and a reason this App does not know are the phone's own business: the biometric one.
 */
export function lapseOfReason(reason: string | null): Lapse {
  switch (reason) {
    case "password_changed":
      return "pw_changed";
    case "password_reset_by_officer":
      return "reset";
    case "account_reincarnated":
      return "reborn";
    default:
      return "bio_changed";
  }
}

export const LAPSE_KEYS: Record<Lapse, { title: string; body: string }> = {
  pw_changed: { title: "soul_app.login.lapsed.pw_changed", body: "soul_app.login.lapsed.pw_changed_body" },
  reset: { title: "soul_app.login.lapsed.reset", body: "soul_app.login.lapsed.reset_body" },
  reborn: { title: "soul_app.login.lapsed.reborn", body: "soul_app.login.lapsed.reborn_body" },
  bio_changed: { title: "soul_app.login.lapsed.bio_changed", body: "soul_app.login.lapsed.bio_changed_body" },
};

// ── the system prompt ────────────────────────────────────────────────────

/**
 * The system verification opens by itself ONLY on a cold start (the first sign-in page of this process), only once,
 * and never after the soul has cancelled it or a notice is up. Coming back from the background does not remount the page.
 */
export function shouldAutoPrompt(o: { enabled: boolean; coldStart: boolean; cancelled: boolean; lapsed: Lapse | null }): boolean {
  return o.enabled && o.coldStart && !o.cancelled && o.lapsed === null;
}

/**
 * The 「下次用面容登录？」 sheet: only when there is a password to turn it on with (this very sign-in or password
 * change), the phone has a face or finger enrolled, it is not on already, and the soul has not said 「以后再说」.
 * Never over the welcome (the first scene of entering a civilization): it waits, and waiting is not answering.
 */
export function shouldAskBio(o: { hasPassword: boolean; enrolled: boolean; enabled: boolean; asked: boolean; welcomePending: boolean }): boolean {
  return o.hasPassword && o.enrolled && !o.enabled && !o.asked && !o.welcomePending;
}

/**
 * How a failed read of the stored credential ends. The message strings are the native modules' (iOS Keychain /
 * Android Keystore + BiometricPrompt); they have not been seen on a device from here -- the classes are the ones
 * Design needs: the soul walked away (stay on the page, do not ask again), the system said no (show the password
 * box), the key is gone because the phone's face / fingerprint set changed (E4).
 */
export type CredentialFailure = "cancelled" | "invalidated" | "locked" | "failed";

export function classifyCredentialError(error: unknown): CredentialFailure {
  const text = `${(error as { code?: unknown } | null)?.code ?? ""} ${(error as { message?: unknown } | null)?.message ?? String(error)}`;
  // Too many tries: the system refuses at once, without a prompt, until it lifts the lock. Seen on a Huawei
  // (Android 12, 2026-10-16): "Could not Authenticate the user: Lockout. 操作过于频繁，请稍后再试". Before "invalidated"
  // because a permanent lockout's text can say "permanently" and the key is still good.
  if (/lockout|too many attempts/i.test(text)) return "locked";
  if (/invalidat|permanently|enrol|key.{0,20}(not found|missing|unusable)/i.test(text)) return "invalidated";
  if (/cancel|dismiss|-128|user_cancel|negative button/i.test(text)) return "cancelled";
  return "failed";
}

/**
 * iOS gives a biometry lockout (too many misses; it lifts when the phone is unlocked with its passcode) the same
 * text as an ordinary miss -- "Authentication failed. Provided passphrase/PIN is incorrect ..." (iPhone 15 Pro Max,
 * 2026-10-16) -- but returns it at once, with no Face ID animation. A real miss takes the scan: seconds.
 * ponytail: a timing threshold, not an API; if iOS ever answers a real miss this fast, ask LocalAuthentication.
 */
export const IOS_LOCKOUT_MS = 800;
export function credentialReadFailure(error: unknown, elapsedMs: number, os: string): CredentialFailure {
  const failure = classifyCredentialError(error);
  if (os !== "ios") return failure;
  if (failure === "failed" && elapsedMs < IOS_LOCKOUT_MS) return "locked";
  // After a miss, iOS's own sheet says 「面容未能识别」 and waits on 「再次尝试 / 取消」; 取消 comes back as a cancel,
  // not a failure, so the page stayed silent and the soul tapped again into the next miss (iPhone, 2026-10-16:
  // three silent rounds, then the lock). A cancel after the sheet was up is read as the miss it almost always is.
  if (failure === "cancelled" && elapsedMs >= IOS_LOCKOUT_MS) return "failed";
  return failure;
}

/** Where "面容 / 指纹 login is on" is kept on the phone: `face` or `finger`. Here, not in deviceLogin, so a module
 *  the officer app shares (feedback) can read it without pulling in the native credential store. */
export const BIO_KEY = "soulledger.login.bio";

/** The sign-out sheet's body (Design 第二十二批): what the next sign-in takes on this phone. */
export function logoutBody(bio: string | null | undefined): { key: string; bioKey: string | null } {
  if (bio === "face") return { key: "soul_app.logout.body_bio", bioKey: "soul_app.bio.face" };
  if (bio === "finger") return { key: "soul_app.logout.body_bio", bioKey: "soul_app.bio.finger" };
  return { key: "soul_app.logout.body", bioKey: null };
}
