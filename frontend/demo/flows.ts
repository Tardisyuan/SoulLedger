/**
 * The demo's main lines: writes that have to move state the way the server would, and the reads whose answers the
 * server computes (the queue's groups and counts). Everything else takes the generic rule in `writes.ts`.
 *
 * ponytail: these imitate the server's outcome, not its rules. A real refusal (not your claim, wrong order, quota) never
 * happens here; nothing a visitor can do in a demo should end in an error. One exception, asked for on purpose: a second
 * conclusion of a concluded case (`ALREADY_CONCLUDED`).
 */
import { aiRead, aiWrite } from "./aiReplay";
import { inboxRead, inboxWrite, letterCounts } from "./inbox";
import { tourOf } from "./tour";
import {
  type Answer,
  type Recording,
  addRow,
  deleteRow,
  dropFromList,
  getOverlay,
  listOf,
  matches,
  newId,
  patchRow,
  read,
  rowsNow,
} from "./store";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const qs = () => new URLSearchParams();
const ok = (data: unknown, status = 200): Answer => ({ status, data });

function meOf(rec: Recording) {
  const user = rec.login.user as Row & { id: number; username: string; display_name?: string };
  return { id: user.id, name: user.display_name || user.username, tenant: user.tenant };
}

const find = (rec: Recording, path: string, id: unknown) => rowsNow(rec, path).find((row) => String(row.id) === String(id));

function detail(rec: Recording, collection: string, id: string): Answer {
  return read(rec, `${collection}${id}/`, qs());
}

// ── Judgment queue ──────────────────────────────────────────────────────────────────────────────

const isPending = (row: Row) => !row.is_final && row.verdict == null;

function groupOf(row: Row, me: number): string {
  if (row.deferred_at) return "deferred";
  if (row.claimed_by == null) return "unclaimed";
  return row.claimed_by === me ? "mine" : "others";
}

/** The queue never sees a case still before the city god, or held, the same as the server's PENDING. */
const inQueue = (row: Row) => isPending(row) && !row.is_archived && row.city_god_status !== "PENDING" && row.city_god_status !== "RETURNED";

const OPEN_CROSS = ["PROPOSED", "ACTIVE"];

/** The judgments a still-open cross-hall bench hangs on: the list rows lack `judgment`, their recorded details have it. */
function openCrossJudgments(rec: Recording): Set<string> {
  const path = "/dispatch/cross-tenant-judgments/";
  return new Set(rowsNow(rec, path).filter((c) => OPEN_CROSS.includes(String(c.status)))
    .map((c) => String(c.judgment ?? (rec.docs[`${path}${c.id}/`]?.b as Row | undefined)?.judgment ?? "")).filter(Boolean));
}

/** `source` by the server's rule (backend/apps/judgment/sources.py), for recordings made before rows carried it.
 * A row's tenant is not in the list form; the soul's recorded detail gives where it resides and its home hall. */
function sourceOf(rec: Recording, row: Row, openCross: Set<string>): string {
  if (row.city_god_status === "SENT_ON") return "city_god";
  const soul = rec.docs[`/souls/${row.soul}/`]?.b as Row | undefined;
  const away = soul?.home_tenant != null && soul?.tenant != null && String(soul.home_tenant) !== String(soul.tenant);
  return row.source === "cross" || away || openCross.has(String(row.id)) ? "cross" : "queue";
}

/** Every judgment as it stands, each with its `source`. */
function judgmentsNow(rec: Recording): Row[] {
  const openCross = openCrossJudgments(rec);
  return rowsNow(rec, "/judgment/").map((row) => ({ ...row, source: sourceOf(rec, row, openCross) }));
}

/** 「退回重审」: opened because its first case was ruled RETRY (`RETURNED` in views.py), or recorded under `?returned=true`. */
function returnedIds(rec: Recording, rows: Row[]): Set<string> {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const recorded = (rec.lists["/judgment/?returned=true"]?.rows ?? []).map((r) => String(r.id));
  return new Set([...recorded, ...rows.filter((r) => byId.get(String(r.retrial_of))?.verdict === "RETRY").map((r) => String(r.id))]);
}

/** `elsewhere` of queue-counts: each from its own recorded list; null without the read or without the list. */
const ELSEWHERE: [string, string, string, (row: Row) => boolean][] = [
  ["appeal", "judgment.read", "/judgment/appeals/", (r) => r.status === "PENDING" || r.status === "IN_REVIEW"],
  ["city_god_review", "city_god.read", "/judgment/city-god-cases/", (r) => r.city_god_status === "PENDING" || r.city_god_status === "RETURNED"],
  ["cross_judgment", "cross_judgment.read", "/dispatch/cross-tenant-judgments/", (r) => OPEN_CROSS.includes(String(r.status))],
  ["capture_due", "capture.read", "/dispatch/capture-warrants/due/", () => true],
  ["rebirth_application", "workflow.read", "/soul-accounts/rebirth-applications/", (r) => r.status === "UNDER_REVIEW" || r.status === "APPEALING"],
];

function elsewhereOf(rec: Recording): Record<string, number | null> {
  const held = new Set((rec.login.user as Row).permissions as string[] | undefined);
  const recorded = (path: string) => Object.keys(rec.lists).some((k) => k.split("?")[0] === path);
  return Object.fromEntries(ELSEWHERE.map(([key, code, path, open]) =>
    [key, held.has(code) && recorded(path) ? rowsNow(rec, path).filter(open).length : null]));
}

