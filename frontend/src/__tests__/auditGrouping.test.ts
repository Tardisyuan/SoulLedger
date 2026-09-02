/**
 * Tests for the audit "events, not writes" grouping (design doc §9).
 * Grouping is by AuditLog.trace_id — an exact correlation id already
 * populated per-request by backend/apps/audit/signals.py's
 * _get_trace_id() — not a client-side actor+verb+timestamp heuristic.
 */
import { groupAuditLogsByTrace } from "@/lib/auditGrouping";
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
