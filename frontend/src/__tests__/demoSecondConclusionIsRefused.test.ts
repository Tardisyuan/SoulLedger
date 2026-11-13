/**
 * 「并发与事务」(作品集建议 A5): the demo answers a second conclusion as the server does — 409 `already_concluded`, the
 * server's own message, nothing written — and a first conclusion still goes through. Before, every conclusion
 * "succeeded", so the card's 「试一下」 would have shown a second verdict and a second disposition.
 */
import { ALREADY_CONCLUDED } from "@/demo/flows";
import { type Recording, getOverlay, recording, resetOverlay, rowsNow } from "@/demo/store";
import { write } from "@/demo/writes";

// Loaded as the demo loads it (no typed import of a 3 MB file).
let rec: Recording;
beforeAll(async () => {
  rec = await recording("judge", "zh");
});
const judgments = () => rowsNow(rec, "/judgment/");
const conclude = (id: unknown, verdict: unknown) => write(rec, "POST", `/judgment/${id}/conclude/`, new URLSearchParams(), { verdict, notes: "" });

beforeEach(() => resetOverlay());

it("refuses a concluded case with the server's 409, and writes nothing", () => {
  const done = judgments().find((j) => j.is_final && j.verdict != null)!;
  expect(done).toBeDefined();
  const before = JSON.stringify(getOverlay().patches) + JSON.stringify(getOverlay().added);
  const answer = conclude(done.id, done.verdict);
  expect(answer).toEqual({ status: 409, data: expect.objectContaining({ status: 409, detail: "This judgment has already been concluded.", code: "already_concluded" }) });
  expect(answer.data).toBe(ALREADY_CONCLUDED);
  expect(JSON.stringify(getOverlay().patches) + JSON.stringify(getOverlay().added)).toBe(before);
});

it("still concludes an open case, and a second try on it is then refused", () => {
  const open = judgments().find((j) => !j.is_final && j.verdict == null)!;
  expect(open).toBeDefined();
  expect(conclude(open.id, "FAILED").status).toBe(200);
  expect(judgments().find((j) => j.id === open.id)?.is_final).toBe(true);
  expect(conclude(open.id, "FAILED").status).toBe(409);
});
