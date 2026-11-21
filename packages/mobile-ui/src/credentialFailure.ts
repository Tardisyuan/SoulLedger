/**
 * How a failed read of the stored credential ends. The message strings are the native modules' (iOS Keychain /
 * Android Keystore + BiometricPrompt); they have not been seen on a device from here -- the classes are the ones
 * Design needs: the soul walked away (stay on the page, do not ask again), the system said no (show the password
 * box), the key is gone because the phone's face / fingerprint set changed (E4).
 *
 * Shared by the soul app's 面容登录 and the officer app's 指纹登录 (`deviceCredential.ts`); pure, so `loginRules`
 * (which re-exports it) stays free of native modules.
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
