/**
 * What this phone keeps so the sign-in page need not be typed (第二十批), and the only door to it.
 *
 *   persistent (not secret)   the last account -- its soul code and name --, whether 面容 / 指纹 login is on,
 *                             and, per soul code, that 「下次用面容登录？」 has been asked
 *   secure store, by biometry the device-login credential. `requireAuthentication` makes the system verify the
 *                             face / finger to hand it over, and the key dies when the enrolled set changes
 *                             (iOS `biometryCurrentSet`, Android invalidated-by-enrolment) -- that is E4.
 *
 * The password is stored nowhere. A credential is a server-issued secret for this phone only; the server counts
 * one per call, so turning it on again revokes the old one first.
 */
import { soulApi } from "@soulledger/core/api/soul";
import { BIO_KEY } from "./loginRules";
import { deviceCredential, resetBiometryCache } from "./deviceCredential";
import { storedLocale, translate } from "./i18n";
import { platform } from "@soulledger/core/platform";

export { CredentialStoreError, readBiometry, type Biometry, type CredentialRead } from "./deviceCredential";

export const ACCOUNT_KEY = "soulledger.login.account";
export { BIO_KEY };
/** 切回 App 时也要验证 (第二十八批 S2): on this phone only, and only while 面容 / 指纹 login is on. */
export const APP_LOCK_KEY = "soulledger.login.app_lock";
export const ASKED_PREFIX = "soulledger.login.bio_asked.";

// ── the remembered account ───────────────────────────────────────────────

export interface RememberedAccount {
  code: string;
  name: string;
}

export function rememberedAccount(): RememberedAccount | null {
  try {
    const value: unknown = JSON.parse(platform().persistent.get(ACCOUNT_KEY) ?? "null");
    const v = value as Partial<RememberedAccount> | null;
    return v && typeof v.code === "string" && v.code && typeof v.name === "string" ? { code: v.code, name: v.name } : null;
  } catch {
    return null;
  }
}

export function rememberAccount(code: string, name: string): void {
  platform().persistent.set(ACCOUNT_KEY, JSON.stringify({ code, name }));
}

/** 「换一个账号」: the number and name go; the 面容 / 指纹 credential is `revokeCredential`'s. */
export const forgetAccount = () => platform().persistent.remove(ACCOUNT_KEY);

// ── 「下次用面容登录？」 ──────────────────────────────────────────────────

export const wasAsked = (code: string) => platform().persistent.get(ASKED_PREFIX + code) === "1";
export const markAsked = (code: string) => platform().persistent.set(ASKED_PREFIX + code, "1");

// ── the credential (`deviceCredential.ts`, shared with the officer app's 指纹登录) ──────────────────────

const soul = deviceCredential({
  credentialKey: "soulledger_device_login",
  service: "soulledger.devicelogin",
  bioKey: BIO_KEY,
  // The reason the system shows with its face / finger check, in the app's language (review 2026-11-01).
  promptKey: "soul_app.biometric.prompt_login",
  /** 切回 App 时也要验证 (第二十八批 S2): its own switch, on this phone only, and only while 面容 / 指纹 login is on. */
  appLockKey: APP_LOCK_KEY,
  // Late-bound, so a test that replaces `soulApi`'s methods is the one called.
  enable: (password) => soulApi.enableDeviceLogin(password),
  revoke: (credential) => soulApi.revokeDeviceLogin(credential),
});

export const {
  /** On when the flag holds anything: `face` or `finger` (what the phone said when it was turned on). */
  bioEnabled,
  /** What was read last in this process, or what the phone said when 面容 / 指纹 was turned on. Sync. */
  knownBiometry,
  readCredential,
  storeCredential,
  /** The app locks on return from the background: the switch is on AND 面容 / 指纹 login still is. */
  appLockOn,
  clearCredential,
  revokeCredential,
  enableWithPassword,
} = soul;

/** Same kind of string as the sign-in prompt, for 「导出我的资料」: the face / finger check stands in for the password there. */
export const exportPrompt = () => translate(storedLocale(), "soul_app.biometric.prompt_export");

// ── the first sign-in page of the process ────────────────────────────────

let autoPromptSpent = false;
/** True until the sign-in page has asked once, or any session has been signed in, in this process. */
export const isColdStart = () => !autoPromptSpent;
export const spendAutoPrompt = () => void (autoPromptSpent = true);
/** For tests: a fresh process. */
export const resetColdStart = () => {
  autoPromptSpent = false;
  resetBiometryCache();
};
