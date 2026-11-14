/**
 * What this phone keeps so the sign-in page need not be typed (第二十批), and the only door to it.
 *
 *   persistent (not secret)   the last account -- its soul code and name --, whether 面容 / 指纹 login is on,
 *                             and, per soul code, how many times 「下次用面容登录？」 has been answered
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
/**
 * 切回 App 时也要验证 (第二十八批 S2): on this phone only, and only while 面容 / 指纹 login is on. `"0"` = the soul turned it
 * off, `"1"` = turned it on, absent = never touched, which counts as on (2026-11-15: soul refresh tokens now last 30
 * days, so a phone with 面容 / 指纹 login locks by default). An explicit off outlives turning 面容 / 指纹 login off and on.
 */
export const APP_LOCK_KEY = "soulledger.login.app_lock";
export const ASKED_PREFIX = "soulledger.login.bio_asked.";

// ── the remembered accounts (Design 第五十批 C4) ──────────────────────────

export interface RememberedAccount {
  code: string;
  name: string;
}

/** At most this many numbers; the sixth to sign in pushes out the one used longest ago, without a word. */
export const ACCOUNTS_KEPT = 5;
/**
 * Whose number the 面容 / 指纹 credential belongs to: there is one credential per phone, issued to whoever turned it on.
 * Absent on a phone that turned it on before numbers were a list: then it is the one number remembered (see
 * `bioOwner`), and it is pinned here the moment a second number arrives.
 */
export const BIO_OWNER_KEY = "soulledger.login.bio_owner";

const isAccount = (v: unknown): v is RememberedAccount => {
  const a = v as Partial<RememberedAccount> | null;
  return !!a && typeof a.code === "string" && !!a.code && typeof a.name === "string";
};

/**
 * The numbers this phone remembers, the one used last first. Stored under ACCOUNT_KEY as a list; the single
 * `{code, name}` an older build kept there reads as a list of one (and is written back as a list on the next change).
 */
export function rememberedAccounts(): RememberedAccount[] {
  try {
    const value: unknown = JSON.parse(platform().persistent.get(ACCOUNT_KEY) ?? "null");
    const list = Array.isArray(value) ? value : [value];
    return list.filter(isAccount).map(({ code, name }) => ({ code, name }));
  } catch {
    return [];
  }
}

/** The number used last (the sign-in card's, when only one is remembered). */
export const rememberedAccount = (): RememberedAccount | null => rememberedAccounts()[0] ?? null;

const writeAccounts = (list: RememberedAccount[]) =>
  list.length ? platform().persistent.set(ACCOUNT_KEY, JSON.stringify(list)) : platform().persistent.remove(ACCOUNT_KEY);

/** This number signed in: it goes first. An empty name keeps the one already remembered for it. */
export function rememberAccount(code: string, name: string): void {
  const list = rememberedAccounts();
  const before = list.find((a) => a.code === code);
  // A second number arriving on a phone whose credential predates the list: the credential is the first number's.
  if (!before && list.length === 1 && bioEnabled() && !platform().persistent.get(BIO_OWNER_KEY)) platform().persistent.set(BIO_OWNER_KEY, list[0].code);
  writeAccounts([{ code, name: name || before?.name || "" }, ...list.filter((a) => a.code !== code)].slice(0, ACCOUNTS_KEPT));
}

/** 「换一个账号」 / 「忘掉这个编号」: that number (the last used one by default) and its name go. The credential is `forgetNumber`'s. */
export function forgetAccount(code = rememberedAccount()?.code): void {
  writeAccounts(rememberedAccounts().filter((a) => a.code !== code));
}

/** The number the 面容 / 指纹 credential on this phone belongs to, or null when it is off. */
export function bioOwner(): string | null {
  if (!bioEnabled()) return null;
  const pinned = platform().persistent.get(BIO_OWNER_KEY);
  if (pinned) return pinned;
  const list = rememberedAccounts();
  return list.length === 1 ? list[0].code : null;
}

/**
 * 「忘掉这个编号」 (C4): the phone stops remembering it; if the credential is that number's, it is revoked on the server
 * too (「这个编号的面容登录也会关掉」). Another number's credential is left alone.
 */
export async function forgetNumber(code: string): Promise<void> {
  if (bioOwner() === code) await revokeCredential();
  forgetAccount(code);
}

// ── 「下次用面容登录？」 ──────────────────────────────────────────────────

/**
 * Asked at most twice per number (S3, 2026-11-15): the value is how many times it has been answered (an older build's
 * `"1"` reads as once). 「以后再说」 the first time leaves one more ask, at a later password sign-in; turning 面容 / 指纹
 * login off in 设置 ends it at once (`markAskedForGood`).
 */
export const BIO_ASKS = 2;
const askCount = (code: string) => Number(platform().persistent.get(ASKED_PREFIX + code) ?? 0) || 0;
export const wasAsked = (code: string) => askCount(code) >= BIO_ASKS;
export const markAsked = (code: string) => platform().persistent.set(ASKED_PREFIX + code, String(Math.min(askCount(code) + 1, BIO_ASKS)));
export const markAskedForGood = (code: string) => platform().persistent.set(ASKED_PREFIX + code, String(BIO_ASKS));

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
} = soul;

/** The credential went: so does the record of whose it was. */
export const clearCredential = () => {
  soul.clearCredential();
  platform().persistent.remove(BIO_OWNER_KEY);
};
export const revokeCredential = async () => {
  await soul.revokeCredential();
  platform().persistent.remove(BIO_OWNER_KEY);
};
/** Turned on while signed in: the credential is the signed-in number's, which `land()` put first in the list. */
export const enableWithPassword = async (password: string) => {
  await soul.enableWithPassword(password);
  const me = rememberedAccount()?.code;
  if (me) platform().persistent.set(BIO_OWNER_KEY, me);
};

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