/** `GET /judgment/queue-counts/` as `queue_counts` answers it: `?source=` narrows groups / total / overdue / returned,
 * never `sources`; `?civilization=`, `?court=`, `?search=` narrow all of them; `group` is ignored. */
function queueCounts(rec: Recording, query: URLSearchParams): Answer {
  const me = meOf(rec).id;
  const all = judgmentsNow(rec);
  const returned = returnedIds(rec, all);
  const unsourced = new URLSearchParams(query);
  unsourced.delete("group");
  unsourced.delete("source");
  const open = all.filter((row) => inQueue(row) && matches(row, unsourced));
  const source = query.get("source");
  const narrowed = source ? open.filter((row) => row.source === source) : open;
  const count = (g: string) => narrowed.filter((row) => groupOf(row, me) === g).length;
  const sources = Object.fromEntries(["queue", "city_god", "cross"].map((v) => [v, open.filter((row) => row.source === v).length]));
  return ok({
    total: narrowed.length,
    mine: count("mine"),
    unclaimed: count("unclaimed"),
    others: count("others"),
    deferred: count("deferred"),
    // `overdue_q`: past the hall's deadline and not deferred; the row's own `is_overdue` carries the hall's days.
    overdue: narrowed.filter((row) => row.is_overdue === true && !row.deferred_at).length,
    returned: narrowed.filter((row) => returned.has(String(row.id))).length,
    sources,
    elsewhere: elsewhereOf(rec),
  });
}

function claimPatch(action: string, body: Row, me: ReturnType<typeof meOf>): Row | null {
  switch (action) {
    case "claim":
      return { claimed_by: me.id, claimed_by_name: me.name, claimed_at: now(), deferred_at: null, defer_reason: "" };
    case "release":
      return { claimed_by: null, claimed_by_name: null, claimed_at: null };
    case "defer":
      return { deferred_at: now(), deferred_by: me.id, deferred_by_name: me.name, defer_reason: String(body.reason ?? "") };
    case "undefer":
      return { deferred_at: null, deferred_by: null, deferred_by_name: null, defer_reason: "" };
    case "reassign":
      return { claimed_by: body.to, claimed_by_name: null, claimed_at: now() };
    default:
      return null;
  }
}

function logEvent(rec: Recording, soul: unknown, soulName: unknown, type: string, payload: Row): void {
  const template = rowsNow(rec, "/events/").find((e) => e.event_type === type) ?? rowsNow(rec, "/events/")[0] ?? {};
  addRow("/events/", { ...template, id: newId(), soul, soul_name: soulName, event_type: type, payload, created_at: now(), timestamp: now() });
}

/** A new approval flow for a case just concluded: a recorded flow of the same civilization, restarted. */
function startFlow(rec: Recording, judgment: Row): string | null {
  const templates = Object.entries(rec.docs)
    .filter(([k, d]) => /^\/workflows\/[^/]+\/$/.test(k) && d.s === 200 && (d.b as Row)?.judgment && Array.isArray((d.b as Row)?.nodes))
    .map(([, d]) => d.b as Row);
  const owner = (t: Row) => find(rec, "/judgment/", t.judgment)?.civilization;
  const template = templates.find((t) => owner(t) === judgment.civilization) ?? templates[0];
  if (!template) return null;
  const id = newId();
  const nodes = (template.nodes as Row[]).map((node, i) => ({
    ...node,
    id: newId(),
    workflow: id,
    status: "PENDING",
    verdict: "",
    notes: "",
    decided_at: null,
    approver: null,
    approver_username: null,
    approver_display_name: null,
    activated_at: i === 0 ? now() : null,
  }));
  const row = {
    ...template,
    id,
    number: `WF-D${getOverlay().seq}`,
    judgment: judgment.id,
    judgment_verdict: judgment.verdict,
    judgment_case_number: judgment.case_number,
    soul: judgment.soul,
    soul_name: judgment.soul_name,
    status: "IN_PROGRESS",
    nodes,
    current_node: nodes[0]?.id ?? null,
    current_node_detail: nodes[0] ?? null,
    created_at: now(),
    completed_at: null,
    is_overdue: false,
    is_appeal: false,
    cross_civilization: false,
  };
  getOverlay().docs[`/workflows/${id}/`] = row;
  addRow("/workflows/", row);
  return id;
}

/**
 * The one refusal the demo does give, because a visitor can ask for it (「并发与事务」, `TransactionCard`): a case that
 * already has its verdict is not concluded again. The server's rule, `JudgmentConclusionService.conclude_judgment`
 * (apps/judgment/services.py): under the row lock, a verdict already there is 409 `already_concluded`, nothing written.
 * Its message and code, word for word; the screens never send this for a concluded case, so nothing else meets it.
 */
export const ALREADY_CONCLUDED = { error: "This judgment has already been concluded.", code: "already_concluded" };

