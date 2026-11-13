/**
 * 「工程视角」(`demo/inside.ts`) reads only what the recordings hold: a probe, a count or an audit row the recording does
 * not have comes back `null`, never a stand-in. The last two tests read the real recordings, through the same loader.
 */
import { auditFor, awayView, clampStep, hallOf, insideCase, totalOf } from "@/demo/inside";
import { type Recording, recording } from "@/demo/store";

type Row = Record<string, unknown>;
const rec = (lists: Record<string, Row[]>, docs: Recording["docs"] = {}): Recording => ({
  role: "judge",
  lang: "zh",
  recordedAt: "2026-11-12T00:00:00Z",
  login: { user: {} },
  lists: Object.fromEntries(Object.entries(lists).map(([k, rows]) => [k, { rows, extra: {} }])),
  docs,
});
const souls = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix}${i}`, current_state: "JUDGING" }));

describe("hallOf", () => {
  it("counts the judge's list, shows four rows, and probes the other hall's first soul", () => {
    const cn = rec({ "/souls/": souls("cn", 34) }, { "/souls/eu-0/": { s: 404, b: { detail: "Not found." } } });
    const eu = rec({ "/souls/": souls("eu", 16) });
    const hall = hallOf(cn, eu);
    expect(hall.count).toBe(34);
    expect(hall.rows.map((r) => r.id)).toEqual(["cn-0", "cn-1", "cn-2", "cn-3"]);
    expect(hall.probe).toEqual({ path: "/souls/eu-0/", status: 404, body: { detail: "Not found." } });
  });

  it("an unrecorded probe has no status (the page says so) rather than the demo's own 404", () => {
    const hall = hallOf(rec({ "/souls/": souls("cn", 3) }), rec({ "/souls/": souls("eu", 1) }));
    expect(hall.probe).toEqual({ path: "/souls/eu-0/", status: null, body: null });
  });

  it("a list at the recorder's page cap is not a count, and a missing list is no count at all", () => {
    expect(hallOf(rec({ "/souls/": souls("cn", 200) }), null).count).toBeNull();
    expect(hallOf(rec({}), null)).toEqual({ count: null, rows: [], probe: null });
    expect(totalOf(null)).toBeNull();
    expect(totalOf(rec({ "/souls/": souls("all", 86) }))).toBe(86);
  });
});

const PLAN = {
  id: "plan-1",
  soul: "soul-1",
  soul_name: "项羽",
  tenant_code: "CN_DIYU",
  status: "ACTIVE",
  cross_judgment_id: "ctj-1",
  nodes: [
    { order: 2, tenant_code: "GR_HADES", realm_code: "GR_TARTARUS", sentence_years: 10, status: "PENDING" },
    { order: 1, tenant_code: "CN_DIYU", realm_code: "DY_COURT_07_TAISHAN", sentence_years: 60, status: "ACTIVE" },
  ],
};
const CTJ = { id: "ctj-1", title: "项羽案·两界会审", status: "CONCLUDED", participants: [{ id: "seat-1", participant_tenant_code: "GR_HADES" }] };

describe("insideCase", () => {
  const home = rec({}, {
    "/sentence-plans/plain/": { s: 200, b: { ...PLAN, id: "plain", cross_judgment_id: null } },
    "/sentence-plans/plan-1/": { s: 200, b: PLAN },
    "/dispatch/cross-tenant-judgments/ctj-1/": { s: 200, b: CTJ },
  });

  it("is the first plan with a joint judgment, its stops in order, the other hall from the stops", () => {
    const c = insideCase(home)!;
    expect(c).toMatchObject({ planId: "plan-1", home: "CN_DIYU", away: "GR_HADES", awaySkin: "gr", soulName: "项羽" });
    expect(c.nodes.map((n) => n.order)).toEqual([1, 2]);
    expect(c.cross).toEqual({ id: "ctj-1", title: "项羽案·两界会审", status: "CONCLUDED", participantId: "seat-1" });
  });

  it("no cross-hall plan, no case", () => {
    expect(insideCase(rec({}, { "/sentence-plans/plain/": { s: 200, b: { ...PLAN, cross_judgment_id: null } } }))).toBeNull();
  });

  it("the other hall's view is what its own recording holds", () => {
    const c = insideCase(home)!;
    const gr = rec({ "/souls/": souls("gr", 2) }, { "/sentence-plans/plan-1/": { s: 200, b: PLAN } });
    expect(awayView(gr, c)).toEqual({ readsPlan: true, listsSoul: false });
    expect(awayView(null, c)).toBeNull();
  });

  it("audit rows are the administrator's, by resource id and the step's action; none recorded is null, not empty", () => {
    const c = insideCase(home)!;
    expect(auditFor(rec({}), c, 1)).toBeNull();
    const admin = rec({
      "/audit-logs/?resource_id=ctj-1": [
        { id: 2, action: "UPDATE", resource_id: "ctj-1", timestamp: "2026-01-02" },
        { id: 1, action: "CREATE", resource_id: "ctj-1", timestamp: "2026-01-01" },
      ],
      "/audit-logs/?resource_id=seat-1": [{ id: 3, action: "CREATE", resource_id: "seat-1", timestamp: "2026-01-01T01" }],
      "/audit-logs/?resource_id=plan-1": [],
    });
    expect(auditFor(admin, c, 1)!.map((r) => r.id)).toEqual([1, 3]);
    expect(auditFor(admin, c, 3)!.map((r) => r.id)).toEqual([2]);
    expect(auditFor(admin, c, 4)).toEqual([]);
  });
});

it("steps stay within one to four", () => {
  expect([0, 1, 4, 5, Number.NaN].map(clampStep)).toEqual([1, 1, 4, 4, 1]);
});

describe("the recordings this page reads", () => {
  it("the CN judge's recording has a cross-hall case, and the other hall's recording reads its plan but does not list the soul", async () => {
    const c = insideCase(await recording("judge", "zh"));
    expect(c).not.toBeNull();
    expect(c!.away).not.toBe(c!.home);
    const view = awayView(await recording(`judge_${c!.awaySkin}` as "judge_gr", "zh"), c!);
    expect(view).toEqual({ readsPlan: true, listsSoul: false });
  });

  it("both judges' lists are their own hall only, and the hall-less administrator's is all of them", async () => {
    const [cn, eu, admin] = await Promise.all([recording("judge", "zh"), recording("judge_eu", "zh"), recording("admin", "zh")]);
    const codes = (r: Recording) => new Set(r.lists["/souls/"].rows.map((row) => row.tenant_code));
    expect([...codes(cn)]).toEqual(["CN_DIYU"]);
    expect([...codes(eu)]).toEqual(["EU_HEAVEN_HELL"]);
    expect(codes(admin).size).toBe(4);
  });
});
