/**
 * The bucketed recording (scripts/demo-recording-io.mjs → frontend/demo/store.ts; fe-perf.md P4–P6): a read mockLoads the
 * buckets it reaches and no others, references read as what they stand for, all the keys read in the recorded order
 * whatever order the buckets arrived in, and stamps are moved once per answer, the way the whole-file round trip did.
 * The role here is a stand-in written below; the real recordings are tested by the demo E2E.
 */
const mockRecordedAt = "2026-11-01T00:00:00.000Z";
const NOW = Date.parse("2026-11-11T00:00:00.000Z"); // ten days later
const DELTA = NOW - Date.parse(mockRecordedAt);
const mockLoads: string[] = [];

const mockManifest = {
  prefixes: { "/menus/": "boot", "/souls/": "souls", "/judgment/statutes/": "statutes", "/judgment/": "judgment" },
  fallback: "ops",
  shards: { judgment: 2 },
  buckets: ["souls", "statutes", "judgment", "judgment.0", "judgment.1", "ops"],
};
const mockStatute = (id: string, code: string) => ({ id, code, text: "x".repeat(300), updated_at: "2026-10-31T12:00:00Z" });

// Called inside each factory, so the bodies are built when the store first imports the file (and the import is counted).
function mockBucket(name: string, body: object) {
  mockLoads.push(name);
  return { __esModule: true, default: body };
}

jest.mock(
  "../../demo/data/admin.zh/boot.json",
  () =>
    mockBucket("boot", {
    role: "admin",
    lang: "zh",
    recordedAt: mockRecordedAt,
    login: { user: { id: 1, username: "demo_admin", last_login: "2026-10-31T23:00:00Z" } },
    manifest: mockManifest,
    lists: { "/menus/": { rows: [{ id: 1, name: "home" }], extra: {} } },
    docs: {},
    at: { lists: [0], docs: [] },
  }),
  { virtual: true },
);
jest.mock(
  "../../demo/data/admin.zh/souls.json",
  () =>
    mockBucket("souls", {
    lists: { "/souls/": { rows: [{ id: "s1", name: "A", death_date: "2026-10-30", birth_date: "1283-05-01" }], extra: {} } },
    docs: { "/souls/s1/": { s: 200, b: { id: "s1", name: "A", "2026-10-30": 3, note: "seen at 2026-10-31T10:00:00Z" } } },
    at: { lists: [1], docs: [1] },
  }),
  { virtual: true },
);
jest.mock(
  "../../demo/data/admin.zh/statutes.json",
  () =>
    mockBucket("statutes", {
    // The statute list asked twice, the same rows in another order: once each in the pool.
    lists: {
      "/judgment/statutes/": { rows: [{ "&": "/judgment/statutes/#a" }, { "&": "/judgment/statutes/#b" }], extra: {} },
      "/judgment/statutes/?ordering=code": { rows: [{ "&": "/judgment/statutes/#b" }, { "&": "/judgment/statutes/#a" }], extra: {} },
    },
    docs: { "/judgment/statutes/a/": { s: 200, b: mockStatute("a", "Z9") }, "/judgment/statutes/?format=json": { "=": "/judgment/statutes/a/" } },
    rows: { "/judgment/statutes/#a": mockStatute("a", "Z9"), "/judgment/statutes/#b": mockStatute("b", "A1") },
    at: { lists: [2, 3], docs: [0, 2] },
  }),
  { virtual: true },
);
jest.mock("../../demo/data/admin.zh/judgment.json", () => mockBucket("judgment", { lists: {}, docs: {}, at: { lists: [], docs: [] } }), { virtual: true });
jest.mock("../../demo/data/admin.zh/judgment.0.json", () => mockBucket("judgment.0", { lists: {}, docs: {}, at: { lists: [], docs: [] } }), { virtual: true });
jest.mock("../../demo/data/admin.zh/judgment.1.json", () => mockBucket("judgment.1", { lists: {}, docs: {}, at: { lists: [], docs: [] } }), { virtual: true });
jest.mock("../../demo/data/admin.zh/ops.json", () => mockBucket("ops", { lists: {}, docs: {}, at: { lists: [], docs: [] } }), { virtual: true });

import { type Recording, bootRecording, bucketOf, fnv1a, read, recording, settle, shiftStamps } from "@/demo/store";

const moved = (stamp: string) => new Date(Date.parse(stamp) + DELTA).toISOString();

