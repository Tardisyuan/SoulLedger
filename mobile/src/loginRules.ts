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
  if (next.startsWith(prev)) return acceptSoulCodeInput(prev, next.slice(prev.length));
  if (prev.startsWith(next)) return { value: next, problem: null };
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
 */
export function shouldAskBio(o: { hasPassword: boolean; enrolled: boolean; enabled: boolean; asked: boolean }): boolean {
  return o.hasPassword && o.enrolled && !o.enabled && !o.asked;
}

/**
 * How a failed read of the stored credential ends. The message strings are the native modules' (iOS Keychain /
 * Android Keystore + BiometricPrompt); they have not been seen on a device from here -- the classes are the ones
 * Design needs: the soul walked away (stay on the page, do not ask again), the system said no (show the password
 * box), the key is gone because the phone's face / fingerprint set changed (E4).
 */
export type CredentialFailure = "cancelled" | "invalidated" | "failed";

export function classifyCredentialError(error: unknown): CredentialFailure {
  const text = `${(error as { code?: unknown } | null)?.code ?? ""} ${(error as { message?: unknown } | null)?.message ?? String(error)}`;
  if (/invalidat|permanently|enrol|key.{0,20}(not found|missing|unusable)/i.test(text)) return "invalidated";
  if (/cancel|dismiss|-128|user_cancel|negative button/i.test(text)) return "cancelled";
  return "failed";
}
