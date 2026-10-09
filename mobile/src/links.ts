/** The soul app's links: `soulledger://life|letters|assist|cooldown`. Each only opens a page. */
import { createLinkInbox, pathOf } from "./deepLink";

export const SOUL_SCHEME = "soulledger";
export type SoulLink = "life" | "letters" | "assist" | "cooldown";
const PAGES: readonly SoulLink[] = ["life", "letters", "assist", "cooldown"];

export function parseSoulLink(url: unknown): SoulLink | null {
  const path = pathOf(url, SOUL_SCHEME);
  if (!path || path.length !== 1) return null;
  const page = path[0].toLowerCase();
  return (PAGES as readonly string[]).includes(page) ? (page as SoulLink) : null;
}

export const soulLinks = createLinkInbox(parseSoulLink);
