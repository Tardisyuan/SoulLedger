/**
 * What the demo answered wrong or not at all (review 2026-11-21): the officer app's reads the web makes (待办 and its
 * `?kind=` groups, 我的数, a waiting item), the reassign-request filter, moving a soul's station, and who decided a
 * dispatch. Each is computed from the rows as they stand, so the numbers follow what the visitor does.
 */
import { derived } from "@/demo/flows";
import { type Recording, read, recording, resetOverlay, rowsNow } from "@/demo/store";
import { write } from "@/demo/writes";

type Row = Record<string, unknown>;
let rec: Recording;
beforeAll(async () => {
  rec = await recording("judge", "zh");
});
beforeEach(() => resetOverlay());

const get = (path: string, query: Record<string, string> = {}) => {
  const q = new URLSearchParams(query);
  return (derived(rec, path, q) ?? read(rec, path, q)).data as Row;
};
const post = (path: string, body: Row = {}) => write(rec, "POST", path, new URLSearchParams(), body);
const me = () => (rec.login.user as Row).id;

describe("/officer-app/todo/", () => {
  type Todo = Record<string, { count: number; items: Row[] }>;
  const ids = (todo: Todo, field: string) => todo[field].items.map((i) => (i.target as Row).id).sort();

  // The server lists a flow only when its current stop names this account (todo.py `_waiting_workflows`); the
  // recording holds what it answered, so the demo's computed lists must be those, for a judge and for the admin.
  it.each(["judge", "judge_eg", "judge_eu", "admin"] as const)("%s: approvals and rebirths are the server's, not every open flow", async (role) => {
    const r = await recording(role, "zh");
    const recorded = read(r, "/officer-app/todo/", new URLSearchParams()).data as Todo;
    const todo = derived(r, "/officer-app/todo/", new URLSearchParams())!.data as Todo;
    for (const field of ["approvals", "rebirths"]) {
      expect(todo[field].count).toBe(recorded[field].count);
      expect(ids(todo, field)).toEqual(ids(recorded, field));
    }
  });

  it("an open flow whose stop names someone else is not this judge's: absent from the list, and not decidable", () => {
    // What the server said of each when the recording asked it (`can_approve` is per requester).
    const recordedCan = (id: unknown) => (read(rec, `/workflows/${id}/`, new URLSearchParams()).data as Row | null)?.can_approve;
    const theirs = rowsNow(rec, "/workflows/").filter((w) => w.status === "IN_PROGRESS" && recordedCan(w.id) === false);
    expect(theirs.length).toBeGreaterThan(0);
    const listed = new Set(ids(get("/officer-app/todo/") as Todo, "approvals"));
    for (const w of theirs) {
      expect(listed.has(w.id)).toBe(false);
      expect(get(`/workflows/${w.id}/`).can_approve).toBe(false);
    }
  });

  it("`?kind=` answers that one group as {count, items}", () => {
    const whole = get("/officer-app/todo/") as Todo;
    const group = get("/officer-app/todo/", { kind: "rebirth", offset: "0" });
    expect(Object.keys(group).sort()).toEqual(["count", "items"]);
    expect(group.count).toBe(whole.rebirths.count);
    // Not the whole to-do: no other group's field is in the answer.
    expect(get("/officer-app/todo/", { kind: "wangsi", offset: "0" })).not.toHaveProperty("approvals");
  });

  it("a rebirth row is named by its application, and its item knows the flow to open", () => {
    const todo = get("/officer-app/todo/") as Record<string, { count: number; items: Row[] }>;
    const row = todo.rebirths.items[0];
    if (!row) return; // a recording with no rebirth flow open
    const app = rowsNow(rec, "/soul-accounts/rebirth-applications/").find((a) => a.id === (row.target as Row).id);
    expect(app).toBeDefined();
    expect(get(`/officer-app/items/rebirth/${app!.id}/`).workflow_id).toBe(app!.appeal_workflow ?? app!.workflow);
  });

  // The one flow a demo account may decide from first stop to last (scripts/demo-seed.py `seed_walkable_flow`): the
  // European judge's 炼狱复核, every stop the role JUDGE's. Decided only while `can_approve` says so, as the screen does.
  it("judge_eu's 炼狱复核 is its approval at every stop, and deciding each one completes it and drops it from the list", async () => {
    const eu = await recording("judge_eu", "zh");
    const todo = () => derived(eu, "/officer-app/todo/", new URLSearchParams())!.data as Todo;
    const detailOf = (id: unknown) => derived(eu, `/workflows/${id}/`, new URLSearchParams())!.data as Row;
    const flow = rowsNow(eu, "/workflows/").find((w) => w.status === "IN_PROGRESS" && w.case_type === "PURGATORY_REVIEW");
    expect(flow).toBeDefined();
    const stops = (detailOf(flow!.id).nodes as Row[]).filter((n) => n.status === "PENDING" && n.kind !== "NOTIFY" && n.kind !== "END");
    expect(stops.length).toBeGreaterThan(1);
    const before = todo().approvals.count;
    let decided = 0;
    for (; decided < 10 && detailOf(flow!.id).can_approve === true; decided++) {
      expect(ids(todo(), "approvals")).toContain(flow!.id);
      write(eu, "POST", `/workflows/${flow!.id}/approve_node/`, new URLSearchParams(), { verdict: "PASSED" });
    }
    expect(decided).toBe(stops.length);
    expect(detailOf(flow!.id).status).toBe("COMPLETED");
    // No stop is left, so nothing is decidable — not the recorded `true` from when it stood open (`get_can_approve`).
    expect(detailOf(flow!.id).can_approve).toBe(false);
    expect(ids(todo(), "approvals")).not.toContain(flow!.id);
    expect(todo().approvals.count).toBe(before - 1);
  });

  it("a decision moves the flow past a 通知 stop; it stays this judge's while the next stop is the judges', then leaves", async () => {
    const eg = await recording("judge_eg", "zh");
    const listed = () => ids(derived(eg, "/officer-app/todo/", new URLSearchParams())!.data as Todo, "approvals");
    const detailOf = (id: unknown) => derived(eg, `/workflows/${id}/`, new URLSearchParams())!.data as Row;
    const flow = rowsNow(eg, "/workflows/").find((w) => w.status === "IN_PROGRESS" && w.case_type !== "REBIRTH_APPLICATION")!;
    const stop = () => ((detailOf(flow.id).nodes as Row[]).find((n) => n.id === detailOf(flow.id).current_node) ?? {}) as Row;
    const decideOnce = () => write(eg, "POST", `/workflows/${flow.id}/approve_node/`, new URLSearchParams(), { verdict: "PASSED" });
    // The recorded chain: 2 the judges' (current), 3 通知, 4 the judges', 5 a named actor's.
    expect([stop().node_order, stop().approver_role]).toEqual([2, "JUDGE"]);
    decideOnce();
    expect([stop().node_order, stop().kind, stop().approver_role]).toEqual([4, "APPROVAL", "JUDGE"]);
    expect(listed()).toContain(flow.id);
    expect(detailOf(flow.id).can_approve).toBe(true);
    decideOnce();
    expect([stop().node_order, stop().approver_type]).toEqual([5, "ACTOR"]);
    expect(listed()).not.toContain(flow.id);
    expect(detailOf(flow.id).can_approve).toBe(false);
  });
});