function conclude(rec: Recording, id: string, body: Row): Answer {
  const row = find(rec, "/judgment/", id);
  if (!row) return ok({});
  if (!isPending(row)) return ok(ALREADY_CONCLUDED, 409);
  const verdict = String(body.verdict ?? "PASSED");
  const concluded = { ...row, verdict };
  const flowId = body.create_workflow === false ? null : startFlow(rec, concluded);
  patchRow("/judgment/", id, {
    verdict,
    notes: String(body.notes ?? row.notes ?? ""),
    is_final: true,
    concluded_at: now(),
    can_edit: false,
    conclude_refusal: "",
    claimed_by: row.claimed_by ?? meOf(rec).id,
    claimed_by_name: row.claimed_by_name ?? meOf(rec).name,
    deferred_at: null,
    workflow: flowId,
    draft_verdict: null,
  });
  patchRow("/souls/", String(row.soul), { current_state: "DISPOSED" });
  logEvent(rec, row.soul, row.soul_name, "JUDGMENT_CONCLUDED", { judgment_id: id, verdict });
  // 地府判无罪不发落(apps/judgment/services.py);其余都出一条处置。
  if (!(row.civilization === "CHINESE" && verdict === "PASSED")) {
    const dispositions = rowsNow(rec, "/disposition/");
    const civilizationOf = (d: Row) => find(rec, "/souls/", d.soul)?.civilization;
    const template = dispositions.find((d) => civilizationOf(d) === row.civilization) ?? dispositions[0] ?? {};
    addRow("/disposition/", {
      ...template,
      id: newId(),
      soul: row.soul,
      soul_name: row.soul_name,
      judgment: id,
      verdict,
      section: "pending",
      soul_state: "DISPOSED",
      soul_reborn: false,
      is_executed: false,
      executed_at: null,
      term_start: null,
      term_end: null,
      expired_at: null,
      flow_waiting: flowId,
      can_release: false,
      notes: "",
      created_at: now(),
    });
  }
  return detail(rec, "/judgment/", id);
}

function judgmentWrite(rec: Recording, path: string, body: Row): Answer | null {
  if (path === "/judgment/batch/") {
    const ids = (body.ids ?? body.judgment_ids ?? []) as string[];
    const patch = claimPatch(String(body.operation), body, meOf(rec));
    if (patch) ids.forEach((id) => patchRow("/judgment/", id, patch));
    return ok({ updated: ids.length, results: ids.map((id) => find(rec, "/judgment/", id)) });
  }
  const m = /^\/judgment\/([0-9a-f-]{36})\/([a-z-]+)\/$/.exec(path);
  if (!m) return null;
  const [, id, action] = m;
  if (action === "conclude") return conclude(rec, id, body);
  const patch = claimPatch(action, body, meOf(rec));
  if (!patch) return null;
  patchRow("/judgment/", id, patch);
  return detail(rec, "/judgment/", id);
}

// ── Approval flows ──────────────────────────────────────────────────────────────────────────────

function finishFlow(rec: Recording, flow: Row, passed: boolean): void {
  const judgment = flow.judgment ? find(rec, "/judgment/", flow.judgment) : undefined;
  const dispositions = rowsNow(rec, "/disposition/").filter((d) => flow.judgment && d.judgment === flow.judgment);
  dispositions.forEach((d) => patchRow("/disposition/", String(d.id), { flow_waiting: null }));
  if (passed && flow.soul && judgment?.verdict === "PASSED" && dispositions.length === 0) {
    patchRow("/souls/", String(flow.soul), { current_state: "REINCARNATING" });
  }
  if (flow.soul) logEvent(rec, flow.soul, flow.soul_name, passed ? "WORKFLOW_COMPLETED" : "WORKFLOW_REJECTED", { workflow_id: flow.id });
}

function approveNode(rec: Recording, id: string, body: Row): Answer {
  const answer = read(rec, `/workflows/${id}/`, qs());
  const flow = answer.data as Row;
  const nodes = ((flow.nodes ?? []) as Row[]).slice().sort((a, b) => Number(a.node_order) - Number(b.node_order));
  const node = nodes.find((n) => n.id === body.node_id) ?? nodes.find((n) => n.id === flow.current_node);
  if (!node) return answer;
  const me = meOf(rec);
  const passed = !/^(FAILED|REJECTED|REJECT)$/.test(String(body.verdict));
  const decided = {
    status: passed ? "APPROVED" : "REJECTED",
    verdict: String(body.verdict ?? ""),
    notes: String(body.notes ?? ""),
    decided_at: now(),
    approver: me.id,
    approver_display_name: me.name,
    approver_username: me.name,
  };
  patchRow("/nodes/", String(node.id), decided);
  let next = passed ? nodes.find((n) => Number(n.node_order) > Number(node.node_order) && n.status === "PENDING") : undefined;
  // Reaching the end stop finishes the flow, as `_enter` does on the server: nothing is left to decide there.
  if (next?.kind === "END") {
    patchRow("/nodes/", String(next.id), { status: "TRAVERSED", decided_at: now() });
    next = undefined;
  }
  if (next) {
    const activated = { activated_at: now() };
    patchRow("/nodes/", String(next.id), activated);
    patchRow("/workflows/", id, { current_node: next.id, current_node_detail: { ...next, ...activated } });
  } else {
    patchRow("/workflows/", id, {
      status: passed ? "COMPLETED" : "REJECTED",
      current_node: null,
      current_node_detail: null,
      completed_at: now(),
    });
    finishFlow(rec, flow, passed);
  }
  return detail(rec, "/workflows/", id);
}

