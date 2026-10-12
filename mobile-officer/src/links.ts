/**
 * The officer app's links: `soulledger-officer://todo|queue|search|notices|me` opens that tab;
 * `soulledger-officer://item/<kind>/<id>` opens that item's detail, the way a tapped push does.
 * A link only opens a page -- nothing here decides, approves or submits.
 */
import type { TabKey } from "./kit";
import { isItemKind, type Landing } from "./rules";
import { createLinkInbox, pathOf, queryOf } from "./shared";

export const OFFICER_SCHEME = "soulledger-officer";
export type OfficerLink = { tab: TabKey; item?: Landing["item"] };
const TABS: readonly TabKey[] = ["todo", "queue", "search", "notices", "me"];

/**
 * The id goes into an API path (`/chat/inbox/<id>/`, ...) with the officer's token attached, and `pathOf`
 * has already percent-decoded it: `%2e%2e%2f...` must not be able to walk that request somewhere else.
 * Anything that could end or leave a path segment is refused.
 */
const UNSAFE_ID = /[\/\\?#%\u0000-\u001f]|^\.{1,2}$/;

export function parseOfficerLink(url: unknown): OfficerLink | null {
  const path = pathOf(url, OFFICER_SCHEME);
  if (!path) return null;
  const head = path[0]?.toLowerCase();
  if (path.length === 1 && (TABS as readonly string[]).includes(head)) return { tab: head as TabKey };
  if (path.length === 3 && head === "item" && isItemKind(path[1]) && path[2].length <= 64 && !UNSAFE_ID.test(path[2])) return { tab: "todo", item: { kind: path[1], id: path[2] } };
  return null;
}

export const officerLinks = createLinkInbox(parseOfficerLink);

/**
 * `soulledger-officer://reset?uid=<uid>&token=<token>`: the half of the e-mailed reset link the desk's
 * page hands over ("open in the officer app"). Unlike every link above it is NOT held for after sign-in:
 * the officer who opens it has just forgotten the password, so it has its own inbox, taken by whoever is on
 * screen (the sign-in side, or the shell). It opens a form; nothing is sent until the new password is.
 *
 * The credential is secret and works once: it is never logged, stored or reported (crashReport scrubs
 * `uid`, `token` and any `scheme://...?query`), and the screen drops it when it closes. Shape-checked here
 * (Django's urlsafe-base64 uid, `<base36>-<hex>` token) so anything else is discarded unseen.
 */
export type ResetLink = { uid: string; token: string };
const UID_SHAPE = /^[A-Za-z0-9_-]{1,32}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

export function parseResetLink(url: unknown): ResetLink | null {
  const path = pathOf(url, OFFICER_SCHEME);
  if (!path || path.length !== 1 || path[0].toLowerCase() !== "reset") return null;
  const uid = queryOf(url, "uid");
  const token = queryOf(url, "token");
  return uid && token && UID_SHAPE.test(uid) && TOKEN_SHAPE.test(token) ? { uid, token } : null;
}

export const resetLinks = createLinkInbox(parseResetLink);

/**
 * A credential this process has already used up (or been told is dead). On Android the activity can be
 * recreated and the opening URL is then handed over again; this keeps it from reopening a form for a token
 * that cannot work. Only a short hash is kept -- never the token -- and only in memory.
 */
let spent: number | null = null;
const fingerprint = (link: ResetLink): number => {
  let h = 5381;
  for (const ch of `${link.uid}.${link.token}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return h;
};
export const retireResetLink = (link: ResetLink): void => {
  spent = fingerprint(link);
};
export const isRetiredResetLink = (link: ResetLink): boolean => spent !== null && spent === fingerprint(link);
