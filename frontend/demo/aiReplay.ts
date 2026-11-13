/**
 * The demo's business-AI answers (docs/audit/2026-11-12-portfolio-ai-ideas.md part two, points 6 and 7). The demo
 * never calls a model: `scripts/demo-record.mjs` asked the real backend once and these are its recorded answers.
 *
 * - `GET /perm/explain/?action=…` — exact key only. Any other recorded explanation would be about another action, so
 *   an unrecorded one is a 503 and the page says it could not look the reason up.
 * - `POST /audit-logs/nl-filter/` — by the question, exactly as recorded. Anything else answers `demo_not_recorded`
 *   with the questions that were recorded, so the page can offer them.
 * - `POST /assist/ai-drafts/<id>/decide/` — accepted; the demo keeps no provenance.
 */
import type { Answer, Recording } from "./store";

const EXPLAIN = "/perm/explain/";
export const ASK = "/audit-logs/nl-filter/";

function keyOf(path: string, query: URLSearchParams): string {
  const q = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return q ? `${path}?${q}` : path;
}

export function aiRead(rec: Recording, path: string, query: URLSearchParams): Answer | null {
  if (path !== EXPLAIN) return null;
  const doc = rec.docs[keyOf(path, query)];
  return doc ? { status: doc.s, data: doc.b } : { status: 503, data: { detail: "not recorded", code: "demo_not_recorded" } };
}

/** The questions this recording can answer, in the order they were asked. */
export function recordedQuestions(rec: Recording): string[] {
  return Object.keys(rec.docs)
    .filter((k) => k.startsWith(`${ASK}?question=`))
    .map((k) => k.slice(`${ASK}?question=`.length));
}

export function aiWrite(rec: Recording, method: string, path: string, body: Record<string, unknown>): Answer | null {
  if (method !== "POST") return null;
  if (path === ASK) {
    const doc = rec.docs[`${ASK}?question=${String(body.question ?? "").trim()}`];
    if (doc) return { status: doc.s, data: doc.b };
    return { status: 503, data: { detail: "not recorded", code: "demo_not_recorded", examples: recordedQuestions(rec) } };
  }
  if (/^\/assist\/ai-drafts\/\d+\/decide\/$/.test(path)) {
    return { status: 200, data: { id: Number(path.split("/")[3]), status: body.adopted ? "adopted" : "discarded", edit_ratio: null } };
  }
  return null;
}