// ── Simple status moves ─────────────────────────────────────────────────────────────────────────

const STATUS_MOVES: [RegExp, string, (body: Row, me: ReturnType<typeof meOf>) => Row][] = [
  [/^\/dispatch\/records\/([^/]+)\/approve\/$/, "/dispatch/records/", () => ({ status: "APPROVED" })],
  [/^\/dispatch\/records\/([^/]+)\/reject\/$/, "/dispatch/records/", (b) => ({ status: "REJECTED", rejection_reason: b.reason ?? "" })],
  [/^\/dispatch\/records\/([^/]+)\/execute\/$/, "/dispatch/records/", () => ({ status: "EXECUTED", executed_at: now() })],
  [/^\/dispatch\/records\/([^/]+)\/cancel\/$/, "/dispatch/records/", () => ({ status: "CANCELLED" })],
  [/^\/dispatch\/records\/([^/]+)\/submit\/$/, "/dispatch/records/", () => ({ status: "PROPOSED", proposed_at: now() })],
  [/^\/dispatch\/records\/([^/]+)\/return-home\/$/, "/dispatch/records/", () => ({ status: "RETURNED", returned_at: now() })],
  [/^\/disposition\/([^/]+)\/execute\/$/, "/disposition/", () => ({ is_executed: true, executed_at: now(), term_start: now(), section: "executing" })],
  [/^\/disposition\/([^/]+)\/release\/$/, "/disposition/", () => ({ expired_at: now(), section: "expired", can_release: false })],
  [/^\/notifications\/([^/]+)\/mark_read\/$/, "/notifications/", () => ({ is_read: true })],
  [/^\/users\/([^/]+)\/activate\/$/, "/users/", () => ({ is_active: true })],
  [/^\/users\/([^/]+)\/deactivate\/$/, "/users/", () => ({ is_active: false })],
  [/^\/users\/([^/]+)\/assign_roles\/$/, "/users/", (b) => ({ ...(b.role ? { role: b.role } : {}), ...(b.extra_roles ? { extra_roles: b.extra_roles } : {}) })],
  [/^\/social-moderation\/mutes\/([^/]+)\/lift\/$/, "/social-moderation/mutes/", (_b, me) => ({
    lifted_at: now(),
    is_active: false,
    lifted_by: { user_id: me.id, display_name: me.name },
  })],
  [/^\/judgment\/appeals\/([^/]+)\/claim\/$/, "/judgment/appeals/", (_b, me) => ({ status: "IN_REVIEW", reviewer: me.id, claimed_at: now() })],
  [/^\/judgment\/appeals\/([^/]+)\/decide\/$/, "/judgment/appeals/", (b) => ({ status: b.outcome === "UPHELD" || b.outcome === "upheld" ? "UPHELD" : "OVERTURNED", decision_note: b.note ?? "", decided_at: now() })],
  [/^\/judgment\/city-god-cases\/([^/]+)\/send_on\/$/, "/judgment/city-god-cases/", () => ({ city_god_status: "SENT_ON", sent_on_at: now() })],
  [/^\/judgment\/city-god-cases\/([^/]+)\/return\/$/, "/judgment/city-god-cases/", (b) => ({ city_god_status: "RETURNED", city_god_note: b.note ?? "" })],
];

const CONTENT_MOVES: Record<string, string> = { approve: "PUBLISHED", restore: "PUBLISHED", hide: "HIDDEN" };

function moderation(rec: Recording, path: string, body: Row): Answer | null {
  const me = meOf(rec);
  const report = /^\/social-moderation\/reports\/([^/]+)\/resolve\/$/.exec(path);
  if (report) {
    const row = find(rec, "/social-moderation/reports/", report[1]);
    const resolution = String(body.resolution ?? "DISMISS");
    const contentStatus = resolution === "HIDE" ? "HIDDEN" : resolution === "DELETE" ? "DELETED" : row?.content_status;
    patchRow("/social-moderation/reports/", report[1], {
      status: resolution === "DISMISS" ? "DISMISSED" : "RESOLVED",
      resolution,
      resolution_note: String(body.note ?? ""),
      resolved_at: now(),
      content_status: contentStatus,
    });
    if (row?.post && resolution === "HIDE") patchRow("/social/posts/", String(row.post), { moderation_status: "HIDDEN" });
    if (row?.post && resolution === "DELETE") deleteRow("/social/posts/", String(row.post));
    if (row?.post && resolution !== "DISMISS") {
      const author = row.target_user as Row;
      addRow("/social-moderation/handled/", {
        type: "POST",
        id: row.post,
        post: row.post,
        author,
        excerpt: row.content_excerpt,
        handling: resolution === "DELETE" ? "DELETED" : "HIDDEN",
        reason: String(body.note ?? ""),
        handled_by: { user_id: me.id, display_name: me.name },
        handled_at: now(),
        media_count: row.media_count ?? 0,
      });
    }
    if (resolution === "MUTE" && row?.target_user) addMute(rec, row.target_user as Row, Number(body.mute_days) || 7, String(body.note ?? ""));
    return detail(rec, "/social-moderation/reports/", report[1]);
  }
  const content = /^\/social-moderation\/(posts|comments)\/([^/]+)\/(approve|hide|restore|delete)\/$/.exec(path);
  if (content) {
    const [, kind, id, action] = content;
    const collection = `/social/${kind}/`;
    if (action === "delete") deleteRow(collection, id);
    else patchRow(collection, id, { moderation_status: CONTENT_MOVES[action], moderation_reason: String(body.reason ?? ""), moderated_at: now() });
    return ok({ id, moderation_status: CONTENT_MOVES[action] ?? "DELETED" });
  }
  if (path === "/social-moderation/mutes/") {
    const target = find(rec, "/users/", body.user);
    const named = { user_id: body.user, display_name: target?.display_name ?? target?.username ?? String(body.user) };
    return ok(addMute(rec, named, Number(body.days ?? body.mute_days) || 7, String(body.reason ?? "")), 201);
  }
  return null;
}

