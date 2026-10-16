/** Pure rules for a letter's hand-over actions (Design batch 34, O-04). */
import type { InboxOfficer } from "@soulledger/core/api/soul-inbox";

export type LetterAction = "assign" | "unassign" | "archive" | "unarchive";

/**
 * The ⋯ menu's rows for a thread. An archived letter offers only 取消归档 (and its reply is off); a closed thread
 * (the soul was reborn) cannot be handed over -- the server answers 409 `closed` -- but can still be put back
 * and archived; an unassigned letter has nothing to put back.
 */
export function menuActions(c: { archived: boolean; closed: boolean; assigned: boolean }): LetterAction[] {
  if (c.archived) return ["unarchive"];
  const rows: LetterAction[] = [];
  if (!c.closed) rows.push("assign");
  if (c.assigned) rows.push("unassign");
  rows.push("archive");
  return rows;
}

/** A letter nobody holds, still open: it shows 由我来回 / 转给别人 and no reply box. */
export function isUnassigned(c: { assigned: boolean; closed: boolean; archived: boolean }): boolean {
  return !c.assigned && !c.closed && !c.archived;
}

/** The picker's rows: never the caller, filtered by the search text on name (case-insensitive). */
export function assignableOthers(people: readonly InboxOfficer[], selfId: number | undefined, q: string): InboxOfficer[] {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => p.user_id !== selfId && (needle === "" || p.display_name.toLowerCase().includes(needle)));
}