beforeAll(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

describe("which bucket a path is in", () => {
  it("is the longest prefix, then the shard of the row id", () => {
    expect(bucketOf(mockManifest, "/judgment/statutes/")).toBe("statutes");
    expect(bucketOf(mockManifest, "/judgment/")).toBe("judgment");
    expect(bucketOf(mockManifest, "/judgment/next/")).toBe("judgment");
    expect(bucketOf(mockManifest, "/events/")).toBe("ops");
    const id = "0f8e4b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(bucketOf(mockManifest, `/judgment/${id}/`)).toBe(`judgment.${fnv1a(id) % 2}`);
    expect(bucketOf(mockManifest, `/judgment/${id}/negative-confessions/`)).toBe(bucketOf(mockManifest, `/judgment/${id}/`));
  });

  it("hashes as the recorder does (FNV-1a, 32 bit)", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
});

describe("loading", () => {
  it("signs in on boot alone, and a read mockLoads its own bucket and no other", async () => {
    const boot = await bootRecording("admin", "zh");
    expect(mockLoads).toEqual(["boot"]);
    expect(boot.login.user.last_login).toBe(moved("2026-10-31T23:00:00Z"));

    const soul = await settle("admin", "zh", (rec) => read(rec, "/souls/s1/", new URLSearchParams()), ["/souls/s1/"]);
    expect(soul.status).toBe(200);
    expect(mockLoads).toEqual(["boot", "souls"]);
    expect(mockLoads).not.toContain("judgment");
  });

  it("mockLoads what a read reaches for that it was not told about, then asks again", async () => {
    // Told nothing: the first pass finds no statutes, notes the bucket, and the second pass has them.
    const ids = await settle("admin", "zh", (rec) => ((read(rec, "/judgment/statutes/", new URLSearchParams()).data as { results: { id: string }[] }).results.map((r) => r.id)));
    expect(ids).toEqual(["a", "b"]);
    expect(mockLoads).toContain("statutes");
    expect(mockLoads).not.toContain("ops");
  });

  it("the whole recording has every bucket, and its keys in the recorded order", async () => {
    const rec = await recording("admin", "zh");
    expect(mockLoads).toEqual(expect.arrayContaining(mockManifest.buckets));
    // statutes arrived before souls's second key would put it: the order is the recording's (`at`), not arrival.
    expect(Object.keys(rec.docs)).toEqual(["/judgment/statutes/a/", "/souls/s1/", "/judgment/statutes/?format=json"]);
    expect(Object.keys(rec.lists)).toEqual(["/menus/", "/souls/", "/judgment/statutes/", "/judgment/statutes/?ordering=code"]);
  });
});

describe("references", () => {
  let rec: Recording;
  beforeAll(async () => {
    rec = await recording("admin", "zh");
  });

  it("a doc written as { '=': key } reads as that doc", () => {
    expect(rec.docs["/judgment/statutes/?format=json"]).toEqual(rec.docs["/judgment/statutes/a/"]);
    expect((rec.docs["/judgment/statutes/?format=json"].b as { code: string }).code).toBe("Z9");
  });

  it("a pooled row reads as the row, in each list's own order", () => {
    const codes = (key: string) => rec.lists[key].rows.map((r) => r.code);
    expect(codes("/judgment/statutes/")).toEqual(["Z9", "A1"]);
    expect(codes("/judgment/statutes/?ordering=code")).toEqual(["A1", "Z9"]);
    expect(rec.lists["/judgment/statutes/"].rows[0].updated_at).toBe(moved("2026-10-31T12:00:00Z"));
    expect(JSON.stringify(rec.lists)).not.toContain('"&"');
  });
});

describe("moving the stamps", () => {
  it("moves an answer once, the first time it is read, and keeps it", async () => {
    const rec = await recording("admin", "zh");
    const first = rec.docs["/souls/s1/"];
    expect(rec.docs["/souls/s1/"]).toBe(first);
    const b = first.b as Record<string, unknown>;
    expect(b.note).toBe(`seen at ${moved("2026-10-31T10:00:00Z")}`);
    expect(b["2026-11-09"]).toBe(3); // a bare date as a key moves by whole days
    const row = rec.lists["/souls/"].rows[0];
    expect(row.death_date).toBe("2026-11-09");
    expect(row.birth_date).toBe("1283-05-01"); // a life's history stays put
  });

  it("gives what the old whole-file round trip gave", () => {
    const STAMP = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g;
    const BARE_DATE = /"(\d{4}-\d\d-\d\d)"/g;
    const days = Math.round(DELTA / 86400000) * 86400000;
    const old = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value)
          .replace(STAMP, (s) => (Number(s.slice(0, 4)) < 2024 ? s : new Date(Date.parse(s) + DELTA).toISOString()))
          .replace(BARE_DATE, (w, d: string) => (Number(d.slice(0, 4)) < 2024 ? w : `"${new Date(Date.parse(d) + days).toISOString().slice(0, 10)}"`)),
      );
    const sample = {
      a: "2026-10-31T10:00:00Z",
      b: "2026-10-31T10:00:00.123+08:00",
      c: "from 2026-10-30T01:02:03Z to 2026-10-31T01:02:03Z",
      d: "2026-10-30",
      e: "1283-05-01",
      f: "-000276-03-03T00:00:00Z",
      g: "2026-10-30 is a date in a sentence",
      "2026-10-29": [1, "2026-10-28", { h: "2026-10-27T00:00:00Z", i: null, j: 5, k: true }],
      l: 'quoted "2026-10-30" inside',
    };
    expect(shiftStamps(sample, mockRecordedAt)).toEqual(old(sample));
  });
});
