/**
 * A server-issued credential kept behind the phone's face / finger: the soul app's 面容登录 (`deviceLogin.ts`) and
 * the officer app's 指纹登录 (`mobile-officer/src/bioLogin.tsx`) are two instances of `deviceCredential`, each with its
 * own keys and API. A leaf the officer app may import (`mobile-officer/src/__tests__/sharedClosure.test.ts`): no
 * session, no `soulApi`, no `loginRules`.
 *
 *   persistent (not secret)   the flag: `face` or `finger`, what the phone said when it was turned on
 *   secure store, by biometry the credential. `requireAuthentication` makes the system verify the face / finger to
 *                             hand it over, and the key dies when the enrolled set changes (iOS `biometryCurrentSet`,
 *                             Android invalidated-by-enrolment).
 *
 * The password is stored nowhere. The server issues one credential per call, so turning it on again revokes the old one.
 */
import { platform } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { captureCrash } from "./crashReport";
import { classifyCredentialError, credentialReadFailure, type CredentialFailure } from "./credentialFailure";
import { storedLocale, translate } from "./i18n";

// ── the phone's face / finger ────────────────────────────────────────────

export interface Biometry {
  /** Hardware present AND at least one face or finger enrolled. */
  enrolled: boolean;
  /** The word: face when the phone does face recognition, else finger. */
  wordKey: "soul_app.bio.face" | "soul_app.bio.finger";
}

let cached: Biometry | null = null;
/** For tests: a fresh process. */
export const resetBiometryCache = () => void (cached = null);

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

export type CredentialRead = { status: "ok"; credential: string } | { status: "cancelled" } | { status: "invalidated" } | { status: "locked" } | { status: "failed" };

/** The system would not keep the credential (the user declined the prompt, or the phone said no). Not a network error. */
export class CredentialStoreError extends Error {
  constructor(readonly failure: CredentialFailure) {
    super(`credential not stored: ${failure}`);
  }
}

export interface DeviceCredentialConfig {
  /** Secure-store key of the credential, and its keychain service. */
  credentialKey: string;
  service: string;
  /** Persistent flag: holds `face` / `finger` while this login is on. */
  bioKey: string;
  /** Message key of the reason the system shows with its check, read in the app's language at the moment of asking. */
  promptKey: string;
  /** Persistent key of 「切回 App 时也要验证」, or null when the lock is simply on whenever this login is. */
  appLockKey: string | null;
  /** Issue a credential against the current password (throws the server's refusal). */
  enable: (password: string) => Promise<string>;
  /** Tell the server to revoke one; best effort. */
  revoke: (credential: string) => Promise<void>;
}

export function deviceCredential(cfg: DeviceCredentialConfig) {
  const prompt = () => translate(storedLocale(), cfg.promptKey);

  /** On when the flag holds anything. */
  const bioEnabled = () => !!platform().persistent.get(cfg.bioKey);

  /** What was read last in this process, or -- when this login is on -- what the phone said when it was turned on. Sync, for a first frame. */
  const knownBiometry = (): Biometry | null => {
    if (cached) return cached;
    const kind = platform().persistent.get(cfg.bioKey);
    return kind === "face" || kind === "finger"
      ? { enrolled: true, wordKey: kind === "face" ? "soul_app.bio.face" : "soul_app.bio.finger" }
      : null;
  };

  /** Hands the credential over -- the system verifies the face / finger first. A key gone while the flag says on reads as `invalidated`. */
  const readCredential = async (reason: string = prompt()): Promise<CredentialRead> => {
    const started = Date.now();
    try {
      const credential = await SecureStore.getItemAsync(cfg.credentialKey, {
        keychainService: cfg.service,
        requireAuthentication: true,
        authenticationPrompt: reason,
      });
      return credential ? { status: "ok", credential } : { status: "invalidated" };
    } catch (e) {
      return { status: credentialReadFailure(e, Date.now() - started, Platform.OS) };
    }
  };

  /** Keeps the credential behind the face / finger, and only then marks the login on. Throws `CredentialStoreError` if the system refuses. */
  const storeCredential = async (credential: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(cfg.credentialKey, credential, {
        keychainService: cfg.service,
        requireAuthentication: true,
        authenticationPrompt: prompt(),
      });
    } catch (e) {
      throw new CredentialStoreError(classifyCredentialError(e));
    }
    platform().persistent.set(cfg.bioKey, (await readBiometry()).wordKey === "soul_app.bio.face" ? "face" : "finger");
  };

  /**
   * The app locks on return from the background: this login is on AND (when the lock has its own switch) that switch
   * is not explicitly off. Absent counts as on (2026-11-15, soul refresh tokens last 30 days); `"0"` is an explicit off.
   */
  const appLockOn = () => bioEnabled() && (cfg.appLockKey === null || platform().persistent.get(cfg.appLockKey) !== "0");

  /**
   * Forget the credential and the flag on this phone. The server still holds its row until `revokeCredential`. The
   * lock switch stays: an explicit off outlives turning this login off and on (2026-11-15).
   */
  const clearCredential = (): void => {
    platform().persistent.remove(cfg.bioKey);
    SecureStore.deleteItemAsync(cfg.credentialKey, { keychainService: cfg.service }).catch(captureCrash);
  };

  /**
   * 「关闭」: tell the server, then forget. The server call needs the credential in the clear, which the system hands
   * over only after verification; walking away from that prompt still forgets it here (it is then unreachable anyway).
   */
  const revokeCredential = async (): Promise<void> => {
    const read = await readCredential();
    clearCredential();
    if (read.status === "ok") await cfg.revoke(read.credential).catch(() => {});
  };

  /** 「开启」: issued against the current password (a wrong one throws the axios error); an older one on this phone is revoked first. */
  const enableWithPassword = async (password: string): Promise<void> => {
    const previous = bioEnabled() ? await readCredential() : null;
    const credential = await cfg.enable(password);
    try {
      await storeCredential(credential);
    } catch (e) {
      await cfg.revoke(credential).catch(() => {});
      throw e;
    }
    if (previous?.status === "ok") await cfg.revoke(previous.credential).catch(() => {});
  };

  return { bioEnabled, knownBiometry, readCredential, storeCredential, appLockOn, clearCredential, revokeCredential, enableWithPassword };
}
