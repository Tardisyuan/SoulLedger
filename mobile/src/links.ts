/**
 * The soul app's links: `soulledger://life|letters|assist|cooldown|circle|sentence|export|help|applications|settings|notifications`
 * each only open a page; `soulledger://post/<id>` and `soulledger://conversation/<id>` open that one post or letter
 * (audit 2026-10-17 #12); and `soulledger://ask?q=<question>` opens 问一问 with the question typed into the box -- never sent.
 */
import { createLinkInbox, pathOf, queryOf } from "./deepLink";

export const SOUL_SCHEME = "soulledger";
export type SoulPage =
  | "life"
  | "letters"
  | "assist"
  | "cooldown"
  | "ask"
  | "circle"
  | "sentence"
  | "export"
  | "help"
  | "applications"
  | "settings"
  | "notifications"
  | "post"
  | "conversation";
export interface SoulLink {
  page: SoulPage;
  /** `ask` only: the question, trimmed, control characters removed, at most ASK_MAX_LENGTH characters. */
  question?: string;
  /** `post` / `conversation` only: the id, lower-cased. */
  id?: string;
}
const PAGES: readonly SoulPage[] = [
  "life",
  "letters",
  "assist",
  "cooldown",
  "ask",
  "circle",
  "sentence",
  "export",
  "help",
  "applications",
  "settings",
  "notifications",
  "post",
  "conversation",
];
/** Pages that name one thing, as `<page>/<id>`. The id is a UUID, as the server's are; anything else is dropped. */
const WITH_ID: readonly SoulPage[] = ["post", "conversation"];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The drawer's own limit (assistPanel.tsx MAX_QUESTION): a longer prefill would be cut by the box anyway. */
export const ASK_MAX_LENGTH = 1000;

/** The question a link carries, made fit for the box: no control characters, no outer blanks, bounded. */
export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()).slice(0, ASK_MAX_LENGTH).join("");
}

export function parseSoulLink(url: unknown): SoulLink | null {
  const path = pathOf(url, SOUL_SCHEME);
  if (!path || path.length < 1 || path.length > 2) return null;
  const page = path[0].toLowerCase() as SoulPage;
  if (!PAGES.includes(page)) return null;
  if (WITH_ID.includes(page)) return path.length === 2 && ID.test(path[1]) ? { page, id: path[1].toLowerCase() } : null;
  if (path.length !== 1) return null;
  if (page !== "ask") return { page };
  const question = cleanQuestion(queryOf(url, "q"));
  return question ? { page, question } : { page };
}

export const soulLinks = createLinkInbox(parseSoulLink);
