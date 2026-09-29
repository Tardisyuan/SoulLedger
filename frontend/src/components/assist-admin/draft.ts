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
import type { AssistAdminConfig, AssistAdminConfigUpdate } from "@soulledger/core/api/assist-admin";

export type Draft = AssistAdminConfigUpdate;
export type DraftKey = keyof Draft;

/** `CONNECTION_KEYS` in backend/apps/soul_assist/config.py: change any of them and the save needs a passed test. */
export const CONNECTION_KEYS = ["provider", "base_url", "api_key", "model", "effort", "fallbacks"] as const;

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

/** Moving provider or address without a new key: the backend refuses (`api_key_required`). */
export function keyRequired(draft: Draft): boolean {
  return ("provider" in draft || "base_url" in draft) && !draft.api_key;
}

export type SaveBlock = "untested_connection" | "api_key_required" | "invalid" | null;

export function saveBlock(draft: Draft, testedFingerprint: string | null, invalid: boolean): SaveBlock {
  if (invalid) return "invalid";
  if (keyRequired(draft)) return "api_key_required";
  if (needsTest(draft) && testedFingerprint !== fingerprint(draft)) return "untested_connection";
  return null;
}
