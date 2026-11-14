/**
 * 指纹登录 (2026-11-15 便捷度研究 O5): the soul app's 面容登录 store (`mobile/src/deviceCredential.ts`) with the
 * officer's keys and endpoints. The password is stored nowhere; the server issues a credential for this phone only
 * (`backend/apps/authentication/device_login.py`) and revokes it on a password change, a reset, a forced sign-out
 * of that device or of the officer, and deactivation.
 *
 * The credential belongs to the remembered officer (`officer_last_login`): another officer signing in on this phone
 * takes it off (session.tsx `land`), 「换一个账号」 revokes it. Signing out keeps it (audit §1 principle 2).
 * The foreground lock (appLock.tsx) is on exactly while this is on: there is no separate switch.
 */
import { authApi } from "@soulledger/core/api/auth";

import { deviceCredential } from "./shared";

/** The persistent flag (`face` / `finger` while on). */
export const BIO_LOGIN_KEY = "officer_bio_login";
/** Per username: 「下次用指纹登录？」 has been answered. */
export const BIO_ASKED_PREFIX = "officer_bio_login_asked:";

export const officerDevice = deviceCredential({
  credentialKey: "soulledger_officer_device_login",
  service: "soulledger.officerdevicelogin",
  bioKey: BIO_LOGIN_KEY,
  promptKey: "officer_app.bio_login.prompt_login",
  appLockKey: null,
  enable: (password) => authApi.enableDeviceLogin(password),
  revoke: (credential) => authApi.revokeDeviceLogin(credential),
});

let autoPromptSpent = false;
/** The sign-in page opens the fingerprint prompt by itself once per process, and not after any sign-in in it. */
export const autoPromptDue = () => !autoPromptSpent;
export const spendAutoPrompt = () => void (autoPromptSpent = true);
/** For tests: a fresh process. */
export const resetAutoPrompt = () => void (autoPromptSpent = false);
