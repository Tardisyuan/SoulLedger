/**
 * Tests for the audit "events, not writes" grouping (design doc §9).
 * Grouping is by AuditLog.trace_id — an exact correlation id already
 * populated per-request by backend/apps/audit/signals.py's
 * _get_trace_id() — not a client-side actor+verb+timestamp heuristic.
 */
import { collapseRepeats, groupAuditLogsByTrace, REPEAT_WINDOW_MS } from "@/lib/auditGrouping";
import type { AuditLogEntry } from "@soulledger/core/api/audit";

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    action: "CREATE",
    resource: "soul",
    resource_id: "1",
    changes: null,
    ip_address: "192.168.2.200",
    user_agent: null,
    description: "",
    timestamp: "2026-08-02T21:10:45.000Z",
    username: "admin",
    tenant_code: "T1",
    user_display: "admin",
    trace_id: "",
    ...overrides,
  };
}

describe("groupAuditLogsByTrace", () => {
  it("folds two rows sharing a trace_id into one event", () => {
    const rows = [
      entry({ id: 1, resource: "loginlog", resource_id: "190", trace_id: "trace-abc", timestamp: "2026-08-02T21:10:45.500Z" }),
      entry({ id: 2, resource: "outstandingtoken", resource_id: "44", trace_id: "trace-abc", timestamp: "2026-08-02T21:10:45.100Z" }),
    ];

    const groups = groupAuditLogsByTrace(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].resources).toEqual(["loginlog", "outstandingtoken"]);
    // Preserves the original (API) row order rather than re-sorting by time.
    expect(groups[0].resourceDetail).toBe("loginlog#190, outstandingtoken#44");
  });

  it("uses the earliest timestamp in the group as the event time", () => {
    const rows = [
      entry({ id: 1, trace_id: "trace-abc", timestamp: "2026-08-02T21:10:45.900Z" }),
      entry({ id: 2, trace_id: "trace-abc", timestamp: "2026-08-02T21:10:45.100Z" }),
    ];

    const [group] = groupAuditLogsByTrace(rows);
    expect(group.time).toBe("2026-08-02T21:10:45.100Z");
  });

  it("never merges rows across two different trace_ids", () => {
    const rows = [
      entry({ id: 1, trace_id: "trace-abc" }),
      entry({ id: 2, trace_id: "trace-other" }),
    ];

    const groups = groupAuditLogsByTrace(rows);
    expect(groups).toHaveLength(2);
  });

  it("treats a blank trace_id as a singleton — it groups with nobody", () => {
    const rows = [
      entry({ id: 1, trace_id: "" }),
      entry({ id: 2, trace_id: "" }),
    ];

    const groups = groupAuditLogsByTrace(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[1].entries).toHaveLength(1);
  });

  it("reports every distinct action in the group, not just the first", () => {
    const rows = [
      entry({ id: 1, action: "CREATE", trace_id: "trace-mixed" }),
      entry({ id: 2, action: "UPDATE", trace_id: "trace-mixed" }),
    ];

    const [group] = groupAuditLogsByTrace(rows);
    expect(group.action).toBe("CREATE");
    expect(group.distinctActions).toEqual(["CREATE", "UPDATE"]);
  });

  it("dedupes descriptions so a repeated write doesn't repeat the summary line", () => {
    const rows = [
      entry({ id: 1, description: "Soul judged", trace_id: "trace-abc" }),
      entry({ id: 2, description: "Soul judged", trace_id: "trace-abc" }),
      entry({ id: 3, description: "", trace_id: "trace-abc" }),
    ];

    const [group] = groupAuditLogsByTrace(rows);
    expect(group.descriptions).toEqual(["Soul judged"]);
  });

  it("keeps rows in their original relative order, newest group first", () => {
    const rows = [
      entry({ id: 1, trace_id: "trace-newest", timestamp: "2026-08-02T21:10:45.000Z" }),
      entry({ id: 2, trace_id: "trace-oldest", timestamp: "2026-08-02T20:00:00.000Z" }),
    ];

    const groups = groupAuditLogsByTrace(rows);
    expect(groups.map((g) => g.traceId)).toEqual(["trace-newest", "trace-oldest"]);
  });
});

/**
 * 合并同类 — the heuristic fold on top of the exact one. Every rule below has
 * its own split case, because "these ten rows became one" is only half the
 * claim: the other half is that a row which differs in ANY compared field (or
 * sits past the window, or across midnight) keeps its own line.
 */
describe("collapseRepeats", () => {
  // Local wall-clock times, so the day-boundary cases mean the same thing in
  // any TZ the suite runs under.
  const at = (day: number, h: number, m: number, s = 0, ms = 0) =>
    new Date(2026, 0, day, h, m, s, ms).toISOString();
  let nextId = 1;
  const ev = (over: Partial<AuditLogEntry>) => entry({ id: nextId++, ...over });
  const runsOf = (rows: AuditLogEntry[], windowMs?: number) =>
    collapseRepeats(groupAuditLogsByTrace(rows), windowMs).map((r) => r.members.map((g) => g.entries[0].id));

  beforeEach(() => {
    nextId = 1;
  });

  it("folds consecutive same-actor, same-action, same-resource events into one run", () => {
    const rows = [0, 1, 2].map((m) => ev({ timestamp: at(2, 10, m), resource_id: String(m) }));
    expect(runsOf(rows)).toEqual([[1, 2, 3]]);
  });

  it("merges at exactly the window and splits one millisecond past it", () => {
    const edge = [ev({ timestamp: at(2, 10, 0) }), ev({ timestamp: at(2, 10, 5) })];
    expect(runsOf(edge)).toEqual([[1, 2]]);
    nextId = 1;
    const past = [ev({ timestamp: at(2, 10, 0) }), ev({ timestamp: at(2, 10, 5, 0, 1) })];
    expect(runsOf(past)).toEqual([[1], [2]]);
    expect(REPEAT_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("chains on the gap between neighbours, not the distance from the first", () => {
    const rows = [0, 4, 8, 12].map((m) => ev({ timestamp: at(2, 10, m) }));
    expect(runsOf(rows)).toEqual([[1, 2, 3, 4]]);
  });

  it.each([
    ["actor", { username: "judge" }],
    ["action", { action: "UPDATE" }],
    ["resource type", { resource: "menu" }],
  ])("keeps a row apart when its %s differs", (_label, over) => {
    const rows = [ev({ timestamp: at(2, 10, 0) }), ev({ timestamp: at(2, 10, 1), ...over }), ev({ timestamp: at(2, 10, 2) })];
    expect(runsOf(rows)).toEqual([[1], [2], [3]]);
  });

  it("does not merge across local midnight even inside the window", () => {
    const rows = [ev({ timestamp: at(2, 23, 59) }), ev({ timestamp: at(3, 0, 1) })];
    expect(runsOf(rows)).toEqual([[1], [2]]);
  });

  it("works on newest-first input too (the page's default order)", () => {
    const rows = [ev({ timestamp: at(2, 10, 2) }), ev({ timestamp: at(2, 10, 1) }), ev({ timestamp: at(2, 10, 0) })];
    expect(runsOf(rows)).toEqual([[1, 2, 3]]);
  });
});
