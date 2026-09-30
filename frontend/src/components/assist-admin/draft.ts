/**
 * The config draft (canvas 1a 二): switches, provider fields and limits are
 * edited here and saved with one PATCH. Per-hall switches are NOT in it.
 *
 * A draft holds only the keys whose value differs from the loaded config, so
 * "未保存 N 项" is its key count and the PATCH body is the draft itself —
 * unchanged keys are never sent (the redacted `base_url` goes back only if
 * the admin actually edited it). `api_key` is present only when the admin typed
 * a replacement ("" = clear); it is never read from the server.
 */
import type {
  AssistAdminConfig,
  AssistAdminConfigUpdate,
  AssistAdminEmbedding,
  AssistAdminEmbeddingCandidate,
  AssistAdminEmbeddingUpdate,
} from "@soulledger/core/api/assist-admin";

export type Draft = AssistAdminConfigUpdate;
export type DraftKey = keyof Draft;

/**
 * `CONNECTION_KEYS` in backend/apps/soul_assist/config.py: change any of them and the save needs a passed test.
 * `platform` rides along: the backend derives a preset's adapter and address from it, so the test must see it.
 */
export const CONNECTION_KEYS = ["platform", "provider", "base_url", "api_key", "model", "effort", "fallbacks"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Set one key; a value equal to the saved one drops it from the draft. */
export function setDraft(draft: Draft, config: AssistAdminConfig, key: DraftKey, value: unknown): Draft {
  const next = { ...draft } as Record<string, unknown>;
  const saved = key === "api_key" ? undefined : (config as unknown as Record<string, unknown>)[key === "enabled" ? "switch" : key];
  if (value === undefined || (key !== "api_key" && same(value, saved))) delete next[key];
  else next[key] = value;
  return next as Draft;
}

/** The connection part of the draft: what a connectivity test sends as its candidate. */
export function connectionDraft(draft: Draft): Partial<Draft> {
  return Object.fromEntries(CONNECTION_KEYS.filter((k) => k in draft).map((k) => [k, draft[k]]));
}

/** Stable identity of "this exact connection draft" — what a passed test is remembered against. */
export function fingerprint(draft: Draft): string {
  const conn = connectionDraft(draft) as Record<string, unknown>;
  return JSON.stringify(Object.keys(conn).sort().map((k) => [k, conn[k]]));
}

/**
 * Whether saving needs a passed test first. The one exception mirrors the
 * backend's: only clearing the key (a leaked key must be clearable at once).
 */
export function needsTest(draft: Draft): boolean {
  const keys = Object.keys(connectionDraft(draft));
  if (keys.length === 0) return false;
  return !(keys.length === 1 && draft.api_key === "");
}

/**
 * Moving provider or address without saying which key goes with it: the backend refuses (`api_key_required`).
 * `""` counts as saying so — it is how a keyless platform (Ollama) leaves the saved key behind.
 */
export function keyRequired(draft: Draft): boolean {
  return ("provider" in draft || "base_url" in draft) && draft.api_key === undefined;
}

export type SaveBlock = "untested_connection" | "api_key_required" | "invalid" | null;

export function saveBlock(draft: Draft, testedFingerprint: string | null, invalid: boolean): SaveBlock {
  if (invalid) return "invalid";
  if (keyRequired(draft)) return "api_key_required";
  if (needsTest(draft) && testedFingerprint !== fingerprint(draft)) return "untested_connection";
  return null;
}

/**
 * 向量模型 (canvas 1a 六): its own draft, saved by the same footer through its own PATCH (embedding/).
 * Same shape as the config draft — only changed keys, the redacted URL goes back only if edited.
 * URL / model / dims need a passed test of that exact combination; k and the floor do not.
 */
export type EmbeddingDraft = AssistAdminEmbeddingUpdate;
export type EmbeddingDraftKey = keyof EmbeddingDraft;
export const EMBEDDING_CONNECTION_KEYS = ["embedding_url", "embedding_model", "embedding_dims"] as const;

export function setEmbeddingDraft(draft: EmbeddingDraft, saved: AssistAdminEmbedding, key: EmbeddingDraftKey, value: unknown): EmbeddingDraft {
  const next = { ...draft } as Record<string, unknown>;
  if (value === undefined || same(value, saved[key])) delete next[key];
  else next[key] = value;
  return next as EmbeddingDraft;
}

/** What the test sends: the changed connection keys; the backend fills the rest from the saved settings. */
export function embeddingCandidate(draft: EmbeddingDraft): AssistAdminEmbeddingCandidate {
  return Object.fromEntries(EMBEDDING_CONNECTION_KEYS.filter((k) => k in draft).map((k) => [k, draft[k]]));
}

export const embeddingFingerprint = (draft: EmbeddingDraft) =>
  JSON.stringify(EMBEDDING_CONNECTION_KEYS.filter((k) => k in draft).map((k) => [k, draft[k]]));

export function invalidEmbedding(d: EmbeddingDraft): boolean {
  const k = d.retrieval_k;
  const floor = d.retrieval_min_similarity;
  return (
    (k !== undefined && !(Number.isInteger(k) && k >= 1 && k <= 20)) ||
    (floor !== undefined && !(Number.isFinite(floor) && floor >= -1 && floor <= 1)) ||
    (d.embedding_model !== undefined && d.embedding_model.trim() === "") ||
    (d.embedding_url !== undefined && d.embedding_url.trim() === "")
  );
}

export function embeddingSaveBlock(draft: EmbeddingDraft, testedFingerprint: string | null): "untested_embedding" | "invalid" | null {
  if (invalidEmbedding(draft)) return "invalid";
  if (Object.keys(embeddingCandidate(draft)).length > 0 && testedFingerprint !== embeddingFingerprint(draft)) return "untested_embedding";
  return null;
}
