/**
 * The officer app's links: `soulledger-officer://todo|queue|search|notices|me` opens that tab;
 * `soulledger-officer://item/<kind>/<id>` opens that item's detail, the way a tapped push does.
 * A link only opens a page -- nothing here decides, approves or submits.
 */
import type { TabKey } from "./kit";
import { isTodoKind, type Landing } from "./rules";
import { createLinkInbox, pathOf } from "./shared";

export const OFFICER_SCHEME = "soulledger-officer";
export type OfficerLink = { tab: TabKey; item?: Landing["item"] };
const TABS: readonly TabKey[] = ["todo", "queue", "search", "notices", "me"];

export function parseOfficerLink(url: unknown): OfficerLink | null {
  const path = pathOf(url, OFFICER_SCHEME);
  if (!path) return null;
  const head = path[0]?.toLowerCase();
  if (path.length === 1 && (TABS as readonly string[]).includes(head)) return { tab: head as TabKey };
  if (path.length === 3 && head === "item" && isTodoKind(path[1])) return { tab: "todo", item: { kind: path[1], id: path[2] } };
  return null;
}

export const officerLinks = createLinkInbox(parseOfficerLink);
