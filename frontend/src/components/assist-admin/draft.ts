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
  AssistAdminApiKeyState,
  AssistAdminBackup,
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

/** A segment's saved connection: the config for the primary, `config/backup/` for the backup (nulls when none). */
export type SavedConnection = Pick<AssistAdminBackup, "platform" | "provider" | "base_url" | "model" | "effort" | "fallbacks" | "prices">;

/** Set one key; a value equal to the saved one drops it from the draft. `saved` is the config, or the saved backup. */
export function setDraft(draft: Draft, config: AssistAdminConfig | SavedConnection, key: DraftKey, value: unknown): Draft {
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

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The SDKs' own addresses when none is given (`SDK_DEFAULT_URL` in backend/apps/soul_assist/platforms.py). */
const SDK_DEFAULT_URL: Record<string, string> = { anthropic: "https://api.anthropic.com", openai_compatible: "https://api.openai.com/v1" };

/**
 * Which stored key a connection uses (`platforms.key_slot`, §13.6): keys are kept per host the key is
 * sent to — a preset's id when the host is that preset's, else `custom:<host[:port]>`.
 */
export function keySlot(config: AssistAdminConfig, provider: string | null | undefined, baseUrl: string | null | undefined): string {
  const host = hostOf(baseUrl || SDK_DEFAULT_URL[provider ?? ""] || "").toLowerCase();
  const preset = config.platforms.find((p) => p.base_url && hostOf(p.base_url).toLowerCase() === host);
  return preset ? preset.id : `custom:${host}`;
}

/** The saved key of that slot. The current platform's comes from `api_key` (it also covers a key from env). */
export function slotKey(config: AssistAdminConfig, provider: string | null | undefined, baseUrl: string | null | undefined): AssistAdminApiKeyState | undefined {
  const slot = keySlot(config, provider, baseUrl);
  return slot === config.api_key_slot ? config.api_key : config.api_keys[slot];
}

/**
 * Moving provider or address without saying which key goes with it, to a platform with no key saved:
 * the backend refuses (`api_key_required`). A platform whose slot has a key uses it (§13.6).
 * `""` counts as saying so — it is how a keyless platform (Ollama) leaves the saved key behind.
 */
export function keyRequired(draft: Draft, config: AssistAdminConfig, saved: SavedConnection = config): boolean {
  if (!("provider" in draft || "base_url" in draft) || draft.api_key !== undefined) return false;
  const provider = "provider" in draft ? draft.provider : saved.provider;
  const baseUrl = "base_url" in draft ? draft.base_url : saved.base_url;
  return slotKey(config, provider, baseUrl)?.set !== true;
}

export type SaveBlock = "untested_connection" | "api_key_required" | "invalid" | "backup_untested" | "backup_failed" | null;

export function saveBlock(draft: Draft, config: AssistAdminConfig, testedFingerprint: string | null, invalid: boolean): SaveBlock {
  if (invalid) return "invalid";
  if (keyRequired(draft, config)) return "api_key_required";
  if (needsTest(draft) && testedFingerprint !== fingerprint(draft)) return "untested_connection";
  return null;
}

/**
 * The backup's part of the save rule (frame 6c): an open backup with connection changes saves only
 * after its own test of this exact draft passed. A collapsed (or being-removed) backup takes no part.
 */
export function backupSaveBlock(
  draft: Draft,
  config: AssistAdminConfig,
  saved: SavedConnection,
  tested: { fp: string; ok: boolean } | null,
): SaveBlock {
  if (keyRequired(draft, config, saved)) return "api_key_required";
  if (!needsTest(draft)) return null;
  if (tested?.fp !== fingerprint(draft)) return "backup_untested";
  return tested.ok ? null : "backup_failed";
}

/**
 * Frame 6d: both segments on one platform — the same preset, or both custom on one host. Saving is fine;
 * the note says the backup will not help when that platform is down.
 */
export function samePlatform(
  a: { platform: string | null | undefined; base_url: string | null | undefined },
  b: { platform: string | null | undefined; base_url: string | null | undefined },
): boolean {
  if (!a.platform || a.platform !== b.platform) return false;
  return a.platform !== "custom" || (!!a.base_url && !!b.base_url && hostOf(a.base_url).toLowerCase() === hostOf(b.base_url).toLowerCase());
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
