/**
 * The soul app's links: `soulledger://life|letters|assist|cooldown` each only open a page, and
 * `soulledger://ask?q=<question>` opens 问一问 with the question typed into the box -- never sent.
 */
import { createLinkInbox, pathOf, queryOf } from "./deepLink";

export const SOUL_SCHEME = "soulledger";
export type SoulPage = "life" | "letters" | "assist" | "cooldown" | "ask";
export interface SoulLink {
  page: SoulPage;
  /** `ask` only: the question, trimmed, control characters removed, at most ASK_MAX_LENGTH characters. */
  question?: string;
}
const PAGES: readonly SoulPage[] = ["life", "letters", "assist", "cooldown", "ask"];

/** The drawer's own limit (assistPanel.tsx MAX_QUESTION): a longer prefill would be cut by the box anyway. */
export const ASK_MAX_LENGTH = 1000;

/** The question a link carries, made fit for the box: no control characters, no outer blanks, bounded. */
export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()).slice(0, ASK_MAX_LENGTH).join("");
}

export function parseSoulLink(url: unknown): SoulLink | null {
  const path = pathOf(url, SOUL_SCHEME);
  if (!path || path.length !== 1) return null;
  const page = path[0].toLowerCase() as SoulPage;
  if (!PAGES.includes(page)) return null;
  if (page !== "ask") return { page };
  const question = cleanQuestion(queryOf(url, "q"));
  return question ? { page, question } : { page };
}

export const soulLinks = createLinkInbox(parseSoulLink);
