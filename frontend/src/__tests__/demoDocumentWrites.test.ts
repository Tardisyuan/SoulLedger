/**
 * The demo answers a whole-document write (PUT/PATCH on a path with no row id) with the document, not with the
 * generic "accepted without effect" empty list: the role data-scope drawer, the 42 confessions and the settings
 * screens read fields off the answer and crashed on an array (F-DEMO-01/02/03/06).
 */
import { type Recording, read, resetOverlay } from "@/demo/store";
import { write } from "@/demo/writes";

const confessions = {
  applies: true,
  concluded: false,
  items: [
    { ordinal: 1, statute_id: "s1", truthful: null, note: "" },
    { ordinal: 2, statute_id: "s2", truthful: null, note: "" },
  ],
  tally: { truthful: 0, untruthful: 0, unheard: 2, total: 2 },
};
const rec: Recording = {
  role: "judge_eg",
  lang: "en",
  recordedAt: "2026-11-08T00:00:00Z",
  login: { user: { id: 1, username: "x" } },
  lists: {},
  docs: {
    "/perm/roles/1/data-scope/": { s: 200, b: { default: { scope: "ALL", orgs: [] }, overrides: [] } },
    "/judgment/j1/negative-confessions/": { s: 200, b: confessions },
  },
};
const q = () => new URLSearchParams();

beforeEach(() => resetOverlay());

it("a PUT of the role data scope answers with the document, and the next read shows it", () => {
  const body = { default: { scope: "SELF", orgs: [] }, overrides: [{ resource: "soul", scope: "ORG", orgs: [] }] };
  const answer = write(rec, "PUT", "/perm/roles/1/data-scope/", q(), body);
  expect(Array.isArray(answer.data)).toBe(false);
  expect((answer.data as typeof body).overrides).toHaveLength(1);
  expect((read(rec, "/perm/roles/1/data-scope/", q()).data as typeof body).default.scope).toBe("SELF");
});

it("recording one confession returns the whole list with the row and the tally updated", () => {
  const answer = write(rec, "PUT", "/judgment/j1/negative-confessions/2/", q(), { truthful: false, note: "n" });
  const list = answer.data as typeof confessions;
  expect(list.applies).toBe(true);
  expect(list.items[1]).toMatchObject({ truthful: false, note: "n" });
  expect(list.items[0].truthful).toBeNull();
  expect(list.tally).toEqual({ truthful: 0, untruthful: 1, unheard: 1, total: 2 });
});