it("我的数 counts this account's own claims and moves when a case is claimed", () => {
  const before = get("/officer-app/stats/");
  expect(Object.keys(before).sort()).toEqual(["appeals_in_review", "appeals_reviewed", "concluded_this_month", "concluded_total", "open_claims"]);
  const free = rowsNow(rec, "/judgment/").find((j) => j.verdict == null && !j.is_final && j.claimed_by == null)!;
  post(`/judgment/${free.id}/claim/`);
  expect(get("/officer-app/stats/").open_claims).toBe(Number(before.open_claims) + 1);
  expect(rowsNow(rec, "/judgment/").filter((j) => j.verdict != null && j.claimed_by === me()).length).toBe(before.concluded_total);
});

it("?reassign_requested=true is the open cases asked for, not every case", () => {
  const all = rowsNow(rec, "/judgment/").length;
  const asked = get("/judgment/", { reassign_requested: "true" });
  expect(asked.count).toBeLessThan(all);
  expect((asked.results as Row[]).every((j) => j.reassign_requested_at != null && j.verdict == null)).toBe(true);
});

it("moving a soul back a station changes it and logs DIYU_STATION_CHANGED with from, to and the reason", () => {
  const soul = rowsNow(rec, "/souls/").find((s) => s.civilization === "CHINESE" && s.current_state !== "ALIVE")!;
  const from = String(soul.diyu_station ?? "");
  const to = from === "TUDI_TEMPLE" ? "YELLOW_SPRINGS_ROAD" : "TUDI_TEMPLE";
  post(`/souls/${soul.id}/station/`, { station: to, reason: "卷宗有误" });
  expect(get(`/souls/${soul.id}/`).diyu_station).toBe(to);
  const events = get("/events/", { soul: String(soul.id), event_type: "DIYU_STATION_CHANGED", ordering: "create_time" }).results as Row[];
  expect(events.at(-1)?.payload).toEqual({ from, to, via: "officer", reason: "卷宗有误" });
});

it("a dispatch approved names who decided it, and when", () => {
  const proposed = rowsNow(rec, "/dispatch/records/").find((d) => d.status === "PROPOSED");
  if (!proposed) return;
  post(`/dispatch/records/${proposed.id}/approve/`);
  const row = rowsNow(rec, "/dispatch/records/").find((d) => d.id === proposed.id)!;
  expect(row).toEqual(expect.objectContaining({ status: "APPROVED", decided_by: me(), decided_by_name: (rec.login.user as Row).username }));
  expect(typeof row.decided_at).toBe("string");
});
