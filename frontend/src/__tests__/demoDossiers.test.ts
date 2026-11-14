/**
 * The demo's stand-in for `GET /dossiers/desk/` and `GET /dossiers/{id}/` (frontend/demo/flows.ts), which the desk now
 * reads instead of four group lists, queue-counts, hall-stats, the case, the soul and its path. Computed from the
 * recording, so it must say what those endpoints say — the desk and the queue page must not disagree in the demo.
 */
import { derived } from "@/demo/flows";
import { type DemoRole, type Recording, recording, resetOverlay } from "@/demo/store";

type Row = Record<string, unknown>;
const ask = (rec: Recording, path: string, query: Record<string, string> = {}) => derived(rec, path, new URLSearchParams(query))!;

beforeEach(() => resetOverlay());

describe.each<DemoRole>(["judge", "judge_eu"])("%s", (role) => {
  let rec: Recording;
  beforeAll(async () => {
    rec = await recording(role, "zh");
  });

  it("the desk's groups and counts are the queue's", () => {
    const desk = ask(rec, "/dossiers/desk/").data as { groups: { group: string; total: number; rows: Row[] }[]; counts: Row };
    expect(desk.counts).toEqual(ask(rec, "/judgment/queue-counts/").data);
    for (const g of desk.groups) {
      const list = ask(rec, "/judgment/", { group: g.group, ordering: "created_at" }).data as { count: number; results: Row[] };
      expect(g.total).toBe(list.count);
      expect(g.rows.map((r) => r.id)).toEqual(list.results.map((r) => r.id));
    }
    expect(desk.groups.flatMap((g) => g.rows).length).toBeGreaterThan(0);
  });

  it("a source narrows the groups and leaves the counts", () => {
    const all = ask(rec, "/dossiers/desk/").data as { counts: Row };
    const cross = ask(rec, "/dossiers/desk/", { source: "cross" }).data as { groups: { rows: Row[] }[]; counts: Row };
    expect(cross.counts).toEqual(all.counts);
    expect(cross.groups.flatMap((g) => g.rows).every((r) => r.source === "cross")).toBe(true);
  });

  it("a dossier carries its case, its soul and where the soul stands", () => {
    const desk = ask(rec, "/dossiers/desk/").data as { groups: { rows: Row[] }[] };
    const id = String(desk.groups.flatMap((g) => g.rows)[0].id);
    const d = ask(rec, `/dossiers/${id}/`);
    expect(d.status).toBe(200);
    const body = d.data as { judgment: Row; soul: Row | null; soul_redacted: boolean; whereabouts: { spine: Row | null } | null };
    expect(body.judgment.id).toBe(id);
    expect(body.soul_redacted).toBe(body.soul === null);
    if (body.soul) expect((body.soul.records as Row[]).length).toBeLessThanOrEqual(3);
    // An id the recording never had is a 404, as the server says.
    expect(ask(rec, "/dossiers/00000000-0000-4000-8000-000000000000/").status).toBe(404);
  });
});
