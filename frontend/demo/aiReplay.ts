/**
 * The demo's business-AI answers (docs/audit/2026-11-12-portfolio-ai-ideas.md part two, points 6 and 7). The demo
 * never calls a model: `scripts/demo-record.mjs` asked the real backend once and these are its recorded answers.
 *
 * - `GET /perm/explain/?action=…` — exact key only. Any other recorded explanation would be about another action, so
 *   an unrecorded one is a 503 and the page says it could not look the reason up.
 * - `POST /audit-logs/nl-filter/` — by the question, exactly as recorded. Anything else answers `demo_not_recorded`
 *   with the questions that were recorded, so the page can offer them.
 * - `POST /judgment/<id>/statute-suggestions/`, `POST /judgment/<id>/verdict-draft/ {verdict}` (points 1 and 2) and
 *   `POST /social-moderation/{posts|comments}/ai-screen/` (point 4) — recorded per case / per verdict / per queue
 *   (`recordBusinessAi` in scripts/demo-record.mjs), keyed like a GET. Unrecorded → 503 `demo_not_recorded`, which the
 *   panels show as "could not get one". Citing a suggestion goes through the ordinary citation write replay.
 * - `POST /assist/ai-drafts/<id>/decide/` — accepted; the demo keeps no provenance.
 */
import type { Answer, Recording } from "./store";

const EXPLAIN = "/perm/explain/";
export const ASK = "/audit-logs/nl-filter/";
const BUSINESS = [
  /^\/judgment\/[^/]+\/statute-suggestions\/$/,
  /^\/judgment\/[^/]+\/verdict-draft\/$/,
  /^\/social-moderation\/(posts|comments)\/ai-screen\/$/,
];

function keyOf(path: string, query: URLSearchParams): string {
  const q = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return q ? `${path}?${q}` : path;
}

export function aiRead(rec: Recording, path: string, query: URLSearchParams): Answer | null {
  if (path !== EXPLAIN) return null;
  const doc = rec.docs[keyOf(path, query)];
  return doc ? { status: doc.s, data: doc.b } : { status: 503, data: { type: "about:blank", title: "Service Unavailable", status: 503, code: "demo_not_recorded", detail: "not recorded" } };
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
    return { status: 503, data: { type: "about:blank", title: "Service Unavailable", status: 503, code: "demo_not_recorded", detail: "not recorded", examples: recordedQuestions(rec) } };
  }
  if (BUSINESS.some((re) => re.test(path))) {
    const key = path.endsWith("/verdict-draft/") ? `${path}?verdict=${String(body.verdict ?? "")}` : path;
    const doc = rec.docs[key];
    return doc ? { status: doc.s, data: doc.b } : { status: 503, data: { type: "about:blank", title: "Service Unavailable", status: 503, code: "demo_not_recorded", detail: "not recorded" } };
  }
  if (/^\/assist\/ai-drafts\/\d+\/decide\/$/.test(path)) {
    return { status: 200, data: { id: Number(path.split("/")[3]), status: body.adopted ? "adopted" : "discarded", edit_ratio: null } };
  }
  return null;
}
