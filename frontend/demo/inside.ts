/**
 * 「工程视角」(v4 第三十八批第二、三节, `DemoInside.tsx`): what the page shows, read off the recordings and nothing else.
 * A number the recordings do not hold is `null` and the page leaves it out; nothing here is made up to fill a gap.
 *
 * - The two halls: each judge's own answer to `GET /souls/` (scripts/demo-record.mjs walks `/souls` as that judge), and
 *   the probe: the same judge asking for the other hall's first soul by id. A refused sweep records nothing, so the
 *   probe is asked separately (`recordInside` in the recorder); until a recording has it, `probe.status` is `null`.
 * - The case: the cross-hall sentence plan the home judge can read (`cross_judgment_id` set), with the joint judgment
 *   that wrote it. The recorder picks its audit rows by the same rule (`insideCase`), by resource id, as the administrator.
 */
import type { Recording } from "./store";
import { SKIN } from "./tour";

type Row = Record<string, unknown>;
export const SOULS = "/souls/";
/** The recorder's MAX_PAGES × the API's PAGE_SIZE: a list this long may be cut short, so its length is not a count. */
const LIST_CAP = 200;

export interface Hall {
  count: number | null;
  rows: Row[];
  probe: { path: string; status: number | null; body: unknown } | null;
}

const listRows = (rec: Recording | null | undefined): Row[] | null => rec?.lists[SOULS]?.rows ?? null;
const countOf = (rows: Row[] | null) => (rows && rows.length < LIST_CAP ? rows.length : null);

/** One hall's column: its judge's list, and that judge asking for `other`'s first soul. */
export function hallOf(rec: Recording, other: Recording | null): Hall {
  const rows = listRows(rec) ?? [];
  const target = listRows(other)?.[0]?.id;
  const path = typeof target === "string" ? `${SOULS}${target}/` : null;
  const doc = path ? rec.docs[path] : undefined;
  return {
    count: countOf(listRows(rec)),
    rows: rows.slice(0, 4),
    probe: path ? { path, status: doc ? doc.s : null, body: doc?.b ?? null } : null,
  };
}

/** The same request as the hall-less administrator: every hall's souls. */
export const totalOf = (admin: Recording | null) => countOf(listRows(admin));

export interface CaseNode {
  order: number;
  tenant_code: string;
  realm_code: string;
  sentence_years: number | null;
  status: string;
}
export interface CrossCase {
  planId: string;
  planStatus: string;
  soulId: string;
  soulName: string;
  home: string;
  away: string;
  awaySkin: string | null;
  nodes: CaseNode[];
  cross: { id: string; title: string; status: string; participantId: string | null } | null;
}

/** The first cross-hall plan in the home judge's recording (key order), as the recorder picks it too. */
export function insideCase(rec: Recording): CrossCase | null {
  for (const [key, doc] of Object.entries(rec.docs)) {
    const plan = doc.b as Row | null;
    if (!/^\/sentence-plans\/[^/?]+\/$/.test(key) || doc.s !== 200 || !plan?.cross_judgment_id || !Array.isArray(plan.nodes)) continue;
    const nodes = (plan.nodes as Row[]).map((n) => ({
      order: Number(n.order),
      tenant_code: String(n.tenant_code),
      realm_code: String(n.realm_code),
      sentence_years: typeof n.sentence_years === "number" ? n.sentence_years : null,
      status: String(n.status),
    }));
    const home = String(plan.tenant_code);
    const away = nodes.find((n) => n.tenant_code !== home)?.tenant_code;
    if (!away) continue;
    const ctj = rec.docs[`/dispatch/cross-tenant-judgments/${plan.cross_judgment_id}/`]?.b as Row | undefined;
    const seat = ((ctj?.participants as Row[] | undefined) ?? []).find((p) => p.participant_tenant_code === away);
    return {
      planId: String(plan.id),
      planStatus: String(plan.status),
      soulId: String(plan.soul),
      soulName: String(plan.soul_name),
      home,
      away,
      awaySkin: SKIN[away] ?? null,
      nodes: nodes.sort((a, b) => a.order - b.order),
      cross: ctj ? { id: String(ctj.id), title: String(ctj.title), status: String(ctj.status), participantId: seat ? String(seat.id) : null } : null,
    };
  }
  return null;
}

/** What the other hall's recording holds about the case: the plan (and whether the home stop's reasons were kept), the soul. */
export function awayView(away: Recording | null, c: CrossCase) {
  if (!away) return null;
  const plan = away.docs[`/sentence-plans/${c.planId}/`];
  return {
    readsPlan: plan?.s === 200,
    listsSoul: (listRows(away) ?? []).some((r) => r.id === c.soulId),
  };
}

/** Which audit rows each step wrote: by resource and action (apps/audit/signals.py writes CREATE / UPDATE per row). */
export function stepAuditIds(c: CrossCase, step: number): { ids: string[]; action: "CREATE" | "UPDATE" }[] {
  const ctj = c.cross?.id;
  const seat = c.cross?.participantId;
  const of = (...ids: (string | null | undefined)[]) => ids.filter((id): id is string => !!id);
  if (step === 1) return [{ ids: of(ctj, seat), action: "CREATE" }];
  if (step === 2) return [{ ids: of(seat), action: "UPDATE" }];
  if (step === 3) return [{ ids: of(ctj), action: "UPDATE" }, { ids: of(c.planId), action: "CREATE" }];
  return [{ ids: of(c.planId), action: "UPDATE" }];
}

/**
 * The administrator's recorded audit rows for a step, oldest first. `null` when none of its ids was recorded (the
 * recorder asks `/audit-logs/?resource_id=<id>`), which is not the same as recorded and empty (`[]`).
 */
export function auditFor(admin: Recording | null, c: CrossCase, step: number): Row[] | null {
  if (!admin) return null;
  let recorded = false;
  const rows: Row[] = [];
  for (const { ids, action } of stepAuditIds(c, step)) {
    for (const id of ids) {
      const list = admin.lists[`/audit-logs/?resource_id=${id}`];
      if (!list) continue;
      recorded = true;
      rows.push(...list.rows.filter((r) => r.action === action));
    }
  }
  return recorded ? rows.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) : null;
}

export const STEPS = [1, 2, 3, 4] as const;
export const clampStep = (n: number) => Math.min(4, Math.max(1, Math.round(n) || 1));
