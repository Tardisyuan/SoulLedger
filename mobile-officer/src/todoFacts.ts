/**
 * Pure rules for the waiting-item detail (Design batch 34, O-01) and the unassigned-letters group (O-04).
 * No React here, so the jest files can pin each one.
 */
import type { FactHistory, TodoFacts, TodoItemDetail } from "@soulledger/core/api/officer-app";

import type { Verdict } from "./rules";

/** More than this many steps and the middle is folded: 发起 + the last 2 stay, a row says 「还有 N 步」. */
export const HISTORY_FULL_MAX = 4;
export const HISTORY_TAIL = 2;

/** The timeline as drawn: `head` (发起), then a fold of `hidden` steps (if any, expandable), then `tail`. */
export function historyView(steps: readonly FactHistory[], expanded: boolean): { shown: FactHistory[]; hidden: FactHistory[]; foldAt: number } {
  if (expanded || steps.length <= HISTORY_FULL_MAX) return { shown: [...steps], hidden: [], foldAt: -1 };
  const hidden = steps.slice(1, steps.length - HISTORY_TAIL);
  return { shown: [steps[0], ...steps.slice(steps.length - HISTORY_TAIL)], hidden, foldAt: 1 };
}

/** An attachment as the viewer or the system treats it: images open in the in-app viewer, a PDF in the system. */
export function isPdf(contentType: string): boolean {
  return contentType === "application/pdf";
}

/** A byte count for a row's second line, 1 decimal above 1 MB: `1.2 MB`, `340 KB`. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The first `max` souls and how many more there are (「还有 N 个」). */
export function soulsView<T>(souls: readonly T[], expanded: boolean, max = 2): { shown: T[]; more: number } {
  return expanded || souls.length <= max ? { shown: [...souls], more: 0 } : { shown: souls.slice(0, max), more: souls.length - max };
}

type HallRef = { code: string; display_name: string } | null | undefined;

export interface EffectLine {
  /** Language key under `officer_app.confirm.`. */
  key: string;
  values: Record<string, string>;
}

/**
 * The one consequence sentence under the object block (reply 第四节). `null` = nothing known: the sheet keeps its
 * older generic sentence (`approve_body.*` / `reject_body`). Approval's reject sentence is always the older one.
 * `to` is the days the officer typed for a cooldown (falls back to what the soul asked).
 */
export function effectLine(
  detail: Pick<TodoItemDetail, "kind" | "facts" | "title">,
  verdict: Verdict,
  hall: (h: HallRef) => string,
  to?: number | null,
): EffectLine | null {
  const f: TodoFacts | undefined = detail.facts;
  if (!f) return null;
  const name = f.soul?.name ?? detail.title;
  if (detail.kind === "approval") {
    if (verdict !== "approve" || !f.node) return null;
    if (f.node.is_last === true) return { key: "approve_effect.approval_last", values: {} };
    return f.node.next_name ? { key: "approve_effect.approval", values: { next: f.node.next_name } } : null;
  }
  if (detail.kind === "reassignment") {
    const n = String(f.soul_count ?? f.souls?.length ?? 0);
    return { key: `${verdict}_effect.dispatch`, values: { n, from: hall(f.from_hall), to: hall(f.to_hall) } };
  }
  if (detail.kind === "rebirth") return { key: `${verdict}_effect.reincarnation`, values: { name } };
  if (detail.kind === "cooldown") {
    const now = f.cooldown_now_days;
    if (now == null) return null;
    if (verdict === "reject") return { key: "reject_effect.cooldown", values: { n: String(now) } };
    const target = to ?? f.cooldown_asked_days;
    return target == null ? null : { key: "approve_effect.cooldown", values: { name, from: String(now), to: String(target) } };
  }
  return null;
}

/** The sheet's object block: line one says what, line two who asked. `hall` turns a hall ref into its name. */
export function objectLines(
  detail: Pick<TodoItemDetail, "kind" | "facts" | "title">,
  hall: (h: HallRef) => string,
  t: (key: string, values?: Record<string, string>) => string,
): [string, string | null] {
  const f = detail.facts;
  const who = f?.requester ? `${t("officer_app.detail.requester")} ${f.requester}` : null;
  if (detail.kind === "reassignment" && f) {
    const n = f.soul_count ?? f.souls?.length ?? 0;
    return [`${t("officer_app.detail.souls", { n: String(n) })} · ${hall(f.from_hall)} → ${hall(f.to_hall)}`, who];
  }
  return [detail.title, who];
}

/** The ids a push or a list row names for an unassigned letter are the conversation's: same thread as 待回书信. */
export function unassignedShown<T>(items: readonly T[], expanded: boolean, max = 3): T[] {
  return expanded ? [...items] : items.slice(0, max);
}
