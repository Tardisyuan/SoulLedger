/**
 * 两步验证, the parts that are not drawing: what to do with digits, the secret and the clock, how a failed
 * call becomes a state of the screen, and the one thing this App keeps on the device -- the opaque
 * 「这部手机 30 天内不再询问」 token.
 *
 * THE DEVICE TOKEN is what the web's httpOnly cookie is, for a native client: the server gives one after a
 * second step that asked to be remembered, the App holds it in the secure store (Keychain / Keystore) and
 * sends it with the next password. One value per soul code, because one phone may sign in several souls.
 * Sign-out does NOT clear it (that is the point); the server voids it on disable, re-enable, an officer's
 * reset, rebirth and any password change, and this App drops it as soon as the server stops honouring it.
 *
 * Nothing else here is stored: not the secret, not the recovery codes, not a pending credential.
 */
import type { SoulMfaFailure } from "@soulledger/core/api/soul";
import { platform } from "@soulledger/core/platform";

export const MFA_DEVICES_KEY = "soulledger_mfa_devices";

const codeKey = (soulCode: string) => soulCode.trim().toUpperCase();

function readDevices(): Record<string, string> {
  try {
    const raw = platform().secure.get(MFA_DEVICES_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, token]) => typeof token === "string" && token));
  } catch {
    return {};
  }
}

export function deviceTokenFor(soulCode: string): string | undefined {
  return readDevices()[codeKey(soulCode)];
}

export function rememberDevice(soulCode: string, token: string): void {
  platform().secure.set(MFA_DEVICES_KEY, JSON.stringify({ ...readDevices(), [codeKey(soulCode)]: token }));
}

export function forgetDevice(soulCode: string): void {
  const rest = readDevices();
  delete rest[codeKey(soulCode)];
  platform().secure.set(MFA_DEVICES_KEY, JSON.stringify(rest));
}

/** The six digits the box may hold: everything else a paste brings is dropped. */
export const digitsOf = (text: string) => text.replace(/\D/g, "").slice(0, 6);

/** A recovery code as typed: letters, digits and the dash only, no spaces; case is left alone (the server folds it). */
export const recoveryOf = (text: string) => text.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16);

/** Four characters to a group, four groups to a line (16 characters = one line, 32 = two), for copying by hand. */
export function secretLines(secret: string): string[] {
  const groups = secret.match(/.{1,4}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(" "));
  return lines;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:mm`, device time -- the lock's end is written as a clock time, not as a number of minutes. */
export function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * What the second step shows. One state at a time; the digits are kept across `wrong` and `network` (the
 * screen owns them), and cleared with `expired` and `locked`.
 */
export type StepState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "wrong"; left: number | null }
  | { kind: "expired" }
  | { kind: "locked"; until: string | null }
  | { kind: "network" }
  | { kind: "rate_limited" }
  | { kind: "other" };

export function stateOfFailure(f: SoulMfaFailure, now: number = Date.now()): StepState {
  switch (f.code) {
    case "wrong":
    case "wrong_password":
    // A stale code (60-120 s old) is told apart server-side and does not count; to the soul it is still
    // "that is not the number on the screen now".
    case "expired":
      return { kind: "wrong", left: f.remainingAttempts };
    case "pending_invalid":
      return { kind: "expired" };
    case "locked":
      return {
        kind: "locked",
        until: f.lockedUntil ?? (f.retryAfter !== null ? new Date(now + f.retryAfter * 1000).toISOString() : null),
      };
    case "network":
      return { kind: "network" };
    case "rate_limited":
      return { kind: "rate_limited" };
    default:
      return { kind: "other" };
  }
}
