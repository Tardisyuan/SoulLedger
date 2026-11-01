/**
 * Whose the things kept on this phone are (RBAC review A7). The reply outbox, the reply drafts and the read
 * cache are each stored as `{ owner, ... }` and read back only when the owner is the officer signed in now --
 * the soul app's chat outbox does the same (mobile/src/chat.tsx `readOutbox`). Sign-out clears them anyway;
 * this is for whatever a path that did not clear left behind: the next officer must never see the last one's
 * cases, and above all `flushOutbox` must never send the last one's replies under the next one's name.
 *
 * A session the server ended (401) does NOT clear the outbox and the drafts (user, 2026-11-01): they stay, unread while
 * nobody is signed in, and `dropUnowned` at the next sign-in keeps them for the same officer and removes them for any
 * other -- "换人不留痕" (A7) holds, the same officer gets the words back.
 *
 * The owner is read from the stored profile (session.tsx writes it on sign-in and removes it on sign-out),
 * so no store has to be told when the officer changes. `null` when nobody is stored.
 */
import { platform } from "@soulledger/core/platform";

/** The persistent key of the signed-in officer's profile (session.tsx re-exports it). */
export const USER_KEY = "officer_user";

export function currentOwner(): string | null {
  try {
    const user = JSON.parse(platform().persistent.get(USER_KEY) ?? "null") as { id?: unknown; username?: unknown; tenant?: { code?: unknown } | null } | null;
    if (!user) return null;
    // The id is the account; a profile cached by an old build may lack it, then the hall + username is.
    if (typeof user.id === "number") return `id:${user.id}`;
    return typeof user.username === "string" ? `u:${String(user.tenant?.code ?? "")}:${user.username}` : null;
  } catch {
    return null;
  }
}

/** The value kept under `key` when it is `{ owner, ... }` and the owner is the officer now; else null. */
export function readOwned<T extends object>(key: string): T | null {
  try {
    const parsed = JSON.parse(platform().persistent.get(key) ?? "null") as (T & { owner?: unknown }) | null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.owner === currentOwner() ? parsed : null;
  } catch {
    return null;
  }
}

export function writeOwned(key: string, value: object): void {
  platform().persistent.set(key, JSON.stringify({ ...value, owner: currentOwner() }));
}

/** At sign-in: whatever under `keys` is not the officer's now goes (A7); the same officer's stays. */
export function dropUnowned(keys: readonly string[]): void {
  for (const key of keys) if (platform().persistent.get(key) != null && readOwned(key) === null) platform().persistent.remove(key);
}
