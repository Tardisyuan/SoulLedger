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
  it("lists every open plain flow as an approval, and `?kind=` answers that one group as {count, items}", () => {
    const open = rowsNow(rec, "/workflows/").filter((w) => w.status === "IN_PROGRESS" && w.case_type !== "REBIRTH_APPLICATION");
    expect(open.length).toBeGreaterThan(0);
    const todo = get("/officer-app/todo/") as Record<string, { count: number; items: Row[] }>;
    expect(todo.approvals.count).toBe(open.length);
    const openIds = new Set(open.map((w) => w.id));
    expect(todo.approvals.items.every((i) => i.kind === "approval" && openIds.has((i.target as Row).id))).toBe(true);
    expect(todo.approvals.items.length).toBe(Math.min(10, open.length));
    const group = get("/officer-app/todo/", { kind: "approval", offset: "0" });
    expect(Object.keys(group).sort()).toEqual(["count", "items"]);
    expect(group.count).toBe(open.length);
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

  it("an approval decided to its end leaves the group", () => {
    const flow = rowsNow(rec, "/workflows/").find((w) => w.status === "IN_PROGRESS" && w.case_type !== "REBIRTH_APPLICATION")!;
    const before = (get("/officer-app/todo/", { kind: "approval" }) as { count: number }).count;
    for (let i = 0; i < 20 && rowsNow(rec, "/workflows/").find((w) => w.id === flow.id)?.status === "IN_PROGRESS"; i++) {
      post(`/workflows/${flow.id}/approve_node/`, { verdict: "PASSED" });
    }
    expect((get("/officer-app/todo/", { kind: "approval" }) as { count: number }).count).toBe(before - 1);
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