function addMute(rec: Recording, user: Row, days: number, reason: string): Row {
  const me = meOf(rec);
  const row = {
    id: newId(),
    user,
    until: new Date(Date.now() + days * 86400000).toISOString(),
    reason,
    created_at: now(),
    created_by: { user_id: me.id, display_name: me.name },
    lifted_at: null,
    lifted_by: null,
    is_active: true,
  };
  addRow("/social-moderation/mutes/", row);
  return row;
}

// ── The soul circle ─────────────────────────────────────────────────────────────────────────────

function social(rec: Recording, path: string, body: Row): Answer | null {
  const me = meOf(rec);
  const by = { author: me.id, author_name: me.name, author_username: me.name, create_time: now(), moderation_status: "PUBLISHED" };
  if (path === "/social/posts/") {
    const row = {
      ...by,
      id: newId(),
      content: String(body.content ?? ""),
      visibility: body.visibility ?? "PUBLIC",
      comment_count: 0,
      reaction_count: 0,
      media: [],
      reaction_counts: { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
      my_reaction: null,
      edited_at: null,
    };
    addRow("/social/posts/", row);
    return ok(row, 201);
  }
  if (path === "/social/comments/") {
    const row = { ...by, id: newId(), post: body.post, parent: body.parent ?? null, content: String(body.content ?? ""), reaction_count: 0, my_reaction: null };
    addRow("/social/comments/", row);
    const post = find(rec, "/social/posts/", body.post);
    if (post) patchRow("/social/posts/", String(post.id), { comment_count: Number(post.comment_count ?? 0) + 1 });
    return ok(row, 201);
  }
  if (path === "/social/reactions/") {
    const collection = body.post ? "/social/posts/" : "/social/comments/";
    const id = String(body.post ?? body.comment);
    const target = find(rec, collection, id);
    const counts = { ...(target?.reaction_counts as Row | undefined) };
    const type = String(body.reaction_type);
    if (type in counts) counts[type] = Number(counts[type]) + 1;
    if (target) patchRow(collection, id, { my_reaction: type, reaction_count: Number(target.reaction_count ?? 0) + 1, reaction_counts: counts });
    return ok({ id: newId(), reaction_type: type, post: body.post ?? null, comment: body.comment ?? null, user: me.id }, 201);
  }
  return null;
}

// ── Users, roles, dispatch creation, souls ──────────────────────────────────────────────────────

function roles(rec: Recording, path: string, body: Row): Answer | null {
  const current = () => (read(rec, "/perm/roles/", qs()).data as Row[]) ?? [];
  const save = (rows: Row[]) => {
    getOverlay().docs["/perm/roles/"] = rows;
  };
  const created = (fields: Row): Row => ({
    id: 1000 + getOverlay().seq++,
    description: "",
    user_count: 0,
    member_count: 0,
    permission_count: 0,
    workflow_template_count: 0,
    is_builtin: false,
    version: 0,
    update_time: now(),
    ...fields,
  });
  if (path === "/perm/roles/create/") {
    const row = created({ name: body.name, display_name: body.display_name ?? body.name, description: body.description ?? "" });
    save([...current(), row]);
    return ok(row, 201);
  }
  const copy = /^\/perm\/roles\/(\d+)\/copy\/$/.exec(path);
  if (copy) {
    const source = current().find((r) => String(r.id) === copy[1]);
    const row = created({ ...source, ...created({}), name: body.name, display_name: body.display_name ?? body.name, permission_count: source?.permission_count ?? 0 });
    save([...current(), row]);
    return ok(row, 201);
  }
  return null;
}

function roleEdit(rec: Recording, method: string, path: string, body: Row): Answer | null {
  const m = /^\/perm\/roles\/(\d+)\/$/.exec(path);
  if (!m || (method !== "PUT" && method !== "DELETE" && method !== "PATCH")) return null;
  const rows = (read(rec, "/perm/roles/", qs()).data as Row[]) ?? [];
  const next = method === "DELETE" ? rows.filter((r) => String(r.id) !== m[1]) : rows.map((r) => (String(r.id) === m[1] ? { ...r, ...body, update_time: now() } : r));
  getOverlay().docs["/perm/roles/"] = next;
  return method === "DELETE" ? ok(null, 204) : ok(next.find((r) => String(r.id) === m[1]));
}

function users(rec: Recording, path: string, body: Row): Answer | null {
  if (path === "/users/" || path === "/users/invite/") {
    const template = rowsNow(rec, "/users/")[0] ?? {};
    const me = meOf(rec);
    const row = {
      ...template,
      id: 100000 + getOverlay().seq++,
      username: body.username ?? String(body.email ?? "").split("@")[0],
      email: body.email ?? "",
      first_name: body.first_name ?? "",
      last_name: body.last_name ?? "",
      display_name: body.display_name ?? body.username,
      role: body.role ?? template.role,
      tenant: me.tenant ?? template.tenant,
      is_active: true,
      create_time: now(),
      extra_roles: [],
      invite_pending: path === "/users/invite/",
      mfa: { enabled: false, required: false, confirmed_at: null, last_used_at: null },
    };
    addRow("/users/", row);
    return ok(row, 201);
  }
  const batch = /^\/users\/batch_(activate|deactivate)\/$/.exec(path);
  if (batch) {
    const ids = (body.user_ids ?? []) as string[];
    ids.forEach((id) => patchRow("/users/", id, { is_active: batch[1] === "activate" }));
    return ok({ updated: ids.length });
  }
  return null;
}

function dispatchCreate(rec: Recording, path: string, body: Row): Answer | null {
  if (path !== "/dispatch/records/" && path !== "/dispatch/records/drafts/") return null;
  const soul = find(rec, "/souls/", body.soul);
  const tenants = rowsNow(rec, "/dispatch/records/");
  const target = tenants.find((d) => d.target_tenant === body.target_tenant);
  const row = {
    ...(tenants[0] ?? {}),
    ...body,
    id: newId(),
    soul_name: soul?.name ?? "",
    source_tenant: meOf(rec).tenant ? (meOf(rec).tenant as Row).id : tenants[0]?.source_tenant,
    source_tenant_code: meOf(rec).tenant ? (meOf(rec).tenant as Row).code : tenants[0]?.source_tenant_code,
    target_tenant_code: target?.target_tenant_code ?? tenants[0]?.target_tenant_code,
    status: path.endsWith("drafts/") ? "DRAFT" : "PROPOSED",
    proposed_at: now(),
    executed_at: null,
    returned_at: null,
  };
  addRow("/dispatch/records/", row);
  return ok(row, 201);
}

function soulDies(rec: Recording, path: string): Answer | null {
  const m = /^\/souls\/([^/]+)\/die\/$/.exec(path);
  if (!m) return null;
  const soul = find(rec, "/souls/", m[1]);
  if (!soul) return null;
  const when = new Date();
  patchRow("/souls/", m[1], { current_state: "JUDGING", death_date: { year: when.getFullYear(), month: when.getMonth() + 1, day: when.getDate() } });
  const template = rowsNow(rec, "/judgment/").find((j) => j.civilization === soul.civilization) ?? rowsNow(rec, "/judgment/")[0] ?? {};
  addRow("/judgment/", {
    ...template,
    id: newId(),
    case_number: `DEMO-${getOverlay().seq}`,
    soul: m[1],
    soul_name: soul.name,
    verdict: null,
    is_final: false,
    concluded_at: null,
    notes: "",
    claimed_by: null,
    claimed_by_name: null,
    deferred_at: null,
    can_edit: true,
    city_god_status: "SENT_ON",
    created_at: now(),
    workflow: null,
  });
  logEvent(rec, m[1], soul.name, "JUDGMENT_INITIATED", {});
  return detail(rec, "/souls/", m[1]);
}

/**
 * `GET /judgment/next/`, `previous/`: the triage queue's cursor. The server counts live rows, so a recording of it can
 * never tick down: same order and same counting here (`_pending_queue`, `_cursor_order`, backend/apps/judgment/views.py).
 * What a case's card carries (soul, ledger, realms) is recorded per case, under `?at=<id>`.
 */
function cursor(rec: Recording, path: string, query: URLSearchParams): Answer {
  const me = meOf(rec).id;
  const skips = new Set(query.getAll("skip").flatMap((v) => v.split(",")));
  const includeDeferred = ["1", "true", "yes"].includes((query.get("include_deferred") ?? "").toLowerCase());
  const created = (row: Row) => String(row.created_at);
  const queue = rowsNow(rec, "/judgment/")
    .filter((row) => inQueue(row) && (includeDeferred || !row.deferred_at))
    .sort((a, b) => Number(b.claimed_by === me) - Number(a.claimed_by === me) || created(a).localeCompare(created(b)));
  const left = queue.filter((row) => !skips.has(String(row.id)));
  const at = query.get("at");
  const after = query.get("after");
  const before = path.endsWith("previous/");
  const anchor = queue.findIndex((row) => row.id === (at ?? after));
  let target: Row | undefined;
  if (before) target = anchor > 0 ? queue[anchor - 1] : undefined;
  else if (after) target = queue.slice(anchor + 1).find((row) => !skips.has(String(row.id)));
  else if (at) target = rowsNow(rec, "/judgment/").find((row) => row.id === at);
  else target = left[0];
  const counts = {
    total: queue.length,
    remaining: left.length,
    skipped: queue.length - left.length,
    position: left.length ? queue.length - left.length + 1 : null,
  };
  if (!target) return ok({ ...counts, judgment: null });
  const card = read(rec, "/judgment/next/", new URLSearchParams({ at: String(target.id) })).data as Row;
  return ok({ ...card, ...counts, judgment: { ...(card.judgment as Row | undefined), ...target } });
}

function sentenceRequest(rec: Recording, path: string, body: Row): Answer | null {
  const m = /^\/sentence-plans\/([^/]+)\/requests\/([^/]+)\/(decide|withdraw)\/$/.exec(path);
  if (!m) return null;
  const status = m[3] === "withdraw" ? "WITHDRAWN" : body.accept === false ? "REJECTED" : "ACCEPTED";
  patchRow("/sentence-plans/", m[2], { status, decision_reason: String(body.reason ?? ""), decided_at: now() });
  return detail(rec, "/sentence-plans/", m[1]);
}

function recycleBin(rec: Recording, path: string, body: Row): Answer | null {
  const bin = "/recycle-bin/";
  if (path === `${bin}hard-delete/`) {
    dropFromList(bin, String(body.id));
    return ok(null, 204);
  }
  if (path !== `${bin}restore/`) return null;
  const entries = rowsNow(rec, bin).filter((row) => row.cascade_id === body.cascade_id);
  for (const entry of entries) {
    dropFromList(bin, String(entry.id));
    if (entry.entity_type !== "soul") continue;
    const template = rowsNow(rec, "/souls/")[0] ?? {};
    addRow("/souls/", { ...template, id: entry.id, name: entry.label, current_state: "ALIVE", death_date: null, is_archived: false, create_time: now() });
  }
  return ok({ restored: entries.length });
}

/** A write with mainline behaviour, or null for the generic rule. */
/** One of the 42 negative confessions: the whole list comes back, as the server answers (F-DEMO-02). */
function confession(rec: Recording, method: string, path: string, body: Row): Answer | null {
  const m = /^(\/judgment\/[^/]+\/negative-confessions\/)(\d+)\/$/.exec(path);
  if (!m || method !== "PUT") return null;
  const list = read(rec, m[1], qs()).data as { items?: Row[]; tally?: Row | null } | null;
  if (!list || !Array.isArray(list.items)) return null;
  const items = list.items.map((row) => (String(row.ordinal) === m[2] ? { ...row, truthful: body.truthful ?? null, note: String(body.note ?? "") } : row));
  const count = (want: boolean | null) => items.filter((row) => (row.truthful ?? null) === want).length;
  const next = { ...list, items, tally: { truthful: count(true), untruthful: count(false), unheard: count(null), total: items.length } };
  getOverlay().docs[m[1]] = next;
  return ok(next);
}

export function flow(rec: Recording, method: string, path: string, _query: URLSearchParams, body: Row): Answer | null {
  const edited = roleEdit(rec, method, path, body) ?? confession(rec, method, path, body);
  if (edited) return edited;
  if (method !== "POST") return null;
  const ai = aiWrite(rec, method, path, body);
  if (ai) return ai;
  // A warrant issued takes its soul off 「阳寿已到」, which `elsewhere.capture_due` counts; the warrant row itself is generic.
  if (path === "/dispatch/capture-warrants/" && body.soul) dropFromList("/dispatch/capture-warrants/due/", String(body.soul));
  const approve = /^\/workflows\/([^/]+)\/approve_node\/$/.exec(path);
  if (approve) return approveNode(rec, approve[1], body);
  if (path === "/notifications/mark_all_read/") {
    const unread = rowsNow(rec, "/notifications/").filter((n) => !n.is_read);
    unread.forEach((n) => patchRow("/notifications/", String(n.id), { is_read: true }));
    return ok({ marked_read: unread.length });
  }
  if (path === "/notifications/batch-read/" || path === "/notifications/batch-delete/") {
    const ids = (body.ids ?? []) as number[];
    if (path.endsWith("batch-read/")) ids.forEach((id) => patchRow("/notifications/", id, { is_read: true }));
    else ids.forEach((id) => deleteRow("/notifications/", id));
    return ok(path.endsWith("batch-read/") ? { marked_read: ids.length } : { deleted: ids.length });
  }
  for (const [pattern, collection, patch] of STATUS_MOVES) {
    const m = pattern.exec(path);
    if (m) {
      patchRow(collection, m[1], patch(body, meOf(rec)));
      return detail(rec, collection, m[1]);
    }
  }
  return (
    inboxWrite(rec, path, body) ??
    sentenceRequest(rec, path, body) ??
    recycleBin(rec, path, body) ??
    judgmentWrite(rec, path, body) ??
    moderation(rec, path, body) ??
    social(rec, path, body) ??
    roles(rec, path, body) ??
    users(rec, path, body) ??
    dispatchCreate(rec, path, body) ??
    soulDies(rec, path)
  );
}

/**
 * A recorded answer asked at a path like this one (`pattern`) with the same values for `names`, whatever else differs:
 * the recorder asked the parameterised GETs with real values (`sweepWithParams` in scripts/demo-record.mjs), and this
 * finds the one that answers a row the visitor made, or a parameter the screen adds that the recording did not.
 */
function recordedLike(rec: Recording, pattern: RegExp, query: URLSearchParams, names: string[]): Answer | null {
  for (const [key, doc] of Object.entries(rec.docs)) {
    const [path, q = ""] = key.split("?");
    if (doc.s !== 200 || !pattern.test(path)) continue;
    const recorded = new URLSearchParams(q);
    if (names.every((n) => recorded.get(n) === query.get(n))) return ok(doc.b);
  }
  return null;
}

/** The reads the server computes from the current state, which a recording of them could not follow. */
export function derived(rec: Recording, path: string, query: URLSearchParams): Answer | null {
  if (path === "/demo/tour/") return ok(tourOf(rec));
  const ai = aiRead(rec, path, query);
  if (ai) return ai;
  // The case types depend only on the soul's civilization (`VALID_CASE_TYPES_BY_CIVILIZATION`), recorded per civilization.
  if (path === "/workflows/case-types/" && query.has("soul")) {
    const civilization = find(rec, "/souls/", query.get("soul"))?.civilization;
    if (civilization) return read(rec, path, new URLSearchParams({ civilization: String(civilization) }));
  }
  // Who may sit depends on the invited hall and the seat, not on the bench: recorded on the seed's one PROPOSED bench.
  if (/^\/dispatch\/cross-tenant-judgments\/[^/]+\/seatable-actors\/$/.test(path) && !rec.docs[`${path}?role=${query.get("role")}&tenant_code=${query.get("tenant_code")}`]) {
    const seats = recordedLike(rec, /^\/dispatch\/cross-tenant-judgments\/[^/]+\/seatable-actors\/$/, query, ["role", "tenant_code"]);
    if (seats) return seats;
  }
  // A node's approver, by the node: the inspector may add a civilization the recording asked without.
  if (/^\/workflow\/templates\/[^/]+\/approver-preview\/$/.test(path)) {
    const exact = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const answer = recordedLike(rec, exact, query, ["node", "civilization"]) ?? recordedLike(rec, exact, query, ["node"]);
    if (answer) return answer;
  }
  if (path === "/judgment/next/" || path === "/judgment/previous/") return cursor(rec, path, query);
  const inbox = inboxRead(rec, path, query);
  if (inbox) return inbox;
  // 待办的件数跟着这个世界走:录制时的数字是「这个账号本人待办」,而演示里这些事都归他。
  if (path === "/officer-app/todo/") {
    const todo = read(rec, path, query).data as Record<string, { count: number; items: unknown[] }>;
    const flows = rowsNow(rec, "/workflows/").filter((w) => w.status === "IN_PROGRESS");
    const count = (n: number) => ({ count: n, items: [] });
    return ok({
      ...todo,
      approvals: count(flows.filter((w) => w.case_type !== "REBIRTH_APPLICATION").length),
      rebirths: count(flows.filter((w) => w.case_type === "REBIRTH_APPLICATION").length),
      ...letterCounts(rec),
    });
  }
  if (path === "/judgment/" && ["group", "has_verdict", "verdict_null", "source", "civilization"].some((k) => query.has(k))) {
    const me = meOf(rec).id;
    const group = query.get("group");
    const hasVerdict = query.get("has_verdict");
    // `source` and `civilization` are columns of the decorated rows, so `listOf` filters them like any other.
    const rows = judgmentsNow(rec).filter((row) => {
      if (group && (!inQueue(row) || groupOf(row, me) !== group)) return false;
      if (hasVerdict === "true" && row.verdict == null) return false;
      if ((hasVerdict === "false" || query.get("verdict_null") === "true") && row.verdict != null) return false;
      return true;
    });
    return listOf(rows, query, {});
  }
  // The review queue's default is what is still open; what was handled moved to the 已处理 tab (`moderation`).
  if (path === "/social-moderation/reports/" && !query.has("status")) {
    return listOf(rowsNow(rec, path).filter((row) => row.status === "OPEN"), query, {});
  }
  // The real feed is who you follow; a visitor came to see the circle, so here it is everyone's posts.
  if (path === "/social/posts/feed/") return listOf(rowsNow(rec, "/social/posts/"), query, {});
  if (path === "/judgment/queue-counts/") return queueCounts(rec, query);
  if (path === "/dispatch/records/proposed/" || path === "/dispatch/records/history/") {
    const pending = path.endsWith("proposed/");
    const rows = rowsNow(rec, "/dispatch/records/").filter((d) => (d.status === "PROPOSED") === pending && d.status !== "DRAFT");
    return listOf(rows, query, {});
  }
  if (path === "/disposition/") {
    const all = rowsNow(rec, path);
    const counts: Record<string, number> = {};
    for (const row of all) counts[String(row.section)] = (counts[String(row.section)] ?? 0) + 1;
    const recorded = (rec.lists[path]?.extra.section_counts ?? {}) as Record<string, number>;
    const sectionCounts = Object.fromEntries(Object.keys({ ...recorded, ...counts }).map((k) => [k, counts[k] ?? 0]));
    return listOf(all, query, { section_counts: sectionCounts });
  }
  const workflow = /^\/workflows\/([^/]+)\/$/.exec(path);
  if (workflow) {
    const answer = read(rec, path, query);
    const row = answer.data as Row | null;
    if (answer.status === 200 && row && row.status === "IN_PROGRESS") return ok({ ...row, can_approve: true });
    return answer;
  }
  return null;
}
