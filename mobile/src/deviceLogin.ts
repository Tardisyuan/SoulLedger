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
import { platform } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import { classifyCredentialError, type CredentialFailure } from "./loginRules";

export const ACCOUNT_KEY = "soulledger.login.account";
export { BIO_KEY };
/** 切回 App 时也要验证 (第二十八批 S2): on this phone only, and only while 面容 / 指纹 login is on. */
export const APP_LOCK_KEY = "soulledger.login.app_lock";
export const ASKED_PREFIX = "soulledger.login.bio_asked.";
const CREDENTIAL_KEY = "soulledger_device_login";
const SERVICE = "soulledger.devicelogin";

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

// ── the phone's face / finger ────────────────────────────────────────────

export interface Biometry {
  /** Hardware present AND at least one face or finger enrolled. */
  enrolled: boolean;
  /** The word: face when the phone does face recognition, else finger. */
  wordKey: "soul_app.bio.face" | "soul_app.bio.finger";
}

let cached: Biometry | null = null;

/** What was read last in this process, or -- when 面容 / 指纹 is on -- what the phone said when it was turned on. Sync, so a page can say the right word on its first frame. */
export function knownBiometry(): Biometry | null {
  if (cached) return cached;
  const kind = platform().persistent.get(BIO_KEY);
  return kind === "face" || kind === "finger"
    ? { enrolled: true, wordKey: kind === "face" ? "soul_app.bio.face" : "soul_app.bio.finger" }
    : null;
}

export async function readBiometry(): Promise<Biometry> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return (cached = {
      enrolled: hardware && enrolled,
      wordKey: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? "soul_app.bio.face" : "soul_app.bio.finger",
    });
  } catch {
    return { enrolled: false, wordKey: "soul_app.bio.finger" };
  }
}

// ── the credential ───────────────────────────────────────────────────────

/** On when the flag holds anything: `face` or `finger` (what the phone said when it was turned on). */
export const bioEnabled = () => !!platform().persistent.get(BIO_KEY);

/** The reason the system shows with its face / finger check. A system string, not in the language bundles (Design 第二十批 §四.4). */
const PROMPT = "用来登录灵魂簿，不用输密码。";
const prompt = () => PROMPT;

export type CredentialRead = { status: "ok"; credential: string } | { status: "cancelled" } | { status: "invalidated" } | { status: "failed" };

/**
 * Hands the credential over -- the system verifies the face / finger first. A key that is gone while the flag says
 * on (the phone's enrolled set changed) reads as `invalidated`.
 */
export async function readCredential(): Promise<CredentialRead> {
  try {
    const credential = await SecureStore.getItemAsync(CREDENTIAL_KEY, {
      keychainService: SERVICE,
      requireAuthentication: true,
      authenticationPrompt: prompt(),
    });
    return credential ? { status: "ok", credential } : { status: "invalidated" };
  } catch (e) {
    return { status: classifyCredentialError(e) };
  }
}

/** The system would not keep the credential (the soul declined the prompt, or the phone said no). Not a network error. */
export class CredentialStoreError extends Error {
  constructor(readonly failure: CredentialFailure) {
    super(`credential not stored: ${failure}`);
  }
}

/** Keeps the credential behind the face / finger, and only then marks 面容 / 指纹 login on. Throws `CredentialStoreError` if the system refuses. */
export async function storeCredential(credential: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(CREDENTIAL_KEY, credential, {
      keychainService: SERVICE,
      requireAuthentication: true,
      authenticationPrompt: prompt(),
    });
  } catch (e) {
    throw new CredentialStoreError(classifyCredentialError(e));
  }
  platform().persistent.set(BIO_KEY, (await readBiometry()).wordKey === "soul_app.bio.face" ? "face" : "finger");
}

/** The app locks on return from the background: the switch is on AND 面容 / 指纹 login still is (turning that off takes this down with it). */
export const appLockOn = () => bioEnabled() && platform().persistent.get(APP_LOCK_KEY) === "1";

/** Forget the credential and the flag on this phone. The server still holds its row until `revokeCredential`. */
export function clearCredential(): void {
  platform().persistent.remove(BIO_KEY);
  platform().persistent.remove(APP_LOCK_KEY);
  SecureStore.deleteItemAsync(CREDENTIAL_KEY, { keychainService: SERVICE }).catch(() => {});
}

/**
 * 「关闭」: tell the server, then forget. The server call needs the credential in the clear, which the system
 * hands over only after verification; a soul who walks away from that prompt still gets the phone forgotten
 * (the credential is then unreachable anyway). Best effort on the network: the row is soft-revoked or harmless.
 */
export async function revokeCredential(): Promise<void> {
  const read = await readCredential();
  clearCredential();
  if (read.status === "ok") await soulApi.revokeDeviceLogin(read.credential).catch(() => {});
}

/**
 * 「开启」: the credential is issued against the current password, so a wrong password throws the axios error for
 * the caller to show. An older credential on this phone is revoked first (the server keeps one row per call).
 */
export async function enableWithPassword(password: string): Promise<void> {
  const previous = bioEnabled() ? await readCredential() : null;
  const credential = await soulApi.enableDeviceLogin(password);
  try {
    await storeCredential(credential);
  } catch (e) {
    await soulApi.revokeDeviceLogin(credential).catch(() => {});
    throw e;
  }
  if (previous?.status === "ok") await soulApi.revokeDeviceLogin(previous.credential).catch(() => {});
}

// ── the first sign-in page of the process ────────────────────────────────

let autoPromptSpent = false;
/** True until the sign-in page has asked once, or any session has been signed in, in this process. */
export const isColdStart = () => !autoPromptSpent;
export const spendAutoPrompt = () => void (autoPromptSpent = true);
/** For tests: a fresh process. */
export const resetColdStart = () => {
  autoPromptSpent = false;
  cached = null;
};
